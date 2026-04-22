'use strict';

const { ensurePoolExists } = require('./poolService');
const { buildSwapPricing } = require('./priceService');
const { insertSwap } = require('../repositories/swapRepository');
const { processSwapForCandles } = require('./ohlcvService');
const { aggregatePool } = require('./aggregationService');
const { ensureTokenExists, enrichPoolSymbols } = require('./metadataService');
const { unixToDate } = require('../utils/helpers');

// Throttle aggregation to once every 20 seconds per pool to prevent CPU/RAM spikes
const lastAggregationMap = new Map();

function getMemoryLimitBytes(envName, fallbackMb) {
    const mb = Number.parseInt(process.env[envName] || String(fallbackMb), 10);
    return (Number.isFinite(mb) && mb > 0 ? mb : fallbackMb) * 1024 * 1024;
}

async function persistDecodedSwapEvent(event, wallet, options = {}) {
    const {
        enrichMetadata = true,
    } = options;

    const { dexId } = await ensurePoolExists({
        dexName: event.dexName,
        poolAddress: event.poolAddress,
        baseMint: event.baseMint,
        quoteMint: event.quoteMint,
    });

    const pricing = await buildSwapPricing({
        baseMint: event.baseMint,
        quoteMint: event.quoteMint,
        baseAmount: event.baseAmount,
        quoteAmount: event.quoteAmount,
        priceNative: event.price,
    });

    const blockTime = event.blockTime ? unixToDate(event.blockTime) : null;

    const inserted = await insertSwap({
        signature: event.signature,
        eventIndex: event.eventIndex ?? 0,
        poolAddress: event.poolAddress,
        dexId,
        wallet,
        baseAmount: event.baseAmount,
        quoteAmount: event.quoteAmount,
        price: event.price,
        usdValue: pricing.usdValue,
        priceUsd: pricing.priceUsd,
        priceSol: pricing.priceSol,
        quotePriceUsd: pricing.quotePriceUsd,
        swapSide: event.swapSide,
        classification: event.classification,
        slot: event.slot,
        blockTime,
    });

    let candleUpdates = [];

    if (inserted) {
        candleUpdates = await processSwapForCandles({
            poolAddress: event.poolAddress,
            blockTime,
            priceUsd: pricing.priceUsd,
            priceNative: event.price,
            usdValue: pricing.usdValue,
            baseAmount: event.baseAmount,
            quoteAmount: event.quoteAmount,
            swapSide: event.swapSide,
        });

        // ── Decouple aggregation from the hot swap path ──────────────────────
        // aggregatePool runs a 5000-row SQL query + RPC call per swap event.
        // Awaiting it in-band blocks the BullMQ worker on every transaction,
        // stacking up concurrent heavy DB queries under burst load and
        // exhausting memory / connection pool → server crash.
        // Fire it async so the worker job completes fast.
        // ── Decouple aggregation from the hot swap path ──────────────────────
        // aggregatePool runs a 5000-row SQL query + RPC call per swap event.
        // Awaiting it in-band blocks the BullMQ worker on every transaction,
        // stacking up concurrent heavy DB queries under burst load and
        // exhausting memory / connection pool → server crash.
        // We throttle this to once every 20 seconds per pool to maintain stability.
        setImmediate(() => {
            const poolAddr = event.poolAddress;
            const now = Date.now();
            const lastRun = lastAggregationMap.get(poolAddr) || 0;

            if (now - lastRun < 20_000) {
                return; // Skip: too frequent
            }

            if (process.memoryUsage().rss > getMemoryLimitBytes('HOT_PATH_AGGREGATION_RSS_LIMIT_MB', 330)) {
                console.warn('[MarketData] Skipping background aggregatePool due to RSS pressure');
                return;
            }

            lastAggregationMap.set(poolAddr, now);

            aggregatePool(poolAddr).catch((err) => {
                console.warn('[MarketData] Background aggregatePool failed:', err.message);
            });
        });
    }

    if (enrichMetadata) {
        setImmediate(async () => {
            try {
                await ensureTokenExists(event.baseMint);
                await ensureTokenExists(event.quoteMint);
                await enrichPoolSymbols(event.poolAddress, event.baseMint, event.quoteMint);
            } catch (err) {
                console.warn('[MarketData] Metadata enrichment failed:', err.message);
            }
        });
    }

    return {
        inserted,
        dexId,
        blockTime,
        pricing,
        candleUpdates,
    };
}

module.exports = { persistDecodedSwapEvent };

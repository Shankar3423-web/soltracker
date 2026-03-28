'use strict';

const { ensurePoolExists } = require('./poolService');
const { buildSwapPricing } = require('./priceService');
const { insertSwap } = require('../repositories/swapRepository');
const { processSwapForCandles } = require('./ohlcvService');
const { aggregatePool } = require('./aggregationService');
const { ensureTokenExists, enrichPoolSymbols } = require('./metadataService');
const { unixToDate } = require('../utils/helpers');

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
    let stats = null;

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

        stats = await aggregatePool(event.poolAddress);
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
        stats,
    };
}

module.exports = { persistDecodedSwapEvent };

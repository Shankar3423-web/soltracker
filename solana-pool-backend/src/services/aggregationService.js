'use strict';

const db = require('../config/db');
const { upsertPoolStats } = require('../repositories/poolStatsRepository');
const { getTokenSupply } = require('./metadataService');
const { calculateLiquidity } = require('./liquidityService');

const WINDOWS = {
    '5m': 5 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
};

function createMetricBucket() {
    return {
        txCount: 0,
        buys: 0,
        sells: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        makers: new Set(),
        buyers: new Set(),
        sellers: new Set(),
    };
}

function metricPrice(trade) {
    if (trade.priceUsd != null && trade.priceUsd > 0) return trade.priceUsd;
    if (trade.priceNative != null && trade.priceNative > 0) return trade.priceNative;
    return null;
}

function toNumber(value) {
    return value == null ? null : Number(value);
}

function findCurrentTrade(trades) {
    for (let i = trades.length - 1; i >= 0; i--) {
        if (metricPrice(trades[i]) != null) return trades[i];
    }
    return null;
}

function findReferencePrice(trades, cutoffMs) {
    for (let i = trades.length - 1; i >= 0; i--) {
        const tradeTime = trades[i].blockTime?.getTime?.() ?? 0;
        const price = metricPrice(trades[i]);
        if (tradeTime <= cutoffMs && price != null) {
            return price;
        }
    }

    for (const trade of trades) {
        const tradeTime = trade.blockTime?.getTime?.() ?? 0;
        const price = metricPrice(trade);
        if (tradeTime >= cutoffMs && price != null) {
            return price;
        }
    }

    return null;
}

function computePriceChange(currentPrice, previousPrice) {
    if (currentPrice == null || previousPrice == null || previousPrice === 0) {
        return null;
    }
    return ((currentPrice / previousPrice) - 1) * 100;
}

function buildWindowMetrics(trades) {
    const now = Date.now();
    const metrics = Object.fromEntries(
        Object.keys(WINDOWS).map((key) => [key, createMetricBucket()])
    );

    for (const trade of trades) {
        const tradeTime = trade.blockTime?.getTime?.();
        if (!tradeTime) continue;

        for (const [label, windowMs] of Object.entries(WINDOWS)) {
            if ((now - tradeTime) > windowMs) continue;

            const bucket = metrics[label];
            bucket.txCount += 1;

            const usdValue = trade.usdValue ?? 0;
            bucket.volume += usdValue;

            if (trade.swapSide === 'buy') {
                bucket.buys += 1;
                bucket.buyVolume += usdValue;
            } else if (trade.swapSide === 'sell') {
                bucket.sells += 1;
                bucket.sellVolume += usdValue;
            }

            if (trade.wallet) {
                bucket.makers.add(trade.wallet);
                if (trade.swapSide === 'buy') bucket.buyers.add(trade.wallet);
                if (trade.swapSide === 'sell') bucket.sellers.add(trade.wallet);
            }
        }
    }

    return metrics;
}

async function aggregatePool(poolAddress) {
    try {
        const poolRes = await db.query(
            `SELECT base_token_mint, quote_token_mint
             FROM pools
             WHERE pool_address = $1
             LIMIT 1`,
            [poolAddress]
        );
        const poolInfo = poolRes.rows[0];
        if (!poolInfo) return null;

        const swapRes = await db.query(
            `SELECT
                id,
                wallet,
                swap_side,
                usd_value,
                price,
                price_usd,
                price_sol,
                base_amount,
                quote_amount,
                block_time
             FROM swaps
             WHERE pool_address = $1
             ORDER BY block_time ASC NULLS LAST, event_index ASC, id ASC`,
            [poolAddress]
        );

        const trades = swapRes.rows.map((row) => ({
            wallet: row.wallet ?? null,
            swapSide: row.swap_side ?? null,
            usdValue: row.usd_value != null ? Number(row.usd_value) : 0,
            priceNative: row.price != null ? Number(row.price) : null,
            priceUsd: row.price_usd != null ? Number(row.price_usd) : null,
            priceSol: row.price_sol != null ? Number(row.price_sol) : null,
            baseAmount: row.base_amount != null ? Number(row.base_amount) : null,
            quoteAmount: row.quote_amount != null ? Number(row.quote_amount) : null,
            blockTime: row.block_time ? new Date(row.block_time) : null,
        }));

        const currentTrade = findCurrentTrade(trades);
        const currentPriceUsd = currentTrade?.priceUsd ?? null;
        const currentPriceNative = currentTrade?.priceNative ?? null;
        const currentPriceSol = currentTrade?.priceSol ?? null;
        const currentMetricPrice = metricPrice(currentTrade ?? {});

        const metrics = buildWindowMetrics(trades);
        const now = Date.now();

        const priceChange5m = computePriceChange(
            currentMetricPrice,
            findReferencePrice(trades, now - WINDOWS['5m'])
        );
        const priceChange1h = computePriceChange(
            currentMetricPrice,
            findReferencePrice(trades, now - WINDOWS['1h'])
        );
        const priceChange6h = computePriceChange(
            currentMetricPrice,
            findReferencePrice(trades, now - WINDOWS['6h'])
        );
        const priceChange24h = computePriceChange(
            currentMetricPrice,
            findReferencePrice(trades, now - WINDOWS['24h'])
        );

        const liquidity = await calculateLiquidity(
            poolAddress,
            poolInfo.base_token_mint,
            poolInfo.quote_token_mint,
            currentPriceNative,
            currentPriceUsd
        );

        let fdv = null;
        if (currentPriceUsd != null) {
            const totalSupply = await getTokenSupply(poolInfo.base_token_mint);
            if (totalSupply != null) {
                fdv = totalSupply * currentPriceUsd;
            }
        }

        return upsertPoolStats({
            poolAddress,
            price: currentPriceUsd,
            priceNative: currentPriceNative,
            priceUsd: currentPriceUsd,
            priceSol: currentPriceSol,
            liquidity: liquidity?.liquidityUsd ?? null,
            liquidityUsd: liquidity?.liquidityUsd ?? null,
            liquidityBase: liquidity?.liquidityBase ?? null,
            liquidityQuote: liquidity?.liquidityQuote ?? null,
            liquidityUpdatedAt: liquidity ? new Date() : null,
            priceChange5m: priceChange5m,
            priceChange1h: priceChange1h,
            priceChange6h: priceChange6h,
            priceChange24h: priceChange24h,
            volume5m: metrics['5m'].volume,
            volume1h: metrics['1h'].volume,
            volume6h: metrics['6h'].volume,
            volume24h: metrics['24h'].volume,
            txCount5m: metrics['5m'].txCount,
            txCount1h: metrics['1h'].txCount,
            txCount6h: metrics['6h'].txCount,
            txCount24h: metrics['24h'].txCount,
            buys5m: metrics['5m'].buys,
            buys1h: metrics['1h'].buys,
            buys6h: metrics['6h'].buys,
            buys24h: metrics['24h'].buys,
            sells5m: metrics['5m'].sells,
            sells1h: metrics['1h'].sells,
            sells6h: metrics['6h'].sells,
            sells24h: metrics['24h'].sells,
            buyVolume5m: metrics['5m'].buyVolume,
            buyVolume1h: metrics['1h'].buyVolume,
            buyVolume6h: metrics['6h'].buyVolume,
            buyVolume24h: metrics['24h'].buyVolume,
            sellVolume5m: metrics['5m'].sellVolume,
            sellVolume1h: metrics['1h'].sellVolume,
            sellVolume6h: metrics['6h'].sellVolume,
            sellVolume24h: metrics['24h'].sellVolume,
            makers5m: metrics['5m'].makers.size,
            makers1h: metrics['1h'].makers.size,
            makers6h: metrics['6h'].makers.size,
            makers24h: metrics['24h'].makers.size,
            buyers5m: metrics['5m'].buyers.size,
            buyers1h: metrics['1h'].buyers.size,
            buyers6h: metrics['6h'].buyers.size,
            buyers24h: metrics['24h'].buyers.size,
            sellers5m: metrics['5m'].sellers.size,
            sellers1h: metrics['1h'].sellers.size,
            sellers6h: metrics['6h'].sellers.size,
            sellers24h: metrics['24h'].sellers.size,
            fdv,
            marketCap: fdv,
        });
    } catch (err) {
        console.warn(`[Aggregation] aggregatePool failed for ${poolAddress}:`, err.message);
        return null;
    }
}

async function aggregateAllPools() {
    try {
        const pools = await db.query('SELECT pool_address FROM pools ORDER BY created_at ASC');
        let updated = 0;

        for (const row of pools.rows) {
            const stats = await aggregatePool(row.pool_address);
            if (stats) updated++;
        }

        console.log(`[Aggregation] Updated stats for ${updated} pool(s).`);
        return updated;
    } catch (err) {
        console.error('[Aggregation] aggregateAllPools failed:', err.message);
        return 0;
    }
}

module.exports = {
    aggregateAllPools,
    aggregatePool,
};

'use strict';
const db = require('../config/db');

/**
 * ohlcvService.js
 * Aggregates individual swaps into OHLCV candles (Open, High, Low, Close, Volume).
 * 
 * Resolutions: 1m, 5m, 15m, 30m, 1h, 4h, 24h
 */

const RESOLUTIONS = ['1m', '5m', '15m', '30m', '1h', '4h', '24h'];

/**
 * Takes a swap event and updates all relevant candles in the pool_candles table.
 * uses UPSERT logic to handle real-time high/low tracking.
 */
async function processSwapForCandles(swap) {
    if (!swap || !swap.poolAddress || !swap.price || !swap.blockTime) return;

    const blockTime = new Date(swap.blockTime);
    const price = swap.price;
    const volumeUsd = swap.usdValue || 0;

    for (const res of RESOLUTIONS) {
        try {
            const timeBucket = getBucket(blockTime, res);

            // Perform UPSERT on pool_candles
            // If the candle exists for (pool, res, bucket), update High/Low/Close/Volume
            // If it doesn't exist, create it.
            await db.query(
                `INSERT INTO pool_candles (
                    pool_address, resolution, time_bucket, 
                    open_price, high_price, low_price, close_price, 
                    volume_usd, tx_count, updated_at
                )
                VALUES ($1, $2, $3, $4, $4, $4, $4, $5, 1, CURRENT_TIMESTAMP)
                ON CONFLICT (pool_address, resolution, time_bucket)
                DO UPDATE SET
                    high_price = GREATEST(pool_candles.high_price, EXCLUDED.high_price),
                    low_price = LEAST(pool_candles.low_price, EXCLUDED.low_price),
                    close_price = EXCLUDED.close_price,
                    volume_usd = pool_candles.volume_usd + EXCLUDED.volume_usd,
                    tx_count = pool_candles.tx_count + 1,
                    updated_at = CURRENT_TIMESTAMP`,
                [swap.poolAddress, res, timeBucket, price, volumeUsd]
            );
        } catch (err) {
            console.error(`[OHLCV] Failed to update ${res} candle for ${swap.poolAddress}:`, err.message);
        }
    }
}

/**
 * Calculates the start of the timeframe bucket based on resolution.
 */
function getBucket(date, resolution) {
    const d = new Date(date);
    d.setSeconds(0);
    d.setMilliseconds(0);

    const minutes = d.getMinutes();
    const hours = d.getHours();

    switch (resolution) {
        case '1m':
            break;
        case '5m':
            d.setMinutes(minutes - (minutes % 5));
            break;
        case '15m':
            d.setMinutes(minutes - (minutes % 15));
            break;
        case '30m':
            d.setMinutes(minutes - (minutes % 30));
            break;
        case '1h':
            d.setMinutes(0);
            break;
        case '4h':
            d.setMinutes(0);
            d.setHours(hours - (hours % 4));
            break;
        case '24h':
            d.setMinutes(0);
            d.setHours(0);
            break;
    }
    return d;
}

module.exports = { processSwapForCandles };

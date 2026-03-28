'use strict';

const db = require('../config/db');

const RESOLUTIONS = {
    '1s': 1000,
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
};

function getBucketDate(blockTime, resolution) {
    const time = blockTime instanceof Date ? blockTime : new Date(blockTime);
    const ms = RESOLUTIONS[resolution];
    if (!ms || Number.isNaN(time.getTime())) return null;
    return new Date(Math.floor(time.getTime() / ms) * ms);
}

function chooseDisplayPrice(row, unit) {
    if (unit === 'native') {
        return {
            open: row.open_price_native != null ? Number(row.open_price_native) : null,
            high: row.high_price_native != null ? Number(row.high_price_native) : null,
            low: row.low_price_native != null ? Number(row.low_price_native) : null,
            close: row.close_price_native != null ? Number(row.close_price_native) : null,
        };
    }

    return {
        open: row.open_price != null ? Number(row.open_price) : (row.open_price_native != null ? Number(row.open_price_native) : null),
        high: row.high_price != null ? Number(row.high_price) : (row.high_price_native != null ? Number(row.high_price_native) : null),
        low: row.low_price != null ? Number(row.low_price) : (row.low_price_native != null ? Number(row.low_price_native) : null),
        close: row.close_price != null ? Number(row.close_price) : (row.close_price_native != null ? Number(row.close_price_native) : null),
    };
}

async function processSwapForCandles({
    poolAddress,
    blockTime,
    priceUsd,
    priceNative,
    usdValue = 0,
    baseAmount = 0,
    quoteAmount = 0,
    swapSide = null,
}) {
    if (!poolAddress || !blockTime) return [];

    const updates = [];

    for (const resolution of Object.keys(RESOLUTIONS)) {
        const bucketStart = getBucketDate(blockTime, resolution);
        if (!bucketStart) continue;

        const result = await db.query(
            `INSERT INTO pool_candles (
                pool_address,
                resolution,
                time_bucket,
                open_price,
                high_price,
                low_price,
                close_price,
                open_price_native,
                high_price_native,
                low_price_native,
                close_price_native,
                volume_usd,
                volume_base,
                volume_quote,
                tx_count,
                buys,
                sells,
                updated_at
            )
            VALUES (
                $1, $2, $3,
                $4, $4, $4, $4,
                $5, $5, $5, $5,
                $6, $7, $8,
                1,
                $9, $10,
                NOW()
            )
            ON CONFLICT (pool_address, resolution, time_bucket) DO UPDATE SET
                high_price = CASE
                    WHEN EXCLUDED.high_price IS NULL THEN pool_candles.high_price
                    WHEN pool_candles.high_price IS NULL THEN EXCLUDED.high_price
                    ELSE GREATEST(pool_candles.high_price, EXCLUDED.high_price)
                END,
                low_price = CASE
                    WHEN EXCLUDED.low_price IS NULL THEN pool_candles.low_price
                    WHEN pool_candles.low_price IS NULL THEN EXCLUDED.low_price
                    ELSE LEAST(pool_candles.low_price, EXCLUDED.low_price)
                END,
                close_price = COALESCE(EXCLUDED.close_price, pool_candles.close_price),
                high_price_native = CASE
                    WHEN EXCLUDED.high_price_native IS NULL THEN pool_candles.high_price_native
                    WHEN pool_candles.high_price_native IS NULL THEN EXCLUDED.high_price_native
                    ELSE GREATEST(pool_candles.high_price_native, EXCLUDED.high_price_native)
                END,
                low_price_native = CASE
                    WHEN EXCLUDED.low_price_native IS NULL THEN pool_candles.low_price_native
                    WHEN pool_candles.low_price_native IS NULL THEN EXCLUDED.low_price_native
                    ELSE LEAST(pool_candles.low_price_native, EXCLUDED.low_price_native)
                END,
                close_price_native = COALESCE(EXCLUDED.close_price_native, pool_candles.close_price_native),
                volume_usd = COALESCE(pool_candles.volume_usd, 0) + EXCLUDED.volume_usd,
                volume_base = COALESCE(pool_candles.volume_base, 0) + EXCLUDED.volume_base,
                volume_quote = COALESCE(pool_candles.volume_quote, 0) + EXCLUDED.volume_quote,
                tx_count = COALESCE(pool_candles.tx_count, 0) + 1,
                buys = COALESCE(pool_candles.buys, 0) + EXCLUDED.buys,
                sells = COALESCE(pool_candles.sells, 0) + EXCLUDED.sells,
                updated_at = NOW()
            RETURNING *`,
            [
                poolAddress,
                resolution,
                bucketStart,
                priceUsd ?? null,
                priceNative ?? null,
                usdValue ?? 0,
                baseAmount ?? 0,
                quoteAmount ?? 0,
                swapSide === 'buy' ? 1 : 0,
                swapSide === 'sell' ? 1 : 0,
            ]
        );

        updates.push(result.rows[0]);
    }

    return updates;
}

async function getCandles(poolAddress, resolution, options = {}) {
    if (!RESOLUTIONS[resolution]) {
        throw new Error(`Unsupported candle resolution: ${resolution}`);
    }

    const {
        from = null,
        to = null,
        limit = 300,
        unit = 'usd',
    } = options;

    const clauses = ['pool_address = $1', 'resolution = $2'];
    const params = [poolAddress, resolution];
    let paramIndex = params.length + 1;

    if (from) {
        clauses.push(`time_bucket >= $${paramIndex++}`);
        params.push(from);
    }

    if (to) {
        clauses.push(`time_bucket <= $${paramIndex++}`);
        params.push(to);
    }

    params.push(Math.min(limit, 1000));
    const limitPlaceholder = `$${params.length}`;

    const result = await db.query(
        `SELECT *
         FROM pool_candles
         WHERE ${clauses.join(' AND ')}
         ORDER BY time_bucket DESC
         LIMIT ${limitPlaceholder}`,
        params
    );

    return result.rows
        .reverse()
        .map((row) => {
            const prices = chooseDisplayPrice(row, unit);
            return {
                time: row.time_bucket,
                open: prices.open,
                high: prices.high,
                low: prices.low,
                close: prices.close,
                volumeUsd: row.volume_usd != null ? Number(row.volume_usd) : 0,
                volumeBase: row.volume_base != null ? Number(row.volume_base) : 0,
                volumeQuote: row.volume_quote != null ? Number(row.volume_quote) : 0,
                txCount: Number(row.tx_count ?? 0),
                buys: Number(row.buys ?? 0),
                sells: Number(row.sells ?? 0),
            };
        });
}

module.exports = {
    RESOLUTIONS,
    getCandles,
    processSwapForCandles,
};

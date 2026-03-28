'use strict';

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { getPoolStats, getPoolStatsByDex } = require('../repositories/poolStatsRepository');
const { aggregatePool } = require('../services/aggregationService');
const { calculateLiquidity } = require('../services/liquidityService');
const { getCandles, RESOLUTIONS } = require('../services/ohlcvService');

function parsePositiveInt(value, defaultVal) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) || n < 0 ? defaultVal : n;
}

function toNumber(value) {
    return value == null ? null : Number(value);
}

function windowKey(label) {
    return label === '24h' ? '24h' : label;
}

function formatWindowStats(stats, label) {
    const suffix = label === '24h' ? '24h' : label;
    return {
        total: Number(stats[`tx_count_${suffix}`] ?? 0),
        buys: Number(stats[`buys_${suffix}`] ?? 0),
        sells: Number(stats[`sells_${suffix}`] ?? 0),
    };
}

function formatStats(stats) {
    if (!stats) return null;

    return {
        price: toNumber(stats.price_usd ?? stats.price),
        priceUsd: toNumber(stats.price_usd ?? stats.price),
        priceNative: toNumber(stats.price_native),
        priceSol: toNumber(stats.price_sol),
        liquidity: {
            usd: toNumber(stats.liquidity_usd ?? stats.liquidity),
            base: toNumber(stats.liquidity_base),
            quote: toNumber(stats.liquidity_quote),
        },
        fdv: toNumber(stats.fdv),
        marketCap: toNumber(stats.market_cap),
        priceChange: {
            m5: toNumber(stats.price_change_5m),
            h1: toNumber(stats.price_change_1h),
            h6: toNumber(stats.price_change_6h),
            h24: toNumber(stats.price_change_24h),
        },
        txns: {
            m5: formatWindowStats(stats, '5m'),
            h1: formatWindowStats(stats, '1h'),
            h6: formatWindowStats(stats, '6h'),
            h24: formatWindowStats(stats, '24h'),
        },
        volume: {
            m5: toNumber(stats.volume_5m),
            h1: toNumber(stats.volume_1h),
            h6: toNumber(stats.volume_6h),
            h24: toNumber(stats.volume_24h),
        },
        buyVolume: {
            m5: toNumber(stats.buy_volume_5m),
            h1: toNumber(stats.buy_volume_1h),
            h6: toNumber(stats.buy_volume_6h),
            h24: toNumber(stats.buy_volume_24h),
        },
        sellVolume: {
            m5: toNumber(stats.sell_volume_5m),
            h1: toNumber(stats.sell_volume_1h),
            h6: toNumber(stats.sell_volume_6h),
            h24: toNumber(stats.sell_volume_24h),
        },
        makers: {
            m5: Number(stats.makers_5m ?? 0),
            h1: Number(stats.makers_1h ?? 0),
            h6: Number(stats.makers_6h ?? 0),
            h24: Number(stats.makers_24h ?? 0),
        },
        buyers: {
            m5: Number(stats.buyers_5m ?? 0),
            h1: Number(stats.buyers_1h ?? 0),
            h6: Number(stats.buyers_6h ?? 0),
            h24: Number(stats.buyers_24h ?? 0),
        },
        sellers: {
            m5: Number(stats.sellers_5m ?? 0),
            h1: Number(stats.sellers_1h ?? 0),
            h6: Number(stats.sellers_6h ?? 0),
            h24: Number(stats.sellers_24h ?? 0),
        },
        updatedAt: stats.updated_at,
    };
}

function formatPoolSummary(row) {
    const baseSymbol = row.base_symbol ?? row.base_symbol_t ?? null;
    const quoteSymbol = row.quote_symbol ?? row.quote_symbol_t ?? null;
    return {
        poolAddress: row.pool_address,
        dexName: row.dex_name ?? null,
        pairName: baseSymbol && quoteSymbol ? `${baseSymbol}/${quoteSymbol}` : null,
        baseSymbol,
        quoteSymbol,
        baseName: row.base_name ?? null,
        quoteName: row.quote_name ?? null,
        baseLogo: row.base_logo ?? null,
        quoteLogo: row.quote_logo ?? null,
        baseMint: row.base_token_mint,
        quoteMint: row.quote_token_mint,
        stats: formatStats(row),
    };
}

function formatPoolDetail(row) {
    const baseSymbol = row.base_symbol ?? row.base_symbol_t ?? null;
    const quoteSymbol = row.quote_symbol ?? row.quote_symbol_t ?? null;
    return {
        poolAddress: row.pool_address,
        dexName: row.dex_name,
        pairName: baseSymbol && quoteSymbol ? `${baseSymbol}/${quoteSymbol}` : null,
        baseMint: row.base_token_mint,
        quoteMint: row.quote_token_mint,
        baseSymbol,
        quoteSymbol,
        baseName: row.base_name ?? null,
        quoteName: row.quote_name ?? null,
        baseLogo: row.base_logo ?? null,
        quoteLogo: row.quote_logo ?? null,
        createdAt: row.created_at,
    };
}

function formatTx(row) {
    return {
        signature: row.signature,
        eventIndex: Number(row.event_index ?? 0),
        wallet: row.wallet,
        baseAmount: toNumber(row.base_amount),
        quoteAmount: toNumber(row.quote_amount),
        price: toNumber(row.price_usd ?? row.price),
        priceUsd: toNumber(row.price_usd),
        priceNative: toNumber(row.price),
        priceSol: toNumber(row.price_sol),
        quotePriceUsd: toNumber(row.quote_price_usd),
        usdValue: toNumber(row.usd_value),
        swapSide: row.swap_side,
        classification: row.classification,
        slot: row.slot,
        blockTime: row.block_time,
    };
}

async function ensurePoolStats(poolAddress, poolRow) {
    let stats = await getPoolStats(poolAddress);
    if (!stats) {
        stats = await aggregatePool(poolAddress);
    }

    if (
        stats &&
        (stats.liquidity_usd == null || Number(stats.liquidity_usd) <= 0) &&
        poolRow
    ) {
        const liquidity = await calculateLiquidity(
            poolAddress,
            poolRow.base_token_mint,
            poolRow.quote_token_mint,
            stats.price_native != null ? Number(stats.price_native) : null,
            stats.price_usd != null ? Number(stats.price_usd) : (stats.price != null ? Number(stats.price) : null)
        );

        if (liquidity) {
            await db.query(
                `UPDATE pool_stats
                 SET liquidity = $1,
                     liquidity_usd = $1,
                     liquidity_base = $2,
                     liquidity_quote = $3,
                     liquidity_updated_at = NOW(),
                     updated_at = NOW()
                 WHERE pool_address = $4`,
                [
                    liquidity.liquidityUsd,
                    liquidity.liquidityBase,
                    liquidity.liquidityQuote,
                    poolAddress,
                ]
            );
            stats = await getPoolStats(poolAddress);
        }
    }

    return stats;
}

router.get('/dex/:dexName', async (req, res, next) => {
    try {
        const { dexName } = req.params;
        const limit = parsePositiveInt(req.query.limit, 50);
        const offset = parsePositiveInt(req.query.offset, 0);

        const dexResult = await db.query(
            'SELECT id FROM dexes WHERE LOWER(name) = LOWER($1) LIMIT 1',
            [dexName]
        );
        if (!dexResult.rows.length) {
            return res.status(404).json({ error: `DEX not found: ${dexName}` });
        }

        const dexId = dexResult.rows[0].id;
        const rows = await getPoolStatsByDex(dexId, Math.min(limit, 200), offset);
        const countResult = await db.query(
            'SELECT COUNT(*) AS total FROM pools WHERE dex_id = $1',
            [dexId]
        );

        return res.json({
            dexName,
            total: Number(countResult.rows[0].total ?? 0),
            limit,
            offset,
            pools: rows.map(formatPoolSummary),
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:poolAddress/transactions', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const limit = parsePositiveInt(req.query.limit, 50);
        const offset = parsePositiveInt(req.query.offset, 0);
        const side = req.query.side;

        const sideFilter = side === 'buy' || side === 'sell' ? side : null;

        const query = sideFilter
            ? `SELECT signature, event_index, wallet, base_amount, quote_amount, price,
                      price_usd, price_sol, quote_price_usd, usd_value,
                      swap_side, classification, slot, block_time
               FROM swaps
               WHERE pool_address = $1 AND swap_side = $2
               ORDER BY block_time DESC NULLS LAST, event_index DESC
               LIMIT $3 OFFSET $4`
            : `SELECT signature, event_index, wallet, base_amount, quote_amount, price,
                      price_usd, price_sol, quote_price_usd, usd_value,
                      swap_side, classification, slot, block_time
               FROM swaps
               WHERE pool_address = $1
               ORDER BY block_time DESC NULLS LAST, event_index DESC
               LIMIT $2 OFFSET $3`;

        const params = sideFilter
            ? [poolAddress, sideFilter, Math.min(limit, 500), offset]
            : [poolAddress, Math.min(limit, 500), offset];

        const txResult = await db.query(query, params);
        const countResult = await db.query(
            sideFilter
                ? 'SELECT COUNT(*) AS total FROM swaps WHERE pool_address = $1 AND swap_side = $2'
                : 'SELECT COUNT(*) AS total FROM swaps WHERE pool_address = $1',
            sideFilter ? [poolAddress, sideFilter] : [poolAddress]
        );

        return res.json({
            poolAddress,
            total: Number(countResult.rows[0].total ?? 0),
            limit,
            offset,
            side: sideFilter ?? 'all',
            transactions: txResult.rows.map(formatTx),
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:poolAddress/stats', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const poolResult = await db.query(
            'SELECT * FROM pools WHERE pool_address = $1 LIMIT 1',
            [poolAddress]
        );
        if (!poolResult.rows.length) {
            return res.status(404).json({ error: `Pool not found: ${poolAddress}` });
        }

        const stats = await ensurePoolStats(poolAddress, poolResult.rows[0]);
        if (!stats) {
            return res.status(404).json({ error: `No stats found for pool: ${poolAddress}` });
        }

        return res.json({
            poolAddress,
            stats: formatStats(stats),
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:poolAddress/candles', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const resolution = String(req.query.resolution ?? '1m');
        if (!RESOLUTIONS[resolution]) {
            return res.status(400).json({
                error: `Unsupported resolution. Expected one of: ${Object.keys(RESOLUTIONS).join(', ')}`,
            });
        }

        const limit = parsePositiveInt(req.query.limit, 300);
        const unit = req.query.unit === 'native' ? 'native' : 'usd';
        const from = req.query.from ? new Date(Number(req.query.from)) : null;
        const to = req.query.to ? new Date(Number(req.query.to)) : null;

        const candles = await getCandles(poolAddress, resolution, {
            from,
            to,
            limit,
            unit,
        });

        return res.json({
            poolAddress,
            resolution,
            unit,
            candles,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:poolAddress', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const txLimit = parsePositiveInt(req.query.limit, 50);
        const txOffset = parsePositiveInt(req.query.offset, 0);

        const poolResult = await db.query(
            `SELECT p.*, d.name AS dex_name,
                    bt.symbol AS base_symbol_t, bt.name AS base_name, bt.logo_url AS base_logo,
                    qt.symbol AS quote_symbol_t, qt.name AS quote_name, qt.logo_url AS quote_logo
             FROM pools p
             JOIN dexes d ON d.id = p.dex_id
             LEFT JOIN tokens bt ON bt.mint = p.base_token_mint
             LEFT JOIN tokens qt ON qt.mint = p.quote_token_mint
             WHERE p.pool_address = $1
             LIMIT 1`,
            [poolAddress]
        );

        if (!poolResult.rows.length) {
            return res.status(404).json({ error: `Pool not found: ${poolAddress}` });
        }

        const poolRow = poolResult.rows[0];
        const stats = await ensurePoolStats(poolAddress, poolRow);

        const txResult = await db.query(
            `SELECT signature, event_index, wallet, base_amount, quote_amount, price,
                    price_usd, price_sol, quote_price_usd, usd_value,
                    swap_side, classification, slot, block_time
             FROM swaps
             WHERE pool_address = $1
             ORDER BY block_time DESC NULLS LAST, event_index DESC
             LIMIT $2 OFFSET $3`,
            [poolAddress, Math.min(txLimit, 500), txOffset]
        );

        const txCountResult = await db.query(
            'SELECT COUNT(*) AS total FROM swaps WHERE pool_address = $1',
            [poolAddress]
        );

        return res.json({
            pool: formatPoolDetail(poolRow),
            stats: formatStats(stats),
            transactions: {
                totalAllTime: Number(txCountResult.rows[0].total ?? 0),
                limit: txLimit,
                offset: txOffset,
                items: txResult.rows.map(formatTx),
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

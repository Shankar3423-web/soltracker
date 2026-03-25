'use strict';
/**
 * poolsRoute.js
 * Read-only API endpoints for the frontend.
 * All responses are JSON.  No write operations here.
 *
 * Endpoints:
 *
 *   GET /pools/dex/:dexName
 *     List all pools for a DEX name, sorted by 24h volume.
 *     Query params: limit (default 50), offset (default 0)
 *     Response: { dexName, total, pools: [ poolSummary, ... ] }
 *
 *   GET /pools/:poolAddress
 *     Full detail for one pool: stats + recent transactions.
 *     Query params: limit (default 50), offset (default 0)
 *     Response: { pool, stats, transactions: [ swap, ... ] }
 *
 *   GET /pools/:poolAddress/transactions
 *     Paginated raw swap list for a pool.
 *     Query params: limit, offset, side (buy|sell|all)
 *     Response: { poolAddress, total, transactions: [ swap, ... ] }
 *
 *   GET /pools/:poolAddress/stats
 *     Just the stats row for a single pool (lightweight).
 *     Response: { poolAddress, stats }
 *
 *   GET /pools/:poolAddress/candles
 *     Retrieves OHLCV candle data for charting.
 *     Query params: resolution (1m|5m|15m|30m|1h|4h|24h), limit
 *     Response: { poolAddress, resolution, candles: [ {time, open, high, low, close, volume}, ... ] }
 */

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { getPoolStats,
    getPoolStatsByDex } = require('../repositories/poolStatsRepository');
const { aggregatePool } = require('../services/aggregationService');
const { calculateLiquidity } = require('../services/liquidityService');

// ─── helper ──────────────────────────────────────────────────────────────────
function parsePositiveInt(value, defaultVal) {
    const n = parseInt(value, 10);
    return isNaN(n) || n < 0 ? defaultVal : n;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /pools/dex/:dexName
//  List all pools for a DEX ordered by 24h volume desc.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dex/:dexName', async (req, res, next) => {
    try {
        const { dexName } = req.params;
        const limit = parsePositiveInt(req.query.limit, 50);
        const offset = parsePositiveInt(req.query.offset, 0);

        // Resolve dex name → id
        const dexResult = await db.query(
            'SELECT id FROM dexes WHERE LOWER(name) = LOWER($1) LIMIT 1',
            [dexName]
        );
        if (!dexResult.rows.length) {
            return res.status(404).json({ error: `DEX not found: ${dexName}` });
        }
        const dexId = dexResult.rows[0].id;

        const rows = await getPoolStatsByDex(dexId, Math.min(limit, 200), offset);

        // Count total pools for this DEX (for pagination)
        const countResult = await db.query(
            'SELECT COUNT(*) AS total FROM pools WHERE dex_id = $1',
            [dexId]
        );

        return res.json({
            dexName,
            total: parseInt(countResult.rows[0].total, 10),
            limit,
            offset,
            pools: rows.map(formatPoolSummary),
        });
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /pools/:poolAddress
//  Full pool detail: metadata + stats + recent 50 transactions.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:poolAddress', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const txLimit = parsePositiveInt(req.query.limit, 50);
        const txOffset = parsePositiveInt(req.query.offset, 0);

        // Pool record
        const poolResult = await db.query(
            `SELECT p.*, d.name AS dex_name,
              bt.symbol AS base_symbol_t,  bt.name AS base_name,  bt.logo_url AS base_logo,
              qt.symbol AS quote_symbol_t, qt.name AS quote_name, qt.logo_url AS quote_logo
       FROM pools p
       JOIN dexes d  ON d.id  = p.dex_id
       LEFT JOIN tokens bt ON bt.mint = p.base_token_mint
       LEFT JOIN tokens qt ON qt.mint = p.quote_token_mint
       WHERE p.pool_address = $1 LIMIT 1`,
            [poolAddress]
        );
        if (!poolResult.rows.length) {
            return res.status(404).json({ error: `Pool not found: ${poolAddress}` });
        }
        const poolRow = poolResult.rows[0];

        // Stats
        let stats = await getPoolStats(poolAddress);
        if (!stats) {
            // Compute on-demand if not yet aggregated
            await aggregatePool(poolAddress);
            stats = await getPoolStats(poolAddress);
        }

        // Refresh liquidity on-demand if missing
        if (stats && stats.liquidity === null) {
            const liq = await calculateLiquidity(
                poolAddress,
                poolRow.base_token_mint,
                poolRow.quote_token_mint,
                stats?.price ? Number(stats.price) : null
            );
            if (liq !== null) {
                await db.query(
                    'UPDATE pool_stats SET liquidity = $1 WHERE pool_address = $2',
                    [liq, poolAddress]
                );
                if (stats) stats.liquidity = liq;
            }
        }

        // Recent transactions
        const txResult = await db.query(
            `SELECT signature, wallet, base_amount, quote_amount, price,
              usd_value, swap_side, classification, slot, block_time
       FROM swaps
       WHERE pool_address = $1
       ORDER BY block_time DESC NULLS LAST
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
                totalAllTime: parseInt(txCountResult.rows[0].total, 10),
                limit: txLimit,
                offset: txOffset,
                items: txResult.rows.map(formatTx),
            },
        });
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /pools/:poolAddress/transactions
//  Paginated transaction list with optional side filter.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:poolAddress/transactions', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const limit = parsePositiveInt(req.query.limit, 50);
        const offset = parsePositiveInt(req.query.offset, 0);
        const side = req.query.side;   // 'buy' | 'sell' | undefined

        const sideFilter = (side === 'buy' || side === 'sell') ? side : null;

        const query = sideFilter
            ? `SELECT signature, wallet, base_amount, quote_amount, price, usd_value,
                swap_side, classification, slot, block_time
         FROM swaps
         WHERE pool_address = $1 AND swap_side = $2
         ORDER BY block_time DESC NULLS LAST
         LIMIT $3 OFFSET $4`
            : `SELECT signature, wallet, base_amount, quote_amount, price, usd_value,
                swap_side, classification, slot, block_time
         FROM swaps
         WHERE pool_address = $1
         ORDER BY block_time DESC NULLS LAST
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
            total: parseInt(countResult.rows[0].total, 10),
            limit,
            offset,
            side: sideFilter ?? 'all',
            transactions: txResult.rows.map(formatTx),
        });
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /pools/:poolAddress/stats
//  Lightweight stats-only endpoint (for chart headers, etc.)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:poolAddress/stats', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        let stats = await getPoolStats(poolAddress);
        if (!stats) {
            await aggregatePool(poolAddress);
            stats = await getPoolStats(poolAddress);
        }
        if (!stats) {
            return res.status(404).json({ error: `No stats found for pool: ${poolAddress}` });
        }
        return res.json({ poolAddress, stats: formatStats(stats) });
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /pools/:poolAddress/candles
//  Retrieves candle data for charting libraries (like Lightweight Charts).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:poolAddress/candles', async (req, res, next) => {
    try {
        const { poolAddress } = req.params;
        const resolution = req.query.resolution || '5m';
        const limit = parsePositiveInt(req.query.limit, 1000);

        // Fetch data sorted by time bucket (Ascending)
        const result = await db.query(
            `SELECT time_bucket, open_price, high_price, low_price, close_price, volume_usd
             FROM pool_candles
             WHERE pool_address = $1 AND resolution = $2
             ORDER BY time_bucket ASC
             LIMIT $3`,
            [poolAddress, resolution, Math.min(limit, 2000)]
        );

        // Format for Charting Libraries (time must be in Unix Seconds)
        const candles = result.rows.map(row => ({
            time: Math.floor(new Date(row.time_bucket).getTime() / 1000),
            open: Number(row.open_price),
            high: Number(row.high_price),
            low: Number(row.low_price),
            close: Number(row.close_price),
            volume: Number(row.volume_usd)
        }));

        return res.json({
            poolAddress,
            resolution,
            count: candles.length,
            candles
        });
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Formatters — keep API shape consistent
// ─────────────────────────────────────────────────────────────────────────────

function formatPoolSummary(row) {
    return {
        poolAddress: row.pool_address,
        dexName: row.dex_name ?? null,
        baseSymbol: row.base_symbol ?? row.base_symbol_t ?? null,
        quoteSymbol: row.quote_symbol ?? row.quote_symbol_t ?? null,
        baseName: row.base_name ?? null,
        quoteName: row.quote_name ?? null,
        baseLogo: row.base_logo ?? null,
        quoteLogo: row.quote_logo ?? null,
        baseMint: row.base_token_mint,
        quoteMint: row.quote_token_mint,
        price: row.price != null ? Number(row.price) : null,
        priceChange5m: row.price_change_5m != null ? Number(row.price_change_5m) : null,
        priceChange1h: row.price_change_1h != null ? Number(row.price_change_1h) : null,
        priceChange6h: row.price_change_6h != null ? Number(row.price_change_6h) : null,
        priceChange24h: row.price_change_24h != null ? Number(row.price_change_24h) : null,
        volume5m: row.volume_5m != null ? Number(row.volume_5m) : null,
        volume1h: row.volume_1h != null ? Number(row.volume_1h) : null,
        volume6h: row.volume_6h != null ? Number(row.volume_6h) : null,
        volume24h: row.volume_24h != null ? Number(row.volume_24h) : null,
        buyVolume24h: row.buy_volume_24h != null ? Number(row.buy_volume_24h) : null,
        sellVolume24h: row.sell_volume_24h != null ? Number(row.sell_volume_24h) : null,
        buyers24h: Number(row.buyers_24h ?? 0),
        sellers24h: Number(row.sellers_24h ?? 0),
        liquidity: row.liquidity != null ? Number(row.liquidity) : null,
        txCount24h: Number(row.tx_count_24h ?? 0),
        buys24h: Number(row.buys_24h ?? 0),
        sells24h: Number(row.sells_24h ?? 0),
        makers24h: Number(row.makers_24h ?? 0),
        fdv: row.fdv != null ? Number(row.fdv) : null,
        marketCap: row.market_cap != null ? Number(row.market_cap) : null,
        updatedAt: row.updated_at,
    };
}

function formatPoolDetail(row) {
    return {
        poolAddress: row.pool_address,
        dexName: row.dex_name,
        baseMint: row.base_token_mint,
        quoteMint: row.quote_token_mint,
        baseSymbol: row.base_symbol ?? row.base_symbol_t ?? null,
        quoteSymbol: row.quote_symbol ?? row.quote_symbol_t ?? null,
        baseName: row.base_name ?? null,
        quoteName: row.quote_name ?? null,
        baseLogo: row.base_logo ?? null,
        quoteLogo: row.quote_logo ?? null,
        createdAt: row.created_at,
    };
}

function formatStats(stats) {
    if (!stats) return null;
    return {
        price: stats.price != null ? Number(stats.price) : null,
        priceChange5m: stats.price_change_5m != null ? Number(stats.price_change_5m) : null,
        priceChange1h: stats.price_change_1h != null ? Number(stats.price_change_1h) : null,
        priceChange6h: stats.price_change_6h != null ? Number(stats.price_change_6h) : null,
        priceChange24h: stats.price_change_24h != null ? Number(stats.price_change_24h) : null,
        volume5m: stats.volume_5m != null ? Number(stats.volume_5m) : null,
        volume1h: stats.volume_1h != null ? Number(stats.volume_1h) : null,
        volume6h: stats.volume_6h != null ? Number(stats.volume_6h) : null,
        volume24h: stats.volume_24h != null ? Number(stats.volume_24h) : null,
        buyVolume24h: stats.buy_volume_24h != null ? Number(stats.buy_volume_24h) : null,
        sellVolume24h: stats.sell_volume_24h != null ? Number(stats.sell_volume_24h) : null,
        buyers24h: Number(stats.buyers_24h ?? 0),
        sellers24h: Number(stats.sellers_24h ?? 0),
        liquidity: stats.liquidity != null ? Number(stats.liquidity) : null,
        txCount24h: Number(stats.tx_count_24h ?? 0),
        buys24h: Number(stats.buys_24h ?? 0),
        sells24h: Number(stats.sells_24h ?? 0),
        makers24h: Number(stats.makers_24h ?? 0),
        fdv: stats.fdv != null ? Number(stats.fdv) : null,
        marketCap: stats.market_cap != null ? Number(stats.market_cap) : null,
        updatedAt: stats.updated_at,
    };
}

function formatTx(row) {
    return {
        signature: row.signature,
        wallet: row.wallet,
        baseAmount: row.base_amount != null ? Number(row.base_amount) : null,
        quoteAmount: row.quote_amount != null ? Number(row.quote_amount) : null,
        price: row.price != null ? Number(row.price) : null,
        usdValue: row.usd_value != null ? Number(row.usd_value) : null,
        swapSide: row.swap_side,
        classification: row.classification,
        slot: row.slot,
        blockTime: row.block_time,
    };
}

module.exports = router;
'use strict';
/**
 * poolStatsRepository.js
 * Database operations for the `pool_stats` table.
 *
 * pool_stats is a materialised summary table — one row per pool.
 * Updated by the aggregation service, read by the API layer.
 * Frontend reads ONLY this table for listings — never raw swaps.
 *
 * Schema (see schema.sql):
 *   pool_stats(pool_address PK, price, price_change_24h, volume_24h,
 *              volume_6h, volume_1h, liquidity, tx_count_24h,
 *              buys_24h, sells_24h, makers_24h, updated_at)
 */

const db = require('../config/db');

/**
 * Upsert aggregated stats for a pool.
 *
 * @param {Object} stats
 * @param {string}      stats.poolAddress
 * @param {number|null} stats.price
 * @param {number|null} stats.priceChange24h   percent, e.g. 3.4 = +3.4%
 * @param {number|null} stats.volume24h
 * @param {number|null} stats.volume6h
 * @param {number|null} stats.volume1h
 * @param {number|null} stats.liquidity
 * @param {number}      stats.txCount24h
 * @param {number}      stats.buys24h
 * @param {number}      stats.sells24h
 * @param {number}      stats.makers24h
 * @returns {Promise<Object>}
 */
async function upsertPoolStats({
    poolAddress,
    price = null,
    priceChange24h = null,
    volume24h = null,
    volume6h = null,
    volume1h = null,
    liquidity = null,
    txCount24h = 0,
    buys24h = 0,
    sells24h = 0,
    makers24h = 0,
}) {
    const r = await db.query(
        `INSERT INTO pool_stats
       (pool_address, price, price_change_24h,
        volume_24h, volume_6h, volume_1h,
        liquidity, tx_count_24h, buys_24h, sells_24h, makers_24h,
        updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
     ON CONFLICT (pool_address) DO UPDATE SET
       price           = EXCLUDED.price,
       price_change_24h= EXCLUDED.price_change_24h,
       volume_24h      = EXCLUDED.volume_24h,
       volume_6h       = EXCLUDED.volume_6h,
       volume_1h       = EXCLUDED.volume_1h,
       liquidity       = EXCLUDED.liquidity,
       tx_count_24h    = EXCLUDED.tx_count_24h,
       buys_24h        = EXCLUDED.buys_24h,
       sells_24h       = EXCLUDED.sells_24h,
       makers_24h      = EXCLUDED.makers_24h,
       updated_at      = NOW()
     RETURNING *`,
        [poolAddress, price, priceChange24h,
            volume24h, volume6h, volume1h,
            liquidity, txCount24h, buys24h, sells24h, makers24h]
    );
    return r.rows[0];
}

/**
 * Get stats for a single pool.
 * @param {string} poolAddress
 * @returns {Promise<Object|null>}
 */
async function getPoolStats(poolAddress) {
    const r = await db.query(
        'SELECT * FROM pool_stats WHERE pool_address = $1 LIMIT 1',
        [poolAddress]
    );
    return r.rows[0] ?? null;
}

/**
 * Get stats for all pools belonging to a DEX, ordered by 24h volume.
 * @param {number} dexId
 * @param {number} limit   max rows to return (default 100)
 * @param {number} offset  pagination offset (default 0)
 * @returns {Promise<Object[]>}
 */
async function getPoolStatsByDex(dexId, limit = 100, offset = 0) {
    const r = await db.query(
        `SELECT
       ps.*,
       p.base_token_mint,
       p.quote_token_mint,
       p.base_symbol,
       p.quote_symbol,
       bt.name       AS base_name,
       bt.logo_url   AS base_logo,
       qt.name       AS quote_name,
       qt.logo_url   AS quote_logo
     FROM pool_stats ps
     JOIN pools p  ON p.pool_address = ps.pool_address
     LEFT JOIN tokens bt ON bt.mint  = p.base_token_mint
     LEFT JOIN tokens qt ON qt.mint  = p.quote_token_mint
     WHERE p.dex_id = $1
     ORDER BY ps.volume_24h DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
        [dexId, limit, offset]
    );
    return r.rows;
}

module.exports = { upsertPoolStats, getPoolStats, getPoolStatsByDex };
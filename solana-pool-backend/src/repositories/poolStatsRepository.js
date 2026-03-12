'use strict';
/**
 * poolStatsRepository.js
 * Database operations for the `pool_stats` table.
 */

const db = require('../config/db');

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
       price            = EXCLUDED.price,
       price_change_24h = EXCLUDED.price_change_24h,
       volume_24h       = EXCLUDED.volume_24h,
       volume_6h        = EXCLUDED.volume_6h,
       volume_1h        = EXCLUDED.volume_1h,
       liquidity        = EXCLUDED.liquidity,
       tx_count_24h     = EXCLUDED.tx_count_24h,
       buys_24h         = EXCLUDED.buys_24h,
       sells_24h        = EXCLUDED.sells_24h,
       makers_24h       = EXCLUDED.makers_24h,
       updated_at       = NOW()
     RETURNING *`,
        [poolAddress, price, priceChange24h,
            volume24h, volume6h, volume1h,
            liquidity, txCount24h, buys24h, sells24h, makers24h]
    );
    return r.rows[0];
}

async function getPoolStats(poolAddress) {
    const r = await db.query(
        'SELECT * FROM pool_stats WHERE pool_address = $1 LIMIT 1',
        [poolAddress]
    );
    return r.rows[0] ?? null;
}

async function getPoolStatsByDex(dexId, limit = 100, offset = 0) {
    const r = await db.query(
        `SELECT
       ps.*,
       p.base_token_mint,
       p.quote_token_mint,
       p.base_symbol,
       p.quote_symbol,
       d.name        AS dex_name,
       bt.symbol     AS base_symbol_t,
       bt.name       AS base_name,
       bt.logo_url   AS base_logo,
       qt.symbol     AS quote_symbol_t,
       qt.name       AS quote_name,
       qt.logo_url   AS quote_logo
     FROM pool_stats ps
     JOIN pools  p  ON p.pool_address = ps.pool_address
     JOIN dexes  d  ON d.id           = p.dex_id
     LEFT JOIN tokens bt ON bt.mint   = p.base_token_mint
     LEFT JOIN tokens qt ON qt.mint   = p.quote_token_mint
     WHERE p.dex_id = $1
     ORDER BY ps.volume_24h DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
        [dexId, limit, offset]
    );
    return r.rows;
}

module.exports = { upsertPoolStats, getPoolStats, getPoolStatsByDex };
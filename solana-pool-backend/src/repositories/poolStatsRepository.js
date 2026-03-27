'use strict';
/**
 * poolStatsRepository.js — SIMPLIFIED v2
 * Only handles 24h metrics as requested.
 */

const db = require('../config/db');

async function upsertPoolStats(data) {
    if (!data.poolAddress) return null;

    // Convert camelCase to snake_case for PostgreSQL
    const toSnake = (s) => s.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

    const keys = Object.keys(data);
    const columns = keys.map(toSnake);
    
    // Create placeholders ($1, $2...)
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    // Add updated_at
    columns.push('updated_at');
    placeholders.push('NOW()');

    const updateSet = columns
        .filter(c => c !== 'pool_address' && c !== 'updated_at')
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');

    const query = `
        INSERT INTO pool_stats (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        ON CONFLICT (pool_address) DO UPDATE SET
        ${updateSet},
        updated_at = NOW()
        RETURNING *
    `;

    try {
        const r = await db.query(query, values);
        return r.rows[0];
    } catch (err) {
        console.error('[Repository] upsertPoolStats error:', err.message, '\nQuery:', query);
        throw err;
    }
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
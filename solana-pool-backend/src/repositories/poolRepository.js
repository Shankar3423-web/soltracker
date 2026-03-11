'use strict';
/**
 * poolRepository.js
 * Database operations for the `pools` table.
 *
 * Schema expected:
 *   CREATE TABLE pools (
 *     id               SERIAL PRIMARY KEY,
 *     pool_address     VARCHAR(88)  NOT NULL UNIQUE,
 *     dex_id           INTEGER      NOT NULL REFERENCES dexes(id),
 *     base_token_mint  VARCHAR(88)  NOT NULL,
 *     quote_token_mint VARCHAR(88)  NOT NULL,
 *     base_symbol      VARCHAR(20),
 *     quote_symbol     VARCHAR(20),
 *     created_at       TIMESTAMP    DEFAULT NOW()
 *   );
 */

const db = require('../config/db');

/**
 * Upsert a pool record and return the full row.
 * If the pool already exists, updates dex_id and mint addresses in case they
 * were previously inserted with incorrect data.
 *
 * @param {Object}  params
 * @param {string}  params.poolAddress
 * @param {number}  params.dexId
 * @param {string}  params.baseMint
 * @param {string}  params.quoteMint
 * @param {string|null} params.baseSymbol
 * @param {string|null} params.quoteSymbol
 * @returns {Promise<Object>}  Full pool row
 */
async function getOrCreatePool({
    poolAddress,
    dexId,
    baseMint,
    quoteMint,
    baseSymbol = null,
    quoteSymbol = null,
}) {
    const result = await db.query(
        `INSERT INTO pools
       (pool_address, dex_id, base_token_mint, quote_token_mint, base_symbol, quote_symbol)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (pool_address) DO UPDATE
       SET dex_id           = EXCLUDED.dex_id,
           base_token_mint  = EXCLUDED.base_token_mint,
           quote_token_mint = EXCLUDED.quote_token_mint
     RETURNING *`,
        [poolAddress, dexId, baseMint, quoteMint, baseSymbol, quoteSymbol]
    );
    return result.rows[0];
}

/**
 * Find a pool by its on-chain address.
 *
 * @param {string} poolAddress
 * @returns {Promise<Object|null>}
 */
async function findPool(poolAddress) {
    const result = await db.query(
        'SELECT * FROM pools WHERE pool_address = $1 LIMIT 1',
        [poolAddress]
    );
    return result.rows[0] ?? null;
}

module.exports = { getOrCreatePool, findPool };
'use strict';
/**
 * dexRepository.js
 * Database operations for the `dexes` table.
 *
 * Schema expected:
 *   CREATE TABLE dexes (
 *     id   SERIAL PRIMARY KEY,
 *     name VARCHAR(100) NOT NULL UNIQUE
 *   );
 */

const pool = require('../config/db');

/**
 * Upsert a DEX by name and return its id.
 * Uses ON CONFLICT DO UPDATE to handle concurrent inserts safely.
 *
 * @param {string} name  DEX human-readable name (e.g. "Raydium AMM")
 * @returns {Promise<number>}  dex.id
 */
async function getOrCreateDex(name) {
    const result = await pool.query(
        `INSERT INTO dexes (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
        [name]
    );
    return result.rows[0].id;
}

/**
 * Find a DEX by name.
 *
 * @param {string} name
 * @returns {Promise<Object|null>}
 */
async function findDexByName(name) {
    const result = await pool.query(
        'SELECT * FROM dexes WHERE name = $1 LIMIT 1',
        [name]
    );
    return result.rows[0] ?? null;
}

module.exports = { getOrCreateDex, findDexByName };
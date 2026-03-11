'use strict';
/**
 * tokenRepository.js
 * Database operations for the `tokens` table.
 *
 * Schema (see schema.sql):
 *   tokens(mint PK, symbol, name, decimals, logo_url, created_at)
 */

const db = require('../config/db');

/**
 * Find a token by mint address.
 * @param {string} mint
 * @returns {Promise<Object|null>}
 */
async function findToken(mint) {
    const r = await db.query('SELECT * FROM tokens WHERE mint = $1 LIMIT 1', [mint]);
    return r.rows[0] ?? null;
}

/**
 * Upsert a token record.
 * If the mint already exists, update symbol/name/logo if they were null before
 * (never overwrite a good value with null).
 *
 * @param {Object} params
 * @param {string}      params.mint
 * @param {string|null} params.symbol
 * @param {string|null} params.name
 * @param {number|null} params.decimals
 * @param {string|null} params.logoUrl
 * @returns {Promise<Object>} full token row
 */
async function upsertToken({ mint, symbol = null, name = null, decimals = null, logoUrl = null }) {
    const r = await db.query(
        `INSERT INTO tokens (mint, symbol, name, decimals, logo_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mint) DO UPDATE SET
       symbol   = COALESCE(EXCLUDED.symbol,   tokens.symbol),
       name     = COALESCE(EXCLUDED.name,     tokens.name),
       decimals = COALESCE(EXCLUDED.decimals, tokens.decimals),
       logo_url = COALESCE(EXCLUDED.logo_url, tokens.logo_url)
     RETURNING *`,
        [mint, symbol, name, decimals, logoUrl]
    );
    return r.rows[0];
}

module.exports = { findToken, upsertToken };
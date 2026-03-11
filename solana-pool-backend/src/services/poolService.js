'use strict';
/**
 * poolService.js
 * Orchestrates auto-creation of DEX and Pool records when a new pool is
 * first encountered during swap decoding.
 *
 * Flow:
 *   1. getOrCreateDex(dexName)   → dex_id  (upsert on name)
 *   2. getOrCreatePool({...})    → pool row (upsert on pool_address)
 */

const { getOrCreateDex } = require('../repositories/dexRepository');
const { getOrCreatePool } = require('../repositories/poolRepository');

/**
 * Ensure both the DEX and Pool records exist in the database.
 * Safe to call on every decoded swap — idempotent via ON CONFLICT upserts.
 *
 * @param {Object} params
 * @param {string} params.dexName
 * @param {string} params.poolAddress
 * @param {string} params.baseMint
 * @param {string} params.quoteMint
 * @returns {Promise<{ dexId: number, pool: Object }>}
 */
async function ensurePoolExists({ dexName, poolAddress, baseMint, quoteMint }) {
    const dexId = await getOrCreateDex(dexName);
    const pool = await getOrCreatePool({
        poolAddress,
        dexId,
        baseMint,
        quoteMint,
        baseSymbol: null,   // enriched later by a metadata job
        quoteSymbol: null,
    });
    return { dexId, pool };
}

module.exports = { ensurePoolExists };
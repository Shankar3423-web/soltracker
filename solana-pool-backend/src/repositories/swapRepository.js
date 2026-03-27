'use strict';
/**
 * swapRepository.js
 * Database operations for the `swaps` table.
 *
 * Schema expected:
 *   CREATE TABLE swaps (
 *     id             SERIAL PRIMARY KEY,
 *     signature      VARCHAR(128) NOT NULL,
 *     pool_address   VARCHAR(88)  NOT NULL,
 *     dex_id         INTEGER      NOT NULL REFERENCES dexes(id),
 *     wallet         VARCHAR(88),
 *     base_amount    NUMERIC(30, 12),
 *     quote_amount   NUMERIC(30, 12),
 *     price          NUMERIC(30, 12),
 *     usd_value      NUMERIC(20, 6),
 *     swap_side      VARCHAR(4)   NOT NULL CHECK (swap_side IN ('buy','sell')),
 *     classification VARCHAR(20)  NOT NULL,
 *     slot           BIGINT,
 *     block_time     TIMESTAMP,
 *     created_at     TIMESTAMP    DEFAULT NOW(),
 *     UNIQUE (signature, pool_address)
 *   );
 */

const db = require('../config/db');
const { roundDecimal } = require('../utils/helpers');

/**
 * Insert a decoded swap event into the swaps table.
 *
 * Duplicate rows (same signature + pool_address) are silently ignored via
 * ON CONFLICT DO NOTHING — safe to call the decode endpoint multiple times.
 *
 * All NUMERIC fields are rounded to 12 decimal places before insertion to
 * eliminate IEEE-754 floating-point noise (e.g. 0.924836123999999 → 0.924836124).
 *
 * @param {Object}      swap
 * @param {string}      swap.signature
 * @param {string}      swap.poolAddress
 * @param {number}      swap.dexId
 * @param {string|null} swap.wallet
 * @param {number}      swap.baseAmount
 * @param {number}      swap.quoteAmount
 * @param {number|null} swap.price
 * @param {number|null} swap.usdValue
 * @param {string}      swap.swapSide       'buy' | 'sell'
 * @param {string}      swap.classification  'simple' | 'multi-hop'
 * @param {number}      swap.slot
 * @param {Date}        swap.blockTime
 * @returns {Promise<Object|null>}  Inserted row, or null if duplicate
 */
async function insertSwap({
    signature,
    poolAddress,
    dexId,
    wallet,
    baseAmount,
    quoteAmount,
    price,
    usdValue,
    priceUsd = null,
    priceSol = null,
    swapSide,
    classification,
    slot,
    blockTime,
}) {
    const result = await db.query(
        `INSERT INTO swaps
       (signature, pool_address, dex_id, wallet,
        base_amount, quote_amount, price, usd_value,
        price_usd, price_sol,
        swap_side, classification, slot, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (signature, pool_address) DO NOTHING
     RETURNING *`,
        [
            signature,
            poolAddress,
            dexId,
            wallet ?? null,
            roundDecimal(baseAmount),
            roundDecimal(quoteAmount),
            roundDecimal(price),
            roundDecimal(usdValue, 6),
            roundDecimal(priceUsd),
            roundDecimal(priceSol),
            swapSide,
            classification,
            slot ?? null,
            blockTime ?? null,
        ]
    );
    return result.rows[0] ?? null;
}

/**
 * Check if a swap already exists (deduplication helper).
 *
 * @param {string} signature
 * @param {string} poolAddress
 * @returns {Promise<boolean>}
 */
async function swapExists(signature, poolAddress) {
    const result = await db.query(
        'SELECT 1 FROM swaps WHERE signature = $1 AND pool_address = $2 LIMIT 1',
        [signature, poolAddress]
    );
    return result.rows.length > 0;
}

module.exports = { insertSwap, swapExists };
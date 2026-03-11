'use strict';
/**
 * helpers.js
 * Shared utility functions across the entire backend.
 */

/**
 * Safely divide numerator by denominator.
 * Returns null (not NaN, not Infinity) when denominator is 0 or falsy.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number|null}
 */
function safeDivide(numerator, denominator) {
    if (denominator == null || denominator === 0) return null;
    return numerator / denominator;
}

/**
 * Convert a Unix timestamp (seconds) to a JavaScript Date object.
 * Postgres TIMESTAMP columns accept JS Date objects directly via node-pg.
 *
 * @param {number} blockTime - Unix timestamp in seconds
 * @returns {Date}
 */
function unixToDate(blockTime) {
    return new Date(blockTime * 1000);
}

/**
 * Convert a raw on-chain integer token amount to its human-readable decimal.
 * e.g. rawAmount=1_000_000, decimals=6 → 1.0
 *
 * @param {number|string} rawAmount
 * @param {number} decimals
 * @returns {number}
 */
function toDecimal(rawAmount, decimals = 0) {
    if (rawAmount == null) return 0;
    return Number(rawAmount) / Math.pow(10, decimals);
}

/**
 * Round a number to N decimal places to eliminate IEEE-754 floating-point noise.
 * Used at the DB boundary (swapRepository) before inserting NUMERIC columns.
 *
 * @param {number|null} value
 * @param {number} places - default 12
 * @returns {number|null}
 */
function roundDecimal(value, places = 12) {
    if (value == null) return null;
    return Number(Number(value).toFixed(places));
}

/**
 * Return true only if value is a non-empty array.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

module.exports = {
    safeDivide,
    unixToDate,
    toDecimal,
    roundDecimal,
    isNonEmptyArray,
};
'use strict';
/**
 * priceService.js
 * Calculates USD value for each decoded swap.
 *
 * Strategy:
 *   1. Quote token is a stablecoin  → usdValue = quoteAmount      (1:1)
 *   2. Quote token is wSOL          → usdValue = quoteAmount × SOL/USD price
 *   3. Unknown quote token          → usdValue = null  (cannot price without oracle)
 *
 * The getSolPrice() function uses CoinGecko by default with a hardcoded
 * $150 fallback if the fetch fails or the env var SOL_PRICE_USD is set.
 * Replace with Pyth on-chain oracle in production for lower latency.
 */

const axios = require('axios');
const { STABLECOIN_MINTS, WSOL_MINT } = require('../config/constants');

// Simple in-memory cache — refresh every 60 seconds to avoid hammering CoinGecko
let _cachedSolPrice = null;
let _cacheLastFetched = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch the current SOL/USD price.
 * Uses the SOL_PRICE_USD env var if set (useful for testing).
 * Falls back to $150 if the fetch fails.
 *
 * @returns {Promise<number>}
 */
async function getSolPrice() {
    // Allow hardcoded override for testing / staging
    if (process.env.SOL_PRICE_USD) {
        return parseFloat(process.env.SOL_PRICE_USD);
    }

    const now = Date.now();
    if (_cachedSolPrice !== null && (now - _cacheLastFetched) < CACHE_TTL_MS) {
        return _cachedSolPrice;
    }

    try {
        const res = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
            { timeout: 5000 }
        );
        const price = res.data?.solana?.usd;
        if (price && typeof price === 'number') {
            _cachedSolPrice = price;
            _cacheLastFetched = now;
            return price;
        }
    } catch (err) {
        console.warn('[Price] CoinGecko fetch failed, using fallback:', err.message);
    }

    // Fallback — prevents total failure if CoinGecko is down
    return _cachedSolPrice ?? 150.0;
}

/**
 * Calculate the USD value of a swap event.
 *
 * @param {number}      quoteAmount  Human-readable quote token amount
 * @param {string}      quoteMint    Mint address of the quote token
 * @returns {Promise<number|null>}   USD value, or null if cannot be determined
 */
async function calculateUsdValue(quoteAmount, quoteMint) {
    if (quoteAmount == null || !quoteMint) return null;

    // Case 1: Stablecoin — 1 unit = $1 USD
    if (STABLECOIN_MINTS.has(quoteMint)) {
        return quoteAmount;
    }

    // Case 2: Wrapped SOL
    if (quoteMint === WSOL_MINT) {
        const solUsd = await getSolPrice();
        return quoteAmount * solUsd;
    }

    // Case 3: Unknown token — cannot price without a dedicated oracle
    return null;
}

module.exports = { calculateUsdValue, getSolPrice };
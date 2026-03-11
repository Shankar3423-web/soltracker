'use strict';
/**
 * liquidityService.js
 * Fetches on-chain pool reserve balances via Helius RPC getMultipleAccounts,
 * then calculates USD liquidity for each pool.
 *
 * Why we cannot derive liquidity from swaps:
 *   Swaps show FLOW (what moved in/out). Liquidity is the CURRENT RESERVE
 *   sitting in the pool's vault accounts right now.
 *   You must query getTokenAccountBalance or getMultipleAccounts for the
 *   pool's vault pubkeys to get the true reserve.
 *
 * How we find vault pubkeys:
 *   The pools table stores base_token_mint and quote_token_mint.
 *   We query the swaps table's inner transfer data — specifically, the
 *   token accounts that received/sent the largest amounts to/from the pool.
 *   Alternatively, most DEXes follow a derivable PDA pattern but that requires
 *   DEX-specific logic.  The approach here is universal: look at recent swaps
 *   and extract vault pubkeys from the on-chain token balance entries.
 *
 * For now, we use getTokenAccountsByOwner with the pool_address as owner
 * to find its vault ATAs, then sum their balances.
 *
 * Limitations:
 *   • CLMMs (Raydium CLMM, Orca Whirlpool) use multiple tick-array accounts —
 *     their total liquidity is harder to compute from balances alone.
 *     We fall back to summing vault balances for an approximation.
 *   • Meteora DLMM bins cannot be summed this way — approximation only.
 */

const axios = require('axios');
const { getSolPrice } = require('./priceService');
const { upsertPoolStats } = require('../repositories/poolStatsRepository');
const { WSOL_MINT, STABLECOIN_MINTS } = require('../config/constants');

/**
 * Fetch the token account balance for a given token account pubkey.
 *
 * @param {string} tokenAccountPubkey
 * @returns {Promise<{uiAmount: number, mint: string}|null>}
 */
async function getTokenAccountBalance(tokenAccountPubkey) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) return null;

    try {
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountBalance',
            params: [tokenAccountPubkey, { commitment: 'confirmed' }],
        }, { timeout: 8000 });

        const val = res.data?.result?.value;
        if (!val) return null;
        return {
            uiAmount: parseFloat(val.uiAmount ?? 0),
            decimals: val.decimals ?? 0,
        };
    } catch {
        return null;
    }
}

/**
 * Fetch all token accounts owned by a given pubkey (the pool address).
 * Returns an array of { pubkey, mint, uiAmount }.
 *
 * @param {string} ownerPubkey   — pool address
 * @returns {Promise<Array>}
 */
async function getTokenAccountsByOwner(ownerPubkey) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) return [];

    // Must query BOTH token programs.
    // Pump.fun AMM meme tokens use Token-2022 (TokenzQd...), not classic Tokenkeg.
    // Querying only Tokenkeg returns 0 vault accounts for those pools → liquidity = null.
    const TOKEN_PROGRAMS = [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token (classic)
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',   // Token-2022 (Pump.fun AMM meme tokens)
    ];

    const seen = new Set();
    const results = [];

    for (const programId of TOKEN_PROGRAMS) {
        try {
            const res = await axios.post(rpcUrl, {
                jsonrpc: '2.0',
                id: 1,
                method: 'getTokenAccountsByOwner',
                params: [
                    ownerPubkey,
                    { programId },
                    { encoding: 'jsonParsed', commitment: 'confirmed' },
                ],
            }, { timeout: 10000 });

            const accounts = res.data?.result?.value ?? [];
            for (const a of accounts) {
                const pubkey = a.pubkey;
                const mint = a.account?.data?.parsed?.info?.mint;
                const uiAmount = parseFloat(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
                if (mint && uiAmount > 0 && !seen.has(pubkey)) {
                    seen.add(pubkey);
                    results.push({ pubkey, mint, uiAmount });
                }
            }
        } catch {
            // one program failing does not block the other
        }
    }

    return results;
}

/**
 * Calculate USD liquidity for a single pool.
 *
 * Algorithm:
 *   1. Fetch all token accounts owned by poolAddress (its vault ATAs)
 *   2. Identify base and quote vaults by mint
 *   3. Price each vault:
 *        quote (SOL)        → uiAmount × SOL/USD
 *        quote (stablecoin) → uiAmount × 1
 *        base (project token) → priced via quote ratio from latest swap price
 *   4. Sum both vaults
 *
 * @param {string} poolAddress
 * @param {string} baseMint
 * @param {string} quoteMint
 * @param {number|null} latestPrice   quote/base ratio from pool_stats.price
 * @returns {Promise<number|null>}    USD liquidity value, or null if cannot compute
 */
async function calculateLiquidity(poolAddress, baseMint, quoteMint, latestPrice) {
    try {
        const vaults = await getTokenAccountsByOwner(poolAddress);
        if (vaults.length === 0) return null;

        const baseVault = vaults.find(v => v.mint === baseMint);
        const quoteVault = vaults.find(v => v.mint === quoteMint);

        if (!baseVault && !quoteVault) return null;

        let liquidity = 0;
        const solPrice = await getSolPrice();

        // Price the quote vault (SOL or stablecoin)
        if (quoteVault) {
            if (quoteMint === WSOL_MINT) {
                liquidity += quoteVault.uiAmount * solPrice;
            } else if (STABLECOIN_MINTS.has(quoteMint)) {
                liquidity += quoteVault.uiAmount;  // 1:1 USD
            }
            // For unknown quote token, skip (can't price without oracle)
        }

        // Price the base vault using the latest swap price (quote per base)
        if (baseVault && latestPrice && latestPrice > 0) {
            const baseInQuote = baseVault.uiAmount * latestPrice;
            if (quoteMint === WSOL_MINT) {
                liquidity += baseInQuote * solPrice;
            } else if (STABLECOIN_MINTS.has(quoteMint)) {
                liquidity += baseInQuote;
            }
        }

        return liquidity > 0 ? liquidity : null;
    } catch (err) {
        console.warn(`[Liquidity] calculateLiquidity(${poolAddress}) error:`, err.message);
        return null;
    }
}

/**
 * Refresh liquidity for all pools that have stats but no liquidity value,
 * or whose liquidity was last updated > 5 minutes ago.
 * Called by the background scheduler.
 *
 * @returns {Promise<number>} pools updated
 */
async function refreshAllLiquidity() {
    const db = require('../config/db');
    let updated = 0;

    try {
        // Get pools needing a liquidity refresh
        const result = await db.query(`
      SELECT
        ps.pool_address,
        ps.price,
        p.base_token_mint,
        p.quote_token_mint
      FROM pool_stats ps
      JOIN pools p ON p.pool_address = ps.pool_address
      WHERE ps.liquidity IS NULL
         OR ps.updated_at < NOW() - INTERVAL '5 minutes'
      ORDER BY ps.volume_24h DESC NULLS LAST
      LIMIT 50
    `);

        for (const row of result.rows) {
            const liq = await calculateLiquidity(
                row.pool_address,
                row.base_token_mint,
                row.quote_token_mint,
                row.price ? Number(row.price) : null
            );

            if (liq !== null) {
                await db.query(
                    'UPDATE pool_stats SET liquidity = $1, updated_at = NOW() WHERE pool_address = $2',
                    [liq, row.pool_address]
                );
                updated++;
            }
        }

        console.log(`[Liquidity] Refreshed ${updated} pool(s)`);
    } catch (err) {
        console.error('[Liquidity] refreshAllLiquidity failed:', err.message);
    }

    return updated;
}

module.exports = { calculateLiquidity, refreshAllLiquidity, getTokenAccountsByOwner };
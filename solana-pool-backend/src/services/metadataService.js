'use strict';
/**
 * metadataService.js
 * Fetches token metadata (symbol, name, decimals, logo) for a given mint.
 *
 * Strategy (in order):
 *   1. Jupiter token list API  — covers most major tokens instantly
 *   2. Helius DAS API          — covers Metaplex NFT/fungible metadata
 *   3. Graceful fallback       — store mint-only row so we never block decoding
 *
 * This service is called from ensureTokenExists() which is called from
 * the decode pipeline AFTER swap storage — it NEVER blocks or breaks decoding.
 *
 * Cache: in-memory per-process.  Prevents re-fetching the same mint
 * on every new swap for the same pool (very common for popular tokens).
 */

const axios = require('axios');
const { upsertToken, findToken } = require('../repositories/tokenRepository');

// In-memory set of mints we have already fetched this process lifetime.
// On restart, DB already has the data so the first DB check short-circuits.
const _fetched = new Set();

// NOTE: Jupiter all-token list (~500K tokens, 200-300MB RAM) is intentionally
// NOT loaded into memory to stay within Render's 512MB limit.
// Token lookup falls through: DB cache -> Helius DAS -> fallback insert.

/**
 * Fetch metadata for a single mint via Helius DAS getAsset.
 * Returns null if not found or on error.
 *
 * @param {string} mint
 * @returns {Promise<{symbol,name,decimals,logoUrl}|null>}
 */
async function fetchFromHelius(mint) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) return null;

    try {
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            id: 'meta',
            method: 'getAsset',
            params: { id: mint },
        }, {
            timeout: 8000,
            proxy: false,
        });

        const asset = res.data?.result;
        if (!asset) return null;

        const symbol = asset.content?.metadata?.symbol ?? null;
        const name = asset.content?.metadata?.name ?? null;
        const decimals = asset.token_info?.decimals ?? null;
        const logoUrl = asset.content?.links?.image
            ?? asset.content?.files?.[0]?.uri
            ?? null;

        return { symbol, name, decimals, logoUrl };
    } catch {
        return null;
    }
}

/**
 * Ensure a token exists in the tokens table.
 * Called during the decode pipeline for each baseMint and quoteMint.
 *
 * Execution flow:
 *   1. Already fetched this session?  → skip (DB already has it)
 *   2. Already in DB?                 → mark fetched, update symbols on pools
 *   3. Try Jupiter list               → fast, covers 95% of tokens
 *   4. Try Helius DAS                 → covers new / obscure tokens
 *   5. Insert mint-only row           → never blocks decoding
 *
 * @param {string} mint
 * @returns {Promise<void>}
 */
async function ensureTokenExists(mint) {
    if (!mint || _fetched.has(mint)) return;
    _fetched.add(mint);

    try {
        // Check DB first — may already exist from a previous decode run
        const existing = await findToken(mint);
        if (existing?.symbol) return;   // already fully enriched

        let meta = null;

        // Fetch from Helius DAS (Jupiter list removed to save 200-300MB RAM)
        const heliusMeta = await fetchFromHelius(mint);
        if (heliusMeta) meta = heliusMeta;

        // Upsert whatever we found (even null fields — COALESCE keeps existing values)
        await upsertToken({
            mint,
            symbol: meta?.symbol ?? null,
            name: meta?.name ?? null,
            decimals: meta?.decimals ?? null,
            logoUrl: meta?.logoUrl ?? null,
        });

        console.log(`[Metadata] Token stored: ${mint.slice(0, 8)}... → ${meta?.symbol ?? 'unknown'}`);
    } catch (err) {
        // NEVER throw — metadata failure must not break swap storage
        console.warn(`[Metadata] ensureTokenExists failed for ${mint}:`, err.message);
    }
}

/**
 * Backfill symbols into the pools table after token metadata is available.
 * Called after ensureTokenExists() for both baseMint and quoteMint.
 *
 * @param {string} poolAddress
 * @param {string} baseMint
 * @param {string} quoteMint
 * @returns {Promise<void>}
 */
async function enrichPoolSymbols(poolAddress, baseMint, quoteMint) {
    try {
        const db = require('../config/db');
        await db.query(
            `UPDATE pools p
       SET
         base_symbol  = COALESCE(p.base_symbol,  bt.symbol),
         quote_symbol = COALESCE(p.quote_symbol, qt.symbol)
       FROM
         tokens bt,
         tokens qt
       WHERE
         p.pool_address   = $1
         AND bt.mint      = $2
         AND qt.mint      = $3
         AND (p.base_symbol IS NULL OR p.quote_symbol IS NULL)`,
            [poolAddress, baseMint, quoteMint]
        );
    } catch (err) {
        console.warn(`[Metadata] enrichPoolSymbols failed for ${poolAddress}:`, err.message);
    }
}

/**
 * Fetch the total on-chain supply of a token for Market Cap / FDV.
 * Uses the Solana RPC getTokenSupply method.
 *
 * @param {string} mint
 * @returns {Promise<number|null>}  Human-readable total supply
 */
async function getTokenSupply(mint) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl || !mint) return null;

    try {
        const res = await axios.post(rpcUrl, {
            jsonrpc: '2.0',
            id: 'supply',
            method: 'getTokenSupply',
            params: [mint],
        }, {
            timeout: 8000,
            proxy: false,
        });
        const amount = res.data?.result?.value?.uiAmount;
        if (typeof amount === 'number') return amount;
        // Fallback for Pump.fun tokens: 1B supply is standard
        if (mint.toLowerCase().endsWith('pump')) return 1000000000;
        return null;
    } catch {
        if (mint.toLowerCase().endsWith('pump')) return 1000000000;
        return null;
    }
}

module.exports = { ensureTokenExists, enrichPoolSymbols, getTokenSupply };

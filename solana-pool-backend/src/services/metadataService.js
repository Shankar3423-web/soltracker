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

// Jupiter token list (cached in memory, fetched once per process)
let _jupiterList = null;
let _jupiterFetched = false;

/**
 * Load (or return cached) Jupiter all-token list.
 * Returns a Map<mint → { symbol, name, decimals, logoURI }>
 * Returns empty Map on failure — never throws.
 */
async function getJupiterList() {
    if (_jupiterFetched) return _jupiterList ?? new Map();
    _jupiterFetched = true;
    try {
        const res = await axios.get('https://token.jup.ag/all', { timeout: 10000 });
        const list = res.data;
        if (!Array.isArray(list)) return new Map();
        _jupiterList = new Map(list.map(t => [t.address, t]));
        console.log(`[Metadata] Jupiter list loaded: ${_jupiterList.size} tokens`);
        return _jupiterList;
    } catch (err) {
        console.warn('[Metadata] Jupiter list fetch failed:', err.message);
        return new Map();
    }
}

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
        }, { timeout: 8000 });

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

        // Try Jupiter (fast, cached in memory after first call)
        const jupList = await getJupiterList();
        const jupToken = jupList.get(mint);
        if (jupToken) {
            meta = {
                symbol: jupToken.symbol ?? null,
                name: jupToken.name ?? null,
                decimals: jupToken.decimals ?? null,
                logoUrl: jupToken.logoURI ?? null,
            };
        }

        // Fallback to Helius DAS if Jupiter didn't have it
        if (!meta || !meta.symbol) {
            const heliusMeta = await fetchFromHelius(mint);
            if (heliusMeta) meta = heliusMeta;
        }

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

module.exports = { ensureTokenExists, enrichPoolSymbols };
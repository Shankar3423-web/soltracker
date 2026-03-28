'use strict';

const axios = require('axios');
const db = require('../config/db');
const { getTokenUsdPrice } = require('./priceService');
const { safeDivide } = require('../utils/helpers');

let liquidityRpcBackoffUntil = 0;
let lastLiquidity429LogAt = 0;
const LIQUIDITY_RPC_BACKOFF_MS = 2 * 60_000;
const LIQUIDITY_LOG_THROTTLE_MS = 60_000;

function isLiquidityRateLimited() {
    return Date.now() < liquidityRpcBackoffUntil;
}

async function getTokenAccountsByOwner(ownerPubkey) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) return [];
    if (isLiquidityRateLimited()) return [];

    const tokenPrograms = [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    ];

    const seen = new Set();
    const accounts = [];

    for (const programId of tokenPrograms) {
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
            }, {
                timeout: 10000,
                proxy: false,
            });

            for (const item of (res.data?.result?.value ?? [])) {
                if (seen.has(item.pubkey)) continue;
                const mint = item.account?.data?.parsed?.info?.mint;
                const uiAmount = parseFloat(item.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
                if (!mint) continue;
                seen.add(item.pubkey);
                accounts.push({
                    pubkey: item.pubkey,
                    mint,
                    uiAmount,
                });
            }
        } catch (err) {
            if (err.response?.status === 429) {
                liquidityRpcBackoffUntil = Date.now() + LIQUIDITY_RPC_BACKOFF_MS;
                if ((Date.now() - lastLiquidity429LogAt) > LIQUIDITY_LOG_THROTTLE_MS) {
                    lastLiquidity429LogAt = Date.now();
                    console.warn('[Liquidity] Helius RPC rate limited liquidity refresh. Backing off for 2 minutes.');
                }
                return [];
            }

            console.warn(`[Liquidity] getTokenAccountsByOwner failed for ${ownerPubkey}:`, err.message);
        }
    }

    return accounts;
}

async function calculateLiquidity(poolAddress, baseMint, quoteMint, latestPriceNative, latestPriceUsd) {
    try {
        const vaults = await getTokenAccountsByOwner(poolAddress);
        if (vaults.length === 0) return null;

        const baseVault = vaults.find((vault) => vault.mint === baseMint) ?? null;
        const quoteVault = vaults.find((vault) => vault.mint === quoteMint) ?? null;

        const liquidityBase = baseVault?.uiAmount ?? null;
        const liquidityQuote = quoteVault?.uiAmount ?? null;

        let basePriceUsd = latestPriceUsd ?? await getTokenUsdPrice(baseMint);
        let quotePriceUsd = await getTokenUsdPrice(quoteMint);

        if (quotePriceUsd == null && latestPriceUsd != null && latestPriceNative != null) {
            quotePriceUsd = safeDivide(latestPriceUsd, latestPriceNative);
        }

        if (basePriceUsd == null && latestPriceNative != null && quotePriceUsd != null) {
            basePriceUsd = latestPriceNative * quotePriceUsd;
        }

        let liquidityUsd = 0;
        let pricedSides = 0;

        if (liquidityBase != null && basePriceUsd != null) {
            liquidityUsd += liquidityBase * basePriceUsd;
            pricedSides++;
        }

        if (liquidityQuote != null && quotePriceUsd != null) {
            liquidityUsd += liquidityQuote * quotePriceUsd;
            pricedSides++;
        }

        if (pricedSides === 0) return null;

        return {
            liquidityUsd,
            liquidityBase,
            liquidityQuote,
        };
    } catch (err) {
        console.warn(`[Liquidity] calculateLiquidity(${poolAddress}) failed:`, err.message);
        return null;
    }
}

async function refreshAllLiquidity() {
    let updated = 0;

    try {
        const result = await db.query(`
            SELECT
                p.pool_address,
                p.base_token_mint,
                p.quote_token_mint,
                ps.price_native,
                ps.price_usd
            FROM pools p
            LEFT JOIN pool_stats ps ON ps.pool_address = p.pool_address
            WHERE ps.liquidity_updated_at IS NULL
               OR ps.liquidity_updated_at < NOW() - INTERVAL '5 minutes'
            ORDER BY COALESCE(ps.volume_24h, 0) DESC NULLS LAST
            LIMIT 50
        `);

        for (const row of result.rows) {
            if (isLiquidityRateLimited()) {
                break;
            }

            const liquidity = await calculateLiquidity(
                row.pool_address,
                row.base_token_mint,
                row.quote_token_mint,
                row.price_native != null ? Number(row.price_native) : null,
                row.price_usd != null ? Number(row.price_usd) : null
            );

            if (!liquidity) continue;

            await db.query(
                `UPDATE pool_stats
                 SET liquidity = $1,
                     liquidity_usd = $1,
                     liquidity_base = $2,
                     liquidity_quote = $3,
                     liquidity_updated_at = NOW(),
                     updated_at = NOW()
                 WHERE pool_address = $4`,
                [
                    liquidity.liquidityUsd,
                    liquidity.liquidityBase,
                    liquidity.liquidityQuote,
                    row.pool_address,
                ]
            );

            updated++;
        }

        console.log(`[Liquidity] Refreshed ${updated} pool(s)`);
    } catch (err) {
        console.error('[Liquidity] refreshAllLiquidity failed:', err.message);
    }

    return updated;
}

module.exports = {
    calculateLiquidity,
    getTokenAccountsByOwner,
    refreshAllLiquidity,
};

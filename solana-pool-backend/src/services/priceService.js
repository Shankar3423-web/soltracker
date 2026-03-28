'use strict';

const axios = require('axios');
const db = require('../config/db');
const { safeDivide } = require('../utils/helpers');
const { STABLECOIN_MINTS, WSOL_MINT } = require('../config/constants');

let cachedSolPrice = null;
let solPriceFetchedAt = 0;
const SOL_CACHE_TTL_MS = 5 * 60_000;

const tokenUsdCache = new Map();
const TOKEN_CACHE_TTL_MS = 30_000;

function getCachedTokenPrice(mint) {
    const entry = tokenUsdCache.get(mint);
    if (!entry) return undefined;
    if ((Date.now() - entry.fetchedAt) > TOKEN_CACHE_TTL_MS) {
        tokenUsdCache.delete(mint);
        return undefined;
    }
    return entry.value;
}

function setCachedTokenPrice(mint, value) {
    tokenUsdCache.set(mint, {
        value,
        fetchedAt: Date.now(),
    });
    return value;
}

async function getSolPrice() {
    if (process.env.SOL_PRICE_USD) {
        return parseFloat(process.env.SOL_PRICE_USD);
    }

    const now = Date.now();
    if (cachedSolPrice !== null && (now - solPriceFetchedAt) < SOL_CACHE_TTL_MS) {
        return cachedSolPrice;
    }

    try {
        const res = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
            {
                timeout: 5000,
                proxy: false,
            }
        );
        const price = res.data?.solana?.usd;
        if (typeof price === 'number' && price > 0) {
            cachedSolPrice = price;
            solPriceFetchedAt = now;
            return price;
        }
    } catch (err) {
        console.warn('[Price] CoinGecko fetch failed, using fallback:', err.message);
    }

    return cachedSolPrice ?? 150.0;
}

async function getTokenUsdPrice(mint) {
    if (!mint) return null;

    if (STABLECOIN_MINTS.has(mint)) return 1;
    if (mint === WSOL_MINT) return getSolPrice();

    const cached = getCachedTokenPrice(mint);
    if (cached !== undefined) return cached;

    const direct = await db.query(
        `SELECT ps.price_usd
         FROM pool_stats ps
         JOIN pools p ON p.pool_address = ps.pool_address
         WHERE p.base_token_mint = $1
           AND ps.price_usd IS NOT NULL
           AND ps.price_usd > 0
         ORDER BY COALESCE(ps.liquidity_usd, ps.liquidity, 0) DESC NULLS LAST,
                  COALESCE(ps.volume_24h, 0) DESC NULLS LAST,
                  ps.updated_at DESC NULLS LAST
         LIMIT 1`,
        [mint]
    );

    if (direct.rows[0]?.price_usd != null) {
        return setCachedTokenPrice(mint, Number(direct.rows[0].price_usd));
    }

    const inverse = await db.query(
        `SELECT ps.price_usd, ps.price_native
         FROM pool_stats ps
         JOIN pools p ON p.pool_address = ps.pool_address
         WHERE p.quote_token_mint = $1
           AND ps.price_usd IS NOT NULL
           AND ps.price_native IS NOT NULL
           AND ps.price_native > 0
         ORDER BY COALESCE(ps.liquidity_usd, ps.liquidity, 0) DESC NULLS LAST,
                  COALESCE(ps.volume_24h, 0) DESC NULLS LAST,
                  ps.updated_at DESC NULLS LAST
         LIMIT 1`,
        [mint]
    );

    if (inverse.rows[0]?.price_usd != null && inverse.rows[0]?.price_native != null) {
        return setCachedTokenPrice(
            mint,
            safeDivide(Number(inverse.rows[0].price_usd), Number(inverse.rows[0].price_native))
        );
    }

    return setCachedTokenPrice(mint, null);
}

async function calculateUsdValue(quoteAmount, quoteMint) {
    if (quoteAmount == null || !quoteMint) return null;
    const quotePriceUsd = await getTokenUsdPrice(quoteMint);
    if (quotePriceUsd == null) return null;
    return quoteAmount * quotePriceUsd;
}

async function buildSwapPricing({
    baseMint,
    quoteMint,
    baseAmount,
    quoteAmount,
    priceNative,
}) {
    const solPrice = await getSolPrice();
    const quotePriceUsd = await getTokenUsdPrice(quoteMint);
    const directBasePriceUsd = await getTokenUsdPrice(baseMint);

    let priceUsd = null;
    if (quotePriceUsd != null && priceNative != null) {
        priceUsd = priceNative * quotePriceUsd;
    } else if (directBasePriceUsd != null) {
        priceUsd = directBasePriceUsd;
    }

    const resolvedQuotePriceUsd = quotePriceUsd ?? safeDivide(priceUsd, priceNative);

    let usdValue = null;
    if (resolvedQuotePriceUsd != null && quoteAmount != null) {
        usdValue = quoteAmount * resolvedQuotePriceUsd;
    } else if (priceUsd != null && baseAmount != null) {
        usdValue = baseAmount * priceUsd;
    }

    let priceSol = null;
    if (quoteMint === WSOL_MINT) {
        priceSol = priceNative;
    } else if (priceUsd != null) {
        priceSol = safeDivide(priceUsd, solPrice);
    }

    return {
        priceUsd,
        priceSol,
        quotePriceUsd: resolvedQuotePriceUsd,
        usdValue,
    };
}

module.exports = {
    buildSwapPricing,
    calculateUsdValue,
    getSolPrice,
    getTokenUsdPrice,
};

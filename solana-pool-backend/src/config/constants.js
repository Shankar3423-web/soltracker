'use strict';
/**
 * constants.js
 * Shared mint-level constants used by decoderService and priceService.
 */

/** Wrapped SOL mint address on Solana mainnet. */
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Known stablecoin mint addresses on Solana mainnet.
 * Used for canonical quote-token detection (base/quote assignment)
 * and for direct USD value calculation (1 stablecoin unit = $1).
 */
const STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
    'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',   // USDS  ← FIX: was missing, caused wrong base/quote on WSOL/USDS pools
    'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',   // USDH
    'UXPhBoR3qG4UCiGNJfV7MqhHyFqKN68g45GoYvAeL2M',   // UXD
    'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',    // USD1 (Binance)
    'FRAX4cFwPBNzFGMnzGRkB8FMzKu8W9JFxAfYi3Q9Dkb',   // FRAX (Solana)
]);

module.exports = { WSOL_MINT, STABLECOIN_MINTS };
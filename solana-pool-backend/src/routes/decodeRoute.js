'use strict';
/**
 * decodeRoute.js
 * POST /decode  —  unchanged decode + store pipeline.
 *
 * ADDITIVE CHANGES (decode logic not touched):
 *   • After each swap is stored, call ensureTokenExists(baseMint)
 *     and ensureTokenExists(quoteMint) to populate the tokens table.
 *   • Call enrichPoolSymbols() to backfill base_symbol / quote_symbol on pools.
 *   • Call aggregatePool() to immediately refresh pool_stats for the frontend.
 *   All three calls are fire-and-forget (non-blocking) — they NEVER delay
 *   the response or break the decode pipeline if they fail.
 */

const express = require('express');
const router = express.Router();

const { getTransaction } = require('../services/heliusService');
const { decodeSwaps } = require('../services/decoderService');
const { ensurePoolExists } = require('../services/poolService');
const { calculateUsdValue } = require('../services/priceService');
const { insertSwap } = require('../repositories/swapRepository');
const { unixToDate } = require('../utils/helpers');
// ── NEW: metadata + stats hooks (additive only) ────────────────────────────
const { ensureTokenExists,
    enrichPoolSymbols } = require('../services/metadataService');
const { aggregatePool } = require('../services/aggregationService');
const { processSwapForCandles } = require('../services/ohlcvService');

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{40,100}$/;

router.post('/', async (req, res, next) => {
    const { signature } = req.body ?? {};

    if (!signature || typeof signature !== 'string') {
        return res.status(400).json({
            error: 'Request body must contain a "signature" string field.',
        });
    }

    const sig = signature.trim();
    if (!BASE58_RE.test(sig)) {
        return res.status(400).json({
            error: 'Invalid signature format. Expected a base58-encoded transaction signature.',
        });
    }

    try {
        console.log(`[Route] Decoding: ${sig}`);
        const tx = await getTransaction(sig);

        const rawKeys = tx.transaction?.message?.accountKeys ?? [];
        const firstKey = rawKeys[0];
        const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

        const swapEvents = decodeSwaps(tx, sig);

        if (swapEvents.length === 0) {
            return res.status(200).json({
                signature: sig,
                wallet,
                totalSwaps: 0,
                swaps: [],
                message: 'No swap events found in this transaction.',
            });
        }

        console.log(`[Route] ${swapEvents.length} swap event(s) found`);
        const results = [];

        for (const event of swapEvents) {
            try {
                // ── Core pipeline (unchanged) ──────────────────────────────────────
                const { dexId } = await ensurePoolExists({
                    dexName: event.dexName,
                    poolAddress: event.poolAddress,
                    baseMint: event.baseMint,
                    quoteMint: event.quoteMint,
                });

                const usdValue = await calculateUsdValue(event.quoteAmount, event.quoteMint);
                const blockTimeDate = event.blockTime ? unixToDate(event.blockTime) : null;

                const inserted = await insertSwap({
                    signature: event.signature,
                    poolAddress: event.poolAddress,
                    dexId,
                    wallet,
                    baseAmount: event.baseAmount,
                    quoteAmount: event.quoteAmount,
                    price: event.price,
                    usdValue,
                    swapSide: event.swapSide,
                    classification: event.classification,
                    slot: event.slot,
                    blockTime: blockTimeDate,
                });

                // ── Additive: metadata + stats (fire-and-forget) ───────────────────
                // These run AFTER the swap is stored and NEVER block the response.
                // Errors inside these functions are caught silently.
                setImmediate(async () => {
                    try {
                        await ensureTokenExists(event.baseMint);
                        await ensureTokenExists(event.quoteMint);
                        await enrichPoolSymbols(event.poolAddress, event.baseMint, event.quoteMint);
                        await aggregatePool(event.poolAddress);

                        // NEW: real-time chart aggregation (OHLC)
                        await processSwapForCandles({
                            poolAddress: event.poolAddress,
                            price: event.price,
                            blockTime: blockTimeDate,
                            usdValue: usdValue
                        });
                    } catch (e) {
                        console.warn('[Route] Post-swap enrichment error:', e.message);
                    }
                });

                results.push({
                    poolAddress: event.poolAddress,
                    dexName: event.dexName,
                    baseMint: event.baseMint,
                    quoteMint: event.quoteMint,
                    baseAmount: event.baseAmount,
                    quoteAmount: event.quoteAmount,
                    price: event.price,
                    usdValue,
                    swapSide: event.swapSide,
                    classification: event.classification,
                    slot: event.slot,
                    blockTime: blockTimeDate,
                    stored: inserted !== null,
                });

            } catch (swapErr) {
                console.error(`[Route] Error storing swap @ pool ${event.poolAddress}:`, swapErr.message);
                results.push({
                    poolAddress: event.poolAddress,
                    dexName: event.dexName,
                    error: swapErr.message,
                    stored: false,
                });
            }
        }

        return res.status(200).json({
            signature: sig,
            wallet,
            totalSwaps: results.length,
            swaps: results,
        });

    } catch (err) {
        console.error('[Route] Fatal error:', err.message);
        next(err);
    }
});

module.exports = router;
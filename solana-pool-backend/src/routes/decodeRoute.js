'use strict';

const express = require('express');
const router = express.Router();

const { getTransaction } = require('../services/heliusService');
const { decodeSwaps } = require('../services/decoderService');
const { persistDecodedSwapEvent } = require('../services/marketDataService');

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

        const results = [];
        for (const event of swapEvents) {
            try {
                const stored = await persistDecodedSwapEvent(event, wallet);
                results.push({
                    eventIndex: event.eventIndex ?? 0,
                    poolAddress: event.poolAddress,
                    dexName: event.dexName,
                    baseMint: event.baseMint,
                    quoteMint: event.quoteMint,
                    baseAmount: event.baseAmount,
                    quoteAmount: event.quoteAmount,
                    priceNative: event.price,
                    priceUsd: stored.pricing.priceUsd,
                    priceSol: stored.pricing.priceSol,
                    quotePriceUsd: stored.pricing.quotePriceUsd,
                    usdValue: stored.pricing.usdValue,
                    swapSide: event.swapSide,
                    classification: event.classification,
                    slot: event.slot,
                    blockTime: stored.blockTime,
                    stored: stored.inserted !== null,
                });
            } catch (err) {
                console.error(`[Route] Error storing swap @ pool ${event.poolAddress}:`, err.message);
                results.push({
                    eventIndex: event.eventIndex ?? 0,
                    poolAddress: event.poolAddress,
                    dexName: event.dexName,
                    error: err.message,
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

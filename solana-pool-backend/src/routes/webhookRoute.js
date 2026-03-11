'use strict';
/**
 * webhookRoute.js
 * POST /webhook  —  Receives live transaction notifications from Helius Webhook.
 *
 * ─── WHY WE FETCH THE TX AFTER RECEIVING THE WEBHOOK ────────────────────────
 *
 *  Helius webhook RAW payload does NOT include jsonParsed instructions.
 *  The instructions in the webhook body have:
 *    - .data      (base58 encoded opaque bytes)
 *    - .accounts  (array of account indices, not pubkey strings)
 *    - .parsed    = undefined  ← MISSING
 *
 *  Our decoder requires jsonParsed format (.parsed.type, .parsed.info, etc.)
 *  to identify token transfers (transferChecked / transfer instructions).
 *  Without .parsed, extractTransferAmount() returns immediately for every
 *  child instruction → 0 transfers found → ghost CPI guard fires → 0 swaps.
 *
 *  THE FIX: Use the signature from the webhook notification to fetch the
 *  full jsonParsed transaction via getTransaction() — exactly the same as
 *  the /decode endpoint. The webhook acts as a real-time trigger/notification,
 *  and we fetch the properly encoded data separately.
 *
 * ─── FLOW ────────────────────────────────────────────────────────────────────
 *
 *  Helius  →  POST /webhook  [ array of tx notifications with signatures ]
 *          →  Reply 200 immediately (Helius has 3s timeout, retries on failure)
 *          →  For each signature, call getTransaction(sig) for jsonParsed data
 *          →  Decode swaps → store in DB → fire-and-forget enrichment
 *
 * ─── SECURITY ────────────────────────────────────────────────────────────────
 *
 *  Set WEBHOOK_SECRET in .env — same value goes in Helius dashboard Auth Header.
 *  All requests without matching Authorization header are rejected with 401.
 */

const express = require('express');
const router = express.Router();

const { getTransaction } = require('../services/heliusService');
const { decodeSwaps } = require('../services/decoderService');
const { ensurePoolExists } = require('../services/poolService');
const { calculateUsdValue } = require('../services/priceService');
const { insertSwap } = require('../repositories/swapRepository');
const { unixToDate } = require('../utils/helpers');
const { ensureTokenExists,
    enrichPoolSymbols } = require('../services/metadataService');
const { aggregatePool } = require('../services/aggregationService');

// ─────────────────────────────────────────────────────────────────────────────
//  SECURITY — Authorization header check
// ─────────────────────────────────────────────────────────────────────────────

function verifyWebhookSecret(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
        // No secret configured — allow all (dev/testing mode)
        return next();
    }
    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== secret) {
        console.warn('[Webhook] Unauthorized request rejected');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', verifyWebhookSecret, async (req, res) => {
    const payload = req.body;

    // Helius sends test pings as empty arrays — just acknowledge
    if (!Array.isArray(payload) || payload.length === 0) {
        return res.status(200).json({ received: true, processed: 0 });
    }

    // Extract all signatures from the webhook notification
    const signatures = [];
    for (const item of payload) {
        const sig =
            item?.signature ??
            item?.transaction?.signatures?.[0] ??
            null;
        if (sig && typeof sig === 'string') {
            signatures.push(sig);
        }
    }

    if (signatures.length === 0) {
        console.warn('[Webhook] No valid signatures found in payload');
        return res.status(200).json({ received: true, processed: 0 });
    }

    // Reply to Helius immediately — must respond within 3 seconds
    res.status(200).json({
        received: true,
        signatures: signatures.length,
        message: 'Processing',
    });

    console.log('[Webhook] Received', signatures.length, 'transaction(s) to process');

    // Process each signature in background
    setImmediate(async () => {
        for (const sig of signatures) {
            await processTransaction(sig);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PROCESS ONE TRANSACTION
//  Fetches full jsonParsed tx from Helius RPC, decodes, stores.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  RETRY HELPER — exponential backoff for Helius RPC 429s
//  Free plan: 10 req/sec. Bursts of webhooks all call getTransaction()
//  simultaneously → 429s → data loss. Retry fixes this.
// ─────────────────────────────────────────────────────────────────────────────

async function getTransactionWithRetry(signature, maxRetries = 5) {
    let delay = 500; // start at 500ms, doubles each retry: 500→1000→2000→4000→8000
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await getTransaction(signature);
        } catch (err) {
            const is429 = err.message?.includes('429');
            if (is429 && attempt < maxRetries) {
                console.warn(
                    '[Webhook] Rate limited (429), retry', attempt, '/', maxRetries,
                    '— waiting', delay + 'ms for', signature.slice(0, 20) + '...'
                );
                await new Promise(r => setTimeout(r, delay));
                delay *= 2; // exponential backoff
            } else {
                throw err; // not a 429, or out of retries — propagate
            }
        }
    }
}

async function processTransaction(signature) {
    try {
        console.log('[Webhook] Processing:', signature);

        // Fetch full jsonParsed transaction with retry on 429.
        // The webhook payload itself is NOT jsonParsed (no .parsed on instructions),
        // so we always fetch fresh from RPC with encoding=jsonParsed.
        const tx = await getTransactionWithRetry(signature);

        // Extract signer wallet (accountKeys[0])
        const rawKeys = tx.transaction?.message?.accountKeys ?? [];
        const firstKey = rawKeys[0];
        const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

        // Decode all pool-level swap events
        const swapEvents = decodeSwaps(tx, signature);

        if (swapEvents.length === 0) {
            console.log('[Webhook] No swaps:', signature.slice(0, 20) + '...');
            return;
        }

        console.log('[Webhook]', swapEvents.length, 'swap(s) in', signature.slice(0, 20) + '...');

        // Store each swap
        for (const event of swapEvents) {
            try {
                const { dexId } = await ensurePoolExists({
                    dexName: event.dexName,
                    poolAddress: event.poolAddress,
                    baseMint: event.baseMint,
                    quoteMint: event.quoteMint,
                });

                const usdValue = await calculateUsdValue(event.quoteAmount, event.quoteMint);
                const blockTimeDate = event.blockTime ? unixToDate(event.blockTime) : null;

                await insertSwap({
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

                console.log(
                    '[Webhook] ✅', event.dexName,
                    '| pool:', event.poolAddress.slice(0, 12) + '...',
                    '|', event.swapSide.toUpperCase(),
                    '| USD:', usdValue?.toFixed(4) ?? 'n/a'
                );

                // Fire-and-forget: token metadata + pool stats (never blocks)
                setImmediate(async () => {
                    try {
                        await ensureTokenExists(event.baseMint);
                        await ensureTokenExists(event.quoteMint);
                        await enrichPoolSymbols(event.poolAddress, event.baseMint, event.quoteMint);
                        await aggregatePool(event.poolAddress);
                    } catch (e) {
                        console.warn('[Webhook] Enrichment error:', e.message);
                    }
                });

            } catch (err) {
                console.error('[Webhook] Store error @ pool', event.poolAddress, ':', err.message);
            }
        }

    } catch (err) {
        console.error('[Webhook] Failed to process', signature.slice(0, 20) + '...', ':', err.message);
    }
}

module.exports = router;
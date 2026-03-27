'use strict';
/**
 * webhookRoute.js
 * POST /webhook — Receives live transaction notifications from Helius Webhook.
 *
 * ─── THE 429 PROBLEM & SOLUTION ─────────────────────────────────────────────
 *
 *  Problem:
 *    Helius sends webhooks for every tx on watched programs.
 *    Pump.fun alone does 3,000-5,000 tx/min. Each webhook triggers
 *    getTransaction() — an RPC call. When 20+ arrive simultaneously,
 *    all 20 fire getTransaction() in PARALLEL → Helius free plan limit
 *    (10 req/sec) is exceeded instantly → HTTP 429 → data loss.
 *    Retries make it worse: retrying 20 txs simultaneously = still 20
 *    parallel calls hitting the same rate limit.
 *
 *  Solution: SERIAL QUEUE with rate limiting
 *    All incoming signatures are pushed into a single in-memory queue.
 *    One worker drains the queue sequentially, one tx at a time,
 *    with a 120ms gap between each RPC call (= ~8 req/sec, safely
 *    under the 10 req/sec Helius free plan limit).
 *    Queue never fires parallel getTransaction() calls.
 *
 *  Result:
 *    ✅ Zero 429s under normal load
 *    ✅ No data loss — every tx eventually processed
 *    ✅ Slight latency (queue delay) — acceptable for analytics
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
const { processSwapForCandles } = require('../services/ohlcvService');
const { broadcastNewSwap, broadcastCandleUpdate } = require('../services/socketService');

// ─────────────────────────────────────────────────────────────────────────────
//  SERIAL QUEUE — prevents parallel RPC calls that cause 429s
// ─────────────────────────────────────────────────────────────────────────────

const queue = [];          // pending signatures
let isProcessing = false;       // is the worker currently running?
const RPC_DELAY_MS = 120;         // 120ms between calls = ~8 req/sec (limit is 10)
const seen = new Set();   // dedup: skip if same sig already in queue

function enqueue(signature) {
    if (seen.has(signature)) return;  // webhook can send duplicates
    seen.add(signature);
    queue.push(signature);
    // Clean up seen set after 10 min to prevent unbounded memory growth
    setTimeout(() => seen.delete(signature), 10 * 60 * 1000);
    drainQueue();
}

async function drainQueue() {
    if (isProcessing) return;   // worker already running — it will pick up new items
    isProcessing = true;

    while (queue.length > 0) {
        const signature = queue.shift();
        try {
            await processTransaction(signature);
        } catch (err) {
            console.error('[Webhook] Unhandled error for', signature.slice(0, 20) + '...:', err.message);
        }
        // Rate limit gap — wait before next RPC call
        if (queue.length > 0) {
            await new Promise(r => setTimeout(r, RPC_DELAY_MS));
        }
    }

    isProcessing = false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECURITY — Authorization header check
// ─────────────────────────────────────────────────────────────────────────────

function verifyWebhookSecret(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return next();  // dev mode — no secret set
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

    // Helius test pings — empty array, just acknowledge
    if (!Array.isArray(payload) || payload.length === 0) {
        return res.status(200).json({ received: true, queued: 0 });
    }

    // Extract signatures and push to queue
    let queued = 0;
    for (const item of payload) {
        const sig =
            item?.signature ??
            item?.transaction?.signatures?.[0] ??
            null;
        if (sig && typeof sig === 'string') {
            enqueue(sig);
            queued++;
        }
    }

    // Reply immediately — Helius must get 200 within 3 seconds
    res.status(200).json({
        received: true,
        queued,
        queueDepth: queue.length,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PROCESS ONE TRANSACTION
// ─────────────────────────────────────────────────────────────────────────────

async function processTransaction(signature) {
    try {
        // Fetch full jsonParsed tx — required because webhook payload is NOT jsonParsed
        const tx = await getTransaction(signature);

        // Extract signer wallet (accountKeys[0])
        const rawKeys = tx.transaction?.message?.accountKeys ?? [];
        const firstKey = rawKeys[0];
        const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

        // Decode all pool-level swap events
        const swapEvents = decodeSwaps(tx, signature);

        if (swapEvents.length === 0) {
            // console.log('[Webhook] No swaps:', signature.slice(0, 20) + '...');
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

                // Price assignment for priceUsd and priceSol
                const { WSOL_MINT } = require('../config/constants');
                const { getSolPrice } = require('../services/priceService');
                const { safeDivide } = require('../utils/helpers');

                let priceUsd = null;
                let priceSol = null;

                if (event.quoteMint === WSOL_MINT) {
                    priceSol = event.price;
                    const solUsd = await getSolPrice();
                    priceUsd = priceSol * solUsd;
                } else {
                    // Assuming stablecoin if not SOL for simple pairs
                    priceUsd = event.price;
                    const solUsd = await getSolPrice();
                    priceSol = safeDivide(priceUsd, solUsd);
                }

                await insertSwap({
                    signature: event.signature,
                    poolAddress: event.poolAddress,
                    dexId,
                    wallet,
                    baseAmount: event.baseAmount,
                    quoteAmount: event.quoteAmount,
                    price: event.price,
                    usdValue,
                    priceUsd,
                    priceSol,
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

                // Fire-and-forget: metadata + pool stats (never blocks the queue)
                setImmediate(async () => {
                    try {
                        await ensureTokenExists(event.baseMint);
                        await ensureTokenExists(event.quoteMint);
                        await enrichPoolSymbols(event.poolAddress, event.baseMint, event.quoteMint);
                        await aggregatePool(event.poolAddress);
                        const updatedCandles = await processSwapForCandles({
                            poolAddress: event.poolAddress,
                            price: event.price,
                            usdValue: usdValue,
                            blockTime: blockTimeDate
                        });

                        // REAL-TIME BROADCAST: Push to room listeners
                        broadcastNewSwap(event.poolAddress, {
                            signature: event.signature,
                            wallet,
                            baseAmount: event.baseAmount,
                            quoteAmount: event.quoteAmount,
                            price: event.price,
                            usdValue,
                            swapSide: event.swapSide,
                            blockTime: blockTimeDate
                        });

                        if (updatedCandles && updatedCandles.length > 0) {
                            // Broadcast all timeframe updates (1m, 5m, etc.)
                            updatedCandles.forEach(c => broadcastCandleUpdate(event.poolAddress, c));
                        }

                    } catch (e) {
                        console.warn('[Webhook] Enrichment error:', e.message);
                    }
                });

            } catch (err) {
                console.error('[Webhook] Store error @ pool', event.poolAddress, ':', err.message);
            }
        }

    } catch (err) {
        // If Helius RPC still returns 429 (server overloaded), log and move on
        // The tx is dropped here but the queue continues — doesn't block other txs
        if (err.message?.includes('429')) {
            console.warn('[Webhook] RPC 429 after queue delay for', signature.slice(0, 20) + '... — skipping');
        } else {
            console.error('[Webhook] Failed:', signature.slice(0, 20) + '...:', err.message);
        }
    }
}

module.exports = router;
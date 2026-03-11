'use strict';
/**
 * webhookRoute.js
 * POST /webhook  —  Receives live transaction data directly from Helius Webhook.
 *
 * ─── HOW THIS WORKS ──────────────────────────────────────────────────────────
 *
 *  OLD FLOW (Postman / manual):
 *    You  →  POST /decode { signature }
 *         →  Server fetches tx from Helius RPC (extra network round-trip)
 *         →  Decodes + stores
 *
 *  NEW FLOW (Webhook / automatic):
 *    Helius  →  POST /webhook  [ full tx payload, already jsonParsed ]
 *            →  Server decodes DIRECTLY from the payload (0 extra RPC calls)
 *            →  Decodes + stores
 *
 * ─── HELIUS WEBHOOK PAYLOAD FORMAT ──────────────────────────────────────────
 *
 *  Helius sends an ARRAY of transaction objects:
 *  [
 *    {
 *      "signature": "...",
 *      "slot": 405434576,
 *      "blockTime": 1773130821,
 *      "transaction": { "message": { ... }, "signatures": [...] },
 *      "meta": { "err": null, "preBalances": [...], "postBalances": [...], ... }
 *    },
 *    ...
 *  ]
 *
 *  Each object is already in jsonParsed format — identical to what
 *  heliusService.getTransaction() returns. So our decoderService works unchanged.
 *
 * ─── SECURITY ────────────────────────────────────────────────────────────────
 *
 *  Helius lets you set an Authorization header secret on your webhook.
 *  Set WEBHOOK_SECRET in your .env and Helius will send:
 *    Authorization: <your-secret>
 *  If the header doesn't match → 401 rejected immediately.
 *  If WEBHOOK_SECRET is not set in .env → auth check is skipped (dev mode).
 *
 * ─── SETUP STEPS ─────────────────────────────────────────────────────────────
 *
 *  1. Add to .env:
 *       WEBHOOK_SECRET=any_random_secret_string_you_choose
 *
 *  2. In Helius dashboard (https://dev.helius.xyz/webhooks):
 *       • Webhook URL:   https://your-server.com/webhook
 *       • Auth Header:   <same value as WEBHOOK_SECRET>
 *       • Tx Type:       Any (or filter by program IDs)
 *       • Encoding:      jsonParsed
 *       • Addresses:     Add DEX pool addresses to watch
 *
 *  3. If running locally, expose via:
 *       ngrok http 3000
 *     Use the ngrok URL in Helius dashboard.
 *
 * ─── RESPONSE ────────────────────────────────────────────────────────────────
 *
 *  Always returns HTTP 200 to Helius within 3 seconds to prevent retries.
 *  Heavy processing (metadata, aggregation) is fire-and-forget.
 *  On error, we still return 200 (with error details) so Helius doesn't retry.
 */

const express = require('express');
const router = express.Router();

const { decodeSwaps } = require('../services/decoderService');
const { ensurePoolExists } = require('../services/poolService');
const { calculateUsdValue } = require('../services/priceService');
const { insertSwap } = require('../repositories/swapRepository');
const { unixToDate } = require('../utils/helpers');
const { ensureTokenExists,
    enrichPoolSymbols } = require('../services/metadataService');
const { aggregatePool } = require('../services/aggregationService');

// ─────────────────────────────────────────────────────────────────────────────
//  SECURITY MIDDLEWARE — Authorization header check
// ─────────────────────────────────────────────────────────────────────────────

function verifyWebhookSecret(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;

    // If no secret configured, skip auth (useful during local dev)
    if (!secret) {
        console.warn('[Webhook] ⚠️  WEBHOOK_SECRET not set — skipping auth check (dev mode)');
        return next();
    }

    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== secret) {
        console.warn(`[Webhook] ❌ Unauthorized request. Header: "${authHeader.slice(0, 20)}..."`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', verifyWebhookSecret, async (req, res) => {
    // ── 1. Validate payload ───────────────────────────────────────────────────
    const payload = req.body;

    if (!Array.isArray(payload) || payload.length === 0) {
        // Helius sometimes sends test pings with empty arrays — just acknowledge
        console.log('[Webhook] Received empty/non-array payload — acknowledging');
        return res.status(200).json({ received: true, processed: 0 });
    }

    // ── 2. Respond to Helius immediately (must reply within 3s or it retries) ─
    // We send 200 NOW and process async in the background.
    res.status(200).json({
        received: true,
        txCount: payload.length,
        message: 'Processing in background',
    });

    // ── 3. Process all transactions in the background ─────────────────────────
    setImmediate(async () => {
        for (const txPayload of payload) {
            await processWebhookTransaction(txPayload);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PROCESS A SINGLE TRANSACTION FROM THE WEBHOOK PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────

async function processWebhookTransaction(txPayload) {
    // Extract signature — Helius puts it in txPayload.signature directly
    // OR inside txPayload.transaction.signatures[0]
    const signature =
        txPayload?.signature ??
        txPayload?.transaction?.signatures?.[0] ??
        null;

    if (!signature) {
        console.warn('[Webhook] Transaction payload has no signature — skipping');
        return;
    }

    try {
        console.log(`[Webhook] Processing tx: ${signature}`);

        // ── Build the tx object our decoder expects ───────────────────────────
        // Helius webhook payload is already in the same format as getTransaction()
        // result — just needs to be structured as { slot, blockTime, transaction, meta }
        const tx = buildTxObject(txPayload);

        if (!tx) {
            console.warn(`[Webhook] Could not build tx object for: ${signature}`);
            return;
        }

        // ── Extract wallet (signer = accountKeys[0]) ──────────────────────────
        const rawKeys = tx.transaction?.message?.accountKeys ?? [];
        const firstKey = rawKeys[0];
        const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

        // ── Decode swaps (same decoder, zero extra RPC calls) ─────────────────
        const swapEvents = decodeSwaps(tx, signature);

        if (swapEvents.length === 0) {
            console.log(`[Webhook] No swaps in tx: ${signature}`);
            return;
        }

        console.log(`[Webhook] ${swapEvents.length} swap(s) found in: ${signature}`);

        // ── Store each swap ───────────────────────────────────────────────────
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
                    `[Webhook] ✅ Stored: ${event.dexName} @ ${event.poolAddress} | ${event.swapSide.toUpperCase()} | USD=${usdValue}`
                );

                // ── Fire-and-forget: metadata + stats ──────────────────────────
                setImmediate(async () => {
                    try {
                        await ensureTokenExists(event.baseMint);
                        await ensureTokenExists(event.quoteMint);
                        await enrichPoolSymbols(event.poolAddress, event.baseMint, event.quoteMint);
                        await aggregatePool(event.poolAddress);
                    } catch (e) {
                        console.warn('[Webhook] Post-swap enrichment error:', e.message);
                    }
                });

            } catch (swapErr) {
                console.error(
                    `[Webhook] Error storing swap @ pool ${event.poolAddress}: ${swapErr.message}`
                );
            }
        }

    } catch (err) {
        console.error(`[Webhook] Fatal error processing tx ${signature}: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  NORMALIZE HELIUS WEBHOOK PAYLOAD → decoder-compatible tx object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helius webhook payloads come in two shapes depending on your webhook config:
 *
 *  Shape A — Enhanced transaction (Helius enhanced webhooks):
 *  {
 *    "signature": "...",
 *    "slot": 123,
 *    "blockTime": 1234567890,
 *    "transaction": { "message": {...}, "signatures": [...] },
 *    "meta": { "err": null, "preBalances": [...], ... }
 *  }
 *
 *  Shape B — Raw Helius webhook (accountAddresses filter):
 *  Same as Shape A — top-level fields.
 *
 *  Both shapes match what heliusService.getTransaction() returns, so no
 *  transformation is needed beyond normalizing the wrapper object.
 */
function buildTxObject(payload) {
    // If it already looks like a full tx result (has .transaction and .meta) — use directly
    if (payload?.transaction?.message && payload?.meta) {
        return {
            slot: payload.slot ?? null,
            blockTime: payload.blockTime ?? null,
            transaction: payload.transaction,
            meta: payload.meta,
        };
    }

    // Some Helius webhook formats wrap differently — try to handle them
    console.warn('[Webhook] Unexpected payload shape:', JSON.stringify(payload).slice(0, 200));
    return null;
}

module.exports = router;
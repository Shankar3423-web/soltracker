'use strict';

const db = require('../config/db');
const { getTransaction } = require('./heliusService');
const { decodeSwaps } = require('./decoderService');
const { persistDecodedSwapEvent } = require('./marketDataService');
const { broadcastNewSwap, broadcastCandleUpdate } = require('./socketService');

const RPC_DELAY_MS = 120;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 5;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

let workerStarted = false;
let workerRunning = false;

async function enqueueWebhookSignatures(signatures = []) {
    const unique = [...new Set(
        signatures
            .filter((signature) => typeof signature === 'string')
            .map((signature) => signature.trim())
            .filter(Boolean)
    )];

    if (unique.length === 0) {
        return { queued: 0, queueDepth: await getQueueDepth() };
    }

    const result = await db.query(
        `
        INSERT INTO webhook_ingest_queue (
            signature,
            status,
            attempts,
            next_attempt_at,
            last_seen_at,
            updated_at
        )
        SELECT
            signature,
            'pending',
            0,
            NOW(),
            NOW(),
            NOW()
        FROM unnest($1::text[]) AS signature
        ON CONFLICT (signature) DO UPDATE SET
            last_seen_at = NOW(),
            updated_at = NOW(),
            status = CASE
                WHEN webhook_ingest_queue.status = 'completed' THEN webhook_ingest_queue.status
                ELSE 'pending'
            END,
            next_attempt_at = CASE
                WHEN webhook_ingest_queue.status = 'completed' THEN webhook_ingest_queue.next_attempt_at
                ELSE NOW()
            END
        RETURNING signature, status
        `,
        [unique]
    );

    void drainPersistedQueue();

    return {
        queued: result.rows.filter((row) => row.status !== 'completed').length,
        queueDepth: await getQueueDepth(),
    };
}

async function getQueueDepth() {
    const result = await db.query(
        `
        SELECT COUNT(*)::INT AS count
        FROM webhook_ingest_queue
        WHERE status IN ('pending', 'processing')
        `
    );

    return result.rows[0]?.count ?? 0;
}

async function recoverStaleJobs() {
    await db.query(
        `
        UPDATE webhook_ingest_queue
        SET
            status = 'pending',
            updated_at = NOW(),
            next_attempt_at = NOW()
        WHERE status = 'processing'
          AND updated_at < NOW() - ($1::TEXT)::INTERVAL
        `,
        [`${STALE_PROCESSING_MS} milliseconds`]
    );
}

async function claimNextJob() {
    const result = await db.query(
        `
        WITH next_job AS (
            SELECT signature
            FROM webhook_ingest_queue
            WHERE status = 'pending'
              AND next_attempt_at <= NOW()
            ORDER BY next_attempt_at ASC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE webhook_ingest_queue queue
        SET
            status = 'processing',
            attempts = queue.attempts + 1,
            updated_at = NOW(),
            last_error = NULL
        FROM next_job
        WHERE queue.signature = next_job.signature
        RETURNING queue.signature, queue.attempts
        `
    );

    return result.rows[0] ?? null;
}

async function markCompleted(signature) {
    await db.query(
        `
        UPDATE webhook_ingest_queue
        SET
            status = 'completed',
            updated_at = NOW(),
            next_attempt_at = NOW(),
            last_error = NULL
        WHERE signature = $1
        `,
        [signature]
    );
}

async function markFailed(signature, attempts, errorMessage) {
    const exhausted = attempts >= MAX_RETRIES;
    const delayMs = RETRY_DELAY_MS * Math.max(attempts, 1);
    const nextAttemptAt = exhausted ? new Date() : new Date(Date.now() + delayMs);

    await db.query(
        `
        UPDATE webhook_ingest_queue
        SET
            status = $2::VARCHAR,
            updated_at = NOW(),
            next_attempt_at = $3,
            last_error = $4
        WHERE signature = $1
        `,
        [
            signature,
            exhausted ? 'failed' : 'pending',
            nextAttemptAt,
            errorMessage?.slice(0, 1000) ?? 'Unknown ingest error',
        ]
    );

    if (exhausted) {
        console.error(
            `[IngestQueue] Permanent failure for ${signature.slice(0, 20)}... after ${attempts} attempts: ${errorMessage}`
        );
    } else {
        console.warn(
            `[IngestQueue] Retry ${attempts}/${MAX_RETRIES} scheduled for ${signature.slice(0, 20)}...: ${errorMessage}`
        );
    }
}

async function processTransaction(signature) {
    const tx = await getTransaction(signature);

    const rawKeys = tx.transaction?.message?.accountKeys ?? [];
    const firstKey = rawKeys[0];
    const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

    const swapEvents = decodeSwaps(tx, signature);
    if (swapEvents.length === 0) {
        console.log('[IngestQueue] No swaps found in tx:', signature.slice(0, 16) + '...');
        return;
    }

    console.log('[IngestQueue] Found', swapEvents.length, 'swap(s) in', signature.slice(0, 16) + '...');

    for (const event of swapEvents) {
        const stored = await persistDecodedSwapEvent(event, wallet);

        if (!stored.inserted) continue;

        console.log(
            '[IngestQueue] OK',
            event.dexName,
            '| pool:',
            event.poolAddress.slice(0, 12) + '...',
            '|',
            event.swapSide.toUpperCase(),
            '| USD:',
            stored.pricing.usdValue?.toFixed(4) ?? 'n/a'
        );

        broadcastNewSwap(event.poolAddress, {
            signature: event.signature,
            eventIndex: event.eventIndex ?? 0,
            wallet,
            baseAmount: event.baseAmount,
            quoteAmount: event.quoteAmount,
            priceNative: event.price,
            priceUsd: stored.pricing.priceUsd,
            priceSol: stored.pricing.priceSol,
            usdValue: stored.pricing.usdValue,
            swapSide: event.swapSide,
            blockTime: stored.blockTime,
        });

        for (const candle of stored.candleUpdates) {
            broadcastCandleUpdate(event.poolAddress, candle);
        }
    }
}

async function drainPersistedQueue() {
    if (workerRunning) return;
    workerRunning = true;

    try {
        while (true) {
            const job = await claimNextJob();
            if (!job) break;

            try {
                await processTransaction(job.signature);
                await markCompleted(job.signature);
            } catch (err) {
                await markFailed(job.signature, job.attempts, err.message);
            }

            await new Promise((resolve) => setTimeout(resolve, RPC_DELAY_MS));
        }
    } finally {
        workerRunning = false;
    }
}

function startIngestWorker() {
    if (workerStarted) return;
    workerStarted = true;

    void recoverStaleJobs()
        .then(() => drainPersistedQueue())
        .catch((err) => console.error('[IngestQueue] Startup recovery failed:', err.message));

    setInterval(() => {
        void recoverStaleJobs().catch((err) => {
            console.error('[IngestQueue] Stale job recovery failed:', err.message);
        });
        void drainPersistedQueue().catch((err) => {
            console.error('[IngestQueue] Queue drain failed:', err.message);
        });
    }, HEARTBEAT_MS);
}

module.exports = {
    enqueueWebhookSignatures,
    getQueueDepth,
    startIngestWorker,
};

'use strict';

const { Queue, Worker } = require('bullmq');
const { connection, REDIS_PREFIX } = require('../config/redis');
const { getTransaction } = require('./heliusService');
const { decodeSwaps } = require('./decoderService');
const { persistDecodedSwapEvent } = require('./marketDataService');
const { broadcastNewSwap, broadcastCandleUpdate } = require('./socketService');

const RPC_DELAY_MS = 120;
const MAX_RETRIES = 5;

// Initialize BullMQ Queue
const QUEUE_NAME = 'webhook_ingest_queue';
const ingestQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: MAX_RETRIES,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
    prefix: REDIS_PREFIX,
});

let workerStarted = false;

function getAllowedPools() {
    const raw = process.env.POOL_ALLOWLIST;
    if (typeof raw === 'string' && raw.trim()) {
        return new Set(
            raw
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean)
        );
    }
    return new Set();
}

/**
 * Enqueue signatures into Redis/BullMQ.
 */
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

    // Add jobs to BullMQ
    const jobs = unique.map(sig => ({
        name: `ingest-${sig.slice(0, 8)}`,
        data: { signature: sig }
    }));

    await ingestQueue.addBulk(jobs);

    return {
        queued: unique.length,
        queueDepth: await getQueueDepth(),
    };
}

async function getQueueDepth() {
    try {
        const counts = await ingestQueue.getJobCounts('wait', 'active', 'delayed');
        return (counts.wait || 0) + (counts.active || 0) + (counts.delayed || 0);
    } catch (err) {
        return 0;
    }
}

/**
 * Core processing logic - DO NOT TOUCH (as per user request).
 * This remains the bridge between ingestion and data persistence.
 */
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

    const allowedPools = getAllowedPools();
    const filteredSwapEvents = allowedPools.size
        ? swapEvents.filter((event) => allowedPools.has((event.poolAddress || '').toLowerCase()))
        : swapEvents;

    if (filteredSwapEvents.length === 0) {
        console.log(
            '[IngestQueue] Decoded swaps skipped by pool allowlist:',
            signature.slice(0, 16) + '...'
        );
        return;
    }

    console.log('[IngestQueue] Found', filteredSwapEvents.length, 'allowed swap(s) in', signature.slice(0, 16) + '...');

    for (const event of filteredSwapEvents) {
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

/**
 * Start the BullMQ Worker.
 * Replaces startIngestWorker and the old polling logic.
 */
function startIngestWorker() {
    if (workerStarted) return;
    workerStarted = true;

    const worker = new Worker(QUEUE_NAME, async (job) => {
        const { signature } = job.data;
        try {
            await processTransaction(signature);
            // Throttle slightly to respect RPC limits
            await new Promise((resolve) => setTimeout(resolve, RPC_DELAY_MS));
        } catch (err) {
            console.error(`[IngestQueue] Job failed for tx ${signature.slice(0, 12)}:`, err.message);
            throw err; // Allow BullMQ to handle retries
        }
    }, {
        connection,
        prefix: REDIS_PREFIX,
        concurrency: 1, // Start with single concurrency to match previous behavior
    });

    worker.on('error', (err) => {
        console.error('[IngestQueue] Redis Worker error:', err.message);
    });

    console.log('[IngestQueue] Redis Worker started successfully');
}

module.exports = {
    enqueueWebhookSignatures,
    getQueueDepth,
    startIngestWorker,
};

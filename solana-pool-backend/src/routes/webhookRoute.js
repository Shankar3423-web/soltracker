'use strict';

const express = require('express');
const router = express.Router();

const {
    enqueueWebhookSignatures,
    startIngestWorker,
} = require('../services/ingestQueueService');

const ENABLE_INGEST_WORKER = process.env.ENABLE_INGEST_WORKER !== 'false';

if (ENABLE_INGEST_WORKER) {
    startIngestWorker();
} else {
    console.log('[IngestQueue] Worker disabled by ENABLE_INGEST_WORKER=false');
}

function getMemoryLimitBytes(envName, fallbackMb) {
    const mb = Number.parseInt(process.env[envName] || String(fallbackMb), 10);
    return (Number.isFinite(mb) && mb > 0 ? mb : fallbackMb) * 1024 * 1024;
}

function checkMemoryPressure(req, res, next) {
    const memory = process.memoryUsage().rss;
    const threshold = getMemoryLimitBytes('WEBHOOK_RSS_LIMIT_MB', 330);

    if (memory > threshold) {
        console.warn(`[MemoryGuard] Throttling webhook | RSS: ${(memory / 1024 / 1024).toFixed(2)}MB > ${(threshold / 1024 / 1024).toFixed(0)}MB`);
        return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Server memory pressure, please retry later',
            retryAfter: 5
        });
    }
    next();
}

function verifyWebhookSecret(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return next();

    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== secret) {
        console.warn('[Webhook] Unauthorized request rejected');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

router.post('/', checkMemoryPressure, verifyWebhookSecret, async (req, res) => {
    const payload = req.body;
    const heliusId = req.headers['x-helius-id'];

    const payloadSize = JSON.stringify(req.body).length;
    console.log(`[Webhook] Request received | Size: ${(payloadSize / 1024).toFixed(2)}KB | Batch: ${Array.isArray(payload) ? payload.length : 0} | Helius-Id: ${heliusId || 'none'}`);

    if (!Array.isArray(payload) || payload.length === 0) {
        return res.status(200).json({ received: true, queued: 0 });
    }

    const signatures = payload.map(
        (item) => item?.signature ?? item?.transaction?.signatures?.[0] ?? null
    );

    const queueState = await enqueueWebhookSignatures(signatures);

    return res.status(200).json({
        received: true,
        queued: queueState.queued,
        queueDepth: queueState.queueDepth,
    });
});

module.exports = router;

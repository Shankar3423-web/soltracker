'use strict';

const express = require('express');
const router = express.Router();

const {
    enqueueWebhookSignatures,
    startIngestWorker,
} = require('../services/ingestQueueService');

startIngestWorker();

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

router.post('/', verifyWebhookSecret, async (req, res) => {
    const payload = req.body;
    const heliusId = req.headers['x-helius-id'];

    console.log(`[Webhook] Request received | Batch size: ${Array.isArray(payload) ? payload.length : 0} | Helius-Id: ${heliusId || 'none'}`);

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

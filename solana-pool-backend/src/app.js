'use strict';
const express = require('express');
const decodeRoute = require('./routes/decodeRoute');
const poolsRoute = require('./routes/poolsRoute');
const webhookRoute = require('./routes/webhookRoute');

const app = express();

app.use(express.json({ limit: '10mb' })); // webhooks can be large (multi-tx batches)

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Live webhook receiver — Helius posts directly here (zero extra RPC calls)
app.use('/webhook', webhookRoute);

// Manual decode endpoint — kept for Postman / testing
app.use('/decode', decodeRoute);

// Read-only API for frontend
app.use('/pools', poolsRoute);

// Global error handler
app.use((err, _req, res, _next) => {
    console.error('[GlobalError]', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
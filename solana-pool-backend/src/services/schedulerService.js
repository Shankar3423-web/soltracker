'use strict';

const https = require('https');
const http = require('http');
const { aggregateAllPools } = require('./aggregationService');
const { refreshAllLiquidity } = require('./liquidityService');

let started = false;

const ENABLE_AGGREGATION_JOBS = process.env.ENABLE_AGGREGATION_JOBS !== 'false';
const ENABLE_LIQUIDITY_REFRESH = process.env.ENABLE_LIQUIDITY_REFRESH !== 'false';
const ENABLE_KEEP_ALIVE = process.env.ENABLE_KEEP_ALIVE !== 'false';

function startKeepAlive() {
    if (!ENABLE_KEEP_ALIVE) {
        console.log('[KeepAlive] Disabled by ENABLE_KEEP_ALIVE=false');
        return;
    }

    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        console.log('[KeepAlive] RENDER_EXTERNAL_URL not set - skipping');
        return;
    }

    const pingUrl = url.replace(/\/$/, '') + '/health';
    const client = pingUrl.startsWith('https') ? https : http;

    function ping() {
        client.get(pingUrl, (res) => {
            console.log('[KeepAlive] Pinged /health ->', res.statusCode);
        }).on('error', (err) => {
            console.warn('[KeepAlive] Ping error:', err.message);
        });
    }

    setInterval(ping, 14 * 60 * 1000);
    console.log('[KeepAlive] Self-ping every 14min ->', pingUrl);
}

function startScheduler() {
    if (started) return;
    started = true;

    console.log('[Scheduler] Starting background jobs...');

    if (ENABLE_AGGREGATION_JOBS) {
        setTimeout(() => {
            aggregateAllPools().catch(() => { });
        }, 10_000);

        setInterval(() => {
            aggregateAllPools().catch(() => { });
        }, 5 * 60_000);
    } else {
        console.log('[Scheduler] Aggregation jobs disabled by ENABLE_AGGREGATION_JOBS=false');
    }

    if (ENABLE_LIQUIDITY_REFRESH) {
        setTimeout(() => {
            refreshAllLiquidity().catch(() => { });
        }, 30_000);

        setInterval(() => {
            refreshAllLiquidity().catch(() => { });
        }, 10 * 60_000);
    } else {
        console.log('[Scheduler] Liquidity refresh disabled by ENABLE_LIQUIDITY_REFRESH=false');
    }

    startKeepAlive();
    console.log('[Scheduler] Aggregation every 5min, liquidity every 10min');
}

module.exports = { startScheduler };

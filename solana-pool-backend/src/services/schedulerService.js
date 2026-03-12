'use strict';
/**
 * schedulerService.js
 *
 * Jobs:
 *   • Every 5min  → aggregateAllPools()   (was 60s — reduced to save memory)
 *   • Every 10min → refreshAllLiquidity() (was 120s — reduced to save memory)
 *   • Every 14min → self-ping /health     (keeps Render free tier awake)
 */

const https = require('https');
const http = require('http');
const { aggregateAllPools } = require('./aggregationService');
const { refreshAllLiquidity } = require('./liquidityService');

let _started = false;

/* ── Keep Render free tier awake ──────────────────────────────────────────── */
function startKeepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        console.log('[KeepAlive] RENDER_EXTERNAL_URL not set — skipping');
        return;
    }
    const pingUrl = url.replace(/\/$/, '') + '/health';
    const client = pingUrl.startsWith('https') ? https : http;

    function ping() {
        client.get(pingUrl, (res) => {
            console.log('[KeepAlive] Pinged /health →', res.statusCode);
        }).on('error', (e) => {
            console.warn('[KeepAlive] Ping error:', e.message);
        });
    }

    setInterval(ping, 14 * 60 * 1000); // every 14 minutes
    console.log('[KeepAlive] Self-ping every 14min →', pingUrl);
}

/* ── Main scheduler ───────────────────────────────────────────────────────── */
function startScheduler() {
    if (_started) return;
    _started = true;

    console.log('[Scheduler] Starting background jobs...');

    // Delay first run by 10s to let DB settle after startup
    setTimeout(() => {
        aggregateAllPools().catch(() => { });
    }, 10_000);

    // Delay liquidity refresh by 30s — heavier job, run after aggregation
    setTimeout(() => {
        refreshAllLiquidity().catch(() => { });
    }, 30_000);

    // Aggregation every 5 minutes (was 60s — 300s reduces CPU/memory spikes)
    setInterval(() => {
        aggregateAllPools().catch(() => { });
    }, 5 * 60_000);

    // Liquidity every 10 minutes (was 120s — RPC calls are the main memory user)
    setInterval(() => {
        refreshAllLiquidity().catch(() => { });
    }, 10 * 60_000);

    // Keep Render awake
    startKeepAlive();

    console.log('[Scheduler] Aggregation every 5min, liquidity every 10min');
}

module.exports = { startScheduler };
'use strict';

const https = require('https');
const http = require('http');
const { aggregateAllPools } = require('./aggregationService');
const { refreshAllLiquidity } = require('./liquidityService');
const { retryPendingTradeSettlements } = require('./tradeSettlementService');

let started = false;

const ENABLE_AGGREGATION_JOBS = process.env.ENABLE_AGGREGATION_JOBS === 'true';
const ENABLE_LIQUIDITY_REFRESH = process.env.ENABLE_LIQUIDITY_REFRESH === 'true';
const ENABLE_TRADE_SETTLEMENT_RETRY = process.env.ENABLE_TRADE_SETTLEMENT_RETRY !== 'false';
const ENABLE_KEEP_ALIVE = process.env.ENABLE_KEEP_ALIVE !== 'false';

let isAggregating = false;
let isRefreshing = false;
let isSettlingTrades = false;

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
        const runAggregation = async () => {
            if (isAggregating) {
                console.log('[Scheduler] Skip: Aggregation run already in progress');
                return;
            }
            isAggregating = true;
            try {
                await aggregateAllPools();
            } catch (err) {
                console.error('[Scheduler] Aggregation error:', err.message);
            } finally {
                isAggregating = false;
            }
        };

        setTimeout(runAggregation, 10_000);
        setInterval(runAggregation, 5 * 60_000);
    } else {
        console.log('[Scheduler] Aggregation jobs disabled by ENABLE_AGGREGATION_JOBS=false');
    }

    if (ENABLE_LIQUIDITY_REFRESH) {
        const runLiquidity = async () => {
            if (isRefreshing) {
                console.log('[Scheduler] Skip: Liquidity refresh already in progress');
                return;
            }
            isRefreshing = true;
            try {
                await refreshAllLiquidity();
            } catch (err) {
                console.error('[Scheduler] Liquidity refresh error:', err.message);
            } finally {
                isRefreshing = false;
            }
        };

        setTimeout(runLiquidity, 30_000);
        setInterval(runLiquidity, 10 * 60_000);
    } else {
        console.log('[Scheduler] Liquidity refresh disabled by ENABLE_LIQUIDITY_REFRESH=false');
    }

    if (ENABLE_TRADE_SETTLEMENT_RETRY) {
        const runTradeSettlementRetry = async () => {
            if (isSettlingTrades) {
                console.log('[Scheduler] Skip: Trade settlement retry already in progress');
                return;
            }

            isSettlingTrades = true;
            try {
                const settledCount = await retryPendingTradeSettlements(
                    Number.parseInt(process.env.TRADE_SETTLEMENT_RETRY_BATCH_SIZE || '20', 10) || 20
                );

                if (settledCount > 0) {
                    console.log(`[Scheduler] Settled ${settledCount} pending trade(s)`);
                }
            } catch (err) {
                console.error('[Scheduler] Trade settlement retry error:', err.message);
            } finally {
                isSettlingTrades = false;
            }
        };

        setTimeout(runTradeSettlementRetry, 20_000);
        setInterval(
            runTradeSettlementRetry,
            Number.parseInt(process.env.TRADE_SETTLEMENT_RETRY_INTERVAL_MS || '60000', 10) || 60_000
        );
    } else {
        console.log('[Scheduler] Trade settlement retries disabled by ENABLE_TRADE_SETTLEMENT_RETRY=false');
    }

    startKeepAlive();
    if (ENABLE_AGGREGATION_JOBS || ENABLE_LIQUIDITY_REFRESH) {
        console.log('[Scheduler] Aggregation every 5min, liquidity every 10min');
    } else {
        console.log('[Scheduler] Background aggregation/liquidity jobs are disabled');
    }
}

module.exports = { startScheduler };

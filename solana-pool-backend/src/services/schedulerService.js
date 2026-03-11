'use strict';
/**
 * schedulerService.js
 * Background job runner — runs aggregation + liquidity refresh on a timer.
 *
 * Jobs:
 *   • Every 60s  → aggregateAllPools()   (recomputes volume/buys/sells/price)
 *   • Every 120s → refreshAllLiquidity() (fetches on-chain vault balances)
 *
 * Started once by server.js after the DB connection is confirmed.
 * Never throws — all errors are caught inside the individual services.
 */

const { aggregateAllPools } = require('./aggregationService');
const { refreshAllLiquidity } = require('./liquidityService');

let _started = false;

function startScheduler() {
    if (_started) return;
    _started = true;

    console.log('[Scheduler] Starting background jobs...');

    // Run immediately on startup so fresh data is available right away
    aggregateAllPools().catch(() => { });
    refreshAllLiquidity().catch(() => { });

    // Then run on timer
    setInterval(() => {
        aggregateAllPools().catch(() => { });
    }, 60_000);

    setInterval(() => {
        refreshAllLiquidity().catch(() => { });
    }, 120_000);

    console.log('[Scheduler] Aggregation every 60s, liquidity every 120s');
}

module.exports = { startScheduler };
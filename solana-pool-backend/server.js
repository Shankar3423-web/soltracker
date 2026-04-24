require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const server = http.createServer(app);
const { initSocket } = require('./src/services/socketService');
const { verifyTreasuryFeeAccount } = require('./src/services/treasuryService');

// ─── Process-level crash guards ───────────────────────────────────────────────
// These prevent a single failed async operation from killing the entire server.
// Without these, ANY unhandled promise rejection (e.g. a flaky RPC call or a
// DB timeout inside BullMQ worker) will crash Node in production.
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException — server kept alive:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[FATAL] unhandledRejection — server kept alive:', msg);
});
// ──────────────────────────────────────────────────────────────────────────────

// Initialize real-time WebSocket layer
initSocket(server);

const { startScheduler } = require('./src/services/schedulerService');

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Solana Pool Decoder running on port ${PORT}`);
    // Start background aggregation + liquidity jobs
    startScheduler();
    verifyTreasuryFeeAccount();
});

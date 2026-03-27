require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const server = http.createServer(app);
const { initSocket } = require('./src/services/socketService');

// Initialize real-time WebSocket layer
initSocket(server);

const { startScheduler } = require('./src/services/schedulerService');

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Solana Pool Decoder running on port ${PORT}`);
    // Start background aggregation + liquidity jobs
    startScheduler();
});
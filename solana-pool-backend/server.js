'use strict';
require('dotenv').config();

const app = require('./src/app');
const { startScheduler } = require('./src/services/schedulerService');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Solana Pool Decoder running on port ${PORT}`);
    // Start background aggregation + liquidity jobs
    startScheduler();
});
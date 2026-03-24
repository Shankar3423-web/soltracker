'use strict';
require('dotenv').config();
const db = require('../src/config/db');
const { processSwapForCandles } = require('../src/services/ohlcvService');

/**
 * backfill_candles.js
 * Run this ONE TIME to populate historical chart data from existing swaps.
 */

async function backfill() {
    console.log('🚀 [Backfill] Starting historical candle aggregation...');
    
    try {
        // 1. Fetch all existing swaps sorted by time
        const swapsResult = await db.query(
            'SELECT pool_address, price, usd_value, block_time FROM swaps ORDER BY block_time ASC'
        );
        
        const totalSwaps = swapsResult.rows.length;
        console.log(`[Backfill] Found ${totalSwaps} swaps to process.`);

        if (totalSwaps === 0) {
            console.log('[Backfill] No swaps found in database. Nothing to do.');
            return;
        }

        // 2. Process each swap through our real-time aggregation service
        // This will automatically create/update all 1m, 5m, 15m, etc. candles.
        for (let i = 0; i < totalSwaps; i++) {
            const swap = swapsResult.rows[i];
            
            // Re-use our perfect logic from the ohlcvService
            await processSwapForCandles({
                poolAddress: swap.pool_address,
                price: Number(swap.price),
                blockTime: swap.block_time, // already a Date in pg
                usdValue: Number(swap.usd_value || 0)
            });

            // Progress logging for clarity
            if ((i + 1) % 500 === 0 || i === totalSwaps - 1) {
                console.log(`[Backfill] Processed ${i + 1} / ${totalSwaps} swaps...`);
            }
        }

        console.log('✅ [Backfill] Success! All historical candles have been generated.');
        process.exit(0);

    } catch (err) {
        console.error('❌ [Backfill] Fatal error:', err.message);
        process.exit(1);
    }
}

// Ensure database is connected before starting
db.query('SELECT NOW()')
    .then(() => backfill())
    .catch(err => {
        console.error('[Backfill] Could not connect to database:', err.message);
        process.exit(1);
    });

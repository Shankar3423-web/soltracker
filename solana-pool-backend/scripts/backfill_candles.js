'use strict';
require('dotenv').config();

const db = require('../src/config/db');
const { processSwapForCandles } = require('../src/services/ohlcvService');

async function backfill() {
    console.log('[Backfill] Rebuilding candles from existing swaps...');

    try {
        await db.query('DELETE FROM pool_candles');

        const swapsResult = await db.query(`
            SELECT
                pool_address,
                price,
                price_usd,
                usd_value,
                base_amount,
                quote_amount,
                swap_side,
                block_time,
                event_index,
                id
            FROM swaps
            WHERE block_time IS NOT NULL
            ORDER BY block_time ASC, event_index ASC, id ASC
        `);

        const totalSwaps = swapsResult.rows.length;
        console.log(`[Backfill] Found ${totalSwaps} stored swaps.`);

        if (totalSwaps === 0) {
            console.log('[Backfill] No swaps found. Nothing to rebuild.');
            return;
        }

        for (let i = 0; i < totalSwaps; i++) {
            const swap = swapsResult.rows[i];

            await processSwapForCandles({
                poolAddress: swap.pool_address,
                blockTime: swap.block_time,
                priceUsd: swap.price_usd != null ? Number(swap.price_usd) : null,
                priceNative: swap.price != null ? Number(swap.price) : null,
                usdValue: swap.usd_value != null ? Number(swap.usd_value) : 0,
                baseAmount: swap.base_amount != null ? Number(swap.base_amount) : 0,
                quoteAmount: swap.quote_amount != null ? Number(swap.quote_amount) : 0,
                swapSide: swap.swap_side ?? null,
            });

            if ((i + 1) % 500 === 0 || i === totalSwaps - 1) {
                console.log(`[Backfill] Processed ${i + 1} / ${totalSwaps} swaps...`);
            }
        }

        console.log('[Backfill] Candle rebuild complete.');
    } catch (err) {
        console.error('[Backfill] Fatal error:', err.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

db.query('SELECT NOW()')
    .then(() => backfill())
    .catch(async (err) => {
        console.error('[Backfill] Could not connect to database:', err.message);
        try {
            await db.end();
        } catch {}
        process.exit(1);
    });

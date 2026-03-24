'use strict';
require('dotenv').config();
const db = require('../src/config/db');

/**
 * backfill_candles.js — FAST version using batched UPSERTs
 * Processes swaps in chunks of 200, completing much faster.
 */

const RESOLUTIONS = ['1m', '5m', '15m', '30m', '1h', '4h', '24h'];

function getBucket(date, resolution) {
    const d = new Date(date);
    d.setSeconds(0);
    d.setMilliseconds(0);
    const minutes = d.getMinutes();
    const hours   = d.getHours();
    switch (resolution) {
        case '1m':  break;
        case '5m':  d.setMinutes(minutes - (minutes % 5)); break;
        case '15m': d.setMinutes(minutes - (minutes % 15)); break;
        case '30m': d.setMinutes(minutes - (minutes % 30)); break;
        case '1h':  d.setMinutes(0); break;
        case '4h':  d.setMinutes(0); d.setHours(hours - (hours % 4)); break;
        case '24h': d.setMinutes(0); d.setHours(0); break;
    }
    return d;
}

async function backfill() {
    console.log('🚀 [Backfill] Starting FAST historical candle aggregation...');

    try {
        // ① Fetch all swaps with valid price
        const { rows } = await db.query(`
            SELECT pool_address, price, usd_value, block_time 
            FROM swaps 
            WHERE price IS NOT NULL AND price > 0
            ORDER BY block_time ASC
        `);

        const total = rows.length;
        console.log(`[Backfill] Found ${total} swaps to process across ${RESOLUTIONS.length} resolutions.`);
        if (total === 0) { console.log('[Backfill] Nothing to do.'); process.exit(0); }

        // ② Build a flat list of (pool, res, bucket, price, volume) tuples
        const tuples = [];
        for (const swap of rows) {
            const price  = Number(swap.price);
            const volume = Number(swap.usd_value || 0);
            const bt     = new Date(swap.block_time);

            for (const res of RESOLUTIONS) {
                const bucket = getBucket(bt, res);
                tuples.push({ pool: swap.pool_address, res, bucket, price, volume });
            }
        }
        console.log(`[Backfill] ${tuples.length} candle-points to upsert. Processing in chunks…`);

        // ③ CHUNK upserts — 10 at a time (safe for Render free-tier DB limits)
        const CHUNK = 10;
        let done = 0;
        for (let i = 0; i < tuples.length; i += CHUNK) {
            const chunk = tuples.slice(i, i + CHUNK);
            await Promise.all(chunk.map(({ pool, res, bucket, price, volume }) =>
                db.query(`
                    INSERT INTO pool_candles
                        (pool_address, resolution, time_bucket, open_price, high_price, low_price, close_price, volume_usd, tx_count, updated_at)
                    VALUES ($1,$2,$3,$4,$4,$4,$4,$5,1,NOW())
                    ON CONFLICT (pool_address, resolution, time_bucket) DO UPDATE SET
                        high_price  = GREATEST(pool_candles.high_price, EXCLUDED.high_price),
                        low_price   = LEAST(pool_candles.low_price, EXCLUDED.low_price),
                        close_price = EXCLUDED.close_price,
                        volume_usd  = pool_candles.volume_usd + EXCLUDED.volume_usd,
                        tx_count    = pool_candles.tx_count + 1,
                        updated_at  = NOW()
                `, [pool, res, bucket, price, volume])
            ));
            done += chunk.length;
            if (done % 1000 === 0 || done === tuples.length) {
                console.log(`[Backfill] ✓ ${done} / ${tuples.length} upserts done (${Math.round(done/tuples.length*100)}%)`);
            }
        }

        console.log('✅ [Backfill] SUCCESS! All historical candles generated.');
        process.exit(0);
    } catch (err) {
        console.error('❌ [Backfill] Fatal error:', err.message);
        process.exit(1);
    }
}

db.query('SELECT NOW()').then(() => backfill()).catch(err => {
    console.error('[Backfill] DB connection failed:', err.message);
    process.exit(1);
});

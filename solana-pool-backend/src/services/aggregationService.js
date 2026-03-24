'use strict';
/**
 * aggregationService.js
 * Calculates all pool-level stats from the swaps table and writes them
 * into pool_stats.  Called periodically (every 60s) by a background timer.
 *
 * What it computes per pool:
 *   • Latest price          — most recent swap's price field
 *   • Price change 24h %    — ((latest - price_24h_ago) / price_24h_ago) * 100
 *   • Volume 24h / 6h / 1h  — SUM(usd_value) for each window
 *   • tx_count_24h          — COUNT(*) in last 24h
 *   • buys_24h / sells_24h  — split by swap_side
 *   • makers_24h            — COUNT(DISTINCT wallet) in last 24h
 *
 * All queries run against the swaps table directly.
 * pool_stats is the materialised output — frontend only reads pool_stats.
 */

const db = require('../config/db');
const { upsertPoolStats } = require('../repositories/poolStatsRepository');

/**
 * Aggregate stats for every pool that has been active.
 * Optimized for low-memory (512MB) environments like Render Free Tier.
 * Processes pools sequentially to avoid massive memory spikes.
 */
async function aggregateAllPools() {
    try {
        // 1. Get the list of active pool addresses first (filtered to last 24h activity)
        const poolsResult = await db.query(`
            SELECT DISTINCT pool_address 
            FROM swaps 
            WHERE block_time > NOW() - INTERVAL '24 hours'
        `);
        
        const activePools = poolsResult.rows.map(r => r.pool_address);
        console.log(`[Aggregation] Starting batch update for ${activePools.length} active pools...`);

        // 2. Process each pool individually (or in small serial batches)
        // This keeps the Node.js memory footprint very small.
        let updated = 0;
        for (const address of activePools) {
            await aggregatePool(address);
            updated++;
            
            // Optional: tiny delay every 10 pools to yield the event loop
            if (updated % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // 3. Maintenance: Zero out inactive pools (pools that didn't swap in last 24h)
        await db.query(`
            UPDATE pool_stats
            SET volume_24h = 0, volume_6h = 0, volume_1h = 0,
                tx_count_24h = 0, buys_24h = 0, sells_24h = 0,
                makers_24h = 0, updated_at = NOW()
            WHERE pool_address NOT IN (
                SELECT DISTINCT pool_address FROM swaps
                WHERE block_time > NOW() - INTERVAL '24 hours'
            )
        `);

        console.log(`[Aggregation] Finished updating stats for ${updated} pools.`);
        return updated;
    } catch (err) {
        console.error('[Aggregation] aggregateAllPools optimization-run failed:', err.message);
        return 0;
    }
}

/**
 * Aggregate stats for a single specific pool immediately.
 * Called right after a new swap is decoded — gives the API fresh data
 * without waiting for the next background cycle.
 *
 * @param {string} poolAddress
 * @returns {Promise<void>}
 */
async function aggregatePool(poolAddress) {
    try {
        const result = await db.query(`
      WITH recent AS (
        SELECT swap_side, wallet,
               CAST(usd_value AS DOUBLE PRECISION) AS usd_value,
               CAST(price     AS DOUBLE PRECISION) AS price,
               block_time
        FROM swaps
        WHERE pool_address = $1
          AND block_time > NOW() - INTERVAL '24 hours'
      )
      SELECT
        SUM(usd_value)                                                         AS volume_24h,
        SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'  THEN usd_value ELSE 0 END) AS volume_6h,
        SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'   THEN usd_value ELSE 0 END) AS volume_1h,
        COUNT(*)                                                               AS tx_count_24h,
        SUM(CASE WHEN swap_side = 'buy'  THEN 1 ELSE 0 END)                   AS buys_24h,
        SUM(CASE WHEN swap_side = 'sell' THEN 1 ELSE 0 END)                   AS sells_24h,
        COUNT(DISTINCT wallet)                                                 AS makers_24h
      FROM recent
    `, [poolAddress]);

        const row = result.rows[0];
        if (!row) return;

        // Get latest price
        const priceResult = await db.query(
            `SELECT CAST(price AS DOUBLE PRECISION) AS price
       FROM swaps
       WHERE pool_address = $1 AND price IS NOT NULL
       ORDER BY block_time DESC LIMIT 1`,
            [poolAddress]
        );
        const latestPrice = priceResult.rows[0]?.price ?? null;

        // Get price 24h ago for % change
        const oldPriceResult = await db.query(
            `SELECT CAST(price AS DOUBLE PRECISION) AS price
       FROM swaps
       WHERE pool_address = $1 AND price IS NOT NULL
         AND block_time BETWEEN NOW() - INTERVAL '25 hours'
                            AND NOW() - INTERVAL '23 hours'
       ORDER BY block_time DESC LIMIT 1`,
            [poolAddress]
        );
        const oldPrice = oldPriceResult.rows[0]?.price ?? null;
        const priceChange24h = (latestPrice && oldPrice && oldPrice > 0)
            ? Number(((latestPrice - oldPrice) / oldPrice * 100).toFixed(2))
            : null;

        await upsertPoolStats({
            poolAddress,
            price: latestPrice,
            priceChange24h,
            volume24h: Number(row.volume_24h ?? 0),
            volume6h: Number(row.volume_6h ?? 0),
            volume1h: Number(row.volume_1h ?? 0),
            liquidity: null,
            txCount24h: Number(row.tx_count_24h ?? 0),
            buys24h: Number(row.buys_24h ?? 0),
            sells24h: Number(row.sells_24h ?? 0),
            makers24h: Number(row.makers_24h ?? 0),
        });
    } catch (err) {
        console.warn(`[Aggregation] aggregatePool(${poolAddress}) failed:`, err.message);
    }
}

module.exports = { aggregateAllPools, aggregatePool };
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
const { getTokenSupply } = require('./metadataService');
const { getSolPrice } = require('./priceService');
const { WSOL_MINT } = require('../config/constants');

/**
 * Aggregate stats for every pool that had at least one swap in the last 24h.
 * Also refreshes pools with existing stats (volume drops to 0 when no swaps).
 *
 * @returns {Promise<number>} number of pools updated
 */
async function aggregateAllPools() {
    try {
        const result = await db.query(`
      WITH recent AS (
        SELECT
          pool_address,
          TRIM(LOWER(swap_side)) AS side,
          wallet,
          CAST(usd_value AS DOUBLE PRECISION)  AS usd_value,
          CAST(price     AS DOUBLE PRECISION)  AS price,
          block_time
        FROM swaps
        WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
          AND usd_value IS NOT NULL
      ),
      agg AS (
        SELECT
          pool_address,
          SUM(usd_value)                                        AS volume_24h,
          SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '6 hours'  THEN usd_value ELSE 0 END) AS volume_6h,
          SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour'   THEN usd_value ELSE 0 END) AS volume_1h,
          COUNT(*)                                              AS tx_count_24h,
          SUM(CASE WHEN side = 'buy'  THEN 1 ELSE 0 END)       AS buys_24h,
          SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END)       AS sells_24h,
          COUNT(DISTINCT wallet)                                AS makers_24h
        FROM recent
        GROUP BY pool_address
      ),
      latest_price AS (
        SELECT DISTINCT ON (pool_address)
          pool_address,
          price AS current_price,
          block_time
        FROM swaps
        WHERE price IS NOT NULL
        ORDER BY pool_address, block_time DESC
      ),
      price_24h_ago AS (
        SELECT DISTINCT ON (pool_address)
          pool_address,
          price AS old_price
        FROM swaps
        WHERE price IS NOT NULL
          AND block_time BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '25 hours'
                             AND (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '23 hours'
        ORDER BY pool_address, block_time DESC
      )
      SELECT
        agg.pool_address,
        agg.volume_24h,
        agg.volume_6h,
        agg.volume_1h,
        agg.tx_count_24h,
        agg.buys_24h,
        agg.sells_24h,
        agg.makers_24h,
        lp.current_price,
        CASE
          WHEN p24.old_price IS NOT NULL AND p24.old_price > 0
          THEN ROUND(((lp.current_price - p24.old_price) / p24.old_price * 100)::NUMERIC, 2)
          ELSE NULL
        END AS price_change_24h
      FROM agg
      LEFT JOIN latest_price  lp  ON lp.pool_address  = agg.pool_address
      LEFT JOIN price_24h_ago p24 ON p24.pool_address = agg.pool_address
    `);

        let updated = 0;
        for (const row of result.rows) {
            await upsertPoolStats({
                poolAddress: row.pool_address,
                price: row.current_price,
                priceChange24h: row.price_change_24h != null ? Number(row.price_change_24h) : null,
                volume24h: Number(row.volume_24h ?? 0),
                volume6h: Number(row.volume_6h ?? 0),
                volume1h: Number(row.volume_1h ?? 0),
                liquidity: null,   // filled in separately by liquidityService
                txCount24h: Number(row.tx_count_24h ?? 0),
                buys24h: Number(row.buys_24h ?? 0),
                sells24h: Number(row.sells_24h ?? 0),
                makers24h: Number(row.makers_24h ?? 0),
            });
            updated++;
        }

        // Zero out pools that had swaps before but nothing in the last 24h
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

        console.log(`[Aggregation] Updated stats for ${updated} pools`);
        return updated;
    } catch (err) {
        console.error('[Aggregation] aggregateAllPools failed:', err.message);
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
      WITH windows AS (
        SELECT 
           TRIM(LOWER(swap_side)) AS side, 
           wallet, 
           CAST(usd_value AS DOUBLE PRECISION) AS usd_value,
           CAST(price AS DOUBLE PRECISION) AS price,
           block_time
        FROM swaps
        WHERE pool_address = $1 
          AND block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '25 hours'
      ),
      metrics AS (
        SELECT
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes' THEN usd_value ELSE 0 END), 0) AS volume_5m,
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour'    THEN usd_value ELSE 0 END), 0) AS volume_1h,
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '6 hours'   THEN usd_value ELSE 0 END), 0) AS volume_6h,
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'  THEN usd_value ELSE 0 END), 0) AS volume_24h,
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'buy'  THEN usd_value ELSE 0 END), 0) AS buy_volume_24h,
           COALESCE(SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'sell' THEN usd_value ELSE 0 END), 0) AS sell_volume_24h,
           COUNT(*) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours') AS tx_count_24h,
           SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'buy'  THEN 1 ELSE 0 END) AS buys_24h,
           SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'sell' THEN 1 ELSE 0 END) AS sells_24h,
           COUNT(DISTINCT wallet) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours') AS makers_24h,
           COUNT(DISTINCT CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'buy'  THEN wallet END) AS buyers_24h,
           COUNT(DISTINCT CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' AND side = 'sell' THEN wallet END) AS sellers_24h
        FROM windows
      ),
      prices AS (
        SELECT 
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL ORDER BY block_time DESC LIMIT 1) as current_p,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes' ORDER BY block_time DESC LIMIT 1) as p_5m,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour' ORDER BY block_time DESC LIMIT 1) as p_1h,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '6 hours' ORDER BY block_time DESC LIMIT 1) as p_6h,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours' ORDER BY block_time DESC LIMIT 1) as p_24h
      )
      SELECT * FROM metrics, prices;
    `, [poolAddress]);

        const stats = result.rows[0];
        if (!stats) return;

        const latestPrice = stats.current_p;

        // ── CALCULATE MARKET CAP / FDV ───────────────────────────────────────────
        let fdv = null;
        let marketCap = null;
        if (latestPrice && latestPrice > 0) {
            try {
                const poolRes = await db.query(
                    'SELECT base_token_mint, quote_token_mint FROM pools WHERE pool_address = $1 LIMIT 1',
                    [poolAddress]
                );
                const pInfo = poolRes.rows[0];
                if (pInfo) {
                    const supply = await getTokenSupply(pInfo.base_token_mint);
                    if (supply) {
                        let totalValueUsd = supply * latestPrice;
                        if (pInfo.quote_token_mint === WSOL_MINT) {
                            const solPrice = (await getSolPrice()) || 150; 
                            totalValueUsd *= solPrice;
                        }
                        fdv = totalValueUsd;
                        marketCap = fdv;
                    }
                }
            } catch (err) {
                console.warn(`[Aggregation] FDV failed for ${poolAddress}:`, err.message);
            }
        }

        const calcChange = (cur, old) => (cur && old && old > 0) ? Number(((cur - old) / old * 100).toFixed(2)) : null;

        await upsertPoolStats({
            poolAddress,
            price: latestPrice,
            priceChange5m: calcChange(latestPrice, stats.p_5m),
            priceChange1h: calcChange(latestPrice, stats.p_1h),
            priceChange6h: calcChange(latestPrice, stats.p_6h),
            priceChange24h: calcChange(latestPrice, stats.p_24h),
            volume5m: Number(stats.volume_5m || 0),
            volume1h: Number(stats.volume_1h || 0),
            volume6h: Number(stats.volume_6h || 0),
            volume24h: Number(stats.volume_24h || 0),
            buyVolume24h: Number(stats.buy_volume_24h || 0),
            sellVolume24h: Number(stats.sell_volume_24h || 0),
            buyers24h: Number(stats.buyers_24h || 0),
            sellers24h: Number(stats.sellers_24h || 0),
            txCount24h: Number(stats.tx_count_24h || 0),
            buys24h: Number(stats.buys_24h || 0),
            sells24h: Number(stats.sells_24h || 0),
            makers24h: Number(stats.makers_24h || 0),
            fdv,
            marketCap
        });
    } catch (err) {
        console.warn(`[Aggregation] aggregatePool(${poolAddress}) failed:`, err.message);
    }
}

module.exports = { aggregateAllPools, aggregatePool };
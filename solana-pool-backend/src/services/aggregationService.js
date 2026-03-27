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
          -- Volumes
          SUM(usd_value) AS volume_24h,
          SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '6 hours'   THEN usd_value ELSE 0 END) AS volume_6h,
          SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour'    THEN usd_value ELSE 0 END) AS volume_1h,
          SUM(CASE WHEN block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes' THEN usd_value ELSE 0 END) AS volume_5m,
          
          -- Counts
          COUNT(*)                                              AS tx_count_24h,
          COUNT(*) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '6 hours')   AS tx_count_6h,
          COUNT(*) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour')    AS tx_count_1h,
          COUNT(*) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes') AS tx_count_5m,

          -- Buys/Sells
          SUM(CASE WHEN side = 'buy'  THEN 1 ELSE 0 END)       AS buys_24h,
          SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END)       AS sells_24h,
          SUM(CASE WHEN side = 'buy' AND block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour' THEN 1 ELSE 0 END) AS buys_1h,
          SUM(CASE WHEN side = 'sell' AND block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour' THEN 1 ELSE 0 END) AS sells_1h,
          
          -- Makers
          COUNT(DISTINCT wallet)                                AS makers_24h,
          COUNT(DISTINCT wallet) FILTER (WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour')    AS makers_1h,
          
          -- Buyers/Sellers (simplified for global agg)
          COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) AS buyers_24h,
          COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) AS sellers_24h
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
      price_prev AS (
        SELECT DISTINCT ON (pool_address)
          pool_address,
          (SELECT price FROM swaps s2 WHERE s2.pool_address = s.pool_address AND s2.price IS NOT NULL AND s2.block_time <= NOW() - INTERVAL '5 minutes' ORDER BY s2.block_time DESC LIMIT 1) as p_5m,
          (SELECT price FROM swaps s2 WHERE s2.pool_address = s.pool_address AND s2.price IS NOT NULL AND s2.block_time <= NOW() - INTERVAL '1 hour' ORDER BY s2.block_time DESC LIMIT 1) as p_1h,
          (SELECT price FROM swaps s2 WHERE s2.pool_address = s.pool_address AND s2.price IS NOT NULL AND s2.block_time <= NOW() - INTERVAL '6 hours' ORDER BY s2.block_time DESC LIMIT 1) as p_6h,
          (SELECT price FROM swaps s2 WHERE s2.pool_address = s.pool_address AND s2.price IS NOT NULL AND s2.block_time <= NOW() - INTERVAL '24 hours' ORDER BY s2.block_time DESC LIMIT 1) as p_24h
        FROM (SELECT DISTINCT pool_address FROM recent) s
      )
      SELECT
        agg.*,
        lp.current_price,
        pp.p_5m, pp.p_1h, pp.p_6h, pp.p_24h
      FROM agg
      LEFT JOIN latest_price lp ON lp.pool_address = agg.pool_address
      LEFT JOIN price_prev pp ON pp.pool_address = agg.pool_address
    `);

        let updated = 0;
        for (const row of result.rows) {
            const cur = row.current_price;
            const calc = (old) => (cur && old && old > 0) ? Number(((cur - old) / old * 100).toFixed(2)) : null;

            await upsertPoolStats({
                poolAddress: row.pool_address,
                price: cur,
                priceChange5m: calc(row.p_5m),
                priceChange1h: calc(row.p_1h),
                priceChange6h: calc(row.p_6h),
                priceChange24h: calc(row.p_24h),
                volume5m: Number(row.volume_5m ?? 0),
                volume1h: Number(row.volume_1h ?? 0),
                volume6h: Number(row.volume_6h ?? 0),
                volume24h: Number(row.volume_24h ?? 0),
                txCount5m: Number(row.tx_count_5m ?? 0),
                txCount1h: Number(row.tx_count_1h ?? 0),
                txCount6h: Number(row.tx_count_6h ?? 0),
                txCount24h: Number(row.tx_count_24h ?? 0),
                buys1h: Number(row.buys_1h ?? 0),
                buys24h: Number(row.buys_24h ?? 0),
                sells1h: Number(row.sells_1h ?? 0),
                sells24h: Number(row.sells_24h ?? 0),
                makers1h: Number(row.makers_1h ?? 0),
                makers24h: Number(row.makers_24h ?? 0),
                buyers24h: Number(row.buyers_24h ?? 0),
                sellers24h: Number(row.sellers_24h ?? 0),
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
          AND block_time > NOW() - INTERVAL '25 hours'
      ),
      metrics AS (
        SELECT
           -- Volumes
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '5 minutes' THEN usd_value ELSE 0 END), 0) AS volume_5m,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'    THEN usd_value ELSE 0 END), 0) AS volume_1h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'   THEN usd_value ELSE 0 END), 0) AS volume_6h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '24 hours'  THEN usd_value ELSE 0 END), 0) AS volume_24h,
           
           -- Buy Volumes
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'buy' THEN usd_value ELSE 0 END), 0) AS buy_volume_5m,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'buy' THEN usd_value ELSE 0 END), 0) AS buy_volume_1h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'buy' THEN usd_value ELSE 0 END), 0) AS buy_volume_6h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'buy' THEN usd_value ELSE 0 END), 0) AS buy_volume_24h,
           
           -- Sell Volumes
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'sell' THEN usd_value ELSE 0 END), 0) AS sell_volume_5m,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'sell' THEN usd_value ELSE 0 END), 0) AS sell_volume_1h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'sell' THEN usd_value ELSE 0 END), 0) AS sell_volume_6h,
           COALESCE(SUM(CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'sell' THEN usd_value ELSE 0 END), 0) AS sell_volume_24h,

           -- TX Counts
           COUNT(*) FILTER (WHERE block_time > NOW() - INTERVAL '5 minutes') AS tx_count_5m,
           COUNT(*) FILTER (WHERE block_time > NOW() - INTERVAL '1 hour')    AS tx_count_1h,
           COUNT(*) FILTER (WHERE block_time > NOW() - INTERVAL '6 hours')   AS tx_count_6h,
           COUNT(*) FILTER (WHERE block_time > NOW() - INTERVAL '24 hours')  AS tx_count_24h,

           -- Buys
           SUM(CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'buy' THEN 1 ELSE 0 END) AS buys_5m,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'buy' THEN 1 ELSE 0 END) AS buys_1h,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'buy' THEN 1 ELSE 0 END) AS buys_6h,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'buy' THEN 1 ELSE 0 END) AS buys_24h,
           
           -- Sells
           SUM(CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'sell' THEN 1 ELSE 0 END) AS sells_5m,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'sell' THEN 1 ELSE 0 END) AS sells_1h,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'sell' THEN 1 ELSE 0 END) AS sells_6h,
           SUM(CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'sell' THEN 1 ELSE 0 END) AS sells_24h,

           -- Makers
           COUNT(DISTINCT wallet) FILTER (WHERE block_time > NOW() - INTERVAL '5 minutes') AS makers_5m,
           COUNT(DISTINCT wallet) FILTER (WHERE block_time > NOW() - INTERVAL '1 hour')    AS makers_1h,
           COUNT(DISTINCT wallet) FILTER (WHERE block_time > NOW() - INTERVAL '6 hours')   AS makers_6h,
           COUNT(DISTINCT wallet) FILTER (WHERE block_time > NOW() - INTERVAL '24 hours')  AS makers_24h,

           -- Buyers
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'buy' THEN wallet END) AS buyers_5m,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'buy' THEN wallet END) AS buyers_1h,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'buy' THEN wallet END) AS buyers_6h,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'buy' THEN wallet END) AS buyers_24h,

           -- Sellers
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '5 minutes' AND side = 'sell' THEN wallet END) AS sellers_5m,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '1 hour'    AND side = 'sell' THEN wallet END) AS sellers_1h,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '6 hours'   AND side = 'sell' THEN wallet END) AS sellers_6h,
           COUNT(DISTINCT CASE WHEN block_time > NOW() - INTERVAL '24 hours'  AND side = 'sell' THEN wallet END) AS sellers_24h
        FROM windows
      ),
      prices AS (
        SELECT 
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL ORDER BY block_time DESC LIMIT 1) as current_p,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= NOW() - INTERVAL '5 minutes' ORDER BY block_time DESC LIMIT 1) as p_5m,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= NOW() - INTERVAL '1 hour' ORDER BY block_time DESC LIMIT 1) as p_1h,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= NOW() - INTERVAL '6 hours' ORDER BY block_time DESC LIMIT 1) as p_6h,
           (SELECT CAST(price AS DOUBLE PRECISION) FROM swaps WHERE pool_address = $1 AND price IS NOT NULL AND block_time <= NOW() - INTERVAL '24 hours' ORDER BY block_time DESC LIMIT 1) as p_24h
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
            txCount5m: Number(stats.tx_count_5m || 0),
            txCount1h: Number(stats.tx_count_1h || 0),
            txCount6h: Number(stats.tx_count_6h || 0),
            txCount24h: Number(stats.tx_count_24h || 0),
            buys5m: Number(stats.buys_5m || 0),
            buys1h: Number(stats.buys_1h || 0),
            buys6h: Number(stats.buys_6h || 0),
            buys24h: Number(stats.buys_24h || 0),
            sells5m: Number(stats.sells_5m || 0),
            sells1h: Number(stats.sells_1h || 0),
            sells6h: Number(stats.sells_6h || 0),
            sells24h: Number(stats.sells_24h || 0),
            buyVolume5m: Number(stats.buy_volume_5m || 0),
            buyVolume1h: Number(stats.buy_volume_1h || 0),
            buyVolume6h: Number(stats.buy_volume_6h || 0),
            buyVolume24h: Number(stats.buy_volume_24h || 0),
            sellVolume5m: Number(stats.sell_volume_5m || 0),
            sellVolume1h: Number(stats.sell_volume_1h || 0),
            sellVolume6h: Number(stats.sell_volume_6h || 0),
            sellVolume24h: Number(stats.sell_volume_24h || 0),
            makers5m: Number(stats.makers_5m || 0),
            makers1h: Number(stats.makers_1h || 0),
            makers6h: Number(stats.makers_6h || 0),
            makers24h: Number(stats.makers_24h || 0),
            buyers5m: Number(stats.buyers_5m || 0),
            buyers1h: Number(stats.buyers_1h || 0),
            buyers6h: Number(stats.buyers_6h || 0),
            buyers24h: Number(stats.buyers_24h || 0),
            sellers5m: Number(stats.sellers_5m || 0),
            sellers1h: Number(stats.sellers_1h || 0),
            sellers6h: Number(stats.sellers_6h || 0),
            sellers24h: Number(stats.sellers_24h || 0),
            fdv,
            marketCap
        });
    } catch (err) {
        console.warn(`[Aggregation] aggregatePool(${poolAddress}) failed:`, err.message);
    }
}

module.exports = { aggregateAllPools, aggregatePool };
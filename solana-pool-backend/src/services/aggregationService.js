'use strict';
/**
 * aggregationService.js — SIMPLIFIED v2
 * Only calculates 24h metrics as requested.
 */

const db = require('../config/db');
const { upsertPoolStats } = require('../repositories/poolStatsRepository');
const { getTokenSupply } = require('./metadataService');
const { getSolPrice } = require('./priceService');
const { WSOL_MINT } = require('../config/constants');

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
          SUM(usd_value) AS volume_24h,
          COUNT(*)       AS tx_count_24h,
          COUNT(*) FILTER (WHERE side = 'buy')  AS buys_24h,
          COUNT(*) FILTER (WHERE side = 'sell') AS sells_24h,
          SUM(CASE WHEN side = 'buy'  THEN usd_value ELSE 0 END) AS buy_volume_24h,
          SUM(CASE WHEN side = 'sell' THEN usd_value ELSE 0 END) AS sell_volume_24h,
          COUNT(DISTINCT wallet) AS makers_24h,
          COUNT(DISTINCT CASE WHEN side = 'buy'  THEN wallet END) AS buyers_24h,
          COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) AS sellers_24h
        FROM recent
        GROUP BY pool_address
      ),
      latest AS (
        SELECT DISTINCT ON (pool_address)
          pool_address,
          price AS current_price
        FROM swaps
        WHERE price IS NOT NULL
        ORDER BY pool_address, block_time DESC
      )
      SELECT
        agg.*,
        l.current_price
      FROM agg
      LEFT JOIN latest l ON l.pool_address = agg.pool_address
    `);

        let updated = 0;
        for (const row of result.rows) {
            await upsertPoolStats({
                poolAddress: row.pool_address,
                price: parseFloat(row.current_price || 0),
                volume24h: parseFloat(row.volume_24h || 0),
                txCount24h: parseInt(row.tx_count_24h || 0),
                buys24h: parseInt(row.buys_24h || 0),
                sells24h: parseInt(row.sells_24h || 0),
                buyVolume24h: parseFloat(row.buy_volume_24h || 0),
                sellVolume24h: parseFloat(row.sell_volume_24h || 0),
                makers24h: parseInt(row.makers_24h || 0),
                buyers24h: parseInt(row.buyers_24h || 0),
                sellers24h: parseInt(row.sellers_24h || 0),
            });
            updated++;
        }

        console.log(`[Aggregation] Updated stats for ${updated} pools.`);
        return updated;
    } catch (err) {
        console.error('[Aggregation] aggregateAllPools failed:', err.message);
        return 0;
    }
}

async function aggregatePool(poolAddress) {
    try {
        const result = await db.query(`
      WITH recent AS (
        SELECT
          swap_side,
          wallet,
          CAST(usd_value AS DOUBLE PRECISION) AS usd_value,
          CAST(price AS DOUBLE PRECISION) AS price,
          block_time
        FROM swaps
        WHERE pool_address = $1 
          AND block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
      ),
      metrics AS (
        SELECT
           SUM(usd_value) AS volume_24h,
           COUNT(*)       AS tx_count_24h,
           COUNT(*) FILTER (WHERE swap_side = 'buy')  AS buys_24h,
           COUNT(*) FILTER (WHERE swap_side = 'sell') AS sells_24h,
           SUM(CASE WHEN swap_side = 'buy'  THEN usd_value ELSE 0 END) AS buy_volume_24h,
           SUM(CASE WHEN swap_side = 'sell' THEN usd_value ELSE 0 END) AS sell_volume_24h,
           COUNT(DISTINCT wallet) AS makers_24h,
           COUNT(DISTINCT CASE WHEN swap_side = 'buy' THEN wallet END) AS buyers_24h,
           COUNT(DISTINCT CASE WHEN swap_side = 'sell' THEN wallet END) AS sellers_24h
        FROM recent
      ),
      price AS (
        SELECT price as current_p FROM swaps WHERE pool_address = $1 ORDER BY block_time DESC LIMIT 1
      )
      SELECT * FROM metrics, price;
    `, [poolAddress]);

        const stats = result.rows[0];
        if (!stats) return;

        // FDV / Mkt Cap
        let fdv = null;
        if (stats.current_p) {
            const poolRes = await db.query('SELECT base_token_mint, quote_token_mint FROM pools WHERE pool_address = $1 LIMIT 1', [poolAddress]);
            const pInfo = poolRes.rows[0];
            if (pInfo) {
                const supply = await getTokenSupply(pInfo.base_token_mint);
                if (supply) {
                    let totalValueUsd = supply * stats.current_p;
                    if (pInfo.quote_token_mint === WSOL_MINT) {
                        const solPrice = (await getSolPrice()) || 150;
                        totalValueUsd *= solPrice;
                    }
                    fdv = totalValueUsd;
                }
            }
        }

        await upsertPoolStats({
            poolAddress,
            price: parseFloat(stats.current_p || 0),
            volume24h: Number(stats.volume_24h || 0),
            txCount24h: Number(stats.tx_count_24h || 0),
            buys24h: Number(stats.buys_24h || 0),
            sells24h: Number(stats.sells_24h || 0),
            buyVolume24h: Number(stats.buy_volume_24h || 0),
            sellVolume24h: Number(stats.sell_volume_24h || 0),
            makers24h: Number(stats.makers_24h || 0),
            buyers24h: Number(stats.buyers_24h || 0),
            sellers24h: Number(stats.sellers_24h || 0),
            fdv: fdv,
            marketCap: fdv
        });
    } catch (err) {
        console.warn(`[Aggregation] aggregatePool failed for ${poolAddress}:`, err.message);
    }
}

module.exports = { aggregateAllPools, aggregatePool };
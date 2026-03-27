'use strict';
/**
 * poolStatsRepository.js
 * Database operations for the `pool_stats` table.
 */

const db = require('../config/db');

async function upsertPoolStats({
    poolAddress,
    price = null,
    priceChange5m = null,
    priceChange1h = null,
    priceChange6h = null,
    priceChange24h = null,
    volume5m = 0,
    volume1h = 0,
    volume6h = 0,
    volume24h = 0,
    txCount5m = 0,
    txCount1h = 0,
    txCount6h = 0,
    txCount24h = 0,
    buys5m = 0,
    buys1h = 0,
    buys6h = 0,
    buys24h = 0,
    sells5m = 0,
    sells1h = 0,
    sells6h = 0,
    sells24h = 0,
    buyVolume5m = 0,
    buyVolume1h = 0,
    buyVolume6h = 0,
    buyVolume24h = 0,
    sellVolume5m = 0,
    sellVolume1h = 0,
    sellVolume6h = 0,
    sellVolume24h = 0,
    makers5m = 0,
    makers1h = 0,
    makers6h = 0,
    makers24h = 0,
    buyers5m = 0,
    buyers1h = 0,
    buyers6h = 0,
    buyers24h = 0,
    sellers5m = 0,
    sellers1h = 0,
    sellers6h = 0,
    sellers24h = 0,
    liquidity = null,
    fdv = null,
    marketCap = null,
}) {
    const r = await db.query(
        `INSERT INTO pool_stats
       (pool_address, price,
        price_change_5m, price_change_1h, price_change_6h, price_change_24h,
        volume_5m, volume_1h, volume_6h, volume_24h,
        tx_count_5m, tx_count_1h, tx_count_6h, tx_count_24h,
        buys_5m, buys_1h, buys_6h, buys_24h,
        sells_5m, sells_1h, sells_6h, sells_24h,
        buy_volume_5m, buy_volume_1h, buy_volume_6h, buy_volume_24h,
        sell_volume_5m, sell_volume_1h, sell_volume_6h, sell_volume_24h,
        makers_5m, makers_1h, makers_6h, makers_24h,
        buyers_5m, buyers_1h, buyers_6h, buyers_24h,
        sellers_5m, sellers_1h, sellers_6h, sellers_24h,
        liquidity, fdv, market_cap, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45, NOW())
       ON CONFLICT (pool_address) DO UPDATE SET
        price            = EXCLUDED.price,
        price_change_5m  = EXCLUDED.price_change_5m,
        price_change_1h  = EXCLUDED.price_change_1h,
        price_change_6h  = EXCLUDED.price_change_6h,
        price_change_24h = EXCLUDED.price_change_24h,
        volume_5m        = EXCLUDED.volume_5m,
        volume_1h        = EXCLUDED.volume_1h,
        volume_6h        = EXCLUDED.volume_6h,
        volume_24h       = EXCLUDED.volume_24h,
        tx_count_5m      = EXCLUDED.tx_count_5m,
        tx_count_1h      = EXCLUDED.tx_count_1h,
        tx_count_6h      = EXCLUDED.tx_count_6h,
        tx_count_24h     = EXCLUDED.tx_count_24h,
        buys_5m          = EXCLUDED.buys_5m,
        buys_1h          = EXCLUDED.buys_1h,
        buys_6h          = EXCLUDED.buys_6h,
        buys_24h         = EXCLUDED.buys_24h,
        sells_5m         = EXCLUDED.sells_5m,
        sells_1h         = EXCLUDED.sells_1h,
        sells_6h         = EXCLUDED.sells_6h,
        sells_24h        = EXCLUDED.sells_24h,
        buy_volume_5m    = EXCLUDED.buy_volume_5m,
        buy_volume_1h    = EXCLUDED.buy_volume_1h,
        buy_volume_6h    = EXCLUDED.buy_volume_6h,
        buy_volume_24h   = EXCLUDED.buy_volume_24h,
        sell_volume_5m   = EXCLUDED.sell_volume_5m,
        sell_volume_1h   = EXCLUDED.sell_volume_1h,
        sell_volume_6h   = EXCLUDED.sell_volume_6h,
        sell_volume_24h  = EXCLUDED.sell_volume_24h,
        makers_5m        = EXCLUDED.makers_5m,
        makers_1h        = EXCLUDED.makers_1h,
        makers_6h        = EXCLUDED.makers_6h,
        makers_24h       = EXCLUDED.makers_24h,
        buyers_5m        = EXCLUDED.buyers_5m,
        buyers_1h        = EXCLUDED.buyers_1h,
        buyers_6h        = EXCLUDED.buyers_6h,
        buyers_24h       = EXCLUDED.buyers_24h,
        sellers_5m       = EXCLUDED.sellers_5m,
        sellers_1h       = EXCLUDED.sellers_1h,
        sellers_6h       = EXCLUDED.sellers_6h,
        sellers_24h      = EXCLUDED.sellers_24h,
        liquidity        = EXCLUDED.liquidity,
        fdv              = EXCLUDED.fdv,
        market_cap       = EXCLUDED.market_cap,
        updated_at       = NOW()
      RETURNING *`,
        [
            poolAddress, price,
            priceChange5m, priceChange1h, priceChange6h, priceChange24h,
            volume5m, volume1h, volume6h, volume24h,
            txCount5m, txCount1h, txCount6h, txCount24h,
            buys5m, buys1h, buys6h, buys24h,
            sells5m, sells1h, sells6h, sells24h,
            buyVolume5m, buyVolume1h, buyVolume6h, buyVolume24h,
            sellVolume5m, sellVolume1h, sellVolume6h, sellVolume24h,
            makers5m, makers1h, makers6h, makers24h,
            buyers5m, buyers1h, buyers6h, buyers24h,
            sellers5m, sellers1h, sellers6h, sellers24h,
            liquidity, fdv, marketCap
        ]
    );
    return r.rows[0];
}

async function getPoolStats(poolAddress) {
    const r = await db.query(
        'SELECT * FROM pool_stats WHERE pool_address = $1 LIMIT 1',
        [poolAddress]
    );
    return r.rows[0] ?? null;
}

async function getPoolStatsByDex(dexId, limit = 100, offset = 0) {
    const r = await db.query(
        `SELECT
       ps.*,
       p.base_token_mint,
       p.quote_token_mint,
       p.base_symbol,
       p.quote_symbol,
       d.name        AS dex_name,
       bt.symbol     AS base_symbol_t,
       bt.name       AS base_name,
       bt.logo_url   AS base_logo,
       qt.symbol     AS quote_symbol_t,
       qt.name       AS quote_name,
       qt.logo_url   AS quote_logo
     FROM pool_stats ps
     JOIN pools  p  ON p.pool_address = ps.pool_address
     JOIN dexes  d  ON d.id           = p.dex_id
     LEFT JOIN tokens bt ON bt.mint   = p.base_token_mint
     LEFT JOIN tokens qt ON qt.mint   = p.quote_token_mint
     WHERE p.dex_id = $1
     ORDER BY ps.volume_24h DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
        [dexId, limit, offset]
    );
    return r.rows;
}

module.exports = { upsertPoolStats, getPoolStats, getPoolStatsByDex };
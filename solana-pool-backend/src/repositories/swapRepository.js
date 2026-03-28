'use strict';

const db = require('../config/db');
const { roundDecimal } = require('../utils/helpers');

async function insertSwap({
    signature,
    eventIndex = 0,
    poolAddress,
    dexId,
    wallet,
    baseAmount,
    quoteAmount,
    price,
    usdValue,
    priceUsd = null,
    priceSol = null,
    quotePriceUsd = null,
    swapSide,
    classification,
    slot,
    blockTime,
}) {
    const result = await db.query(
        `INSERT INTO swaps
        (signature, event_index, pool_address, dex_id, wallet,
         base_amount, quote_amount, price, usd_value,
         price_usd, price_sol, quote_price_usd,
         swap_side, classification, slot, block_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (signature, pool_address, event_index) DO NOTHING
        RETURNING *`,
        [
            signature,
            eventIndex,
            poolAddress,
            dexId,
            wallet ?? null,
            roundDecimal(baseAmount),
            roundDecimal(quoteAmount),
            roundDecimal(price),
            roundDecimal(usdValue, 6),
            roundDecimal(priceUsd),
            roundDecimal(priceSol),
            roundDecimal(quotePriceUsd),
            swapSide,
            classification,
            slot ?? null,
            blockTime ?? null,
        ]
    );

    return result.rows[0] ?? null;
}

async function swapExists(signature, poolAddress, eventIndex = 0) {
    const result = await db.query(
        `SELECT 1
         FROM swaps
         WHERE signature = $1
           AND pool_address = $2
           AND event_index = $3
         LIMIT 1`,
        [signature, poolAddress, eventIndex]
    );
    return result.rows.length > 0;
}

module.exports = { insertSwap, swapExists };

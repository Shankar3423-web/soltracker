'use strict';

const db = require('../config/db');

async function createPendingTrade({
    poolAddress,
    walletAddress,
    inputMint,
    outputMint,
    tradeMode,
    inputSymbol,
    outputSymbol,
    inputAmount,
    expectedOutput,
    quotedOutput,
    minimumOutput,
    feeCollectedSol,
    slippageBps,
    priorityFeeSol,
    priceImpactPct,
    quoteSnapshot,
}) {
    const result = await db.query(
        `INSERT INTO trade_logs
        (
            pool_address,
            wallet_address,
            input_mint,
            output_mint,
            trade_mode,
            input_symbol,
            output_symbol,
            input_amount,
            expected_output,
            quoted_output,
            minimum_output,
            fee_collected_sol,
            slippage_bps,
            priority_fee_sol,
            price_impact_pct,
            quote_snapshot,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending')
        RETURNING *`,
        [
            poolAddress,
            walletAddress,
            inputMint,
            outputMint,
            tradeMode,
            inputSymbol,
            outputSymbol,
            inputAmount,
            expectedOutput,
            quotedOutput,
            minimumOutput,
            feeCollectedSol,
            slippageBps,
            priorityFeeSol,
            priceImpactPct,
            quoteSnapshot ? JSON.stringify(quoteSnapshot) : null,
        ]
    );
    return result.rows[0];
}

async function updateTradeStatus(id, { status, txSignature, errorMessage }) {
    const result = await db.query(
        `UPDATE trade_logs
         SET status = $1,
             tx_signature = $2,
             error_message = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [status, txSignature, errorMessage, id]
    );
    return result.rows[0];
}

async function getTradeById(id) {
    const result = await db.query(`SELECT * FROM trade_logs WHERE id = $1`, [id]);
    return result.rows[0];
}

module.exports = {
    createPendingTrade,
    updateTradeStatus,
    getTradeById
};

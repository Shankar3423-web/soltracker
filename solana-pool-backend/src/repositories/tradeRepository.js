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
    status = 'pending',
    txSignature = null,
    errorMessage = null,
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
            tx_signature,
            error_message,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
            txSignature,
            errorMessage,
            status,
        ]
    );
    return result.rows[0];
}

async function ensureTradeLog({
    id = null,
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
    status = 'pending',
    txSignature = null,
    errorMessage = null,
}) {
    if (id) {
        const result = await db.query(
            `UPDATE trade_logs
             SET pool_address = COALESCE($2, pool_address),
                 wallet_address = COALESCE($3, wallet_address),
                 input_mint = COALESCE($4, input_mint),
                 output_mint = COALESCE($5, output_mint),
                 trade_mode = COALESCE($6, trade_mode),
                 input_symbol = COALESCE($7, input_symbol),
                 output_symbol = COALESCE($8, output_symbol),
                 input_amount = COALESCE($9, input_amount),
                 expected_output = COALESCE($10, expected_output),
                 quoted_output = COALESCE($11, quoted_output),
                 minimum_output = COALESCE($12, minimum_output),
                 fee_collected_sol = COALESCE($13, fee_collected_sol),
                 slippage_bps = COALESCE($14, slippage_bps),
                 priority_fee_sol = COALESCE($15, priority_fee_sol),
                 price_impact_pct = COALESCE($16, price_impact_pct),
                 quote_snapshot = COALESCE($17, quote_snapshot),
                 status = COALESCE($18, status),
                 tx_signature = COALESCE($19, tx_signature),
                 error_message = COALESCE($20, error_message),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                id,
                poolAddress ?? null,
                walletAddress ?? null,
                inputMint ?? null,
                outputMint ?? null,
                tradeMode ?? null,
                inputSymbol ?? null,
                outputSymbol ?? null,
                inputAmount ?? null,
                expectedOutput ?? null,
                quotedOutput ?? null,
                minimumOutput ?? null,
                feeCollectedSol ?? null,
                slippageBps ?? null,
                priorityFeeSol ?? null,
                priceImpactPct ?? null,
                quoteSnapshot ? JSON.stringify(quoteSnapshot) : null,
                status ?? null,
                txSignature ?? null,
                errorMessage ?? null,
            ]
        );

        if (result.rows[0]) {
            return result.rows[0];
        }
    }

    return createPendingTrade({
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
        status,
        txSignature,
        errorMessage,
    });
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

async function updateTradeSettlement(id, {
    actualInputAmount,
    actualOutputAmount,
    actualFeeCollectedSol,
    networkFeeSol,
    settledAt,
    txSlot,
    settlementSnapshot,
}) {
    const result = await db.query(
        `UPDATE trade_logs
         SET actual_input_amount = $1,
             actual_output_amount = $2,
             actual_fee_collected_sol = $3,
             network_fee_sol = $4,
             settled_at = $5,
             tx_slot = $6,
             settlement_snapshot = $7,
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [
            actualInputAmount,
            actualOutputAmount,
            actualFeeCollectedSol,
            networkFeeSol,
            settledAt,
            txSlot,
            settlementSnapshot ? JSON.stringify(settlementSnapshot) : null,
            id,
        ]
    );

    return result.rows[0];
}

async function getTradeById(id) {
    const result = await db.query(`SELECT * FROM trade_logs WHERE id = $1`, [id]);
    return result.rows[0];
}

async function getTradesPendingSettlement(limit = 20) {
    const result = await db.query(
        `SELECT id, tx_signature
         FROM trade_logs
         WHERE status = 'success'
           AND tx_signature IS NOT NULL
           AND settled_at IS NULL
         ORDER BY updated_at ASC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

/**
 * Fetch all trade logs for a given wallet address, newest first.
 * Supports pagination via limit + offset.
 */
async function getTradesByWallet(walletAddress, { limit = 50, offset = 0 } = {}) {
    const countResult = await db.query(
        `SELECT COUNT(*) AS total FROM trade_logs WHERE wallet_address = $1`,
        [walletAddress]
    );
    const total = Number(countResult.rows[0].total);

    const result = await db.query(
        `SELECT * FROM trade_logs
         WHERE wallet_address = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [walletAddress, limit, offset]
    );

    return { total, trades: result.rows };
}

module.exports = {
    createPendingTrade,
    ensureTradeLog,
    updateTradeStatus,
    updateTradeSettlement,
    getTradeById,
    getTradesPendingSettlement,
    getTradesByWallet,
};

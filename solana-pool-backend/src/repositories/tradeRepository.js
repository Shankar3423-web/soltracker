'use strict';

const db = require('../config/db');

async function createPendingTrade({
    walletAddress,
    inputMint,
    outputMint,
    inputAmount,
    expectedOutput,
    feeCollectedSol
}) {
    const result = await db.query(
        `INSERT INTO trade_logs
        (wallet_address, input_mint, output_mint, input_amount, expected_output, fee_collected_sol, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        RETURNING *`,
        [walletAddress, inputMint, outputMint, inputAmount, expectedOutput, feeCollectedSol]
    );
    return result.rows[0];
}

async function updateTradeStatus(id, { status, txSignature }) {
    const result = await db.query(
        `UPDATE trade_logs
         SET status = $1, tx_signature = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [status, txSignature, id]
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

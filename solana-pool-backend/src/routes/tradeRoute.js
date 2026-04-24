'use strict';
const express = require('express');
const router = express.Router();
const repo = require('../repositories/tradeRepository');

/**
 * POST /trades/log
 * Create a new pending trade entry.
 */
router.post('/log', async (req, res) => {
    try {
        const {
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
        } = req.body;
        
        if (!walletAddress || !inputMint || !outputMint) {
            return res.status(400).json({ error: 'Missing required trade details' });
        }

        const log = await repo.createPendingTrade({
            poolAddress: poolAddress || null,
            walletAddress,
            inputMint,
            outputMint,
            tradeMode: tradeMode || null,
            inputSymbol: inputSymbol || null,
            outputSymbol: outputSymbol || null,
            inputAmount: inputAmount || 0,
            expectedOutput: expectedOutput || 0,
            quotedOutput: quotedOutput || 0,
            minimumOutput: minimumOutput || 0,
            feeCollectedSol: feeCollectedSol || 0,
            slippageBps: Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : null,
            priorityFeeSol: Number.isFinite(Number(priorityFeeSol)) ? Number(priorityFeeSol) : null,
            priceImpactPct: Number.isFinite(Number(priceImpactPct)) ? Number(priceImpactPct) : null,
            quoteSnapshot: quoteSnapshot || null,
        });

        res.status(201).json(log);
    } catch (err) {
        console.error('[TradeRoute] POST log error:', err.message);
        res.status(500).json({ error: 'Failed to create trade log' });
    }
});

/**
 * PATCH /trades/:id/status
 * Update an existing trade log with a final status and transaction signature.
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, txSignature, errorMessage } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const updated = await repo.updateTradeStatus(id, {
            status, // 'success', 'failed'
            txSignature,
            errorMessage: errorMessage || null,
        });

        if (!updated) {
            return res.status(404).json({ error: 'Trade log not found' });
        }

        res.json(updated);
    } catch (err) {
        console.error('[TradeRoute] PATCH status error:', err.message);
        res.status(500).json({ error: 'Failed to update trade log' });
    }
});

module.exports = router;

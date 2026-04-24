'use strict';
const express = require('express');
const router = express.Router();
const repo = require('../repositories/tradeRepository');
const { settleTradeLog } = require('../services/tradeSettlementService');
const { getPlatformFeeBps, getPlatformFeePercent } = require('../config/tradeConfig');

router.get('/config', (_req, res) => {
    const platformFeeBps = getPlatformFeeBps();
    res.json({
        platformFeeBps,
        platformFeePercent: getPlatformFeePercent(),
    });
});

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
            status,
            txSignature,
            errorMessage,
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
            status: status || 'pending',
            txSignature: txSignature || null,
            errorMessage: errorMessage || null,
        });

        res.status(201).json(log);
    } catch (err) {
        console.error('[TradeRoute] POST log error:', err.message);
        res.status(500).json({ error: 'Failed to create trade log' });
    }
});

router.post('/ensure', async (req, res) => {
    try {
        const {
            id,
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
        } = req.body;

        if (!id && (!walletAddress || !inputMint || !outputMint)) {
            return res.status(400).json({ error: 'Missing required trade details' });
        }

        const ensured = await repo.ensureTradeLog({
            id: id || null,
            poolAddress: poolAddress || null,
            walletAddress: walletAddress || null,
            inputMint: inputMint || null,
            outputMint: outputMint || null,
            tradeMode: tradeMode || null,
            inputSymbol: inputSymbol || null,
            outputSymbol: outputSymbol || null,
            inputAmount: Number.isFinite(Number(inputAmount)) ? Number(inputAmount) : null,
            expectedOutput: Number.isFinite(Number(expectedOutput)) ? Number(expectedOutput) : null,
            quotedOutput: Number.isFinite(Number(quotedOutput)) ? Number(quotedOutput) : null,
            minimumOutput: Number.isFinite(Number(minimumOutput)) ? Number(minimumOutput) : null,
            feeCollectedSol: Number.isFinite(Number(feeCollectedSol)) ? Number(feeCollectedSol) : null,
            slippageBps: Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : null,
            priorityFeeSol: Number.isFinite(Number(priorityFeeSol)) ? Number(priorityFeeSol) : null,
            priceImpactPct: Number.isFinite(Number(priceImpactPct)) ? Number(priceImpactPct) : null,
            quoteSnapshot: quoteSnapshot || null,
            status: status || 'pending',
            txSignature: txSignature || null,
            errorMessage: errorMessage || null,
        });

        res.json(ensured);
    } catch (err) {
        console.error('[TradeRoute] POST ensure error:', err.message);
        res.status(500).json({ error: 'Failed to recover trade log' });
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

/**
 * POST /trades/:id/settle
 * Reconcile a confirmed trade against on-chain transaction data.
 */
router.post('/:id/settle', async (req, res) => {
    try {
        const { id } = req.params;
        const { txSignature } = req.body ?? {};

        const settled = await settleTradeLog(id, txSignature || null);
        if (!settled) {
            return res.status(404).json({ error: 'Trade log not found' });
        }

        res.json(settled);
    } catch (err) {
        console.error('[TradeRoute] POST settle error:', err.message);
        if (err.message === 'Trade log not found') {
            return res.status(404).json({ error: err.message });
        }
        if (err.message === 'Transaction signature is required for settlement') {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: err.message || 'Failed to settle trade log' });
    }
});

module.exports = router;

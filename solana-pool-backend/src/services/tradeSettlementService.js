'use strict';

const { LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const repo = require('../repositories/tradeRepository');
const { getTransaction } = require('./heliusService');
const { WSOL_MINT } = require('../config/constants');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TX_LOOKUP_ATTEMPTS = 5;
const TX_LOOKUP_DELAY_MS = 1500;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAssociatedTokenAddress(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync(
        [
            owner.toBuffer(),
            tokenProgramId.toBuffer(),
            mint.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
}

function accountKeyToString(accountKey) {
    if (!accountKey) return null;
    if (typeof accountKey === 'string') return accountKey;
    if (typeof accountKey.pubkey === 'string') return accountKey.pubkey;
    if (accountKey.pubkey && typeof accountKey.pubkey.toBase58 === 'function') {
        return accountKey.pubkey.toBase58();
    }
    return null;
}

function getAccountKeys(tx) {
    return tx?.transaction?.message?.accountKeys ?? [];
}

function getAccountKeyByIndex(tx, index) {
    const accountKeys = getAccountKeys(tx);
    if (!Number.isInteger(index) || index < 0 || index >= accountKeys.length) return null;
    return accountKeyToString(accountKeys[index]);
}

function getAccountIndex(tx, pubkey) {
    return getAccountKeys(tx).findIndex((accountKey) => accountKeyToString(accountKey) === pubkey);
}

function getUiTokenAmount(balance) {
    const raw = balance?.uiTokenAmount?.uiAmountString ?? balance?.uiTokenAmount?.uiAmount;
    if (raw == null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sumTokenBalances(tx, balances, matcher) {
    return (balances ?? []).reduce((sum, balance) => {
        const accountPubkey = getAccountKeyByIndex(tx, balance.accountIndex);
        if (!matcher(balance, accountPubkey)) return sum;
        return sum + getUiTokenAmount(balance);
    }, 0);
}

function getTokenDeltaByOwnerAndMint(tx, owner, mint) {
    if (!owner || !mint) return null;
    const meta = tx?.meta;
    if (!meta) return null;

    const match = (balance) => balance?.owner === owner && balance?.mint === mint;
    const pre = sumTokenBalances(tx, meta.preTokenBalances, match);
    const post = sumTokenBalances(tx, meta.postTokenBalances, match);
    return post - pre;
}

function getTokenDeltaByAccount(tx, accountPubkey, mint) {
    if (!accountPubkey || !mint) return null;
    const meta = tx?.meta;
    if (!meta) return null;

    const match = (balance, key) => key === accountPubkey && balance?.mint === mint;
    const pre = sumTokenBalances(tx, meta.preTokenBalances, match);
    const post = sumTokenBalances(tx, meta.postTokenBalances, match);
    return post - pre;
}

function getWalletSolDelta(tx, walletAddress) {
    const meta = tx?.meta;
    if (!meta?.preBalances || !meta?.postBalances) return null;

    const walletIndex = getAccountIndex(tx, walletAddress);
    if (walletIndex < 0) return null;

    const pre = meta.preBalances[walletIndex];
    const post = meta.postBalances[walletIndex];
    if (!Number.isFinite(pre) || !Number.isFinite(post)) return null;

    return (post - pre) / LAMPORTS_PER_SOL;
}

function positiveOrNull(value) {
    if (!Number.isFinite(value)) return null;
    return value < 0 ? 0 : value;
}

async function getTransactionWithRetry(signature) {
    let lastError = null;

    for (let attempt = 1; attempt <= TX_LOOKUP_ATTEMPTS; attempt += 1) {
        try {
            return await getTransaction(signature);
        } catch (error) {
            lastError = error;
            const retryable = /not found|not yet confirmed/i.test(error.message || '');
            if (!retryable || attempt === TX_LOOKUP_ATTEMPTS) {
                throw error;
            }
            await sleep(TX_LOOKUP_DELAY_MS);
        }
    }

    throw lastError || new Error(`Unable to load transaction ${signature}`);
}

async function settleTradeLog(id, signatureOverride) {
    const trade = await repo.getTradeById(id);
    if (!trade) {
        throw new Error('Trade log not found');
    }

    const txSignature = signatureOverride || trade.tx_signature;
    if (!txSignature) {
        throw new Error('Transaction signature is required for settlement');
    }

    const tx = await getTransactionWithRetry(txSignature);
    if (tx?.meta?.err) {
        throw new Error(`Transaction ${txSignature} landed with an error`);
    }

    const walletAddress = trade.wallet_address;
    const treasuryWallet = process.env.TREASURY_WALLET || null;
    const walletSolDelta = getWalletSolDelta(tx, walletAddress);
    const networkFeeSol = Number.isFinite(tx?.meta?.fee) ? tx.meta.fee / LAMPORTS_PER_SOL : null;

    const userInputTokenDelta = getTokenDeltaByOwnerAndMint(tx, walletAddress, trade.input_mint);
    const userOutputTokenDelta = getTokenDeltaByOwnerAndMint(tx, walletAddress, trade.output_mint);

    let treasuryFeeDelta = null;
    let feeAccount = null;

    if (treasuryWallet) {
        feeAccount = getAssociatedTokenAddress(
            new PublicKey(treasuryWallet),
            new PublicKey(WSOL_MINT)
        ).toBase58();

        treasuryFeeDelta = getTokenDeltaByAccount(tx, feeAccount, WSOL_MINT);
        if (treasuryFeeDelta == null) {
            treasuryFeeDelta = getTokenDeltaByOwnerAndMint(tx, treasuryWallet, WSOL_MINT);
        }
    }

    let actualInputAmount = null;
    if (trade.input_mint === WSOL_MINT) {
        if (walletSolDelta != null && networkFeeSol != null) {
            actualInputAmount = positiveOrNull((-walletSolDelta) - networkFeeSol);
        }
    } else if (userInputTokenDelta != null) {
        actualInputAmount = positiveOrNull(-userInputTokenDelta);
    }

    let actualOutputAmount = null;
    if (trade.output_mint === WSOL_MINT) {
        if (walletSolDelta != null && networkFeeSol != null) {
            actualOutputAmount = positiveOrNull(walletSolDelta + networkFeeSol);
        }
    } else if (userOutputTokenDelta != null) {
        actualOutputAmount = positiveOrNull(userOutputTokenDelta);
    }

    const settledAt = tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();
    const settlementSnapshot = {
        signature: txSignature,
        feeAccount,
        walletSolDelta,
        userInputTokenDelta,
        userOutputTokenDelta,
        treasuryFeeDelta,
        networkFeeSol,
        slot: tx?.slot ?? null,
        blockTime: tx?.blockTime ?? null,
    };

    return repo.updateTradeSettlement(id, {
        actualInputAmount,
        actualOutputAmount,
        actualFeeCollectedSol: treasuryFeeDelta,
        networkFeeSol,
        settledAt,
        txSlot: tx?.slot ?? null,
        settlementSnapshot,
    });
}

async function retryPendingTradeSettlements(limit = 20) {
    const pendingTrades = await repo.getTradesPendingSettlement(limit);
    let settledCount = 0;

    for (const trade of pendingTrades) {
        try {
            await settleTradeLog(trade.id, trade.tx_signature);
            settledCount += 1;
        } catch (error) {
            console.warn(`[TradeSettlement] Retry failed for ${trade.id}:`, error.message);
        }
    }

    return settledCount;
}

module.exports = {
    settleTradeLog,
    retryPendingTradeSettlements,
};

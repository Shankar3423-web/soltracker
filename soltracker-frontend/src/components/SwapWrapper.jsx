import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
    VersionedTransaction,
    LAMPORTS_PER_SOL,
    PublicKey,
} from '@solana/web3.js';
import { getJupiterQuote, getJupiterSwapTransaction } from '../services/jupiterService';
import {
    logTradePending,
    finalizeTradeLog,
    settleTradeLog,
    ensureTradeLog,
    getTradeConfig,
    queueTradeLogRecovery,
    flushQueuedTradeLogRecovery,
    fmtNum,
} from '../utils/api';
import './SwapWrapper.css';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TREASURY = process.env.REACT_APP_TREASURY_WALLET;
const SOL_PRICE_FALLBACK = 150;
const QUOTE_DEBOUNCE_MS = 350;
const QUOTE_REFRESH_MS = 15000;
const PRIORITY_FEE_COMPUTE_UNITS = 250000;
const TOKEN_ACCOUNT_DATA_SIZE = 165;
const NETWORK_FEE_BUFFER_SOL = 0.0001;
const EXECUTION_SAFETY_BUFFER_SOL = 0.0005;
const FINALIZE_POLL_INTERVAL_MS = 1500;
const FINALIZE_POLL_TIMEOUT_MS = 15000;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const DEFAULT_PLATFORM_FEE_BPS = 50;

function toAtomicAmount(value, decimals) {
    const raw = String(value ?? '').trim().replace(/,/g, '');
    if (!raw || !/^\d*\.?\d*$/.test(raw)) return null;

    const [wholePart = '0', fractionalPart = ''] = raw.split('.');
    const safeDecimals = Math.max(0, Number(decimals) || 0);
    const whole = (wholePart || '0').replace(/^0+(?=\d)/, '') || '0';
    const fraction = fractionalPart.slice(0, safeDecimals).padEnd(safeDecimals, '0');

    return `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
}

function fromAtomicAmount(value, decimals) {
    if (value == null || value === '') return 0;

    const raw = String(value).trim();
    const safeDecimals = Math.max(0, Number(decimals) || 0);

    if (!/^\d+$/.test(raw)) {
        const fallback = Number(value);
        return Number.isFinite(fallback) ? fallback / Math.pow(10, safeDecimals) : 0;
    }

    if (safeDecimals === 0) return Number(raw);

    const padded = raw.padStart(safeDecimals + 1, '0');
    const whole = padded.slice(0, -safeDecimals) || '0';
    const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
    const normalized = fraction ? `${whole}.${fraction}` : whole;
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : 0;
}

function formatInputAmount(value, decimals = 9) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';

    return parsed.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: Math.min(Math.max(decimals, 0), 9),
    });
}

function toSlippageBps(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(10000, Math.round(parsed * 100));
}

function buildQuoteSnapshot(quote) {
    if (!quote) return null;

    return {
        inAmount: quote.inAmount ?? null,
        outAmount: quote.outAmount ?? null,
        otherAmountThreshold: quote.otherAmountThreshold ?? null,
        priceImpactPct: quote.priceImpactPct ?? null,
        platformFee: quote.platformFee ?? null,
        swapMode: quote.swapMode ?? null,
        routePlanCount: Array.isArray(quote.routePlan) ? quote.routePlan.length : 0,
        contextSlot: quote.contextSlot ?? null,
        timeTaken: quote.timeTaken ?? null,
    };
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPlatformFeePercent(platformFeeBps) {
    const percentage = (platformFeeBps || 0) / 100;
    return Number.isInteger(percentage)
        ? `${percentage}%`
        : `${percentage.toFixed(2).replace(/\.?0+$/, '')}%`;
}

export default function SwapWrapper({ pool }) {
    const { connection } = useConnection();
    const { publicKey, signTransaction, sendTransaction, connected } = useWallet();
    const { setVisible } = useWalletModal();

    const [mode, setMode] = useState('buy');
    const [amount, setAmount] = useState('0.1');
    const [slippage, setSlippage] = useState('1');
    const [priorityFee, setPriorityFee] = useState('0.002');
    const [protection, setProtection] = useState(true);

    const [showSettings, setShowSettings] = useState(false);
    const [tempPriority, setTempPriority] = useState(priorityFee);
    const [tempProtection, setTempProtection] = useState(protection);

    const [quote, setQuote] = useState(null);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [quoteError, setQuoteError] = useState('');
    const [swapLoading, setSwapLoading] = useState(false);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [solBalance, setSolBalance] = useState(0);
    const [tokenBalance, setTokenBalance] = useState(0);
    const [executionReserveSol, setExecutionReserveSol] = useState(0);
    const [platformFeeBps, setPlatformFeeBps] = useState(DEFAULT_PLATFORM_FEE_BPS);

    const [activeAmountPreset, setActiveAmountPreset] = useState('0.1');
    const [activeSlippagePreset, setActiveSlippagePreset] = useState('1');
    const [activeSellPercent, setActiveSellPercent] = useState(null);

    const quoteTimerRef = useRef(null);
    const refreshTimerRef = useRef(null);
    const quoteRequestRef = useRef(0);

    const refreshSolBalance = useCallback(async () => {
        if (!publicKey || !connected) {
            setSolBalance(0);
            return 0;
        }

        try {
            const balanceLamports = await connection.getBalance(publicKey, 'confirmed');
            const nextBalance = balanceLamports / LAMPORTS_PER_SOL;
            setSolBalance(nextBalance);
            return nextBalance;
        } catch (error) {
            console.error('Balance fetch error:', error);
            return 0;
        }
    }, [connection, publicKey, connected]);

    const refreshTokenBalance = useCallback(async () => {
        if (!publicKey || !connected || !pool.baseMint) {
            setTokenBalance(0);
            return 0;
        }

        try {
            const mintPubkey = new PublicKey(pool.baseMint);
            const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPubkey }, 'confirmed');
            let total = 0;
            for (const { account } of accounts.value) {
                total += account.data.parsed.info.tokenAmount.uiAmount || 0;
            }
            setTokenBalance(total);
            return total;
        } catch (error) {
            console.error('Token balance fetch error:', error);
            setTokenBalance(0);
            return 0;
        }
    }, [connection, publicKey, connected, pool.baseMint]);

    useEffect(() => {
        if (!publicKey || !connected) {
            setSolBalance(0);
            return undefined;
        }

        refreshSolBalance();
        const subId = connection.onAccountChange(publicKey, (accountInfo) => {
            setSolBalance(accountInfo.lamports / LAMPORTS_PER_SOL);
        });

        return () => connection.removeAccountChangeListener(subId);
    }, [publicKey, connected, connection, refreshSolBalance]);

    useEffect(() => {
        if (!publicKey || !connected || !pool.baseMint) {
            setTokenBalance(0);
            return undefined;
        }

        let cancelled = false;
        const refreshCurrentTokenBalance = async () => {
            try {
                await refreshTokenBalance();
            } catch (error) {
                console.error('Token balance refresh error:', error);
            }
        };

        refreshCurrentTokenBalance();

        const subscriptionId = connection.onProgramAccountChange(
            TOKEN_PROGRAM_ID,
            () => {
                if (cancelled) return;
                refreshCurrentTokenBalance();
            },
            'confirmed',
            [
                { dataSize: TOKEN_ACCOUNT_DATA_SIZE },
                { memcmp: { offset: 0, bytes: pool.baseMint } },
                { memcmp: { offset: 32, bytes: publicKey.toBase58() } },
            ]
        );

        const intervalId = setInterval(refreshCurrentTokenBalance, 15000);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
            connection.removeProgramAccountChangeListener(subscriptionId).catch(() => {});
        };
    }, [connection, publicKey, connected, pool.baseMint, refreshTokenBalance]);

    const inputMint = mode === 'buy' ? SOL_MINT : pool.baseMint;
    const outputMint = mode === 'buy' ? pool.baseMint : SOL_MINT;
    const inputDecimals = mode === 'buy' ? 9 : (pool.baseDecimals ?? 9);
    const outputDecimals = mode === 'buy' ? (pool.baseDecimals ?? 9) : 9;

    useEffect(() => {
        const fallbackReserve = (Number.parseFloat(priorityFee) || 0) + NETWORK_FEE_BUFFER_SOL + EXECUTION_SAFETY_BUFFER_SOL;
        let cancelled = false;

        const estimateExecutionReserve = async () => {
            let nextReserve = fallbackReserve;

            if (publicKey && connected && mode === 'buy' && outputMint && outputMint !== SOL_MINT) {
                try {
                    const outputTokenAta = getAssociatedTokenAddress(publicKey, new PublicKey(outputMint));
                    const outputTokenAtaInfo = await connection.getAccountInfo(outputTokenAta, 'confirmed');

                    if (!outputTokenAtaInfo) {
                        const ataRentLamports = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_DATA_SIZE);
                        nextReserve += ataRentLamports / LAMPORTS_PER_SOL;
                    }
                } catch (error) {
                    console.error('Execution reserve estimate error:', error);
                }
            }

            if (!cancelled) {
                setExecutionReserveSol(nextReserve);
            }
        };

        estimateExecutionReserve();

        return () => {
            cancelled = true;
        };
    }, [connection, connected, mode, outputMint, priorityFee, publicKey]);

    const clearQuoteTimers = useCallback(() => {
        if (quoteTimerRef.current) {
            clearTimeout(quoteTimerRef.current);
            quoteTimerRef.current = null;
        }

        if (refreshTimerRef.current) {
            clearInterval(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }
    }, []);

    const resetQuoteState = useCallback(() => {
        quoteRequestRef.current += 1;
        setQuote(null);
        setQuoteError('');
        setQuoteLoading(false);
    }, []);

    const ensureTreasuryFeeAccount = useCallback(async () => {
        if (platformFeeBps <= 0) {
            return null;
        }

        if (!TREASURY) {
            throw new Error('Treasury wallet is not configured.');
        }

        const treasuryOwner = new PublicKey(TREASURY);
        const wsolMint = new PublicKey(SOL_MINT);
        const feeAccount = getAssociatedTokenAddress(treasuryOwner, wsolMint);
        const existing = await connection.getAccountInfo(feeAccount, 'confirmed');

        if (!existing) {
            throw new Error('Treasury fee account is not initialized. Set up the treasury WSOL account before enabling live trades.');
        }

        return feeAccount.toBase58();
    }, [connection, platformFeeBps]);

    const getFreshQuote = useCallback(async (overrideAmount) => {
        const requestedAmount = String(overrideAmount ?? amount ?? '').trim();
        const numAmount = Number.parseFloat(requestedAmount);

        if (!requestedAmount || !Number.isFinite(numAmount) || numAmount <= 0 || !inputMint || !outputMint) {
            throw new Error('Enter a valid amount to fetch a live quote.');
        }

        const atomicAmount = toAtomicAmount(requestedAmount, inputDecimals);
        if (!atomicAmount || atomicAmount === '0') {
            throw new Error('Enter a valid amount to fetch a live quote.');
        }

        return getJupiterQuote({
            inputMint,
            outputMint,
            amount: atomicAmount,
            slippageBps: toSlippageBps(slippage),
            restrictIntermediateTokens: protection,
            platformFeeBps,
        });
    }, [amount, inputDecimals, inputMint, outputMint, platformFeeBps, protection, slippage]);

    const fetchQuote = useCallback(async (overrideAmount) => {
        const requestedAmount = String(overrideAmount ?? amount ?? '').trim();
        const numAmount = Number.parseFloat(requestedAmount);

        if (!requestedAmount || !Number.isFinite(numAmount) || numAmount <= 0 || !inputMint || !outputMint) {
            resetQuoteState();
            return;
        }

        const atomicAmount = toAtomicAmount(requestedAmount, inputDecimals);
        if (!atomicAmount || atomicAmount === '0') {
            resetQuoteState();
            return;
        }

        const requestId = ++quoteRequestRef.current;
        setQuoteLoading(true);

        try {
            const nextQuote = await getFreshQuote(requestedAmount);

            if (requestId !== quoteRequestRef.current) return;

            setQuote(nextQuote);
            setQuoteError('');
        } catch (error) {
            if (requestId !== quoteRequestRef.current) return;

            console.error('Quote error:', error);
            setQuote(null);
            setQuoteError(error.message || 'Unable to fetch live quote.');
        } finally {
            if (requestId === quoteRequestRef.current) {
                setQuoteLoading(false);
            }
        }
    }, [amount, getFreshQuote, inputDecimals, inputMint, outputMint, resetQuoteState]);

    const submitSwapTransaction = useCallback(async (transaction) => {
        if (typeof signTransaction === 'function') {
            const signed = await signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3,
            });

            return {
                signature,
                recentBlockhash: signed.message.recentBlockhash,
            };
        }

        if (typeof sendTransaction === 'function') {
            const signature = await sendTransaction(transaction, connection, {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3,
            });

            return {
                signature,
                recentBlockhash: transaction.message.recentBlockhash,
            };
        }

        throw new Error('Wallet cannot sign or send transactions from this browser session.');
    }, [connection, sendTransaction, signTransaction]);

    const waitForTransactionFinalization = useCallback(async (signature) => {
        const startedAt = Date.now();

        while ((Date.now() - startedAt) < FINALIZE_POLL_TIMEOUT_MS) {
            const statusResponse = await connection.getSignatureStatuses([signature], {
                searchTransactionHistory: true,
            });
            const chainStatus = statusResponse?.value?.[0];

            if (chainStatus?.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(chainStatus.err)}`);
            }

            if (chainStatus?.confirmationStatus === 'finalized') {
                return true;
            }

            await sleep(FINALIZE_POLL_INTERVAL_MS);
        }

        return false;
    }, [connection]);

    useEffect(() => {
        const numAmount = Number.parseFloat(amount);
        if (!Number.isFinite(numAmount) || numAmount <= 0) {
            clearQuoteTimers();
            resetQuoteState();
            return undefined;
        }

        clearQuoteTimers();

        quoteTimerRef.current = setTimeout(() => {
            fetchQuote();
            refreshTimerRef.current = setInterval(() => fetchQuote(), QUOTE_REFRESH_MS);
        }, QUOTE_DEBOUNCE_MS);

        return clearQuoteTimers;
    }, [amount, mode, slippage, inputMint, outputMint, fetchQuote, clearQuoteTimers, resetQuoteState]);

    useEffect(() => () => {
        clearQuoteTimers();
        quoteRequestRef.current += 1;
    }, [clearQuoteTimers]);

    useEffect(() => {
        let cancelled = false;

        const loadTradeConfig = async () => {
            try {
                const config = await getTradeConfig();
                if (!cancelled && Number.isFinite(Number(config?.platformFeeBps))) {
                    setPlatformFeeBps(Math.max(0, Math.min(10000, Number(config.platformFeeBps))));
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Trade config fetch error:', error);
                }
            }
        };

        loadTradeConfig();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const flushRecoveryQueue = async () => {
            try {
                await flushQueuedTradeLogRecovery();
            } catch (error) {
                if (!cancelled) {
                    console.error('Queued trade-log recovery flush error:', error);
                }
            }
        };

        flushRecoveryQueue();
        const intervalId = setInterval(flushRecoveryQueue, 30000);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, []);

    const handleSellPercent = (pctStr) => {
        const pct = Number.parseInt(pctStr, 10) / 100;
        if (!tokenBalance || tokenBalance <= 0) return;

        const sellAmount = tokenBalance * pct;
        setActiveSellPercent(pctStr);
        setActiveAmountPreset(null);
        setQuoteError('');
        setAmount(formatInputAmount(sellAmount, pool.baseDecimals ?? 9));
    };

    const handleBuyPreset = (value) => {
        setActiveAmountPreset(String(value));
        setActiveSellPercent(null);
        setQuoteError('');
        setAmount(String(value));
    };

    const handleSlippagePreset = (value) => {
        setActiveSlippagePreset(String(value));
        setQuoteError('');
        setSlippage(String(value));
    };

    const outputSymbol = mode === 'buy' ? (pool.baseSymbol || 'TOKEN') : 'SOL';
    const inputSymbol = mode === 'buy' ? 'SOL' : (pool.baseSymbol || 'TOKEN');

    const quotedOutputNormalized = quote ? fromAtomicAmount(quote.outAmount, outputDecimals) : 0;
    const minimumOutputNormalized = quote ? fromAtomicAmount(quote.otherAmountThreshold ?? quote.outAmount, outputDecimals) : 0;
    const receiveAmountNormalized = minimumOutputNormalized || quotedOutputNormalized;
    const priceImpactPct = Number.parseFloat(quote?.priceImpactPct ?? '');

    const tokenPriceUsd = pool.stats?.priceUsd || 0;
    const solPriceUsd = tokenPriceUsd && pool.stats?.priceNative
        ? tokenPriceUsd / pool.stats.priceNative
        : SOL_PRICE_FALLBACK;

    const usdValue = mode === 'buy'
        ? receiveAmountNormalized * tokenPriceUsd
        : receiveAmountNormalized * solPriceUsd;

    const formatReceiveAmount = (value) => {
        if (!value || value === 0) return '0';
        if (value >= 1000000) return fmtNum(value, 2);
        if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (value >= 1) return value.toFixed(2);
        if (value >= 0.001) return value.toFixed(4);
        return value.toFixed(6);
    };

    const openSettings = () => {
        setTempPriority(priorityFee);
        setTempProtection(protection);
        setShowSettings(true);
    };

    const saveSettings = () => {
        setPriorityFee(tempPriority);
        setProtection(tempProtection);
        setShowSettings(false);
    };

    const switchMode = (newMode) => {
        if (newMode === mode) return;

        clearQuoteTimers();
        resetQuoteState();
        setMode(newMode);
        setActiveAmountPreset(newMode === 'buy' ? '0.1' : null);
        setActiveSellPercent(null);
        setAmount(newMode === 'buy' ? '0.1' : '');
        setStatus({ type: '', msg: '' });
    };

    const handleSwap = useCallback(async () => {
        if (!connected) {
            setVisible(true);
            return;
        }

        if (!publicKey || (!sendTransaction && !signTransaction) || !amount) {
            setStatus({ type: 'error', msg: 'Wallet is not ready to sign this transaction.' });
            return;
        }

        setSwapLoading(true);
        setStatus({ type: 'loading', msg: 'Refreshing live quote...' });

        let logId = null;
        let signature = null;
        let swapConfirmed = false;
        let tradeLogPayload = null;

        try {
            const numericAmount = Number.parseFloat(amount);
            if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
                throw new Error('Enter a valid amount before swapping.');
            }

            if (mode === 'sell' && numericAmount > tokenBalance) {
                throw new Error(`Insufficient ${inputSymbol} balance.`);
            }

            const feeAccount = await ensureTreasuryFeeAccount();
            const liveQuote = await getFreshQuote(amount);
            setQuote(liveQuote);
            setQuoteError('');

            const liveQuotedOutputNormalized = fromAtomicAmount(liveQuote.outAmount, outputDecimals);
            const liveMinimumOutputNormalized = fromAtomicAmount(liveQuote.otherAmountThreshold ?? liveQuote.outAmount, outputDecimals);
            const livePriceImpactPct = Number.parseFloat(liveQuote?.priceImpactPct ?? '');
            const requiredSolForExecution = executionReserveSol + (mode === 'buy' ? numericAmount : 0);

            if (mode === 'buy' && solBalance < requiredSolForExecution) {
                throw new Error(`Not enough SOL. Keep about ${fmtNum(executionReserveSol, executionReserveSol < 1 ? 4 : 2)} SOL free for fees and account setup.`);
            }

            if (mode === 'sell' && solBalance < executionReserveSol) {
                throw new Error(`Not enough SOL to pay network fees. Keep about ${fmtNum(executionReserveSol, executionReserveSol < 1 ? 4 : 2)} SOL free before selling.`);
            }

            const quotedPlatformFee = fromAtomicAmount(liveQuote?.platformFee?.amount, 9);
            const feePercent = platformFeeBps / 10000;
            const feeCollected = quotedPlatformFee > 0
                ? quotedPlatformFee
                : mode === 'buy'
                    ? numericAmount * feePercent
                    : liveQuotedOutputNormalized * feePercent;

            tradeLogPayload = {
                poolAddress: pool.poolAddress ?? null,
                walletAddress: publicKey.toBase58(),
                inputMint,
                outputMint,
                tradeMode: mode,
                inputSymbol,
                outputSymbol,
                inputAmount: numericAmount,
                expectedOutput: liveQuotedOutputNormalized,
                quotedOutput: liveQuotedOutputNormalized,
                minimumOutput: liveMinimumOutputNormalized,
                feeCollectedSol: feeCollected,
                slippageBps: toSlippageBps(slippage),
                priorityFeeSol: Number.parseFloat(priorityFee) || 0,
                priceImpactPct: Number.isFinite(livePriceImpactPct) ? livePriceImpactPct : null,
                quoteSnapshot: buildQuoteSnapshot(liveQuote),
            };

            try {
                const log = await logTradePending(tradeLogPayload);
                logId = log.id;
            } catch (logError) {
                console.error('Trade log start error:', logError);
            }

            setStatus({ type: 'loading', msg: 'Initiating swap...' });

            const priorityFeeSol = Number.parseFloat(priorityFee) || 0;
            const microLamports = Math.floor((priorityFeeSol * 1e15) / PRIORITY_FEE_COMPUTE_UNITS);
            const { swapTransaction, lastValidBlockHeight } = await getJupiterSwapTransaction(
                liveQuote,
                publicKey.toBase58(),
                microLamports,
                feeAccount,
                TREASURY,
                platformFeeBps
            );

            const transactionBuf = Uint8Array.from(atob(swapTransaction), (char) => char.charCodeAt(0));
            const transaction = VersionedTransaction.deserialize(transactionBuf);
            const submission = await submitSwapTransaction(transaction);
            signature = submission.signature;
            setStatus({ type: 'loading', msg: 'Swap sent. Waiting for confirmation...' });

            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash: submission.recentBlockhash,
                lastValidBlockHeight,
            }, 'confirmed');

            if (confirmation.value?.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
            }

            swapConfirmed = true;
            let finalizedTradeLog = false;

            if (logId) {
                try {
                    await finalizeTradeLog(logId, 'success', signature, null);
                    finalizedTradeLog = true;
                } catch (logError) {
                    console.error('Trade log finalize error:', logError);
                }
            }

            if (!logId || !finalizedTradeLog) {
                const recoveredLog = await ensureTradeLog({
                    id: logId,
                    ...tradeLogPayload,
                    status: 'success',
                    txSignature: signature,
                    errorMessage: null,
                }).catch((logError) => {
                    console.error('Trade log recovery error:', logError);
                    queueTradeLogRecovery({
                        id: logId,
                        ...tradeLogPayload,
                        status: 'success',
                        txSignature: signature,
                        errorMessage: null,
                    });
                    return null;
                });

                if (recoveredLog?.id) {
                    logId = recoveredLog.id;
                }
            }

            setStatus({ type: 'loading', msg: 'Swap confirmed. Finalizing on-chain details...' });
            const finalizedOnChain = await waitForTransactionFinalization(signature).catch((finalizeError) => {
                console.error('Transaction finalization check error:', finalizeError);
                return false;
            });

            await Promise.allSettled([
                refreshSolBalance(),
                refreshTokenBalance(),
                logId ? settleTradeLog(logId, signature) : Promise.resolve(null),
            ]);

            setStatus({
                type: 'success',
                msg: finalizedOnChain ? 'Swap successful!' : 'Swap confirmed. Settlement is syncing.',
            });
            setAmount('');
        } catch (error) {
            console.error('Swap execution error:', error);
            setStatus({ type: 'error', msg: error.message || 'Swap failed' });

            if (tradeLogPayload && !swapConfirmed) {
                let loggedFailure = false;

                if (logId) {
                    try {
                        await finalizeTradeLog(logId, 'failed', signature, error.message || 'Swap failed');
                        loggedFailure = true;
                    } catch (logError) {
                        console.error('Trade log failure finalize error:', logError);
                    }
                }

                if (!loggedFailure) {
                    await ensureTradeLog({
                        id: logId,
                        ...tradeLogPayload,
                        status: 'failed',
                        txSignature: signature,
                        errorMessage: error.message || 'Swap failed',
                    }).catch((logError) => {
                        console.error('Trade log failure recovery error:', logError);
                        queueTradeLogRecovery({
                            id: logId,
                            ...tradeLogPayload,
                            status: 'failed',
                            txSignature: signature,
                            errorMessage: error.message || 'Swap failed',
                        });
                    });
                }
            }
        } finally {
            setSwapLoading(false);
        }
    }, [
        amount,
        connected,
        connection,
        ensureTreasuryFeeAccount,
        executionReserveSol,
        getFreshQuote,
        inputMint,
        inputSymbol,
        mode,
        outputDecimals,
        outputMint,
        outputSymbol,
        platformFeeBps,
        priorityFee,
        publicKey,
        refreshSolBalance,
        refreshTokenBalance,
        sendTransaction,
        signTransaction,
        solBalance,
        setVisible,
        slippage,
        submitSwapTransaction,
        tokenBalance,
        waitForTransactionFinalization,
        pool.poolAddress,
    ]);

    const currentBalance = mode === 'buy' ? solBalance : tokenBalance;
    const currentAmount = Number.parseFloat(amount);
    const hasAmount = Number.isFinite(currentAmount) && currentAmount > 0;
    const priorityFeeValue = Number.parseFloat(priorityFee) || 0;
    const baseExecutionReserveSol = priorityFeeValue + NETWORK_FEE_BUFFER_SOL + EXECUTION_SAFETY_BUFFER_SOL;
    const includesTokenAccountSetup = executionReserveSol > (baseExecutionReserveSol + 0.000001);
    const insufficientSwapInput = connected && hasAmount && mode === 'buy' && currentAmount > solBalance;
    const insufficientTokenInput = connected && hasAmount && mode === 'sell' && currentAmount > tokenBalance;
    const insufficientSolForExecution = connected && (
        mode === 'buy'
            ? (currentAmount + executionReserveSol) > solBalance
            : executionReserveSol > solBalance
    );
    const insufficientBalance = insufficientSwapInput || insufficientTokenInput || insufficientSolForExecution;
    const actionDisabled = swapLoading || quoteLoading || (connected && (!hasAmount || !quote || insufficientBalance));
    const actionLabel = swapLoading
        ? 'PROCESSING...'
        : !connected
            ? 'CONNECT WALLET'
            : quoteLoading
                ? 'FETCHING QUOTE...'
            : insufficientTokenInput
                ? `INSUFFICIENT ${inputSymbol}`
            : insufficientSwapInput
                ? 'INSUFFICIENT SOL'
            : insufficientSolForExecution
                ? `KEEP ${fmtNum(executionReserveSol, executionReserveSol < 1 ? 4 : 2)} SOL FOR FEES`
                : mode === 'buy'
                    ? 'BUY'
                    : 'SELL';

    return (
        <div className="sw">
            <div className="sw-tabs">
                <button
                    className={`sw-tab ${mode === 'buy' ? 'active buy' : ''}`}
                    onClick={() => switchMode('buy')}
                >
                    <div className="sw-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" fill="#bad22d" stroke="none" />
                            <polyline points="16 12 12 8 8 12" stroke="white" />
                            <line x1="12" y1="16" x2="12" y2="8" stroke="white" />
                        </svg>
                    </div>
                    Buy
                </button>
                <button
                    className={`sw-tab ${mode === 'sell' ? 'active sell' : ''}`}
                    onClick={() => switchMode('sell')}
                >
                    <div className="sw-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" fill="#ff4747" stroke="none" />
                            <polyline points="8 12 12 16 16 12" stroke="white" />
                            <line x1="12" y1="8" x2="12" y2="16" stroke="white" />
                        </svg>
                    </div>
                    Sell
                </button>
            </div>

            <div className="sw-input-card">
                <div className="sw-input-main">
                    <div className="sw-token-badge">
                        {mode === 'buy' ? (
                            <>
                                <svg width="20" height="20" viewBox="0 0 128 128">
                                    <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="#9945FF" />
                                    <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="url(#sol-grad-sw)" />
                                    <defs>
                                        <linearGradient id="sol-grad-sw" x1="12.3" y1="12.3" x2="115.7" y2="115.7" gradientUnits="userSpaceOnUse">
                                            <stop offset="0" stopColor="#9945ff" />
                                            <stop offset=".5" stopColor="#14f195" />
                                            <stop offset="1" stopColor="#14f195" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                                SOL
                            </>
                        ) : (
                            <>
                                {pool.baseLogo ? <img src={pool.baseLogo} alt="" /> : <span className="sw-token-letter">{(pool.baseSymbol || '?')[0]}</span>}
                                {pool.baseSymbol}
                            </>
                        )}
                    </div>
                    <input
                        className="sw-amount-input"
                        type="number"
                        value={amount}
                        placeholder="0.0"
                        onChange={(event) => {
                            setAmount(event.target.value);
                            setQuoteError('');
                            setActiveAmountPreset(null);
                            setActiveSellPercent(null);
                        }}
                    />
                    {connected && currentBalance > 0 ? (
                        <div className="sw-balance-badge" title={`Balance: ${currentBalance}`}>
                            {fmtNum(currentBalance, currentBalance < 1 ? 4 : 2)}
                        </div>
                    ) : null}
                </div>
                <div className="sw-grid">
                    {mode === 'buy'
                        ? [0.1, 0.25, 0.5, 1, 2, 5].map((value) => (
                            <button
                                key={value}
                                className={`sw-grid-btn ${activeAmountPreset === String(value) ? 'active' : ''}`}
                                onClick={() => handleBuyPreset(value)}
                            >
                                {value}
                            </button>
                        ))
                        : ['10%', '20%', '25%', '50%', '75%', '100%'].map((value) => (
                            <button
                                key={value}
                                className={`sw-grid-btn ${activeSellPercent === value ? 'active' : ''}`}
                                onClick={() => handleSellPercent(value)}
                            >
                                {value}
                            </button>
                        ))}
                </div>
            </div>

            <div className="sw-input-card">
                <div className="sw-input-main">
                    <span className="sw-label-text">Slippage %</span>
                    <input
                        className="sw-slippage-val"
                        type="number"
                        value={slippage}
                        onChange={(event) => {
                            setSlippage(event.target.value);
                            setQuoteError('');
                            setActiveSlippagePreset(null);
                        }}
                    />
                </div>
                <div className="sw-grid sw-grid-5">
                    {[1, 2, 3, 5, 10].map((value) => (
                        <button
                            key={value}
                            className={`sw-grid-btn ${activeSlippagePreset === String(value) ? 'active' : ''}`}
                            onClick={() => handleSlippagePreset(value)}
                        >
                            {value}%
                        </button>
                    ))}
                </div>
            </div>

            <div className="sw-action-row">
                <button
                    className={`sw-action-btn ${mode}`}
                    onClick={handleSwap}
                    disabled={actionDisabled}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {actionLabel}
                </button>
                <button className="sw-settings-btn" onClick={openSettings}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="4" y1="21" x2="4" y2="14" />
                        <line x1="4" y1="10" x2="4" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12" y2="3" />
                        <line x1="20" y1="21" x2="20" y2="16" />
                        <line x1="20" y1="12" x2="20" y2="3" />
                        <line x1="2" y1="14" x2="6" y2="14" />
                        <line x1="10" y1="8" x2="14" y2="8" />
                        <line x1="18" y1="16" x2="22" y2="16" />
                    </svg>
                </button>
            </div>

            <div className="sw-footer-info">
                <span className="sw-receive-line">
                    {quote ? (
                        <>
                            {quoteLoading ? <span className="sw-quote-spinner" /> : null}
                            you receive min. <strong>{formatReceiveAmount(receiveAmountNormalized)} {outputSymbol}</strong> (~${fmtNum(usdValue, usdValue < 1 ? 4 : 1)})
                        </>
                    ) : quoteLoading ? (
                        <>
                            <span className="sw-quote-spinner" />
                            fetching quote...
                        </>
                    ) : (
                        <>enter an amount to fetch a live quote</>
                    )}
                </span>
                {quoteError ? <span className="sw-quote-error">{quoteError}</span> : null}
                {quote && quotedOutputNormalized > 0 && minimumOutputNormalized > 0 && quotedOutputNormalized !== minimumOutputNormalized ? (
                    <span className="sw-quote-meta">
                        estimated quote: <strong>{formatReceiveAmount(quotedOutputNormalized)} {outputSymbol}</strong>
                    </span>
                ) : null}
                {Number.isFinite(priceImpactPct) && priceImpactPct > 1 ? (
                    <span className="sw-price-impact">
                        Price impact: {priceImpactPct.toFixed(2)}%
                    </span>
                ) : null}
                <span>execution safety: {protection ? 'on' : 'off'}</span>
                <span>platform fee: {formatPlatformFeePercent(platformFeeBps)}</span>
                <span>
                    execution reserve: ~{fmtNum(executionReserveSol, executionReserveSol < 1 ? 4 : 2)} SOL
                    {includesTokenAccountSetup ? ' including token account setup' : ''}
                </span>
                <div className="sw-priority-shield">
                    priority fee: {priorityFee} SOL
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                </div>
            </div>

            {status.msg ? (
                <div className={`sw-status ${status.type}`} style={{ marginTop: '10px' }}>
                    {status.msg}
                </div>
            ) : null}

            {showSettings ? (
                <div className="ts-overlay">
                    <div className="ts-modal">
                        <div className="ts-header">
                            <h2>Trade Settings</h2>
                            <button className="ts-close" onClick={() => setShowSettings(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="ts-body">
                            <div className="ts-section">
                                <div className="ts-label-row">
                                    <span className="ts-label">Execution safety</span>
                                    <label className="ts-toggle">
                                        <input
                                            type="checkbox"
                                            checked={tempProtection}
                                            onChange={(event) => setTempProtection(event.target.checked)}
                                        />
                                        <span className="ts-slider" />
                                    </label>
                                </div>
                                <p className="ts-desc">
                                    Keeps Jupiter on restricted intermediate-token routes for steadier execution. This improves route safety, but it is <strong>not</strong> a private-relay or MEV shield.
                                </p>
                            </div>

                            <div className="ts-section">
                                <span className="ts-label">Priority fee</span>
                                <div className="sw-input-card" style={{ marginTop: '12px' }}>
                                    <div className="sw-input-main">
                                        <div className="sw-token-badge">
                                            <svg width="20" height="20" viewBox="0 0 128 128">
                                                <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="#9945FF" />
                                                <defs>
                                                    <linearGradient id="b" x1="12.3" y1="12.3" x2="115.7" y2="115.7" gradientUnits="userSpaceOnUse">
                                                        <stop offset="0" stopColor="#9945ff" />
                                                        <stop offset=".5" stopColor="#14f195" />
                                                        <stop offset="1" stopColor="#14f195" />
                                                    </linearGradient>
                                                </defs>
                                            </svg>
                                            SOL
                                        </div>
                                        <input
                                            className="sw-amount-input"
                                            type="number"
                                            value={tempPriority}
                                            onChange={(event) => setTempPriority(event.target.value)}
                                        />
                                    </div>
                                    <div className="sw-grid">
                                        {[0, 0.002, 0.005, 0.01, 0.015, 0.02].map((value) => (
                                            <button key={value} className="sw-grid-btn" onClick={() => setTempPriority(String(value))}>
                                                {value}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="ts-desc">
                                    A higher priority fee will speed up the confirmation of your transactions.
                                </p>
                            </div>
                        </div>
                        <div className="ts-footer">
                            <button className="ts-save" onClick={saveSettings}>Save</button>
                            <button className="ts-cancel" onClick={() => setShowSettings(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getJupiterQuote, getJupiterSwapTransaction } from '../services/jupiterService';
import { logTradePending, finalizeTradeLog, fmtNum } from '../utils/api';
import './SwapWrapper.css';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TREASURY = process.env.REACT_APP_TREASURY_WALLET;
const SOL_PRICE_FALLBACK = 150; // rough fallback

export default function SwapWrapper({ pool }) {
    const { connection } = useConnection();
    const { publicKey, signTransaction, connected } = useWallet();
    const { setVisible } = useWalletModal();

    const [mode, setMode] = useState('buy'); // 'buy' or 'sell'
    const [amount, setAmount] = useState('0.1');
    const [slippage, setSlippage] = useState('1');
    const [priorityFee, setPriorityFee] = useState('0.002');
    const [protection, setProtection] = useState(false);

    const [showSettings, setShowSettings] = useState(false);
    const [tempPriority, setTempPriority] = useState(priorityFee);
    const [tempProtection, setTempProtection] = useState(protection);

    const [quote, setQuote] = useState(null);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [swapLoading, setSwapLoading] = useState(false);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [solBalance, setSolBalance] = useState(0);
    const [tokenBalance, setTokenBalance] = useState(0);

    // Track which preset is active
    const [activeAmountPreset, setActiveAmountPreset] = useState('0.1');
    const [activeSlippagePreset, setActiveSlippagePreset] = useState('1');
    const [activeSellPercent, setActiveSellPercent] = useState(null);

    const quoteTimerRef = useRef(null);
    const refreshTimerRef = useRef(null);

    // ---------- Fetch SOL balance ----------
    useEffect(() => {
        if (!publicKey || !connected) { setSolBalance(0); return; }
        const fetchBalance = async () => {
            try {
                const bal = await connection.getBalance(publicKey);
                setSolBalance(bal / LAMPORTS_PER_SOL);
            } catch (e) { console.error('Balance fetch error:', e); }
        };
        fetchBalance();
        const subId = connection.onAccountChange(publicKey, (acc) => {
            setSolBalance(acc.lamports / LAMPORTS_PER_SOL);
        });
        return () => connection.removeAccountChangeListener(subId);
    }, [publicKey, connected, connection]);

    // ---------- Fetch SPL token balance ----------
    useEffect(() => {
        if (!publicKey || !connected || !pool.baseMint) { setTokenBalance(0); return; }
        let cancelled = false;
        const fetchTokenBal = async () => {
            try {
                const mintPubkey = new PublicKey(pool.baseMint);
                const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPubkey });
                if (cancelled) return;
                let total = 0;
                for (const { account } of accounts.value) {
                    total += account.data.parsed.info.tokenAmount.uiAmount || 0;
                }
                setTokenBalance(total);
            } catch (e) {
                if (!cancelled) setTokenBalance(0);
            }
        };
        fetchTokenBal();
        // Refresh every 15s
        const id = setInterval(fetchTokenBal, 15000);
        return () => { cancelled = true; clearInterval(id); };
    }, [publicKey, connected, connection, pool.baseMint]);

    const inputMint = mode === 'buy' ? SOL_MINT : pool.baseMint;
    const outputMint = mode === 'buy' ? pool.baseMint : SOL_MINT;

    // ---------- Quote Fetch ----------
    const fetchQuote = useCallback(async (overrideAmount) => {
        const numAmount = parseFloat(overrideAmount ?? amount);
        if (!numAmount || numAmount <= 0 || !inputMint || !outputMint) {
            setQuote(null);
            return;
        }
        setQuoteLoading(true);
        try {
            const decimals = mode === 'buy' ? 9 : (pool.baseDecimals ?? 9);
            const atomicAmount = Math.floor(numAmount * Math.pow(10, decimals));
            const q = await getJupiterQuote({
                inputMint,
                outputMint,
                amount: atomicAmount,
                slippageBps: Math.round(parseFloat(slippage) * 100),
                treasuryWallet: TREASURY
            });
            setQuote(q);
        } catch (err) {
            console.error('Quote error:', err);
            setQuote(null);
        } finally {
            setQuoteLoading(false);
        }
    }, [amount, mode, slippage, inputMint, outputMint, pool.baseDecimals]);

    // Debounced quote on input changes
    useEffect(() => {
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
            setQuote(null);
            return;
        }
        // Clear existing timers
        if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
        if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);

        quoteTimerRef.current = setTimeout(() => {
            fetchQuote();
            // Auto-refresh every 15 seconds (like real DEX Screener)
            refreshTimerRef.current = setInterval(() => fetchQuote(), 15000);
        }, 350);

        return () => {
            if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
            if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
        };
    }, [amount, mode, slippage, inputMint, outputMint, fetchQuote]);

    // ---------- Sell percentage handler ----------
    const handleSellPercent = (pctStr) => {
        const pct = parseInt(pctStr) / 100;
        if (!tokenBalance || tokenBalance <= 0) return;
        const sellAmount = tokenBalance * pct;
        setActiveSellPercent(pctStr);
        setActiveAmountPreset(null);
        setAmount(String(sellAmount));
    };

    // ---------- Buy preset handler ----------
    const handleBuyPreset = (val) => {
        setActiveAmountPreset(String(val));
        setActiveSellPercent(null);
        setAmount(String(val));
    };

    // ---------- Slippage preset handler ----------
    const handleSlippagePreset = (val) => {
        setActiveSlippagePreset(String(val));
        setSlippage(String(val));
    };

    // ---------- Swap Execution ----------
    const handleSwap = async () => {
        if (!connected) {
            setVisible(true);
            return;
        }
        if (!quote) return;

        setSwapLoading(true);
        setStatus({ type: 'loading', msg: 'Initiating swap...' });
        let logId = null;

        try {
            const feePercent = 0.005; // 0.5%
            const feeCollected = mode === 'buy'
                ? parseFloat(amount) * feePercent
                : ((quote.outAmount / Math.pow(10, 9)) * feePercent);

            const log = await logTradePending({
                walletAddress: publicKey.toBase58(),
                inputMint,
                outputMint,
                inputAmount: parseFloat(amount),
                expectedOutput: parseFloat(quote.outAmount) / Math.pow(10, mode === 'buy' ? (pool.baseDecimals ?? 9) : 9),
                feeCollectedSol: feeCollected
            });
            logId = log.id;

            const prioSol = parseFloat(priorityFee);
            const microLamports = Math.floor((prioSol * 1e9) / 0.25);

            const { swapTransaction } = await getJupiterSwapTransaction(quote, publicKey.toBase58(), microLamports);

            const transactionBuf = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));
            const transaction = VersionedTransaction.deserialize(transactionBuf);
            const signed = await signTransaction(transaction);

            const signature = await connection.sendRawTransaction(signed.serialize(), {
                skipPreflight: true,
                maxRetries: 2
            });

            await connection.confirmTransaction(signature, 'confirmed');
            await finalizeTradeLog(logId, 'success', signature);

            setStatus({ type: 'success', msg: 'Swap successful!' });
            setAmount('');
        } catch (err) {
            console.error('Swap execution error:', err);
            setStatus({ type: 'error', msg: err.message || 'Swap failed' });
            if (logId) {
                await finalizeTradeLog(logId, 'failed', null).catch(() => {});
            }
        } finally {
            setSwapLoading(false);
        }
    };

    // ---------- Computed values ----------
    const outDecimals = mode === 'buy' ? (pool.baseDecimals ?? 9) : 9;
    const outAmountNormalized = quote
        ? parseFloat(quote.outAmount) / Math.pow(10, outDecimals)
        : 0;

    // USD value of output
    const tokenPriceUsd = pool.stats?.priceUsd || 0;
    const solPriceUsd = tokenPriceUsd && pool.stats?.priceNative
        ? tokenPriceUsd / pool.stats.priceNative
        : SOL_PRICE_FALLBACK;

    const usdValue = mode === 'buy'
        ? outAmountNormalized * tokenPriceUsd
        : outAmountNormalized * solPriceUsd;

    // Format output for display
    const formatReceiveAmount = (val) => {
        if (!val || val === 0) return '0';
        if (val >= 1000000) return fmtNum(val, 2);
        if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (val >= 1) return val.toFixed(2);
        if (val >= 0.001) return val.toFixed(4);
        return val.toFixed(6);
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

    // Reset state when mode switches
    const switchMode = (newMode) => {
        if (newMode === mode) return;
        setMode(newMode);
        setQuote(null);
        setActiveAmountPreset(newMode === 'buy' ? '0.1' : null);
        setActiveSellPercent(null);
        setAmount(newMode === 'buy' ? '0.1' : '');
        setStatus({ type: '', msg: '' });
    };

    const outputSymbol = mode === 'buy' ? pool.baseSymbol : 'SOL';
    const inputSymbol = mode === 'buy' ? 'SOL' : pool.baseSymbol;
    const currentBalance = mode === 'buy' ? solBalance : tokenBalance;

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
                            <line x1="12" y1="16" x2="12" y2="8" stroke="white"/>
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
                            <line x1="12" y1="8" x2="12" y2="16" stroke="white"/>
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
                               <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="#9945FF"/>
                               <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="url(#sol-grad-sw)"/>
                               <defs><linearGradient id="sol-grad-sw" x1="12.3" y1="12.3" x2="115.7" y2="115.7" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#9945ff"/><stop offset=".5" stopColor="#14f195"/><stop offset="1" stopColor="#14f195"/></linearGradient></defs>
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
                        onChange={(e) => {
                            setAmount(e.target.value);
                            setActiveAmountPreset(null);
                            setActiveSellPercent(null);
                        }}
                    />
                    {connected && currentBalance > 0 && (
                        <div className="sw-balance-badge" title={`Balance: ${currentBalance}`}>
                            {fmtNum(currentBalance, currentBalance < 1 ? 4 : 2)}
                        </div>
                    )}
                </div>
                <div className="sw-grid">
                    {mode === 'buy' ? [0.1, 0.25, 0.5, 1, 2, 5].map(val => (
                        <button
                            key={val}
                            className={`sw-grid-btn ${activeAmountPreset === String(val) ? 'active' : ''}`}
                            onClick={() => handleBuyPreset(val)}
                        >
                            {val}
                        </button>
                    )) : ['10%', '20%', '25%', '50%', '75%', '100%'].map(val => (
                        <button
                            key={val}
                            className={`sw-grid-btn ${activeSellPercent === val ? 'active' : ''}`}
                            onClick={() => handleSellPercent(val)}
                        >
                            {val}
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
                        onChange={(e) => {
                            setSlippage(e.target.value);
                            setActiveSlippagePreset(null);
                        }}
                    />
                </div>
                <div className="sw-grid sw-grid-5">
                    {[1, 2, 3, 5, 10].map(val => (
                        <button
                            key={val}
                            className={`sw-grid-btn ${activeSlippagePreset === String(val) ? 'active' : ''}`}
                            onClick={() => handleSlippagePreset(val)}
                        >
                            {val}%
                        </button>
                    ))}
                </div>
            </div>

            <div className="sw-action-row">
                <button
                    className={`sw-action-btn ${mode}`}
                    onClick={handleSwap}
                    disabled={swapLoading}
                >
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                   {swapLoading ? 'PROCESSING...' : connected ? (mode === 'buy' ? 'BUY' : 'SELL') : 'CONNECT WALLET'}
                </button>
                <button className="sw-settings-btn" onClick={openSettings}>
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/></svg>
                </button>
            </div>

            <div className="sw-footer-info">
                 <span className="sw-receive-line">
                     {quoteLoading ? (
                         <>
                             <span className="sw-quote-spinner" />
                             fetching quote...
                         </>
                     ) : (
                         <>
                             you receive min.{' '}
                             <strong>{formatReceiveAmount(outAmountNormalized)} {outputSymbol}</strong>
                             {' '}(~${fmtNum(usdValue, usdValue < 1 ? 4 : 1)})
                         </>
                     )}
                 </span>
                 {quote?.priceImpactPct && parseFloat(quote.priceImpactPct) > 1 && (
                     <span className="sw-price-impact">
                         ⚠ Price Impact: {parseFloat(quote.priceImpactPct).toFixed(2)}%
                     </span>
                 )}
                 <span>platform fee: 0.5%</span>
                 <div className="sw-priority-shield">
                     priority fee: {priorityFee} SOL
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                 </div>
            </div>

            {status.msg && (
                <div className={`sw-status ${status.type}`} style={{marginTop: '10px'}}>
                    {status.msg}
                </div>
            )}

            {/* Trade Settings Modal */}
            {showSettings && (
                <div className="ts-overlay">
                    <div className="ts-modal">
                        <div className="ts-header">
                            <h2>Trade Settings</h2>
                            <button className="ts-close" onClick={() => setShowSettings(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                        <div className="ts-body">
                            <div className="ts-section">
                                <div className="ts-label-row">
                                    <span className="ts-label">Front running protection</span>
                                    <label className="ts-toggle">
                                        <input type="checkbox" checked={tempProtection} onChange={e => setTempProtection(e.target.checked)} />
                                        <span className="ts-slider"></span>
                                    </label>
                                </div>
                                <p className="ts-desc">
                                    Front-running protection prevents <strong>sandwich attacks</strong> on your swaps. With this feature enabled you can safely use high slippage.
                                </p>
                            </div>

                            <div className="ts-section">
                                <span className="ts-label">Priority fee</span>
                                <div className="sw-input-card" style={{marginTop: '12px'}}>
                                    <div className="sw-input-main">
                                        <div className="sw-token-badge">
                                            <svg width="20" height="20" viewBox="0 0 128 128">
                                                <path d="M110.1 76.5l-19.1 8.8L17.2 46.1c-1.3-.6-1.3-2.6 0-3.3L37.1 34l73.8 39.2c1.3.7 1.3 2.7-.8 3.3zm-92.2-25l19.1-8.8L110.8 81.9c1.3.6 1.3 2.6 0 3.3L90.9 94l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3zm0-25l19.1-8.8L110.8 56.9c1.3.6 1.3 2.6 0 3.3L90.9 69l-73.8-39.2c-1.3-.7-1.3-2.7.8-3.3z" fill="#9945FF" />
                                                <defs><linearGradient id="b" x1="12.3" y1="12.3" x2="115.7" y2="115.7" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#9945ff" /><stop offset=".5" stopColor="#14f195" /><stop offset="1" stopColor="#14f195" /></linearGradient></defs>
                                            </svg>
                                            SOL
                                        </div>
                                        <input
                                            className="sw-amount-input"
                                            type="number"
                                            value={tempPriority}
                                            onChange={e => setTempPriority(e.target.value)}
                                        />
                                    </div>
                                    <div className="sw-grid">
                                        {[0, 0.002, 0.005, 0.01, 0.015, 0.02].map(val => (
                                            <button key={val} className="sw-grid-btn" onClick={() => setTempPriority(String(val))}>
                                                {val}
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
            )}
        </div>
    );
}

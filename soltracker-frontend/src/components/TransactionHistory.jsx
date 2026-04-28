import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { fetchUserTrades, short, fmtNum, fmtUsd, timeAgo } from '../utils/api';
import './TransactionHistory.css';

const PAGE_SIZE = 25;

/**
 * TransactionHistory
 * Shows all trades (swaps) performed by the currently signed-in user,
 * whether signed in via Wallet or Google.
 * Reads from the existing trade_logs table — no new tables required.
 */
export default function TransactionHistory({ onClose }) {
    const { publicKey, connected } = useWallet();
    const [firebaseUser, setFirebaseUser] = useState(null);
    const [trades, setTrades] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Listen for Firebase (Google) auth changes
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setFirebaseUser(u));
        return () => unsub();
    }, []);

    // Determine the active wallet address for the query
    const walletAddress = connected && publicKey ? publicKey.toBase58() : null;
    // For Google users we don't have a wallet address in trade_logs
    // (trades only happen via wallet), so we'll still show their wallet trades
    // if they have a wallet connected simultaneously, or show empty state.
    const activeAddress = walletAddress
        || (localStorage.getItem('wallet_disconnected') !== 'true'
            ? localStorage.getItem('wallet_address')
            : null);

    const isSignedIn = !!(firebaseUser || activeAddress);

    const loadTrades = useCallback(async (pageIdx) => {
        if (!activeAddress) return;

        setLoading(true);
        setError('');
        try {
            const data = await fetchUserTrades(activeAddress, {
                limit: PAGE_SIZE,
                offset: pageIdx * PAGE_SIZE,
            });
            setTrades(data.trades || []);
            setTotal(data.total || 0);
        } catch (err) {
            console.error('[TxHistory] load error:', err);
            setError(err.message || 'Failed to load trades');
        } finally {
            setLoading(false);
        }
    }, [activeAddress]);

    useEffect(() => {
        if (activeAddress) {
            loadTrades(page);
        } else {
            setTrades([]);
            setTotal(0);
        }
    }, [activeAddress, page, loadTrades]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // ── Not signed in ───────────────────────────────────────────────────
    if (!isSignedIn) {
        return (
            <div className="txh-wrap">
                <TxHeader total={0} onClose={onClose} />
                <div className="txh-sign-in">
                    <div className="txh-lock-icon">
                        <LockIcon />
                    </div>
                    <span>Sign in to view your transaction history</span>
                    <p>Connect your wallet or sign in with Google to see all your swaps in one place.</p>
                </div>
            </div>
        );
    }

    // ── Loading ─────────────────────────────────────────────────────────
    if (loading && trades.length === 0) {
        return (
            <div className="txh-wrap">
                <TxHeader total={total} onClose={onClose} />
                <div className="txh-loading">
                    <div className="spinner" />
                    <span>Loading transactions...</span>
                </div>
            </div>
        );
    }

    // ── Empty ───────────────────────────────────────────────────────────
    if (!loading && trades.length === 0 && !error) {
        return (
            <div className="txh-wrap">
                <TxHeader total={0} onClose={onClose} />
                <div className="txh-empty">
                    <div className="txh-empty-icon">
                        <HistoryIcon />
                    </div>
                    <span>No transactions yet</span>
                    <p>Once you make your first swap, it will appear here with full details.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="txh-wrap">
            <TxHeader total={total} onClose={onClose} />

            {error && (
                <div className="txh-error-row" style={{ margin: '10px 14px' }}>
                    <span className="txh-error-msg">{error}</span>
                </div>
            )}

            <div className="txh-scroll">
                {trades.map((tx) => (
                    <TxCard key={tx.id} tx={tx} />
                ))}
            </div>

            {totalPages > 1 && (
                <div className="txh-pagination">
                    <button
                        className="txh-page-btn"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                        ← Prev
                    </button>
                    <span className="txh-page-info">
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        className="txh-page-btn"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next →
                    </button>
                </div>
            )}
        </div>
    );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function TxHeader({ total, onClose }) {
    return (
        <header className="txh-header">
            <div className="txh-title-group">
                <h2>Transaction History</h2>
                {total > 0 && <span className="txh-badge">{total} trades</span>}
            </div>
            <button className="txh-close-btn" onClick={onClose} title="Close" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </header>
    );
}

function TxCard({ tx }) {
    const isBuy = (tx.trade_mode || '').toLowerCase() === 'buy';
    const status = (tx.status || 'pending').toLowerCase();
    const sig = tx.tx_signature;

    const inputAmt = Number(tx.input_amount);
    const expectedOut = Number(tx.expected_output || tx.quoted_output);
    const actualOut = Number(tx.actual_output_amount);
    const outputDisplay = actualOut > 0 ? actualOut : expectedOut;
    const fee = Number(tx.fee_collected_sol || 0);
    const networkFee = Number(tx.network_fee_sol || 0);
    const slippage = tx.slippage_bps != null ? (Number(tx.slippage_bps) / 100) : null;
    const impact = tx.price_impact_pct != null ? Number(tx.price_impact_pct) : null;

    const createdAt = tx.created_at ? new Date(tx.created_at) : null;
    const settledAt = tx.settled_at ? new Date(tx.settled_at) : null;
    const displayTime = settledAt || createdAt;

    return (
        <div className="txh-card">
            {/* Top: pair + status */}
            <div className="txh-card-top">
                <div className="txh-card-pair">
                    <span className={`txh-mode-badge ${isBuy ? 'buy' : 'sell'}`}>
                        {isBuy ? 'BUY' : 'SELL'}
                    </span>
                    <span className="txh-pair-name">
                        {tx.input_symbol || short(tx.input_mint)}
                        <span className="quote"> → {tx.output_symbol || short(tx.output_mint)}</span>
                    </span>
                </div>
                <span className={`txh-status ${status}`}>
                    <span className="txh-status-dot" />
                    {status}
                </span>
            </div>

            {/* Grid: amounts / fees */}
            <div className="txh-card-grid">
                <div className="txh-field">
                    <span className="txh-field-label">Input</span>
                    <span className="txh-field-value">
                        {formatSmartNumber(inputAmt)} {tx.input_symbol || ''}
                    </span>
                </div>
                <div className="txh-field">
                    <span className="txh-field-label">{actualOut > 0 ? 'Received' : 'Expected'}</span>
                    <span className="txh-field-value accent">
                        {formatSmartNumber(outputDisplay)} {tx.output_symbol || ''}
                    </span>
                </div>

                {fee > 0 && (
                    <div className="txh-field">
                        <span className="txh-field-label">Platform Fee</span>
                        <span className="txh-field-value">{fee.toFixed(6)} SOL</span>
                    </div>
                )}
                {networkFee > 0 && (
                    <div className="txh-field">
                        <span className="txh-field-label">Network Fee</span>
                        <span className="txh-field-value">{networkFee.toFixed(6)} SOL</span>
                    </div>
                )}
                {slippage != null && (
                    <div className="txh-field">
                        <span className="txh-field-label">Slippage</span>
                        <span className="txh-field-value">{slippage}%</span>
                    </div>
                )}
                {impact != null && Number.isFinite(impact) && (
                    <div className="txh-field">
                        <span className="txh-field-label">Price Impact</span>
                        <span className={`txh-field-value ${impact > 1 ? 'red' : 'green'}`}>
                            {impact.toFixed(4)}%
                        </span>
                    </div>
                )}
            </div>

            {/* Signature row */}
            {sig ? (
                <div className="txh-sig-row">
                    <span className="txh-sig-label">TX</span>
                    <span className="txh-sig-value" title={sig}>{sig}</span>
                    <a
                        href={`https://solscan.io/tx/${sig}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="txh-sig-link"
                        title="View on Solscan"
                    >
                        <ExternalLinkIcon />
                    </a>
                </div>
            ) : (
                <span className="txh-no-sig">No signature recorded</span>
            )}

            {/* Error message for failed trades */}
            {status === 'failed' && tx.error_message && (
                <div className="txh-error-row">
                    <span className="txh-error-msg">{tx.error_message}</span>
                </div>
            )}

            {/* Footer: time + pool */}
            <div className="txh-card-footer">
                <span className="txh-card-time">
                    {displayTime
                        ? `${displayTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${displayTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                        : '—'}
                </span>
                {tx.pool_address && (
                    <span className="txh-card-pool" title={tx.pool_address}>
                        Pool: {short(tx.pool_address)}
                    </span>
                )}
            </div>
        </div>
    );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatSmartNumber(value) {
    if (!Number.isFinite(value) || value === 0) return '0';
    if (Math.abs(value) >= 1e9) return fmtNum(value, 2);
    if (Math.abs(value) >= 1e6) return fmtNum(value, 2);
    if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (Math.abs(value) >= 1) return value.toFixed(4);
    if (Math.abs(value) >= 0.001) return value.toFixed(6);
    return value.toFixed(9);
}

/* ── Icons ───────────────────────────────────────────────────────────── */

function LockIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    );
}

function HistoryIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            <polyline points="12 7 12 12 16 14" />
        </svg>
    );
}

function ExternalLinkIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}

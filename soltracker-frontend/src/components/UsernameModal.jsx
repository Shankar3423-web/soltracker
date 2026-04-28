import React, { useState } from 'react';
import { BASE } from '../utils/api';
import './UsernameModal.css';

/**
 * UsernameModal
 * Shown once after a wallet user connects for the first time (no username in DB).
 * Props:
 *   walletAddress  – the connected wallet address
 *   onSave(name)   – called when the user submits a valid username
 *   onDismiss()    – called when the user clicks the × button
 */
export default function UsernameModal({ walletAddress, onSave, onDismiss }) {
    const [value, setValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            setError('Please enter a username.');
            return;
        }
        if (trimmed.length < 2) {
            setError('Username must be at least 2 characters.');
            return;
        }
        if (trimmed.length > 30) {
            setError('Username must be 30 characters or less.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${BASE}/auth/wallet/username`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet_address: walletAddress, username: trimmed }),
            });
            const data = await res.json();
            if (data.success) {
                onSave(trimmed);
            } else {
                setError('Failed to save username. Please try again.');
            }
        } catch (err) {
            console.error('[UsernameModal] Save error:', err);
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="un-overlay" onClick={(e) => e.target === e.currentTarget && onDismiss()}>
            <div className="un-modal" role="dialog" aria-modal="true" aria-labelledby="un-title">
                {/* Header */}
                <div className="un-header">
                    <div className="un-logo">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="11" stroke="#9945ff" strokeWidth="1.5" />
                            <path d="M7 15.5L10.5 9l2.5 3.5L15 10l2 3" stroke="#9945ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="un-brand">SolTracker</span>
                    </div>
                    <button
                        className="un-close-btn"
                        onClick={onDismiss}
                        aria-label="Close"
                        type="button"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="un-body">
                    <div className="un-avatar-ring">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9945ff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                    </div>
                    <h2 id="un-title" className="un-title">Choose a Username</h2>
                    <p className="un-subtitle">
                        This is how you'll appear on SolTracker.
                        You can always update it later.
                    </p>

                    <form className="un-form" onSubmit={handleSubmit} noValidate>
                        <div className="un-input-wrap">
                            <input
                                id="un-input"
                                className={`un-input${error ? ' un-input--error' : ''}`}
                                type="text"
                                placeholder="e.g. SolWhale, CryptoKing…"
                                value={value}
                                onChange={(e) => { setValue(e.target.value); setError(''); }}
                                maxLength={30}
                                autoFocus
                                autoComplete="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            <span className="un-char-count">{value.length}/30</span>
                        </div>
                        {error && <p className="un-error">{error}</p>}

                        <button
                            className="un-submit-btn"
                            type="submit"
                            disabled={loading || !value.trim()}
                        >
                            {loading ? (
                                <span className="un-spinner" />
                            ) : (
                                'Save Username'
                            )}
                        </button>
                    </form>

                    <p className="un-skip" onClick={onDismiss}>
                        Skip for now
                    </p>
                </div>
            </div>
        </div>
    );
}

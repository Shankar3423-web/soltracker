import React, { useEffect, useMemo, useState } from 'react';
import { DEXES, fetchHealth } from '../utils/api';
import './TopBar.css';

export default function TopBar({ activeDex, onDexChange, selectedPool }) {
    const [status, setStatus] = useState('chk');

    useEffect(() => {
        function check() {
            fetchHealth()
                .then(() => setStatus('on'))
                .catch(() => setStatus('off'));
        }

        check();
        const timer = setInterval(check, 30000);
        return () => clearInterval(timer);
    }, []);

    const activeDexLabel = useMemo(() => {
        return (DEXES.find((dex) => dex.key === activeDex) ?? DEXES[0]).label;
    }, [activeDex]);

    const pairLabel = selectedPool?.pairName || (
        selectedPool?.baseSymbol && selectedPool?.quoteSymbol
            ? `${selectedPool.baseSymbol}/${selectedPool.quoteSymbol}`
            : 'Pools'
    );

    const statusLabel = status === 'on' ? 'LIVE' : status === 'off' ? 'DOWN' : 'CHECK';

    return (
        <header className="topbar-shell">
            <div className="topbar-main">
                <div className="tb-brand">
                    <Logo />
                    <div className="tb-brand-copy">
                        <span className="tb-brand-title">SolTracker</span>
                        <span className="tb-brand-sub">Solana market terminal</span>
                    </div>
                </div>

                <div className="tb-status">
                    <span className={`tb-dot ${status}`} />
                    <span className={`tb-status-text ${status}`}>{statusLabel}</span>
                </div>

                <div className="tb-crumbs">
                    <span>Solana</span>
                    <span className="tb-sep">/</span>
                    <strong>{activeDexLabel}</strong>
                    <span className="tb-sep">/</span>
                    <span className="tb-crumb-muted">{pairLabel}</span>
                </div>

                <div className="tb-chain">
                    <span className="tb-chain-dot" />
                    Solana
                </div>
            </div>

            <div className="tb-dexbar">
                {DEXES.map((dex) => {
                    const selected = activeDex === dex.key;
                    return (
                        <button
                            key={dex.key === null ? 'all' : dex.key}
                            type="button"
                            className={`tb-dex-btn${selected ? ' active' : ''}`}
                            onClick={() => onDexChange(dex.key)}
                        >
                            <span className="tb-dex-dot" style={{ background: dex.color }} />
                            {dex.label}
                        </button>
                    );
                })}
            </div>
        </header>
    );
}

function Logo() {
    return (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" stroke="#ffffff" strokeWidth="1.4" />
            <path d="M7 15.5L10.5 9l2.5 3.5L15 10l2 3" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

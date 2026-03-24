import React, { useState, useEffect } from 'react';
import { DEXES, fetchHealth } from '../utils/api';
import './TopBar.css';

export default function TopBar({ activeDex, onDexChange }) {
    const [status, setStatus] = useState('chk');

    useEffect(function () {
        function check() {
            fetchHealth()
                .then(function () { setStatus('on'); })
                .catch(function () { setStatus('off'); });
        }
        check();
        const t = setInterval(check, 30000);
        return function () { clearInterval(t); };
    }, []);

    const statusLabel = status === 'on' ? 'LIVE' : status === 'off' ? 'DOWN' : '...';

    return (
        <div className="topbar">
            <div className="tb-status">
                <span className={'tb-dot ' + status} />
                <span className={'tb-status-text ' + status}>{statusLabel}</span>
            </div>

            <div className="tb-tabs">
                {DEXES.map(function (dex) {
                    const isActive = activeDex === dex.key;
                    const style = isActive
                        ? { background: dex.color + '1a', borderColor: dex.color + '44', color: '#fff' }
                        : {};
                    return (
                        <button
                            key={dex.key === null ? 'all' : dex.key}
                            className={'tb-tab' + (isActive ? ' active' : '')}
                            style={style}
                            onClick={function () { onDexChange(dex.key); }}
                        >
                            <span className="tb-dot-sm" style={{ background: dex.color }} />
                            {dex.label}
                        </button>
                    );
                })}
            </div>

            <div className="tb-chain">
                <span className="tb-chain-dot" />
                Solana
            </div>
        </div>
    );
}
import React, { useState, useEffect, useRef } from 'react';
import {
    fetchPoolDetail, fetchPoolTxns,
    fmtUsd, fmtNum, fmtPrice, fmtPct,
    short, timeAgo, dexColor, avatarGrad
} from '../utils/api';
import CandleChart from './CandleChart';
import './PoolDetail.css';

export default function PoolDetail({ pool, onClose }) {
    const [detail, setDetail] = useState(null);
    const [txs, setTxs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const seen = useRef(new Set());
    const addr = pool && pool.poolAddress;

    useEffect(function () {
        if (!addr) return;
        let cancelled = false;
        seen.current = new Set();
        setTxs([]);
        setLoading(true);

        fetchPoolDetail(addr).then(function (d) {
            if (cancelled) return;
            setDetail(d);
            const items = (d && d.transactions && d.transactions.items) || [];
            items.forEach(function (t) { seen.current.add(t.signature); });
            setTxs(items);
            setLoading(false);
        }).catch(function () {
            if (!cancelled) setLoading(false);
        });

        return function () { cancelled = true; };
    }, [addr]);

    useEffect(function () {
        if (!addr) return;
        let cancelled = false;

        const t = setInterval(function () {
            fetchPoolTxns(addr, 30, 0).then(function (res) {
                if (cancelled) return;
                const fresh = (res.transactions || []).filter(function (r) {
                    return !seen.current.has(r.signature);
                });
                if (fresh.length > 0) {
                    fresh.forEach(function (r) { seen.current.add(r.signature); });
                    setTxs(function (prev) { return fresh.concat(prev).slice(0, 500); });
                }
            }).catch(function () { });
        }, 5000);

        return function () { cancelled = true; clearInterval(t); };
    }, [addr]);

    if (loading) {
        return (
            <div className="pd">
                <div className="pd-loading">
                    <div className="spinner" />
                    <span>Loading pool...</span>
                </div>
            </div>
        );
    }

    const p = (detail && detail.pool) || pool || {};
    const stats = (detail && detail.stats) || null;
    const dc = dexColor(p.dexName);
    const bg = avatarGrad(p.poolAddress);

    const shown = txs.filter(function (tx) {
        if (filter === 'buy') return tx.swapSide === 'buy';
        if (filter === 'sell') return tx.swapSide === 'sell';
        return true;
    });

    const buys = txs.filter(function (t) { return t.swapSide === 'buy'; }).length;
    const sells = txs.filter(function (t) { return t.swapSide === 'sell'; }).length;
    const total = buys + sells || 1;
    const buyPct = Math.round((buys / total) * 100);

    return (
        <div className="pd-wrapper">
            {/* ── LEFT MAIN: Transactions ── */}
            <div className="pd-main">
                <div className="pd-main-top">
                    <button className="pd-back" onClick={onClose}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                        </svg>
                        Back
                    </button>
                    <div className="pd-main-pair">
                        <PoolLogo p={p} bg={bg} />
                        <span className="pd-m-base">{p.baseSymbol || '???'}</span>
                        <span className="pd-m-sep">/</span>
                        <span className="pd-m-quote">{p.quoteSymbol || 'SOL'}</span>
                        <span className="pd-m-price">{fmtPrice(stats && stats.price)}</span>
                        {stats && stats.priceChange24h != null && (
                            <span className={'pd-m-pct ' + (stats.priceChange24h >= 0 ? 'up' : 'down')}>
                                {fmtPct(stats.priceChange24h)}
                            </span>
                        )}
                    </div>
                </div>

                {/* ── DEXSCREENER-STYLE CHART ── */}
                <CandleChart poolAddress={p.poolAddress} />

                <div className="pd-txs">
                    <div className="pd-tx-head">
                        <span className="pd-tx-title">TRANSACTIONS</span>
                        <div className="pd-tx-filters">
                            {['all', 'buy', 'sell'].map(function (f) {
                                return (
                                    <button
                                        key={f}
                                        className={'pd-filter-btn' + (filter === f ? ' active' + (f !== 'all' ? ' ' + f : '') : '')}
                                        onClick={function () { setFilter(f); }}
                                    >
                                        {f.toUpperCase()}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="pd-tx-cnt">{shown.length}</span>
                    </div>

                    <div className="pd-tx-scroll">
                        <table className="pd-tx-table">
                            <thead>
                                <tr>
                                    <th>DATE</th>
                                    <th>TYPE</th>
                                    <th className="r">USD</th>
                                    <th className="r">{p.baseSymbol || 'BASE'}</th>
                                    <th className="r">SOL</th>
                                    <th className="r">PRICE</th>
                                    <th>MAKER</th>
                                    <th>TXN</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.length === 0
                                    ? <tr><td colSpan="8" className="tx-empty">No transactions yet.</td></tr>
                                    : shown.map(function (tx, i) {
                                        return <TxRow key={tx.signature + '-' + i} tx={tx} pool={p} />;
                                    })
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ── RIGHT SIDEBAR: Stats ── */}
            <div className="pd-sidebar">
                <div className="pd-sb-header">
                    <div className="pd-banner">
                        <PoolLogo p={p} bg={bg} large />
                        <div className="pd-names">
                            <div className="pd-pair">
                                <span className="pd-base">{p.baseSymbol || '???'}</span>
                                <span className="pd-sep">/</span>
                                <span className="pd-quote">{p.quoteSymbol || 'SOL'}</span>
                            </div>
                            <div className="pd-meta">
                                <span className="pd-dex" style={{ color: dc, background: dc + '20', border: '1px solid ' + dc + '35' }}>
                                    {p.dexName}
                                </span>
                                <span className="pd-addr">{short(p.poolAddress, 7)}</span>
                                <a href={'https://solscan.io/account/' + p.poolAddress} target="_blank" rel="noreferrer" className="pd-ext">{'\u2197'}</a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pd-prices-box">
                    <div className="pd-price-row">
                        <span className="pd-plabel">PRICE USD</span>
                        <span className="pd-pbig">{fmtPrice(stats && stats.price)}</span>
                    </div>
                    <div className="pd-price-row r">
                        <span className="pd-plabel" style={{textAlign: 'right'}}>PRICE SOL</span>
                        <span className="pd-psmall">
                            {stats && stats.price ? (stats.price / 185).toFixed(10) + ' SOL' : '\u2014'}
                        </span>
                    </div>
                </div>

                <div className="pd-liq-box">
                    <div className="pd-liq-item">
                        <span className="pd-liq-label">LIQUIDITY</span>
                        <span className="pd-liq-val">{fmtUsd(stats && stats.liquidity, true)}</span>
                    </div>
                    <div className="pd-liq-item r">
                        <span className="pd-liq-label">MKT CAP</span>
                        {/* Fake/estimative market cap by assuming 1 billion supply */}
                        <span className="pd-liq-val">{fmtUsd(stats && (stats.price * 1000000000), true)}</span>
                    </div>
                </div>

                <div className="pd-stats-grid">
                    <StatBox label="TXNS" val={fmtNum(stats && stats.txCount24h, 0)} />
                    <StatBox label="VOLUME" val={fmtUsd(stats && stats.volume24h, true)} />
                    <StatBox label="MAKERS" val={fmtNum(stats && stats.makers24h, 0)} />
                    <StatBox label="1H VOL" val={fmtUsd(stats && stats.volume1h, true)} />
                    <StatBox label="6H VOL" val={fmtUsd(stats && stats.volume6h, true)} />
                    <StatBox label="24H %" val={stats && stats.priceChange24h != null ? fmtPct(stats.priceChange24h) : '\u2014'} />
                </div>

                <div className="pd-bs-wrap">
                    <div className="pd-bs-labels">
                        <div className="pd-bs-col green">
                            <span className="lbl">BUYS</span>
                            <span className="val">{buys}</span>
                        </div>
                        <div className="pd-bs-col red right">
                            <span className="lbl">SELLS</span>
                            <span className="val">{sells}</span>
                        </div>
                    </div>
                    <div className="pd-bs-bar">
                        <div className="pd-bs-buy" style={{ width: buyPct + '%' }} />
                        <div className="pd-bs-sell" style={{ width: (100 - buyPct) + '%' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function TxRow({ tx, pool }) {
    const isBuy = tx.swapSide === 'buy';
    return (
        <tr className={'tx-r ' + (isBuy ? 'buy' : 'sell')}>
            <td className="tx-date">{timeAgo(tx.blockTime)}</td>
            <td>
                <span className={'type-pill ' + (isBuy ? 'buy' : 'sell')}>
                    {isBuy ? 'Buy' : 'Sell'}
                </span>
            </td>
            <td className="r">
                {tx.usdValue != null
                    ? <span className={isBuy ? 'val-g' : 'val-r'}>${Number(tx.usdValue).toFixed(2)}</span>
                    : <span className="val-m">{'\u2014'}</span>
                }
            </td>
            <td className="r">
                <span className={isBuy ? 'val-g' : 'val-r'}>
                    {tx.baseAmount != null ? fmtNum(tx.baseAmount, 2) : '\u2014'}
                </span>
            </td>
            <td className="r val-m">
                {tx.quoteAmount != null ? Number(tx.quoteAmount).toFixed(4) : '\u2014'}
            </td>
            <td className="r val-m">{fmtPrice(tx.price)}</td>
            <td>
                <a
                    href={'https://solscan.io/account/' + tx.wallet}
                    target="_blank"
                    rel="noreferrer"
                    className="maker-a"
                    title={tx.wallet}
                >
                    {short(tx.wallet, 4)}
                </a>
            </td>
            <td>
                <a
                    href={'https://solscan.io/tx/' + tx.signature}
                    target="_blank"
                    rel="noreferrer"
                    className="txn-a"
                    title={tx.signature}
                >
                    {'\u2197'}
                </a>
            </td>
        </tr>
    );
}

function StatBox({ label, val }) {
    return (
        <div className="pd-stat">
            <span className="pd-stat-label">{label}</span>
            <span className="pd-stat-val">{val}</span>
        </div>
    );
}

function PoolLogo({ p, bg }) {
    const [err, setErr] = useState(false);
    return (
        <div className="pd-logo" style={{ width: 40, height: 40, background: bg }}>
            {p.baseLogo && !err
                ? <img src={p.baseLogo} alt="" onError={function () { setErr(true); }} />
                : <span className="pd-logo-init" style={{ fontSize: 14 }}>
                    {(p.baseSymbol || '?')[0]}
                </span>
            }
        </div>
    );
}

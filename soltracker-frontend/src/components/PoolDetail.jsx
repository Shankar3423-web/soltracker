import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
    fetchPoolDetail, 
    fmtUsd, fmtNum, fmtPrice, fmtPct,
    short, timeAgo, dexColor, avatarGrad
} from '../utils/api';
import CandlestickChart from './CandlestickChart';
import './PoolDetail.css';

const SOCKET_URL = process.env.REACT_APP_WS_URL || 'http://localhost:3000';

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

        // ── Real-Time WebSocket for Trades ──
        const socket = io(SOCKET_URL);
        socket.emit('subscribe', addr);

        socket.on('new_swap', (s) => {
            if (cancelled) return;
            if (seen.current.has(s.signature)) return;
            
            seen.current.add(s.signature);
            setTxs(prev => [s, ...prev].slice(0, 500));
        });

        return function () { 
            cancelled = true; 
            socket.emit('unsubscribe', addr);
            socket.disconnect();
        };
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

    const tbuys = stats ? Number(stats.buys24h || 0) : 0;
    const tsells = stats ? Number(stats.sells24h || 0) : 0;
    const ttl = tbuys + tsells || 1;
    const buyTxPct = (tbuys / ttl) * 100;

    const buyVol = stats ? Number(stats.buyVolume24h || 0) : 0;
    const sellVol = stats ? Number(stats.sellVolume24h || 0) : 0;
    const totalVol = buyVol + sellVol || 1;
    const buyVolPct = (buyVol / totalVol) * 100;

    const buyers = stats ? Number(stats.buyers24h || 0) : 0;
    const sellers = stats ? Number(stats.sellers24h || 0) : 0;
    const totalMakers = buyers + sellers || 1;
    const buyerPct = (buyers / totalMakers) * 100;

    const halfLiq = stats && stats.liquidity ? stats.liquidity / 2 : 0;
    const solPrice = 150; // Approximated SOL price for UI
    const pooledBase = stats && stats.price ? (halfLiq / stats.price) : 0;
    const pooledQuote = halfLiq / solPrice;

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

                <div className="pd-chart-section">
                    <CandlestickChart poolAddress={addr} />
                </div>

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
                    <div className="pd-sb-top-pair">
                        <PoolLogo p={p} bg={bg} />
                        <div style={{display: 'flex', alignItems: 'baseline', gap: '6px'}}>
                            <span className="pd-sb-t-base">{p.baseSymbol || '???'} <span className="pd-sb-t-copy" title="Copy Address">❐</span></span>
                            <span className="pd-sb-t-sep">/</span>
                            <span className="pd-sb-t-quote">{p.quoteSymbol || 'SOL'}</span>
                        </div>
                    </div>
                    <div className="pd-sb-breadcrumbs">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{marginRight: -2}}>
                            <circle cx="12" cy="12" r="12" fill="#9945ff" />
                            <path d="M7 16l2.5-4L12 15l2-3L16 14" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="pd-sb-bc-sol">Solana</span> 
                        <span className="pd-sb-bc-arr">{'>'}</span> 
                        <span className="pd-sb-bc-dex" style={{color: dc}}>
                            💊 {p.dexName || 'Unknown DEX'}
                        </span> 
                        {p.dexName === 'PumpSwap' && (
                            <span className="pd-sb-bc-via">via 💊 Pump.fun AMM</span>
                        )}
                    </div>
                </div>
                
                <div 
                    className="pd-sb-banner-img" 
                    style={{ 
                        backgroundImage: (p.headerImage || p.baseLogo) 
                            ? `url("${p.headerImage || p.baseLogo}"), ${bg}` 
                            : bg 
                    }}
                >
                </div>

                <div className="pd-links-row">
                    <button className="pd-l-btn" type="button"><i className="icon-web" /> Website</button>
                    <button className="pd-l-btn" type="button"><i className="icon-tw" /> Twitter</button>
                    <button className="pd-l-more" type="button">{'▼'}</button>
                </div>

                <div className="pd-prices-box">
                    <div className="pd-price-col">
                        <span className="pd-plabel">PRICE USD</span>
                        <span className="pd-pbig">{fmtPrice(stats && stats.price)}</span>
                    </div>
                    <div className="pd-price-col r">
                        <span className="pd-plabel">PRICE</span>
                        <span className="pd-psmall">{(stats && stats.price ? stats.price.toFixed(10) : '0.00')} SOL</span>
                    </div>
                </div>

                <div className="pd-liq-box">
                    <div className="pd-liq-item">
                        <span className="pd-liq-label">LIQUIDITY</span>
                        <span className="pd-liq-val">{fmtUsd(stats && stats.liquidity, true)}</span>
                    </div>
                    <div className="pd-liq-item">
                        <span className="pd-liq-label">FDV</span>
                        <span className="pd-liq-val">{fmtUsd(stats && stats.fdv, true)}</span>
                    </div>
                    <div className="pd-liq-item r">
                        <span className="pd-liq-label">MKT CAP</span>
                        <span className="pd-liq-val">{fmtUsd(stats && stats.marketCap, true)}</span>
                    </div>
                </div>

                <div className="pd-timeframes">
                    <TimeBox label="5M" pct={stats && stats.priceChange5m} />
                    <TimeBox label="1H" pct={stats && stats.priceChange1h} />
                    <TimeBox label="6H" pct={stats && stats.priceChange6h} />
                    <TimeBox label="24H" pct={stats && stats.priceChange24h} active />
                </div>

                <div className="pd-stats-new">
                    <div className="pd-sn-col left">
                        <div className="pd-sn-row">
                            <span className="sn-lbl">TXNS</span>
                            <span className="sn-val">{fmtNum(stats && stats.txCount24h, 0)}</span>
                        </div>
                        <div className="pd-sn-row">
                            <span className="sn-lbl">VOLUME</span>
                            <span className="sn-val">{fmtUsd(stats && stats.volume24h, true)}</span>
                        </div>
                        <div className="pd-sn-row">
                            <span className="sn-lbl">MAKERS</span>
                            <span className="sn-val">{fmtNum(stats && stats.makers24h, 0)}</span>
                        </div>
                    </div>
                    
                    <div className="pd-sn-col right">
                        <div className="pd-sn-split-block">
                            <div className="pd-sn-split-txt">
                                <div className="sn-split-half">
                                    <span className="sn-lbl">BUYS</span>
                                    <span className="sn-val">{fmtNum(stats && stats.buys24h, 0)}</span>
                                </div>
                                <div className="sn-split-half r">
                                    <span className="sn-lbl">SELLS</span>
                                    <span className="sn-val">{fmtNum(stats && stats.sells24h, 0)}</span>
                                </div>
                            </div>
                            <div className="sn-bar"><div className="sn-bar-buy" style={{width: `${buyTxPct}%`}}/><div className="sn-bar-sell" style={{width: `${100-buyTxPct}%`}}/></div>
                        </div>

                        <div className="pd-sn-split-block">
                            <div className="pd-sn-split-txt">
                                <div className="sn-split-half">
                                    <span className="sn-lbl">BUY VOL</span>
                                    <span className="sn-val">{fmtUsd(stats && stats.buyVolume24h, true)}</span>
                                </div>
                                <div className="sn-split-half r">
                                    <span className="sn-lbl">SELL VOL</span>
                                    <span className="sn-val">{fmtUsd(stats && stats.sellVolume24h, true)}</span>
                                </div>
                            </div>
                            <div className="sn-bar"><div className="sn-bar-buy" style={{width: `${buyVolPct}%`}}/><div className="sn-bar-sell" style={{width: `${100-buyVolPct}%`}}/></div>
                        </div>

                        <div className="pd-sn-split-block">
                            <div className="pd-sn-split-txt">
                                <div className="sn-split-half">
                                    <span className="sn-lbl">BUYERS</span>
                                    <span className="sn-val">{fmtNum(stats && stats.buyers24h, 0)}</span>
                                </div>
                                <div className="sn-split-half r">
                                    <span className="sn-lbl">SELLERS</span>
                                    <span className="sn-val">{fmtNum(stats && stats.sellers24h, 0)}</span>
                                </div>
                            </div>
                            <div className="sn-bar"><div className="sn-bar-buy" style={{width: `${buyerPct}%`}}/><div className="sn-bar-sell" style={{width: `${100-buyerPct}%`}}/></div>
                        </div>
                    </div>
                </div>

                <div className="pd-pool-info">
                    <div className="pi-row">
                        <span className="pi-lbl">Pair created</span>
                        <span className="pi-val">{p.createdAt ? timeAgo(p.createdAt) : (p.updatedAt ? timeAgo(p.updatedAt) : '—')}</span>
                    </div>
                    <div className="pi-row">
                        <span className="pi-lbl">Pooled {p.baseSymbol || 'BASE'}</span>
                        <div className="pi-val-group">
                            <span className="pi-val">{pooledBase > 0 ? fmtNum(pooledBase, 2) : '—'}</span>
                            <span className="pi-usd">{halfLiq > 0 ? fmtUsd(halfLiq, true) : '—'}</span>
                        </div>
                    </div>
                    <div className="pi-row">
                        <span className="pi-lbl">Pooled {p.quoteSymbol || 'SOL'}</span>
                        <div className="pi-val-group">
                            <span className="pi-val">{pooledQuote > 0 ? fmtNum(pooledQuote, 2) : '—'}</span>
                            <span className="pi-usd">{halfLiq > 0 ? fmtUsd(halfLiq, true) : '—'}</span>
                        </div>
                    </div>
                    <div className="pi-row">
                        <span className="pi-lbl">Pair</span>
                        <div className="pi-copy-group">
                            <button className="pi-copy" onClick={() => navigator.clipboard.writeText(p.poolAddress)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                {p.poolAddress ? short(p.poolAddress, 4) : '—'}
                            </button>
                            <a href={p.poolAddress ? `https://solscan.io/account/${p.poolAddress}` : '#!'} target="_blank" rel="noreferrer" className="pi-exp">
                                EXP <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                    <div className="pi-row">
                        <span className="pi-lbl">{p.baseSymbol || 'BASE'}</span>
                        <div className="pi-copy-group">
                            <button className="pi-copy" onClick={() => navigator.clipboard.writeText(p.baseMint)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                {p.baseMint ? short(p.baseMint, 4) : '—'}
                            </button>
                            <a href={p.baseMint ? `https://solscan.io/token/${p.baseMint}` : '#!'} target="_blank" rel="noreferrer" className="pi-exp">
                                EXP <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                    <div className="pi-row">
                        <span className="pi-lbl">{p.quoteSymbol || 'SOL'}</span>
                        <div className="pi-copy-group">
                            <button className="pi-copy" onClick={() => navigator.clipboard.writeText(p.quoteMint)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                {p.quoteMint ? short(p.quoteMint, 4) : '—'}
                            </button>
                            <a href={p.quoteMint ? `https://solscan.io/token/${p.quoteMint}` : '#!'} target="_blank" rel="noreferrer" className="pi-exp">
                                EXP <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TimeBox({ label, pct, active }) {
    const isUp = pct >= 0;
    return (
        <div className={'pd-time-box' + (active ? ' active' : '')}>
            <span className="t-lbl">{label}</span>
            <span className={'t-val ' + (isUp ? 'up' : 'down')}>{fmtPct(pct)}</span>
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

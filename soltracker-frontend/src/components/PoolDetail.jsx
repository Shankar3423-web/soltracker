import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import CandlestickChart from './CandlestickChart';
import {
    SOCKET_URL,
    avatarGrad,
    dexColor,
    fetchPoolDetail,
    fmtNativePrice,
    fmtNum,
    fmtPct,
    fmtPrice,
    fmtUsd,
    makeSwapKey,
    normalizeTransaction,
    short,
    timeAgo,
} from '../utils/api';
import './PoolDetail.css';

const WINDOWS = [
    { key: 'm5', label: '5M' },
    { key: 'h1', label: '1H' },
    { key: 'h6', label: '6H' },
    { key: 'h24', label: '24H' },
];

export default function PoolDetail({ pool, onClose }) {
    const addr = pool?.poolAddress;
    const [detail, setDetail] = useState(null);
    const [txs, setTxs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [activeWindow, setActiveWindow] = useState('h24');
    const [error, setError] = useState('');
    const seenRef = useRef(new Set());

    useEffect(() => {
        if (!addr) return undefined;

        let cancelled = false;
        seenRef.current = new Set();
        setLoading(true);
        setDetail(null);
        setTxs([]);
        setFilter('all');
        setActiveWindow('h24');

        async function load(showLoader) {
            if (showLoader) {
                setLoading(true);
            }

            try {
                const nextDetail = await fetchPoolDetail(addr, 200, 0);
                if (cancelled) return;

                const items = nextDetail?.transactions?.items ?? [];
                seenRef.current = new Set(items.map(makeSwapKey));
                setDetail(nextDetail);
                setTxs(items);
                setError('');
            } catch (err) {
                if (!cancelled) {
                    setError('Unable to load this pool right now.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load(true);
        const refreshTimer = setInterval(() => load(false), 15000);

        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
        });

        socket.emit('subscribe', addr);

        socket.on('new_swap', (incoming) => {
            if (cancelled) return;

            const tx = normalizeTransaction(incoming);
            const key = makeSwapKey(tx);
            if (seenRef.current.has(key)) return;

            seenRef.current.add(key);
            setTxs((current) => [tx, ...current].slice(0, 250));
            setDetail((current) => {
                if (!current?.stats) return current;
                const nextStats = {
                    ...current.stats,
                    price: tx.priceUsd ?? current.stats.price,
                    priceUsd: tx.priceUsd ?? current.stats.priceUsd,
                    priceNative: tx.priceNative ?? current.stats.priceNative,
                    priceSol: tx.priceSol ?? current.stats.priceSol,
                    updatedAt: tx.blockTime ?? current.stats.updatedAt,
                };

                return {
                    ...current,
                    stats: nextStats,
                    pool: {
                        ...current.pool,
                        stats: nextStats,
                    },
                };
            });
        });

        return () => {
            cancelled = true;
            clearInterval(refreshTimer);
            socket.emit('unsubscribe', addr);
            socket.disconnect();
        };
    }, [addr]);

    const currentPool = detail?.pool ?? pool ?? {};
    const stats = detail?.stats ?? currentPool.stats ?? null;
    const headerGradient = avatarGrad(currentPool.poolAddress);
    const dexTint = dexColor(currentPool.dexName);
    const quoteSymbol = currentPool.quoteSymbol || 'SOL';
    const baseSymbol = currentPool.baseSymbol || short(currentPool.baseMint || currentPool.poolAddress, 4);

    const filteredTxs = useMemo(() => {
        return txs.filter((tx) => {
            if (filter === 'buy') return tx.swapSide === 'buy';
            if (filter === 'sell') return tx.swapSide === 'sell';
            return true;
        });
    }, [filter, txs]);

    const windowStats = useMemo(() => getWindowStats(stats, activeWindow), [stats, activeWindow]);
    const buyTxnPct = ratio(windowStats.buys, windowStats.total);
    const buyVolPct = ratio(windowStats.buyVolume, windowStats.volume);
    const buyerPct = ratio(windowStats.buyers, windowStats.buyers + windowStats.sellers);

    if (loading) {
        return (
            <div className="pd">
                <div className="pd-loading">
                    <div className="spinner" />
                    <span>Loading live pool data...</span>
                </div>
            </div>
        );
    }

    if (error && !stats) {
        return (
            <div className="pd">
                <div className="pd-empty">
                    <h2>Pool data unavailable</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="pd">
            <div className="pd-main">
                <header className="pd-header">
                    <button className="pd-back" onClick={onClose} type="button">
                        <BackIcon />
                        <span>Back</span>
                    </button>

                    <div className="pd-header-pair">
                        <PairAvatar pool={currentPool} background={headerGradient} />
                        <div className="pd-header-copy">
                            <div className="pd-pair-row">
                                <h1>{baseSymbol}</h1>
                                <span>/</span>
                                <strong>{quoteSymbol}</strong>
                                <em
                                    className="pd-dex-chip"
                                    style={{
                                        color: dexTint,
                                        background: `${dexTint}16`,
                                        borderColor: `${dexTint}36`,
                                    }}
                                >
                                    {currentPool.dexName || 'Unknown DEX'}
                                </em>
                            </div>
                            <div className="pd-meta-row">
                                <span>Solana</span>
                                <span className="pd-meta-dot" />
                                <span>{short(currentPool.poolAddress, 5)}</span>
                                <span className="pd-meta-dot" />
                                <span>
                                    Updated {stats?.updatedAt ? timeAgo(stats.updatedAt) : 'recently'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="pd-header-price">
                        <div className="pd-price-main">{fmtPrice(stats?.priceUsd)}</div>
                        <div className="pd-price-sub">
                            {fmtNativePrice(stats?.priceNative, quoteSymbol)}
                        </div>
                    </div>
                </header>

                <section className="pd-chart-panel">
                    <CandlestickChart
                        poolAddress={currentPool.poolAddress}
                        baseSymbol={baseSymbol}
                        quoteSymbol={quoteSymbol}
                    />
                </section>

                <section className="pd-table-panel">
                    <div className="pd-table-toolbar">
                        <div className="pd-table-title">
                            <span>Transactions</span>
                            <strong>{fmtNum(filteredTxs.length, 0)}</strong>
                        </div>

                        <div className="pd-filters">
                            {['all', 'buy', 'sell'].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`pd-filter-btn${filter === value ? ` active ${value}` : ''}`}
                                    onClick={() => setFilter(value)}
                                >
                                    {value.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pd-table-scroll">
                        <table className="pd-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th className="r">USD</th>
                                    <th className="r">{baseSymbol}</th>
                                    <th className="r">{quoteSymbol}</th>
                                    <th className="r">Price</th>
                                    <th>Maker</th>
                                    <th>Txn</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTxs.length === 0 ? (
                                    <tr>
                                        <td className="tx-empty" colSpan="8">
                                            No transactions available for this filter yet.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredTxs.map((tx) => (
                                        <TxRow
                                            key={makeSwapKey(tx)}
                                            tx={tx}
                                            quoteSymbol={quoteSymbol}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <aside className="pd-side">
                <div className="pd-stat-hero" style={{ backgroundImage: `${softOverlay()}, ${headerGradient}` }}>
                    <div className="pd-stat-hero-top">
                        <PairAvatar pool={currentPool} background={headerGradient} compact />
                        <div>
                            <div className="pd-side-pair">
                                {baseSymbol} <span>/</span> {quoteSymbol}
                            </div>
                            <div className="pd-side-chain">Solana via {currentPool.dexName || 'Unknown DEX'}</div>
                        </div>
                    </div>
                </div>

                <section className="pd-stat-grid">
                    <MetricCard label="Price USD" value={fmtPrice(stats?.priceUsd)} emphasis />
                    <MetricCard
                        label="Price"
                        value={fmtNativePrice(stats?.priceNative, quoteSymbol)}
                    />
                    <MetricCard label="Liquidity" value={fmtUsd(stats?.liquidity?.usd, true)} />
                    <MetricCard label="FDV" value={fmtUsd(stats?.fdv, true)} />
                    <MetricCard label="MKT CAP" value={fmtUsd(stats?.marketCap, true)} />
                </section>

                <section className="pd-window-bar">
                    {WINDOWS.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`pd-window-btn${activeWindow === item.key ? ' active' : ''}`}
                            onClick={() => setActiveWindow(item.key)}
                        >
                            <span>{item.label}</span>
                            <strong className={(windowStatsFor(stats, item.key).priceChange ?? 0) >= 0 ? 'up' : 'down'}>
                                {fmtPct(windowStatsFor(stats, item.key).priceChange)}
                            </strong>
                        </button>
                    ))}
                </section>

                <section className="pd-side-stats">
                    <SnapshotCard label="Txns" value={fmtNum(windowStats.total, 0)} />
                    <SnapshotCard label="Volume" value={fmtUsd(windowStats.volume, true)} />
                    <SnapshotCard label="Makers" value={fmtNum(windowStats.makers, 0)} />

                    <SplitCard
                        leftLabel="Buys"
                        leftValue={fmtNum(windowStats.buys, 0)}
                        rightLabel="Sells"
                        rightValue={fmtNum(windowStats.sells, 0)}
                        percent={buyTxnPct}
                    />

                    <SplitCard
                        leftLabel="Buy Vol"
                        leftValue={fmtUsd(windowStats.buyVolume, true)}
                        rightLabel="Sell Vol"
                        rightValue={fmtUsd(windowStats.sellVolume, true)}
                        percent={buyVolPct}
                    />

                    <SplitCard
                        leftLabel="Buyers"
                        leftValue={fmtNum(windowStats.buyers, 0)}
                        rightLabel="Sellers"
                        rightValue={fmtNum(windowStats.sellers, 0)}
                        percent={buyerPct}
                    />
                </section>

                <section className="pd-info-card">
                    <InfoRow
                        label="Pair created"
                        value={currentPool.createdAt ? timeAgo(currentPool.createdAt) : 'Not available'}
                    />
                    <InfoRow
                        label={`Pooled ${baseSymbol}`}
                        value={fmtNum(stats?.liquidity?.base, 2)}
                        subValue={fmtUsd(stats?.liquidity?.usd != null ? stats.liquidity.usd / 2 : null, true)}
                    />
                    <InfoRow
                        label={`Pooled ${quoteSymbol}`}
                        value={fmtNum(stats?.liquidity?.quote, 2)}
                        subValue={fmtUsd(stats?.liquidity?.usd != null ? stats.liquidity.usd / 2 : null, true)}
                    />
                    <AddressRow label="Pair" value={currentPool.poolAddress} href={`https://solscan.io/account/${currentPool.poolAddress}`} />
                    <AddressRow label={baseSymbol} value={currentPool.baseMint} href={`https://solscan.io/token/${currentPool.baseMint}`} />
                    <AddressRow label={quoteSymbol} value={currentPool.quoteMint} href={`https://solscan.io/token/${currentPool.quoteMint}`} />
                </section>
            </aside>
        </div>
    );
}

function getWindowStats(stats, key) {
    const snapshot = windowStatsFor(stats, key);
    return {
        total: snapshot.txns?.total ?? 0,
        buys: snapshot.txns?.buys ?? 0,
        sells: snapshot.txns?.sells ?? 0,
        volume: snapshot.volume ?? 0,
        buyVolume: snapshot.buyVolume ?? 0,
        sellVolume: snapshot.sellVolume ?? 0,
        makers: snapshot.makers ?? 0,
        buyers: snapshot.buyers ?? 0,
        sellers: snapshot.sellers ?? 0,
        priceChange: snapshot.priceChange ?? null,
    };
}

function windowStatsFor(stats, key) {
    return {
        txns: stats?.txns?.[key] ?? { total: 0, buys: 0, sells: 0 },
        volume: stats?.volume?.[key] ?? 0,
        buyVolume: stats?.buyVolume?.[key] ?? 0,
        sellVolume: stats?.sellVolume?.[key] ?? 0,
        makers: stats?.makers?.[key] ?? 0,
        buyers: stats?.buyers?.[key] ?? 0,
        sellers: stats?.sellers?.[key] ?? 0,
        priceChange: stats?.priceChange?.[key] ?? null,
    };
}

function ratio(part, total) {
    const safeTotal = total || 0;
    if (!safeTotal) return 50;
    return Math.max(0, Math.min(100, (part / safeTotal) * 100));
}

function MetricCard({ label, value, emphasis = false }) {
    return (
        <div className={`pd-metric-card${emphasis ? ' emphasis' : ''}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function SnapshotCard({ label, value }) {
    return (
        <div className="pd-snapshot-card">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function SplitCard({ leftLabel, leftValue, rightLabel, rightValue, percent }) {
    return (
        <div className="pd-split-card">
            <div className="pd-split-copy">
                <div>
                    <span>{leftLabel}</span>
                    <strong>{leftValue}</strong>
                </div>
                <div className="r">
                    <span>{rightLabel}</span>
                    <strong>{rightValue}</strong>
                </div>
            </div>
            <div className="pd-split-bar">
                <div className="buy" style={{ width: `${percent}%` }} />
                <div className="sell" style={{ width: `${100 - percent}%` }} />
            </div>
        </div>
    );
}

function InfoRow({ label, value, subValue }) {
    return (
        <div className="pd-info-row">
            <span>{label}</span>
            <div className="pd-info-value">
                <strong>{value}</strong>
                {subValue ? <em>{subValue}</em> : null}
            </div>
        </div>
    );
}

function AddressRow({ label, value, href }) {
    const disabled = !value;
    return (
        <div className="pd-info-row">
            <span>{label}</span>
            <div className="pd-address-actions">
                <button
                    type="button"
                    className="pd-copy-btn"
                    disabled={disabled}
                    onClick={() => value && navigator.clipboard.writeText(value)}
                >
                    <CopyIcon />
                    {value ? short(value, 5) : 'N/A'}
                </button>
                <a
                    className={`pd-exp-link${disabled ? ' disabled' : ''}`}
                    href={disabled ? '#!' : href}
                    target="_blank"
                    rel="noreferrer"
                >
                    EXP
                    <ExternalIcon />
                </a>
            </div>
        </div>
    );
}

function TxRow({ tx, quoteSymbol }) {
    const isBuy = tx.swapSide === 'buy';
    return (
        <tr className={`tx-r ${isBuy ? 'buy' : 'sell'}`}>
            <td>{timeAgo(tx.blockTime)}</td>
            <td>
                <span className={`type-pill ${isBuy ? 'buy' : 'sell'}`}>
                    {isBuy ? 'Buy' : 'Sell'}
                </span>
            </td>
            <td className={`r ${isBuy ? 'val-g' : 'val-r'}`}>{fmtUsd(tx.usdValue)}</td>
            <td className={`r ${isBuy ? 'val-g' : 'val-r'}`}>{fmtNum(tx.baseAmount, 2)}</td>
            <td className="r val-m">{fmtNum(tx.quoteAmount, 4)}</td>
            <td className="r val-m">{fmtPrice(tx.priceUsd)}</td>
            <td>
                <a
                    href={`https://solscan.io/account/${tx.wallet}`}
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
                    href={`https://solscan.io/tx/${tx.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="txn-a"
                    title={`${short(tx.signature, 6)} in ${quoteSymbol}`}
                >
                    <ExternalIcon />
                </a>
            </td>
        </tr>
    );
}

function PairAvatar({ pool, background, compact = false }) {
    const [baseError, setBaseError] = useState(false);
    const [quoteError, setQuoteError] = useState(false);

    return (
        <div className={`pd-pair-avatar${compact ? ' compact' : ''}`}>
            <div className="pd-avatar-main" style={{ background }}>
                {pool.baseLogo && !baseError ? (
                    <img src={pool.baseLogo} alt="" onError={() => setBaseError(true)} />
                ) : (
                    <span>{(pool.baseSymbol || '?')[0]}</span>
                )}
            </div>
            <div className="pd-avatar-quote">
                {pool.quoteLogo && !quoteError ? (
                    <img src={pool.quoteLogo} alt="" onError={() => setQuoteError(true)} />
                ) : (
                    <QuoteDot />
                )}
            </div>
        </div>
    );
}

function softOverlay() {
    return 'linear-gradient(145deg, rgba(8, 10, 18, 0.22), rgba(8, 10, 18, 0.82))';
}

function QuoteDot() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="12" fill="#6b5cff" />
            <path
                d="M7 16l2.5-4L12 15l2-3L16 14"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function BackIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function ExternalIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}

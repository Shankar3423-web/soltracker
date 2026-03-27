import React, { useState, useEffect } from 'react';
import {
    fetchPoolsByDex, DEX_KEYS,
    fmtUsd, fmtNum, fmtPrice, fmtPct, fmtAge,
    dexColor, avatarGrad, short
} from '../utils/api';
import './PoolList.css';

export default function PoolList({ activeDex, onSelectPool }) {
    const [pools, setPools] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sortCol, setSortCol] = useState('volume24h');
    const [sortDir, setSortDir] = useState('desc');
    const [search, setSearch] = useState('');

    useEffect(function () {
        let cancelled = false;
        setLoading(true);

        load(activeDex).then(function (data) {
            if (!cancelled) { setPools(data); setLoading(false); }
        }).catch(function () {
            if (!cancelled) setLoading(false);
        });

        const t = setInterval(function () {
            load(activeDex).then(function (data) {
                if (!cancelled) setPools(data);
            }).catch(function () { });
        }, 8000);

        return function () { cancelled = true; clearInterval(t); };
    }, [activeDex]);

    function load(dex) {
        if (dex === null) {
            return Promise.all(
                DEX_KEYS.map(function (k) {
                    return fetchPoolsByDex(k, 50, 0).catch(function () { return { pools: [] }; });
                })
            ).then(function (results) {
                let all = [];
                results.forEach(function (r) { all = all.concat(r.pools || []); });
                return all;
            });
        }
        return fetchPoolsByDex(dex, 100, 0).then(function (r) { return r.pools || []; });
    }

    function toggleSort(col) {
        if (sortCol === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }
        else { setSortCol(col); setSortDir('desc'); }
    }

    const visible = pools
        .filter(function (p) {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
                (p.baseSymbol || '').toLowerCase().includes(q) ||
                (p.baseName || '').toLowerCase().includes(q) ||
                (p.poolAddress || '').toLowerCase().includes(q)
            );
        })
        .slice()
        .sort(function (a, b) {
            const va = a[sortCol] != null ? a[sortCol] : -1e18;
            const vb = b[sortCol] != null ? b[sortCol] : -1e18;
            return sortDir === 'desc' ? vb - va : va - vb;
        });

    if (loading) {
        return (
            <div className="pl-wrap">
                <div className="pl-loading">
                    <div className="spinner" />
                    <span>Loading pools…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="pl-wrap">
            <div className="pl-toolbar">
                <div className="pl-search">
                    <SearchSVG />
                    <input
                        placeholder="Search token or pool address…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <span className="pl-count">{visible.length} pools</span>
            </div>

            <div className="pl-scroll">
                <table className="pl-table">
                    <thead>
                        <tr>
                            <th style={{ width: 36 }}>#</th>
                            <th style={{ minWidth: 220 }}>TOKEN</th>
                            <Th col="price" label="PRICE" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                            <th className="r">AGE</th>
                            <Th col="txCount24h" label="TXNS" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                            <Th col="volume24h" label="VOLUME" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                            <Th col="makers24h" label="MAKERS" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                            <Th col="priceChange24h" label="24H %" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                            <Th col="liquidity" label="LIQUIDITY" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 ? (
                            <tr>
                                <td colSpan="9" className="pl-empty">
                                    {search ? 'No pools match your search.' : 'No pools yet — waiting for webhook data.'}
                                </td>
                            </tr>
                        ) : visible.map(function (pool, i) {
                            return (
                                <PoolRow
                                    key={pool.poolAddress}
                                    pool={pool}
                                    rank={i + 1}
                                    onClick={function () { onSelectPool(pool); }}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Th({ col, label, sortCol, sortDir, onSort }) {
    const active = sortCol === col;
    return (
        <th
            className={'r sort' + (active ? ' active' : '')}
            onClick={function () { onSort(col); }}
        >
            {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </th>
    );
}

function PoolRow({ pool, rank, onClick }) {
    const bg = avatarGrad(pool.poolAddress);
    const dc = dexColor(pool.dexName);
    const pct = pool.priceChange24h;

    return (
        <tr className="pl-row" onClick={onClick}>
            <td><span className="rank">#{rank}</span></td>

            <td>
                <div className="tc">
                    <TokenLogos pool={pool} bg={bg} />
                    <div className="tc-info">
                        <div className="tc-pair">
                            <span className="tc-base-sym">{pool.baseSymbol || short(pool.baseMint, 4)}</span>
                            <span className="tc-sep">/</span>
                            <span className="tc-quote-sym">{pool.quoteSymbol || 'SOL'}</span>
                        </div>
                        <div className="tc-meta">
                            <span className="tc-dex" style={{
                                color: dc,
                                background: dc + '20',
                                border: '1px solid ' + dc + '35'
                            }}>{pool.dexName}</span>
                            <span className="tc-addr">{short(pool.poolAddress, 5)}</span>
                        </div>
                    </div>
                </div>
            </td>

            <td className="r mono">{fmtPrice(pool.price)}</td>
            <td className="r muted">{fmtAge(pool.updatedAt)}</td>
            <td className="r mono">{fmtNum(pool.txCount24h, 0)}</td>
            <td className="r mono">{fmtUsd(pool.volume24h, true)}</td>
            <td className="r mono">{fmtNum(pool.makers24h, 0)}</td>
            <td className="r">
                {pct != null
                    ? <span className={pct >= 0 ? 'green' : 'red'}>{fmtPct(pct)}</span>
                    : <span className="muted">—</span>
                }
            </td>
            <td className="r mono">{fmtUsd(pool.liquidity, true)}</td>
        </tr>
    );
}

function TokenLogos({ pool, bg }) {
    const [baseErr, setBaseErr] = useState(false);
    const [quoteErr, setQuoteErr] = useState(false);

    return (
        <div className="tc-logos">
            <div className="tc-base" style={{ background: bg }}>
                {pool.baseLogo && !baseErr
                    ? <img src={pool.baseLogo} alt="" onError={function () { setBaseErr(true); }} />
                    : <span className="tc-initial">{(pool.baseSymbol || '?')[0]}</span>
                }
            </div>
            <div className="tc-quote">
                {pool.quoteLogo && !quoteErr
                    ? <img src={pool.quoteLogo} alt="" onError={function () { setQuoteErr(true); }} />
                    : <SolLogo />
                }
            </div>
        </div>
    );
}

function SolLogo() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="12" fill="#9945ff" />
            <path d="M7 16l2.5-4L12 15l2-3L16 14" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SearchSVG() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    );
}
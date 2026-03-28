import React, { useEffect, useMemo, useState } from 'react';
import {
    avatarGrad,
    dexColor,
    fetchPoolsForSources,
    fmtAge,
    fmtNum,
    fmtPct,
    fmtPrice,
    fmtUsd,
    getDexSources,
    short,
} from '../utils/api';
import './PoolList.css';

const DEFAULT_SORT = { col: 'volume24h', dir: 'desc' };

export default function PoolList({ activeDex, onSelectPool, selectedPoolAddress }) {
    const [pools, setPools] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState(DEFAULT_SORT);

    useEffect(() => {
        let cancelled = false;
        const sources = getDexSources(activeDex);

        async function load(showLoader) {
            if (showLoader) {
                setLoading(true);
            }

            try {
                const nextPools = await fetchPoolsForSources(sources, 60);
                if (!cancelled) {
                    setPools(nextPools);
                    setError('');
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Unable to load pools from the backend right now.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load(true);
        const timer = setInterval(() => load(false), 12000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [activeDex]);

    const visiblePools = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = pools.filter((pool) => {
            if (!query) return true;
            return [
                pool.baseSymbol,
                pool.quoteSymbol,
                pool.baseName,
                pool.quoteName,
                pool.pairName,
                pool.poolAddress,
                pool.baseMint,
                pool.quoteMint,
                pool.dexName,
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query));
        });

        const sorted = filtered.slice().sort((left, right) => {
            const leftValue = sortableValue(left, sort.col);
            const rightValue = sortableValue(right, sort.col);

            if (typeof leftValue === 'string' || typeof rightValue === 'string') {
                const cmp = String(leftValue).localeCompare(String(rightValue));
                return sort.dir === 'desc' ? -cmp : cmp;
            }

            const a = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
            const b = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
            return sort.dir === 'desc' ? b - a : a - b;
        });

        return sorted;
    }, [pools, search, sort]);

    function toggleSort(col) {
        setSort((current) => {
            if (current.col === col) {
                return { col, dir: current.dir === 'desc' ? 'asc' : 'desc' };
            }
            return { col, dir: 'desc' };
        });
    }

    return (
        <div className="pl-wrap">
            <div className="pl-toolbar">
                <div className="pl-kicker">
                    <span className="pl-live-dot" />
                    <span>Market Feed</span>
                </div>

                <div className="pl-search">
                    <SearchIcon />
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by token, pair, mint, or pool address"
                    />
                </div>

                <div className="pl-count">{fmtNum(visiblePools.length, 0)} pools</div>
            </div>

            <div className="pl-scroll">
                <table className="pl-table">
                    <thead>
                        <tr>
                            <th style={{ width: 46 }}>#</th>
                            <th style={{ minWidth: 220 }}>Pair</th>
                            <SortHeader col="priceUsd" label="Price" sort={sort} onSort={toggleSort} />
                            <SortHeader col="updatedAt" label="Updated" sort={sort} onSort={toggleSort} />
                            <SortHeader col="txCount24h" label="Txns" sort={sort} onSort={toggleSort} />
                            <SortHeader col="volume24h" label="Volume" sort={sort} onSort={toggleSort} />
                            <SortHeader col="makers24h" label="Makers" sort={sort} onSort={toggleSort} />
                            <SortHeader col="priceChange24h" label="24h %" sort={sort} onSort={toggleSort} />
                            <SortHeader col="liquidity" label="Liquidity" sort={sort} onSort={toggleSort} />
                        </tr>
                    </thead>

                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="pl-empty" colSpan="9">
                                    <div className="pl-loading">
                                        <div className="spinner" />
                                        <span>Loading live pools from the backend...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : error ? (
                            <tr>
                                <td className="pl-empty" colSpan="9">
                                    {error}
                                </td>
                            </tr>
                        ) : visiblePools.length === 0 ? (
                            <tr>
                                <td className="pl-empty" colSpan="9">
                                    {search
                                        ? 'No pools match this search yet.'
                                        : 'No decoded pools are available yet. Wait for webhook traffic or backfill.'}
                                </td>
                            </tr>
                        ) : (
                            visiblePools.map((pool, index) => (
                                <PoolRow
                                    key={pool.poolAddress}
                                    pool={pool}
                                    rank={index + 1}
                                    selected={pool.poolAddress === selectedPoolAddress}
                                    onClick={() => onSelectPool(pool)}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function sortableValue(pool, col) {
    switch (col) {
        case 'priceUsd':
            return pool.priceUsd ?? -1;
        case 'updatedAt':
            return pool.updatedAt ? new Date(pool.updatedAt).getTime() : -1;
        case 'txCount24h':
            return pool.txCount24h ?? -1;
        case 'volume24h':
            return pool.volume24h ?? -1;
        case 'makers24h':
            return pool.makers24h ?? -1;
        case 'priceChange24h':
            return pool.priceChange24h ?? -999999;
        case 'liquidity':
            return pool.liquidity ?? -1;
        default:
            return pool[col] ?? -1;
    }
}

function SortHeader({ col, label, sort, onSort }) {
    const active = sort.col === col;
    return (
        <th className="r sort" onClick={() => onSort(col)}>
            <span className={active ? 'is-active' : ''}>{label}</span>
            <span className="sort-arrow">
                {active ? (sort.dir === 'desc' ? 'v' : '^') : ''}
            </span>
        </th>
    );
}

function PoolRow({ pool, rank, selected, onClick }) {
    const pct = pool.priceChange24h;
    const positive = pct != null && pct >= 0;
    const quoteSymbol = pool.quoteSymbol || 'SOL';
    const baseSymbol = pool.baseSymbol || short(pool.baseMint || pool.poolAddress, 4);
    const bg = avatarGrad(pool.poolAddress);
    const chipColor = dexColor(pool.dexName);

    return (
        <tr className={`pl-row${selected ? ' selected' : ''}`} onClick={onClick}>
            <td>
                <span className="rank">#{rank}</span>
            </td>

            <td>
                <div className="tc">
                    <PairBadge pool={pool} bg={bg} />
                    <div className="tc-info">
                        <div className="tc-pair">
                            <span className="tc-base-sym">{baseSymbol}</span>
                            <span className="tc-sep">/</span>
                            <span className="tc-quote-sym">{quoteSymbol}</span>
                        </div>

                        <div className="tc-meta">
                            <span
                                className="tc-dex"
                                style={{
                                    color: chipColor,
                                    background: `${chipColor}18`,
                                    borderColor: `${chipColor}36`,
                                }}
                            >
                                {pool.dexName || 'Unknown'}
                            </span>
                            <span className="tc-addr">{short(pool.poolAddress, 5)}</span>
                        </div>
                    </div>
                </div>
            </td>

            <td className="r mono">{fmtPrice(pool.priceUsd)}</td>
            <td className="r muted">{fmtAge(pool.updatedAt)}</td>
            <td className="r mono">{fmtNum(pool.txCount24h, 0)}</td>
            <td className="r mono">{fmtUsd(pool.volume24h, true)}</td>
            <td className="r mono">{fmtNum(pool.makers24h, 0)}</td>
            <td className="r">
                <span className={positive ? 'green' : 'red'}>
                    {fmtPct(pool.priceChange24h)}
                </span>
            </td>
            <td className="r mono">{fmtUsd(pool.liquidity, true)}</td>
        </tr>
    );
}

function PairBadge({ pool, bg }) {
    const [baseError, setBaseError] = useState(false);
    const [quoteError, setQuoteError] = useState(false);

    return (
        <div className="tc-logos">
            <div className="tc-base" style={{ background: bg }}>
                {pool.baseLogo && !baseError ? (
                    <img src={pool.baseLogo} alt="" onError={() => setBaseError(true)} />
                ) : (
                    <span className="tc-initial">{(pool.baseSymbol || '?')[0]}</span>
                )}
            </div>

            <div className="tc-quote">
                {pool.quoteLogo && !quoteError ? (
                    <img src={pool.quoteLogo} alt="" onError={() => setQuoteError(true)} />
                ) : (
                    <SolLogo />
                )}
            </div>
        </div>
    );
}

function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    );
}

function SolLogo() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="12" fill="#6c5cff" />
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

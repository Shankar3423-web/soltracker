const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';
export const SOCKET_URL = process.env.REACT_APP_WS_URL || BASE;

const SOURCE_DEXES = [
    'Raydium CP-Swap',
    'Raydium AMM',
    'Raydium CLMM',
    'Orca Whirlpool',
    'Meteora DLMM',
    'Pump.fun',
    'Pump.fun AMM',
    'Solfi',
    'PancakeSwap V3',
    'Phoenix',
    'Lifinity',
    'OpenBook',
    'Moonshot',
    'Aldrin',
    'Zeta',
    'Invariant',
    'Manifold Finance',
];

export const DEXES = [
    { label: 'All Markets', key: null, color: '#f3f5fb', sources: SOURCE_DEXES },
    { label: 'Raydium', key: 'raydium', color: '#67d2ff', sources: ['Raydium CP-Swap', 'Raydium AMM', 'Raydium CLMM'] },
    { label: 'Orca', key: 'orca', color: '#73e2d0', sources: ['Orca Whirlpool'] },
    { label: 'Meteora', key: 'meteora', color: '#ff9b5d', sources: ['Meteora DLMM'] },
    { label: 'Pump.fun', key: 'pump', color: '#9eff72', sources: ['Pump.fun', 'Pump.fun AMM'] },
    { label: 'Other', key: 'other', color: '#cbd4e7', sources: ['Solfi', 'PancakeSwap V3', 'Phoenix', 'Lifinity', 'OpenBook', 'Moonshot', 'Aldrin', 'Zeta', 'Invariant', 'Manifold Finance'] },
];

export function getDexSources(activeDex) {
    const selected = DEXES.find((dex) => dex.key === activeDex) ?? DEXES[0];
    return selected.sources;
}

async function get(path) {
    const res = await fetch(BASE + path);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
}

function toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number') {
        return value > 1e12 ? value : value * 1000;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeStats(stats) {
    if (!stats) return null;

    return {
        price: toNumber(stats.price ?? stats.priceUsd),
        priceUsd: toNumber(stats.priceUsd ?? stats.price),
        priceNative: toNumber(stats.priceNative),
        priceSol: toNumber(stats.priceSol),
        liquidity: {
            usd: toNumber(stats.liquidity?.usd),
            base: toNumber(stats.liquidity?.base),
            quote: toNumber(stats.liquidity?.quote),
        },
        fdv: toNumber(stats.fdv),
        marketCap: toNumber(stats.marketCap),
        priceChange: {
            m5: toNumber(stats.priceChange?.m5),
            h1: toNumber(stats.priceChange?.h1),
            h6: toNumber(stats.priceChange?.h6),
            h24: toNumber(stats.priceChange?.h24),
        },
        txns: {
            m5: {
                total: Number(stats.txns?.m5?.total ?? 0),
                buys: Number(stats.txns?.m5?.buys ?? 0),
                sells: Number(stats.txns?.m5?.sells ?? 0),
            },
            h1: {
                total: Number(stats.txns?.h1?.total ?? 0),
                buys: Number(stats.txns?.h1?.buys ?? 0),
                sells: Number(stats.txns?.h1?.sells ?? 0),
            },
            h6: {
                total: Number(stats.txns?.h6?.total ?? 0),
                buys: Number(stats.txns?.h6?.buys ?? 0),
                sells: Number(stats.txns?.h6?.sells ?? 0),
            },
            h24: {
                total: Number(stats.txns?.h24?.total ?? 0),
                buys: Number(stats.txns?.h24?.buys ?? 0),
                sells: Number(stats.txns?.h24?.sells ?? 0),
            },
        },
        volume: {
            m5: toNumber(stats.volume?.m5) ?? 0,
            h1: toNumber(stats.volume?.h1) ?? 0,
            h6: toNumber(stats.volume?.h6) ?? 0,
            h24: toNumber(stats.volume?.h24) ?? 0,
        },
        buyVolume: {
            m5: toNumber(stats.buyVolume?.m5) ?? 0,
            h1: toNumber(stats.buyVolume?.h1) ?? 0,
            h6: toNumber(stats.buyVolume?.h6) ?? 0,
            h24: toNumber(stats.buyVolume?.h24) ?? 0,
        },
        sellVolume: {
            m5: toNumber(stats.sellVolume?.m5) ?? 0,
            h1: toNumber(stats.sellVolume?.h1) ?? 0,
            h6: toNumber(stats.sellVolume?.h6) ?? 0,
            h24: toNumber(stats.sellVolume?.h24) ?? 0,
        },
        makers: {
            m5: Number(stats.makers?.m5 ?? 0),
            h1: Number(stats.makers?.h1 ?? 0),
            h6: Number(stats.makers?.h6 ?? 0),
            h24: Number(stats.makers?.h24 ?? 0),
        },
        buyers: {
            m5: Number(stats.buyers?.m5 ?? 0),
            h1: Number(stats.buyers?.h1 ?? 0),
            h6: Number(stats.buyers?.h6 ?? 0),
            h24: Number(stats.buyers?.h24 ?? 0),
        },
        sellers: {
            m5: Number(stats.sellers?.m5 ?? 0),
            h1: Number(stats.sellers?.h1 ?? 0),
            h6: Number(stats.sellers?.h6 ?? 0),
            h24: Number(stats.sellers?.h24 ?? 0),
        },
        updatedAt: stats.updatedAt ?? null,
    };
}

export function normalizeTransaction(tx) {
    if (!tx) return null;

    return {
        signature: tx.signature,
        eventIndex: Number(tx.eventIndex ?? tx.event_index ?? 0),
        wallet: tx.wallet ?? null,
        baseAmount: toNumber(tx.baseAmount ?? tx.base_amount),
        quoteAmount: toNumber(tx.quoteAmount ?? tx.quote_amount),
        price: toNumber(tx.priceUsd ?? tx.price ?? tx.price_usd),
        priceUsd: toNumber(tx.priceUsd ?? tx.price_usd ?? tx.price),
        priceNative: toNumber(tx.priceNative ?? tx.price_native ?? tx.price),
        priceSol: toNumber(tx.priceSol ?? tx.price_sol),
        quotePriceUsd: toNumber(tx.quotePriceUsd ?? tx.quote_price_usd),
        usdValue: toNumber(tx.usdValue ?? tx.usd_value),
        swapSide: tx.swapSide ?? tx.swap_side ?? 'buy',
        classification: tx.classification ?? null,
        slot: toNumber(tx.slot),
        blockTime: tx.blockTime ?? tx.block_time ?? null,
    };
}

export function normalizePoolSummary(row) {
    const stats = normalizeStats(row?.stats);
    return {
        poolAddress: row.poolAddress,
        dexName: row.dexName ?? null,
        pairName: row.pairName ?? null,
        baseSymbol: row.baseSymbol ?? null,
        quoteSymbol: row.quoteSymbol ?? null,
        baseName: row.baseName ?? null,
        quoteName: row.quoteName ?? null,
        baseLogo: row.baseLogo ?? null,
        quoteLogo: row.quoteLogo ?? null,
        baseMint: row.baseMint ?? null,
        quoteMint: row.quoteMint ?? null,
        createdAt: row.createdAt ?? null,
        stats,
        price: stats?.priceUsd ?? null,
        priceUsd: stats?.priceUsd ?? null,
        liquidity: stats?.liquidity?.usd ?? null,
        priceChange24h: stats?.priceChange?.h24 ?? null,
        txCount24h: stats?.txns?.h24?.total ?? 0,
        volume24h: stats?.volume?.h24 ?? 0,
        makers24h: stats?.makers?.h24 ?? 0,
        updatedAt: stats?.updatedAt ?? null,
    };
}

export function normalizePoolDetailResponse(data) {
    if (!data) return null;

    const stats = normalizeStats(data.stats);
    const pool = {
        poolAddress: data.pool?.poolAddress,
        dexName: data.pool?.dexName ?? null,
        pairName: data.pool?.pairName ?? null,
        baseMint: data.pool?.baseMint ?? null,
        quoteMint: data.pool?.quoteMint ?? null,
        baseSymbol: data.pool?.baseSymbol ?? null,
        quoteSymbol: data.pool?.quoteSymbol ?? null,
        baseName: data.pool?.baseName ?? null,
        quoteName: data.pool?.quoteName ?? null,
        baseLogo: data.pool?.baseLogo ?? null,
        quoteLogo: data.pool?.quoteLogo ?? null,
        createdAt: data.pool?.createdAt ?? null,
        stats,
    };

    return {
        pool,
        stats,
        transactions: {
            totalAllTime: Number(data.transactions?.totalAllTime ?? 0),
            limit: Number(data.transactions?.limit ?? 0),
            offset: Number(data.transactions?.offset ?? 0),
            items: (data.transactions?.items ?? []).map(normalizeTransaction),
        },
    };
}

export function normalizeCandle(candle) {
    if (!candle) return null;
    return {
        time: Math.floor((toTimestamp(candle.time) ?? 0) / 1000),
        open: toNumber(candle.open),
        high: toNumber(candle.high),
        low: toNumber(candle.low),
        close: toNumber(candle.close),
        volumeUsd: toNumber(candle.volumeUsd) ?? 0,
        volumeBase: toNumber(candle.volumeBase) ?? 0,
        volumeQuote: toNumber(candle.volumeQuote) ?? 0,
        txCount: Number(candle.txCount ?? 0),
        buys: Number(candle.buys ?? 0),
        sells: Number(candle.sells ?? 0),
    };
}

export function normalizeSocketCandle(candle, unit = 'usd') {
    const useNative = unit === 'native';
    const open = toNumber(useNative ? candle.open_price_native : candle.open_price) ?? toNumber(candle.open_price_native);
    const high = toNumber(useNative ? candle.high_price_native : candle.high_price) ?? toNumber(candle.high_price_native);
    const low = toNumber(useNative ? candle.low_price_native : candle.low_price) ?? toNumber(candle.low_price_native);
    const close = toNumber(useNative ? candle.close_price_native : candle.close_price) ?? toNumber(candle.close_price_native);

    return {
        time: Math.floor((toTimestamp(candle.time_bucket ?? candle.time) ?? 0) / 1000),
        open,
        high,
        low,
        close,
        volumeUsd: toNumber(candle.volume_usd ?? candle.volumeUsd) ?? 0,
        volumeBase: toNumber(candle.volume_base ?? candle.volumeBase) ?? 0,
        volumeQuote: toNumber(candle.volume_quote ?? candle.volumeQuote) ?? 0,
        txCount: Number(candle.tx_count ?? candle.txCount ?? 0),
        buys: Number(candle.buys ?? 0),
        sells: Number(candle.sells ?? 0),
        resolution: candle.resolution,
    };
}

export function makeSwapKey(tx) {
    return `${tx.signature}:${tx.eventIndex ?? 0}`;
}

export function fetchHealth() {
    return get('/health');
}

export async function fetchPoolsByDex(dexName, limit = 60, offset = 0) {
    const data = await get(`/pools/dex/${encodeURIComponent(dexName)}?limit=${limit}&offset=${offset}`);
    return (data.pools ?? []).map(normalizePoolSummary);
}

export async function fetchPoolsForSources(sources, limit = 60) {
    const uniqueSources = [...new Set(sources)];
    const results = await Promise.all(
        uniqueSources.map((source) => fetchPoolsByDex(source, limit, 0).catch(() => []))
    );

    const merged = new Map();
    results.flat().forEach((pool) => {
        merged.set(pool.poolAddress, pool);
    });

    return [...merged.values()];
}

export async function fetchPoolDetail(addr, limit = 100, offset = 0) {
    const data = await get(`/pools/${addr}?limit=${limit}&offset=${offset}`);
    return normalizePoolDetailResponse(data);
}

export async function fetchPoolTxns(addr, limit = 100, offset = 0, side = 'all') {
    const sideQuery = side && side !== 'all' ? `&side=${encodeURIComponent(side)}` : '';
    const data = await get(`/pools/${addr}/transactions?limit=${limit}&offset=${offset}${sideQuery}`);
    return {
        total: Number(data.total ?? 0),
        limit: Number(data.limit ?? 0),
        offset: Number(data.offset ?? 0),
        side: data.side ?? 'all',
        transactions: (data.transactions ?? []).map(normalizeTransaction),
    };
}

export async function fetchPoolCandles(addr, resolution = '1m', options = {}) {
    const params = new URLSearchParams();
    params.set('resolution', resolution);
    params.set('limit', String(options.limit ?? 500));
    params.set('unit', options.unit === 'native' ? 'native' : 'usd');
    if (options.from != null) params.set('from', String(options.from));
    if (options.to != null) params.set('to', String(options.to));

    const data = await get(`/pools/${addr}/candles?${params.toString()}`);
    return {
        poolAddress: data.poolAddress,
        resolution: data.resolution,
        unit: data.unit,
        candles: (data.candles ?? []).map(normalizeCandle),
    };
}

export function fmtUsd(value, compact = false) {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (compact) {
        if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
        if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
        if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    }
    if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
    if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(6)}`;
}

export function fmtNum(value, decimals = 2) {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
    return n.toFixed(decimals);
}

export function fmtPrice(value) {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (n === 0) return '$0.00';
    if (Math.abs(n) < 0.000001) return `$${n.toExponential(3)}`;
    if (Math.abs(n) < 0.001) return `$${n.toFixed(8)}`;
    if (Math.abs(n) < 1) return `$${n.toFixed(6)}`;
    return `$${n.toFixed(4)}`;
}

export function fmtNativePrice(value, symbol = 'SOL') {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) < 0.000001) return `${n.toExponential(3)} ${symbol}`;
    if (Math.abs(n) < 0.001) return `${n.toFixed(8)} ${symbol}`;
    if (Math.abs(n) < 1) return `${n.toFixed(6)} ${symbol}`;
    return `${n.toFixed(4)} ${symbol}`;
}

export function fmtPct(value) {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtAge(value) {
    const ts = toTimestamp(value);
    if (!ts) return '—';
    const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (delta < 60) return `${delta}s`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
    return `${Math.floor(delta / 86400)}d`;
}

export function timeAgo(value) {
    const age = fmtAge(value);
    return age === '—' ? age : `${age} ago`;
}

export function short(value, chars = 4) {
    if (!value) return '—';
    return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function dexColor(name) {
    if (!name) return '#8a91ab';
    const lower = name.toLowerCase();
    if (lower.includes('raydium')) return '#6fd0ff';
    if (lower.includes('orca')) return '#73e2d0';
    if (lower.includes('meteora')) return '#ff9d63';
    if (lower.includes('pump')) return '#a1ff74';
    if (lower.includes('solfi')) return '#ffd66b';
    if (lower.includes('pancake')) return '#7db8ff';
    return '#c7d0e4';
}

export function avatarGrad(seed) {
    if (!seed) return 'linear-gradient(135deg, #ff8b3d 0%, #ffd166 100%)';
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 58) % 360;
    return `linear-gradient(135deg, hsl(${h1} 82% 58%), hsl(${h2} 78% 48%))`;
}

export { BASE };

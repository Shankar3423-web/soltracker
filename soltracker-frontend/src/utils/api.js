const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

async function get(path) {
    const res = await fetch(BASE + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

export function fetchHealth() { return get('/health'); }
export function fetchPoolsByDex(dex, limit, offset) { return get('/pools/dex/' + encodeURIComponent(dex) + '?limit=' + (limit || 50) + '&offset=' + (offset || 0)); }
export function fetchPoolDetail(addr) { return get('/pools/' + addr); }
export function fetchPoolTxns(addr, limit, offset) { return get('/pools/' + addr + '/transactions?limit=' + (limit || 50) + '&offset=' + (offset || 0)); }

export const DEXES = [
    { label: 'All DEXes', key: null, color: '#e8eaf0' },
    { label: 'Pump.fun', key: 'Pump.fun', color: '#00c896' },
    { label: 'Pump AMM', key: 'Pump.fun AMM', color: '#00c896' }
];

export const DEX_KEYS = DEXES.filter(d => d.key !== null).map(d => d.key);

export function fmtUsd(v, compact) {
    if (v == null) return '—';
    if (compact) {
        if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
        if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    }
    return '$' + Number(v).toFixed(2);
}

export function fmtNum(v, dec) {
    if (v == null) return '—';
    const d = dec != null ? dec : 2;
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(d) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(d) + 'K';
    return Number(v).toFixed(d);
}

export function fmtPrice(v) {
    if (v == null) return '—';
    if (v === 0) return '$0.00';
    if (v < 0.000001) return '$' + v.toExponential(4);
    if (v < 0.001) return '$' + v.toFixed(8);
    if (v < 1) return '$' + v.toFixed(6);
    return '$' + v.toFixed(4);
}

export function fmtPct(v) {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
}

export function fmtAge(dateStr) {
    if (!dateStr) return '—';
    const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
}

export function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

export function short(addr, n) {
    if (!addr) return '—';
    const c = n || 5;
    return addr.slice(0, c) + '...' + addr.slice(-c);
}

export function dexColor(name) {
    if (!name) return '#7b8099';
    const n = name.toLowerCase();
    if (n.includes('pump')) return '#00c896';
    if (n.includes('meteora')) return '#ff6b35';
    if (n.includes('raydium')) return '#5ac8fa';
    return '#7b8099';
}

export function avatarGrad(addr) {
    if (!addr) return 'linear-gradient(135deg,#9945ff,#5ac8fa)';
    let h = 0;
    for (let i = 0; i < addr.length; i++) {
        h = ((h << 5) - h + addr.charCodeAt(i)) | 0;
    }
    const h1 = Math.abs(h) % 360;
    const h2 = (h1 + 137) % 360;
    return 'linear-gradient(135deg,hsl(' + h1 + ',70%,55%),hsl(' + h2 + ',80%,38%))';
}
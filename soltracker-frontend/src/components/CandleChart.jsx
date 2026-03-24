import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { fetchPoolCandles } from '../utils/api';
import './CandleChart.css';

/**
 * CandleChart.jsx — DexScreener Level Candlestick Chart
 *
 * Resolution tabs:
 *  Live tabs  → 1m, 5m, 15m, 30m, 1h, 4h     (real-time candles from incoming webhooks)
 *  History tab → ALL                             (always renders using 24h buckets, shows ALL past data)
 */

const LIVE_RESOLUTIONS = ['1m', '5m', '15m', '30m', '1h', '4h'];

// Map each live tab to the API resolution string
const API_RES_MAP = {
    '1m': '1m', '5m': '5m', '15m': '15m',
    '30m': '30m', '1h': '1h', '4h': '4h',
    'ALL': '24h',  // history tab → daily candles, no limit cap
};

function formatPrice(p) {
    if (p === null || p === undefined) return '—';
    if (p === 0) return '0.00';
    if (p < 0.00000001) return p.toExponential(4);
    if (p < 0.0001) return p.toFixed(10);
    if (p < 1) return p.toFixed(6);
    return p.toFixed(4);
}

export default function CandleChart({ poolAddress }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);       // lightweight-charts instance
    const candleRef = useRef(null);      // candlestick series
    const volRef = useRef(null);         // volume series
    const resizeObs = useRef(null);

    const [tab, setTab] = useState('ALL');   // Default to ALL so old data always shows
    const [loading, setLoading] = useState(true);
    const [noData, setNoData] = useState(false);
    const [ohlc, setOhlc] = useState(null);
    const [candleCount, setCandleCount] = useState(0);

    // ── Build / rebuild chart when pool or tab changes ─────────────────────────
    const buildChart = useCallback(async () => {
        if (!containerRef.current) return;

        // Destroy previous chart cleanly
        if (chartRef.current) {
            try { chartRef.current.remove(); } catch (_) {}
            chartRef.current = null;
        }
        if (resizeObs.current) {
            resizeObs.current.disconnect();
            resizeObs.current = null;
        }

        setLoading(true);
        setNoData(false);
        setOhlc(null);

        try {
            const apiRes = API_RES_MAP[tab] || '24h';
            const limit = tab === 'ALL' ? 2000 : 1000;
            const data = await fetchPoolCandles(poolAddress, apiRes, limit);
            const rawCandles = data?.candles || [];

            if (rawCandles.length === 0) {
                setNoData(true);
                setLoading(false);
                return;
            }

            // Parse & deduplicate (lightweight-charts requires strictly ascending unique times)
            const seen = new Set();
            const candles = rawCandles
                .map(c => ({
                    time: Number(c.time),
                    open:   Number(c.open)   || 0,
                    high:   Number(c.high)   || 0,
                    low:    Number(c.low)    || 0,
                    close:  Number(c.close)  || 0,
                    volume: Number(c.volume) || 0,
                }))
                .filter(c => {
                    if (seen.has(c.time) || c.high === 0) return false;
                    seen.add(c.time);
                    return true;
                })
                .sort((a, b) => a.time - b.time);

            if (candles.length === 0) {
                setNoData(true);
                setLoading(false);
                return;
            }

            setCandleCount(candles.length);
            setOhlc(candles[candles.length - 1]);

            // ── Create chart ────────────────────────────────────────────────────
            const chart = createChart(containerRef.current, {
                layout: {
                    background: { type: ColorType.Solid, color: '#0d0d12' },
                    textColor: '#9ea3bb',
                    fontFamily: 'Inter, -apple-system, sans-serif',
                },
                grid: {
                    vertLines: { color: 'rgba(42, 46, 57, 0.15)' },
                    horzLines: { color: 'rgba(42, 46, 57, 0.15)' },
                },
                crosshair: {
                    mode: CrosshairMode.Normal,
                    vertLine: { color: 'rgba(158,163,187,0.5)', labelBackgroundColor: '#1a1b23', style: 3 },
                    horzLine: { color: 'rgba(158,163,187,0.5)', labelBackgroundColor: '#1a1b23', style: 3 },
                },
                rightPriceScale: {
                    borderColor: 'rgba(255,255,255,0.07)',
                    autoScale: true,
                    scaleMargins: { top: 0.08, bottom: 0.22 },
                },
                timeScale: {
                    borderColor: 'rgba(255,255,255,0.07)',
                    timeVisible: true,
                    secondsVisible: tab === '1m',
                    rightOffset: 8,
                    barSpacing: tab === 'ALL' ? 4 : 6,
                },
                handleScroll: true,
                handleScale: true,
                width: containerRef.current.clientWidth,
                height: 400,
            });
            chartRef.current = chart;

            // ── Candlestick series ──────────────────────────────────────────────
            const cSeries = chart.addCandlestickSeries({
                upColor:        '#20c997',
                downColor:      '#ff4976',
                borderVisible:  false,
                wickUpColor:    '#20c997',
                wickDownColor:  '#ff4976',
                priceFormat: {
                    type: 'custom',
                    minMove: 0.000000001,
                    formatter: formatPrice,
                },
            });
            candleRef.current = cSeries;

            // ── Volume series ───────────────────────────────────────────────────
            const vSeries = chart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: 'vol',
            });
            chart.priceScale('vol').applyOptions({
                scaleMargins: { top: 0.82, bottom: 0 },
            });
            volRef.current = vSeries;

            // ── Set data ────────────────────────────────────────────────────────
            cSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
            vSeries.setData(candles.map(({ time, volume, open, close }) => ({
                time,
                value: volume,
                color: close >= open ? 'rgba(32,201,151,0.35)' : 'rgba(255,73,118,0.35)',
            })));

            chart.timeScale().fitContent();

            // ── Crosshair OHLC update ───────────────────────────────────────────
            chart.subscribeCrosshairMove(param => {
                if (param.time) {
                    const d = param.seriesData.get(cSeries);
                    if (d) setOhlc(d);
                } else {
                    setOhlc(candles[candles.length - 1]);
                }
            });

            // ── Resize observer ─────────────────────────────────────────────────
            const ro = new ResizeObserver(([entry]) => {
                if (entry && chartRef.current) {
                    chartRef.current.applyOptions({ width: entry.contentRect.width });
                }
            });
            ro.observe(containerRef.current);
            resizeObs.current = ro;

            setLoading(false);
        } catch (err) {
            console.error('[Chart] Error loading candles:', err);
            setNoData(true);
            setLoading(false);
        }
    }, [poolAddress, tab]);

    useEffect(() => {
        buildChart();
        return () => {
            if (chartRef.current) { try { chartRef.current.remove(); } catch (_) {} chartRef.current = null; }
            if (resizeObs.current) { resizeObs.current.disconnect(); resizeObs.current = null; }
        };
    }, [buildChart]);

    return (
        <div className="dsc-chart-wrap">
            {/* ── Toolbar ───────────────────────────────────────────────── */}
            <div className="dsc-toolbar">
                <div className="dsc-tabs">
                    {/* Live resolution tabs */}
                    {LIVE_RESOLUTIONS.map(r => (
                        <button key={r} className={`dsc-tab ${tab === r ? 'active' : ''}`} onClick={() => setTab(r)}>
                            {r}
                        </button>
                    ))}

                    {/* Divider */}
                    <span className="dsc-tab-div" />

                    {/* ALL / History tab */}
                    <button className={`dsc-tab history ${tab === 'ALL' ? 'active' : ''}`} onClick={() => setTab('ALL')}>
                        ALL
                    </button>
                </div>

                {/* OHLC info bar (DexScreener style) */}
                {ohlc && !loading && (
                    <div className="dsc-ohlc">
                        <span>O <span className="dsc-ohlc-v">{formatPrice(ohlc.open)}</span></span>
                        <span>H <span className="dsc-ohlc-v green">{formatPrice(ohlc.high)}</span></span>
                        <span>L <span className="dsc-ohlc-v red">{formatPrice(ohlc.low)}</span></span>
                        <span>C <span className="dsc-ohlc-v">{formatPrice(ohlc.close)}</span></span>
                        {candleCount > 0 && <span className="dsc-ohlc-cnt">{candleCount} candles</span>}
                    </div>
                )}
            </div>

            {/* ── Chart canvas ─────────────────────────────────────────── */}
            <div className="dsc-canvas" ref={containerRef}>
                {loading && (
                    <div className="dsc-overlay">
                        <div className="dsc-pulse" />
                        <p>Loading chart data…</p>
                    </div>
                )}
                {!loading && noData && (
                    <div className="dsc-overlay">
                        <p className="dsc-nodata-icon">📊</p>
                        <p className="dsc-nodata-title">No candle data yet</p>
                        <p className="dsc-nodata-desc">
                            {tab === 'ALL'
                                ? 'No historical trades in the database for this pool.'
                                : `Switch to the ALL tab to see historical data.\nLive candles appear here once the webhook streams new trades.`
                            }
                        </p>
                        {tab !== 'ALL' && (
                            <button className="dsc-nodata-btn" onClick={() => setTab('ALL')}>
                                View Historical Chart →
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

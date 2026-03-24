import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { fetchPoolCandles } from '../utils/api';
import './CandleChart.css';

/**
 * CandleChart.jsx - DexScreener Level Professional Chart
 * Features: OHLC Overlay, High-Precision Axis, Volume Integration, Resize Resilience.
 */

export default function CandleChart({ poolAddress }) {
    const chartContainerRef = useRef();
    const chartRef = useRef(); // Store chart instance
    const [res, setRes] = useState('5m');
    const [loading, setLoading] = useState(true);
    const [ohlc, setOhlc] = useState(null); // For the overlay text

    const RESOLUTIONS = ['1m', '5m', '15m', '30m', '1h', '4h', 'D'];

    useEffect(() => {
        let chart;
        let cancelled = false;

        const initChart = async () => {
            if (!chartContainerRef.current) return;
            setLoading(true);

            try {
                const apiRes = res === 'D' ? '24h' : res;
                const data = await fetchPoolCandles(poolAddress, apiRes);
                if (cancelled) return;

                // ── 1. Chart Configuration (DexScreener Aesthetics) ────────────────
                chart = createChart(chartContainerRef.current, {
                    layout: {
                        background: { type: ColorType.Solid, color: '#0d0d12' },
                        textColor: '#9ea3bb',
                        fontFamily: 'Inter, -apple-system, sans-serif',
                    },
                    grid: {
                        vertLines: { color: 'rgba(42, 46, 57, 0.1)' },
                        horzLines: { color: 'rgba(42, 46, 57, 0.1)' },
                    },
                    crosshair: {
                        mode: CrosshairMode.Normal,
                        vertLine: { 
                            color: 'rgba(158, 163, 187, 0.4)', 
                            labelBackgroundColor: '#1a1b23',
                            width: 1,
                            style: 3 
                        },
                        horzLine: { 
                            color: 'rgba(158, 163, 187, 0.4)', 
                            labelBackgroundColor: '#1a1b23',
                            width: 1,
                            style: 3
                        },
                    },
                    priceScale: {
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        autoScale: true,
                        alignLabels: true,
                    },
                    timeScale: {
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        timeVisible: true,
                    },
                    handleScroll: true,
                    handleScale: true,
                    width: chartContainerRef.current.clientWidth,
                    height: 450,
                });

                chartRef.current = chart;

                // ── 2. Series Setup ───────────────────────────────────────────────
                
                // Advanced Price Formatting (Handles $0.000... style)
                const candleSeries = chart.addCandlestickSeries({
                    upColor: '#20c997', 
                    downColor: '#ff4976',
                    borderVisible: false,
                    wickUpColor: '#20c997',
                    wickDownColor: '#ff4976',
                    priceFormat: {
                        type: 'custom',
                        minMove: 0.0000000001,
                        formatter: p => {
                            if (p === 0) return '0.00';
                            if (p < 0.0001) return p.toFixed(10);
                            return p.toFixed(6);
                        }
                    }
                });

                const volumeSeries = chart.addHistogramSeries({
                    color: '#26a69a',
                    priceFormat: { type: 'volume' },
                    priceScaleId: '', // Overlay
                });

                volumeSeries.priceScale().applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0 },
                });

                // ── 3. Data Processing ───────────────────────────────────────────
                const candles = (data.candles || []).map(c => ({
                    time: Number(c.time),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close)
                }));

                const volumes = (data.candles || []).map(c => ({
                    time: Number(c.time),
                    value: Number(c.volume),
                    color: c.close >= c.open ? 'rgba(32, 201, 151, 0.3)' : 'rgba(255, 73, 118, 0.3)',
                }));

                if (candles.length > 0) {
                    candleSeries.setData(candles);
                    volumeSeries.setData(volumes);
                    setOhlc(candles[candles.length - 1]); // Set initial OHLC to last candle
                }

                // ── 4. Interactivity (Crosshair Move) ────────────────────────────
                chart.subscribeCrosshairMove(param => {
                    if (param.time) {
                        const data = param.seriesData.get(candleSeries);
                        if (data) setOhlc(data);
                    } else if (candles.length > 0) {
                        setOhlc(candles[candles.length - 1]);
                    }
                });

                // ── 5. Resize Handling ───────────────────────────────────────────
                const resizeObserver = new ResizeObserver(entries => {
                    if (entries[0] && chart) {
                        const { width } = entries[0].contentRect;
                        chart.applyOptions({ width });
                    }
                });
                resizeObserver.observe(chartContainerRef.current);

                setLoading(false);

                return () => {
                    resizeObserver.disconnect();
                    chart.remove();
                };
            } catch (err) {
                console.error('[Chart] Error:', err);
                setLoading(false);
            }
        };

        const cleanup = initChart();
        return () => {
            cancelled = true;
            cleanup.then(fn => fn && fn());
        };
    }, [poolAddress, res]);

    return (
        <div className="pd-chart-container">
            {/* ── TOP BAR (DexScreener Style) ── */}
            <div className="pd-chart-toolbar">
                <div className="pd-chart-selectors">
                    {RESOLUTIONS.map(r => (
                        <button
                            key={r}
                            className={`pd-chart-t-btn ${res === r ? 'active' : ''}`}
                            onClick={() => setRes(r)}
                        >
                            {r}
                        </button>
                    ))}
                </div>
                
                {ohlc && (
                    <div className="pd-chart-ohlc">
                        <span className="ohlc-i">O:<span className="ohlc-v">{ohlc.open?.toFixed(8)}</span></span>
                        <span className="ohlc-i">H:<span className="ohlc-v">{ohlc.high?.toFixed(8)}</span></span>
                        <span className="ohlc-i">L:<span className="ohlc-v">{ohlc.low?.toFixed(8)}</span></span>
                        <span className="ohlc-i">C:<span className="ohlc-v">{ohlc.close?.toFixed(8)}</span></span>
                    </div>
                )}
            </div>
            
            <div className="pd-chart-canvas-area" ref={chartContainerRef}>
                {loading && (
                    <div className="pd-chart-loading-overlay">
                        <div className="pd-chart-pulse" />
                        <span>SYNCHRONIZING TICK DATA...</span>
                    </div>
                )}
            </div>
        </div>
    );
}

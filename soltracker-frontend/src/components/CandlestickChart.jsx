import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { io } from 'socket.io-client';
import {
    SOCKET_URL,
    fetchPoolCandles,
    fmtNum,
    fmtPrice,
    fmtUsd,
    normalizeSocketCandle,
} from '../utils/api';
import './CandlestickChart.css';

const RESOLUTIONS = ['1s', '1m', '5m', '15m', '1h', '4h', '1d'];

export default function CandlestickChart({ poolAddress, baseSymbol, quoteSymbol }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const volumeSeriesRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const latestCandleRef = useRef(null);

    const [resolution, setResolution] = useState('15m');
    const [unit, setUnit] = useState('usd');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [legend, setLegend] = useState(null);

    const priceLabel = useMemo(() => (unit === 'usd' ? 'USD' : quoteSymbol || 'SOL'), [quoteSymbol, unit]);

    useEffect(() => {
        if (!containerRef.current) return undefined;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: 'solid', color: '#0f1320' },
                textColor: '#9aa4bd',
                fontFamily: 'Inter, system-ui, sans-serif',
            },
            grid: {
                vertLines: { color: 'rgba(148, 163, 184, 0.07)' },
                horzLines: { color: 'rgba(148, 163, 184, 0.07)' },
            },
            crosshair: {
                mode: 0,
                vertLine: {
                    color: 'rgba(148, 163, 184, 0.25)',
                    width: 1,
                    labelBackgroundColor: '#131926',
                },
                horzLine: {
                    color: 'rgba(148, 163, 184, 0.25)',
                    width: 1,
                    labelBackgroundColor: '#131926',
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(148, 163, 184, 0.08)',
                scaleMargins: {
                    top: 0.08,
                    bottom: 0.28,
                },
            },
            timeScale: {
                borderColor: 'rgba(148, 163, 184, 0.08)',
                rightOffset: 8,
                barSpacing: 10,
                timeVisible: true,
                secondsVisible: false,
            },
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#28d9a2',
            downColor: '#ff5a72',
            wickUpColor: '#28d9a2',
            wickDownColor: '#ff5a72',
            borderVisible: false,
            priceLineVisible: false,
        });

        const volumeSeries = chart.addHistogramSeries({
            color: 'rgba(80, 151, 255, 0.38)',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            scaleMargins: {
                top: 0.78,
                bottom: 0,
            },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        chart.subscribeCrosshairMove((param) => {
            if (!param || !param.time || !candleSeriesRef.current) {
                setLegend(latestCandleRef.current);
                return;
            }

            const data = param.seriesData.get(candleSeriesRef.current);
            if (!data) {
                setLegend(latestCandleRef.current);
                return;
            }

            setLegend({
                time: Number(param.time),
                open: data.open,
                high: data.high,
                low: data.low,
                close: data.close,
                volumeUsd: latestCandleRef.current?.volumeUsd ?? 0,
            });
        });

        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect || !chartRef.current) return;
            chartRef.current.applyOptions({
                width: rect.width,
                height: rect.height,
            });
        });

        observer.observe(containerRef.current);
        resizeObserverRef.current = observer;

        return () => {
            resizeObserverRef.current?.disconnect();
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!chartRef.current) return;

        chartRef.current.applyOptions({
            timeScale: {
                secondsVisible: resolution === '1s',
            },
        });
    }, [resolution]);

    useEffect(() => {
        if (!poolAddress || !candleSeriesRef.current || !volumeSeriesRef.current) return undefined;

        let cancelled = false;

        async function loadCandles() {
            setLoading(true);
            try {
                const response = await fetchPoolCandles(poolAddress, resolution, {
                    unit,
                    limit: resolution === '1s' ? 900 : 700,
                });

                if (cancelled) return;

                const candles = (response.candles || [])
                    .filter((item) => item.open != null && item.high != null && item.low != null && item.close != null)
                    .sort((left, right) => left.time - right.time);

                const chartData = candles.map((item) => ({
                    time: item.time,
                    open: Number(item.open),
                    high: Number(item.high),
                    low: Number(item.low),
                    close: Number(item.close),
                }));

                const histogramData = candles.map((item) => ({
                    time: item.time,
                    value: unit === 'native' ? Number(item.volumeQuote || 0) : Number(item.volumeUsd || 0),
                    color:
                        Number(item.close) >= Number(item.open)
                            ? 'rgba(40, 217, 162, 0.42)'
                            : 'rgba(255, 90, 114, 0.42)',
                }));

                candleSeriesRef.current.setData(chartData);
                volumeSeriesRef.current.setData(histogramData);

                latestCandleRef.current = candles[candles.length - 1] || null;
                setLegend(latestCandleRef.current);
                setError('');
            } catch (err) {
                if (!cancelled) {
                    setError('Unable to load candles from the backend.');
                    candleSeriesRef.current.setData([]);
                    volumeSeriesRef.current.setData([]);
                    latestCandleRef.current = null;
                    setLegend(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadCandles();

        return () => {
            cancelled = true;
        };
    }, [poolAddress, resolution, unit]);

    useEffect(() => {
        if (!poolAddress || !candleSeriesRef.current || !volumeSeriesRef.current) return undefined;

        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
        });

        socket.emit('subscribe', poolAddress);

        socket.on('candle_update', (payload) => {
            const normalized = normalizeSocketCandle(payload, unit);
            if (!normalized || normalized.resolution !== resolution) return;
            if (
                normalized.open == null ||
                normalized.high == null ||
                normalized.low == null ||
                normalized.close == null
            ) {
                return;
            }

            candleSeriesRef.current.update({
                time: normalized.time,
                open: normalized.open,
                high: normalized.high,
                low: normalized.low,
                close: normalized.close,
            });

            volumeSeriesRef.current.update({
                time: normalized.time,
                value: unit === 'native' ? Number(normalized.volumeQuote || 0) : Number(normalized.volumeUsd || 0),
                color:
                    normalized.close >= normalized.open
                        ? 'rgba(40, 217, 162, 0.42)'
                        : 'rgba(255, 90, 114, 0.42)',
            });

            latestCandleRef.current = normalized;
            setLegend(normalized);
        });

        return () => {
            socket.emit('unsubscribe', poolAddress);
            socket.disconnect();
        };
    }, [poolAddress, resolution, unit]);

    return (
        <div className="chart-shell">
            <div className="chart-toolbar">
                <div className="chart-timeframes">
                    {RESOLUTIONS.map((value) => (
                        <button
                            key={value}
                            type="button"
                            className={`chart-btn${resolution === value ? ' active' : ''}`}
                            onClick={() => setResolution(value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>

                <div className="chart-toggles">
                    <button
                        type="button"
                        className={`chart-btn subtle${unit === 'usd' ? ' active' : ''}`}
                        onClick={() => setUnit('usd')}
                    >
                        USD
                    </button>
                    <button
                        type="button"
                        className={`chart-btn subtle${unit === 'native' ? ' active' : ''}`}
                        onClick={() => setUnit('native')}
                    >
                        {quoteSymbol || 'SOL'}
                    </button>
                </div>
            </div>

            <div className="chart-legend">
                <div className="chart-legend-title">
                    {baseSymbol || 'Pool'} / {quoteSymbol || 'SOL'} - {resolution}
                </div>

                {legend ? (
                    <div className="chart-ohlc">
                        <span>O {formatChartPrice(legend.open, unit)}</span>
                        <span>H {formatChartPrice(legend.high, unit)}</span>
                        <span>L {formatChartPrice(legend.low, unit)}</span>
                        <span>C {formatChartPrice(legend.close, unit)}</span>
                        <span>Vol {unit === 'usd' ? fmtUsd(legend.volumeUsd, true) : `${fmtNum(legend.volumeQuote, 2)} ${priceLabel}`}</span>
                    </div>
                ) : (
                    <div className="chart-ohlc muted">Waiting for candles...</div>
                )}
            </div>

            <div className="chart-canvas-wrap">
                <div ref={containerRef} className="chart-canvas" />

                {loading ? (
                    <div className="chart-overlay">
                        <div className="spinner" />
                        <span>Loading candle history...</span>
                    </div>
                ) : null}

                {!loading && error ? (
                    <div className="chart-overlay error">
                        <span>{error}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function formatChartPrice(value, unit) {
    if (unit === 'usd') return fmtPrice(value);
    if (value == null) return '-';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    if (Math.abs(numeric) < 0.000001) return numeric.toExponential(3);
    if (Math.abs(numeric) < 0.001) return numeric.toFixed(8);
    if (Math.abs(numeric) < 1) return numeric.toFixed(6);
    return numeric.toFixed(4);
}

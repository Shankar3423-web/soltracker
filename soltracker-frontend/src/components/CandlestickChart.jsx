import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { io } from 'socket.io-client';
import './CandlestickChart.css';

const SOCKET_URL = process.env.REACT_APP_WS_URL || 'http://localhost:3000';

export default function CandlestickChart({ poolAddress }) {
    const chartContainerRef = useRef();
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const volSeriesRef = useRef(null);
    const [tf, setTf] = useState('5m');

    useEffect(() => {
        if (!poolAddress || !chartContainerRef.current) return;

        // 1. Initialize Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: 'solid', color: '#0d0e12' },
                textColor: '#B2B5BE',
            },
            grid: {
                vertLines: { color: 'rgba(43, 43, 67, 0.4)' },
                horzLines: { color: 'rgba(43, 43, 67, 0.4)' },
            },
            crosshair: {
                mode: 0,
                vertLine: { width: 1, color: '#43475d', style: 3, labelBackgroundColor: '#1c1f26' },
                horzLine: { width: 1, color: '#43475d', style: 3, labelBackgroundColor: '#1c1f26' },
            },
            rightPriceScale: {
                borderColor: '#1e212b',
                autoScale: true,
            },
            timeScale: {
                borderColor: '#1e212b',
                timeVisible: true,
                secondsVisible: false,
                barSpacing: 10,
                rightOffset: 5,
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
        });

        chartRef.current = chart;

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#00d094',
            downColor: '#ff3d71',
            borderVisible: false,
            wickUpColor: '#00d094',
            wickDownColor: '#ff3d71',
        });

        candlestickSeries.applyOptions({
            priceFormat: {
                type: 'price',
                precision: 8,
                minMove: 0.00000001,
            },
        });
        seriesRef.current = candlestickSeries;

        const volumeSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '', 
            scaleMargins: {
                top: 0.8, 
                bottom: 0,
            },
        });
        volSeriesRef.current = volumeSeries;

        let isMounted = true;

        const loadInitialData = async () => {
            try {
                const res = await fetch(`http://localhost:3000/pools/${poolAddress}/candles?resolution=${tf}&limit=1000`);
                if (!res.ok) return;
                const data = await res.json();
                
                if (data.candles && isMounted) {
                    const chartData = [];
                    const volData = [];
                    data.candles.forEach(c => {
                        const isUp = Number(c.close) >= Number(c.open);
                        chartData.push({
                            time: c.time, 
                            open: Number(c.open),
                            high: Number(c.high),
                            low: Number(c.low),
                            close: Number(c.close)
                        });
                        volData.push({
                            time: c.time,
                            value: Number(c.volume),
                            color: isUp ? 'rgba(0, 208, 148, 0.4)' : 'rgba(255, 61, 113, 0.4)'
                        });
                    });
                    candlestickSeries.setData(chartData);
                    volumeSeries.setData(volData);
                }
            } catch (err) {
                console.error("Error fetching candles:", err);
            }
        };

        loadInitialData();

        // 2. Real-Time WebSocket Logic
        const socket = io(SOCKET_URL);
        socket.emit('subscribe', poolAddress);

        socket.on('candle_update', (c) => {
            if (!isMounted || c.resolution !== tf) return;
            
            const isUp = Number(c.close) >= Number(c.open);
            candlestickSeries.update({
                time: c.time,
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close)
            });
            volumeSeries.update({
                time: c.time,
                value: Number(c.volume),
                color: isUp ? 'rgba(0, 208, 148, 0.4)' : 'rgba(255, 61, 113, 0.4)'
            });
        });

        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
            const newRect = entries[0].contentRect;
            chart.applyOptions({ width: newRect.width, height: newRect.height });
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            isMounted = false;
            socket.emit('unsubscribe', poolAddress);
            socket.disconnect();
            resizeObserver.disconnect();
            chart.remove();
        };
    }, [poolAddress, tf]);

    return (
        <div className="pd-chart-wrapper">
            <div className="pd-chart-toolbar">
                {['1m', '5m', '15m', '1h', '4h'].map(t => (
                    <button 
                        key={t}
                        className={`pd-chart-tb-btn ${tf === t ? 'active' : ''}`}
                        onClick={() => setTf(t)}
                    >
                        {t.toUpperCase()}
                    </button>
                ))}
            </div>
            <div ref={chartContainerRef} className="pd-chart-container" />
        </div>
    );
}

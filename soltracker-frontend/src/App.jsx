import React, { useState } from 'react';
import './styles/global.css';
import './App.css';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PoolList from './components/PoolList';
import PoolDetail from './components/PoolDetail';

function EmptyState() {
    return (
        <div className="app-empty">
            <div className="app-empty-glow" />
            <div className="app-empty-card">
                <span className="app-empty-kicker">SOLANA MARKET FEED</span>
                <h1>Select a pool to open the live market view</h1>
                <p>
                    Price, candles, live swaps, rolling 5m / 1h / 6h / 24h stats, liquidity,
                    FDV, market cap, and maker flow will render here as soon as you pick a pair.
                </p>
            </div>
        </div>
    );
}

export default function App() {
    const [activeDex, setActiveDex] = useState(null);
    const [selectedPool, setSelectedPool] = useState(null);

    function handleDexChange(key) {
        setActiveDex(key);
        setSelectedPool(null);
    }

    return (
        <div className="app-shell">
            <Sidebar />
            <div className="app-main">
                <TopBar activeDex={activeDex} onDexChange={handleDexChange} />
                <div className="app-body">
                    <section className="app-list-panel">
                        <PoolList
                            activeDex={activeDex}
                            selectedPoolAddress={selectedPool?.poolAddress ?? null}
                            onSelectPool={setSelectedPool}
                        />
                    </section>

                    <section className="app-detail-panel">
                        {selectedPool ? (
                            <PoolDetail
                                pool={selectedPool}
                                onClose={() => setSelectedPool(null)}
                            />
                        ) : (
                            <EmptyState />
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

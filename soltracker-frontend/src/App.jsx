import React, { useState, useEffect } from 'react';
import './styles/global.css';
import './App.css';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PoolList from './components/PoolList';
import PoolDetail from './components/PoolDetail';
import WatchlistPanel from './components/WatchlistPanel';
import TransactionHistory from './components/TransactionHistory';
import { useWatchlistStore } from './hooks/useWatchlistStore';
import { useWatchlistSockets } from './hooks/useWatchlistSockets';

export default function App() {
    const [view, setView] = useState('market'); // 'market', 'watchlist', or 'history'
    const [activeDex, setActiveDex] = useState(null);
    const [selectedPool, setSelectedPool] = useState(null);

    const { fetchWatchlists } = useWatchlistStore();
    useWatchlistSockets();

    useEffect(() => {
        fetchWatchlists();
    }, [fetchWatchlists]);

    function handleDexChange(key) {
        setActiveDex(key);
        setSelectedPool(null);
        setView('market');
    }

    function handleViewWatchlist() {
        setView('watchlist');
        setSelectedPool(null);
    }

    function handleViewHistory() {
        setView('history');
        setSelectedPool(null);
    }

    return (
        <div className="app-shell">
            <Sidebar 
                onSelectSolana={() => handleDexChange(null)} 
                onSelectWatchlist={handleViewWatchlist}
                onSelectHistory={handleViewHistory}
            />
            <div className="app-main">
                <TopBar
                    activeDex={activeDex}
                    onDexChange={handleDexChange}
                    selectedPool={selectedPool}
                />
                <div className={`app-body${selectedPool ? ' has-detail' : ' pools-only'}`}>
                    {selectedPool ? (
                        <section className="app-detail-panel open">
                            <PoolDetail
                                pool={selectedPool}
                                onClose={() => setSelectedPool(null)}
                            />
                        </section>
                    ) : view === 'watchlist' ? (
                        <section className="app-list-panel">
                            <WatchlistPanel onSelectPool={setSelectedPool} />
                        </section>
                    ) : view === 'history' ? (
                        <section className="app-list-panel">
                            <TransactionHistory onClose={() => setView('market')} />
                        </section>
                    ) : (
                        <section className="app-list-panel">
                            <PoolList
                                activeDex={activeDex}
                                selectedPoolAddress={selectedPool?.poolAddress ?? null}
                                onSelectPool={setSelectedPool}
                            />
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}

import React, { useState } from 'react';
import './styles/global.css';
import './App.css';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PoolList from './components/PoolList';
import PoolDetail from './components/PoolDetail';

export default function App() {
    const [activeDex, setActiveDex] = useState(null);
    const [selectedPool, setSelectedPool] = useState(null);

    function handleDexChange(key) {
        setActiveDex(key);
        setSelectedPool(null);
    }

    return (
        <div className="app-shell">
            <Sidebar onSelectSolana={() => handleDexChange(null)} />
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

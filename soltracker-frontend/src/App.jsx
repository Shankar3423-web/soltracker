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
        <div className="app">
            <Sidebar />
            <div className="app-main">
                <TopBar activeDex={activeDex} onDexChange={handleDexChange} />
                <div className="app-body">
                    {!selectedPool ? (
                        <div className="app-left">
                            <PoolList
                                activeDex={activeDex}
                                onSelectPool={(pool) => setSelectedPool(pool)}
                            />
                        </div>
                    ) : (
                        <div className="app-full-view">
                            <PoolDetail
                                pool={selectedPool}
                                onClose={() => setSelectedPool(null)}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
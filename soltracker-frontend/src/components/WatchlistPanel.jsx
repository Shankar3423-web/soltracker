import React, { useEffect, useState } from 'react';
import { useWatchlistStore } from '../hooks/useWatchlistStore';
import { fmtPrice, fmtPct, short, avatarGrad } from '../utils/api';
import './WatchlistPanel.css';

/**
 * WatchlistPanel displays the user's saved pool lists.
 * Allows creating new lists, deleting lists, and removing items.
 */
export default function WatchlistPanel({ onSelectPool }) {
    const { 
        watchlists, 
        fetchWatchlists, 
        createNewWatchlist, 
        deleteWatchlist, 
        removePoolFromWatchlist, 
        loading 
    } = useWatchlistStore();
    
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');

    useEffect(() => {
        fetchWatchlists();
    }, [fetchWatchlists]);

    const handleCreate = async (e) => {
        e.preventDefault();
        const trimmed = newName.trim();
        if (!trimmed) return;
        try {
            await createNewWatchlist(trimmed);
            setNewName('');
            setIsCreating(false);
        } catch (err) {
            alert(err.message);
        }
    };

    if (loading && watchlists.length === 0) {
        return (
            <div className="wp-loading">
                <div className="spinner" />
                <span>Syncing watchlists...</span>
            </div>
        );
    }

    return (
        <div className="wp-wrap">
            <header className="wp-header">
                <div className="wp-title-group">
                    <h2>Tracked Pools</h2>
                    <span className="wp-count">{watchlists.length} lists</span>
                </div>
                <button className="wp-add-btn" onClick={() => setIsCreating(true)}>
                    + New List
                </button>
            </header>

            {isCreating && (
                <form className="wp-create-form" onSubmit={handleCreate}>
                    <input 
                        autoFocus
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="List name (e.g. Moonshots)"
                    />
                    <div className="wp-form-actions">
                        <button type="submit" className="wp-submit">Create</button>
                        <button type="button" className="wp-cancel" onClick={() => setIsCreating(false)}>Cancel</button>
                    </div>
                </form>
            )}

            <div className="wp-scroll-box">
                {watchlists.length === 0 ? (
                    <div className="wp-empty">
                        <p>You haven't created any watchlists yet.</p>
                        {!isCreating && (
                            <button onClick={() => setIsCreating(true)}>Create your first list</button>
                        )}
                    </div>
                ) : (
                    <div className="wp-list-stack">
                        {watchlists.map(list => (
                            <WatchlistCard 
                                key={list.id} 
                                list={list} 
                                onRemove={removePoolFromWatchlist}
                                onDelete={deleteWatchlist}
                                onSelectPool={onSelectPool}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function WatchlistCard({ list, onRemove, onDelete, onSelectPool }) {
    return (
        <div className="wp-card">
            <div className="wp-card-header">
                <h3>{list.name}</h3>
                <button 
                    className="wp-del-list" 
                    onClick={() => window.confirm(`Delete "${list.name}"?`) && onDelete(list.id)}
                    title="Delete List"
                >
                    <TrashIcon />
                </button>
            </div>
            
            <div className="wp-card-items">
                {list.items.length === 0 ? (
                    <div className="wp-item-empty">
                        <span>No pools in this list.</span>
                        <p>Add pools using the star icon on the market feed.</p>
                    </div>
                ) : (
                    list.items.map(item => (
                        <div 
                            key={item.poolAddress} 
                            className={`wp-item ${item.isOptimistic ? 'optimistic' : ''}`} 
                            onClick={() => onSelectPool(item)}
                        >
                            <div className="wp-item-main">
                                <div className="wp-item-avatar" style={{ background: avatarGrad(item.poolAddress) }}>
                                    {item.baseSymbol?.[0] || '?'}
                                </div>
                                <div className="wp-item-info">
                                    <div className="wp-item-name">
                                        {item.baseSymbol}
                                        <span className="wp-item-quote">/{item.quoteSymbol || 'SOL'}</span>
                                    </div>
                                    <div className="wp-item-dex">{item.dexName || 'Solana'}</div>
                                </div>
                            </div>
                            
                            <div className="wp-item-stats">
                                <div className="wp-item-price">{fmtPrice(item.priceUsd)}</div>
                                <div className={`wp-item-pct ${item.priceChange24h >= 0 ? 'up' : 'down'}`}>
                                    {fmtPct(item.priceChange24h)}
                                </div>
                                <button 
                                    className="wp-item-remove" 
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        onRemove(list.id, item.poolAddress); 
                                    }}
                                    title="Remove from watchlist"
                                >
                                    &times;
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function TrashIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

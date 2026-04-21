import React from 'react';
import { useWatchlistStore } from '../hooks/useWatchlistStore';
import './WatchlistButton.css';

/**
 * A reusable "Star" button to toggle a pool in the user's default watchlist.
 * If multiple watchlists exist, it adds to the first one.
 */
export default function WatchlistButton({ pool }) {
    const { watchlists, addPoolToWatchlist, removePoolFromWatchlist, loading } = useWatchlistStore();
    
    // For now, we assume the first watchlist is the "Default" one
    // In a full implementation, we might show a menu to pick which list
    const activeList = watchlists[0];
    const poolAddress = pool?.poolAddress || pool?.address;
    
    const isInWatchlist = activeList?.items?.some(item => item.poolAddress === poolAddress);

    const handleToggle = async (e) => {
        e.stopPropagation();
        if (!activeList) {
            // If no watchlist exists, create one first or alert user
            alert('Please create a watchlist in the Sidebar first!');
            return;
        }

        try {
            if (isInWatchlist) {
                await removePoolFromWatchlist(activeList.id, poolAddress);
            } else {
                await addPoolToWatchlist(activeList.id, pool);
            }
        } catch (err) {
            console.error('Failed to toggle watchlist:', err.message);
        }
    };

    if (loading && watchlists.length === 0) return null;

    return (
        <button 
            className={`wl-btn ${isInWatchlist ? 'active' : ''}`}
            onClick={handleToggle}
            title={isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
            type="button"
        >
            <StarIcon filled={isInWatchlist} />
        </button>
    );
}

function StarIcon({ filled }) {
    return (
        <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill={filled ? "currentColor" : "none"} 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
        >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    );
}

import { auth as firebaseAuth } from '../utils/firebase';
import { BASE } from '../utils/api';

/**
 * Helper to get the current authentication header.
 * Supports both Firebase ID tokens and direct Wallet address.
 */
async function getAuthHeader() {
    // 1. Check for Firebase user
    const user = firebaseAuth.currentUser;
    if (user) {
        try {
            const token = await user.getIdToken();
            return `Bearer ${token}`;
        } catch (err) {
            console.warn('[WatchlistApi] Error getting Firebase token:', err.message);
        }
    }

    // 2. Check for connected wallet in localStorage
    const walletDisconnected = localStorage.getItem('wallet_disconnected') === 'true';
    const walletAddress = localStorage.getItem('wallet_address');
    
    if (!walletDisconnected && walletAddress) {
        return `Bearer wallet:${walletAddress}`;
    }

    return null;
}

/**
 * Generic request wrapper with auth and error handling.
 */
async function request(path, options = {}) {
    try {
        const authHeader = await getAuthHeader();
        
        const headers = {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...options.headers,
        };

        const res = await fetch(`${BASE}${path}`, {
            ...options,
            headers,
        });

        if (res.status === 401) {
            throw new Error('Unauthorized: Please sign in or connect your wallet.');
        }

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP Error ${res.status}`);
        }

        return await res.json();
    } catch (err) {
        console.error(`[WatchlistApi] Request failed (${path}):`, err.message);
        throw err;
    }
}

/**
 * Watchlist API service
 */
export const watchlistApi = {
    /**
     * Fetch all watchlists for the current user (hydrated).
     */
    getWatchlists: () => request('/watchlists'),

    /**
     * Create a new watchlist.
     */
    createWatchlist: (name) => request('/watchlists', { 
        method: 'POST', 
        body: JSON.stringify({ name }) 
    }),

    /**
     * Add a pool to a specific watchlist.
     */
    addItem: (listId, poolAddress) => request(`/watchlists/${listId}/items`, { 
        method: 'POST', 
        body: JSON.stringify({ pool_address: poolAddress }) 
    }),

    /**
     * Remove a pool from a specific watchlist.
     */
    removeItem: (listId, poolAddress) => request(`/watchlists/${listId}/items/${poolAddress}`, { 
        method: 'DELETE' 
    }),

    /**
     * Update the display order of items in a watchlist.
     */
    reorder: (listId, positions) => request(`/watchlists/${listId}/reorder`, { 
        method: 'PUT', 
        body: JSON.stringify({ positions }) 
    }),

    /**
     * Delete a whole watchlist.
     */
    deleteWatchlist: (listId) => request(`/watchlists/${listId}`, { 
        method: 'DELETE' 
    }),
};

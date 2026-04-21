import { create } from 'zustand';
import { watchlistApi } from '../services/watchlistApi';

/**
 * Zustand store for Watchlist management.
 * Features optimistic UI updates, background syncing, and real-time price merging.
 */
export const useWatchlistStore = create((set, get) => ({
    watchlists: [],
    loading: false,
    error: null,

    /**
     * Fetch all watchlists for the current user.
     */
    fetchWatchlists: async () => {
        set({ loading: true, error: null });
        try {
            const data = await watchlistApi.getWatchlists();
            set({ watchlists: data.watchlists, loading: false });
        } catch (err) {
            // Only set error if it's not a 401 (logged out)
            if (err.message !== 'Unauthorized') {
                set({ error: err.message, loading: false });
            } else {
                set({ loading: false, watchlists: [] });
            }
        }
    },

    /**
     * Optimistically add a pool to a watchlist.
     */
    addPoolToWatchlist: async (listId, pool) => {
        const { watchlists } = get();
        const listIndex = watchlists.findIndex(l => String(l.id) === String(listId));
        if (listIndex === -1) return;

        // Save original state for rollback
        const originalWatchlists = [...watchlists];
        
        // Check if already exists in local state
        const list = watchlists[listIndex];
        if (list.items.find(i => i.poolAddress === pool.poolAddress)) return;

        const newItem = {
            poolAddress: pool.poolAddress,
            baseSymbol: pool.baseSymbol,
            quoteSymbol: pool.quoteSymbol,
            priceUsd: pool.priceUsd,
            priceChange24h: pool.priceChange24h,
            addedAt: new Date().toISOString(),
            isOptimistic: true
        };

        const newList = { 
            ...list, 
            items: [...list.items, newItem] 
        };

        const nextWatchlists = [...watchlists];
        nextWatchlists[listIndex] = newList;
        
        set({ watchlists: nextWatchlists });

        try {
            await watchlistApi.addItem(listId, pool.poolAddress);
            
            // Success: remove optimistic flag
            set((state) => {
                const ws = [...state.watchlists];
                const updatedList = { ...ws[listIndex] };
                updatedList.items = updatedList.items.map(i => 
                    i.poolAddress === pool.poolAddress ? { ...i, isOptimistic: false } : i
                );
                ws[listIndex] = updatedList;
                return { watchlists: ws };
            });
        } catch (err) {
            // Failure: rollback to original state
            console.error('[WatchlistStore] Failed to add pool:', err.message);
            set({ watchlists: originalWatchlists });
            throw err;
        }
    },

    /**
     * Optimistically remove a pool from a watchlist.
     */
    removePoolFromWatchlist: async (listId, poolAddress) => {
        const { watchlists } = get();
        const listIndex = watchlists.findIndex(l => String(l.id) === String(listId));
        if (listIndex === -1) return;

        const originalWatchlists = [...watchlists];
        const list = watchlists[listIndex];
        
        const newList = { 
            ...list, 
            items: list.items.filter(i => i.poolAddress !== poolAddress) 
        };
        
        const nextWatchlists = [...watchlists];
        nextWatchlists[listIndex] = newList;
        set({ watchlists: nextWatchlists });

        try {
            await watchlistApi.removeItem(listId, poolAddress);
        } catch (err) {
            console.error('[WatchlistStore] Failed to remove pool:', err.message);
            set({ watchlists: originalWatchlists });
            throw err;
        }
    },

    /**
     * Merge real-time price updates into the store.
     * Called by WebSocket listeners.
     */
    updatePoolPrice: (poolAddress, newPrice, priceChange24h) => {
        set((state) => {
            const nextWatchlists = state.watchlists.map(list => ({
                ...list,
                items: list.items.map(item => 
                    item.poolAddress === poolAddress 
                        ? { ...item, priceUsd: newPrice, priceChange24h }
                        : item
                )
            }));
            return { watchlists: nextWatchlists };
        });
    },

    /**
     * Create a new empty watchlist.
     */
    createNewWatchlist: async (name) => {
        try {
            const newList = await watchlistApi.createWatchlist(name);
            set((state) => ({
                watchlists: [ { ...newList, items: [] }, ...state.watchlists ]
            }));
            return newList;
        } catch (err) {
            console.error('[WatchlistStore] Failed to create watchlist:', err.message);
            throw err;
        }
    },

    /**
     * Delete an entire watchlist.
     */
    deleteWatchlist: async (listId) => {
        const { watchlists } = get();
        const originalWatchlists = [...watchlists];
        
        set((state) => ({
            watchlists: state.watchlists.filter(l => String(l.id) !== String(listId))
        }));

        try {
            await watchlistApi.deleteWatchlist(listId);
        } catch (err) {
            console.error('[WatchlistStore] Failed to delete watchlist:', err.message);
            set({ watchlists: originalWatchlists });
            throw err;
        }
    }
}));

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL, normalizeTransaction } from '../utils/api';
import { useWatchlistStore } from './useWatchlistStore';

/**
 * Hook to manage WebSocket subscriptions for all pools in the user's watchlists.
 * Ensures the watchlist UI stays live without full page refreshes.
 */
export function useWatchlistSockets() {
    const { watchlists, updatePoolPrice } = useWatchlistStore();
    const socketRef = useRef(null);
    const subsRef = useRef(new Set());

    useEffect(() => {
        if (!socketRef.current) {
            socketRef.current = io(SOCKET_URL, {
                transports: ['websocket', 'polling'],
            });

            socketRef.current.on('new_swap', (incoming) => {
                const tx = normalizeTransaction(incoming);
                if (tx && tx.priceUsd) {
                    // Update price and 24h change in the store
                    updatePoolPrice(
                        incoming.pool_address, 
                        tx.priceUsd, 
                        incoming.price_change_24h ?? incoming.stats?.priceChange24h
                    );
                }
            });
        }

        const socket = socketRef.current;

        // Current set of pools in all watchlists
        const currentPools = new Set();
        watchlists.forEach(list => {
            list.items.forEach(item => {
                currentPools.add(item.poolAddress);
            });
        });

        // 1. Subscribe to NEW pools
        currentPools.forEach(addr => {
            if (!subsRef.current.has(addr)) {
                socket.emit('subscribe', addr);
                subsRef.current.add(addr);
            }
        });

        // 2. Unsubscribe from REMOVED pools
        subsRef.current.forEach(addr => {
            if (!currentPools.has(addr)) {
                socket.emit('unsubscribe', addr);
                subsRef.current.delete(addr);
            }
        });

    }, [watchlists, updatePoolPrice]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
                subsRef.current.clear();
            }
        };
    }, []);
}

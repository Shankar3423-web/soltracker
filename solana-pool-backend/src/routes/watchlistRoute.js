'use strict';
const express = require('express');
const router = express.Router();
const watchlistAuth = require('../middleware/watchlistAuth');
const repo = require('../repositories/watchlistRepository');

// All watchlist routes require authentication
router.use(watchlistAuth);

/**
 * GET /watchlists
 * List all watchlists for the authenticated user (hydrated with pool stats).
 */
router.get('/', async (req, res) => {
    try {
        const watchlists = await repo.getHydratedWatchlists(req.user.uid);
        res.json({ watchlists });
    } catch (err) {
        console.error('[WatchlistRoute] GET error:', err.message);
        res.status(500).json({ error: 'Failed to fetch watchlists' });
    }
});

/**
 * POST /watchlists
 * Create a new watchlist container.
 */
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        
        const list = await repo.createWatchlist(req.user.uid, name);
        res.status(201).json(list);
    } catch (err) {
        console.error('[WatchlistRoute] POST error:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A watchlist with this name already exists' });
        }
        res.status(500).json({ error: 'Failed to create watchlist' });
    }
});

/**
 * POST /watchlists/:id/items
 * Add a pool address to a specific watchlist.
 */
router.post('/:id/items', async (req, res) => {
    try {
        const { id } = req.params;
        const { pool_address } = req.body;
        if (!pool_address) return res.status(400).json({ error: 'pool_address is required' });

        const item = await repo.addItem(id, pool_address);
        if (!item) {
             // Conflict handled by repository with DO NOTHING
             return res.status(200).json({ message: 'Item already in watchlist', conflict: true });
        }
        res.status(201).json(item);
    } catch (err) {
        console.error('[WatchlistRoute] POST item error:', err.message);
        res.status(500).json({ error: 'Failed to add item' });
    }
});

/**
 * DELETE /watchlists/:id/items/:addr
 * Remove a pool address from a specific watchlist.
 */
router.delete('/:id/items/:addr', async (req, res) => {
    try {
        const { id, addr } = req.params;
        const item = await repo.removeItem(id, addr);
        if (!item) return res.status(404).json({ error: 'Item not found in this watchlist' });
        res.json({ success: true, removed: item });
    } catch (err) {
        console.error('[WatchlistRoute] DELETE item error:', err.message);
        res.status(500).json({ error: 'Failed to remove item' });
    }
});

/**
 * PUT /watchlists/:id/reorder
 * Batch update positions of items in a watchlist.
 */
router.put('/:id/reorder', async (req, res) => {
    try {
        const { id } = req.params;
        const { positions } = req.body; // Expect [{ poolAddress: string, position: number }]
        if (!Array.isArray(positions)) return res.status(400).json({ error: 'Positions must be an array' });

        await repo.updatePositions(id, positions);
        res.json({ success: true });
    } catch (err) {
        console.error('[WatchlistRoute] PUT reorder error:', err.message);
        res.status(500).json({ error: 'Failed to reorder items' });
    }
});

/**
 * DELETE /watchlists/:id
 * Delete a whole watchlist and its items (cascades).
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const list = await repo.deleteWatchlist(id, req.user.uid);
        if (!list) return res.status(404).json({ error: 'Watchlist not found or unauthorized' });
        res.json({ success: true, deleted: list });
    } catch (err) {
        console.error('[WatchlistRoute] DELETE list error:', err.message);
        res.status(500).json({ error: 'Failed to delete watchlist' });
    }
});

module.exports = router;

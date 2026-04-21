'use strict';
const db = require('../config/db');

/**
 * Fetch all watchlists for a user with their items hydrated with stats.
 */
async function getHydratedWatchlists(ownerUid) {
    const query = `
        SELECT 
            w.id as watchlist_id, 
            w.name as watchlist_name, 
            wi.pool_address, 
            wi.position,
            wi.added_at,
            p.base_symbol, 
            p.quote_symbol,
            p.dex_id,
            d.name as dex_name,
            ps.price_usd, 
            ps.price_change_24h,
            ps.liquidity_usd
        FROM watchlists w
        LEFT JOIN watchlist_items wi ON wi.watchlist_id = w.id
        LEFT JOIN pools p ON p.pool_address = wi.pool_address
        LEFT JOIN dexes d ON d.id = p.dex_id
        LEFT JOIN pool_stats ps ON ps.pool_address = wi.pool_address
        WHERE w.owner_firebase_uid = $1
        ORDER BY w.updated_at DESC, wi.position ASC
    `;
    const result = await db.query(query, [ownerUid]);
    
    // Group by watchlist
    const watchlistsMap = new Map();
    for (const row of result.rows) {
        const wid = String(row.watchlist_id);
        if (!watchlistsMap.has(wid)) {
            watchlistsMap.set(wid, {
                id: row.watchlist_id,
                name: row.watchlist_name,
                items: []
            });
        }
        if (row.pool_address) {
            watchlistsMap.get(wid).items.push({
                poolAddress: row.pool_address,
                position: row.position,
                addedAt: row.added_at,
                baseSymbol: row.base_symbol,
                quoteSymbol: row.quote_symbol,
                dexName: row.dex_name,
                priceUsd: row.price_usd,
                priceChange24h: row.price_change_24h,
                liquidityUsd: row.liquidity_usd
            });
        }
    }
    return Array.from(watchlistsMap.values());
}

async function createWatchlist(ownerUid, name) {
    const result = await db.query(
        'INSERT INTO watchlists (owner_firebase_uid, name) VALUES ($1, $2) RETURNING *',
        [ownerUid, name]
    );
    return result.rows[0];
}

async function addItem(watchlistId, poolAddress) {
    // Get max position to append to end
    const posRes = await db.query(
        'SELECT COALESCE(MAX(position), -1) as max_pos FROM watchlist_items WHERE watchlist_id = $1',
        [watchlistId]
    );
    const nextPos = Number(posRes.rows[0].max_pos) + 1;

    const result = await db.query(
        `INSERT INTO watchlist_items (watchlist_id, pool_address, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (watchlist_id, pool_address) DO NOTHING
         RETURNING *`,
        [watchlistId, poolAddress, nextPos]
    );
    return result.rows[0];
}

async function removeItem(watchlistId, poolAddress) {
    const result = await db.query(
        'DELETE FROM watchlist_items WHERE watchlist_id = $1 AND pool_address = $2 RETURNING *',
        [watchlistId, poolAddress]
    );
    return result.rows[0];
}

async function updatePositions(watchlistId, positions) {
    // positions: [{ poolAddress: string, position: number }]
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        for (const item of positions) {
            await client.query(
                'UPDATE watchlist_items SET position = $1 WHERE watchlist_id = $2 AND pool_address = $3',
                [item.position, watchlistId, item.poolAddress]
            );
        }
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function deleteWatchlist(watchlistId, ownerUid) {
    const result = await db.query(
        'DELETE FROM watchlists WHERE id = $1 AND owner_firebase_uid = $2 RETURNING *',
        [watchlistId, ownerUid]
    );
    return result.rows[0];
}

module.exports = {
    getHydratedWatchlists,
    createWatchlist,
    addItem,
    removeItem,
    updatePositions,
    deleteWatchlist
};

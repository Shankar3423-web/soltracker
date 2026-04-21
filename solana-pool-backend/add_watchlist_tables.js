require('dotenv').config();
const { Pool } = require('pg');

const poolConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    };

const pool = new Pool(poolConfig);

const SQL = `
-- Container for different watchlists
CREATE TABLE IF NOT EXISTS watchlists (
    id BIGSERIAL PRIMARY KEY,
    owner_firebase_uid VARCHAR(128) NOT NULL, -- Supports 'wallet:<address>' or Firebase UID
    name VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique index to prevent same-name lists for a user
-- Using LOWER(name) to ensure case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_owner_name_unique ON watchlists (owner_firebase_uid, LOWER(name));

-- Storage for tokens/pools inside a watchlist
CREATE TABLE IF NOT EXISTS watchlist_items (
    id BIGSERIAL PRIMARY KEY,
    watchlist_id BIGINT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    pool_address VARCHAR(100) NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    position INT NOT NULL DEFAULT 0, -- Used for manual reordering
    CONSTRAINT unique_watchlist_pair UNIQUE (watchlist_id, pool_address)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_added ON watchlist_items (watchlist_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_pool ON watchlist_items (pool_address);
`;

async function run() {
    try {
        console.log("🚀 Creating Watchlist Tables...");
        await pool.query(SQL);
        console.log("✅ Watchlist tables created successfully.");
    } catch (err) {
        console.error("❌ Failed to create watchlist tables:", err.message);
        if (err.detail) console.error("Detail:", err.detail);
    } finally {
        await pool.end();
    }
}

run();

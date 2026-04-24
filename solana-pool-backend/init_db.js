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

const SCHEMA_SQL = `
-- 1. DEXes
CREATE TABLE IF NOT EXISTS dexes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Tokens
CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    symbol VARCHAR(50),
    name VARCHAR(255),
    decimals SMALLINT,
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Pools
CREATE TABLE IF NOT EXISTS pools (
    id SERIAL PRIMARY KEY,
    pool_address VARCHAR(88) NOT NULL UNIQUE,
    dex_id INTEGER NOT NULL REFERENCES dexes(id),
    base_token_mint VARCHAR(88) NOT NULL,
    quote_token_mint VARCHAR(88) NOT NULL,
    base_symbol VARCHAR(50),
    quote_symbol VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Swaps
CREATE TABLE IF NOT EXISTS swaps (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(255) NOT NULL,
    event_index INTEGER NOT NULL DEFAULT 0,
    pool_address VARCHAR(88) NOT NULL,
    dex_id INTEGER NOT NULL,
    wallet VARCHAR(255),
    base_amount NUMERIC,
    quote_amount NUMERIC,
    price NUMERIC,
    usd_value NUMERIC,
    price_usd NUMERIC(30, 12),
    price_sol NUMERIC(30, 12),
    quote_price_usd NUMERIC(30, 12),
    swap_side VARCHAR(10),
    classification VARCHAR(50),
    slot BIGINT,
    block_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (signature, pool_address, event_index)
);

-- 5. Pool Stats
CREATE TABLE IF NOT EXISTS pool_stats (
    pool_address VARCHAR(255) PRIMARY KEY,
    price NUMERIC DEFAULT 0,
    price_native NUMERIC,
    price_usd NUMERIC,
    price_sol NUMERIC,
    liquidity NUMERIC DEFAULT 0,
    liquidity_usd NUMERIC,
    liquidity_base NUMERIC,
    liquidity_quote NUMERIC,
    liquidity_updated_at TIMESTAMP,
    fdv NUMERIC DEFAULT 0,
    market_cap NUMERIC DEFAULT 0,
    volume_24h NUMERIC DEFAULT 0,
    volume_6h NUMERIC DEFAULT 0,
    volume_1h NUMERIC DEFAULT 0,
    volume_5m NUMERIC DEFAULT 0,
    tx_count_24h INTEGER DEFAULT 0,
    tx_count_6h INTEGER DEFAULT 0,
    tx_count_1h INTEGER DEFAULT 0,
    tx_count_5m INTEGER DEFAULT 0,
    buys_24h INTEGER DEFAULT 0,
    buys_6h INTEGER DEFAULT 0,
    buys_1h INTEGER DEFAULT 0,
    buys_5m INTEGER DEFAULT 0,
    sells_24h INTEGER DEFAULT 0,
    sells_6h INTEGER DEFAULT 0,
    sells_1h INTEGER DEFAULT 0,
    sells_5m INTEGER DEFAULT 0,
    makers_24h INTEGER DEFAULT 0,
    makers_6h INTEGER DEFAULT 0,
    makers_1h INTEGER DEFAULT 0,
    makers_5m INTEGER DEFAULT 0,
    buyers_24h INTEGER DEFAULT 0,
    buyers_6h INTEGER DEFAULT 0,
    buyers_1h INTEGER DEFAULT 0,
    buyers_5m INTEGER DEFAULT 0,
    sellers_24h INTEGER DEFAULT 0,
    sellers_6h INTEGER DEFAULT 0,
    sellers_1h INTEGER DEFAULT 0,
    sellers_5m INTEGER DEFAULT 0,
    buy_volume_24h NUMERIC DEFAULT 0,
    buy_volume_6h NUMERIC DEFAULT 0,
    buy_volume_1h NUMERIC DEFAULT 0,
    buy_volume_5m NUMERIC DEFAULT 0,
    sell_volume_24h NUMERIC DEFAULT 0,
    sell_volume_6h NUMERIC DEFAULT 0,
    sell_volume_1h NUMERIC DEFAULT 0,
    sell_volume_5m NUMERIC DEFAULT 0,
    price_change_5m NUMERIC DEFAULT 0,
    price_change_1h NUMERIC DEFAULT 0,
    price_change_6h NUMERIC DEFAULT 0,
    price_change_24h NUMERIC DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. Pool Candles
CREATE TABLE IF NOT EXISTS pool_candles (
    pool_address TEXT NOT NULL,
    resolution VARCHAR(10) NOT NULL,
    time_bucket TIMESTAMP NOT NULL,
    open_price NUMERIC,
    high_price NUMERIC,
    low_price NUMERIC,
    close_price NUMERIC,
    open_price_native NUMERIC,
    high_price_native NUMERIC,
    low_price_native NUMERIC,
    close_price_native NUMERIC,
    volume_usd NUMERIC DEFAULT 0,
    volume_base NUMERIC DEFAULT 0,
    volume_quote NUMERIC DEFAULT 0,
    tx_count INTEGER DEFAULT 0,
    buys INTEGER DEFAULT 0,
    sells INTEGER DEFAULT 0,
    first_trade_time TIMESTAMP,
    last_trade_time TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (pool_address, resolution, time_bucket)
);

-- 7. Users (Social/Google Profiles)
CREATE TABLE IF NOT EXISTS users (
    firebase_uid TEXT PRIMARY KEY, -- UID from Firebase
    email TEXT,
    name TEXT,
    picture TEXT,
    wallet_address TEXT UNIQUE,   -- Optional link to a Solana wallet
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Auth Nonces (Wallet Users Lightweight Store)
CREATE TABLE IF NOT EXISTS auth_nonces (
    wallet_address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,           -- Used for signature verification
    username TEXT,                 -- Custom display name for wallet users
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Webhook Ingest Queue
CREATE TABLE IF NOT EXISTS webhook_ingest_queue (
    signature VARCHAR(128) PRIMARY KEY,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_error TEXT,
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 10. Trade Logs (Buy/Sell Wrapper tracking)
CREATE TABLE IF NOT EXISTS trade_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique log ID
    wallet_address TEXT NOT NULL,                   -- User's wallet
    input_mint TEXT NOT NULL,                      -- Selling this
    output_mint TEXT NOT NULL,                     -- Buying this
    input_amount NUMERIC NOT NULL,                 -- Amount user spent
    expected_output NUMERIC NOT NULL,              -- Amount user expected
    fee_collected_sol NUMERIC NOT NULL,            -- The 0.5% fee in SOL
    tx_signature TEXT,                             -- Transaction hash (filled after success)
    status TEXT NOT NULL DEFAULT 'pending',        -- 'pending', 'success', 'failed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_swaps_pool_address ON swaps(pool_address);
CREATE INDEX IF NOT EXISTS idx_swaps_block_time ON swaps(block_time);
CREATE INDEX IF NOT EXISTS idx_swaps_signature_pool_event ON swaps (signature, pool_address, event_index);
CREATE INDEX IF NOT EXISTS idx_swaps_pool_time ON swaps (pool_address, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_pool_side_time ON swaps (pool_address, swap_side, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_pool_wallet_time ON swaps (pool_address, wallet, block_time DESC);

CREATE INDEX IF NOT EXISTS idx_candles_pool_res_time ON pool_candles(pool_address, resolution, time_bucket);
CREATE INDEX IF NOT EXISTS idx_pool_candles_lookup ON pool_candles (pool_address, resolution, time_bucket DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_ingest_queue_status_next_attempt ON webhook_ingest_queue (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address ON users (wallet_address) WHERE wallet_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_logs_wallet ON trade_logs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trade_logs_status ON trade_logs(status);
`;

async function run() {
    try {
        console.log("🚀 Initializing Database Schema...");
        await pool.query(SCHEMA_SQL);
        console.log("✅ Database schema initialized successfully.");
        
        // Seed DEXes
        console.log("🌱 Seeding DEXes...");
        await pool.query(`
            INSERT INTO dexes (name) 
            VALUES ('Raydium AMM'), ('Raydium CLMM'), ('Pump.fun'), ('Orca'), ('Meteora')
            ON CONFLICT (name) DO NOTHING;
        `);
        console.log("✅ DEXes seeded.");

    } catch (err) {
        console.error("❌ Database initialization failed:", err.message);
        if (err.detail) console.error("Detail:", err.detail);
    } finally {
        await pool.end();
    }
}

run();

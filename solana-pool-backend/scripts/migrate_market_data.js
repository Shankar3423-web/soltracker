'use strict';
require('dotenv').config();

const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
        host: process.env.DATABASE_URL ? undefined : process.env.DB_HOST,
        port: process.env.DATABASE_URL ? undefined : parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DATABASE_URL ? undefined : process.env.DB_NAME,
        user: process.env.DATABASE_URL ? undefined : process.env.DB_USER,
        password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
    });

    try {
        console.log('[Migration] Applying market-data schema updates...');

        await pool.query(`
            ALTER TABLE swaps
            ADD COLUMN IF NOT EXISTS event_index INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS quote_price_usd NUMERIC(30, 12);
        `);

        await pool.query('UPDATE swaps SET event_index = 0 WHERE event_index IS NULL');
        await pool.query('ALTER TABLE swaps ALTER COLUMN event_index SET DEFAULT 0');
        await pool.query('ALTER TABLE swaps ALTER COLUMN event_index SET NOT NULL');

        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'public'
                      AND table_name = 'swaps'
                      AND constraint_name = 'swaps_signature_pool_address_key'
                ) THEN
                    ALTER TABLE swaps DROP CONSTRAINT swaps_signature_pool_address_key;
                END IF;
            END
            $$;
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_swaps_signature_pool_event
            ON swaps (signature, pool_address, event_index);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_swaps_pool_time
            ON swaps (pool_address, block_time DESC);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_swaps_pool_side_time
            ON swaps (pool_address, swap_side, block_time DESC);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_swaps_pool_wallet_time
            ON swaps (pool_address, wallet, block_time DESC);
        `);

        await pool.query(`
            ALTER TABLE pool_stats
            ADD COLUMN IF NOT EXISTS price_native NUMERIC,
            ADD COLUMN IF NOT EXISTS price_usd NUMERIC,
            ADD COLUMN IF NOT EXISTS price_sol NUMERIC,
            ADD COLUMN IF NOT EXISTS liquidity_usd NUMERIC,
            ADD COLUMN IF NOT EXISTS liquidity_base NUMERIC,
            ADD COLUMN IF NOT EXISTS liquidity_quote NUMERIC,
            ADD COLUMN IF NOT EXISTS liquidity_updated_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS price_change_5m NUMERIC,
            ADD COLUMN IF NOT EXISTS price_change_1h NUMERIC,
            ADD COLUMN IF NOT EXISTS price_change_6h NUMERIC,
            ADD COLUMN IF NOT EXISTS price_change_24h NUMERIC,
            ADD COLUMN IF NOT EXISTS volume_5m NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS volume_1h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS volume_6h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tx_count_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tx_count_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tx_count_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buys_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buys_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buys_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buy_volume_5m NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buy_volume_1h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buy_volume_6h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_5m NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_1h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_6h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS makers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS makers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS makers_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buyers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buyers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buyers_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_6h INTEGER DEFAULT 0;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS pool_candles (
                pool_address VARCHAR(255) NOT NULL,
                resolution VARCHAR(8) NOT NULL,
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
                updated_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (pool_address, resolution, time_bucket)
            );
        `);

        await pool.query(`
            ALTER TABLE pool_candles
            ADD COLUMN IF NOT EXISTS first_trade_time TIMESTAMP,
            ADD COLUMN IF NOT EXISTS last_trade_time TIMESTAMP;
        `);

        await pool.query(`
            UPDATE pool_candles
            SET
                first_trade_time = COALESCE(first_trade_time, time_bucket),
                last_trade_time = COALESCE(last_trade_time, time_bucket)
            WHERE first_trade_time IS NULL
               OR last_trade_time IS NULL;
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pool_candles_lookup
            ON pool_candles (pool_address, resolution, time_bucket DESC);
        `);

        await pool.query(`
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
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_webhook_ingest_queue_status_next_attempt
            ON webhook_ingest_queue (status, next_attempt_at, created_at);
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address
            ON users (wallet_address)
            WHERE wallet_address IS NOT NULL;
        `);

        console.log('[Migration] Schema updated successfully.');
    } catch (err) {
        console.error('[Migration] Failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();

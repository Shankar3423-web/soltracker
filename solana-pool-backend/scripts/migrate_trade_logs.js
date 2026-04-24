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
        console.log('[Migration] Updating trade_logs schema...');

        await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

        await pool.query(`
            ALTER TABLE trade_logs
            ADD COLUMN IF NOT EXISTS pool_address TEXT,
            ADD COLUMN IF NOT EXISTS trade_mode TEXT,
            ADD COLUMN IF NOT EXISTS input_symbol TEXT,
            ADD COLUMN IF NOT EXISTS output_symbol TEXT,
            ADD COLUMN IF NOT EXISTS quoted_output NUMERIC,
            ADD COLUMN IF NOT EXISTS minimum_output NUMERIC,
            ADD COLUMN IF NOT EXISTS slippage_bps INTEGER,
            ADD COLUMN IF NOT EXISTS priority_fee_sol NUMERIC,
            ADD COLUMN IF NOT EXISTS price_impact_pct NUMERIC,
            ADD COLUMN IF NOT EXISTS quote_snapshot JSONB,
            ADD COLUMN IF NOT EXISTS actual_input_amount NUMERIC,
            ADD COLUMN IF NOT EXISTS actual_output_amount NUMERIC,
            ADD COLUMN IF NOT EXISTS actual_fee_collected_sol NUMERIC,
            ADD COLUMN IF NOT EXISTS network_fee_sol NUMERIC,
            ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS tx_slot BIGINT,
            ADD COLUMN IF NOT EXISTS settlement_snapshot JSONB,
            ADD COLUMN IF NOT EXISTS error_message TEXT;
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_trade_logs_pool_created_at
            ON trade_logs(pool_address, created_at DESC);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_trade_logs_mode_created_at
            ON trade_logs(trade_mode, created_at DESC);
        `);

        console.log('[Migration] trade_logs schema updated successfully.');
    } catch (error) {
        console.error('[Migration] Failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();

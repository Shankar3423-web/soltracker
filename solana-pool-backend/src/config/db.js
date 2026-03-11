'use strict';
/**
 * db.js
 * PostgreSQL connection pool.
 *
 * Supports two connection modes:
 *   1. DATABASE_URL  — a single connection string (used on Render/cloud)
 *      e.g. postgresql://user:pass@host/dbname
 *   2. Individual vars — DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *      (used for local development)
 *
 * Render's internal DATABASE_URL is preferred when set — it handles
 * host, port, user, password and database all in one string.
 */

const { Pool } = require('pg');

let poolConfig;

if (process.env.DATABASE_URL) {
    // ── Render / cloud: use the single connection string ──────────────────────
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },  // required for Render PostgreSQL
    };
} else {
    // ── Local development: use individual .env vars ───────────────────────────
    poolConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    };
}

const pool = new Pool({
    ...poolConfig,
    keepAlive: true,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    max: 10,
});

// Verify connectivity on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('[DB] Connection failed:', err.message);
    } else {
        console.log('[DB] Connected to PostgreSQL:', process.env.DB_NAME || process.env.DATABASE_URL?.split('/').pop());
        release();
    }
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
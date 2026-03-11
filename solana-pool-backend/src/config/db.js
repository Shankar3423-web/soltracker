'use strict';
/**
 * db.js
 * PostgreSQL connection pool.
 * Reads all credentials from environment variables set in .env
 */

const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Keep connections alive — important for long-running servers
    keepAlive: true,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    max: 10,   // maximum pool size
});

// Verify connectivity on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('[DB] Connection failed:', err.message);
    } else {
        console.log('[DB] Connected to PostgreSQL:', process.env.DB_NAME);
        release();
    }
});

// Surface unexpected pool-level errors instead of crashing silently
pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
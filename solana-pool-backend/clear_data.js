require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("⚠️  TRUNCATING ALL DATA TABLES (KEEPING DEX DEFINITIONS)...");
        
        // This will empty all trading, user, and stat tables.
        const SQL = `
            TRUNCATE 
                swaps, 
                pool_stats, 
                pools, 
                tokens,
                users,
                pool_candles
            RESTART IDENTITY CASCADE;
        `;
        
        await pool.query(SQL);
        console.log("✅ Database cleared perfectly. Tables are now empty.");

    } catch (err) {
        console.error("❌ Clearing failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

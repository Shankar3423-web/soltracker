require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("⚠️  TRUNCATING ALL TRADING DATA TABLES...");
        
        // This will empty the tables but KEEP the structure and DEX definitions
        // CASCADE ensures that child rows are also removed.
        const SQL = `
            TRUNCATE 
                swaps, 
                pool_stats, 
                pool_candles, 
                pools, 
                tokens 
            RESTART IDENTITY CASCADE;
        `;
        
        await pool.query(SQL);
        console.log("✅ Database cleared perfectly. Starting fresh!");

    } catch (err) {
        console.error("❌ Clearing failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

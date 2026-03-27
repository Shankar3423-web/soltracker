require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Adding price_usd and price_sol to swaps table...");
        
        const SQL = `
            ALTER TABLE swaps
            ADD COLUMN IF NOT EXISTS price_usd NUMERIC(30, 12),
            ADD COLUMN IF NOT EXISTS price_sol NUMERIC(30, 12);
        `;
        
        await pool.query(SQL);
        console.log("✅ swaps table updated.");

    } catch (err) {
        console.error("Migration failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

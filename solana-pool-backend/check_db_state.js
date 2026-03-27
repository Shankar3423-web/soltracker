require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("🔍 CHECKING DATABASE STATE...");
        
        const dbTime = await pool.query("SELECT NOW() as db_now, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') as utc_now");
        console.log("DB Time Info:", dbTime.rows[0]);

        const swapCount = await pool.query("SELECT COUNT(*) FROM swaps");
        console.log("Total Swaps in DB:", swapCount.rows[0].count);

        if (swapCount.rows[0].count > 0) {
            const latestSwaps = await pool.query("SELECT signature, pool_address, block_time, usd_value FROM swaps ORDER BY block_time DESC LIMIT 5");
            console.log("Latest 5 Swaps:");
            console.dir(latestSwaps.rows);
        }

        const poolCount = await pool.query("SELECT COUNT(*) FROM pools");
        console.log("Total Pools in DB:", poolCount.rows[0].count);

        const statsCount = await pool.query("SELECT COUNT(*) FROM pool_stats");
        console.log("Total Pool Stats in DB:", statsCount.rows[0].count);

    } catch (err) {
        console.error("❌ Stats check failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

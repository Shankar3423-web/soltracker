require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("🔍 DEBUGGING AGGREGATION SQL...");
        
        const q1 = await pool.query(`
          SELECT 
            COUNT(*) as in_24h 
          FROM swaps 
          WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
        `);
        console.log("Swaps in last 24h (UTC comparison):", q1.rows[0].in_24h);

        const q2 = await pool.query(`
          SELECT 
            COUNT(*) as in_24h 
          FROM swaps 
          WHERE block_time > NOW() - INTERVAL '24 hours'
        `);
        console.log("Swaps in last 24h (NOW comparison):", q2.rows[0].in_24h);

        const q3 = await pool.query(`SELECT pool_address, usd_value, block_time FROM swaps ORDER BY block_time DESC LIMIT 1`);
        console.log("Sample Data Point:", q3.rows[0]);

        const fullAggResult = await pool.query(`
          WITH recent AS (
            SELECT
              pool_address,
              TRIM(LOWER(swap_side)) AS side,
              wallet,
              CAST(usd_value AS NUMERIC)  AS usd_value,
              CAST(price     AS NUMERIC)  AS price,
              block_time
            FROM swaps
            WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
              AND usd_value IS NOT NULL
          )
          SELECT pool_address, SUM(usd_value) as vol FROM recent GROUP BY pool_address
        `);
        console.log("Aggregatable Pools Found:", fullAggResult.rows.length);
        console.dir(fullAggResult.rows);

    } catch (err) {
        console.error("❌ Debug SQL failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

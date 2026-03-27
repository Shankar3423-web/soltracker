require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function debugAggregation() {
    try {
        console.log("Checking swaps with usd_value...");
        const res1 = await pool.query("SELECT COUNT(*) FROM swaps WHERE usd_value IS NOT NULL AND block_time > NOW() - INTERVAL '24 hours'");
        console.log("Swaps in last 24h with usd_value:", res1.rows[0].count);

        console.log("Checking sample swaps for nulls:");
        const res2 = await pool.query("SELECT signature, usd_value, pool_address, block_time FROM swaps ORDER BY block_time DESC LIMIT 5");
        console.dir(res2.rows);

        console.log("Checking DEX association for these pools:");
        const res3 = await pool.query(`
            SELECT p.pool_address, d.name as dex_name
            FROM pools p
            JOIN dexes d ON p.dex_id = d.id
            WHERE p.pool_address IN (SELECT DISTINCT pool_address FROM swaps ORDER BY block_time DESC LIMIT 5)
        `);
        console.dir(res3.rows);

        console.log("Running the core aggregation CTE query...");
        const query = `
          WITH recent AS (
            SELECT
              pool_address,
              TRIM(LOWER(swap_side)) AS side,
              wallet,
              CAST(usd_value AS DOUBLE PRECISION)  AS usd_value,
              CAST(price     AS DOUBLE PRECISION)  AS price,
              block_time
            FROM swaps
            WHERE block_time > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
              AND usd_value IS NOT NULL
          )
          SELECT pool_address, SUM(usd_value) as volume FROM recent GROUP BY pool_address
        `;
        const res4 = await pool.query(query);
        console.log("Aggregated counts:", res4.rows.length);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
debugAggregation();

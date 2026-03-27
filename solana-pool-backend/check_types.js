require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        const res = await pool.query(`
            SELECT 
                signature, 
                usd_value, 
                block_time, 
                pg_typeof(block_time) as type_bt,
                pg_typeof(usd_value) as type_uv
            FROM swaps 
            ORDER BY block_time DESC 
            LIMIT 1
        `);
        console.log("Sample swap data types and values:");
        console.dir(res.rows[0]);
        
        console.log("Checking for ANY swaps with usd_value...");
        const countRes = await pool.query("SELECT COUNT(*) FROM swaps WHERE usd_value IS NOT NULL");
        console.log("Total swaps with usd_value:", countRes.rows[0].count);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();

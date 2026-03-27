require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const res = await pool.query(`
        SELECT d.name, COUNT(*) 
        FROM pool_stats ps
        JOIN pools p ON ps.pool_address = p.pool_address
        JOIN dexes d ON p.dex_id = d.id
        GROUP BY d.name
    `);
    console.log("DEX counts in pool_stats:");
    console.dir(res.rows);
    await pool.end();
}
run();

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const res = await pool.query(`
        SELECT d.name, COUNT(*) 
        FROM pools p 
        JOIN dexes d ON p.dex_id = d.id 
        GROUP BY d.name
    `);
    console.log("Counts:", res.rows);
    
    const stats = await pool.query(`
        SELECT COUNT(*) FROM pool_stats
    `);
    console.log("Total Stats:", stats.rows[0].count);
    
    const top2Pools = await pool.query(`
        SELECT p.pool_address, d.name, (SELECT COUNT(*) FROM swaps WHERE pool_address = p.pool_address) as txs
        FROM pools p
        JOIN dexes d ON p.dex_id = d.id
        LIMIT 10
    `);
    console.log("Top 10 pools in DB:");
    console.dir(top2Pools.rows);

    await pool.end();
}
run();

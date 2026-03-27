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
    console.log("All counts:", res.rows);
    
    const countPS = await pool.query(`
        SELECT COUNT(*) 
        FROM pools p 
        JOIN dexes d ON p.dex_id = d.id 
        WHERE d.name = 'Pump.fun AMM'
    `);
    console.log("Pump.fun AMM pools:", countPS.rows[0].count);

    const countStats = await pool.query(`
        SELECT COUNT(*) 
        FROM pool_stats ps
        JOIN pools p ON p.pool_address = ps.pool_address
        JOIN dexes d ON p.dex_id = d.id
        WHERE d.name = 'Pump.fun AMM'
    `);
    console.log("Pump.fun AMM pool_stats:", countStats.rows[0].count);
    
    // Also check what `getPoolStatsByDex` returns for DEX 1 (assuming Pump.fun AMM is ID 1)
    const dexIdRes = await pool.query(`SELECT id FROM dexes WHERE name = 'Pump.fun AMM'`);
    const dexId = dexIdRes.rows[0].id;
    
    const query = `
      SELECT ps.pool_address
      FROM pool_stats ps
      JOIN pools p ON p.pool_address = ps.pool_address
      WHERE p.dex_id = $1
      ORDER BY ps.volume_24h DESC NULLS LAST
    `;
    const res2 = await pool.query(query, [dexId]);
    console.log("Stats rows returned by API query:", res2.rows.length);

    pool.end();
}
run();

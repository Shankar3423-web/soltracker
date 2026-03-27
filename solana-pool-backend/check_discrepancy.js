require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkDiscrepancy() {
    try {
        // 1. Total pools
        const totalPools = await pool.query('SELECT COUNT(*) FROM pools');
        console.log('Total pools in DB:', totalPools.rows[0].count);

        // 2. Pools per DEX
        const dexCounts = await pool.query(`
            SELECT d.name, COUNT(p.pool_address) as count
            FROM dexes d
            LEFT JOIN pools p ON d.id = p.dex_id
            GROUP BY d.name
        `);
        console.log('Pools per DEX:', dexCounts.rows);

        // 3. Stats check
        const statsCount = await pool.query('SELECT COUNT(*) FROM pool_stats');
        console.log('Total entries in pool_stats:', statsCount.rows[0].count);

        // 4. Missing stats check
        const missingStats = await pool.query(`
            SELECT p.pool_address, d.name as dex_name
            FROM pools p
            JOIN dexes d ON p.dex_id = d.id
            LEFT JOIN pool_stats ps ON p.pool_address = ps.pool_address
            WHERE ps.pool_address IS NULL
        `);
        console.log('Pools missing entries in pool_stats:', missingStats.rows.length);
        if (missingStats.rows.length > 0) {
            console.log('Sample missing stats:', missingStats.rows.slice(0, 5));
        }

        // 5. Check DEX names matching frontend
        const dexNames = await pool.query('SELECT name FROM dexes');
        console.log('Actual DEX names in DB:', dexNames.rows.map(r => r.name));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkDiscrepancy();

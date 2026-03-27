require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("--- TABLE: pool_stats ---");
        const colRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'pool_stats'
            AND table_schema = 'public'
            ORDER BY ordinal_position
        `);
        colRes.rows.forEach(row => {
            console.log(`${row.column_name}`);
        });
        console.log("Total Columns:", colRes.rows.length);

    } catch (err) {
        console.error("Query Error:", err.stack);
    } finally {
        await pool.end();
    }
}
run();

require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    console.log("Starting DB check...");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("Found Tables:", tablesRes.rows.map(r => r.table_name).join(', '));
        
        for (const table of tablesRes.rows.map(r => r.table_name)) {
            console.log(`\n--- TABLE: ${table} ---`);
            const colRes = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                AND table_schema = 'public'
                ORDER BY ordinal_position
            `, [table]);
            colRes.rows.forEach(row => {
                console.log(`${row.column_name}: ${row.data_type}`);
            });
        }
    } catch (err) {
        console.error("Query Error:", err.stack);
    } finally {
        await pool.end();
    }
}
run();

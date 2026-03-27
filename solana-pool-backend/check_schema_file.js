require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

async function run() {
    const config = {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);
    let output = "DB Schema Analysis\n==================\n\n";

    try {
        const tablesRes = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
        for (const tableRow of tablesRes.rows) {
            const table = tableRow.table_name;
            output += `--- TABLE: ${table} ---\n`;
            const colRes = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`, [table]);
            colRes.rows.forEach(row => {
                output += `${row.column_name}: ${row.data_type}\n`;
            });
            output += "\n";
        }
    } catch (err) {
        output += `ERROR: ${err.message}\n`;
    } finally {
        fs.writeFileSync('schema_dump.txt', output);
        await pool.end();
    }
}
run();

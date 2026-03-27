require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const res = await pool.query(`SELECT id, name FROM dexes`);
    console.log("All DEXes in DB:");
    console.dir(res.rows);
    await pool.end();
}
run();

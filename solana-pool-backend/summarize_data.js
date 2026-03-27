require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function summarize() {
    try {
        console.log("--- SYSTEM SUMMARY ---");
        
        const counts = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM pools) as pools,
                (SELECT COUNT(*) FROM swaps) as swaps,
                (SELECT COUNT(*) FROM tokens) as tokens
        `);
        console.log("Total Records:", counts.rows[0]);

        const dexDist = await pool.query(`
            SELECT d.name, COUNT(p.pool_address) as count
            FROM dexes d
            JOIN pools p ON d.id = p.dex_id
            GROUP BY d.name
        `);
        console.log("DEX Distribution:", dexDist.rows);

        const topPools = await pool.query(`
            SELECT p.base_symbol, d.name as dex, COUNT(s.signature) as tx_count
            FROM swaps s
            JOIN pools p ON s.pool_address = p.pool_address
            JOIN dexes d ON p.dex_id = d.id
            GROUP BY p.base_symbol, d.name
            ORDER BY tx_count DESC
            LIMIT 5
        `);
        console.log("Top 5 Active Pools:", topPools.rows);

        const quoteDist = await pool.query(`
            SELECT t.symbol, COUNT(s.signature) as count
            FROM swaps s
            JOIN tokens t ON s.quote_mint = t.mint
            GROUP BY t.symbol
        `);
        console.log("Quote Token Distribution:", quoteDist.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
summarize();

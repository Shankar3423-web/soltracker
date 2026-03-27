require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const config = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    const pool = new Pool(config);

    try {
        console.log("🛠️ RESETTING POOL TABLES...");
        
        await pool.query("DROP TABLE IF EXISTS pool_candles");
        await pool.query("DROP TABLE IF EXISTS pool_stats");
        
        await pool.query(`
            CREATE TABLE pool_stats (
                pool_address VARCHAR(255) PRIMARY KEY,
                price NUMERIC DEFAULT 0,
                liquidity NUMERIC DEFAULT 0,
                fdv NUMERIC DEFAULT 0,
                market_cap NUMERIC DEFAULT 0,
                volume_24h NUMERIC DEFAULT 0,
                tx_count_24h NUMERIC DEFAULT 0,
                buys_24h NUMERIC DEFAULT 0,
                sells_24h NUMERIC DEFAULT 0,
                buy_volume_24h NUMERIC DEFAULT 0,
                sell_volume_24h NUMERIC DEFAULT 0,
                makers_24h NUMERIC DEFAULT 0,
                buyers_24h NUMERIC DEFAULT 0,
                sellers_24h NUMERIC DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        console.log("✅ Tables reset successfully.");
    } catch (err) {
        console.error("❌ Reset failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

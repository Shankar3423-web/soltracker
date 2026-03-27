require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Adding missing timeframe columns to pool_stats...");
        
        // Timeframes to add for various metrics: 5m, 1h, 6h
        const SQL = `
            ALTER TABLE pool_stats
            -- TX Counts
            ADD COLUMN IF NOT EXISTS tx_count_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tx_count_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tx_count_6h INTEGER DEFAULT 0,
            
            -- Buys/Sells
            ADD COLUMN IF NOT EXISTS buys_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buys_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buys_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sells_6h INTEGER DEFAULT 0,
            
            -- Volumes
            ADD COLUMN IF NOT EXISTS buy_volume_5m NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buy_volume_1h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buy_volume_6h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_5m NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_1h NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sell_volume_6h NUMERIC DEFAULT 0,
            
            -- Makers
            ADD COLUMN IF NOT EXISTS makers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS makers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS makers_6h INTEGER DEFAULT 0,
            
            -- Buyers/Sellers
            ADD COLUMN IF NOT EXISTS buyers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buyers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS buyers_6h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_5m INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_1h INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sellers_6h INTEGER DEFAULT 0;
        `;
        
        await pool.query(SQL);
        console.log("✅ pool_stats columns updated.");

        // Optionally add price_sol / price_usd to swaps if needed, 
        // but let's stick to aggregation first as it's more critical for the summary.
        
    } catch (err) {
        console.error("Migration failed:", err.message);
    } finally {
        await pool.end();
    }
}
run();

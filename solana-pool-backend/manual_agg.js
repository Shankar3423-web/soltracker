require('dotenv').config();
const { aggregateAllPools } = require('./src/services/aggregationService');

async function run() {
    console.log("🚀 TRIGGERING MANUAL AGGREGATION...");
    const updated = await aggregateAllPools();
    console.log(`✅ MANUAL COMPLETE: Updated ${updated} pools.`);
    process.exit(0);
}
run();

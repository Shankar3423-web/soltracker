'use strict';
require('dotenv').config();

const db = require('../src/config/db');
const { getTransaction } = require('../src/services/heliusService');
const { decodeSwaps } = require('../src/services/decoderService');
const { persistDecodedSwapEvent } = require('../src/services/marketDataService');

const CONFIRM_ENV = 'REBUILD_CONFIRM';
const REQUIRED_CONFIRM_VALUE = 'YES';

async function rebuild() {
    if (process.env[CONFIRM_ENV] !== REQUIRED_CONFIRM_VALUE) {
        console.error(
            `[Rebuild] Refusing to rebuild market data. Set ${CONFIRM_ENV}=${REQUIRED_CONFIRM_VALUE} and run again.`
        );
        process.exit(1);
    }

    const signatureResult = await db.query(`
        SELECT signature
        FROM (
            SELECT signature, MIN(block_time) AS first_seen
            FROM swaps
            GROUP BY signature
        ) deduped
        ORDER BY first_seen ASC NULLS LAST, signature ASC
    `);

    const signatures = signatureResult.rows.map((row) => row.signature).filter(Boolean);
    console.log(`[Rebuild] Signatures to replay: ${signatures.length}`);

    if (signatures.length === 0) {
        console.log('[Rebuild] No stored signatures found. Nothing to replay.');
        return;
    }

    await db.query('DELETE FROM pool_candles');
    await db.query('DELETE FROM pool_stats');
    await db.query('DELETE FROM swaps');
    console.log('[Rebuild] Cleared swaps, pool_stats, and pool_candles.');

    let processed = 0;
    let inserted = 0;
    let failed = 0;

    for (const signature of signatures) {
        try {
            const tx = await getTransaction(signature);
            const rawKeys = tx.transaction?.message?.accountKeys ?? [];
            const firstKey = rawKeys[0];
            const wallet = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey ?? null);

            const swapEvents = decodeSwaps(tx, signature);
            for (const event of swapEvents) {
                const stored = await persistDecodedSwapEvent(event, wallet, {
                    enrichMetadata: false,
                });
                if (stored.inserted) inserted++;
            }
        } catch (err) {
            failed++;
            console.warn(`[Rebuild] Failed ${signature.slice(0, 20)}...: ${err.message}`);
        }

        processed++;
        if (processed % 25 === 0 || processed === signatures.length) {
            console.log(
                `[Rebuild] Processed ${processed}/${signatures.length} signatures | inserted swaps: ${inserted} | failed: ${failed}`
            );
        }
    }

    console.log('[Rebuild] Done.');
    console.log(JSON.stringify({ processed, inserted, failed }, null, 2));
}

db.query('SELECT NOW()')
    .then(() => rebuild())
    .catch(async (err) => {
        console.error('[Rebuild] Could not connect to database:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await db.end();
        } catch {}
    });

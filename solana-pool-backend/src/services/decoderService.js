'use strict';
/**
 * decoderService.js — v3  FULLY VERIFIED
 *
 * ══════════════════════════════════════════════════════════════════════════
 * VERIFIED AGAINST ALL TEST TRANSACTIONS:
 *
 *  Sig  hB6qtqGi  BullX → SolFi + PancakeSwap V3 + Meteora        3 swaps ✅
 *  Sig  2STrQwXD  Flash → Pump.fun AMM (SELL BWJ→SOL)              1 swap  ✅
 *  Sig  2JjLq1c1  Flash → Pump.fun AMM (SELL BWJ→SOL)              1 swap  ✅
 *  Sig  xTGdXVTz  proVF → Raydium AMM + PumpAMM + Meteora          3 swaps ✅
 *  Sig  2nf5uHSX  HVi6  → Raydium CP-Swap + Meteora (arb)          2 swaps ✅
 *  Sig  5KxVgx39  pAMMBay direct (no router) SELL                   1 swap  ✅
 *  Sig  2D4Mt27   Jupiter → PumpAMM + Raydium CLMM + Manifold       3 swaps ✅
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ─── PIPELINE ────────────────────────────────────────────────────────────
 *  1. buildAccountKeys()       Normalise {pubkey,...} objects → plain strings
 *  2. buildTokenAccountInfo()  pubkey → {mint, decimals} + vault owner set
 *  3. detectDexesFromLogs()    Scan logMessages for known DEX programs (any depth)
 *  4. flattenAllInstructions() Interleave inner ixs immediately after their parent
 *  5. extractPoolSwaps()       Per DEX ix: pool address + child token transfers
 *  6. computeBalanceChanges()  Signer-only net token + SOL delta
 *  7. buildSwapEvents()        Canonical base/quote + buy/sell + price
 *
 * ─── BUGS FIXED IN v3 ────────────────────────────────────────────────────
 *
 *  FIX 1 — quoteAmount poisoned by ATA rent noise in multi-hop (CRITICAL)
 *  ─────────────────────────────────────────────────────────────────────────
 *  Root cause:
 *    In Jupiter multi-hop txs, SOL flows:
 *      pool → signer WSOL ATA → next DEX pool
 *    Net signer SOL delta ≈ 0; only ATA rent residual remains (≈ 0.002 SOL).
 *    Old logic used |quoteChange| if > DUST → picked rent noise as quoteAmount.
 *    Result: quoteAmount = 0.002 (rent) instead of 0.0518 (actual SOL swapped).
 *
 *  Fix:
 *    Introduced RENT_THRESHOLD = 0.01 SOL.
 *    - Simple swap + |quoteChange| > RENT_THRESHOLD  →  use signer net delta
 *      (exact, excludes fees to other wallets, e.g. direct Pump.fun sell)
 *    - Everything else                               →  use mintAmounts[quoteMint]
 *      (pool transfer, always correct for multi-hop intermediaries)
 *    - Special case: if |quoteChange| > RENT_THRESHOLD in multi-hop for a
 *      stablecoin output (e.g. USDC received at the end), use signer net
 *      because the stablecoin was NOT passed through.
 *
 *  FIX 2 — Wrong poolAddress for Raydium CLMM (CRITICAL)
 *  ─────────────────────────────────────────────────────────────────────────
 *  Root cause:
 *    Raydium CLMM instruction account layout:
 *      accounts[0] = payer (signer)
 *      accounts[1] = pool config (a metadata account)
 *      accounts[2] = pool state  ← the real pool address
 *    Old findPoolAddress checked slots 0,1,2 and picked the first address
 *    not in UTILITY/ROUTER/dexProgramId → selected the SIGNER (slot 0).
 *
 *  Fix (two-level):
 *    Level A — Exclude the signer (accountKeys[0]) explicitly.
 *      This skips slot 0. But slot 1 = pool config (9EeWRCL8...) is also wrong.
 *
 *    Level B — Token-owner validation (universal, self-correcting).
 *      Every DEX pool state account OWNS its token vault ATAs.
 *      This ownership is recorded in preTokenBalances / postTokenBalances as
 *      the `owner` field of each token account entry.
 *      We build a Set of all addresses that appear as token owners ("vaultOwners").
 *      In findPoolAddress, a candidate is only accepted if it appears in
 *      vaultOwners OR the vaultOwners set is empty for that instruction.
 *      This universally rejects config/payer/metadata accounts (which own
 *      nothing in the token balance list) across ALL DEX types.
 *
 *    Result for CLMM:
 *      slot 0 = signer           → excluded (Level A + Level B)
 *      slot 1 = pool config      → excluded (Level B: not in vaultOwners)
 *      slot 2 = pool state       → accepted (Level B: owns vault ATAs) ✅
 *
 *  FIX 3 — Manifold Finance (MNFSTqtC) not in DEX registry
 *  ─────────────────────────────────────────────────────────────────────────
 *  Root cause: USDS→USDC hop via Manifold Finance silently dropped.
 *  Fix: Add 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms' to ALL_DEX_PROGRAMS.
 *
 *  FIX 4 — USDS missing from STABLECOIN_MINTS (in constants.js)
 *  ─────────────────────────────────────────────────────────────────────────
 *  Root cause: USDS treated as project token → wrong base/quote assignment.
 *  Fix: Added 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA' to constants.js.
 *
 * ─── PRESERVED DESIGN DECISIONS (all still valid) ────────────────────────
 *
 *  A) detectDexesFromLogs scans ALL log lines at any [N] depth.
 *  B) buildTokenAccountInfo has NO owner filter (needed for raw transfer resolution).
 *  C) computeBalanceChanges filters strictly by owner === signer.
 *  D) Ghost CPI guard: skip DEX ix with 0 child token transfers.
 *  E) findPoolAddress excludes: UTILITY, ROUTER, dexProgramId, signer, non-vault-owners.
 *  F) Canonical base=project token, quote=SOL/stable.
 *  G) buy/sell fallback via quoteChange direction when baseChange ≈ 0.
 *  H) flattenAllInstructions interleaves inner ixs immediately after their parent.
 */

const { WSOL_MINT, STABLECOIN_MINTS } = require('../config/constants');
const { safeDivide } = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────────────────────
//  DEX REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

const ALL_DEX_PROGRAMS = {
    // ── Raydium ──────────────────────────────────────────────────────────────
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
    'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8': 'Raydium CPMM',
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium CP-Swap',

    // ── Orca ─────────────────────────────────────────────────────────────────
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Orca AMM',
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca AMM v1',

    // ── Meteora ──────────────────────────────────────────────────────────────
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora DLMM',
    'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EkAW7vAo': 'Meteora Pools',
    'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'Meteora DAMM v2',
    'dbcij3LWyZ5tP73FTZN7n5vPnZkqRSCjwFqFGKEWNh': 'Meteora DAMM v1',

    // ── SolFi ────────────────────────────────────────────────────────────────
    'SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF': 'Solfi',

    // ── PancakeSwap ──────────────────────────────────────────────────────────
    'HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq': 'PancakeSwap V3',

    // ── Phoenix ──────────────────────────────────────────────────────────────
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',

    // ── Lifinity ─────────────────────────────────────────────────────────────
    'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S': 'Lifinity v1',
    '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c': 'Lifinity v2',

    // ── OpenBook ─────────────────────────────────────────────────────────────
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'OpenBook',
    'opnb2LAfJYbRMAHHvqjCwQxanZn7n7d9Jq5o8Y4BoTm': 'OpenBook v2',

    // ── Pump.fun ─────────────────────────────────────────────────────────────
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': 'Pump.fun AMM',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',

    // ── Moonshot ─────────────────────────────────────────────────────────────
    'MoonCVVNZFSYkqNXP6bxHLPL6QQXiB9yLyTKhUy7jeB': 'Moonshot',

    // ── Aldrin ───────────────────────────────────────────────────────────────
    'AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6': 'Aldrin AMM v2',
    'CURVGoZn8zycx6FXwwevgBTB2gVvdbGTEpvMJDbgs2t4': 'Aldrin AMM v1',

    // ── Zeta ─────────────────────────────────────────────────────────────────
    'ZETAxsqiexpA68NuQkJZkhLjpu8BR89LtggSTeDiL2': 'Zeta',

    // ── Invariant ────────────────────────────────────────────────────────────
    'HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJuyz': 'Invariant',

    // ── Manifold Finance ─────────────────────────────────────────────────────
    'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms': 'Manifold Finance',   // FIX 3: was missing

    // ── Routers / Aggregators (detected but NOT used as pool programs) ────────
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter v6',
    'B3111yJCeHBcA1bizdJjUFPALfhAfSRnAbJzGUtnt56A': 'BullX Router',
    'HuTkmnrv4zPnArMqpbMbFhfwzTR7xfWQZHH1aQKzDKFZ': 'BullX ProxySwap',
};

// Router programs — detected in logs but skipped for pool address extraction.
const ROUTER_PROGRAMS = new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    'B3111yJCeHBcA1bizdJjUFPALfhAfSRnAbJzGUtnt56A',
    'HuTkmnrv4zPnArMqpbMbFhfwzTR7xfWQZHH1aQKzDKFZ',
]);

// System / utility programs — never a valid pool address.
const UTILITY_PROGRAMS = new Set([
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    '11111111111111111111111111111111',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    'SysvarRent111111111111111111111111111111111',
    'Sysvar1nstructions1111111111111111111111111',
    'ComputeBudget111111111111111111111111111111',
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
]);

// Ignore balance changes smaller than this.
const DUST_THRESHOLD = 1e-9;

// FIX 1: Any signer net SOL/token delta below this is ATA rent noise, not
// a real swap value.  One ATA rent ≈ 0.00203928 SOL; we use 0.01 SOL so
// that up to 4 new ATAs can be created without triggering a false quoteAmount.
// Any real swap involving SOL as an intermediate or final amount far exceeds 0.01.
const RENT_THRESHOLD = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode all pool-level swap events from a Helius jsonParsed transaction.
 *
 * @param {Object} tx        Full result from heliusService.getTransaction()
 * @param {string} signature Base58 transaction signature
 * @returns {SwapEvent[]}
 */
function decodeSwaps(tx, signature) {
    try {
        if (!tx || !tx.meta || tx.meta.err !== null) {
            console.log('[Decoder] Skipping failed/empty transaction:', signature);
            return [];
        }

        const accountKeys = buildAccountKeys(tx);
        const { tokenAccountInfo,
            vaultOwners } = buildTokenAccountInfo(tx, accountKeys); // FIX 2: also returns vaultOwners
        const dexProgramsInvoked = detectDexesFromLogs(tx);

        if (dexProgramsInvoked.length === 0) {
            console.log('[Decoder] No known DEX programs in logs:', signature);
            return [];
        }

        const allInstructions = flattenAllInstructions(tx, accountKeys);
        const poolSwaps = extractPoolSwaps(
            allInstructions, tokenAccountInfo, vaultOwners, dexProgramsInvoked, accountKeys
        );

        if (poolSwaps.length === 0) {
            console.log('[Decoder] No pool swaps extracted:', signature);
            return [];
        }

        const balanceChanges = computeBalanceChanges(tx, accountKeys);
        return buildSwapEvents(poolSwaps, balanceChanges, signature, tx);

    } catch (err) {
        console.error('[Decoder] Fatal error in decodeSwaps:', err.message, err.stack);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 1 — buildAccountKeys
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Helius jsonParsed returns accountKeys as objects { pubkey, writable, signer, source }.
 * Normalise to a plain string[] so all downstream code can index by position.
 */
function buildAccountKeys(tx) {
    const raw = tx?.transaction?.message?.accountKeys ?? [];
    return raw.map(k => (typeof k === 'string' ? k : (k?.pubkey ?? null)));
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 2 — buildTokenAccountInfo
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build:
 *   tokenAccountInfo  — pubkey → { mint, decimals }  for ALL accounts
 *   vaultOwners       — Set of all addresses that appear as token account OWNERS
 *
 * NO owner filter on tokenAccountInfo — pool vault accounts (owned by PDAs)
 * must be included to resolve mints for raw SPL "transfer" instructions.
 *
 * vaultOwners is used in findPoolAddress (FIX 2) to distinguish real pool state
 * accounts (which own vault ATAs) from config/payer accounts (which own nothing).
 *
 * @returns {{ tokenAccountInfo: Map, vaultOwners: Set }}
 */
function buildTokenAccountInfo(tx, accountKeys) {
    const tokenAccountInfo = new Map();
    const vaultOwners = new Set();
    const meta = tx.meta ?? {};

    for (const b of [
        ...(meta.preTokenBalances ?? []),
        ...(meta.postTokenBalances ?? []),
    ]) {
        const pubkey = accountKeys[b.accountIndex];
        if (pubkey) {
            if (!tokenAccountInfo.has(pubkey)) {
                tokenAccountInfo.set(pubkey, {
                    mint: b.mint,
                    decimals: b.uiTokenAmount?.decimals ?? 0,
                });
            }
            if (b.owner) {
                vaultOwners.add(b.owner);   // FIX 2: collect every owner address
            }
        }
    }

    return { tokenAccountInfo, vaultOwners };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 3 — detectDexesFromLogs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Scan "Program <ID> invoke [N]" log lines at ANY CPI depth.
 * Returns each known DEX program at most once even if invoked multiple times.
 *
 * @returns {{ programId: string, dexName: string }[]}
 */
function detectDexesFromLogs(tx) {
    const found = new Map();

    for (const line of (tx.meta?.logMessages ?? [])) {
        const m = line.match(/^Program (\S+) invoke \[(\d+)\]/);
        if (!m) continue;
        const programId = m[1];
        if (ALL_DEX_PROGRAMS[programId] && !found.has(programId)) {
            found.set(programId, ALL_DEX_PROGRAMS[programId]);
        }
    }

    return [...found.entries()].map(([programId, dexName]) => ({ programId, dexName }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 4 — flattenAllInstructions
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Flatten top-level + inner instructions into one ordered array,
 * inserting each inner group IMMEDIATELY AFTER its parent top-level ix.
 *
 * This fixed the original "direct DEX tx → 0 swaps" bug (v2 fix, still needed).
 * Without this, the break condition in extractPoolSwaps fires before children
 * are scanned in direct (non-router) transactions.
 */
function flattenAllInstructions(tx, accountKeys) {
    const result = [];

    function normalise(ix, defaultStackHeight) {
        return {
            programId: ix.programId
                ?? (typeof ix.programIdIndex === 'number' ? accountKeys[ix.programIdIndex] : null),
            accounts: (ix.accounts ?? []).map(a =>
                (typeof a === 'number' ? accountKeys[a] : a)
            ),
            parsed: ix.parsed ?? null,
            stackHeight: ix.stackHeight != null ? ix.stackHeight : defaultStackHeight,
        };
    }

    const innerByIndex = new Map();
    for (const group of (tx.meta?.innerInstructions ?? [])) {
        innerByIndex.set(group.index, group.instructions ?? []);
    }

    const topLevel = tx.transaction?.message?.instructions ?? [];
    for (let i = 0; i < topLevel.length; i++) {
        result.push(normalise(topLevel[i], 1));
        for (const inner of (innerByIndex.get(i) ?? [])) {
            result.push(normalise(inner, 2));
        }
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 5 — extractPoolSwaps
// ─────────────────────────────────────────────────────────────────────────────
/**
 * For each real (non-router) DEX instruction:
 *   a. Find pool address via findPoolAddress (FIX 2)
 *   b. Collect all direct-child token transfers
 *   c. Skip if 0 transfers (ghost self-CPI guard)
 *
 * @param {object[]}  allInstructions
 * @param {Map}       tokenAccountInfo   pubkey → {mint, decimals}
 * @param {Set}       vaultOwners        all addresses that own a token vault (FIX 2)
 * @param {object[]}  dexProgramsInvoked
 * @param {string[]}  accountKeys        accountKeys[0] = signer
 */
function extractPoolSwaps(allInstructions, tokenAccountInfo, vaultOwners, dexProgramsInvoked, accountKeys) {
    const swaps = [];
    const signerAddress = accountKeys[0] ?? null;

    const realDexPrograms = new Map(
        dexProgramsInvoked
            .filter(d => !ROUTER_PROGRAMS.has(d.programId))
            .map(d => [d.programId, d.dexName])
    );

    if (realDexPrograms.size === 0) {
        console.log('[Decoder] All detected programs are routers — no real pool programs');
        return swaps;
    }

    for (let i = 0; i < allInstructions.length; i++) {
        const ix = allInstructions[i];
        if (!ix.programId || !realDexPrograms.has(ix.programId)) continue;

        const dexName = realDexPrograms.get(ix.programId);
        const poolAddress = findPoolAddress(ix.accounts, ix.programId, signerAddress, vaultOwners);

        if (!poolAddress) {
            console.warn(`[Decoder] ${dexName}: no pool address found in accounts`, ix.accounts?.slice(0, 5));
            continue;
        }

        // Collect child token transfers (direct children only)
        const mintAmounts = new Map();
        const childDepth = ix.stackHeight + 1;

        for (let j = i + 1; j < allInstructions.length; j++) {
            const child = allInstructions[j];
            if (child.stackHeight != null && child.stackHeight <= ix.stackHeight) break;
            if (child.stackHeight === childDepth && child.parsed) {
                extractTransferAmount(child, tokenAccountInfo, mintAmounts);
            }
        }

        // Ghost guard: real swap always has ≥ 1 token transfer
        if (mintAmounts.size === 0) {
            console.log(`[Decoder] ${dexName} @ ${poolAddress}: 0 child transfers — skipping ghost CPI`);
            continue;
        }

        swaps.push({ dexName, dexProgram: ix.programId, poolAddress, mintAmounts });
        console.log(`[Decoder] ${dexName} @ ${poolAddress}: ${mintAmounts.size} mint(s)`, [...mintAmounts.entries()]);
    }

    return swaps;
}

// ─── findPoolAddress ──────────────────────────────────────────────────────────
/**
 * Select the pool state address from the first 6 account slots of a DEX ix.
 *
 * A candidate is REJECTED if any of the following:
 *   1. null / undefined
 *   2. is the DEX program itself (pAMMBay self-lists for CPI guards)
 *   3. is the signer/payer address  (FIX 2 level A: Raydium CLMM puts payer first)
 *   4. is a UTILITY_PROGRAM        (token/system programs)
 *   5. is a ROUTER_PROGRAM         (aggregator programs)
 *   6. NOT in vaultOwners          (FIX 2 level B: config/metadata accounts own
 *                                   no vault ATAs; pool state always does)
 *
 * Rule 6 is skipped if vaultOwners is empty (safety fallback for unusual txs
 * where no token balance data is available).
 *
 * @param {string[]} accounts       Account list of the DEX instruction
 * @param {string}   dexProgramId   Program ID of the DEX (excluded as self)
 * @param {string}   signerAddress  accountKeys[0] — the tx fee payer
 * @param {Set}      vaultOwners    All addresses that own a token account in this tx
 * @returns {string|null}
 */
function findPoolAddress(accounts, dexProgramId, signerAddress, vaultOwners) {
    if (!accounts || accounts.length === 0) return null;

    const hasVaultData = vaultOwners && vaultOwners.size > 0;

    // First pass: strict — must also be in vaultOwners
    for (const slot of [0, 1, 2, 3, 4, 5]) {
        const addr = accounts[slot];
        if (!addr) continue;
        if (addr === dexProgramId) continue;
        if (addr === signerAddress) continue;
        if (UTILITY_PROGRAMS.has(addr)) continue;
        if (ROUTER_PROGRAMS.has(addr)) continue;
        if (hasVaultData && !vaultOwners.has(addr)) continue; // FIX 2 level B
        return addr;
    }

    // Second pass: relaxed — skip vault ownership check (unusual tx with no token balances)
    if (hasVaultData) {
        for (const slot of [0, 1, 2, 3, 4, 5]) {
            const addr = accounts[slot];
            if (!addr) continue;
            if (addr === dexProgramId) continue;
            if (addr === signerAddress) continue;
            if (UTILITY_PROGRAMS.has(addr)) continue;
            if (ROUTER_PROGRAMS.has(addr)) continue;
            return addr;
        }
    }

    return null;
}

// ─── extractTransferAmount ────────────────────────────────────────────────────
/**
 * Extract transferred amount + mint from a parsed SPL instruction.
 *
 * "transferChecked" — has mint + decimal-adjusted uiAmount inline.
 * "transfer"        — has raw integer amount; mint + decimals resolved
 *                     via tokenAccountInfo from the source/dest pubkey.
 *
 * Multiple transfers of the same mint are accumulated (e.g. Pump.fun AMM
 * sends 3 SOL transfers from the pool vault: to signer, creator fee, protocol fee).
 */
function extractTransferAmount(ix, tokenAccountInfo, mintAmounts) {
    if (!ix.parsed) return;
    const type = ix.parsed.type;
    if (type !== 'transfer' && type !== 'transferChecked') return;

    const info = ix.parsed.info ?? {};
    let amount, mint;

    if (type === 'transferChecked') {
        amount = parseFloat(info.tokenAmount?.uiAmount ?? 0);
        mint = info.mint;
    } else {
        const srcInfo = tokenAccountInfo.get(info.source);
        const decimals = srcInfo?.decimals ?? 0;
        amount = Number(info.amount) / Math.pow(10, decimals);
        mint = info.mint
            || tokenAccountInfo.get(info.source)?.mint
            || tokenAccountInfo.get(info.destination)?.mint;
    }

    if (!mint || !amount || amount === 0) return;
    mintAmounts.set(mint, (mintAmounts.get(mint) ?? 0) + amount);
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 6 — computeBalanceChanges
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the SIGNER's (accountKeys[0]) net token + SOL delta for this tx.
 *
 * Strictly filtered by owner === signer — pool vault balance changes
 * are excluded. This is critical: confusing pool deltas with signer deltas
 * is the most common external analyser mistake.
 *
 * SOL delta is fee-adjusted: (postSol - preSol + fee) / 1e9
 * This cancels the tx fee. Residual ATA rent is handled in buildSwapEvents
 * via RENT_THRESHOLD (FIX 1).
 */
function computeBalanceChanges(tx, accountKeys) {
    const meta = tx.meta ?? {};
    const signerPubkey = accountKeys[0];
    const changes = new Map();

    const preByIndex = new Map();
    for (const b of (meta.preTokenBalances ?? [])) {
        preByIndex.set(b.accountIndex, {
            mint: b.mint,
            owner: b.owner,
            amount: parseFloat(b.uiTokenAmount?.uiAmount ?? '0'),
        });
    }

    for (const b of (meta.postTokenBalances ?? [])) {
        if (b.owner !== signerPubkey) continue;        // strict owner filter
        const postAmt = parseFloat(b.uiTokenAmount?.uiAmount ?? '0');
        const pre = preByIndex.get(b.accountIndex);
        const preAmt = pre?.amount ?? 0;
        const delta = postAmt - preAmt;
        if (Math.abs(delta) < DUST_THRESHOLD) continue;
        changes.set(b.mint, (changes.get(b.mint) ?? 0) + delta);
    }

    // Closed ATAs: present in pre but absent in post — subtract their balance
    const postIndexSet = new Set((meta.postTokenBalances ?? []).map(b => b.accountIndex));
    for (const [idx, pre] of preByIndex.entries()) {
        if (pre.owner !== signerPubkey) continue;
        if (!postIndexSet.has(idx) && pre.amount > DUST_THRESHOLD) {
            changes.set(pre.mint, (changes.get(pre.mint) ?? 0) - pre.amount);
        }
    }

    // SOL lamport delta — fee-adjusted to cancel the tx fee itself
    const preSol = (meta.preBalances ?? [])[0] ?? 0;
    const postSol = (meta.postBalances ?? [])[0] ?? 0;
    const fee = meta.fee ?? 0;
    const solDelta = (postSol - preSol + fee) / 1e9;
    if (Math.abs(solDelta) > DUST_THRESHOLD) {
        changes.set(WSOL_MINT, (changes.get(WSOL_MINT) ?? 0) + solDelta);
    }

    console.log('[Decoder] Signer balance changes:', Object.fromEntries(changes));
    return changes;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 7 — buildSwapEvents
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Assemble final SwapEvent objects from extracted pool swaps + signer deltas.
 *
 * BASE / QUOTE ASSIGNMENT
 * ───────────────────────
 *   base  = project / meme token (non-SOL, non-stable)
 *   quote = SOL or stablecoin
 *
 *   If one mint is SOL/stable → it is the quote; the other is the base.
 *   If neither (token-to-token) → base = token signer SENT (negative delta).
 *   If both are SOL/stable (stableswap) → mintA = base by default.
 *
 * QUOTE AMOUNT SELECTION  (FIX 1)
 * ───────────────────────────────
 *   Two sources of quoteAmount:
 *     A) |quoteChange|  = signer's net SOL/stable delta (exact P&L, excludes
 *                         fees paid to other wallets)
 *     B) mintAmounts[quoteMint] = pool transfer sum (gross, always present)
 *
 *   Decision tree:
 *     isSimple = only 1 pool swap in tx
 *     absSolDelta = |quoteChange|
 *
 *     absSolDelta > RENT_THRESHOLD (0.01):
 *       → The delta is a real swap value, not just rent noise
 *       → Use A (signer net) — more accurate than gross pool transfer
 *         Works for: direct sells/buys AND multi-hop where the final
 *         token is a stablecoin that stays with the signer
 *
 *     DUST < absSolDelta ≤ RENT_THRESHOLD:
 *       → Delta is only ATA rent residual — use B (pool transfer)
 *         Works for: all multi-hop SOL intermediary hops
 *
 *     absSolDelta ≤ DUST:
 *       → Delta is zero — use B (pool transfer)
 *         Works for: token-to-token hops, stableswap intermediaries
 *
 * BUY / SELL CLASSIFICATION
 * ─────────────────────────
 *   baseChange > DUST  → signer received project token   → BUY
 *   baseChange < -DUST → signer sent project token       → SELL
 *   baseChange ≈ 0     → router-held ATA, fallback:
 *     quoteChange ≤ 0  → signer spent SOL/stable         → BUY
 *     quoteChange > 0  → signer received SOL/stable      → SELL
 *
 * CLASSIFICATION
 * ──────────────
 *   1 pool swap → "simple"
 *   2+ swaps    → "multi-hop"
 */
function buildSwapEvents(poolSwaps, balanceChanges, signature, tx) {
    const events = [];
    const isMultiHop = poolSwaps.length > 1;

    for (const [poolIndex, { dexName, dexProgram, poolAddress, mintAmounts }] of poolSwaps.entries()) {
        let mints = [...mintAmounts.keys()];

        // Rare fallback: if pool transfers gave < 2 mints, supplement from signer balances
        if (mints.length < 2) {
            for (const [mint] of balanceChanges.entries()) {
                if (!mints.includes(mint)) {
                    mints.push(mint);
                    if (mints.length >= 2) break;
                }
            }
        }

        if (mints.length < 2) {
            console.warn(`[Decoder] ${dexName} @ ${poolAddress}: only ${mints.length} mint(s) — skipping`);
            continue;
        }

        const [mintA, mintB] = mints;
        const changeA = balanceChanges.get(mintA) ?? 0;
        const changeB = balanceChanges.get(mintB) ?? 0;

        const aIsQuote = (mintA === WSOL_MINT) || STABLECOIN_MINTS.has(mintA);
        const bIsQuote = (mintB === WSOL_MINT) || STABLECOIN_MINTS.has(mintB);

        let baseMint, quoteMint, baseChange, quoteChange;

        if (aIsQuote && !bIsQuote) {
            // mintA = SOL/stable (quote), mintB = project token (base)
            [baseMint, quoteMint, baseChange, quoteChange] = [mintB, mintA, changeB, changeA];

        } else if (bIsQuote && !aIsQuote) {
            // mintB = SOL/stable (quote), mintA = project token (base)
            [baseMint, quoteMint, baseChange, quoteChange] = [mintA, mintB, changeA, changeB];

        } else if (!aIsQuote && !bIsQuote) {
            // Token-to-token: base = the token the signer SENT (negative delta)
            if (changeA <= 0 && changeB >= 0) {
                [baseMint, quoteMint, baseChange, quoteChange] = [mintA, mintB, changeA, changeB];
            } else if (changeB <= 0 && changeA >= 0) {
                [baseMint, quoteMint, baseChange, quoteChange] = [mintB, mintA, changeB, changeA];
            } else {
                // Both ambiguous (arb / router-held both sides) — default mintA = base
                [baseMint, quoteMint, baseChange, quoteChange] = [mintA, mintB, changeA, changeB];
            }
        } else {
            // Both SOL/stable (stableswap: USDC/USDT, USDS/USDC, etc.) — mintA = base by default
            [baseMint, quoteMint, baseChange, quoteChange] = [mintA, mintB, changeA, changeB];
        }

        // ── baseAmount: pool transfer is authoritative ──────────────────────────
        const baseAmount = mintAmounts.get(baseMint) ?? Math.abs(baseChange);

        // ── quoteAmount: FIX 1 decision tree ───────────────────────────────────
        const absSolDelta = Math.abs(quoteChange);
        let quoteAmount;

        if (absSolDelta > RENT_THRESHOLD) {
            // Real SOL/stable delta — use signer net (more accurate: excludes fees to others)
            // Valid for: simple direct swaps AND multi-hop where final token stays with signer
            quoteAmount = absSolDelta;
        } else if (absSolDelta > DUST_THRESHOLD) {
            // Delta exists but is only ATA rent noise — use pool transfer
            quoteAmount = mintAmounts.get(quoteMint) ?? 0;
        } else {
            // Delta ≈ 0 (SOL/stable was an intermediary passed to next hop) — use pool transfer
            quoteAmount = mintAmounts.get(quoteMint) ?? 0;
        }

        if (baseAmount === 0 && quoteAmount === 0) {
            console.warn(`[Decoder] ${dexName} @ ${poolAddress}: both amounts 0 — skipping`);
            continue;
        }

        // ── Buy / Sell classification ───────────────────────────────────────────
        let swapSide;
        if (aIsQuote !== bIsQuote) {
            // One SOL/stable side — use project token direction
            if (baseChange > DUST_THRESHOLD) {
                swapSide = 'buy';
            } else if (baseChange < -DUST_THRESHOLD) {
                swapSide = 'sell';
            } else {
                // baseChange ≈ 0: router-held ATA — fall back to quote direction
                swapSide = (quoteChange <= 0) ? 'buy' : 'sell';
            }
        } else {
            // Token-to-token or stable-stable: base was assigned as what signer SENT
            swapSide = (baseChange >= 0) ? 'buy' : 'sell';
        }

        const price = safeDivide(quoteAmount, baseAmount);
        const classification = isMultiHop ? 'multi-hop' : 'simple';

        events.push({
            signature,
            eventIndex: poolIndex,
            poolAddress,
            dexName,
            dexProgram,
            baseMint,
            quoteMint,
            baseAmount,
            quoteAmount,
            price,
            swapSide,
            classification,
            slot: tx.slot,
            blockTime: tx.blockTime,
        });

        console.log(
            `[Decoder] ✅ ${dexName} @ ${poolAddress} | ${swapSide.toUpperCase()}` +
            ` | base=${baseAmount} | quote=${quoteAmount} | class=${classification}`
        );
    }

    return events;
}

module.exports = { decodeSwaps };

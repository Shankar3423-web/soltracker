'use strict';
/**
 * heliusService.js
 * Fetches raw transaction data from the Helius RPC endpoint.
 *
 * Uses jsonParsed encoding so SPL token transfers are returned with
 * human-readable amounts and mint addresses already resolved.
 * Also requests maxSupportedTransactionVersion:0 to handle versioned
 * (v0) transactions that use address lookup tables (ALTs).
 */

const axios = require('axios');

/**
 * Fetch a confirmed Solana transaction by signature.
 *
 * @param {string} signature - Base58 transaction signature
 * @returns {Promise<Object>} Full Helius transaction result object
 * @throws {Error} On RPC error, HTTP error, or transaction not found
 */
async function getTransaction(signature) {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) {
        throw new Error('HELIUS_RPC_URL is not set in environment variables');
    }

    const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
            signature,
            {
                encoding: 'jsonParsed',
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            },
        ],
    };

    let response;
    try {
        response = await axios.post(rpcUrl, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000,
            proxy: false,
        });
    } catch (err) {
        if (err.response) {
            throw new Error(
                `Helius HTTP ${err.response.status}: ${err.response.statusText}`
            );
        }
        throw new Error(`Helius network error: ${err.message}`);
    }

    if (response.data.error) {
        throw new Error(`Helius RPC error: ${JSON.stringify(response.data.error)}`);
    }

    const tx = response.data.result;
    if (!tx) {
        throw new Error(
            `Transaction not found or not yet confirmed: ${signature}`
        );
    }

    return tx;
}

module.exports = { getTransaction };

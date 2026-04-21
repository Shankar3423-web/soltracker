'use strict';
const express = require('express');
const router = express.Router();
const admin = require('../config/firebaseAdmin');
const pool = require('../config/db');

/**
 * POST /auth/google
 * Receives a Firebase ID token from the frontend,
 * verifies it with Firebase Admin, then upserts the user in PostgreSQL.
 */
router.post('/google', async (req, res) => {
    let decoded;

    // 1. Verify Firebase Token First
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Missing token' });
        }

        // Verify the Firebase ID token
        decoded = await admin.auth().verifyIdToken(token);
    } catch (err) {
        console.error('[AuthRoute] Firebase Token Error:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // 2. Upsert into PostgreSQL
    try {
        const { uid, email, name, picture } = decoded;

        // Upsert user into PostgreSQL with refreshed data
        await pool.query(
            `INSERT INTO users (firebase_uid, email, name, picture, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (firebase_uid) 
             DO UPDATE SET 
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                picture = EXCLUDED.picture,
                updated_at = NOW()`,
            [uid, email, name, picture]
        );

        return res.json({ success: true, uid, email, name });
    } catch (err) {
        console.error('[AuthRoute] Database Insertion Error:', err.message);
        return res.status(500).json({ error: 'Failed to save user to database' });
    }
});

/**
 * POST /auth/wallet
 * Receives a wallet address from the frontend and upserts the user in auth_nonces.
 * Returns a synthetic UID: wallet:<address>
 */
router.post('/wallet', async (req, res) => {
    try {
        const { wallet_address } = req.body;

        if (!wallet_address) {
            return res.status(400).json({ error: 'Missing wallet address' });
        }

        // Generate a synthetic UID
        const syntheticUid = `wallet:${wallet_address.toLowerCase()}`;

        // Upsert into auth_nonces (Lightweight store for wallet users)
        // We generate a simple nonce for now (e.g., date + address hash)
        const nonce = Buffer.from(`${Date.now()}:${wallet_address}`).toString('base64');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 1 week

        await pool.query(
            `INSERT INTO auth_nonces (wallet_address, nonce, expires_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (wallet_address) 
             DO UPDATE SET 
                nonce = EXCLUDED.nonce,
                expires_at = EXCLUDED.expires_at`,
            [wallet_address, nonce, expiresAt]
        );

        console.log(`[AuthRoute] Wallet synced: ${wallet_address} -> ${syntheticUid}`);
        return res.json({ 
            success: true, 
            uid: syntheticUid,
            walletAddress: wallet_address 
        });
    } catch (err) {
        console.error('[AuthRoute] Wallet Auth Error:', err.message);
        return res.status(500).json({ error: 'Failed', details: err.message });
    }
});

/**
 * PUT /auth/wallet/username
 * Updates the custom display name for a wallet user.
 */
router.put('/wallet/username', async (req, res) => {
    try {
        const { wallet_address, username } = req.body;

        if (!wallet_address || !username) {
            return res.status(400).json({ error: 'Missing address or username' });
        }

        await pool.query(
            `UPDATE auth_nonces SET username = $1 WHERE wallet_address = $2`,
            [username, wallet_address]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[AuthRoute] Username Update Error:', err.message);
        return res.status(500).json({ error: 'Failed to update username' });
    }
});

/**
 * GET /auth/wallet/:address
 * Fetches the user data (like username) for a specific wallet.
 */
router.get('/wallet/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const result = await pool.query(
            'SELECT wallet_address, username, created_at FROM auth_nonces WHERE wallet_address = $1',
            [address]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error('[AuthRoute] GET wallet error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch user' });
    }
});

module.exports = router;

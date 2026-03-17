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

        // Upsert user into PostgreSQL (ignore if already exists)
        await pool.query(
            `INSERT INTO users (firebase_uid, email, name, picture)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (firebase_uid) DO NOTHING`,
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
 * Receives a wallet address from the frontend and upserts the user in PostgreSQL.
 */
router.post('/wallet', async (req, res) => {
    try {
        const { wallet_address } = req.body;

        if (!wallet_address) {
            return res.status(400).json({ error: 'Missing wallet address' });
        }

        // Upsert user into PostgreSQL (ignore if already exists)
        await pool.query(
            `INSERT INTO users (wallet_address)
             VALUES ($1)
             ON CONFLICT (wallet_address) DO NOTHING`,
            [wallet_address]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[AuthRoute] Wallet Auth Error:', err.message);
        return res.status(500).json({ error: 'Failed' });
    }
});

module.exports = router;

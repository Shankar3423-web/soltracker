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
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Missing token' });
        }

        // Verify the Firebase ID token
        const decoded = await admin.auth().verifyIdToken(token);

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
        console.error('[AuthRoute] Error verifying token:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});

module.exports = router;

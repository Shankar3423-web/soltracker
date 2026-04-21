'use strict';
const admin = require('../config/firebaseAdmin');

/**
 * Watchlist Authentication Middleware
 * Supports dual auth:
 * 1. Bearer wallet:<address> -> direct wallet connection
 * 2. Bearer <token> -> Google/Firebase login
 */
async function watchlistAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or malformed Authorization header' });
        }

        const token = authHeader.split(' ')[1];

        if (token.startsWith('wallet:')) {
            // Direct wallet connection
            const address = token.split(':')[1];
            if (!address) {
                return res.status(401).json({ error: 'Invalid wallet address in token' });
            }
            req.user = { uid: `wallet:${address}`, provider: 'wallet', address };
            return next();
        } else {
            // Firebase token
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                req.user = { 
                    uid: decodedToken.uid, 
                    email: decodedToken.email, 
                    provider: 'firebase',
                    decodedToken 
                };
                return next();
            } catch (err) {
                console.error('[WatchlistAuth] Firebase Token Verification Failed:', err.message);
                return res.status(401).json({ error: 'Invalid or expired Firebase token' });
            }
        }
    } catch (err) {
        console.error('[WatchlistAuth] Middleware error:', err.message);
        return res.status(500).json({ error: 'Internal server error in auth middleware' });
    }
}

module.exports = watchlistAuth;

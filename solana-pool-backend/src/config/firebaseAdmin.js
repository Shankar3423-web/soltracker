'use strict';
const admin = require('firebase-admin');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    // Production (Render): decode Base64 env var → parse JSON
    // No newline/PEM formatting issues with this approach
    const decoded = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
        'base64'
    ).toString('utf8');

    serviceAccount = JSON.parse(decoded);

} else {
    // Local development: load from the gitignored JSON file
    serviceAccount = require('./firebaseServiceKey.json');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

module.exports = admin;
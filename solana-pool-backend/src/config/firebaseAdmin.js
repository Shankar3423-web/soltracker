'use strict';
const admin = require('firebase-admin');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Production (Render): credentials stored as an env var (JSON string)
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    // Local development: load from the gitignored JSON file
    serviceAccount = require('./firebaseServiceKey.json');
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;

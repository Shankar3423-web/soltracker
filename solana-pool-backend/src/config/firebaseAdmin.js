'use strict';
const admin = require('firebase-admin');

let serviceAccount;

if (process.env.FIREBASE_PRIVATE_KEY) {

    serviceAccount = {
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };

} else {

    serviceAccount = require('./firebaseServiceKey.json');

}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

module.exports = admin;
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();


exports.registerUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { email, password } = req.body;

    try {
        const userRecord = await admin.auth().createUser({ email, password });
        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        // Exchange the custom token for an ID token
        const decodedToken = await admin.auth().verifyIdToken(customToken);
        const idToken = decodedToken.token;
        res.status(200).send({ success: true, token: idToken });
    } catch (error) {
        res.status(400).send({ success: false, error: error.message });
    }
});

exports.signInUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { email, password } = req.body;

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(userRecord.uid, { password });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        // Exchange the custom token for an ID token
        const decodedToken = await admin.auth().verifyIdToken(customToken);
        const idToken = decodedToken.token;
        res.status(200).send({ success: true, token: idToken });
    } catch (error) {
        res.status(400).send({ success: false, error: error.message });
    }
});

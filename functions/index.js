const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
admin.initializeApp();


exports.registerUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { email, password } = req.body;

    try {
        const userRecord = await admin.auth().createUser({ email, password });
        //const customToken = await admin.auth().createCustomToken(userRecord.uid);

        // Exchange the custom token for an ID token
       // const decodedToken = await admin.auth().verifyIdToken(customToken);
        //const idToken = decodedToken.token;
        const apiKey = 'AIzaSyDf-zcmQxzLO1vq1zyWfokwqEJ3c_gNubI'; // Replace with your Firebase API Key

        // Authenticate user and retrieve ID token using Google Identity Platform REST API
        const response = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            email,
            password,
            returnSecureToken: true,
        });

        const idToken = response.data.idToken;
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
        const apiKey = 'AIzaSyDf-zcmQxzLO1vq1zyWfokwqEJ3c_gNubI'; // Replace with your Firebase API Key

        // Authenticate user and retrieve ID token using Google Identity Platform REST API
        const response = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            email,
            password,
            returnSecureToken: true,
        });

        const idToken = response.data.idToken;

        res.status(200).send({ success: true, token: idToken });
    } catch (error) {
        res.status(400).send({ success: false, error: error.message });
    }
});

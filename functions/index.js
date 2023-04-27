const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors')({ origin: true });
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const {firestore} = require("firebase-admin");

const storage = multer.memoryStorage();
const upload = multer({ storage });
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

exports.uploadVideo = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        // Validate token and get user ID
        const authToken = req.headers.authorization && req.headers.authorization.split('Bearer ')[1];
        let userId;
        try {
            const decodedToken = await admin.auth().verifyIdToken(authToken);
            userId = decodedToken.uid;
        } catch (error) {
            res.status(401).send({ success: false, error: 'Invalid token' });
            return;
        }

        // Get video details
        const { title, description } = req.body;

        upload.single('video')(req, res, async (err) => {
            if (err) {
                res.status(400).send({ success: false, error: err.message });
                return;
            }

            const videoFile = req.file;

            if (!videoFile) {
                res.status(400).send({ success: false, error: 'No video file provided' });
                return;
            }

            try {
                const videoId = uuidv4();
                const fileName = `${userId}/${videoId}.mp4`; // Assuming .mp4 format
                const file = bucket.file(fileName);

                const writeStream = file.createWriteStream({ resumable: false });

                writeStream.on('error', (error) => {
                    res.status(500).send({ success: false, error: error.message });
                });

                writeStream.on('finish', async () => {
                    // Store video metadata in Firestore
                    const videoRef = firestore.collection('videos').doc(videoId);

                    const videoMetadata = {
                        title,
                        description,
                        userId,
                        privacy: 'public', // Default privacy setting
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        views: 0,
                        likes: 0,
                        dislikes: 0,
                    };

                    await videoRef.set(videoMetadata);

                    res.status(200).send({ success: true, videoId });
                });

                writeStream.end(videoFile.buffer);
            } catch (error) {
                res.status(400).send({ success: false, error: error.message });
            }
        });
    });
});
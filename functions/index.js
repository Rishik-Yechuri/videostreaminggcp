const functions = require('firebase-functions');
const admin = require('firebase-admin');

const axios = require('axios');

const { v4: uuidv4 } = require('uuid');
const { IncomingForm } = require('formidable');
const Multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('holdvideos');

admin.initializeApp();
const firestore = admin.firestore();

const upload = Multer({
    storage: Multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024,
    },
});
const runtimeOpts = {
    timeoutSeconds: 540, // Increase the timeout to 60 seconds
};

/*exports.registerUser = functions.https.onRequest(async (req, res) => {
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
});*/
exports.registerUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { email, password, username, bio } = req.body;

    try {
        const userRecord = await admin.auth().createUser({ email, password });
        const userId = userRecord.uid;

        const userData = {
            email,
            username: username || email,
            profilePic: '',
            bio: bio || '',
            accountCreation: admin.firestore.FieldValue.serverTimestamp(),
        };

        await admin.firestore().collection('users').doc(userId).set(userData);

        // Generate a signed URL for uploading the profile picture
        const bucket = admin.storage().bucket('holdvideos');
        const filename = `userInfo-${userId}/profilePic.jpg`;
        const fileRef = bucket.file(filename);

        const signedUrlOptions = {
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: 'image/jpeg',
        };

        const signedUrl = await fileRef.getSignedUrl(signedUrlOptions);

        res.status(200).send({ success: true, userId, signedUrl });
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
exports.generateSignedUrl = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const authToken = req.headers.auth;

    if (!authToken) {
        res.status(401).send('Unauthorized: No token provided');
        return;
    }

    try {
        console.log("Received token:", authToken);
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        console.log("Decoded token:", decodedToken);
        const userId = decodedToken.uid;
        const metadata = req.body.metadata;

        const signedUrlOptionsVideo = {
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: 'video/mp4',
        };

        const signedUrlOptionsThumbnail = {
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: 'image/jpeg',
        };


        const videoId = uuidv4();
        const videoFileName = `${userId}/${videoId}.mp4`; // Assuming .mp4 format
        const videoFile = bucket.file(videoFileName);
        const videoSignedUrl = await videoFile.getSignedUrl(signedUrlOptionsVideo);

        const thumbnailFileName = `${userId}/${videoId}.jpg`; // Assuming .jpg format
        const thumbnailFile = bucket.file(thumbnailFileName);
        const thumbnailSignedUrl = await thumbnailFile.getSignedUrl(signedUrlOptionsThumbnail);

        // Save metadata in Firestore
        await admin.firestore().collection('videos').doc(videoId).set({
            title: metadata.title,
            description: metadata.description,
            likes: 0,
            dislikes: 0,
            views: 0,
            channelName: userId,
            userId: userId,
            videoUrl: videoFileName,
            thumbnailUrl: thumbnailFileName,
        });

        res.status(200).send({
            success: true,
            videoId,
            videoSignedUrl: videoSignedUrl[0],
            thumbnailSignedUrl: thumbnailSignedUrl[0],
        });
    } catch (error) {
        res.status(401).send('Unauthorized: Invalid token,' + authToken + " Error: " + error);
    }
});

exports.updateUserInfo = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const { username, bio, updateProfilePic } = req.body;
    const idToken = req.headers.auth;

    if (!idToken) {
        res.status(400).send({ success: false, error: 'ID token is required' });
        return;
    }
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        const userRef = admin.firestore().collection('users').doc(userId);

        const updates = {};

        if (username) {
            updates.username = username;
        }

        if (bio) {
            updates.bio = bio;
        }

        let signedUrl = null;

        if (updateProfilePic) {
            const bucket = storage.bucket('holdvideos');
            const filename = `userInfo-${userId}/profilePic.jpg`;
            const fileRef = bucket.file(filename);
            const options = {
                version: 'v4',
                action: 'write',
                expires: Date.now() + 15 * 60 * 1000, // 15 minutes
                contentType: 'image/jpeg',
            };
            signedUrl = await fileRef.getSignedUrl(options);
            updates.profilePic = `https://storage.googleapis.com/${bucket.name}/${filename}`;
        }

        await userRef.set(updates, { merge: true });

        res.status(200).send({ success: true, message: 'User info updated', signedUrl });
    } catch (error) {
        res.status(400).send({ success: false, error: error.message, token: idToken });
    }
});
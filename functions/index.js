const functions = require('firebase-functions');
const admin = require('firebase-admin');

const axios = require('axios');

const {v4: uuidv4} = require('uuid');
const {IncomingForm} = require('formidable');
const Multer = require('multer');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('holdvideos');

admin.initializeApp();
const firestore = admin.firestore();

const runtimeOpts = {
    timeoutSeconds: 540, // Increase the timeout to 60 seconds
};


exports.registerUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const {email, password, username, bio} = req.body;

    try {
        const userRecord = await admin.auth().createUser({email, password});
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

        res.status(200).send({success: true, userId, signedUrl});
    } catch (error) {
        res.status(400).send({success: false, error: error.message});
    }
});

exports.signInUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const {email, password} = req.body;

    try {
        const apiKey = 'AIzaSyDf-zcmQxzLO1vq1zyWfokwqEJ3c_gNubI'; // Replace with your Firebase API Key

        // Authenticate user and retrieve ID token using Google Identity Platform REST API
        const response = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            email,
            password,
            returnSecureToken: true,
        });

        const idToken = response.data.idToken;

        res.status(200).send({success: true, token: idToken});
    } catch (error) {
        res.status(400).send({success: false, error: error.message});
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

        const userRef = admin.firestore().collection('users').doc(userId);
        const userDoc = await userRef.get();

        const videoData = {
            userId: userId,
            videoUrl: videoFileName,
            thumbnailUrl: thumbnailFileName,
            views: 0,
            likes: 0,
            dislikes: 0,
            channelName: userDoc.data().username, // Fetching the username for channelName
            createdAt: admin.firestore.FieldValue.serverTimestamp() // Add a server timestamp for 'createdAt'

        };

        if (metadata.title) {
            videoData.title = metadata.title;
        }

        if (metadata.description) {
            videoData.description = metadata.description;
        }

        if (Object.keys(videoData).length > 0) {
            const videoRef = admin.firestore().collection('videos').doc(videoId);
            const userVideoRef = userRef.collection('videos').doc(videoId);

            // Write to 'videos' collection and user's 'videos' subcollection
            await Promise.all([
                videoRef.set(videoData, {merge: true}),
                userVideoRef.set(videoData, {merge: true})
            ]);
        }

        res.status(200).send({
            success: true,
            videoSignedUrl: videoSignedUrl[0],
            thumbnailSignedUrl: thumbnailSignedUrl[0],
        });
    } catch (error) {
        res.status(401).send('Unauthorized: Invalid token,' + authToken + " Error: " + error);
    }
});



exports.updateUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const {username, bio, updateProfilePic} = req.body;
    const idToken = req.headers.auth;

    if (!idToken) {
        res.status(400).send({success: false, error: 'ID token is required'});
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
            updates.profilePic = filename;
        }

        await userRef.set(updates, {merge: true});

        res.status(200).send({success: true, message: 'User info updated', signedUrl});
    } catch (error) {
        res.status(400).send({success: false, error: error.message, token: idToken});
    }
});
exports.updateVideo = functions.https.onRequest(async (req, res) => {
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
        const videoId = req.body.videoId;
        if (!videoId) {
            res.status(400).send('Bad Request: No document ID provided');
        }
        const videoDocRef = admin.firestore().collection('videos').doc(videoId);
        const videoDoc = await videoDocRef.get();

        if (!videoDoc.exists) {
            res.status(404).send('Error: Video not found');
            return;
        }

        const videoData = videoDoc.data();

        if (videoData.userId !== userId) {
            res.status(403).send('Forbidden: You are not allowed to update this video');
            return;
        }

        const updateData = {};
        if (metadata) {
            if (metadata.title) updateData.title = metadata.title;
            if (metadata.description) updateData.description = metadata.description;
        }

        if (Object.keys(updateData).length > 0) {
            const userVideoDocRef = admin.firestore().collection('users').doc(userId).collection('videos').doc(videoId);

            // Update video data in both 'videos' collection and user's 'videos' subcollection
            await Promise.all([
                videoDocRef.update(updateData),
                userVideoDocRef.update(updateData)
            ]);
        }

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

        const videoFileName = videoData.videoUrl;
        const videoFile = bucket.file(videoFileName);
        const videoSignedUrl = await videoFile.getSignedUrl(signedUrlOptionsVideo);

        const thumbnailFileName = videoData.thumbnailUrl;
        const thumbnailFile = bucket.file(thumbnailFileName);
        const thumbnailSignedUrl = await thumbnailFile.getSignedUrl(signedUrlOptionsThumbnail);

        res.status(200).send({
            success: true,
            videoId,
            videoSignedUrl: videoSignedUrl[0],
            thumbnailSignedUrl: thumbnailSignedUrl[0],
        });
    } catch (error) {
        res.status(401).send("Error: " + error);
    }
});

exports.deleteVideo = functions.https.onRequest(async (req, res) => {
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
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const userId = decodedToken.uid;
        const videoId = req.body.videoId;

        // Delete video file and thumbnail from storage
        const videoFileName = `${userId}/${videoId}.mp4`;
        const thumbnailFileName = `${userId}/${videoId}.jpg`;

        await Promise.all([
            bucket.file(videoFileName).delete(),
            bucket.file(thumbnailFileName).delete()
        ]);

        // Delete metadata from Firestore in both 'videos' collection and user's 'videos' subcollection
        const videoDocRef = admin.firestore().collection('videos').doc(videoId);
        const userVideoDocRef = admin.firestore().collection('users').doc(userId).collection('videos').doc(videoId);

        await Promise.all([
            videoDocRef.delete(),
            userVideoDocRef.delete()
        ]);

        res.status(200).send({success: true, message: 'Video and metadata deleted successfully.'});
    } catch (error) {
        res.status(401).send('Error: ' + error);
    }
});

exports.getUserDetails = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'GET') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const userId = req.query.uid;

    if (!userId) {
        res.status(400).send('Bad Request: Missing user UID');
        return;
    }

    try {
        const userDoc = await admin.firestore().collection('users').doc(userId).get();

        if (!userDoc.exists) {
            res.status(404).send('User not found');
        } else {
            const userData = userDoc.data();

            // Generate a signed URL for the profile picture
            const bucket = admin.storage().bucket('holdvideos');
            const filename = `userInfo-${userId}/profilePic.jpg`;

            const fileRef = bucket.file(filename);

            const signedUrlOptions = {
                version: 'v4',
                action: 'read',
                expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            };

            const signedUrl = await fileRef.getSignedUrl(signedUrlOptions);

            const userDetails = {
                username: userData.username,
                bio: userData.bio,
                profilePic: signedUrl[0],
                accountCreation: userData.accountCreation,
            };
            res.status(200).send(userDetails);
        }
    } catch (error) {
        res.status(500).send({error: error.message});
    }
});
exports.deleteUser = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'DELETE') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const idToken = req.headers.auth;

    if (!idToken) {
        res.status(400).send('Bad Request: Missing ID token');
        return;
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Get the bucket
        const bucket = storage.bucket('holdvideos');

        // Prepare Firestore batch
        const batch = admin.firestore().batch();

        // Get the files in the user's folder
        const [files] = await bucket.getFiles({prefix: `${userId}/`});

        // Delete each video document and its corresponding files in storage
        for (const file of files) {
            // Check if the file is a video
            if (file.name.endsWith('.mp4')) {
                // Get the name of the file without extension and user ID prefix
                const fileName = file.name.split('.').slice(0, -1).join('.').replace(`${userId}/`, '');

                // Delete the document from Firestore
                const videoRef = admin.firestore().collection('videos').doc(fileName);
                batch.delete(videoRef);
            }

            // Delete the file from storage
            await file.delete();
        }

        // Commit the Firestore batch
        await batch.commit();

        // Get the files in the userInfo-UID folder
        const [userInfoFiles] = await bucket.getFiles({prefix: `userInfo-${userId}/`});
        for (const file of userInfoFiles) {
            await file.delete();
        }

        // Delete the user's account
        await admin.auth().deleteUser(userId);

        res.status(200).send('User deleted successfully');
    } catch (error) {
        res.status(500).send({error: error.message});
    }
});
exports.getVideo = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'GET') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const videoId = req.query.videoId;

    if (!videoId) {
        res.status(400).send('Bad Request: Missing video ID');
        return;
    }

    try {
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        const videoDoc = await videoRef.get();

        if (videoDoc.exists) {
            const videoData = videoDoc.data();
            const bucket = admin.storage().bucket('holdvideos');
            const thumbnailFileName = `${videoData.userId}/${videoId}.jpg`;

            const fileRef = bucket.file(thumbnailFileName);

            const signedUrlOptions = {
                version: 'v4',
                action: 'read',
                expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            };

            const [signedUrl] = await fileRef.getSignedUrl(signedUrlOptions);

            videoData.thumbnailUrl = signedUrl;

            const videoFileName = `${videoData.userId}/${videoId}.mp4`;
            const videoFileRef = bucket.file(videoFileName);

            const videoSignedUrlOptions = {
                version: 'v4',
                action: 'read',
                expires: Date.now() + 30 * 60 * 1000, // 30 minutes
            };

            const [videoSignedUrl] = await videoFileRef.getSignedUrl(videoSignedUrlOptions);

            videoData.videoUrl = videoSignedUrl;
            res.status(200).send(videoData);
        } else {
            res.status(404).send('Not Found: Video does not exist');
        }
    } catch (error) {
        res.status(500).send({error: error.message});
    }
});
exports.listUserVideos = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    var pageSize = req.body.pageSize || 10; // Default page size is 10
    if(pageSize > 10){
        pageSize = 10;
    }
    const startAfter = req.body.listAfter; // Timestamp of the last document in the previous batch
    const userId = req.body.uid;

    let query = admin.firestore().collection('users').doc(userId).collection('videos')
        .orderBy('createdAt', 'desc')
        .limit(pageSize);

    if (startAfter) {
        // Convert the timestamp to a Firestore Timestamp
        const startAfterTimestamp = new admin.firestore.Timestamp(startAfter._seconds, startAfter._nanoseconds);
        query = query.startAfter(startAfterTimestamp);
    }

    const snapshot = await query.get();

    let videos = [];
    snapshot.forEach(doc => {
        let video = doc.data();
        video.id = doc.id;
        videos.push(video);
    });

    res.status(200).send({
        success: true,
        videos: videos,
        // Send the timestamp of the last document if there are more videos to fetch
        nextStartAfter: videos.length < pageSize ? null : videos[videos.length - 1].createdAt
    });
});


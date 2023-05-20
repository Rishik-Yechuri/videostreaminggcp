const functions = require('firebase-functions');
const admin = require('firebase-admin');

const axios = require('axios');
const {get} = require('axios');
const {GoogleAuth} = require('google-auth-library');
const {v4: uuidv4} = require('uuid');
const {IncomingForm} = require('formidable');
const Multer = require('multer');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('holdvideos');
const videoIntelligence = require('@google-cloud/video-intelligence').v1;

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
    const idToken = req.headers.auth;

    if (!idToken) {
        res.status(400).send('Bad Request: Missing ID token');
        return;
    }
    var userId;
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        userId = decodedToken.uid;
    } catch (error) {
        res.status(500).send({error: error.message});

    }
    if (!videoId || !userId) {
        res.status(400).send('Bad Request: Missing video ID or user ID');
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

            // Log this access under the user's document in the 'logs' subcollection
            const userRef = admin.firestore().collection('users').doc(userId);
            const logsRef = userRef.collection('logs');

            await logsRef.add({
                videoId: videoId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
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
    if (pageSize > 10) {
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
exports.listAllVideos = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    var pageSize = req.body.pageSize || 10; // Default page size is 10
    if (pageSize > 10) {
        pageSize = 10;
    }
    const startAfter = req.body.listAfter; // Timestamp of the last document in the previous batch

    try {
        let query = admin.firestore().collection('videos') // replace 'videos' with your actual collection name
            .orderBy('createdAt', 'desc')
            .limit(pageSize);

        if (startAfter) {
            query = query.startAfter(new admin.firestore.Timestamp(startAfter._seconds, startAfter._nanoseconds));
        }

        const snapshot = await query.get();

        let videos = [];
        snapshot.forEach(doc => {
            let video = doc.data();
            video.id = doc.id;
            videos.push(video);
        });

        const nextStartAfter = videos.length > 0 ? videos[videos.length - 1].createdAt : null;

        res.status(200).send({
            success: true,
            videos: videos,
            // Send the timestamp of the last document if there are more videos to fetch
            nextStartAfter: nextStartAfter ? {
                _seconds: nextStartAfter._seconds,
                _nanoseconds: nextStartAfter._nanoseconds
            } : null
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }
});
exports.requestView = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const authToken = req.headers.auth;
    const videoId = req.body.videoId;

    if (!authToken || !videoId) {
        res.status(400).send('Bad Request: Missing token or video ID');
        return;
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const userId = decodedToken.uid;

        const videoRef = admin.firestore().collection('videos').doc(videoId);
        const videoDoc = await videoRef.get();

        if (!videoDoc.exists) {
            res.status(404).send('Not Found: Video does not exist');
            return;
        }

        const userRef = admin.firestore().collection('users').doc(userId);
        const logsRef = userRef.collection('logs');
        const logsQuery = logsRef.orderBy('timestamp', 'desc').limit(1);
        const logsSnapshot = await logsQuery.get();

        if (logsSnapshot.empty) {
            res.status(400).send('Bad Request: No video has been accessed yet');
            return;
        }

        const lastLog = logsSnapshot.docs[0].data();

        if (lastLog.videoId !== videoId) {
            res.status(400).send('Bad Request: Different video was last accessed');
            return;
        }

        const lastLogTimestamp = lastLog.timestamp.toDate();
        const currentTime = new Date();
        const timeDiff = currentTime - lastLogTimestamp;

        const videoFilePath = `${videoDoc.data().userId}/${videoId}.mp4`;
        const videoFile = storage.bucket('holdvideos').file(videoFilePath);
        const [videoMetadata] = await videoFile.getMetadata();

        const videoDuration = videoMetadata.timeCreated ? (videoMetadata.timeCreated / 1000) : 0; // Assuming the video duration is in seconds
        const requiredTimeDiff = videoDuration * 0.8 * 1000; // Convert to milliseconds

        if (timeDiff < requiredTimeDiff) {
            res.status(400).send('Bad Request: Not enough time has passed since the video was accessed');
            return;
        }

        // If all checks pass, increment the view count
        await videoRef.update({views: admin.firestore.FieldValue.increment(1)});

        res.status(200).send({success: true, length: videoDuration});
    } catch (error) {
        res.status(500).send({error: error.message});
    }
});

exports.addViewToVideo = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const tokenId = req.headers.auth;
    const videoId = req.body.videoId;

    if (!tokenId || !videoId) {
        res.status(400).send('Bad Request: Missing token or video ID');
        return;
    }

    try {
        // verify the ID token first
        const decodedToken = await admin.auth().verifyIdToken(tokenId);
        const uid = decodedToken.uid;

        // Check if the user has already viewed the video
        const userRef = admin.firestore().collection('users').doc(uid);
        const likesRef = userRef.collection('likes').doc(videoId);
        const likeSnapshot = await likesRef.get();

        if (likeSnapshot.exists) {
            // User has already viewed the video
            res.status(200).send({
                success: true,
                message: 'User has already viewed this video'
            });
            return;
        }

        // User hasn't viewed the video yet, add a like
        const timestamp = admin.firestore.Timestamp.now();
        await likesRef.set({
            videoId: videoId,
            timestamp: timestamp
        });
        // Get the video document to find the creatorId
        // Increment the view count on the video
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        const videoSnapshot = await videoRef.get();
        const videoData = videoSnapshot.data();
        //const userVideoRef = admin.firestore().collection('users').doc(uid).collection("videos").doc(videoId);

        await videoRef.update({
            views: admin.firestore.FieldValue.increment(1)
        });
        const creatorRef = admin.firestore().collection('users').doc(videoData.userId);
        const creatorVideoRef = creatorRef.collection('videos').doc(videoId);
        await creatorVideoRef.update({
            views: admin.firestore.FieldValue.increment(1)
        });
        res.status(200).send({
            success: true,
            message: 'View added successfully'
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }
});
exports.reactToVideo = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const tokenId = req.headers.auth;
    const videoId = req.body.videoId;
    const action = req.body.action; // 'like', 'dislike', or 'none'

    if (!tokenId || !videoId || !action) {
        res.status(400).send('Bad Request: Missing token, video ID, or action');
        return;
    }

    if (!['like', 'dislike', 'none'].includes(action)) {
        res.status(400).send('Bad Request: Invalid action');
        return;
    }

    try {
        // verify the ID token first
        const decodedToken = await admin.auth().verifyIdToken(tokenId);
        const uid = decodedToken.uid;

        // Check the current reaction to the video
        const userRef = admin.firestore().collection('users').doc(uid);
        const likesRef = userRef.collection('likes').doc(videoId);
        const likeSnapshot = await likesRef.get();

        let currentReaction = 'none';
        if (likeSnapshot.exists) {
            currentReaction = likeSnapshot.data().reaction;
        }

        if (currentReaction === action) {
            // The new action is the same as the current reaction, do nothing
            res.status(200).send({
                success: true,
                message: 'No action taken'
            });
            return;
        }

        // Update the reaction
        const timestamp = admin.firestore.Timestamp.now();
        await likesRef.set({
            videoId: videoId,
            timestamp: timestamp,
            reaction: action
        });

        // Get the video document to find the creatorId
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        const videoSnapshot = await videoRef.get();
        const videoData = videoSnapshot.data();

        // Depending on the current and new reactions, update the like and dislike counts on the video
        const updates = {};

        if (currentReaction === 'like') {
            updates.likes = admin.firestore.FieldValue.increment(-1);
        } else if (currentReaction === 'dislike') {
            updates.dislikes = admin.firestore.FieldValue.increment(-1);
        }

        if (action === 'like') {
            updates.likes = admin.firestore.FieldValue.increment(1);
        } else if (action === 'dislike') {
            updates.dislikes = admin.firestore.FieldValue.increment(1);
        }

        await videoRef.update(updates);

        // Update the video in the creator's subcollection
        const creatorRef = admin.firestore().collection('users').doc(videoData.userId);
        const creatorVideoRef = creatorRef.collection('videos').doc(videoId);
        await creatorVideoRef.update(updates);

        res.status(200).send({
            success: true,
            message: 'Reaction updated successfully'
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }
});
exports.addComment = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const commentText = req.body.comment;
    const videoId = req.body.videoId;
    const type = req.body.type; // should be either 'comment' or 'reply'
    const parentId = req.body.parentId || null;
    const userToken = req.headers.auth;
    try {
        const decodedToken = await admin.auth().verifyIdToken(userToken);
        const uid = decodedToken.uid;
        const newComment = {
            userId: uid,
            text: commentText,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            dislikes: 0,
            parentId: parentId
        };
        const randId = uuidv4();
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        // Get the video document to find the creator's id
        const videoDoc = await videoRef.get();
        if (!videoDoc.exists) {
            res.status(400).send('Video not found');
            return;
        }
        const creatorId = videoDoc.data().userId;
        // Reference to the creator's videos subcollection
        const creatorVideoRef = admin.firestore().collection('users').doc(creatorId).collection('videos').doc(videoId);
        let commentRef;
        let userCommentRef;
        if (type === 'comment') {
            commentRef = videoRef.collection('comments').doc(randId);
            userCommentRef = creatorVideoRef.collection("comments").doc(randId);
        } else if (type === 'reply') {
            if (!parentId) {
                res.status(400).send('Missing parentID');
            } else {
                // Check if parent comment exists
                const parentCommentRef = videoRef.collection('comments').doc(parentId);
                const parentCommentSnapshot = await parentCommentRef.get();
                if (!parentCommentSnapshot.exists) {
                    res.status(400).send('Parent comment does not exist');
                    return;
                }
                await videoRef.collection("comments").doc(parentId).collection("replies").doc(randId).set(newComment);
                // await videoRef.set(newComment);
                await creatorVideoRef.collection("comments").doc(parentId).collection("replies").doc(randId).set(newComment);
                // await creatorVideoRef.set(newComment);
                commentRef = videoRef.collection('replies').doc(randId);
                userCommentRef = creatorVideoRef.collection("replies").doc(randId);
            }
        } else {
            res.status(400).send('Invalid type');
            return;
        }
        const userVideoRef = admin.firestore().collection('users').doc(videoId);

        // Add the new comment or reply to the appropriate subcollection
        //await commentRef.doc(randId);
        await commentRef.set(newComment);
        //await userCommentRef.doc(randId);
        await userCommentRef.set(newComment);
        res.status(200).send({
            success: true,
            message: 'Comment added successfully'
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }
});
exports.deleteComment = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'DELETE') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const videoId = req.body.videoId;
    const commentId = req.body.commentId;
    const type = req.body.type; // should be either 'comment' or 'reply'
    //const parentId = req.body.parentId || null;
    const userToken = req.headers.auth;
    try {
        const decodedToken = await admin.auth().verifyIdToken(userToken);
        const uid = decodedToken.uid;
        const vidId = commentId;
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        // Get the video document to find the creator's id
        const videoDoc = await videoRef.get();
        if (!videoDoc.exists) {
            res.status(400).send('Video not found');
            return;
        }
        const creatorId = videoDoc.data().userId;
        // Reference to the creator's videos subcollection
        const creatorVideoRef = admin.firestore().collection('users').doc(creatorId).collection('videos').doc(videoId);
        let commentRef;
        let userCommentRef;
        if (type === 'comment') {
            await deleteCommentAndReplies(videoRef.collection('comments').doc(vidId), creatorVideoRef.collection('comments').doc(vidId), uid, creatorId);
        } else if (type === 'reply') {
            /*if (!parentId) {
                res.status(400).send('Missing parentID');
                return;
            }*/
            const replyDoc = await admin.firestore().collection("videos").doc(videoId).collection("replies").doc(commentId).get();
            const parentId = replyDoc.data().parentId;
            await admin.firestore().collection("videos").doc(videoId).collection("replies").doc(commentId).delete();
            await admin.firestore().collection("videos").doc(videoId).collection("comments").doc(parentId).collection("replies").doc(commentId).delete();

            await admin.firestore().collection("users").doc(creatorId).collection("videos").doc(videoId).collection("replies").doc(commentId).delete();
            await admin.firestore().collection("users").doc(creatorId).collection("videos").doc(videoId).collection("comments").doc(parentId).collection("replies").doc(commentId).delete();
            // await deleteCommentAndReplies(videoRef.collection("comments").doc(parentId).collection("replies").doc(vidId), creatorVideoRef.collection("comments").doc(parentId).collection("replies").doc(vidId), uid,creatorId);
        } else {
            res.status(400).send('Invalid type');
            return;
        }

        res.status(200).send({
            success: true,
            message: 'Comment removed successfully'
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }

    async function deleteCommentAndReplies(commentRef, creatorCommentRef, uid, creatorId) {
        const commentDoc = await commentRef.get();
        if (!commentDoc.exists) {
            res.status(400).send('Comment does not exist');
            return;
        }
        if (commentDoc.data().userId !== uid) {
            res.status(400).send('User does not have permission to delete this comment');
            return;
        }

        // Delete replies directly under the comment
        const repliesSnapshot = await commentRef.collection('replies').get();
        for (const doc of repliesSnapshot.docs) {
            //if (doc.data().userId === uid) {
            await admin.firestore().collection('videos').doc(videoId).collection("replies").doc(doc.id).delete();
            await admin.firestore().collection("users").doc(creatorId).collection('videos').doc(videoId).collection("replies").doc(doc.id).delete();
            const creatorReplyDoc = await creatorCommentRef.collection('replies').doc(doc.id).get();
            if (creatorReplyDoc.exists) {
                await creatorReplyDoc.ref.delete();
            }
            const replyDoc = await commentRef.collection('replies').doc(doc.id).get();
            if (replyDoc.exists) {
                await replyDoc.ref.delete();
            }
            // }
        }

        await commentRef.delete();
        const creatorCommentDoc = await creatorCommentRef.get();
        if (creatorCommentDoc.exists) {
            await creatorCommentRef.delete();
        }
        const commentDoc2 = await commentRef.get();
        if (commentDoc2.exists) {
            await commentRef.delete();
        }
    }
});
exports.reactToComment = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const tokenId = req.headers.auth;
    const videoId = req.body.videoId;
    const commentId = req.body.commentId;
    const type = req.body.type;
    const action = req.body.action; // 'like', 'dislike', or 'none'
    if (!tokenId || !videoId || !action) {
        res.status(400).send('Bad Request: Missing token, video ID, or action');
        return;
    }

    if (!['like', 'dislike', 'none'].includes(action)) {
        res.status(400).send('Bad Request: Invalid action');
        return;
    }

    try {
        // verify the ID token first
        const decodedToken = await admin.auth().verifyIdToken(tokenId);
        const uid = decodedToken.uid;

        // Check the current reaction to the video
        const userRef = admin.firestore().collection('users').doc(uid);
        const likesRef = userRef.collection('commentlikes').doc(commentId);
        const likeSnapshot = await likesRef.get();

        let currentReaction = 'none';
        if (likeSnapshot.exists) {
            currentReaction = likeSnapshot.data().reaction;
        }

        if (currentReaction === action) {
            // The new action is the same as the current reaction, do nothing
            res.status(200).send({
                success: true,
                message: 'No action taken'
            });
            return;
        }

        // Update the reaction
        const timestamp = admin.firestore.Timestamp.now();
        await likesRef.set({
            videoId: videoId,
            timestamp: timestamp,
            reaction: action
        });

        // Get the video document to find the creatorId
        const videoRef = admin.firestore().collection('videos').doc(videoId);
        const videoSnapshot = await videoRef.get();
        const videoData = videoSnapshot.data();
// Get the comment document
        var commentRef = null// = admin.firestore().collection('videos').doc(videoId).collection('comments').doc(commentId);
        if (type === 'comment') {
            commentRef = admin.firestore().collection('videos').doc(videoId).collection('comments').doc(commentId);
        } else {
            commentRef = admin.firestore().collection('videos').doc(videoId).collection('replies').doc(commentId);
        }
        const commentSnapshot = await commentRef.get();
        const commentData = commentSnapshot.data();

// Calculate the new number of likes and dislikes
        let likes = commentData.likes || 0;
        let dislikes = commentData.dislikes || 0;
        // Depending on the current and new reactions, update the like and dislike counts on the video
        const updates = {};

        if (currentReaction === 'like') {
            //await updates.likes = admin.firestore.FieldValue.increment(-1);
            likes--;
        } else if (currentReaction === 'dislike') {
            //await updates.dislikes = admin.firestore.FieldValue.increment(-1);
            dislikes--;
        }

        if (action === 'like') {
            likes++;
            // await updates.likes = admin.firestore.FieldValue.increment(1);
        } else if (action === 'dislike') {
            dislikes++;
            //await  updates.dislikes = admin.firestore.FieldValue.increment(1);
        }
        updates.likes = likes;
        updates.dislikes = dislikes;
        const totalReactions = likes + dislikes;
        updates.likeDislikeRatio = totalReactions === 0 ? 0 : updates.likes / totalReactions;
        //await videoRef.update(updates);

        // Update the video in the creator's subcollection
        const creatorRef = admin.firestore().collection('users').doc(videoData.userId);
        const creatorVideoRef = creatorRef.collection('videos').doc(videoId);
        //await creatorVideoRef.update(updates);
        if (type === 'reply') {
            const replyDoc = await admin.firestore().collection("videos").doc(videoId).collection("replies").doc(commentId).get();
            const parentId = replyDoc.data().parentId;
            await admin.firestore().collection("videos").doc(videoId).collection("replies").doc(commentId).update(updates);

            await admin.firestore().collection("videos").doc(videoId).collection("comments").doc(parentId).collection("replies").doc(commentId).update(updates);

            await admin.firestore().collection("users").doc(videoData.userId).collection("videos").doc(videoId).collection("replies").doc(commentId).update(updates);

            await admin.firestore().collection("users").doc(videoData.userId).collection("videos").doc(videoId).collection("comments").doc(parentId).collection("replies").doc(commentId).update(updates);
        } else if (type === 'comment') {
            await admin.firestore().collection("videos").doc(videoId).collection("comments").doc(commentId).update(updates);
            await admin.firestore().collection("users").doc(videoData.userId).collection("videos").doc(videoId).collection("comments").doc(commentId).update(updates);
        }
        res.status(200).send({
            success: true,
            message: 'Reaction updated successfully'
        });
    } catch (error) {
        res.status(400).send('Bad Request: ' + error);
    }
});
exports.listComments = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const videoId = req.body.videoId;
    let numComments = req.body.numComments || 10; // Default page size is 10
    if (numComments > 10) {
        numComments = 10;
    }
    const startAfter = req.body.startAfter; // Object containing the like/dislike ratio and timestamp of the last document in the previous batch
    //const authToken = req.headers.auth;

    // TODO: Validate authToken here

    const db = admin.firestore();
    const commentsRef = db.collection('videos').doc(videoId).collection('comments');

    let query = commentsRef
        .orderBy('likeDislikeRatio', 'desc')
        .orderBy('timestamp', 'desc') // Assuming each comment has a 'timestamp' field
        .limit(numComments);

    if (startAfter) {
        // Convert the timestamp to a Firestore Timestamp
        const startAfterTimestamp = new admin.firestore.Timestamp(startAfter.timestamp._seconds, startAfter.timestamp._nanoseconds);
        query = query.startAfter(startAfter.likeDislikeRatio, startAfterTimestamp);
    }

    try {
        const snapshot = await query.get();
        const comments = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            comments.push(data);
        });

        res.status(200).send({
            success: true,
            comments: comments,
            // Send the likeDislikeRatio and timestamp of the last document if there are more comments to fetch
            nextStartAfter: comments.length < numComments ? null : {
                likeDislikeRatio: comments[comments.length - 1].likeDislikeRatio,
                timestamp: comments[comments.length - 1].timestamp
            }
        });
    } catch (error) {
        res.status(500).send(error);
    }
});
exports.listReplies = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const videoId = req.body.videoId;
    const commentId = req.body.commentId; // ID of the parent comment
    let numReplies = req.body.numReplies || 10; // Default page size is 10
    if (numReplies > 10) {
        numReplies = 10;
    }
    const startAfter = req.body.startAfter; // Object containing the like/dislike ratio and timestamp of the last document in the previous batch

    // TODO: Validate authToken here

    const db = admin.firestore();
    const repliesRef = db.collection('videos').doc(videoId).collection('comments').doc(commentId).collection('replies');

    let query = repliesRef
        .orderBy('likeDislikeRatio', 'desc')
        .orderBy('timestamp', 'desc') // Assuming each reply has a 'timestamp' field
        .limit(numReplies);

    if (startAfter) {
        // Convert the timestamp to a Firestore Timestamp
        const startAfterTimestamp = new admin.firestore.Timestamp(startAfter.timestamp._seconds, startAfter.timestamp._nanoseconds);
        query = query.startAfter(startAfter.likeDislikeRatio, startAfterTimestamp);
    }

    try {
        const snapshot = await query.get();
        const replies = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            replies.push(data);
        });

        res.status(200).send({
            success: true,
            replies: replies,
            // Send the likeDislikeRatio and timestamp of the last document if there are more replies to fetch
            nextStartAfter: replies.length < numReplies ? null : { likeDislikeRatio: replies[replies.length - 1].likeDislikeRatio, timestamp: replies[replies.length - 1].timestamp }
        });
    } catch (error) {
        res.status(500).send(error);
    }
});

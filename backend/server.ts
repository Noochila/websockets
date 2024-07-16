import WebSocket, { Server } from 'ws';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import express from 'express';
import http from 'http';
import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

interface Client {
    ws: WebSocket;
    room: string | null;
}

const rooms: Record<string, { clients: Record<string, Client>; fileChunks: Record<string, { fileName: string, chunks: Buffer[] }> }> = {};

const uploadDir = path.join(__dirname, 'uploads');

// AWS S3 configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION, // Replace with your AWS region if not set in .env
});

// Ensure the uploads directory exists (optional, if using local storage for temporary chunks)
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

wss.on('connection', (ws: WebSocket) => {
    const clientId = uuidv4();
    let currentRoom: string | null = null;

    ws.on('message', async (message: string) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'create-room':
                const roomId = uuidv4();
                rooms[roomId] = { clients: {}, fileChunks: {} };
                rooms[roomId].clients[clientId] = { ws, room: roomId };
                currentRoom = roomId;
                ws.send(JSON.stringify({ type: 'room-created', roomId, link: `http://localhost:8080/room/${roomId}` }));
                break;
            case 'join':
                if (rooms[data.room]) {
                    rooms[data.room].clients[clientId] = { ws, room: data.room };
                    currentRoom = data.room;
                    broadcast(data.room, JSON.stringify({ type: 'info', message: `User ${clientId} joined the room` }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                }
                break;
            case 'message':
                if (currentRoom) {
                    broadcast(currentRoom, JSON.stringify({ type: 'message', clientId, message: data.message }));
                }
                break;
            case 'file-start':
                if (currentRoom) {
                    rooms[currentRoom].fileChunks[data.fileId] = { fileName: data.fileName, chunks: [] };
                }
                break;
            case 'file-chunk':
                if (currentRoom) {
                    rooms[currentRoom].fileChunks[data.fileId].chunks.push(Buffer.from(data.chunk));
                }
                break;
            case 'file-end':
                if (currentRoom) {
                    const fileData = rooms[currentRoom].fileChunks[data.fileId];
                    const fileName = fileData.fileName;
                    const fileBuffer = Buffer.concat(fileData.chunks);

                    try {
                        // Upload file to S3 bucket
                        const params = {
                            Bucket: 'myfileroom',
                            Key: `${currentRoom}/${fileName}`, // Specify the directory structure within the bucket
                            Body: fileBuffer,
                        };

                        await s3.upload(params).promise();

                        // Notify clients about successful upload
                        const fileUrl = s3.getSignedUrl('getObject', {
                            Bucket: 'myfileroom',
                            Key: `${currentRoom}/${fileName}`,
                            Expires: 3600, // URL expiration time (in seconds)
                        });

                        broadcast(currentRoom || "", JSON.stringify({ type: 'file', clientId, fileName, fileUrl }));
                    } catch (error) {
                        console.error('S3 upload error:', error);
                        ws.send(JSON.stringify({ type: 'error', message: 'File upload failed' }));
                    }

                    delete rooms[currentRoom].fileChunks[data.fileId];
                }
                break;
            default:
                console.error('Unknown message type:', data.type);
        }
    });

    ws.on('close', async () => {
        if (currentRoom) {
            delete rooms[currentRoom].clients[clientId];
            if (Object.keys(rooms[currentRoom].clients).length === 0) {
                // Delete all files in the S3 bucket for the room
                try {
                    const listParams = {
                        Bucket: 'myfileroom',
                        Prefix: `${currentRoom}/`, // List all files under the current room's prefix
                    };

                    const listedObjects = await s3.listObjectsV2(listParams).promise();

                    if (listedObjects.Contents?.length) {
                        const deleteParams = {
                            Bucket: 'myfileroom',
                            Delete: { Objects: [] as any[] },
                        };

                        listedObjects.Contents.forEach(({ Key }) => {
                            deleteParams.Delete.Objects.push({ Key });
                        });

                        await s3.deleteObjects(deleteParams).promise();

                        console.log(`All files in room ${currentRoom} deleted from S3 bucket`);
                    }
                } catch (error) {
                    console.error('S3 delete error:', error);
                }

                // Delete local files if using local storage for temporary chunks
                const roomPath = path.join(uploadDir, currentRoom);
                fs.rmSync(roomPath, { recursive: true, force: true });
                delete rooms[currentRoom];
                console.log(`Room ${currentRoom} closed and files deleted`);
            } else {
                broadcast(currentRoom, JSON.stringify({ type: 'info', message: `User ${clientId} left the room` }));
            }
        }
    });
});

function broadcast(room: string, message: string) {
    Object.values(rooms[room].clients).forEach(client => {
        client.ws.send(message);
    });
}

server.listen(8080, () => {
    console.log('WebSocket server is running on ws://localhost:8080');
});

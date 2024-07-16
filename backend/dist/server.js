"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.Server({ server });
const rooms = {};
const uploadDir = path_1.default.join(__dirname, 'uploads');
// AWS S3 configuration
const s3 = new aws_sdk_1.default.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION, // Replace with your AWS region if not set in .env
});
// Ensure the uploads directory exists (optional, if using local storage for temporary chunks)
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
wss.on('connection', (ws) => {
    const clientId = (0, uuid_1.v4)();
    let currentRoom = null;
    ws.on('message', (message) => __awaiter(void 0, void 0, void 0, function* () {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'create-room':
                const roomId = (0, uuid_1.v4)();
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
                }
                else {
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
                            Key: `${currentRoom}/${fileName}`,
                            Body: fileBuffer,
                        };
                        yield s3.upload(params).promise();
                        // Notify clients about successful upload
                        const fileUrl = s3.getSignedUrl('getObject', {
                            Bucket: 'myfileroom',
                            Key: `${currentRoom}/${fileName}`,
                            Expires: 3600, // URL expiration time (in seconds)
                        });
                        broadcast(currentRoom || "", JSON.stringify({ type: 'file', clientId, fileName, fileUrl }));
                    }
                    catch (error) {
                        console.error('S3 upload error:', error);
                        ws.send(JSON.stringify({ type: 'error', message: 'File upload failed' }));
                    }
                    delete rooms[currentRoom].fileChunks[data.fileId];
                }
                break;
            default:
                console.error('Unknown message type:', data.type);
        }
    }));
    ws.on('close', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (currentRoom) {
            delete rooms[currentRoom].clients[clientId];
            if (Object.keys(rooms[currentRoom].clients).length === 0) {
                // Delete all files in the S3 bucket for the room
                try {
                    const listParams = {
                        Bucket: 'myfileroom',
                        Prefix: `${currentRoom}/`, // List all files under the current room's prefix
                    };
                    const listedObjects = yield s3.listObjectsV2(listParams).promise();
                    if ((_a = listedObjects.Contents) === null || _a === void 0 ? void 0 : _a.length) {
                        const deleteParams = {
                            Bucket: 'myfileroom',
                            Delete: { Objects: [] },
                        };
                        listedObjects.Contents.forEach(({ Key }) => {
                            deleteParams.Delete.Objects.push({ Key });
                        });
                        yield s3.deleteObjects(deleteParams).promise();
                        console.log(`All files in room ${currentRoom} deleted from S3 bucket`);
                    }
                }
                catch (error) {
                    console.error('S3 delete error:', error);
                }
                // Delete local files if using local storage for temporary chunks
                const roomPath = path_1.default.join(uploadDir, currentRoom);
                fs_1.default.rmSync(roomPath, { recursive: true, force: true });
                delete rooms[currentRoom];
                console.log(`Room ${currentRoom} closed and files deleted`);
            }
            else {
                broadcast(currentRoom, JSON.stringify({ type: 'info', message: `User ${clientId} left the room` }));
            }
        }
    }));
});
function broadcast(room, message) {
    Object.values(rooms[room].clients).forEach(client => {
        client.ws.send(message);
    });
}
server.listen(8080, () => {
    console.log('WebSocket server is running on ws://localhost:8080');
});

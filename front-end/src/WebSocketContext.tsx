// WebSocketClient.tsx
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface Message {
    type: string;
    clientId?: string;
    message?: string;
    roomId?: string;
    link?: string;
    fileId?: string;
    fileName?: string;
    fileUrl?: string; // Add fileUrl field for S3 URLs
}

const WebSocketClient: React.FC = () => {
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [room, setRoom] = useState<string | null>(null);
    const [message, setMessage] = useState<string>('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [joinRoomId, setJoinRoomId] = useState<string>('');
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const fileReader = useRef<FileReader | null>(null);

    useEffect(() => {
        const socket = new WebSocket('ws://localhost:8080');
        setWs(socket);

        socket.onmessage = (event) => {
            const data: Message = JSON.parse(event.data);
            if (data.type === 'message' || data.type === 'info') {
                setMessages((prevMessages) => [...prevMessages, data]);
            } else if (data.type === 'room-created') {
                setRoom(data.roomId || null);
            } else if (data.type === 'file') {
                setMessages((prevMessages) => [...prevMessages, data]);
            }
        };

        return () => socket.close();
    }, []);

    const createRoom = () => {
        if (ws) {
            ws.send(JSON.stringify({ type: 'create-room' }));
        }
    };

    const joinRoom = () => {
        if (ws) {
            ws.send(JSON.stringify({ type: 'join', room: joinRoomId }));
            setRoom(joinRoomId);
        }
    };

    const sendMessage = () => {
        if (ws && room) {
            ws.send(JSON.stringify({ type: 'message', message }));
            setMessage('');
        }
    };

    const handleFileUpload = () => {
        if (ws && room && file) {
            setIsUploading(true);
            const fileId = uuidv4();
            const CHUNK_SIZE = 64 * 1024; // 64KB
            let offset = 0;

            ws.send(JSON.stringify({ type: 'file-start', fileId, fileName: file.name }));

            const readSlice = () => {
                const slice = file.slice(offset, offset + CHUNK_SIZE);
                fileReader.current!.readAsArrayBuffer(slice);
            };

            fileReader.current = new FileReader();
            fileReader.current.onload = (e) => {
                ws.send(JSON.stringify({ type: 'file-chunk', fileId, chunk: Array.from(new Uint8Array(e.target!.result as ArrayBuffer)) }));

                offset += CHUNK_SIZE;
                if (offset < file.size) {
                    readSlice();
                } else {
                    ws.send(JSON.stringify({ type: 'file-end', fileId }));
                    setIsUploading(false);
                }
            };

            readSlice();
        }
    };

    const handleFileDownload = (fileUrl: string, fileName: string) => {
        window.open(fileUrl, '_blank');
    };

    const copyToClipboard = () => {
        if (room) {
            navigator.clipboard.writeText(room);
        }
    };

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-3xl font-bold mb-6 text-center">WebSocket Client</h1>
            {!room ? (
                <div className="flex flex-col space-y-6">
                    <div className="flex items-center justify-center space-x-2">
                        <button
                            onClick={createRoom}
                            className="bg-blue-500 text-white p-2 rounded hover:bg-blue-600 transition duration-200"
                        >
                            Create Room
                        </button>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={joinRoomId}
                            onChange={(e) => setJoinRoomId(e.target.value)}
                            placeholder="Join Room ID"
                            className="p-2 border rounded w-full focus:outline-none focus:ring focus:border-green-300"
                        />
                        <button
                            onClick={joinRoom}
                            className="bg-green-500 text-white p-2 rounded hover:bg-green-600 transition duration-200"
                        >
                            Join Room
                        </button>
                    </div>
                </div>
            ) : (
                <div>
                    <h2 className="text-xl font-semibold mb-4 text-center">Room: {room}</h2>
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={copyToClipboard}
                            className="bg-gray-500 text-white p-2 rounded hover:bg-gray-600 transition duration-200"
                        >
                            Copy Room ID
                        </button>
                    </div>
                    <div className="flex space-x-2 mb-4">
                        <input
                            type="text"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Type a message"
                            className="p-2 border rounded w-full focus:outline-none focus:ring focus:border-blue-300"
                        />
                        <button
                            onClick={sendMessage}
                            className="bg-blue-500 text-white p-2 rounded hover:bg-blue-600 transition duration-200"
                        >
                            Send
                        </button>
                    </div>
                    <div className="flex space-x-2 mb-4">
                        <input
                            type="file"
                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                            className="p-2 border rounded"
                        />
                        <button
                            onClick={handleFileUpload}
                            className={`bg-purple-500 text-white p-2 rounded hover:bg-purple-600 transition duration-200 ${isUploading ? 'cursor-not-allowed opacity-50' : ''}`}
                            disabled={isUploading}
                        >
                            {isUploading ? 'Uploading...' : 'Upload File'}
                        </button>
                    </div>
                    <div className="space-y-4">
                        {messages.map((msg, index) => (
                            <div key={index} className="border-b py-2">
                                {msg.type === 'file' ? (
                                    <div className="flex items-center space-x-2">
                                        <strong>{msg.clientId}</strong>: {msg.fileName}
                                        <button
                                            onClick={() => handleFileDownload(msg.fileUrl!, msg.fileName!)}
                                            className="bg-yellow-500 text-white p-1 rounded hover:bg-yellow-600 transition duration-200"
                                        >
                                            Download
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <strong>{msg.clientId}</strong>: {msg.message}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WebSocketClient;

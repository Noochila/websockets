// src/App.tsx
import React from 'react';
import WebSocketClient from './WebSocketContext';

const App: React.FC = () => {
    return (
        <div className="App">
            <WebSocketClient />
        </div>
    );
};

export default App;

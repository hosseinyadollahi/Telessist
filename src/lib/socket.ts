import { io, Socket } from 'socket.io-client';

// Determine the URL based on environment
// In development with Vite proxy, it's relative. In production, it points to the server.
const SOCKET_URL = '/api/chat'; 

// We use a specific path if configured in Nginx/Express, default is socket.io
export const socket: Socket = io({
  path: '/socket.io', // Ensure this matches server config
  autoConnect: false,
  reconnection: true,
  transports: ['websocket', 'polling']
});

export const connectSocket = () => {
    if (!socket.connected) {
        socket.connect();
    }
    return socket;
};
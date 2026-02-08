import { io, Socket } from 'socket.io-client';

// When using Vite proxy (or Nginx in prod), we connect to the relative path.
// The proxy handles forwarding to port 3002 or 3001.
// We explicitly DO NOT set a hostname here to avoid connecting to wrong domains.
export const socket: Socket = io({
  path: '/socket.io',
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  transports: ['websocket', 'polling']
});

export const connectSocket = () => {
    console.log("[Socket] Connecting...");
    if (!socket.connected) {
        socket.connect();
    }
    return socket;
};

// Debug listeners
socket.on('connect', () => {
    console.log(`[Socket] Connected to backend with ID: ${socket.id}`);
});

socket.on('connect_error', (err) => {
    console.error(`[Socket] Connection Error:`, err.message);
});
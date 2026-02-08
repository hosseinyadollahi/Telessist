import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { query } from '../shared/db.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

// Logger Middleware
app.use((req, res, next) => {
    console.log(`[CHAT-API] ${req.method} ${req.url}`);
    next();
});

// Socket.io Setup
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Adjust in production
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`[SOCKET] New Connection: ${socket.id}`);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`[SOCKET] ${socket.id} joined room: ${chatId}`);
    // Optional: Log how many users are in the room
    const roomSize = io.sockets.adapter.rooms.get(chatId)?.size || 0;
    console.log(`[SOCKET] Room ${chatId} now has ${roomSize} participants`);
  });

  socket.on('send_message', (data) => {
    console.log(`[SOCKET] Message Received from ${socket.id}:`, data);
    
    // Save to DB here using 'query'
    // Example: await query('INSERT INTO messages ...');
    
    // Broadcast to specific room
    if (data.chatId) {
        io.to(data.chatId).emit('receive_message', data);
        console.log(`[SOCKET] Message broadcasted to room: ${data.chatId}`);
    } else {
        console.warn(`[SOCKET] Message ignored: No chatId provided in payload`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] Disconnected: ${socket.id} | Reason: ${reason}`);
  });
  
  socket.on('error', (err) => {
      console.error(`[SOCKET] Error on ${socket.id}:`, err);
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service is running', service: 'chat-service' });
});

httpServer.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`[CHAT-SERVICE] Running on port ${PORT}`);
  console.log(`==========================================`);
});
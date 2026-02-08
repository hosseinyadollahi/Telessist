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

// Socket.io Setup
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Adjust in production
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`Socket ${socket.id} joined chat ${chatId}`);
  });

  socket.on('send_message', (data) => {
    // Save to DB here using 'query'
    console.log('Message received:', data);
    
    // Broadcast to specific room
    io.to(data.chatId).emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service is running', service: 'chat-service' });
});

httpServer.listen(PORT, () => {
  console.log(`Chat Service running on port ${PORT}`);
});
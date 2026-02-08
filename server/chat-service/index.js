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

app.use((req, res, next) => {
    console.log(`[CHAT-API] ${req.method} ${req.url}`);
    next();
});

const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`\x1b[32m[SOCKET]\x1b[0m New Connection: ${socket.id}`);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`\x1b[36m[SOCKET]\x1b[0m ${socket.id} joined room: ${chatId}`);
  });

  socket.on('send_message', (data) => {
    console.log(`\x1b[33m[SOCKET]\x1b[0m Message from ${socket.id}:`, JSON.stringify(data));
    
    if (data.chatId) {
        io.to(data.chatId).emit('receive_message', data);
        console.log(`\x1b[32m[SOCKET]\x1b[0m Broadcasted to room: ${data.chatId}`);
    } else {
        console.warn(`\x1b[31m[SOCKET]\x1b[0m Message ignored: No chatId`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`\x1b[31m[SOCKET]\x1b[0m Disconnected: ${socket.id} | Reason: ${reason}`);
  });
  
  socket.on('error', (err) => {
      console.error(`\x1b[41m[SOCKET ERROR]\x1b[0m on ${socket.id}:`, err);
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service is running', service: 'chat-service' });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
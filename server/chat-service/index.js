import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from 'telegram';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Store clients in memory: Map<SocketID, TelegramClient>
// In a real production scale app, you'd manage these differently (e.g. separate worker processes)
const clients = new Map();

io.on('connection', (socket) => {
  console.log(`[SOCKET] New Client Connected: ${socket.id}`);

  // --- 1. INITIALIZE CLIENT ---
  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      console.log(`[${socket.id}] Initializing Telegram Client...`);
      try {
          const stringSession = new StringSession(session || "");
          const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
              connectionRetries: 5,
              useWSS: false, // Node.js environments use raw TCP usually, or HTTP
              deviceModel: "Telegram Web Server",
              systemVersion: "1.0.0",
              appVersion: "1.0.0",
          });

          // Connect
          await client.connect();
          
          clients.set(socket.id, client);
          
          // Return the updated session string if it changed (e.g. after login)
          const currentSession = client.session.save();
          
          // Check if authorized
          const isAuth = await client.isUserAuthorized();

          let me = null;
          if(isAuth) {
             const user = await client.getMe();
             // Serialize User
             me = {
                 id: user.id.toString(),
                 username: user.username,
                 firstName: user.firstName,
                 phone: user.phone
             };
          }

          socket.emit('telegram_init_success', { 
              session: currentSession,
              isAuth: isAuth,
              user: me
          });
          console.log(`[${socket.id}] Client initialized. Auth: ${isAuth}`);

      } catch (err) {
          console.error(`[${socket.id}] Init Error:`, err);
          socket.emit('telegram_error', { method: 'init', error: err.message });
      }
  });

  // --- 2. AUTH FLOW ---
  socket.on('telegram_send_code', async ({ phone }) => {
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          const { phoneCodeHash } = await client.sendCode({
              apiId: client.apiId,
              apiHash: client.apiHash,
          }, phone);
          socket.emit('telegram_send_code_success', { phoneCodeHash });
      } catch (err) {
          socket.emit('telegram_error', { method: 'sendCode', error: err.message });
      }
  });

  socket.on('telegram_login', async ({ phone, code, phoneCodeHash, password }) => {
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          await client.invoke(new Api.auth.SignIn({
              phoneNumber: phone,
              phoneCodeHash: phoneCodeHash,
              phoneCode: code
          }));
          
          // Save session
          const session = client.session.save();
          socket.emit('telegram_login_success', { session });
      } catch (err) {
          if (err.message && err.message.includes("SESSION_PASSWORD_NEEDED")) {
              if (password) {
                  try {
                      await client.signIn({ password, phoneNumber: phone, phoneCodeHash, phoneCode: code });
                       const session = client.session.save();
                       socket.emit('telegram_login_success', { session });
                       return;
                  } catch (pwErr) {
                       socket.emit('telegram_error', { method: 'login_password', error: pwErr.message });
                       return;
                  }
              }
              socket.emit('telegram_password_needed');
          } else {
              socket.emit('telegram_error', { method: 'login', error: err.message });
          }
      }
  });

  // --- 3. DATA FETCHING ---
  socket.on('telegram_get_dialogs', async () => {
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          const dialogs = await client.getDialogs({ limit: 20 });
          // Serialize for frontend
          const serialized = dialogs.map(d => ({
             id: d.id ? d.id.toString() : '0',
             title: d.title,
             date: d.date,
             unreadCount: d.unreadCount,
             message: d.message ? { message: d.message.message, date: d.message.date } : null,
             isGroup: d.isGroup,
             isUser: d.isUser,
             entityId: d.entity ? d.entity.id.toString() : null // Use this for sending messages
          }));
          socket.emit('telegram_dialogs_data', serialized);
      } catch (err) {
          console.error(err);
          socket.emit('telegram_error', { method: 'getDialogs', error: err.message });
      }
  });

  socket.on('telegram_get_messages', async ({ chatId }) => {
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          // chatId usually needs to be BigInt or Entity for GramJS
          // We accept string from frontend and convert
          const msgs = await client.getMessages(chatId, { limit: 50 });
          const serialized = msgs.map(m => ({
              id: m.id,
              message: m.message,
              date: m.date,
              out: m.out,
              senderId: m.senderId ? m.senderId.toString() : null
          }));
          socket.emit('telegram_messages_data', serialized);
      } catch (err) {
          console.error(err);
          socket.emit('telegram_error', { method: 'getMessages', error: err.message });
      }
  });

  socket.on('telegram_send_message', async ({ chatId, message }) => {
       const client = clients.get(socket.id);
       if(!client) return;
       try {
           await client.sendMessage(chatId, { message });
           socket.emit('telegram_message_sent');
           // Optionally trigger a refresh of messages
       } catch (err) {
           socket.emit('telegram_error', { method: 'sendMessage', error: err.message });
       }
  });

  socket.on('disconnect', () => {
      console.log(`[SOCKET] Client Disconnected: ${socket.id}`);
      const client = clients.get(socket.id);
      if (client) {
          client.disconnect();
          clients.delete(socket.id);
      }
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service (Telegram Proxy) is running', service: 'chat-service' });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
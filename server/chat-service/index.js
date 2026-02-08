import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { TelegramClient } from "telegram";
// FIX: Append /index.js to resolve the directory import error in Node ESM
import { StringSession } from "telegram/sessions/index.js";
import { Api } from 'telegram';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST"]
}));
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const clients = new Map();

io.on('connection', (socket) => {
  console.log(`[SOCKET] New Client Connected: ${socket.id}`);

  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      console.log(`[${socket.id}] Request: telegram_init`);
      try {
          // If session is empty string, pass empty string to StringSession
          const stringSession = new StringSession(session || "");
          
          console.log(`[${socket.id}] Creating backend Telegram Client (Finland)...`);
          const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
              connectionRetries: 5,
              useWSS: false, // Server-side: Use direct TCP
              deviceModel: "Telegram Web Server",
              systemVersion: "Linux",
              appVersion: "1.0.0",
          });

          // --- FIX: SANITIZE SESSION ADDRESS ---
          // Browser sessions might contain proxy URLs (like telessist.omniday.io).
          // We are in Node.js, we must connect directly to Telegram IPs.
          if (client.session.serverAddress && client.session.serverAddress.includes('omniday')) {
              console.warn(`[${socket.id}] ⚠️ Sanitizing session: Removing proxy address '${client.session.serverAddress}' to force direct connection.`);
              client.session.serverAddress = undefined;
              client.session.port = undefined; 
          }
          // -------------------------------------

          await client.connect();
          clients.set(socket.id, client);
          
          const currentSession = client.session.save();
          const isAuth = await client.isUserAuthorized();
          
          let me = null;
          if(isAuth) {
             const user = await client.getMe();
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
          console.log(`[${socket.id}] Init Success. Auth: ${isAuth}`);

      } catch (err) {
          console.error(`[${socket.id}] Init Error:`, err);
          // Special handling for connection errors
          let errorMsg = err.message;
          if (errorMsg.includes("Connection")) {
              errorMsg = "Connection to Telegram failed. Please check server internet or VPN.";
          }
          socket.emit('telegram_error', { method: 'init', error: errorMsg });
      }
  });

  socket.on('telegram_send_code', async ({ phone }) => {
      console.log(`[${socket.id}] Request: send_code to ${phone}`);
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          const { phoneCodeHash } = await client.sendCode({
              apiId: client.apiId,
              apiHash: client.apiHash,
          }, phone);
          socket.emit('telegram_send_code_success', { phoneCodeHash });
      } catch (err) {
          console.error(`[${socket.id}] Send Code Error:`, err);
          socket.emit('telegram_error', { method: 'sendCode', error: err.message });
      }
  });

  socket.on('telegram_login', async ({ phone, code, phoneCodeHash, password }) => {
      console.log(`[${socket.id}] Request: login`);
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          await client.invoke(new Api.auth.SignIn({
              phoneNumber: phone,
              phoneCodeHash: phoneCodeHash,
              phoneCode: code
          }));
          
          const session = client.session.save();
          socket.emit('telegram_login_success', { session });
      } catch (err) {
          console.error(`[${socket.id}] Login Error:`, err.message);
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

  socket.on('telegram_get_dialogs', async () => {
      const client = clients.get(socket.id);
      if(!client) return;
      try {
          const dialogs = await client.getDialogs({ limit: 20 });
          const serialized = dialogs.map(d => ({
             id: d.id ? d.id.toString() : '0',
             title: d.title,
             date: d.date,
             unreadCount: d.unreadCount,
             message: d.message ? { message: d.message.message, date: d.message.date } : null,
             isGroup: d.isGroup,
             isUser: d.isUser,
             entityId: d.entity ? d.entity.id.toString() : null
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
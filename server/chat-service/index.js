import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { TelegramClient } from "telegram";
// FIX: Append /index.js to resolve the directory import error in Node ESM
import { StringSession } from "telegram/sessions/index.js";
import { Api } from 'telegram';
import { RPCError } from 'telegram/errors/index.js';

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
          // Parse the session
          let stringSession = new StringSession(session || "");
          
          console.log(`[${socket.id}] Incoming Session -> DC: ${stringSession.dcId || 'New'}, Addr: ${stringSession.serverAddress || 'None'}`);

          // --- 1. SANITIZE SESSION ---
          if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
              console.warn(`[${socket.id}] ⚠️ Sanitizing session: Discarding proxy address.`);
              stringSession = new StringSession(""); 
          }
          
          // --- 2. FORCE SPECIFIC IP CONFIGURATION (User Request) ---
          // IP: 149.154.167.50, Port: 443, DC: 2
          // We enforce this if:
          // a) It's a new session (serverAddress is empty)
          // b) The session is already on DC 2 (we update IP to the preferred one)
          if (!stringSession.serverAddress || stringSession.dcId === 2) {
               console.log(`[${socket.id}] ⚡ Enforcing Direct Connection to DC 2: 149.154.167.50:443`);
               stringSession.setDC(2, "149.154.167.50", 443);
          } else {
               console.log(`[${socket.id}] ℹ️ Session is on DC ${stringSession.dcId} (${stringSession.serverAddress}). Keeping existing DC.`);
          }
          // -------------------------------------
          
          console.log(`[${socket.id}] Creating backend Telegram Client...`);
          const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
              connectionRetries: 5,
              useWSS: false, // FORCE TCP (MTProto)
              deviceModel: "Telegram Web Server",
              systemVersion: "Linux",
              appVersion: "1.0.0",
          });

          // Set log level to debug to see migration details in console
          client.setLogLevel("info");
          
          console.log(`[${socket.id}] Connecting to: ${client.session.serverAddress}:${client.session.port} (DC ${client.session.dcId})`);

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
          let errorMsg = err.message;
          if (errorMsg && errorMsg.includes("Connection")) {
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
          console.log(`[${socket.id}] Send Code Success. Hash: ${phoneCodeHash}`);
          socket.emit('telegram_send_code_success', { phoneCodeHash });
      } catch (err) {
          console.error(`[${socket.id}] Send Code Error:`, err);
          
          // --- MANUAL MIGRATION HANDLING ---
          // If we get a migration error, it means the library is trying to move to another DC.
          // GramJS usually handles this, but if it picks a blocked IP, we want to intervene.
          // Note: client.sendCode usually catches this internally. If it Bubbles up here, it failed hard.
          
          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
              const newDcId = Number(err.errorMessage.split('_')[2]);
              console.log(`[${socket.id}] ⚠️ PHONE_MIGRATE detected to DC ${newDcId}. Forcing IP override...`);
              
              if (newDcId === 2) {
                   console.log(`[${socket.id}] ⚡ Switching to DC 2 with Forced IP: 149.154.167.50:443`);
                   client.session.setDC(2, "149.154.167.50", 443);
                   
                   // Reconnect with new settings
                   await client.disconnect();
                   await client.connect();
                   
                   // Retry sending code
                   try {
                        const { phoneCodeHash } = await client.sendCode({
                            apiId: client.apiId,
                            apiHash: client.apiHash,
                        }, phone);
                        console.log(`[${socket.id}] Retry Send Code Success.`);
                        socket.emit('telegram_send_code_success', { phoneCodeHash });
                        return;
                   } catch (retryErr) {
                        console.error(`[${socket.id}] Retry Failed:`, retryErr);
                        socket.emit('telegram_error', { method: 'sendCode', error: retryErr.message });
                        return;
                   }
              }
          }

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
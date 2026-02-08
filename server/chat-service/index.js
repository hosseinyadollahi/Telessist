import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from 'telegram';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- SESSION MANAGEMENT ---
// Map<deviceSessionId, { client: TelegramClient, cleanup: NodeJS.Timeout }>
const activeSessions = new Map();
// Map<socketId, deviceSessionId>
const socketMap = new Map();

// Helper to create a client instance
const createTelegramClient = async (sessionStr, apiId, apiHash) => {
    let stringSession = new StringSession(sessionStr || "");
    
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }

    // Force DC 2 (Europe/Global) for empty sessions
    if (!sessionStr) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }

    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, 
        deviceModel: "Telegram Web Clone",
        systemVersion: "Linux",
        appVersion: "1.0.0",
        timeout: 30, 
    });
    
    client.setLogLevel("error");
    
    await client.connect();
    return client;
};

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  // Retrieve the client based on the socket's mapped session ID
  const getClient = () => {
      const sessionId = socketMap.get(socket.id);
      if (!sessionId) return null;
      return activeSessions.get(sessionId)?.client;
  };

  socket.on('telegram_init', async ({ apiId, apiHash, session, deviceSessionId }) => {
      if (!deviceSessionId) {
          return socket.emit('telegram_error', { method: 'init', error: "Missing deviceSessionId" });
      }

      console.log(`[${socket.id}] Init for Session: ${deviceSessionId}`);
      
      // Map this socket to the device session
      socketMap.set(socket.id, deviceSessionId);

      try {
          let client;
          
          if (activeSessions.has(deviceSessionId)) {
              console.log(`[${socket.id}] ♻️ Restoring active session ${deviceSessionId}`);
              const sessionData = activeSessions.get(deviceSessionId);
              
              // Cancel any pending cleanup (user reconnected!)
              if (sessionData.cleanup) {
                  clearTimeout(sessionData.cleanup);
                  sessionData.cleanup = null;
              }
              
              client = sessionData.client;
          } else {
              console.log(`[${socket.id}] ✨ Creating NEW session ${deviceSessionId}`);
              client = await createTelegramClient(session, apiId, apiHash);
              activeSessions.set(deviceSessionId, { client, cleanup: null });
          }

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
              session: client.session.save(),
              isAuth,
              user: me
          });
      } catch (err) {
          console.error(`[${socket.id}] Init Error:`, err.message);
          socket.emit('telegram_error', { method: 'init', error: err.message });
      }
  });

  socket.on('telegram_send_code', async ({ phone }) => {
      const client = getClient();
      if(!client) return socket.emit('telegram_error', { error: "Session expired or not initialized" });

      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      console.log(`[${socket.id}] Sending code to ${phoneClean}...`);

      try {
          const { phoneCodeHash } = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          console.log(`[${socket.id}] Code sent.`);
          socket.emit('telegram_send_code_success', { phoneCodeHash });

      } catch (err) {
          console.error(`[${socket.id}] Send Code Error: ${err.message}`);

          // DC Migration
          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
              const targetDC = Number(err.errorMessage.split('_')[2]);
              console.log(`[${socket.id}] ⚠️ Migration required to DC ${targetDC}`);

              const sessionId = socketMap.get(socket.id);
              if (sessionId && activeSessions.has(sessionId)) {
                  const oldClient = activeSessions.get(sessionId).client;
                  const apiId = oldClient.apiId;
                  const apiHash = oldClient.apiHash;

                  // Disconnect old
                  await oldClient.disconnect();
                  activeSessions.delete(sessionId);

                  // Create new with correct DC
                  const newSession = new StringSession("");
                  let ip = "149.154.167.50"; 
                  if (targetDC === 1) ip = "149.154.175.53";
                  if (targetDC === 4) ip = "149.154.167.91";
                  if (targetDC === 5) ip = "91.108.56.130";
                  newSession.setDC(targetDC, ip, 443);

                  const newClient = new TelegramClient(newSession, apiId, apiHash, {
                      connectionRetries: 5,
                      useWSS: false,
                      deviceModel: "Telegram Web Clone",
                  });
                  newClient.setLogLevel("error");
                  await newClient.connect();
                  
                  // Store under SAME session ID
                  activeSessions.set(sessionId, { client: newClient, cleanup: null });
                  
                  socket.emit('telegram_error', { 
                      method: 'sendCode', 
                      error: "Optimized connection. Please click Next again." 
                  });
                  return;
              }
          }

          socket.emit('telegram_error', { method: 'sendCode', error: err.message || "Failed to send code" });
      }
  });

  socket.on('telegram_login', async (payload) => {
      const client = getClient();
      if(!client) return socket.emit('telegram_error', { error: "Session expired" });

      const { code, phoneCodeHash, password } = payload;
      const rawPhone = payload.phone || payload.phoneNumber;
      const phoneClean = String(rawPhone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      
      console.log(`[${socket.id}] Logging in ${phoneClean}...`);

      try {
          if (code && phoneCodeHash) {
             await client.invoke(new Api.auth.SignIn({
                  phoneNumber: phoneClean,
                  phoneCodeHash: String(phoneCodeHash),
                  phoneCode: String(code)
              }));
          } else if (password) {
              await client.signIn({ password: String(password) });
          }

          socket.emit('telegram_login_success', { session: client.session.save() });

      } catch (err) {
          const msg = err.message || err.errorMessage || "Unknown Error";
          console.error(`[${socket.id}] Login Error:`, msg);
          
          if (msg.includes("SESSION_PASSWORD_NEEDED")) {
               socket.emit('telegram_error', { method: 'login', error: "SESSION_PASSWORD_NEEDED" }); 
          } else if (msg.includes("PHONE_CODE_EXPIRED")) {
              socket.emit('telegram_error', { method: 'login', error: "Code expired. Please restart." });
          } else {
              socket.emit('telegram_error', { method: 'login', error: msg });
          }
      }
  });

  socket.on('telegram_get_dialogs', async () => {
      const client = getClient();
      if(!client) return;
      try {
          const dialogs = await client.getDialogs({ limit: 20 });
          const serialized = dialogs.map(d => ({
             id: d.id ? d.id.toString() : '0',
             title: d.title,
             date: d.date,
             unreadCount: d.unreadCount,
             message: d.message ? { message: d.message.message, date: d.message.date } : null,
             entityId: d.entity ? d.entity.id.toString() : null
          }));
          socket.emit('telegram_dialogs_data', serialized);
      } catch (err) {
          if (!err.message.includes('TIMEOUT')) {
             socket.emit('telegram_error', { method: 'getDialogs', error: err.message });
          }
      }
  });

  socket.on('telegram_get_messages', async ({ chatId }) => {
      const client = getClient();
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
          if (!err.message.includes('TIMEOUT')) {
            socket.emit('telegram_error', { method: 'getMessages', error: err.message });
          }
      }
  });

  socket.on('telegram_send_message', async ({ chatId, message }) => {
       const client = getClient();
       if(!client) return;
       try {
           await client.sendMessage(chatId, { message });
           socket.emit('telegram_message_sent');
       } catch (err) {
           socket.emit('telegram_error', { method: 'sendMessage', error: err.message });
       }
  });

  socket.on('disconnect', () => {
      const sessionId = socketMap.get(socket.id);
      console.log(`[SOCKET] Disconnected: ${socket.id} (Session: ${sessionId || 'None'})`);
      
      if (sessionId && activeSessions.has(sessionId)) {
          const sessionData = activeSessions.get(sessionId);
          
          // Set a cleanup timeout (e.g., 2 minutes)
          // This keeps the Telegram connection alive even if the user refreshes or internet blips
          sessionData.cleanup = setTimeout(() => {
              console.log(`[CLEANUP] Destroying inactive session ${sessionId}`);
              if (sessionData.client) {
                  sessionData.client.disconnect().catch(() => {});
              }
              activeSessions.delete(sessionId);
          }, 120000); 
      }
      
      socketMap.delete(socket.id);
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service Running', active_sessions: activeSessions.size });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
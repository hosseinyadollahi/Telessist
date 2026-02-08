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

const clients = new Map();

// Helper to create a client instance
const createTelegramClient = async (sessionStr, apiId, apiHash) => {
    let stringSession = new StringSession(sessionStr || "");
    
    // Clean weird session strings if any
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }

    // Force DC 2 (Europe/Global) for empty sessions to reduce migration errors
    if (!sessionStr) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }
    if (stringSession.dcId === 2) {
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

  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      try {
          // --- IDEMPOTENCY FIX ---
          // Prevent re-initialization if the client exists and matches the API ID.
          // This stops the session from being reset mid-login (which causes PHONE_CODE_INVALID).
          if (clients.has(socket.id)) {
              const existingClient = clients.get(socket.id);
              
              // If connected and API ID matches, reuse this client!
              if (existingClient.connected && Number(existingClient.apiId) === Number(apiId)) {
                  console.log(`[${socket.id}] ♻️ Client already active. Reusing existing connection.`);
                  
                  const isAuth = await existingClient.isUserAuthorized();
                  let me = null;
                  if(isAuth) {
                      const user = await existingClient.getMe();
                      me = {
                          id: user.id.toString(),
                          username: user.username,
                          firstName: user.firstName,
                          phone: user.phone
                      };
                  }
                  
                  // Return the CURRENT server session
                  socket.emit('telegram_init_success', { 
                      session: existingClient.session.save(),
                      isAuth,
                      user: me
                  });
                  return; 
              }
              
              // If different API ID, we must disconnect old and create new
              console.log(`[${socket.id}] 🔄 Config changed. Re-initializing...`);
              try { await existingClient.disconnect(); } catch(e){}
              clients.delete(socket.id);
          } else {
              console.log(`[${socket.id}] ✨ Creating new Telegram Client...`);
          }

          const client = await createTelegramClient(session, apiId, apiHash);
          clients.set(socket.id, client);

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
      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      console.log(`[${socket.id}] Sending code to ${phoneClean}...`);

      let client = clients.get(socket.id);
      if(!client) return socket.emit('telegram_error', { error: "Client not initialized" });

      try {
          const { phoneCodeHash } = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          console.log(`[${socket.id}] Code sent. Hash: ${phoneCodeHash.substring(0, 10)}...`);
          socket.emit('telegram_send_code_success', { phoneCodeHash });

      } catch (err) {
          console.error(`[${socket.id}] Send Code Error: ${err.message}`);

          // Auto-handle DC Migration
          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
              const targetDC = Number(err.errorMessage.split('_')[2]);
              console.log(`[${socket.id}] ⚠️ Migration required to DC ${targetDC}. Switching...`);

              try {
                  const apiId = Number(client.apiId);
                  const apiHash = String(client.apiHash);
                  
                  await client.disconnect();
                  clients.delete(socket.id);

                  const newSession = new StringSession("");
                  let ip = "149.154.167.50"; // DC 2
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
                  clients.set(socket.id, newClient);
                  
                  // Tell frontend to retry user action manually (safer)
                  socket.emit('telegram_init_success', { 
                      session: newClient.session.save(), 
                      isAuth: false, 
                      user: null 
                  });
                  
                  socket.emit('telegram_error', { 
                      method: 'sendCode', 
                      error: "Optimized connection. Please click Next again." 
                  });
                  return;

              } catch (migErr) {
                  console.error("Migration failed", migErr);
                  socket.emit('telegram_error', { method: 'sendCode', error: "Migration failed." });
                  return;
              }
          }

          socket.emit('telegram_error', { method: 'sendCode', error: err.message || "Failed to send code" });
      }
  });

  socket.on('telegram_login', async (payload) => {
      const client = clients.get(socket.id);
      if(!client) {
          console.error(`[${socket.id}] Login attempted without initialized client.`);
          return socket.emit('telegram_error', { method: 'login', error: "Session lost. Please reload." });
      }
      
      const { code, phoneCodeHash, password } = payload;
      const rawPhone = payload.phone || payload.phoneNumber;
      const phoneClean = String(rawPhone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      
      console.log(`[${socket.id}] Logging in ${phoneClean} with hash ${phoneCodeHash ? phoneCodeHash.substring(0,5) : 'N/A'}...`);

      try {
          // Standard Login
          if (code && phoneCodeHash) {
             await client.invoke(new Api.auth.SignIn({
                  phoneNumber: phoneClean,
                  phoneCodeHash: String(phoneCodeHash),
                  phoneCode: String(code)
              }));
          } 
          // 2FA Password Login
          else if (password) {
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
          if (!err.message.includes('TIMEOUT')) {
            socket.emit('telegram_error', { method: 'getMessages', error: err.message });
          }
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
      console.log(`[SOCKET] Disconnected: ${socket.id}`);
      // Don't immediately destroy client to allow for quick re-connects (optional optimization)
      if (clients.has(socket.id)) {
          const client = clients.get(socket.id);
          clients.delete(socket.id);
          client.disconnect().catch(() => {});
      }
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service Running', ip_config: 'Optimized DC 2' });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
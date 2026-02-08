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
    
    // Clean weird session strings
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }

    // OPTIMIZATION: If session is empty, FORCE DC 2 (Europe/Global) by default.
    // Most users (including +49 numbers) are on DC 2. This prevents the initial migration delay/error.
    if (!sessionStr) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }

    // Always prefer DC 2 IP if we are on DC 2
    if (stringSession.dcId === 2) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }

    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, // Force TCP
        deviceModel: "Telegram Web Server",
        systemVersion: "Linux",
        appVersion: "1.0.0",
        timeout: 30, // Moderate timeout
    });
    
    // Suppress verbose logs unless error
    client.setLogLevel("error");
    
    await client.connect();
    return client;
};

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      try {
          console.log(`[${socket.id}] Init Client...`);
          if (clients.has(socket.id)) {
              // Try to graceful disconnect, but ignore errors
              try { await clients.get(socket.id).disconnect(); } catch(e){}
              clients.delete(socket.id);
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
      // Clean phone number
      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      console.log(`[${socket.id}] Sending code to ${phoneClean}...`);

      let client = clients.get(socket.id);
      if(!client) return socket.emit('telegram_error', { error: "Client not initialized" });

      try {
          // DIRECT CALL - NO TIMEOUT WRAPPER, NO AUTO-RETRY
          // This prevents sending 2 codes and expiring the first one.
          const { phoneCodeHash } = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          socket.emit('telegram_send_code_success', { phoneCodeHash });

      } catch (err) {
          console.error(`[${socket.id}] Send Code Error: ${err.message}`);

          // Handle Migration Error Explicitly
          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
              const targetDC = Number(err.errorMessage.split('_')[2]);
              console.log(`[${socket.id}] ⚠️ Account requires DC ${targetDC}. Switching...`);

              try {
                  const apiId = Number(client.apiId);
                  const apiHash = String(client.apiHash);
                  
                  // Disconnect old
                  await client.disconnect();
                  clients.delete(socket.id);

                  // Create New Session on correct DC
                  const newSession = new StringSession("");
                  // Map common IPs (Simplified)
                  let ip = "149.154.167.50"; // DC 2
                  if (targetDC === 1) ip = "149.154.175.53";
                  if (targetDC === 4) ip = "149.154.167.91";
                  if (targetDC === 5) ip = "91.108.56.130";
                  
                  newSession.setDC(targetDC, ip, 443);

                  const newClient = new TelegramClient(newSession, apiId, apiHash, {
                      connectionRetries: 5,
                      useWSS: false,
                      deviceModel: "Telegram Web Server", 
                      appVersion: "1.0.0"
                  });
                  
                  newClient.setLogLevel("error");
                  await newClient.connect();
                  clients.set(socket.id, newClient);

                  // Update frontend session but DO NOT RESEND CODE AUTOMATICALLY.
                  // Resending automatically is what causes "PHONE_CODE_EXPIRED".
                  // We ask the user to click "Next" again.
                  socket.emit('telegram_init_success', { 
                      session: newClient.session.save(), 
                      isAuth: false, 
                      user: null 
                  });
                  
                  socket.emit('telegram_error', { 
                      method: 'sendCode', 
                      error: "Connection optimized for your region. Please click 'Next' again." 
                  });
                  return;

              } catch (migErr) {
                  console.error("Migration switch failed", migErr);
                  socket.emit('telegram_error', { method: 'sendCode', error: "Could not switch data center." });
                  return;
              }
          }

          socket.emit('telegram_error', { method: 'sendCode', error: err.message || "Failed to send code" });
      }
  });

  socket.on('telegram_login', async (payload) => {
      const client = clients.get(socket.id);
      if(!client) return;
      
      const { code, phoneCodeHash, password } = payload;
      const rawPhone = payload.phone || payload.phoneNumber;
      const phoneClean = String(rawPhone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      
      console.log(`[${socket.id}] Logging in with ${phoneClean}...`);

      try {
          await client.invoke(new Api.auth.SignIn({
              phoneNumber: phoneClean,
              phoneCodeHash: String(phoneCodeHash),
              phoneCode: String(code)
          }));
          
          socket.emit('telegram_login_success', { session: client.session.save() });

      } catch (err) {
          const msg = err.message || err.errorMessage || "Unknown Error";
          
          if (msg.includes("SESSION_PASSWORD_NEEDED")) {
              // Try high level sign in specifically for password flow triggers
               socket.emit('telegram_password_needed');
          } else if (msg.includes("PHONE_CODE_EXPIRED")) {
              socket.emit('telegram_error', { method: 'login', error: "The code expired. Please restart the login process." });
          } else {
              console.error(`[${socket.id}] Login Error:`, err);
              socket.emit('telegram_error', { method: 'login', error: msg });
          }
      }
  });

  socket.on('telegram_login_password', async ({ password }) => {
        const client = clients.get(socket.id);
        if(!client) return;

        try {
            await client.signIn({ password: String(password) });
            socket.emit('telegram_login_success', { session: client.session.save() });
        } catch(err) {
            socket.emit('telegram_error', { method: 'login_password', error: err.message || "Invalid Password" });
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
          // Ignore timeout errors in logs for getDialogs, they are just noise
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
      if (clients.has(socket.id)) {
          // Fire and forget disconnect
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
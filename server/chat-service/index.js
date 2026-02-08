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
    
    // Force clean session if it contains proxy junk
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }

    // Always prefer DC 2 IP if we are on DC 2 or if it's a fresh session (likely to be DC 2/4)
    // If it's DC 2, we HARDCODE the IP/Port.
    if (stringSession.dcId === 2) {
        console.log("⚡ enforcing DC 2 IP: 149.154.167.50:443");
        stringSession.setDC(2, "149.154.167.50", 443);
    }

    const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
        connectionRetries: 3,
        useWSS: false, // Force TCP
        deviceModel: "Telegram Web Server",
        systemVersion: "Linux",
        appVersion: "1.0.0",
    });
    
    // Silence verbose logs unless debugging
    client.setLogLevel("info");
    
    await client.connect();
    return client;
};

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      try {
          console.log(`[${socket.id}] Init Client...`);
          // Close existing if any
          if (clients.has(socket.id)) {
              await clients.get(socket.id).disconnect();
              clients.delete(socket.id);
          }

          const client = await createTelegramClient(session, apiId, apiHash);
          clients.set(socket.id, client);

          // Prepare response
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
      console.log(`[${socket.id}] Sending code to ${phone}...`);
      let client = clients.get(socket.id);
      if(!client) return socket.emit('telegram_error', { error: "Client not initialized" });

      try {
          const { phoneCodeHash } = await client.sendCode({
              apiId: client.apiId,
              apiHash: client.apiHash,
          }, phone);
          
          socket.emit('telegram_send_code_success', { phoneCodeHash });
      } catch (err) {
          console.error(`[${socket.id}] Send Code Error: ${err.message}`);

          // --- SIMPLIFIED MIGRATION HANDLING ---
          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
              const newDcId = Number(err.errorMessage.split('_')[2]);
              console.log(`[${socket.id}] ⚠️ Migration required to DC ${newDcId}`);

              if (newDcId === 2) {
                  try {
                      console.log(`[${socket.id}] 🔄 Re-creating client on DC 2 (149.154.167.50:443)...`);
                      
                      // 1. Save old API creds
                      const apiId = client.apiId;
                      const apiHash = client.apiHash;
                      
                      // 2. Kill old client
                      await client.disconnect();
                      clients.delete(socket.id);

                      // 3. Create NEW session pointing to DC 2
                      const newSession = new StringSession("");
                      newSession.setDC(2, "149.154.167.50", 443);

                      // 4. Create NEW client
                      const newClient = new TelegramClient(newSession, apiId, apiHash, {
                          connectionRetries: 3,
                          useWSS: false,
                          deviceModel: "Telegram Web Server", 
                          appVersion: "1.0.0"
                      });
                      
                      await newClient.connect();
                      clients.set(socket.id, newClient);
                      
                      // 5. Retry Send Code
                      console.log(`[${socket.id}] 🔄 Retrying sendCode on new DC...`);
                      const { phoneCodeHash } = await newClient.sendCode({ apiId, apiHash }, phone);
                      
                      // 6. Update frontend with new session immediately
                      socket.emit('telegram_init_success', { 
                          session: newClient.session.save(), 
                          isAuth: false, 
                          user: null 
                      });

                      socket.emit('telegram_send_code_success', { phoneCodeHash });
                      return; // Success!

                  } catch (migrationErr) {
                      console.error(`[${socket.id}] Migration Failed:`, migrationErr);
                      socket.emit('telegram_error', { method: 'sendCode', error: `Migration failed: ${migrationErr.message}` });
                      return;
                  }
              }
          }
          
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
          socket.emit('telegram_login_success', { session: client.session.save() });
      } catch (err) {
          if (err.message && err.message.includes("SESSION_PASSWORD_NEEDED")) {
              if (password) {
                  try {
                      await client.signIn({ password, phoneNumber: phone, phoneCodeHash, phoneCode: code });
                      socket.emit('telegram_login_success', { session: client.session.save() });
                  } catch (pwErr) {
                      socket.emit('telegram_error', { method: 'login_password', error: pwErr.message });
                  }
              } else {
                  socket.emit('telegram_password_needed');
              }
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
             entityId: d.entity ? d.entity.id.toString() : null
          }));
          socket.emit('telegram_dialogs_data', serialized);
      } catch (err) {
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
      console.log(`[SOCKET] Disconnected: ${socket.id}`);
      if (clients.has(socket.id)) {
          clients.get(socket.id).disconnect();
          clients.delete(socket.id);
      }
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service Running', ip_config: 'DC2 -> 149.154.167.50:443' });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
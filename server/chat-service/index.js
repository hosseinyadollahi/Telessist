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
    
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }

    // Always prefer DC 2 IP if we are on DC 2
    if (stringSession.dcId === 2) {
        console.log("⚡ enforcing DC 2 IP: 149.154.167.50:443");
        stringSession.setDC(2, "149.154.167.50", 443);
    }

    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5, // Increased retries
        useWSS: false, // Force TCP
        deviceModel: "Telegram Web Server",
        systemVersion: "Linux",
        appVersion: "1.0.0",
    });
    
    client.setLogLevel("info");
    
    await client.connect();
    return client;
};

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  socket.on('telegram_init', async ({ apiId, apiHash, session }) => {
      try {
          console.log(`[${socket.id}] Init Client...`);
          if (clients.has(socket.id)) {
              await clients.get(socket.id).disconnect();
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
      // Clean phone number (remove spaces, parentheses)
      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      console.log(`[${socket.id}] Sending code to ${phoneClean}...`);

      let client = clients.get(socket.id);
      if(!client) return socket.emit('telegram_error', { error: "Client not initialized" });

      try {
          // Wrap sendCode in a timeout race. 
          const sendCodePromise = client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);

          // 15s timeout for backend operation
          const timeoutPromise = new Promise((_, reject) => 
               setTimeout(() => reject(new Error("BACKEND_TIMEOUT")), 15000)
          );

          const { phoneCodeHash } = await Promise.race([sendCodePromise, timeoutPromise]);
          
          socket.emit('telegram_send_code_success', { phoneCodeHash });

      } catch (err) {
          console.error(`[${socket.id}] Send Code Error: ${err.message}`);

          const isMigrationError = err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_');
          const isTimeout = err.message === "BACKEND_TIMEOUT" || err.message.includes("TIMEOUT");

          if (isMigrationError || isTimeout) {
              
              let targetDC = 2; // Default fallback
              if (isMigrationError) {
                  targetDC = Number(err.errorMessage.split('_')[2]);
                  console.log(`[${socket.id}] ⚠️ Explicit Migration requested to DC ${targetDC}`);
              } else {
                  console.log(`[${socket.id}] ⏳ Timeout detected. Assuming stuck migration. Forcing switch to DC 2...`);
              }

              if (targetDC === 2) {
                  try {
                      console.log(`[${socket.id}] 🔄 Re-creating client on DC 2 (149.154.167.50:443)...`);
                      
                      const apiId = Number(client.apiId);
                      const apiHash = String(client.apiHash);

                      // Kill old client
                      await client.disconnect();
                      clients.delete(socket.id);

                      // Create NEW session on DC 2 / Port 443
                      const newSession = new StringSession("");
                      newSession.setDC(2, "149.154.167.50", 443);

                      const newClient = new TelegramClient(newSession, apiId, apiHash, {
                          connectionRetries: 5,
                          useWSS: false,
                          deviceModel: "Telegram Web Server", 
                          appVersion: "1.0.0"
                      });
                      
                      // Double enforce DC settings on the instance
                      newClient.session.setDC(2, "149.154.167.50", 443);

                      newClient.setLogLevel("info");
                      await newClient.connect();
                      clients.set(socket.id, newClient);
                      
                      socket.emit('telegram_init_success', { 
                          session: newClient.session.save(), 
                          isAuth: false, 
                          user: null 
                      });

                      console.log(`[${socket.id}] 🔄 Retrying sendCode on new connection...`);
                      
                      // Use clean phone
                      const { phoneCodeHash } = await newClient.sendCode(
                          { apiId: apiId, apiHash: apiHash }, 
                          phoneClean
                      );
                      
                      socket.emit('telegram_send_code_success', { phoneCodeHash });
                      return; 

                  } catch (retryErr) {
                      console.error(`[${socket.id}] Retry Failed:`, retryErr);
                      socket.emit('telegram_error', { method: 'sendCode', error: "Connection failed after switching DC. Please check server internet." });
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
      
      // CRITICAL: Clean phone number to avoid PHONE_NUMBER_INVALID error
      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      console.log(`[${socket.id}] Logging in with ${phoneClean}...`);

      try {
          // Fallback to low-level invoke because client.signIn seems missing/bugged in this context
          await client.invoke(new Api.auth.SignIn({
              phoneNumber: phoneClean,
              phoneCodeHash: String(phoneCodeHash),
              phoneCode: String(code)
          }));
          
          socket.emit('telegram_login_success', { session: client.session.save() });

      } catch (err) {
          const msg = err.message || err.errorMessage || "Unknown Error";
          
          if (msg.includes("SESSION_PASSWORD_NEEDED")) {
              if (password) {
                  try {
                      // Try high level sign in specifically for password, or checkPassword
                      await client.signIn({ 
                          password: String(password), 
                          phoneNumber: phoneClean, 
                          phoneCodeHash: String(phoneCodeHash), 
                          phoneCode: String(code) 
                      });
                      socket.emit('telegram_login_success', { session: client.session.save() });
                  } catch (pwErr) {
                       // If high-level fails, try low-level password check (complex) or just report error
                       console.error("Password Login Error:", pwErr);
                       socket.emit('telegram_error', { method: 'login_password', error: pwErr.message });
                  }
              } else {
                  socket.emit('telegram_password_needed');
              }
          } else {
              console.error(`[${socket.id}] Login Error:`, err);
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
  res.json({ status: 'Chat Service Running', ip_config: 'Auto-Switch to 149.154.167.50:443 on Timeout' });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
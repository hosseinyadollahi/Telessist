import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from 'telegram';
import { Logger } from "telegram/extensions/Logger.js";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- CUSTOM LOGGER ---
const log = (tag, message, data = null) => {
    const time = new Date().toISOString().split('T')[1].split('.')[0];
    const color = "\x1b[36m"; // Cyan
    const reset = "\x1b[0m";
    console.log(`${color}[${time}] [${tag}]${reset} ${message}`);
    if (data) {
        console.log(JSON.stringify(data, (key, value) => {
            if (key === 'session') return '***HIDDEN***';
            if (key === 'phoneCodeHash') return value;
            if (key === 'bytes') return '[Buffer]';
            return value;
        }, 2));
    }
};

// Map<deviceSessionId, { client: TelegramClient, cleanup: NodeJS.Timeout }>
const activeSessions = new Map();
// Map<socketId, deviceSessionId>
const socketMap = new Map();

const createTelegramClient = async (sessionStr, apiId, apiHash) => {
    log("CLIENT", `Creating client instance for API_ID: ${apiId}`);
    
    let stringSession = new StringSession(sessionStr || "");
    
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }
    
    if (!sessionStr) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }
    
    // Using a very standard Desktop configuration to ensure stability
    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, 
        deviceModel: "Desktop", 
        systemVersion: "Windows 10",
        appVersion: "4.16.4 x64", 
        langCode: "en",
        systemLangCode: "en",
        timeout: 30, 
    });
    
    client.setLogLevel("error");
    
    log("CLIENT", "Connecting to Telegram Servers...");
    await client.connect();
    log("CLIENT", "Connected successfully.");
    
    return client;
};

io.on('connection', (socket) => {
  log("SOCKET", `New connection: ${socket.id}`);

  const getClient = () => {
      const sessionId = socketMap.get(socket.id);
      if (!sessionId) return null;
      return activeSessions.get(sessionId)?.client;
  };

  socket.on('telegram_init', async (data) => {
      const { apiId, apiHash, session, deviceSessionId } = data || {};
      
      if (!deviceSessionId) {
          return socket.emit('telegram_error', { method: 'init', error: "Missing deviceSessionId." });
      }

      socketMap.set(socket.id, deviceSessionId);

      try {
          let client;
          if (activeSessions.has(deviceSessionId)) {
              log("INIT", `♻️  Restoring existing session`);
              const sessionData = activeSessions.get(deviceSessionId);
              if (sessionData.cleanup) {
                  clearTimeout(sessionData.cleanup);
                  sessionData.cleanup = null;
              }
              client = sessionData.client;
              if(!client.connected) await client.connect();
          } else {
              log("INIT", `✨ Creating NEW session`);
              if (!apiId || !apiHash) {
                   // wait for user to login
              } else {
                   client = await createTelegramClient(session, apiId, apiHash);
                   activeSessions.set(deviceSessionId, { client, cleanup: null });
              }
          }

          if (client) {
              const isAuth = await client.isUserAuthorized();
              log("INIT", `User Authorized: ${isAuth}`);
              
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
          }
      } catch (err) {
          log("INIT_ERROR", err.message);
          socket.emit('telegram_error', { method: 'init', error: err.message });
      }
  });

  socket.on('telegram_send_code', async ({ phone }) => {
      const client = getClient();
      if(!client) {
          return socket.emit('telegram_error', { error: "Session expired or not initialized" });
      }

      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      log("AUTH", `Sending code to: ${phoneClean}`);

      try {
          const result = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          log("AUTH_RESULT", "Telegram Response:", result);

          // Determine delivery type
          const type = result.type?.className || 'unknown';
          const isApp = type.includes('App');
          
          socket.emit('telegram_send_code_success', { 
              phoneCodeHash: result.phoneCodeHash,
              isCodeViaApp: isApp,
              type: type,
              isPassword: type === 'auth.SentCodeTypeFlashCall'
          });

      } catch (err) {
          log("AUTH_ERROR", err.message);
          
          if (err.message && err.message.includes('FLOOD_WAIT')) {
              const seconds = err.seconds || parseInt(err.message.match(/\d+/)[0]) || 60;
              socket.emit('telegram_error', { 
                  method: 'sendCode', 
                  error: `Too many attempts. Please wait ${seconds} seconds.` 
              });
              return;
          }

          if (err.errorMessage && err.errorMessage.startsWith('PHONE_MIGRATE_')) {
               // Migration logic omitted for brevity, handled by client reconnect usually or needs full migration block
               // For now, simpler error to user
               socket.emit('telegram_error', { method: 'sendCode', error: "DC Migration required. Please retry." });
               return;
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
      
      log("LOGIN", `Attempting login for ${phoneClean} with code: ${code}`);

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

          log("LOGIN", "Login Success!");
          socket.emit('telegram_login_success', { session: client.session.save() });

      } catch (err) {
          const msg = err.message || err.errorMessage || "Unknown Error";
          log("LOGIN_ERROR", msg);
          
          if (msg.includes("SESSION_PASSWORD_NEEDED")) {
               socket.emit('telegram_error', { method: 'login', error: "SESSION_PASSWORD_NEEDED" }); 
          } else if (msg.includes("PHONE_CODE_EXPIRED")) {
              socket.emit('telegram_error', { method: 'login', error: "Code expired. Please restart." });
          } else {
              socket.emit('telegram_error', { method: 'login', error: msg });
          }
      }
  });

  socket.on('disconnect', () => {
      const sessionId = socketMap.get(socket.id);
      if (sessionId && activeSessions.has(sessionId)) {
          const sessionData = activeSessions.get(sessionId);
          sessionData.cleanup = setTimeout(() => {
              if (sessionData.client) {
                  sessionData.client.disconnect().catch(() => {});
              }
              activeSessions.delete(sessionId);
          }, 120000); 
      }
      socketMap.delete(socket.id);
  });
  
  // Forwarders for dialogs/messages...
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
      } catch (err) {}
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
      } catch (err) {}
  });

  socket.on('telegram_send_message', async ({ chatId, message }) => {
       const client = getClient();
       if(!client) return;
       try {
           await client.sendMessage(chatId, { message });
           socket.emit('telegram_message_sent');
       } catch (err) {}
  });
});

app.get('/api/chat/status', (req, res) => {
  res.json({ status: 'Chat Service Running', active_sessions: activeSessions.size });
});

httpServer.listen(PORT, () => {
  console.log(`\x1b[35m[CHAT-SERVICE]\x1b[0m Running on port ${PORT}`);
});
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

// --- HELPER FOR JSON LOGGING WITH BIGINT ---
const jsonReplacer = (key, value) => {
    if (typeof value === 'bigint') return value.toString(); 
    if (key === 'session') return '***HIDDEN***';
    if (key === 'bytes') return '[Buffer]';
    if (key === 'token') return '***QR_TOKEN***';
    return value;
};

// --- CUSTOM LOGGER ---
const log = (tag, message, data = null) => {
    const time = new Date().toISOString().split('T')[1].split('.')[0];
    const color = "\x1b[36m"; // Cyan
    const reset = "\x1b[0m";
    console.log(`${color}[${time}] [${tag}]${reset} ${message}`);
    if (data) {
        try {
            console.log(JSON.stringify(data, jsonReplacer, 2));
        } catch (e) {
            console.log("[LOG_ERROR] Could not stringify data:", e.message);
        }
    }
};

// Map<deviceSessionId, { client: TelegramClient, cleanup: NodeJS.Timeout, passwordResolver: Function }>
const activeSessions = new Map();
// Map<socketId, deviceSessionId>
const socketMap = new Map();

const createTelegramClient = async (sessionStr, apiId, apiHash) => {
    log("CLIENT", `Creating client instance for API_ID: ${apiId}`);
    
    let stringSession = new StringSession(sessionStr || "");
    
    // REMOVED: Explicit setDC. Let GramJS handle DC discovery/migration automatically.
    // This fixes issues where users are on DC1/3/4/5 but forced to DC2.
    
    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, // Node.js uses TCP
        deviceModel: "Telessist Web", // Custom Unique Name
        systemVersion: "Linux", // Generic Server OS
        appVersion: "1.2.0",
        langCode: "en",
        systemLangCode: "en",
        timeout: 15, // Seconds
        floodSleepThreshold: 60,
    });
    
    client._customApiId = Number(apiId);
    client._customApiHash = String(apiHash);
    
    client.setLogLevel("error"); // Reduce noise, we handle errors
    
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

  const getSessionData = () => {
      const sessionId = socketMap.get(socket.id);
      if (!sessionId) return null;
      return activeSessions.get(sessionId);
  };

  socket.on('telegram_init', async (data) => {
      const { apiId, apiHash, session, deviceSessionId } = data || {};
      
      if (!deviceSessionId) {
          return socket.emit('telegram_error', { method: 'init', error: "Missing deviceSessionId." });
      }

      socketMap.set(socket.id, deviceSessionId);

      try {
          // FORCE CLEANUP: Always destroy old client to prevent ZOMBIE sessions causing TIMEOUTS
          if (activeSessions.has(deviceSessionId)) {
              log("INIT", `♻️  Cleaning up old session for this device...`);
              const oldData = activeSessions.get(deviceSessionId);
              if (oldData.client) {
                  try {
                      await oldData.client.disconnect();
                      oldData.client.destroy(); // Ensure resources are freed
                  } catch (e) {
                      log("INIT_CLEANUP_ERR", e.message);
                  }
              }
              activeSessions.delete(deviceSessionId);
          }

          log("INIT", `✨ Creating FRESH session`);
          if (!apiId || !apiHash) {
               // Waiting for credentials
          } else {
               const client = await createTelegramClient(session, apiId, apiHash);
               activeSessions.set(deviceSessionId, { client, cleanup: null, passwordResolver: null });

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

  // --- QR CODE LOGIN ---
  socket.on('telegram_login_qr', async () => {
      const client = getClient();
      const sessionData = getSessionData();

      if(!client) return socket.emit('telegram_error', { error: "Session not initialized" });
      
      log("QR", "Starting QR Login flow...");

      try {
          if(!client.connected) await client.connect();

          const apiId = client.apiId || client._customApiId;
          const apiHash = client.apiHash || client._customApiHash;
          
          if (!apiId || !apiHash) {
              throw new Error("API Credentials missing. Reload and try again.");
          }

          const qrCodeCallback = async ({ token, expires }) => {
              log("QR", "New QR Token generated");
              const tokenBase64 = token.toString('base64')
                  .replace(/\+/g, '-')
                  .replace(/\//g, '_')
                  .replace(/=+$/, '');
              socket.emit('telegram_qr_generated', { token: tokenBase64, expires: expires });
          };

          const passwordCallback = async (hint) => {
              log("QR", "2FA Password needed");
              socket.emit('telegram_password_needed', { hint });
              return new Promise((resolve, reject) => {
                  if (sessionData) {
                      sessionData.passwordResolver = resolve;
                      setTimeout(() => {
                          if(sessionData.passwordResolver === resolve) {
                              reject(new Error("Password timeout"));
                          }
                      }, 180000); 
                  } else {
                      reject(new Error("Session lost"));
                  }
              });
          };

          const user = await client.signInUserWithQrCode({
              apiId: Number(apiId),
              apiHash: String(apiHash),
              qrCode: qrCodeCallback,
              password: passwordCallback,
              onError: (err) => log("QR_ERROR_CB", err.message || err)
          });

          log("QR", "QR Login Successful!");
          socket.emit('telegram_login_success', { session: client.session.save() });

      } catch (err) {
          log("QR_FATAL", err.message || err);
          socket.emit('telegram_error', { method: 'qrLogin', error: err.message || "QR Login Failed" });
      }
  });

  socket.on('telegram_send_password', ({ password }) => {
      const sessionData = getSessionData();
      if (sessionData && sessionData.passwordResolver) {
          sessionData.passwordResolver(password);
          sessionData.passwordResolver = null;
      } else {
          // Fallback login
          const client = getClient();
          if(client) {
              client.signIn({ password: String(password) })
                .then(() => socket.emit('telegram_login_success', { session: client.session.save() }))
                .catch(err => socket.emit('telegram_error', { method: 'login', error: err.message }));
          }
      }
  });

  socket.on('telegram_send_code', async ({ phone }) => {
      const client = getClient();
      if(!client) return socket.emit('telegram_error', { error: "Session not initialized" });

      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      log("AUTH", `Sending code to: ${phoneClean}`);

      try {
          if (!client.connected) {
             log("AUTH", "Client disconnected. Reconnecting...");
             await client.connect();
          }

          const result = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          log("AUTH_RESULT", "Telegram Response:", result);

          if (!result || !result.phoneCodeHash) {
              throw new Error("Invalid response from Telegram (No hash).");
          }

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
              socket.emit('telegram_error', { method: 'sendCode', error: `Too many attempts. Wait ${seconds}s.` });
          } else {
              socket.emit('telegram_error', { method: 'sendCode', error: err.message });
          }
      }
  });

  socket.on('telegram_login', async (payload) => {
      const client = getClient();
      if(!client) return socket.emit('telegram_error', { error: "Session expired" });

      const { code, phoneCodeHash, password } = payload;
      const rawPhone = payload.phone || payload.phoneNumber;
      const phoneClean = String(rawPhone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      
      log("LOGIN", `Login attempt for ${phoneClean}`);

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
          const msg = err.message || "Unknown Error";
          log("LOGIN_ERROR", msg);
          if (msg.includes("SESSION_PASSWORD_NEEDED")) {
               socket.emit('telegram_error', { method: 'login', error: "SESSION_PASSWORD_NEEDED" }); 
          } else {
              socket.emit('telegram_error', { method: 'login', error: msg });
          }
      }
  });

  socket.on('disconnect', () => {
      const sessionId = socketMap.get(socket.id);
      if (sessionId && activeSessions.has(sessionId)) {
          const sessionData = activeSessions.get(sessionId);
          // Wait briefly before killing session to allow page reload
          sessionData.cleanup = setTimeout(() => {
              if (sessionData.client) {
                  log("CLEANUP", `Destroying session ${sessionId}`);
                  sessionData.client.disconnect().catch(() => {});
                  sessionData.client.destroy().catch(() => {});
              }
              activeSessions.delete(sessionId);
          }, 60000); 
      }
      socketMap.delete(socket.id);
  });
  
  // Chat Handlers
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
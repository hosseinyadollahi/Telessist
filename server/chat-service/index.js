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
    if (typeof value === 'bigint') return value.toString(); // Convert BigInt to string
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
    
    if (stringSession.serverAddress && stringSession.serverAddress.includes('omniday')) {
        stringSession = new StringSession("");
    }
    
    if (!sessionStr) {
        stringSession.setDC(2, "149.154.167.50", 443);
    }
    
    // CHANGED: Use "Desktop" parameters to look like a real PC client
    // This improves the delivery rate of login codes.
    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, 
        deviceModel: "Desktop", // Changed from "Telegram Web Clone"
        systemVersion: "Windows 10",
        appVersion: "4.16.2", // Mimic a recent version
        langCode: "en",
        systemLangCode: "en",
        timeout: 30, 
    });
    
    // Store credentials explicitly on the client object to be safe
    client._customApiId = Number(apiId);
    client._customApiHash = String(apiHash);
    
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
                   activeSessions.set(deviceSessionId, { client, cleanup: null, passwordResolver: null });
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

  // --- QR CODE LOGIN ---
  socket.on('telegram_login_qr', async () => {
      const client = getClient();
      const sessionData = getSessionData();

      if(!client) return socket.emit('telegram_error', { error: "Session not initialized" });
      
      log("QR", "Starting QR Login flow...");

      try {
          // Ensure connected
          if(!client.connected) {
              log("QR", "Client not connected, reconnecting...");
              await client.connect();
          }

          // Use apiId from client properties or our custom backup
          const apiId = client.apiId || client._customApiId;
          const apiHash = client.apiHash || client._customApiHash;
          
          log("QR", `Using Credentials - ID: ${apiId}, Hash: ${apiHash ? '***' : 'Missing'}`);

          if (!apiId || !apiHash) {
              throw new Error("API Credentials missing from client instance. Please reload and enter credentials.");
          }

          // Define callback functions
          const qrCodeCallback = async ({ token, expires }) => {
              log("QR", "New QR Token generated");
              const tokenBase64 = token.toString('base64')
                  .replace(/\+/g, '-')
                  .replace(/\//g, '_')
                  .replace(/=+$/, '');
              
              socket.emit('telegram_qr_generated', { 
                  token: tokenBase64, 
                  expires: expires 
              });
          };

          const passwordCallback = async (hint) => {
              log("QR", "2FA Password needed for QR Login");
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
                      reject(new Error("Session lost during 2FA"));
                  }
              });
          };

          const onErrorCallback = (err) => {
             log("QR_ERROR_CB", err.message || err);
          };

          // Explicitly construct params to avoid any 'undefined' issues
          const loginParams = {
              apiId: Number(apiId),
              apiHash: String(apiHash),
              qrCode: qrCodeCallback,
              password: passwordCallback,
              onError: onErrorCallback
          };

          const user = await client.signInUserWithQrCode(loginParams);

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
          log("QR", "Received 2FA password from user");
          sessionData.passwordResolver(password);
          sessionData.passwordResolver = null; // Clear it
      } else {
          log("QR", "Received password but no resolver waiting. Trying standard login...");
          // Fallback for standard login
          const client = getClient();
          if(client) {
              client.signIn({ password: String(password) })
                .then(() => {
                    socket.emit('telegram_login_success', { session: client.session.save() });
                })
                .catch(err => {
                    socket.emit('telegram_error', { method: 'login', error: err.message });
                });
          }
      }
  });
  // ---------------------

  socket.on('telegram_send_code', async ({ phone }) => {
      const client = getClient();
      if(!client) {
          return socket.emit('telegram_error', { error: "Session expired or not initialized" });
      }

      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      log("AUTH", `Sending code to: ${phoneClean}`);

      try {
          // Add explicit error handling for invalid sessions before call
          if (!client.connected) {
             log("AUTH", "Client disconnected. Reconnecting...");
             await client.connect();
          }

          const result = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          // LOG FULL RESPONSE with BigInt support
          log("AUTH_RESULT", "Telegram Raw Response:", result);

          // Check if response actually contains the hash
          if (!result || !result.phoneCodeHash) {
              throw new Error("Telegram did not return a phoneCodeHash. Response might be incomplete.");
          }

          const type = result.type?.className || 'unknown';
          const isApp = type.includes('App'); // SentCodeTypeApp
          
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
              return;
          }
          socket.emit('telegram_error', { method: 'sendCode', error: err.message });
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
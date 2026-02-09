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

const jsonReplacer = (key, value) => {
    if (typeof value === 'bigint') return value.toString(); 
    if (key === 'session') return '***HIDDEN***';
    if (key === 'bytes') return '[Buffer]';
    if (key === 'token') return '***QR_TOKEN***';
    return value;
};

const log = (tag, message, data = null) => {
    const time = new Date().toISOString().split('T')[1].split('.')[0];
    const color = "\x1b[36m"; 
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

// Telegram Production Data Centers
const DC_IPS = {
    1: "149.154.175.53",
    2: "149.154.167.50",
    3: "149.154.175.100",
    4: "149.154.167.91",
    5: "91.108.56.130"
};

// Map<deviceSessionId, { client: TelegramClient, cleanup: NodeJS.Timeout, passwordResolver: Function }>
const activeSessions = new Map();
// Map<socketId, deviceSessionId>
const socketMap = new Map();

// Track QR polling loops to cancel them if needed
// Map<socketId, { active: boolean }>
const qrLoops = new Map();

const createTelegramClient = async (sessionStr, apiId, apiHash, extraConfig = {}) => {
    log("CLIENT", `Creating client instance for API_ID: ${apiId}`);
    
    let stringSession = new StringSession(sessionStr || "");
    
    // Extract custom options
    const { disableUpdates, ...telegramConfig } = extraConfig;

    const client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
        connectionRetries: 5,
        useWSS: false, 
        deviceModel: "Telegram Web Clone", 
        systemVersion: "Web",
        appVersion: "1.0.0", 
        langCode: "en",
        systemLangCode: "en-US",
        timeout: 30, // Default timeout
        ...telegramConfig
    });
    
    // Fix: Disable the internal update loop to prevent TIMEOUTs during login/migration flows
    if (disableUpdates) {
        client._updateLoop = async () => { /* No-op to prevent polling updates */ };
    }

    client._customApiId = Number(apiId);
    client._customApiHash = String(apiHash);
    client.setLogLevel("none"); // Reduce internal library logs
    
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
          if (activeSessions.has(deviceSessionId)) {
               const old = activeSessions.get(deviceSessionId);
               if(old.cleanup) clearTimeout(old.cleanup);
          }

          let client;
          if (activeSessions.has(deviceSessionId) && activeSessions.get(deviceSessionId).client.connected) {
              log("INIT", `♻️  Restoring existing session`);
              client = activeSessions.get(deviceSessionId).client;
          } else {
              log("INIT", `✨ Creating NEW session`);
              if (apiId && apiHash) {
                   client = await createTelegramClient(session, apiId, apiHash);
                   activeSessions.set(deviceSessionId, { client, cleanup: null, passwordResolver: null });
              }
          }

          if (client) {
              const isAuth = await client.isUserAuthorized();
              log("INIT", `User Authorized: ${isAuth}`);
              
              let me = null;
              if(isAuth) {
                 try {
                     const user = await client.getMe();
                     me = {
                         id: user.id.toString(),
                         username: user.username,
                         firstName: user.firstName,
                         phone: user.phone
                     };
                 } catch(e) { log("INIT_WARN", "Failed to getMe", e.message); }
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

  // --- QR CODE LOGIN (MANUAL LOOP) ---
  socket.on('telegram_login_qr', async () => {
      // Stop any existing QR loop for this socket
      if (qrLoops.has(socket.id)) {
          qrLoops.get(socket.id).active = false;
      }
      const loopState = { active: true };
      qrLoops.set(socket.id, loopState);

      const currentClient = getClient();
      const deviceSessionId = socketMap.get(socket.id);
      
      let apiId, apiHash;
      if (currentClient) {
          apiId = currentClient.apiId || currentClient._customApiId;
          apiHash = currentClient.apiHash || currentClient._customApiHash;
      }
      
      if (!apiId || !apiHash) {
          return socket.emit('telegram_error', { error: "Missing API Credentials. Please refresh and try again." });
      }

      log("QR", "Starting QR Login Sequence (Manual Mode)...");

      try {
          // Cleanup old client to prevent state conflicts
          if (currentClient) {
              try { await currentClient.disconnect(); } catch(e) {}
              if (deviceSessionId) activeSessions.delete(deviceSessionId);
          }

          log("QR", "Creating Fresh Client for QR...");
          
          // Initial Client Creation for QR (Disable Updates)
          let client = await createTelegramClient("", apiId, apiHash, { 
              timeout: 60,
              disableUpdates: true 
          });
          
          if (deviceSessionId) {
             activeSessions.set(deviceSessionId, { client, cleanup: null, passwordResolver: null });
             socketMap.set(socket.id, deviceSessionId);
          }

          log("QR", "Entering QR Polling Loop...");

          // Protection against infinite loops
          let loopCount = 0;
          const MAX_LOOPS = 200; 

          while (loopState.active && socket.connected && loopCount < MAX_LOOPS) {
              loopCount++;
              try {
                  // Add a request timeout to prevent hanging forever if DC is unresponsive
                  const result = await client.invoke(new Api.auth.ExportLoginToken({
                      apiId: Number(apiId),
                      apiHash: String(apiHash),
                      exceptIds: []
                  }), { requestTimeout: 15000 }); // 15s timeout for this request

                  if (result instanceof Api.auth.LoginTokenSuccess) {
                      log("QR", "✅ Login Token Success!");
                      loopState.active = false;
                      
                      // Fetch user info
                      let me = null;
                      try {
                          const user = await client.getMe();
                          me = { id: user.id.toString(), username: user.username, firstName: user.firstName };
                      } catch(e) {}

                      socket.emit('telegram_login_success', { 
                          session: client.session.save(),
                          user: me
                      });
                      break;

                  } else if (result instanceof Api.auth.LoginToken) {
                      const tokenBase64 = result.token.toString('base64')
                          .replace(/\+/g, '-')
                          .replace(/\//g, '_')
                          .replace(/=+$/, '');
                      
                      socket.emit('telegram_qr_generated', { 
                          token: tokenBase64, 
                          expires: result.expires 
                      });
                      
                      // Wait 2 seconds before polling again
                      await new Promise(resolve => setTimeout(resolve, 2000));

                  } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
                      const newDcId = result.dcId;
                      const newIp = DC_IPS[newDcId];
                      log("QR", `⚠️ Account is on DC ${newDcId} (${newIp || 'Unknown IP'}). Performing full migration...`);
                      
                      if (newIp) {
                          // 1. Create FRESH session for the new DC
                          const migrationSession = new StringSession("");
                          migrationSession.setDC(newDcId, newIp, 443);
                          const migrationSessionStr = migrationSession.save();
                          
                          // 2. Destroy old client completely
                          log("QR", "Destroying old client instance...");
                          try { await client.disconnect(); } catch(e) { log("QR", "Old client disconnect error (ignoring): " + e.message); }
                          
                          activeSessions.delete(deviceSessionId);

                          await new Promise(resolve => setTimeout(resolve, 1000));

                          // 3. Create NEW Client with migrated session (Disable Updates)
                          log("QR", `Creating NEW client for DC ${newDcId} with fresh session...`);
                          
                          let retryCount = 0;
                          let connected = false;
                          
                          while(retryCount < 3 && !connected) {
                              try {
                                  client = await createTelegramClient(migrationSessionStr, apiId, apiHash, { 
                                      timeout: 60,
                                      disableUpdates: true 
                                  });
                                  connected = true;
                              } catch(connErr) {
                                  retryCount++;
                                  log("QR", `Connection attempt ${retryCount} failed: ${connErr.message}`);
                                  if (retryCount >= 3) throw connErr;
                                  await new Promise(r => setTimeout(r, 2000));
                              }
                          }
                          
                          // 4. Update References
                          activeSessions.set(deviceSessionId, { client, cleanup: null, passwordResolver: null });
                          socketMap.set(socket.id, deviceSessionId);
                          
                          log("QR", `Connected to DC ${newDcId}. Resuming poll...`);
                          // Continue to next loop iteration immediately
                          continue;
                      } else {
                          throw new Error(`Could not migrate to DC ${newDcId}. IP not found.`);
                      }
                  }
              } catch (loopErr) {
                  const errorMessage = loopErr.message || loopErr.errorMessage || "";
                  
                  // Comprehensive check for Password Needed
                  if (errorMessage.includes('SESSION_PASSWORD_NEEDED')) {
                      log("QR", "🔐 Password required (2FA detected)");
                      socket.emit('telegram_password_needed', { hint: 'Password required' });
                      loopState.active = false;
                      
                      const sessionData = activeSessions.get(deviceSessionId);
                      if (sessionData) {
                          sessionData.passwordResolver = async (pwd) => {
                              try {
                                  log("QR", "Attempting 2FA Sign In...");
                                  const currentActiveClient = activeSessions.get(deviceSessionId)?.client;
                                  if(!currentActiveClient) throw new Error("Client lost during 2FA");
                                  
                                  // Ensure we are connected
                                  if(!currentActiveClient.connected) await currentActiveClient.connect();

                                  await currentActiveClient.signIn({ password: pwd });
                                  log("QR", "2FA Login Successful");
                                  
                                  let me = null;
                                  try {
                                      const user = await currentActiveClient.getMe();
                                      me = { id: user.id.toString(), username: user.username, firstName: user.firstName };
                                  } catch(e) {}

                                  socket.emit('telegram_login_success', { 
                                      session: currentActiveClient.session.save(),
                                      user: me
                                  });
                              } catch(e) {
                                  log("QR_ERROR", "2FA Failed: " + e.message);
                                  socket.emit('telegram_error', { method: 'login', error: e.message });
                              }
                          };
                      }
                      break;
                  } else {
                      // Log specific loop errors but don't crash
                      log("QR_LOOP_WARN", `Poll error: ${errorMessage}`);
                      
                      // If error is about network/timeout, just wait and retry
                      // If it's a fatal Auth error, break.
                      if (errorMessage.includes("AUTH_KEY") && !errorMessage.includes("TIMEOUT")) {
                           log("QR_FATAL", "Auth Key Invalid");
                           socket.emit('telegram_error', { method: 'qr', error: "Auth Key Invalid. Restart." });
                           break;
                      }
                      
                      // Wait before retrying
                      await new Promise(resolve => setTimeout(resolve, 2000));
                  }
              }
          }

      } catch (err) {
          log("QR_FATAL", err.message || err);
          socket.emit('telegram_error', { method: 'qrLogin', error: err.message || "QR Login Failed" });
          if(qrLoops.get(socket.id) === loopState) {
              qrLoops.delete(socket.id);
          }
      }
  });

  socket.on('telegram_send_password', ({ password }) => {
      const sessionData = getSessionData();
      if (sessionData && sessionData.passwordResolver) {
          log("QR", "Received 2FA password from user");
          sessionData.passwordResolver(password);
          sessionData.passwordResolver = null; 
      } else {
          // Fallback for non-QR flow (manual login)
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

  socket.on('telegram_send_code', async ({ phone }) => {
      const client = getClient();
      if(!client) {
          return socket.emit('telegram_error', { error: "Session expired or not initialized" });
      }

      const phoneClean = String(phone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      log("AUTH", `Sending code to: ${phoneClean}`);

      try {
          if (!client.connected) {
             await client.connect();
          }

          const result = await client.sendCode({
              apiId: Number(client.apiId),
              apiHash: String(client.apiHash),
          }, phoneClean);
          
          if (!result || !result.phoneCodeHash) {
              throw new Error("Telegram did not return a phoneCodeHash.");
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
          let errorMsg = err.message || "Unknown error";
          const lowerMsg = errorMsg.toLowerCase();
          
          if (lowerMsg.includes('flood') || lowerMsg.includes('wait') || lowerMsg.includes('seconds')) {
              const secondsMatch = errorMsg.match(/\d+/);
              const seconds = secondsMatch ? parseInt(secondsMatch[0]) : 60;
              errorMsg = `FLOOD_WAIT_${seconds}`;
          }
          socket.emit('telegram_error', { method: 'sendCode', error: errorMsg });
      }
  });

  socket.on('telegram_login', async (payload) => {
      const client = getClient();
      if(!client) return socket.emit('telegram_error', { error: "Session expired" });

      const { code, phoneCodeHash, password } = payload;
      const rawPhone = payload.phone || payload.phoneNumber;
      const phoneClean = String(rawPhone).replace(/\s+/g, '').replace(/[()]/g, '').trim();
      
      log("LOGIN", `Login attempt: ${phoneClean} | Code: ${code}`);

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

          log("LOGIN", "Success");
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
      // Stop QR loop
      if (qrLoops.has(socket.id)) {
          qrLoops.get(socket.id).active = false;
          qrLoops.delete(socket.id);
      }

      const sessionId = socketMap.get(socket.id);
      if (sessionId && activeSessions.has(sessionId)) {
          const sessionData = activeSessions.get(sessionId);
          sessionData.cleanup = setTimeout(() => {
              if (sessionData.client) {
                  log("CLEANUP", `Disconnecting session ${sessionId}`);
                  sessionData.client.disconnect().catch(() => {});
              }
              activeSessions.delete(sessionId);
          }, 300000); 
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
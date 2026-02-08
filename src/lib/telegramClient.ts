import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions";

// We use a singleton pattern to ensure one connection across the app
let client: TelegramClient | null = null;
let sessionStr = localStorage.getItem("telegram_session") || "";

// Set log level to debug to see more info in console
Logger.setLevel("debug");

export const initClient = async (apiId: number, apiHash: string) => {
  if (client) return client;

  const stringSession = new StringSession(sessionStr);
  
  console.log("Initializing Telegram Client...");
  console.log(`API ID: ${apiId}, Hash Length: ${apiHash.length}`);
  
  // CONFIGURATION CHANGE:
  // useWSS: false -> This forces GramJS to use HTTP requests instead of WebSockets.
  // The error "wss://telessist.omniday.io/apiws failed" happens because the default
  // GramJS WebSocket proxy is down or blocked. HTTP mode bypasses this specific proxy.
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false, 
    testServers: false,
    deviceModel: "Telegram Web Clone",
    systemVersion: "1.0.0",
    appVersion: "1.0.0",
  });

  // Log internal connection states
  // client.setLogLevel("debug");

  try {
      console.log("Attempting to connect to Telegram DC...");
      // Connect without login first to restore session if exists
      await client.connect();
      console.log("Client connected successfully!");
  } catch (err) {
      console.error("Client connection failed:", err);
      throw err;
  }
  
  // Save session on changes
  const currentSession = (client.session as any).save();
  if (currentSession !== sessionStr) {
     localStorage.setItem("telegram_session", currentSession);
     sessionStr = currentSession;
  }

  return client;
};

export const getClient = () => client;

export const saveSession = () => {
    if (client) {
        const currentSession = (client.session as any).save();
        localStorage.setItem("telegram_session", currentSession);
    }
}

export const clearSession = () => {
    localStorage.removeItem("telegram_session");
    client = null;
    window.location.reload();
}
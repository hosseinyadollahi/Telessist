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
  
  console.log("%c[TelegramClient] Initializing...", "color: cyan; font-weight: bold");
  console.log(`[TelegramClient] API ID: ${apiId}`);
  
  // FIX: Must be useWSS: true for HTTPS environments (like StackBlitz, Vercel, or Production)
  // useWSS: false causes "SecurityError: Failed to construct 'WebSocket': An insecure WebSocket connection may not be initiated from a page loaded over HTTPS"
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true, 
    testServers: false,
    deviceModel: "Telegram Web Clone",
    systemVersion: "1.0.0",
    appVersion: "1.0.0",
  });

  // Inject a custom logger wrapper to catch internal GramJS logs if possible
  // (GramJS uses a global logger, configured above via Logger.setLevel)

  try {
      console.log("%c[TelegramClient] Connecting to DC...", "color: yellow");
      const startTime = Date.now();
      
      // Connect without login first to restore session if exists
      await client.connect();
      
      const duration = Date.now() - startTime;
      console.log(`%c[TelegramClient] Connected successfully in ${duration}ms!`, "color: green; font-weight: bold");
  } catch (err: any) {
      console.error("%c[TelegramClient] Connection Failed!", "color: red; font-weight: bold", err);
      
      // Detailed error analysis for the user
      if (err.message && err.message.includes("wss://")) {
          console.warn("Hint: The default GramJS proxy (wss://telessist.omniday.io) might be blocked in your region. Try using a VPN.");
      }
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
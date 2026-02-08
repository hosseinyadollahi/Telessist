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
  
  // Basic configuration for browser environment
  // We use useWSS: true to enforce WebSocket connections.
  // If connection fails, it might be due to network blocking (need VPN)
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true, 
    deviceModel: "Telegram Web Clone",
    systemVersion: "1.0.0",
    appVersion: "1.0.0",
  });

  // Connect without login first to restore session if exists
  await client.connect();
  
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
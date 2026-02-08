import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

// We use a singleton pattern to ensure one connection across the app
let client: TelegramClient | null = null;
let sessionStr = localStorage.getItem("telegram_session") || "";

export const initClient = async (apiId: number, apiHash: string) => {
  if (client) return client;

  const stringSession = new StringSession(sessionStr);
  
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  // Connect without login first to restore session if exists
  await client.connect();
  
  // Save session on changes
  // Fix: Cast session to any to access save() because TS definition might return void
  // even though StringSession returns a string.
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
        // Fix: Cast session to any
        const currentSession = (client.session as any).save();
        localStorage.setItem("telegram_session", currentSession);
    }
}

export const clearSession = () => {
    localStorage.removeItem("telegram_session");
    client = null;
    window.location.reload();
}
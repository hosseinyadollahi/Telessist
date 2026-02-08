import { socket, connectSocket } from './socket';

// Simple UUID generator
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Get or create a persistent ID for this browser
// Robust version: handles localStorage failures (e.g. Incognito mode)
const getDeviceSessionId = () => {
    let id;
    try {
        id = localStorage.getItem('device_session_id');
        if (!id) {
            id = generateUUID();
            localStorage.setItem('device_session_id', id);
        }
    } catch (e) {
        console.warn("[TelegramClient] LocalStorage access failed or restricted. Using memory fallback.");
        // Fallback to global variable for this session
        if (!(window as any)._tempSessionId) {
            (window as any)._tempSessionId = generateUUID();
        }
        id = (window as any)._tempSessionId;
    }
    return id;
};

// Safely get initial session
let sessionStr = "";
try {
    sessionStr = localStorage.getItem("telegram_session") || "";
} catch (e) {
    console.warn("Could not read telegram_session from storage");
}

// Helper to wait for a specific event
const waitForEvent = (eventName: string, errorEventName = 'telegram_error', timeout = 30000): Promise<any> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, timeout);

        const onSuccess = (data: any) => {
            cleanup();
            resolve(data);
        };

        const onError = (data: any) => {
             cleanup();
             reject(new Error(data.error || "Unknown Error"));
        };

        const cleanup = () => {
            socket.off(eventName, onSuccess);
            socket.off(errorEventName, onError);
            clearTimeout(timer);
        };

        socket.on(eventName, onSuccess);
        socket.on(errorEventName, onError);
    });
};

export const initClient = async (apiId: number, apiHash: string) => {
    connectSocket();
    
    const deviceSessionId = getDeviceSessionId();
    console.log("[TelegramClient] Initializing with Device ID:", deviceSessionId);
    
    if (!deviceSessionId) {
        throw new Error("Failed to generate Device Session ID");
    }

    // Send init request with stable device ID
    socket.emit('telegram_init', { apiId, apiHash, session: sessionStr, deviceSessionId });
    
    // Wait for success
    const res: any = await waitForEvent('telegram_init_success', 'telegram_error', 60000);
    
    // Update session if changed
    if (res.session && res.session !== sessionStr) {
        sessionStr = res.session;
        try {
            localStorage.setItem("telegram_session", sessionStr);
        } catch(e) {}
    }
    
    return createProxyClient(res.user); 
};

export const getClient = () => {
    return createProxyClient(null);
};

const createProxyClient = (userCtx: any) => {
    return {
        me: userCtx,
        getMe: async () => userCtx,

        sendCode: async (params: any, phone: string) => {
            socket.emit('telegram_send_code', { phone });
            return await waitForEvent('telegram_send_code_success', 'telegram_error', 120000);
        },

        signIn: async (params: any) => {
             socket.emit('telegram_login', params);
             const res: any = await waitForEvent('telegram_login_success', 'telegram_error', 60000);
             if (res.session) {
                 try { localStorage.setItem("telegram_session", res.session); } catch(e){}
             }
             return res;
        },

        getDialogs: async (params: any) => {
            socket.emit('telegram_get_dialogs');
            return await waitForEvent('telegram_dialogs_data');
        },

        getMessages: async (chatId: any, params: any) => {
            socket.emit('telegram_get_messages', { chatId });
            return await waitForEvent('telegram_messages_data');
        },

        sendMessage: async (chatId: any, params: any) => {
             socket.emit('telegram_send_message', { chatId, message: params.message });
             return await waitForEvent('telegram_message_sent'); 
        },

        disconnect: async () => {
            socket.disconnect();
        }
    };
};

export const saveSession = () => {};

export const clearSession = () => {
    try { localStorage.removeItem("telegram_session"); } catch(e) {}
    window.location.reload();
};
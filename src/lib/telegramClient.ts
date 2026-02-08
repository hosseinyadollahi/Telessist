import { socket, connectSocket } from './socket';

// Simple UUID generator
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Get or create a persistent ID for this browser
const getDeviceSessionId = () => {
    let id = localStorage.getItem('device_session_id');
    if (!id) {
        id = generateUUID();
        localStorage.setItem('device_session_id', id);
    }
    return id;
};

let sessionStr = localStorage.getItem("telegram_session") || "";

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
             // Optional: check if error matches request
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
    
    // Send init request with stable device ID
    socket.emit('telegram_init', { apiId, apiHash, session: sessionStr, deviceSessionId });
    
    // Wait for success
    const res: any = await waitForEvent('telegram_init_success', 'telegram_error', 60000);
    
    // Update session if changed
    if (res.session && res.session !== sessionStr) {
        sessionStr = res.session;
        localStorage.setItem("telegram_session", sessionStr);
    }
    
    return createProxyClient(res.user); // Return a proxy object
};

export const getClient = () => {
    // Return a proxy object
    return createProxyClient(null);
};

// A proxy object that looks like the GramJS client but sends socket events
const createProxyClient = (userCtx: any) => {
    return {
        me: userCtx,
        
        getMe: async () => {
             return userCtx;
        },

        sendCode: async (params: any, phone: string) => {
            socket.emit('telegram_send_code', { phone });
            // Increase timeout to 120s for DC migrations
            return await waitForEvent('telegram_send_code_success', 'telegram_error', 120000);
        },

        signIn: async (params: any) => {
             socket.emit('telegram_login', params);
             const res: any = await waitForEvent('telegram_login_success', 'telegram_error', 60000);
             // Save session
             if (res.session) {
                 localStorage.setItem("telegram_session", res.session);
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

export const saveSession = () => {
    // Session is saved automatically in localstorage
};

export const clearSession = () => {
    localStorage.removeItem("telegram_session");
    // Do NOT clear device_session_id to maintain connection stability
    window.location.reload();
};
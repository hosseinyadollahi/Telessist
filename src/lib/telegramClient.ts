import { socket, connectSocket } from './socket';

// This file now acts as a wrapper around the Socket.IO connection
// to mimic the behavior of a Telegram Client, but async.

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
    
    // Send init request
    socket.emit('telegram_init', { apiId, apiHash, session: sessionStr });
    
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
    // Return a dummy object if socket is active, logic handled in components mostly
    // or return the singleton proxy
    return createProxyClient(null);
};

// A proxy object that looks like the GramJS client but sends socket events
const createProxyClient = (userCtx: any) => {
    return {
        me: userCtx,
        
        getMe: async () => {
             // In a real implementation we might fetch again
             return userCtx;
        },

        sendCode: async (params: any, phone: string) => {
            socket.emit('telegram_send_code', { phone });
            // Increase timeout to 120s for DC migrations (Production fix)
            return await waitForEvent('telegram_send_code_success', 'telegram_error', 120000);
        },

        signIn: async (params: any) => {
             socket.emit('telegram_login', params);
             // Login can also take time if password check is slow or network lags
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
             return await waitForEvent('telegram_message_sent'); // or just resolve if we don't care
        },

        disconnect: async () => {
            socket.disconnect();
        }
    };
};

export const saveSession = () => {
    // Session is saved automatically in localstorage in this new architecture on event receipt
};

export const clearSession = () => {
    localStorage.removeItem("telegram_session");
    window.location.reload();
};
import { socket, connectSocket } from './socket';

// Simple UUID generator
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

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
        if (!(window as any)._tempSessionId) {
            (window as any)._tempSessionId = generateUUID();
        }
        id = (window as any)._tempSessionId;
    }
    return id;
};

let sessionStr = "";
try {
    sessionStr = localStorage.getItem("telegram_session") || "";
} catch (e) {}

/**
 * SAFE EMIT HELPER
 * Registers event listeners BEFORE emitting to prevent race conditions.
 */
const emitAndWait = (
    emitName: string, 
    emitData: any, 
    successEvent: string, 
    errorEvent = 'telegram_error', 
    timeout = 60000
): Promise<any> => {
    return new Promise((resolve, reject) => {
        let timer: any;

        const cleanup = () => {
            socket.off(successEvent, onSuccess);
            socket.off(errorEvent, onError);
            if (timer) clearTimeout(timer);
        };

        const onSuccess = (data: any) => {
            cleanup();
            resolve(data);
        };

        const onError = (data: any) => {
             cleanup();
             // If error is specifically about password needed, we still reject 
             // but caller can handle it by checking error message
             reject(new Error(data.error || "Unknown Error"));
        };

        // 1. Register Listeners FIRST
        socket.on(successEvent, onSuccess);
        socket.on(errorEvent, onError);

        // 2. Emit Request
        if (emitData !== undefined) {
             socket.emit(emitName, emitData);
        } else {
             socket.emit(emitName);
        }

        // 3. Set Timeout
        timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for ${successEvent}`));
        }, timeout);
    });
};

export const initClient = async (apiId: number, apiHash: string) => {
    connectSocket();
    
    const deviceSessionId = getDeviceSessionId();
    console.log("[TelegramClient] Initializing with Device ID:", deviceSessionId);
    
    if (!deviceSessionId) {
        throw new Error("Failed to generate Device Session ID");
    }

    // Use safe emitAndWait
    const res: any = await emitAndWait(
        'telegram_init',
        { apiId, apiHash, session: sessionStr, deviceSessionId },
        'telegram_init_success',
        'telegram_error',
        120000 // 2 min timeout for init/migration
    );
    
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
            return await emitAndWait(
                'telegram_send_code',
                { phone },
                'telegram_send_code_success',
                'telegram_error',
                120000
            );
        },

        signIn: async (params: any) => {
             let emitName = 'telegram_login';
             let emitPayload = params;

             if (params.password) {
                 emitName = 'telegram_send_password';
                 emitPayload = { password: params.password };
             }
             
             const res: any = await emitAndWait(
                 emitName,
                 emitPayload,
                 'telegram_login_success',
                 'telegram_error',
                 60000
             );

             if (res.session) {
                 try { localStorage.setItem("telegram_session", res.session); } catch(e){}
             }
             return res;
        },

        // QR Flow handles its own events because it's a stream of updates
        startQrLogin: (onQrRecieved: (token: string) => void) => {
            // Clean previous listeners
            socket.off('telegram_qr_generated'); 
            socket.off('telegram_login_success');
            socket.off('telegram_error');
            socket.off('telegram_password_needed');

            // Setup new listeners
            socket.on('telegram_qr_generated', (data: any) => {
                onQrRecieved(data.token);
            });
            
            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    socket.off('telegram_qr_generated');
                    socket.off('telegram_login_success', onSuccess);
                    socket.off('telegram_error', onError);
                    socket.off('telegram_password_needed', onPassword);
                };

                const onSuccess = (res: any) => {
                    if (res.session) {
                        try { localStorage.setItem("telegram_session", res.session); } catch(e){}
                    }
                    cleanup();
                    resolve(res);
                };

                const onError = (err: any) => {
                    // Only reject if it's a login error, not a polling retry warning
                    if(err.method === 'qrLogin' || !err.method || err.error.includes('Invalid')) {
                        cleanup();
                        reject(new Error(err.error));
                    }
                };

                const onPassword = (hint: any) => {
                    cleanup();
                    resolve({ passwordNeeded: true, hint });
                };

                socket.on('telegram_login_success', onSuccess);
                socket.on('telegram_error', onError);
                socket.on('telegram_password_needed', onPassword);

                // Emit AFTER listeners are ready
                socket.emit('telegram_login_qr');
            });
        },

        getDialogs: async (params: any) => {
            return await emitAndWait(
                'telegram_get_dialogs',
                undefined,
                'telegram_dialogs_data'
            );
        },

        getMessages: async (chatId: any, params: any) => {
            return await emitAndWait(
                'telegram_get_messages',
                { chatId },
                'telegram_messages_data'
            );
        },

        sendMessage: async (chatId: any, params: any) => {
             return await emitAndWait(
                 'telegram_send_message',
                 { chatId, message: params.message },
                 'telegram_message_sent'
             );
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
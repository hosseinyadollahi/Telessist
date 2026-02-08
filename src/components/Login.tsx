import React, { useState } from 'react';
import { ArrowRight, Lock, Settings } from 'lucide-react';
import { initClient, saveSession } from '../lib/telegramClient';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [step, setStep] = useState<'creds' | 'phone' | 'code' | 'password'>('creds');
  
  // Default Creds (Empty by default, user must provide)
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInitClient = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!apiId || !apiHash) {
          setError("API ID and Hash are required.");
          return;
      }
      setIsLoading(true);
      try {
          await initClient(Number(apiId), apiHash);
          setStep('phone');
          setError('');
      } catch (err: any) {
          setError("Failed to initialize: " + err.message);
      } finally {
          setIsLoading(false);
      }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const client = await initClient(Number(apiId), apiHash);
      if (!client) throw new Error("Client not initialized");

      const { phoneCodeHash } = await client.sendCode(
        {
          apiId: Number(apiId),
          apiHash: apiHash,
        },
        phone
      );

      setPhoneCodeHash(phoneCodeHash);
      setStep('code');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to send code. Check console.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const client = await initClient(Number(apiId), apiHash);
      if (!client) throw new Error("Client not initialized");

      try {
        await (client as any).signIn({
          phoneNumber: phone,
          phoneCodeHash: phoneCodeHash,
          phoneCode: code,
        });
        
        saveSession();
        onLoginSuccess();
      } catch (err: any) {
        if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
            setStep('password');
        } else {
            throw err;
        }
      }
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      try {
          const client = await initClient(Number(apiId), apiHash);
          if (!client) throw new Error("Client not initialized");

          await (client as any).signIn({
              password: password,
              phoneNumber: phone,
              phoneCodeHash: phoneCodeHash,
              phoneCode: code
          });
          saveSession();
          onLoginSuccess();
      } catch (err: any) {
          setError(err.message || "Invalid Password");
      } finally {
          setIsLoading(false);
      }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white text-black dark:bg-[#0f172a] dark:text-white transition-colors font-sans">
      <div className="w-full max-w-sm p-8 flex flex-col items-center">
        
        <div className="mb-8 text-center">
           <div className="w-32 h-32 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg viewBox="0 0 24 24" className="w-16 h-16 text-white fill-current">
                 <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-.94-2.4-1.54-1.06-.7-.37-1.09.23-1.72.14-.15 2.54-2.32 2.59-2.52.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.11.02-1.78 1.14-5.02 3.34-.48.33-.91.49-1.3.48-.42-.01-1.23-.24-1.83-.42-.73-.23-1.31-.35-1.26-.74.03-.2.3-.41.79-.63 3.1-1.34 5.17-2.23 6.23-2.66 2.95-1.23 3.57-1.44 3.97-1.44.09 0 .28.02.41.12.11.08.14.19.15.26.01.07.02.26.01.43z"/>
              </svg>
           </div>
           <h1 className="text-2xl font-bold mb-2">Telegram Web</h1>
           <p className="text-gray-500 text-sm">
             {step === 'creds' && 'Enter API Credentials (my.telegram.org)'}
             {step === 'phone' && 'Your Phone Number'}
             {step === 'code' && `Code sent to ${phone}`}
             {step === 'password' && 'Enter 2FA Password'}
           </p>
        </div>

        {step === 'creds' && (
            <form onSubmit={handleInitClient} className="w-full space-y-4">
                <div className="bg-blue-50 dark:bg-slate-800 p-3 rounded text-xs text-slate-500 mb-4">
                    NOTE: To connect to real Telegram, you need an API ID. Get it at <a href="https://my.telegram.org" target="_blank" className="text-blue-500 underline">my.telegram.org</a>.
                </div>
                <div>
                    <label className="text-xs text-slate-500 block mb-1">API ID</label>
                    <input 
                        type="text" 
                        value={apiId}
                        onChange={(e) => setApiId(e.target.value)}
                        className="w-full bg-transparent border border-gray-300 dark:border-slate-600 rounded-lg p-3 outline-none focus:border-blue-500"
                        placeholder="123456"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 block mb-1">API Hash</label>
                    <input 
                        type="text" 
                        value={apiHash}
                        onChange={(e) => setApiHash(e.target.value)}
                        className="w-full bg-transparent border border-gray-300 dark:border-slate-600 rounded-lg p-3 outline-none focus:border-blue-500"
                        placeholder="abcdef..."
                    />
                </div>
                <button type="submit" disabled={isLoading} className="w-full bg-blue-500 text-white font-semibold py-3 rounded-xl flex justify-center items-center gap-2">
                    {isLoading ? 'Connecting...' : 'Continue'} <ArrowRight size={16}/>
                </button>
            </form>
        )}

        {step === 'phone' && (
          <form onSubmit={handleSendCode} className="w-full space-y-6">
            <div className="flex gap-3">
                 <div className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg p-3 relative bg-transparent hover:border-blue-500 transition-colors">
                    <input 
                      type="tel" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-transparent outline-none text-lg"
                      placeholder="+1234567890"
                      autoFocus
                    />
                 </div>
            </div>
            <button 
              type="submit" 
              disabled={isLoading || !phone}
              className="w-full bg-blue-500 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Sending...' : 'Next'} <ArrowRight size={18} />
            </button>
          </form>
        )}

        {(step === 'code' || step === 'password') && (
          <form onSubmit={step === 'code' ? handleVerify : handlePassword} className="w-full space-y-6">
             <div className="flex justify-center">
                <input 
                  type={step === 'password' ? 'password' : 'text'}
                  value={step === 'code' ? code : password}
                  onChange={(e) => step === 'code' ? setCode(e.target.value) : setPassword(e.target.value)}
                  className="w-full text-center text-2xl tracking-widest bg-transparent border-b-2 border-gray-300 focus:border-blue-500 outline-none pb-2"
                  placeholder={step === 'code' ? "Code..." : "Password..."}
                  autoFocus
                />
             </div>
             <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-blue-500 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {isLoading ? <Lock size={18} className="animate-spin" /> : (step === 'code' ? 'Verify' : 'Unlock')}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-600 rounded-lg text-sm text-center w-full break-words">
            {error}
          </div>
        )}

      </div>
    </div>
  );
}
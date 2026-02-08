import React, { useState } from 'react';
import { ArrowRight, Lock, Smartphone, Key, WifiOff, Trash2, AlertTriangle, MessageSquare } from 'lucide-react';
import { initClient, getClient, saveSession, clearSession } from '../lib/telegramClient';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [step, setStep] = useState<'creds' | 'phone' | 'code' | 'password'>('creds');
  
  // Default Creds
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<'sms' | 'app' | 'unknown'>('unknown');
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Connecting...');
  const [error, setError] = useState('');

  const handleError = (err: any) => {
      console.error("Login Error Handler:", err);
      let msg = err.message || "Unknown error occurred";
      
      if (msg.includes("TIMEOUT")) {
          msg = "Server is taking too long. Please try clicking Next again.";
      } else if (msg.includes("PHONE_CODE_INVALID")) {
          msg = "The code is invalid. Please try again or restart.";
      }
      
      setError(msg);
  };

  // Step 1: Initialize Client
  const handleInitClient = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!apiId || !apiHash) {
          setError("API ID and Hash are required.");
          return;
      }
      setIsLoading(true);
      setLoadingMsg("Initializing connection...");
      setError('');
      try {
          await initClient(Number(apiId), apiHash);
          setStep('phone');
      } catch (err: any) {
          handleError(err);
      } finally {
          setIsLoading(false);
      }
  };

  // Step 2: Send Code
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLoadingMsg("Sending code...");
    setError('');

    try {
      const client = getClient(); 
      const res: any = await client.sendCode(
        { apiId: Number(apiId), apiHash: apiHash },
        phone
      );

      if (res && res.phoneCodeHash) {
        setPhoneCodeHash(res.phoneCodeHash);
        
        // Check delivery method from server response
        if (res.isCodeViaApp) {
            setDeliveryMethod('app');
        } else {
            setDeliveryMethod('sms');
        }

        setStep('code');
      } else {
        throw new Error("Failed to get validation hash from Telegram");
      }
    } catch (err: any) {
      handleError(err);
      if (err.message && err.message.includes("Client not initialized")) {
          setStep('creds');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Verify Code
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLoadingMsg("Verifying code...");
    setError('');

    try {
      const client = getClient(); 
      try {
        await (client as any).signIn({
          phone: phone, 
          phoneCodeHash: phoneCodeHash,
          phoneCode: code,
        });
        
        saveSession();
        onLoginSuccess();
      } catch (err: any) {
        if (err.message && err.message.includes("SESSION_PASSWORD_NEEDED")) {
            setStep('password');
        } else {
            throw err;
        }
      }
    } catch (err: any) {
      handleError(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 4: 2FA Password
  const handlePassword = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      setLoadingMsg("Checking password...");
      try {
          const client = getClient(); 
          await (client as any).signIn({
              password: password,
              phone: phone,
              phoneCodeHash: phoneCodeHash,
              phoneCode: code
          });
          saveSession();
          onLoginSuccess();
      } catch (err: any) {
          handleError(err);
      } finally {
          setIsLoading(false);
      }
  }

  const handleResetSession = () => {
      if(window.confirm("Start fresh? This clears local data.")) {
          clearSession();
          window.location.reload();
      }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f172a] text-white font-sans p-4">
      <div className="w-full max-w-md bg-[#1e293b] rounded-2xl shadow-2xl p-8 border border-slate-700 relative">
        
        <button 
            onClick={handleResetSession}
            className="absolute top-4 right-4 p-2 text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 text-xs"
            title="Clear local session data"
        >
            <Trash2 size={16} />
            <span className="hidden sm:inline">Reset</span>
        </button>

        <div className="mb-8 text-center">
           <div className="w-24 h-24 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
              <svg viewBox="0 0 24 24" className="w-12 h-12 text-white fill-current transform -rotate-12">
                 <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-.94-2.4-1.54-1.06-.7-.37-1.09.23-1.72.14-.15 2.54-2.32 2.59-2.52.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.11.02-1.78 1.14-5.02 3.34-.48.33-.91.49-1.3.48-.42-.01-1.23-.24-1.83-.42-.73-.23-1.31-.35-1.26-.74.03-.2.3-.41.79-.63 3.1-1.34 5.17-2.23 6.23-2.66 2.95-1.23 3.57-1.44 3.97-1.44.09 0 .28.02.41.12.11.08.14.19.15.26.01.07.02.26.01.43z"/>
              </svg>
           </div>
           <h1 className="text-3xl font-bold mb-2 tracking-tight">Telegram Web</h1>
           <p className="text-slate-400">
             {step === 'creds' && 'Enter API Credentials'}
             {step === 'phone' && 'Sign in to Telegram'}
             {step === 'code' && `Enter the code`}
             {step === 'password' && 'Two-Step Verification'}
           </p>
        </div>

        {step === 'creds' && (
            <form onSubmit={handleInitClient} className="space-y-5">
                <div className="bg-blue-900/30 border border-blue-500/30 p-4 rounded-xl text-xs text-blue-200 leading-relaxed">
                    <strong>Developer Mode:</strong> Provide App ID and Hash from <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">my.telegram.org</a>.
                </div>
                <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block ml-1">App API ID</label>
                    <div className="relative">
                        <Key size={18} className="absolute left-4 top-3.5 text-slate-500" />
                        <input 
                            type="text" 
                            value={apiId}
                            onChange={(e) => setApiId(e.target.value)}
                            className="w-full bg-slate-800/50 border border-slate-600 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-blue-500 focus:bg-slate-800 transition-all text-white placeholder-slate-600"
                            placeholder="123456"
                        />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block ml-1">App API Hash</label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-3.5 text-slate-500" />
                        <input 
                            type="text" 
                            value={apiHash}
                            onChange={(e) => setApiHash(e.target.value)}
                            className="w-full bg-slate-800/50 border border-slate-600 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-blue-500 focus:bg-slate-800 transition-all text-white placeholder-slate-600"
                            placeholder="e.g. 07ffb4f17c..."
                        />
                    </div>
                </div>
                <button type="submit" disabled={isLoading} className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3.5 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]">
                    {isLoading ? loadingMsg : (<span>Continue <ArrowRight size={18} className="inline ml-1"/></span>)}
                </button>
            </form>
        )}

        {step === 'phone' && (
          <form onSubmit={handleSendCode} className="space-y-6">
            <div>
                 <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block ml-1">Phone Number</label>
                 <div className="relative group">
                    <Smartphone size={20} className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
                    <input 
                      type="tel" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-800/50 border border-slate-600 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-slate-800 transition-all text-white text-lg tracking-wide placeholder-slate-600"
                      placeholder="+1 234 567 8900"
                      autoFocus
                    />
                 </div>
            </div>
            <button 
              type="submit" 
              disabled={isLoading || !phone}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? loadingMsg : (<span>Next <ArrowRight size={18} className="inline ml-1"/></span>)}
            </button>
          </form>
        )}

        {(step === 'code' || step === 'password') && (
          <form onSubmit={step === 'code' ? handleVerify : handlePassword} className="space-y-8">
             {/* Delivery Warning */}
             {step === 'code' && deliveryMethod === 'app' && (
                 <div className="bg-yellow-500/20 border border-yellow-500/30 p-3 rounded-xl flex gap-3 items-start">
                     <AlertTriangle className="text-yellow-400 shrink-0" size={20} />
                     <div className="text-xs text-yellow-100">
                         <strong>Check Telegram App!</strong> <br/>
                         The code was sent to your logged-in Telegram devices, NOT via SMS.
                     </div>
                 </div>
             )}
             
             {step === 'code' && deliveryMethod === 'sms' && (
                 <div className="bg-green-500/20 border border-green-500/30 p-3 rounded-xl flex gap-3 items-center">
                     <MessageSquare className="text-green-400 shrink-0" size={20} />
                     <div className="text-xs text-green-100">
                         Code sent via SMS to {phone}
                     </div>
                 </div>
             )}

             <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 block text-center">
                    {step === 'code' ? 'Verification Code' : 'Password'}
                </label>
                <div className="flex justify-center">
                    <input 
                    type={step === 'password' ? 'password' : 'text'}
                    value={step === 'code' ? code : password}
                    onChange={(e) => step === 'code' ? setCode(e.target.value) : setPassword(e.target.value)}
                    className="w-full text-center text-4xl font-mono tracking-[0.5em] bg-transparent border-b-2 border-slate-600 focus:border-blue-500 outline-none pb-4 text-white transition-colors"
                    placeholder={step === 'code' ? "•••••" : "••••••"}
                    autoFocus
                    maxLength={step === 'code' ? 5 : undefined}
                    />
                </div>
             </div>
             <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isLoading ? <Lock size={18} className="animate-spin" /> : (step === 'code' ? 'Verify' : 'Unlock')}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm flex items-center justify-center gap-2 animate-pulse text-center">
             <div className="flex flex-col items-center gap-1">
                <WifiOff size={24} className="mb-1 opacity-70"/>
                <span>{error}</span>
                {(error.includes("taking too long") || error.includes("invalid") || error.includes("expired")) && (
                    <button onClick={handleResetSession} className="underline font-bold mt-1 text-red-300 hover:text-white">Start Over</button>
                )}
             </div>
          </div>
        )}

      </div>
      <div className="mt-8 text-slate-500 text-xs">
          Telegram Web Clone • Secure Connection • 2024
      </div>
    </div>
  );
}
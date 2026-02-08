import React, { useState, useEffect } from 'react';
import { ArrowRight, Lock, Smartphone, Key, WifiOff, Trash2, AlertTriangle, MessageSquare, Send, QrCode } from 'lucide-react';
import { initClient, getClient, saveSession, clearSession } from '../lib/telegramClient';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [step, setStep] = useState<'creds' | 'method' | 'phone' | 'qr' | 'code' | 'password'>('creds');
  
  // Default Creds
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<'sms' | 'app' | 'unknown'>('unknown');
  const [qrToken, setQrToken] = useState('');
  
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
      setIsLoading(false);
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
          setStep('method'); // Go to Method selection instead of Phone
      } catch (err: any) {
          handleError(err);
      } finally {
          setIsLoading(false);
      }
  };

  // Switch to Phone mode
  const handleMethodPhone = () => {
      setStep('phone');
  };

  // Switch to QR mode
  const handleMethodQR = () => {
      setStep('qr');
      startQrFlow();
  };

  // QR Logic
  const startQrFlow = async () => {
      setIsLoading(true);
      setLoadingMsg("Generating QR Code...");
      setError('');
      
      try {
          const client = getClient();
          // Use a type assertion for the new method
          const res: any = await (client as any).startQrLogin((token: string) => {
              setQrToken(token);
              setIsLoading(false); // Stop loading once QR is there
          });
          
          if (res.passwordNeeded) {
              setStep('password');
          } else {
              saveSession();
              onLoginSuccess();
          }
      } catch(err: any) {
          handleError(err);
      }
  };

  // Step 2: Send Code (Phone Mode)
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
          // signIn now handles sending password automatically via socket event
          await (client as any).signIn({
              password: password,
              // These are ignored if checking 2FA via QR, but needed for Phone Login 2FA
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
      <div className="w-full max-w-md bg-[#1e293b] rounded-2xl shadow-2xl p-8 border border-slate-700 relative transition-all duration-300">
        
        <button 
            onClick={handleResetSession}
            className="absolute top-4 right-4 p-2 text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 text-xs"
            title="Clear local session data"
        >
            <Trash2 size={16} />
            <span className="hidden sm:inline">Reset</span>
        </button>

        <div className="mb-6 text-center">
           <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-white fill-current transform -rotate-12">
                 <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-.94-2.4-1.54-1.06-.7-.37-1.09.23-1.72.14-.15 2.54-2.32 2.59-2.52.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.11.02-1.78 1.14-5.02 3.34-.48.33-.91.49-1.3.48-.42-.01-1.23-.24-1.83-.42-.73-.23-1.31-.35-1.26-.74.03-.2.3-.41.79-.63 3.1-1.34 5.17-2.23 6.23-2.66 2.95-1.23 3.57-1.44 3.97-1.44.09 0 .28.02.41.12.11.08.14.19.15.26.01.07.02.26.01.43z"/>
              </svg>
           </div>
           <h1 className="text-2xl font-bold mb-1 tracking-tight">Telegram Web</h1>
           <p className="text-slate-400 text-sm">
             {step === 'creds' && 'Enter API Credentials'}
             {step === 'method' && 'Choose Login Method'}
             {step === 'phone' && 'Sign in to Telegram'}
             {step === 'qr' && 'Scan QR Code'}
             {step === 'code' && `Enter the code`}
             {step === 'password' && 'Two-Step Verification'}
           </p>
        </div>

        {step === 'creds' && (
            <form onSubmit={handleInitClient} className="space-y-4">
                <div className="bg-blue-900/30 border border-blue-500/30 p-3 rounded-xl text-[11px] text-blue-200 leading-relaxed">
                    <strong>Developer Mode:</strong> Get API ID from <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">my.telegram.org</a>.
                </div>
                <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 block ml-1">App API ID</label>
                    <div className="relative">
                        <Key size={16} className="absolute left-3 top-3 text-slate-500" />
                        <input 
                            type="text" 
                            value={apiId}
                            onChange={(e) => setApiId(e.target.value)}
                            className="w-full bg-slate-800/50 border border-slate-600 rounded-lg py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-slate-800 transition-all text-white placeholder-slate-600"
                            placeholder="123456"
                        />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 block ml-1">App API Hash</label>
                    <div className="relative">
                        <Lock size={16} className="absolute left-3 top-3 text-slate-500" />
                        <input 
                            type="text" 
                            value={apiHash}
                            onChange={(e) => setApiHash(e.target.value)}
                            className="w-full bg-slate-800/50 border border-slate-600 rounded-lg py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-slate-800 transition-all text-white placeholder-slate-600"
                            placeholder="e.g. 07ffb4f17c..."
                        />
                    </div>
                </div>
                <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 transition-all mt-2">
                    {isLoading ? loadingMsg : (<span>Continue <ArrowRight size={16} className="inline ml-1"/></span>)}
                </button>
            </form>
        )}

        {step === 'method' && (
            <div className="space-y-4">
                <button onClick={handleMethodQR} className="w-full bg-blue-600 hover:bg-blue-500 p-4 rounded-xl flex items-center justify-between group transition-all border border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-lg"><QrCode className="text-white" size={24} /></div>
                        <div className="text-left">
                            <div className="font-bold text-lg">Login with QR Code</div>
                            <div className="text-xs text-blue-200">Scan from Settings &gt; Devices</div>
                        </div>
                    </div>
                    <ArrowRight className="text-white/50 group-hover:text-white" />
                </button>

                <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-600"></div>
                    <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase">Or</span>
                    <div className="flex-grow border-t border-slate-600"></div>
                </div>

                <button onClick={handleMethodPhone} className="w-full bg-slate-700 hover:bg-slate-600 p-4 rounded-xl flex items-center justify-between group transition-all border border-slate-600">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-800 p-2 rounded-lg"><Smartphone className="text-slate-300" size={24} /></div>
                        <div className="text-left">
                            <div className="font-bold text-lg text-slate-200">Phone Number</div>
                            <div className="text-xs text-slate-400">Receive code via App/SMS</div>
                        </div>
                    </div>
                    <ArrowRight className="text-slate-500 group-hover:text-white" />
                </button>
            </div>
        )}

        {step === 'qr' && (
            <div className="text-center">
                {isLoading && !qrToken ? (
                    <div className="py-12 flex flex-col items-center">
                        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-slate-400 text-sm">{loadingMsg}</p>
                    </div>
                ) : (
                    <div className="bg-white p-4 rounded-xl inline-block mb-4 shadow-xl">
                        {/* Use public API for QR generation to avoid heavy dependencies */}
                        <img 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=tg://login?token=${qrToken}`} 
                            alt="Scan QR Code" 
                            className="w-48 h-48"
                        />
                    </div>
                )}
                <div className="text-sm text-slate-300 space-y-1 mb-6">
                    <p>1. Open Telegram on your phone</p>
                    <p>2. Go to <strong>Settings</strong> {'>'} <strong>Devices</strong></p>
                    <p>3. Tap <strong>Link Desktop Device</strong></p>
                </div>
                <button onClick={() => setStep('method')} className="text-slate-500 hover:text-white text-sm underline">
                    Cancel
                </button>
            </div>
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
            <div className="flex flex-col gap-3">
                <button 
                type="submit" 
                disabled={isLoading || !phone}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                {isLoading ? loadingMsg : (<span>Next <ArrowRight size={18} className="inline ml-1"/></span>)}
                </button>
                <button type="button" onClick={() => setStep('method')} className="text-slate-500 hover:text-white text-sm">Back</button>
            </div>
          </form>
        )}

        {(step === 'code' || step === 'password') && (
          <form onSubmit={step === 'code' ? handleVerify : handlePassword} className="space-y-8">
             
             {step === 'code' && deliveryMethod === 'app' && (
                 <div className="bg-blue-500 p-4 rounded-xl flex flex-col gap-3 items-center text-center shadow-lg shadow-blue-500/20">
                     <div className="bg-white/20 p-3 rounded-full">
                         <Send className="text-white" size={32} />
                     </div>
                     <div>
                         <h3 className="font-bold text-lg text-white mb-1">Check Telegram App!</h3>
                         <p className="text-sm text-blue-100 leading-relaxed">
                            Code sent to Telegram App on your other device.
                         </p>
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
                    {step === 'code' ? 'Verification Code' : '2FA Password'}
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
    </div>
  );
}
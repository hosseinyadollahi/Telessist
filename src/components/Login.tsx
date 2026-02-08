import React, { useState } from 'react';
import { ArrowRight, Lock } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, user: any) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const API_URL = (import.meta as any).env.PROD ? '/api/auth' : 'http://localhost:3001/api/auth';

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      
      if (data.success) {
        setStep('code');
      } else {
        setError(data.error || 'Failed to send code');
      }
    } catch (err) {
      setError('Network error. Ensure Auth Service is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      
      if (data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLoginSuccess(data.token, data.user);
      } else {
        setError(data.error || 'Invalid code');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white text-black dark:bg-[#0f172a] dark:text-white transition-colors">
      <div className="w-full max-w-sm p-8 flex flex-col items-center">
        
        <div className="mb-8">
           <div className="w-40 h-40 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
              <svg viewBox="0 0 24 24" className="w-20 h-20 text-white fill-current">
                 <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-.94-2.4-1.54-1.06-.7-.37-1.09.23-1.72.14-.15 2.54-2.32 2.59-2.52.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.11.02-1.78 1.14-5.02 3.34-.48.33-.91.49-1.3.48-.42-.01-1.23-.24-1.83-.42-.73-.23-1.31-.35-1.26-.74.03-.2.3-.41.79-.63 3.1-1.34 5.17-2.23 6.23-2.66 2.95-1.23 3.57-1.44 3.97-1.44.09 0 .28.02.41.12.11.08.14.19.15.26.01.07.02.26.01.43z"/>
              </svg>
           </div>
           <h1 className="text-3xl font-bold text-center mb-2">Telegram Clone</h1>
           <p className="text-gray-500 text-center text-sm">
             {step === 'phone' ? 'Please confirm your country code and enter your phone number.' : `We have sent a code to ${phone}`}
           </p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={handleSendCode} className="w-full space-y-6">
            <div className="space-y-4">
               <div className="relative">
                  <label className="text-xs text-blue-500 absolute -top-2 left-3 bg-white dark:bg-[#0f172a] px-1">Country</label>
                  <div className="w-full border border-gray-300 dark:border-slate-600 rounded-lg p-3 flex items-center bg-transparent">
                     <span className="mr-2">🇮🇷</span>
                     <span className="text-lg">Iran</span>
                  </div>
               </div>
               
               <div className="flex gap-3">
                 <div className="w-24 border border-gray-300 dark:border-slate-600 rounded-lg p-3 flex items-center justify-center bg-transparent">
                    <span className="text-lg">+98</span>
                 </div>
                 <div className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg p-3 relative bg-transparent hover:border-blue-500 transition-colors">
                    <input 
                      type="tel" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-transparent outline-none text-lg"
                      placeholder="912 345 6789"
                      autoFocus
                    />
                 </div>
               </div>
            </div>

            <div className="flex items-center gap-2">
               <input type="checkbox" id="keep" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" defaultChecked />
               <label htmlFor="keep" className="text-sm text-gray-500">Keep me signed in</label>
            </div>

            <button 
              type="submit" 
              disabled={isLoading || !phone}
              className="w-full bg-blue-500 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase text-sm tracking-wider"
            >
              {isLoading ? 'Sending...' : 'Next'}
              {!isLoading && <ArrowRight size={18} />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="w-full space-y-8">
             <div className="flex justify-center">
                <input 
                  type="text" 
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={5}
                  className="w-40 text-center text-4xl tracking-[0.5em] bg-transparent border-b-2 border-gray-300 focus:border-blue-500 outline-none pb-2 font-mono"
                  placeholder="•••••"
                  autoFocus
                />
             </div>

             <button 
              type="submit" 
              disabled={isLoading || code.length !== 5}
              className="w-full bg-blue-500 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {isLoading ? <Lock size={18} className="animate-spin" /> : 'Start Messaging'}
            </button>

             <button 
               type="button" 
               onClick={() => setStep('phone')}
               className="w-full text-blue-500 text-sm font-medium hover:underline"
             >
               Edit Phone Number
             </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-600 rounded-lg text-sm text-center w-full">
            {error}
          </div>
        )}

      </div>
    </div>
  );
}
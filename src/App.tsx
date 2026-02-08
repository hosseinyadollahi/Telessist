import React, { useState, useEffect } from 'react';
import { Menu, Search, Phone, MoreVertical, Paperclip, Mic, Send, Smile, ArrowLeft, Users } from 'lucide-react';
import Login from './components/Login';
import { getClient, clearSession } from './lib/telegramClient';
import { Api } from 'telegram';
import { Buffer } from 'buffer';

// Make Buffer available globally for GramJS
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [dialogs, setDialogs] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<any>(null);
  const [inputValue, setInputValue] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const checkAuth = async () => {
        // Since we don't have API ID/Hash stored until login, we can only check session string existence
        // But to really check, we rely on the Login component passing success or initClient handling it.
        const session = localStorage.getItem("telegram_session");
        if(session) {
             // In a real app, we should re-init client here with stored creds. 
             // For this demo, we might force re-login if variable is lost on refresh 
             // or we need to persist API ID/Hash.
             // For safety, let's assume if we have a session string, we are "mostly" auth, 
             // but we need the client instance.
             // Best user flow: Login component handles the initial connection.
        }
    };
    checkAuth();
  }, []);

  const fetchDialogs = async () => {
      const client = getClient();
      if(!client) return;
      
      const me = await client.getMe();
      setCurrentUser(me);

      const dlgs = await client.getDialogs({ limit: 20 });
      setDialogs(dlgs);
  };

  const fetchMessages = async (chatId: any) => {
      const client = getClient();
      if(!client) return;
      
      const msgs = await client.getMessages(chatId, { limit: 50 });
      // Reverse to show newest at bottom
      setMessages(msgs.reverse());
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    fetchDialogs();
  };

  const handleLogout = async () => {
      const client = getClient();
      if(client) await client.disconnect();
      clearSession();
      setIsAuthenticated(false);
  };

  const handleChatSelect = (chat: any) => {
      setActiveChatId(chat.entity);
      fetchMessages(chat.entity);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !activeChatId) return;

    const client = getClient();
    if(!client) return;

    try {
        await client.sendMessage(activeChatId, { message: inputValue });
        setInputValue('');
        fetchMessages(activeChatId); // Refresh
    } catch (e) {
        console.error("Send error", e);
    }
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen w-full bg-[#0f172a] text-white overflow-hidden font-sans">
      
      {/* Sidebar - Contacts List */}
      <div className={`w-full md:w-[400px] border-r border-slate-700 flex flex-col bg-[#1e293b] ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-3 flex items-center gap-3 bg-[#1e293b]">
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-slate-700 rounded-full text-slate-400"
            title="Menu (Click to Logout)"
          >
            <Menu size={24} />
          </button>
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Search" 
              className="w-full bg-[#0f172a] text-sm text-white rounded-full py-2 pl-10 pr-4 focus:outline-none border border-transparent focus:border-blue-500"
            />
            <Search size={18} className="absolute left-3 top-2.5 text-slate-500" />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {dialogs.map((dialog) => (
            <div 
              key={dialog.id} 
              onClick={() => handleChatSelect(dialog)}
              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-[#2c374b] transition-colors ${activeChatId === dialog.entity ? 'bg-[#334155]' : ''}`}
            >
              <div className="relative shrink-0">
                {/* Simplified Avatar Logic */}
                <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-bold">
                    {dialog.title ? dialog.title[0] : '?'}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="font-semibold text-sm truncate">{dialog.title || 'Unknown'}</h3>
                  <span className="text-xs text-slate-400">
                    {dialog.date ? new Date(dialog.date * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-slate-400 text-sm truncate pr-2">{dialog.message?.message || 'Media/Sticker'}</p>
                  {dialog.unreadCount > 0 && (
                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                      {dialog.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-[#0f172a] ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {activeChatId ? (
          <>
            {/* Chat Header */}
            <div className="h-16 border-b border-slate-700 flex items-center justify-between px-4 bg-[#1e293b]">
              <div className="flex items-center gap-3">
                <button className="md:hidden mr-1" onClick={() => setActiveChatId(null)}>
                  <ArrowLeft size={24} className="text-slate-400" />
                </button>
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">Chat</span>
                  <span className="text-xs text-slate-400">Telegram Network</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-slate-400">
                <Phone size={20} className="cursor-pointer hover:text-white" />
                <Search size={20} className="cursor-pointer hover:text-white" />
                <MoreVertical size={20} className="cursor-pointer hover:text-white" />
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0f172a] bg-opacity-95" style={{backgroundImage: 'url("https://web.telegram.org/img/bg_0.png")', backgroundBlendMode: 'overlay'}}>
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.out ? 'justify-end' : 'justify-start'}`}>
                  <div 
                    className={`max-w-[70%] md:max-w-[50%] p-2 rounded-lg relative group ${
                      msg.out
                        ? 'bg-blue-600 rounded-tr-none text-white' 
                        : 'bg-[#1e293b] rounded-tl-none text-white'
                    }`}
                  >
                    <p className="text-sm leading-relaxed pb-2">{msg.message || '<Media Content>'}</p>
                    <span className={`text-[10px] absolute bottom-1 right-2 ${msg.out ? 'text-blue-200' : 'text-slate-400'}`}>
                       {new Date(msg.date * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="p-2 bg-[#1e293b]">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2 max-w-4xl mx-auto">
                <button type="button" className="p-2 text-slate-400 hover:text-white transition-colors">
                  <Paperclip size={22} />
                </button>
                <div className="flex-1 relative">
                    <input 
                      type="text" 
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Write a message..."
                      className="w-full bg-[#0f172a] text-white rounded-lg py-3 pl-4 pr-10 focus:outline-none"
                    />
                    <Smile size={20} className="absolute right-3 top-3 text-slate-400 cursor-pointer hover:text-white" />
                </div>
                {inputValue.trim() ? (
                  <button type="submit" className="p-3 bg-blue-500 rounded-full text-white hover:bg-blue-600 transition-colors shadow-lg">
                    <Send size={20} className="ml-0.5" />
                  </button>
                ) : (
                   <button type="button" className="p-3 bg-[#2c374b] rounded-full text-white hover:bg-[#374151] transition-colors">
                    <Mic size={22} />
                  </button>
                )}
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-[#0f172a]">
            <div className="bg-[#1e293b] p-6 rounded-full mb-4 relative">
               <Users size={48} />
               <div className="absolute -top-2 -right-2 bg-green-500 w-4 h-4 rounded-full border-2 border-[#1e293b]"></div>
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Welcome {currentUser?.firstName}</h2>
            <p className="text-sm bg-[#1e293b] px-4 py-1 rounded-full">Select a chat to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
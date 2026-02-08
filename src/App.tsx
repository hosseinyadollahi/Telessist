import React, { useState, useEffect } from 'react';
import { Menu, Search, Phone, MoreVertical, Paperclip, Mic, Send, Smile, ArrowLeft, Users } from 'lucide-react';
import { io } from 'socket.io-client';
import Login from './components/Login';

// Types
interface Message {
  id: number;
  text: string;
  sender: 'me' | 'other';
  time: string;
}

interface ChatPreview {
  id: number;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
  online: boolean;
}

interface User {
  id: number;
  phone: string;
  avatar: string;
}

// Mock Data
const MOCK_CHATS: ChatPreview[] = [
  { id: 1, name: 'Saved Messages', avatar: 'https://ui-avatars.com/api/?name=SM&background=3b82f6&color=fff', lastMessage: 'Image.jpg', time: '12:30', unread: 0, online: true },
  { id: 2, name: 'Frontend Team', avatar: 'https://ui-avatars.com/api/?name=FT&background=10b981&color=fff', lastMessage: 'Deploying to production...', time: '11:45', unread: 3, online: true },
  { id: 3, name: 'Alice Smith', avatar: 'https://ui-avatars.com/api/?name=AS&background=f59e0b&color=fff', lastMessage: 'Can we meet tomorrow?', time: 'Yesterday', unread: 0, online: false },
  { id: 4, name: 'Project X Updates', avatar: 'https://ui-avatars.com/api/?name=PX&background=8b5cf6&color=fff', lastMessage: 'New milestones added.', time: 'Mon', unread: 12, online: true },
];

const MOCK_MESSAGES: Message[] = [
  { id: 1, text: 'Hey there! How is the new server setup coming along?', sender: 'other', time: '10:00' },
  { id: 2, text: 'It is going great. We are using a microservices architecture with Nginx and Postgres.', sender: 'me', time: '10:01' },
  { id: 3, text: 'That sounds robust. Did you use the setup script?', sender: 'other', time: '10:02' },
  { id: 4, text: 'Yes, it automated everything from Node installation to PM2 config.', sender: 'me', time: '10:05' },
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeChat, setActiveChat] = useState<ChatPreview | null>(null);
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [inputValue, setInputValue] = useState('');
  const [socket, setSocket] = useState<any>(null);

  useEffect(() => {
    // Check local storage for token
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      setIsAuthenticated(true);
      setCurrentUser(JSON.parse(userStr));
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Initialize Socket.io connection
    const SOCKET_URL = (import.meta as any).env.PROD ? '/' : 'http://localhost:3002';
    const newSocket = io(SOCKET_URL); 
    setSocket(newSocket);
    
    return () => {
       newSocket.close();
    };
  }, [isAuthenticated]);

  const handleLoginSuccess = (token: string, user: any) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setActiveChat(null);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now(),
      text: inputValue,
      sender: 'me',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages([...messages, newMessage]);
    setInputValue('');
    
    // In real app: socket.emit('send_message', { chatId: activeChat?.id, text: inputValue, userId: currentUser?.id });
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen w-full bg-[#0f172a] text-white overflow-hidden font-sans">
      
      {/* Sidebar - Contacts List */}
      <div className={`w-full md:w-[400px] border-r border-slate-700 flex flex-col bg-[#1e293b] ${activeChat ? 'hidden md:flex' : 'flex'}`}>
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
          {MOCK_CHATS.map((chat) => (
            <div 
              key={chat.id} 
              onClick={() => setActiveChat(chat)}
              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-[#2c374b] transition-colors ${activeChat?.id === chat.id ? 'bg-[#334155]' : ''}`}
            >
              <div className="relative">
                <img src={chat.avatar} alt={chat.name} className="w-12 h-12 rounded-full bg-slate-800" />
                {chat.online && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1e293b]"></div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="font-semibold text-sm truncate">{chat.name}</h3>
                  <span className="text-xs text-slate-400">{chat.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-slate-400 text-sm truncate pr-2">{chat.lastMessage}</p>
                  {chat.unread > 0 && (
                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-[#0f172a] ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="h-16 border-b border-slate-700 flex items-center justify-between px-4 bg-[#1e293b]">
              <div className="flex items-center gap-3">
                <button className="md:hidden mr-1" onClick={() => setActiveChat(null)}>
                  <ArrowLeft size={24} className="text-slate-400" />
                </button>
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">{activeChat.name}</span>
                  <span className="text-xs text-slate-400">{activeChat.online ? 'online' : 'last seen recently'}</span>
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
               {/* Date Separator Example */}
               <div className="flex justify-center my-4">
                  <span className="bg-[#1e293b] text-slate-300 text-xs px-3 py-1 rounded-full opacity-70">Today</span>
               </div>

              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div 
                    className={`max-w-[70%] md:max-w-[50%] p-2 rounded-lg relative group ${
                      msg.sender === 'me' 
                        ? 'bg-blue-600 rounded-tr-none text-white' 
                        : 'bg-[#1e293b] rounded-tl-none text-white'
                    }`}
                  >
                    <p className="text-sm leading-relaxed pb-2">{msg.text}</p>
                    <span className={`text-[10px] absolute bottom-1 right-2 ${msg.sender === 'me' ? 'text-blue-200' : 'text-slate-400'}`}>
                      {msg.time}
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
            <h2 className="text-lg font-semibold text-white mb-2">Welcome {currentUser?.phone}</h2>
            <p className="text-sm bg-[#1e293b] px-4 py-1 rounded-full">Select a chat to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
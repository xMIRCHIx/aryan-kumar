import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { Send, LogOut, Menu, X, Image as ImageIcon, Smile } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { Search } from './Search';
import EmojiPicker, { Theme } from 'emoji-picker-react';

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  last_seen_at: string | null;
}

interface Message {
  id: string;
  conversation_id: string;
  content: string;
  image_url: string | null;
  sender_id: string;
  created_at: string;
  status?: 'sending' | 'sent';
  local_image_url?: string;
}

export function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<Record<string, boolean>>({});
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Presence setup
  useEffect(() => {
    if (!user) return;
    let mounted = true;

    const presenceChannel = supabase.channel('online-users');
    
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        if (mounted) {
          const state = presenceChannel.presenceState();
          const active: Record<string, boolean> = {};
          for (const key in state) {
            state[key].forEach((presence: any) => {
              if (presence.user_id) active[presence.user_id] = true;
            });
          }
          setOnlineUsers(active);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(presenceChannel);
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
    };
  }, [user]);

  // Conversation setup
  useEffect(() => {
    if (!user || !selectedUser) return;
    let mounted = true;

    const setupConversation = async () => {
      // Deterministic order for conversation unique key
      const [u1, u2] = [user.id, selectedUser.id].sort();

      // Check if conversation exists
      let { data: convData, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .eq('user1_id', u1)
        .eq('user2_id', u2)
        .single();

      if (!convData) {
        // Create it
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({ user1_id: u1, user2_id: u2 })
          .select()
          .single();
        convData = newConv;
      }

      if (mounted && convData) {
        setConversationId(convData.id);
        
        // Fetch messages
        const { data: msgData } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', convData.id)
          .order('created_at', { ascending: true })
          .limit(100);
          
        if (msgData) setMessages(msgData as Message[]);
      }
    };

    setupConversation();
  }, [user, selectedUser]);

  // Subscribe to new messages for active conversation
  useEffect(() => {
    if (!conversationId || !user || !selectedUser) return;

    const messageSubscription = supabase
      .channel('public:messages')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const newMsg = payload.new as Message;
        
        setMessages(prev => {
          // Replace optimistic message if it exists
          if (prev.some(m => m.id === newMsg.id || (m.status === 'sending' && m.content === newMsg.content && !m.image_url))) {
             return prev.map(m => (m.status === 'sending' && m.content === newMsg.content && !m.image_url) ? newMsg : m);
          }
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(messageSubscription);
    };
  }, [conversationId, user, selectedUser]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!newMessage.trim() && !isUploading) || !user || !conversationId) return;

    const content = newMessage.trim();
    setNewMessage('');
    setShowEmojiPicker(false);

    // Optimistic UI update
    const tempId = crypto.randomUUID();
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      image_url: null,
      created_at: new Date().toISOString(),
      status: 'sending'
    };
    
    setMessages(prev => [...prev, optimisticMsg]);

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content
    });
    
    if (error) {
      console.error("Error sending message:", error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !conversationId) return;

    setIsUploading(true);
    
    // Create optimistic local image URL
    const localUrl = URL.createObjectURL(file);
    const tempId = crypto.randomUUID();
    
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: '',
      image_url: null,
      local_image_url: localUrl,
      created_at: new Date().toISOString(),
      status: 'sending'
    };
    
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      const { error: dbError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: '',
        image_url: publicUrl
      });

      if (dbError) throw dbError;
      
      // Cleanup optimistic local url
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } catch (error) {
      console.error("Error uploading image:", error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const onEmojiClick = (emojiObject: any) => {
    setNewMessage(prev => prev + emojiObject.emoji);
  };

  return (
    <div className="flex h-screen w-full bg-[#f8f9fc] font-sans text-slate-800 overflow-hidden selection:bg-indigo-100 selection:text-indigo-900">
      
      {/* Mobile search toggle overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 md:hidden bg-slate-900/20 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Container */}
      <motion.aside
        initial={{ x: "-100%" }}
        animate={{ x: isSidebarOpen ? 0 : 0 }}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex transition-transform duration-300 ease-in-out md:static md:translate-x-0"
        )}
        style={{ transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        <style dangerouslySetInnerHTML={{__html: `
          @media (min-width: 768px) { aside { transform: none !important; } }
        `}} />
        
        {user && (
          <Search 
            currentUserId={user.id} 
            onlineUsers={onlineUsers} 
            onSelectUser={(u) => { setSelectedUser(u); setIsSidebarOpen(false); }}
            selectedUserId={selectedUser?.id}
          />
        )}
      </motion.aside>

      {/* Main Chat Area */}
      <main className="flex flex-1 flex-col min-w-0 relative">
        {selectedUser ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex-1 flex flex-col m-2 sm:m-4 bg-white/70 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl overflow-hidden"
          >
            {/* Header */}
            <header className="flex h-20 shrink-0 items-center justify-between px-6 sm:px-8 border-b border-slate-100/50 bg-white/40">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  className="md:hidden text-slate-400 hover:text-slate-700 bg-white shadow-sm p-2 rounded-full"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="relative">
                  <div className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-medium flex items-center justify-center shadow-md">
                     {selectedUser.avatar_url ? (
                        <img src={selectedUser.avatar_url} alt={selectedUser.username} className="w-full h-full rounded-full object-cover" />
                     ) : (
                        <span className="text-xl">{selectedUser.username?.charAt(0).toUpperCase()}</span>
                     )}
                  </div>
                  <span className={cn(
                    "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm",
                    onlineUsers[selectedUser.id] ? "bg-emerald-400" : "bg-slate-300"
                  )} />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-800 tracking-tight">{selectedUser.username}</h1>
                  <p className="text-xs font-medium text-slate-400">
                    {onlineUsers[selectedUser.id] 
                      ? 'Online' 
                      : selectedUser.last_seen_at 
                        ? `Seen ${formatDistanceToNow(new Date(selectedUser.last_seen_at))} ago` 
                        : 'Offline'}
                  </p>
                </div>
              </div>
              <button onClick={handleSignOut} className="text-slate-400 hover:text-slate-700 p-2 transition-colors">
                 <LogOut className="h-5 w-5" />
              </button>
            </header>

            {/* Message List */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((msg, index) => {
                  const isMe = msg.sender_id === user?.id;
                  const showHeader = index === 0 || messages[index - 1].sender_id !== msg.sender_id || 
                      (new Date(msg.created_at).getTime() - new Date(messages[index - 1].created_at).getTime() > 5 * 60 * 1000);

                  return (
                    <motion.div 
                      key={msg.id}
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      layout
                      className={cn("flex flex-col max-w-[85%] sm:max-w-[65%]", isMe ? "ml-auto items-end" : "mr-auto items-start")}
                    >
                      {showHeader && !isMe && (
                        <div className="mb-1.5 flex items-baseline gap-2">
                          <span className="text-[13px] font-semibold text-slate-600">{selectedUser.username}</span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                      {showHeader && isMe && (
                        <div className="mb-1.5 flex items-baseline gap-2 flex-row-reverse">
                          <span className="text-[10px] text-slate-400 font-medium">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                      
                      <div className={cn(
                        "relative px-5 py-3.5 text-[15px] leading-relaxed shadow-sm",
                        isMe 
                          ? "bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white rounded-2xl rounded-tr-sm shadow-indigo-500/20" 
                          : "bg-white text-slate-700 rounded-2xl rounded-tl-sm border border-slate-100"
                      )}>
                        {msg.local_image_url || msg.image_url ? (
                          <div className={cn(
                            "rounded-xl overflow-hidden mb-1 min-w-[200px] bg-black/5",
                            msg.status === 'sending' && "blur-md transition-all opacity-80"
                          )}>
                             <img src={msg.image_url || msg.local_image_url} alt="Uploaded content" className="w-full h-auto max-h-64 object-contain" />
                          </div>
                        ) : null}
                        {msg.content && <p>{msg.content}</p>}
                        
                        {msg.status === 'sending' && !msg.image_url && !msg.local_image_url && (
                           <span className="absolute -bottom-5 right-1 text-[10px] text-slate-400 italic">Sending...</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="shrink-0 p-4 sm:p-6 bg-white/30 backdrop-blur-md rounded-b-3xl">
              <form onSubmit={handleSendMessage} className="relative flex items-end gap-2">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                />
                
                <div className="relative flex-1 bg-white border border-slate-200/60 rounded-3xl shadow-sm text-slate-700 flex items-end pr-2 transition-all focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
                  <button
                    type="button"
                    title="Upload Image"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 text-slate-400 hover:text-indigo-500 transition-colors shrink-0"
                  >
                    <ImageIcon className="h-5 w-5" />
                  </button>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Message..."
                    className="w-full bg-transparent border-none p-3 pl-1 resize-none h-12 max-h-32 min-h-12 outline-none placeholder:text-slate-400 text-[15px]"
                  />
                  <div className="relative shrink-0 pb-1.5 pr-1">
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
                    >
                      <Smile className="h-5 w-5" />
                    </button>
                    {showEmojiPicker && (
                      <div className="absolute bottom-full right-0 mb-4 shadow-2xl rounded-[30px] border border-slate-100 overflow-hidden z-50">
                         <EmojiPicker onEmojiClick={onEmojiClick} theme={Theme.LIGHT} />
                      </div>
                    )}
                  </div>
                </div>
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={(!newMessage.trim() && !isUploading)}
                  className="shrink-0 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 transition-all hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 focus:outline-none"
                >
                  <Send className="h-4 w-4 ml-0.5" />
                </motion.button>
              </form>
            </div>
          </motion.div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center m-2 sm:m-4 bg-white/40 backdrop-blur-md rounded-3xl border border-white/50 shadow-sm">
             <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
                <Menu className="w-10 h-10 text-indigo-300" />
             </div>
             <h2 className="text-2xl font-bold text-slate-800 tracking-tight mb-2">Your Messages</h2>
             <p className="text-slate-500 max-w-sm">Select a colleague from the sidebar to start a private conversation.</p>
             <button 
              onClick={() => setIsSidebarOpen(true)}
              className="mt-8 md:hidden px-6 py-2.5 bg-white shadow-sm border border-slate-200 rounded-full text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
             >
               View Contacts
             </button>
             
             <button onClick={handleSignOut} className="absolute top-6 right-6 text-slate-400 hover:text-slate-700 p-2 bg-white/50 rounded-full shadow-sm">
                 <LogOut className="h-5 w-5" />
             </button>
          </div>
        )}
      </main>
    </div>
  );
}

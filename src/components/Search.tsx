import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Search as SearchIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  last_seen_at: string | null;
}

interface SearchProps {
  currentUserId: string;
  onlineUsers: Record<string, boolean>;
  onSelectUser: (user: Profile) => void;
  selectedUserId?: string;
}

export function Search({ currentUserId, onlineUsers, onSelectUser, selectedUserId }: SearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const searchUsers = async () => {
      setLoading(true);
      try {
        let query = supabase.from('profiles').select('*').neq('id', currentUserId);
        
        if (searchTerm.trim()) {
          query = query.ilike('username', `%${searchTerm}%`);
        }
        
        const { data, error } = await query.limit(20);
        
        if (data && !error) {
          setProfiles(data);
        }
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchUsers, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchTerm, currentUserId]);

  return (
    <div className="flex w-72 flex-col border-r border-white/20 bg-white/40 backdrop-blur-3xl shadow-[4px_0_24px_rgb(0,0,0,0.02)] z-10 w-full sm:w-80">
      <div className="p-6 pb-2">
        <h2 className="text-xl font-semibold text-slate-800 tracking-tight mb-4">Messages</h2>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-full border border-slate-200/60 bg-white/60 py-2.5 pl-10 pr-4 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="text-center text-xs text-slate-400 mt-4">Searching...</div>
        ) : profiles.length === 0 ? (
          <div className="text-center text-xs text-slate-400 mt-4">No users found.</div>
        ) : (
          profiles.map(profile => {
            const isOnline = !!onlineUsers[profile.id];
            const isSelected = selectedUserId === profile.id;

            return (
              <motion.button
                key={profile.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectUser(profile)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all",
                  isSelected 
                    ? "bg-indigo-50 shadow-sm border border-indigo-100" 
                    : "hover:bg-white/50 border border-transparent"
                )}
              >
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-medium shadow-md">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt={profile.username} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    profile.username?.charAt(0).toUpperCase() || 'U'
                  )}
                  <span className={cn(
                    "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white shadow-sm",
                    isOnline ? "bg-emerald-400" : "bg-slate-300"
                  )} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className={cn("truncate text-[15px] font-medium", isSelected ? "text-indigo-900" : "text-slate-700")}>
                    {profile.username}
                  </span>
                  <span className="truncate text-xs text-slate-400">
                    {isOnline 
                      ? "Online now" 
                      : profile.last_seen_at 
                        ? `Seen ${formatDistanceToNow(new Date(profile.last_seen_at))} ago`
                        : "Offline"}
                  </span>
                </div>
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
}

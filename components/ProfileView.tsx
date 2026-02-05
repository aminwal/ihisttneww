
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { BiometricService } from '../services/biometricService.ts';
import { HapticService } from '../services/hapticService.ts';

interface ProfileViewProps {
  user: User;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  config: SchoolConfig;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const ProfileView: React.FC<ProfileViewProps> = ({ user, setUsers, setCurrentUser, config, isSandbox, addSandboxLog }) => {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState(user.password || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || '');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info', message: string } | null>(null);
  
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);

  useEffect(() => {
    BiometricService.isSupported().then(setBiometricSupported);
    setBiometricEnrolled(BiometricService.isEnrolled(user.id));
  }, [user.id]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const payload = { email, password, phone_number: phoneNumber || null };
      if (IS_CLOUD_ENABLED && !isSandbox) {
        const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('PROFILE_UPDATE', payload);
      }
      const updatedUser = { ...user, email, password, phone_number: phoneNumber };
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      setCurrentUser(updatedUser);
      setStatus({ type: 'success', message: 'Institutional profile synchronized.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Institutional Handshake Error.' });
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Staff <span className="text-[#d4af37]">Profile</span></h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Personnel Identity Control</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-black text-[#001f3f] dark:text-amber-400 uppercase tracking-[0.3em] mb-8 italic">Registry Details</h3>
          <form onSubmit={handleUpdate} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Official ID</label>
              <input type="text" value={user.employeeId} readOnly className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl font-black text-xs text-slate-400 outline-none" />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-xs outline-none focus:border-amber-400 transition-all shadow-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Portal Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-xs outline-none focus:border-amber-400 transition-all shadow-sm" />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all">
              {loading ? 'Syncing...' : 'Update Registry'}
            </button>
          </form>
        </div>

        <div className="space-y-8">
          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] mb-4 italic">Telegram Matrix</h3>
            {user.telegram_chat_id ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
                <p className="text-emerald-400 text-[10px] font-black uppercase tracking-widest">Signal Connection: Secured</p>
              </div>
            ) : (
              <p className="text-xs text-white/50 italic leading-relaxed mb-6">Link Telegram to receive instant proxy duty alerts and schedule changes.</p>
            )}
            <button className="w-full bg-white/5 hover:bg-white/10 text-white border border-white/10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all">
              {user.telegram_chat_id ? 'Re-Sync Telegram' : 'Establish Signal Link'}
            </button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2">Build Integrity</p>
            <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">IHIS Matrix Gateway v6.1</p>
          </div>
        </div>
      </div>
      
      {status && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-bottom-4 transition-all z-[2000] ${status.type === 'success' ? 'bg-emerald-600 text-white' : status.type === 'warning' ? 'bg-amber-50 text-white' : 'bg-rose-600 text-white'}`}>
           <p className="text-xs font-black uppercase tracking-widest">{status.message}</p>
        </div>
      )}
    </div>
  );
};

export default ProfileView;

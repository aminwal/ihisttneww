
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { BiometricService } from '../services/biometricService.ts';
import { HapticService } from '../services/hapticService.ts';
import { TelegramService } from '../services/telegramService.ts';

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
  const [isPollingTelegram, setIsPollingTelegram] = useState(false);

  useEffect(() => {
    BiometricService.isSupported().then(setBiometricSupported);
    setBiometricEnrolled(BiometricService.isEnrolled(user.id));
  }, [user.id]);

  const handleEnrollBiometrics = async () => {
    setLoading(true);
    const success = await BiometricService.register(user.id, user.name);
    if (success) {
      setBiometricEnrolled(true);
      showToast("Biometric Identity Secured", "success");
      HapticService.success();
    } else {
      showToast("Identity handshake failed", "error");
      HapticService.error();
    }
    setLoading(false);
  };

  const handleTelegramSync = async () => {
    if (!config.telegramBotToken || !config.telegramBotUsername) {
      showToast("Matrix Messaging offline. Contact Administrator.", "error");
      return;
    }

    const botUrl = `https://t.me/${config.telegramBotUsername}?start=${user.id}`;
    window.open(botUrl, '_blank');
    
    setIsPollingTelegram(true);
    showToast("Awaiting Matrix Ping. Press 'Start' in Telegram.", "info");

    let attempts = 0;
    const maxAttempts = 12; // 60 seconds total polling (12 * 5s)

    const pollTimer = setInterval(async () => {
      attempts++;
      try {
        const chatId = await TelegramService.checkUpdatesForSync(config.telegramBotToken!, user.id);
        if (chatId) {
          clearInterval(pollTimer);
          setIsPollingTelegram(false);
          
          const payload = { telegram_chat_id: chatId };
          if (IS_CLOUD_ENABLED && !isSandbox) {
            await supabase.from('profiles').update(payload).eq('id', user.id);
          } else if (isSandbox) {
            addSandboxLog?.('TELEGRAM_SYNC', payload);
          }
          
          const updatedUser = { ...user, telegram_chat_id: chatId };
          setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
          setCurrentUser(updatedUser);
          
          showToast("Matrix Signal Established!", "success");
          HapticService.success();

          // Dispatch the verification confirmation directly to the user's Telegram app
          await TelegramService.sendTestSignal(config.telegramBotToken!, chatId, user.name);
          
        } else if (attempts >= maxAttempts) {
          clearInterval(pollTimer);
          setIsPollingTelegram(false);
          showToast("Handshake timeout. Try again.", "warning");
        }
      } catch (err) {
        clearInterval(pollTimer);
        setIsPollingTelegram(false);
        showToast("Signal Intercepted. Handshake failed.", "error");
      }
    }, 5000);
  };

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

  const showToast = (message: string, type: any = 'success') => {
    setStatus({ message, type });
    setTimeout(() => setStatus(null), 4000);
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
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] mb-4 italic">Security Matrix</h3>
            <div className="space-y-4">
               <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Passkey Protection</p>
                  <p className="text-[11px] text-white/60 font-medium italic mb-4">Link this device using fingerprint or face recognition for secure login (Rule 6).</p>
                  <button 
                    onClick={handleEnrollBiometrics}
                    disabled={biometricEnrolled || !biometricSupported || loading}
                    type="button"
                    className={`w-full py-4 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${biometricEnrolled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-400 text-[#001f3f] shadow-lg active:scale-95'}`}
                  >
                    {biometricEnrolled ? '✓ Device Secured' : biometricSupported ? 'Enroll This Device' : 'Not Supported'}
                  </button>
               </div>
               
               <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                  <p className="text-[10px] font-black text-sky-500 uppercase tracking-widest mb-1">Telegram Matrix</p>
                  <p className="text-[11px] text-white/60 font-medium italic mb-4">Link Telegram to receive instant proxy duty alerts and schedule changes.</p>
                  <button 
                    onClick={handleTelegramSync}
                    disabled={isPollingTelegram}
                    type="button"
                    className={`w-full py-4 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:animate-pulse ${
                      user.telegram_chat_id && !isPollingTelegram
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                        : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                    }`}
                  >
                    {isPollingTelegram ? 'Awaiting Signal...' : user.telegram_chat_id ? '✓ Signal Linked (Re-Sync)' : 'Establish Signal Link'}
                  </button>
               </div>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-[3rem] border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2">Build Integrity</p>
            <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">IHIS Matrix Gateway v7.0</p>
          </div>
        </div>
      </div>
      
      {status && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-bottom-4 transition-all z-[2000] ${status.type === 'success' ? 'bg-emerald-600 text-white' : status.type === 'info' ? 'bg-sky-600 text-white' : 'bg-rose-600 text-white'}`}>
           <p className="text-xs font-black uppercase tracking-widest">{status.message}</p>
        </div>
      )}
    </div>
  );
};

export default ProfileView;

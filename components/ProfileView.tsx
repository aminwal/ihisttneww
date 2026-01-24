
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { BiometricService } from '../services/biometricService.ts';
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

  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    BiometricService.isSupported().then(setBiometricSupported);
    setBiometricEnrolled(BiometricService.isEnrolled(user.id));
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [user.id]);

  const onboardingSteps = useMemo(() => [
    { label: 'Identity Verified', status: !!user.email, icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { label: 'Biometrics Active', status: biometricEnrolled, icon: 'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z' },
    { label: 'Telegram Matrix', status: !!user.telegram_chat_id, icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z' }
  ], [user.email, user.telegram_chat_id, biometricEnrolled]);

  const handleSyncTelegram = () => {
    if (!config.telegramBotUsername || !config.telegramBotToken) {
      setStatus({ type: 'warning', message: 'System Admin has not configured the Bot credentials.' });
      return;
    }
    setIsSyncingTelegram(true);
    setStatus({ type: 'info', message: 'Discovery Active: Waiting for Telegram signal...' });
    const botUrl = `https://t.me/${config.telegramBotUsername}?start=${user.id}`;
    window.open(botUrl, '_blank');
    let attempts = 0;
    const MAX_ATTEMPTS = 40;
    pollIntervalRef.current = window.setInterval(async () => {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        stopSyncPolling("Discovery Timed Out. Please try again.");
        return;
      }
      const discoveredChatId = await TelegramService.checkUpdatesForSync(config.telegramBotToken!, user.id);
      if (discoveredChatId) {
        clearInterval(pollIntervalRef.current!);
        pollIntervalRef.current = null;
        await saveTelegramId(discoveredChatId);
      }
    }, 3000);
  };

  const stopSyncPolling = (msg: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
    setIsSyncingTelegram(false);
    setStatus({ type: 'error', message: msg });
  };

  const saveTelegramId = async (chatId: string) => {
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) await supabase.from('profiles').update({ telegram_chat_id: chatId }).eq('id', user.id);
      else if (isSandbox) addSandboxLog?.('TELEGRAM_SYNC', { chatId });

      const updatedUser = { ...user, telegram_chat_id: chatId };
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      setCurrentUser(updatedUser);
      if (!isSandbox) await TelegramService.sendTestSignal(config.telegramBotToken!, chatId, user.name);
      setIsSyncingTelegram(false);
      setStatus({ type: 'success', message: 'Telegram Matrix Linked Successfully.' });
    } catch (err) { stopSyncPolling("Failed to save credentials."); }
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

  const handleBiometricToggle = async () => {
    if (biometricEnrolled) {
      BiometricService.unenroll(user.id);
      setBiometricEnrolled(false);
      setStatus({ type: 'success', message: 'Biometric access disabled.' });
    } else {
      const success = await BiometricService.register(user.id, user.name);
      if (success) {
        setBiometricEnrolled(true);
        setStatus({ type: 'success', message: 'Biometric identity authorized.' });
      } else {
        setStatus({ type: 'error', message: 'Biometric enrollment failed.' });
      }
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 px-2">
      <div className="text-center">
        <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Personal <span className="text-[#d4af37]">Identity</span></h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Personnel Diagnostics Hub</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800">
         <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] mb-8 text-center italic">Institutional Onboarding Protocol</p>
         <div className="flex items-center justify-between relative px-4">
            <div className="absolute left-8 right-8 top-5 h-[2px] bg-slate-100 dark:bg-slate-800 -z-0"></div>
            {onboardingSteps.map((step, idx) => (
              <div key={idx} className="relative z-10 flex flex-col items-center gap-3">
                 <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 transition-all duration-700 ${step.status ? 'bg-emerald-500 border-emerald-100 dark:border-emerald-900 text-white' : 'bg-white dark:bg-slate-800 border-slate-50 dark:border-slate-700 text-slate-300'}`}>
                    {step.status ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={step.icon}/></svg>
                    )}
                 </div>
                 <span className={`text-[8px] font-black uppercase tracking-tighter text-center max-w-[60px] ${step.status ? 'text-emerald-600' : 'text-slate-400'}`}>{step.label}</span>
              </div>
            ))}
         </div>
      </div>

      <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 space-y-6 relative overflow-hidden group">
         <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none group-hover:scale-110 transition-transform"><svg className="w-20 h-20 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg></div>
         <div className="relative z-10 space-y-5">
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-[0.2em] italic">Telegram Matrix Link</h3>
            {user.telegram_chat_id ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 flex items-center justify-between">
                <div><p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Status: Matrix Active</p><p className="text-[8px] text-white/40 mt-1 uppercase font-bold">Encrypted ID: {user.telegram_chat_id.substring(0,4)}****</p></div>
                <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg></div>
              </div>
            ) : (
              <div className="space-y-4">
                 <p className="text-xs font-medium text-white/70 leading-relaxed italic">Link your Telegram account for instant proxy alerts.</p>
                 <button onClick={handleSyncTelegram} disabled={isSyncingTelegram} className={`w-full flex items-center justify-center gap-3 py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl ${isSyncingTelegram ? 'bg-amber-400 text-[#001f3f] animate-pulse' : 'bg-[#0088cc] text-white'}`}>{isSyncingTelegram ? 'Polling Matrix...' : 'Sync Telegram Account'}</button>
              </div>
            )}
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800">
        <div className="flex flex-col items-center mb-10"><div className="w-20 h-20 bg-[#001f3f] text-[#d4af37] rounded-3xl flex items-center justify-center font-black text-2xl shadow-xl mb-4 border-2 border-amber-400/20">{user.name.substring(0, 2)}</div><h2 className="text-lg font-black text-[#001f3f] dark:text-white leading-none">{user.name}</h2><p className="text-[9px] font-black text-amber-500 uppercase tracking-[0.2em] mt-2">{user.role.replace(/_/g, ' ')}</p></div>
        <form onSubmit={handleUpdate} className="space-y-6"><div className="grid grid-cols-1 gap-6"><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Code</label><input type="text" value={user.employeeId} readOnly className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent rounded-2xl font-black text-sm text-slate-400 cursor-not-allowed outline-none italic" /></div><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp Liaison</label><input type="text" placeholder="97333000000" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-emerald-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all shadow-sm" /></div><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registry Password</label><input type="text" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-amber-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all shadow-sm" /></div></div>{status && (<div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all animate-in zoom-in duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>{status.message}</div>)}<button type="submit" disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-900 active:scale-95 transition-all disabled:opacity-50">{loading ? 'SYNCING...' : 'AUTHORIZE UPDATES'}</button></form>
      </div>
    </div>
  );
};

export default ProfileView;


import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { BiometricService } from '../services/biometricService.ts';
import { TelegramService } from '../services/telegramService.ts';
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
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
  const [isAuthorizingAI, setIsAuthorizingAI] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    };
    checkKey();
    const interval = setInterval(checkKey, 3000);
    
    BiometricService.isSupported().then(setBiometricSupported);
    setBiometricEnrolled(BiometricService.isEnrolled(user.id));
    return () => clearInterval(interval);
  }, [user.id]);

  const handleManualLink = async () => {
    setIsAuthorizingAI(true);
    HapticService.light();
    try {
      await window.aistudio.openSelectKey();
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
      
      if (selected) {
        // PERSTISTENT HANDSHAKE: Save the authorization flag to Supabase
        if (IS_CLOUD_ENABLED && !isSandbox) {
          await supabase.from('profiles').update({ ai_authorized: true }).eq('id', user.id);
        }
        const updatedUser = { ...user, ai_authorized: true };
        setCurrentUser(updatedUser);
        setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
        setStatus({ type: 'success', message: 'Institutional Matrix Link Established persistently.' });
      }
    } catch (e) {
      setStatus({ type: 'error', message: 'Handshake Failed. Try again.' });
    } finally {
      setIsAuthorizingAI(false);
    }
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

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Staff <span className="text-[#d4af37]">Profile</span></h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Personnel Identity & Matrix Control</p>
      </div>

      {/* NEW: PERSISTENT INSTITUTIONAL HANDSHAKE WIZARD */}
      <div className={`rounded-[3rem] p-1 shadow-2xl transition-all duration-500 ${hasApiKey ? 'bg-emerald-500' : 'bg-[#d4af37] animate-pulse'}`}>
        <div className="bg-white dark:bg-slate-900 rounded-[2.9rem] p-8 md:p-12 space-y-10 relative overflow-hidden group">
          <div className="flex flex-col md:flex-row items-center gap-10 relative z-10">
            <div className="flex-1 space-y-6">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${hasApiKey ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-rose-500 animate-ping'}`}></div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${hasApiKey ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {hasApiKey ? 'Institutional Matrix: Linked' : 'Institutional Matrix: Offline'}
                </span>
              </div>
              
              <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">AI Activation Wizard</h2>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                   <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-black text-[10px] text-[#001f3f] dark:text-white shrink-0">1</div>
                   <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                     Open <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline font-black">Google AI Studio (Click Here)</a> and click <strong>"Create API Key"</strong>.
                   </p>
                </div>
                <div className="flex items-start gap-4">
                   <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-black text-[10px] text-[#001f3f] dark:text-white shrink-0">2</div>
                   <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                     Return here and click <strong>"Sync Matrix"</strong>. Choose your personal key from the popup.
                   </p>
                </div>
                <div className="flex items-start gap-4">
                   <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-black text-[10px] text-[#001f3f] dark:text-white shrink-0">3</div>
                   <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                     Your browser will remember this choice. You won't need to do this again for several days!
                   </p>
                </div>
              </div>

              {!hasApiKey && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 rounded-r-xl">
                   <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Important for Teachers:</p>
                   <p className="text-[9px] font-bold text-amber-600/80 leading-relaxed italic mt-1 uppercase">If it asks for a "Paid Project", make sure you created the key in AI Studio, not Google Cloud.</p>
                </div>
              )}
            </div>
            
            <div className="shrink-0 flex flex-col items-center gap-4">
              <button 
                onClick={handleManualLink}
                disabled={isAuthorizingAI}
                className={`px-12 py-8 rounded-[2.5rem] font-black text-sm uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95 flex flex-col items-center gap-3 ${
                  hasApiKey 
                    ? 'bg-emerald-50 text-emerald-600 border-2 border-emerald-100' 
                    : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950 ring-8 ring-amber-400/20'
                }`}
              >
                {isAuthorizingAI ? (
                  <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                )}
                <span>{hasApiKey ? 'Matrix Synced' : 'Sync Matrix'}</span>
              </button>
              {user.ai_authorized && (
                <div className="flex items-center gap-2">
                   <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                   <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Handshake Verified</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Registry Details (Restored/Preserved) */}
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

        {/* Telegram & Support (Restored/Preserved) */}
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
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-bottom-4 transition-all z-[2000] ${status.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
           <p className="text-xs font-black uppercase tracking-widest">{status.message}</p>
        </div>
      )}
    </div>
  );
};

export default ProfileView;

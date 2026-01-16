import React, { useState } from 'react';
import { User, UserRole } from '../types.ts';
// Import IS_CLOUD_ENABLED to avoid accessing protected supabase.supabaseUrl
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface ProfileViewProps {
  user: User;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const ProfileView: React.FC<ProfileViewProps> = ({ user, setUsers, setCurrentUser }) => {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState(user.password || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || '');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    // Use IS_CLOUD_ENABLED instead of protected supabaseUrl
    const isCloudActive = IS_CLOUD_ENABLED;

    try {
      if (isCloudActive) {
        // Correctly update the Supabase 'profiles' table.
        // Columns: email, password, phone_number
        const { error } = await supabase
          .from('profiles')
          .update({
            email: email,
            password: password,
            phone_number: phoneNumber || null
          })
          .eq('id', user.id);
        
        if (error) throw error;
      }

      // Prepare updated user object matching the local User interface
      const updatedUser = { ...user, email, password, phone_number: phoneNumber };
      
      // Update the global users list (this triggers the App.tsx localStorage sync)
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      
      // Update the currentUser so the UI reflects changes immediately
      setCurrentUser(updatedUser);
      
      setStatus({ 
        type: 'success', 
        message: isCloudActive 
          ? 'Institutional profile synchronized successfully.' 
          : 'Credentials updated in local repository.' 
      });
    } catch (err: any) {
      console.error("IHIS Profile Sync Error:", err);
      setStatus({ 
        type: 'error', 
        message: err.message || 'Institutional Handshake Error: Failed to synchronize credentials.' 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="text-center">
        <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Faculty Profile</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Personnel Information Control Hub</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800">
        <div className="flex flex-col items-center mb-10">
          <div className="w-24 h-24 bg-[#001f3f] text-[#d4af37] rounded-3xl flex items-center justify-center font-black text-3xl shadow-xl mb-4 border-2 border-amber-400/20">
            {user.name.substring(0, 2)}
          </div>
          <h2 className="text-xl font-black text-[#001f3f] dark:text-white leading-none">{user.name}</h2>
          <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] mt-2">{user.role.replace(/_/g, ' ')}</p>
        </div>

        <form onSubmit={handleUpdate} className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Employee Identity (Institutional Only)</label>
              <input 
                type="text" 
                value={user.employeeId} 
                readOnly 
                className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent rounded-2xl font-black text-sm text-slate-400 cursor-not-allowed outline-none italic"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp Contact (With Country Code)</label>
              <div className="relative group">
                <input 
                  type="text" 
                  placeholder="e.g. 97333000000"
                  value={phoneNumber} 
                  onChange={e => setPhoneNumber(e.target.value)}
                  className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-emerald-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all placeholder:text-slate-300"
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 opacity-20">
                   <svg className="w-5 h-5 fill-current text-emerald-500" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.222-4.032c1.53.939 3.274 1.443 5.066 1.444 5.439 0 9.865-4.427 9.867-9.867.001-2.63-1.023-5.102-2.884-6.964a9.774 9.774 0 00-6.977-2.881c-5.438 0-9.866 4.426-9.867 9.866 0 1.902.538 3.758 1.554 5.36l-.1.173-1.012 3.691 3.782-.992.174.103zm10.274-6.487c-.19-.094-1.128-.558-1.303-.622-.175-.064-.301-.097-.428.094-.127.19-.49.622-.601.748-.11.127-.222.143-.413.048-.19-.094-.8-.294-1.522-.94-.562-.5-1.026-1.119-1.137-1.309-.11-.19-.012-.294.083-.388.086-.085.19-.223.285-.335.095-.11.127-.19.19-.317.064-.127.032-.238-.016-.333-.048-.094-.428-1.03-.587-1.413-.155-.373-.31-.322-.428-.328-.11-.006-.238-.007-.365-.007-.127 0-.333.048-.508.238-.174.19-.667.651-.667 1.588 0 .937.683 1.842.778 1.968.095.127 1.343 2.051 3.255 2.877.455.197.81.314 1.086.402.458.145.874.124 1.205.075.369-.054 1.128-.461 1.286-.905.158-.444.158-.825.11-.905-.048-.08-.175-.127-.365-.221z"/></svg>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Institutional Email Access</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-amber-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Secure Portal Key (Password)</label>
              <input 
                type="text" 
                value={password} 
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-amber-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all"
              />
            </div>
          </div>

          {status && (
            <div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all animate-in zoom-in duration-300 ${
              status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'
            }`}>
              {status.message}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-900 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            {loading ? 'SYNCHRONIZING...' : 'COMMIT PROFILE UPDATES'}
          </button>
        </form>
      </div>

      <div className="text-center">
        <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">Institutional Personnel Management Matrix</p>
      </div>
    </div>
  );
};

export default ProfileView;
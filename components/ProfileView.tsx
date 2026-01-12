
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
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    // Fix: Use IS_CLOUD_ENABLED instead of protected supabaseUrl
    const isCloudActive = IS_CLOUD_ENABLED;

    try {
      if (isCloudActive) {
        // Correctly update the Supabase 'profiles' table.
        // Columns: email, password (as per DeploymentView schema)
        const { error } = await supabase
          .from('profiles')
          .update({
            email: email,
            password: password
          })
          .eq('id', user.id);
        
        if (error) throw error;
      }

      // Prepare updated user object matching the local User interface
      const updatedUser = { ...user, email, password };
      
      // Update the global users list (this triggers the App.tsx localStorage sync)
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      
      // Update the currentUser so the UI reflects changes immediately
      setCurrentUser(updatedUser);
      
      setStatus({ 
        type: 'success', 
        message: isCloudActive 
          ? 'Credentials synchronized with Cloud Gateway successfully.' 
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
        <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase">My Profile</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Manage Your Access Credentials</p>
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
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registered Email Address</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-amber-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Security Access Key (Password)</label>
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
            {loading ? 'SYNCHRONIZING...' : 'COMMIT CREDENTIAL UPDATE'}
          </button>
        </form>
      </div>

      <div className="text-center">
        <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">Institutional Access Management System</p>
      </div>
    </div>
  );
};

export default ProfileView;

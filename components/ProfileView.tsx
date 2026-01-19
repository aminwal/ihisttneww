import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { BiometricService } from '../services/biometricService.ts';

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

    const isCloudActive = IS_CLOUD_ENABLED;

    try {
      if (isCloudActive) {
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

      const updatedUser = { ...user, email, password, phone_number: phoneNumber };
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      setCurrentUser(updatedUser);
      
      setStatus({ 
        type: 'success', 
        message: 'Institutional profile synchronized successfully.' 
      });
    } catch (err: any) {
      setStatus({ 
        type: 'error', 
        message: err.message || 'Institutional Handshake Error.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricToggle = async () => {
    if (biometricEnrolled) {
      BiometricService.unenroll(user.id);
      setBiometricEnrolled(false);
      setStatus({ type: 'success', message: 'Biometric access disabled for this device.' });
    } else {
      const success = await BiometricService.register(user.id, user.name);
      if (success) {
        setBiometricEnrolled(true);
        setStatus({ type: 'success', message: 'Biometric identity authorized and linked.' });
      } else {
        setStatus({ type: 'error', message: 'Biometric enrollment failed.' });
      }
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

        {/* Biometric Security Section */}
        {biometricSupported && (
          <div className="mb-10 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${biometricEnrolled ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-tight">Biometric Gateway</h3>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{biometricEnrolled ? 'Status: Active and Secure' : 'Status: Deactivated'}</p>
                </div>
              </div>
              <button 
                onClick={handleBiometricToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${biometricEnrolled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${biometricEnrolled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        )}

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
              <input 
                type="text" 
                placeholder="e.g. 97333000000"
                value={phoneNumber} 
                onChange={e => setPhoneNumber(e.target.value)}
                className="w-full px-6 py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 focus:border-emerald-400 rounded-2xl font-bold text-sm dark:text-white outline-none transition-all placeholder:text-slate-300"
              />
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
        <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">Designed by Ahmed Minwal</p>
      </div>
    </div>
  );
};

export default ProfileView;
import React, { useState, useEffect } from 'react';
import { User } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { BiometricService } from '../services/biometricService.ts';

interface LoginProps {
  users: User[];
  onLogin: (user: User) => void;
  isDarkMode: boolean;
}

const Login: React.FC<LoginProps> = ({ users, onLogin, isDarkMode }) => {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [lastLoggedInUser, setLastLoggedInUser] = useState<User | null>(null);

  useEffect(() => {
    const checkBiometrics = async () => {
      const supported = await BiometricService.isSupported();
      const lastUserJson = localStorage.getItem('ihis_last_user');
      
      if (supported && lastUserJson) {
        const lastUser = JSON.parse(lastUserJson) as User;
        if (BiometricService.isEnrolled(lastUser.id)) {
          setCanUseBiometrics(true);
          setLastLoggedInUser(lastUser);
          setEmployeeId(lastUser.employeeId);
        }
      }
    };
    checkBiometrics();
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => 
      u.employeeId.toLowerCase() === employeeId.toLowerCase().trim() && 
      u.password === password
    );
    
    if (user) {
      localStorage.setItem('ihis_last_user', JSON.stringify(user));
      onLogin(user);
    } else {
      setError('Authentication Failed: Invalid ID or Password.');
    }
  };

  const handleBiometricLogin = async () => {
    if (!lastLoggedInUser) return;
    
    const success = await BiometricService.authenticate(lastLoggedInUser.id);
    if (success) {
      onLogin(lastLoggedInUser);
    } else {
      setError('Biometric authentication failed or cancelled.');
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 overflow-hidden relative bg-transparent">
      <div className="w-full max-w-sm bg-white/70 dark:bg-slate-900/80 backdrop-blur-3xl rounded-[2.5rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden border border-white/20 flex flex-col max-h-[92vh] relative z-10 scale-95 sm:scale-100 transition-all duration-500">
        <div className="bg-[#d4af37]/90 py-8 px-8 text-center relative shrink-0">
          <div className="w-20 h-20 bg-white rounded-2xl mx-auto mb-3 flex items-center justify-center shadow-xl border-2 border-[#001f3f]/10 transform -rotate-3 hover:rotate-0 transition-transform duration-500 overflow-hidden p-2">
             <img src={SCHOOL_LOGO_BASE64} alt="School Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-[#001f3f] text-lg font-black uppercase tracking-tight italic leading-tight">{SCHOOL_NAME}</h1>
          <p className="text-[#001f3f]/70 text-[9px] font-black uppercase tracking-[0.4em] mt-1">Staff Portal</p>
        </div>
        
        <div className="p-8 flex-1 flex flex-col space-y-5 overflow-y-auto scrollbar-hide">
          <div className="text-center">
            <h2 className="text-slate-500 dark:text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">Identity Verification</h2>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Employee ID</label>
              <input
                type="text"
                placeholder="e.g. emp001"
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setError('');
                }}
                className="w-full px-6 py-4 bg-white/40 dark:bg-slate-800/50 border-2 border-transparent focus:border-[#d4af37] rounded-2xl outline-none transition-all dark:text-white font-bold text-sm shadow-sm placeholder:text-slate-300"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Access Key</label>
              <div className="relative group">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  className="w-full px-6 py-4 bg-white/40 dark:bg-slate-800/50 border-2 border-transparent focus:border-[#d4af37] rounded-2xl outline-none transition-all dark:text-white font-bold text-sm shadow-sm placeholder:text-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#d4af37] transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L1 1m11.939 11.939l11.06 11.06" /></svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 px-4 py-3 rounded-2xl border border-red-500/20 flex items-center space-x-2">
                <span className="text-[10px] font-black text-red-500 uppercase tracking-tight">{error}</span>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <button
                type="submit"
                className="w-full bg-[#001f3f] hover:bg-[#002d5c] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.25em] shadow-2xl transition-all border-2 border-transparent hover:border-amber-400/20 active:scale-95"
              >
                Sign In Securely
              </button>

              {canUseBiometrics && (
                <button
                  type="button"
                  onClick={handleBiometricLogin}
                  className="w-full bg-white dark:bg-slate-800 text-[#001f3f] dark:text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-md border-2 border-slate-100 dark:border-slate-700 flex items-center justify-center gap-3 active:scale-95 transition-all"
                >
                  <svg className="w-5 h-5 text-[#d4af37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z" />
                  </svg>
                  Biometric Login
                </button>
              )}
            </div>
          </form>

          <div className="pt-6 mt-auto text-center border-t border-slate-100/10">
            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-[0.25em] leading-relaxed">
              Biometric & Geolocation Protected<br/>
              {SCHOOL_NAME} © 2025<br/>
              <span className="text-[#d4af37] font-black mt-1 inline-block">Developed by Ahmed Minwal</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
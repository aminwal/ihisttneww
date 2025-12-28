import React, { useState } from 'react';
import { User } from '../types.ts';
import { SCHOOL_NAME } from '../constants.ts';

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => 
      u.employeeId.toLowerCase() === employeeId.toLowerCase().trim() && 
      u.password === password
    );
    
    if (user) {
      onLogin(user);
    } else {
      setError('Authentication Failed: Invalid ID or Password.');
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 overflow-hidden relative bg-transparent">
      <div className="w-full max-w-sm bg-white/70 dark:bg-slate-900/80 backdrop-blur-3xl rounded-[2.5rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden border border-white/20 flex flex-col max-h-[92vh] relative z-10 scale-95 sm:scale-100 transition-all duration-500">
        {/* Institutional Header */}
        <div className="bg-[#d4af37]/90 py-8 px-8 text-center relative shrink-0">
          <div className="w-16 h-14 bg-[#001f3f] rounded-2xl mx-auto mb-3 flex items-center justify-center shadow-xl border-2 border-white/20 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
             <span className="text-[#d4af37] font-black text-lg tracking-tighter">IHIS</span>
          </div>
          <h1 className="text-[#001f3f] text-lg font-black uppercase tracking-tight italic leading-tight">{SCHOOL_NAME}</h1>
          <p className="text-[#001f3f]/70 text-[9px] font-black uppercase tracking-[0.4em] mt-1">Staff Portal</p>
        </div>
        
        {/* Credentials Form Area */}
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
                autoFocus
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
              <div className="bg-red-500/10 px-4 py-3 rounded-2xl border border-red-500/20 flex items-center space-x-2 animate-bounce-subtle">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span className="text-[10px] font-black text-red-500 uppercase tracking-tight">{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-[#001f3f] hover:bg-[#002d5c] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.25em] shadow-2xl transition-all border-2 border-transparent hover:border-amber-400/20 active:scale-95"
            >
              Sign In Securely
            </button>
          </form>

          <div className="pt-6 mt-auto text-center border-t border-slate-100/10">
            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-[0.25em] leading-relaxed">
              Biometric & Geolocation Protected<br/>
              {SCHOOL_NAME} © 2025
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
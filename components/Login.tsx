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
        // Check both local storage and cloud key
        const userInRegistry = users.find(u => u.id === lastUser.id);
        const cloudKey = userInRegistry?.biometric_public_key;
        
        if (BiometricService.isEnrolled(lastUser.id, cloudKey)) {
          setCanUseBiometrics(true);
          setLastLoggedInUser(userInRegistry || lastUser);
          setEmployeeId(lastUser.employeeId);
        }
      }
    };
    checkBiometrics();
  }, [users]);

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
      setError('Login Failed: Please check your ID or Password.');
    }
  };

  const handleBiometricLogin = async () => {
    if (!lastLoggedInUser) return;
    
    const success = await BiometricService.authenticate(lastLoggedInUser.id, lastLoggedInUser.biometric_public_key);
    if (success) {
      onLogin(lastLoggedInUser);
    } else {
      setError('Biometric scan failed. Try using your password.');
    }
  };

  return (
    <div className="fixed inset-0 w-full h-full flex flex-col lg:flex-row overflow-y-auto bg-[#001f3f] scrollbar-hide">
      {/* ATMOSPHERE: INSTITUTIONAL HERITAGE (LEFT SIDE - HIDDEN ON MOBILE) */}
      <div className="hidden lg:flex flex-1 relative flex-col items-center justify-center p-8 lg:p-12 overflow-hidden min-h-screen">
        {/* Animated Matrix Background Pattern */}
        <div className="absolute inset-0 opacity-20 pointer-events-none" 
             style={{ 
               backgroundImage: `radial-gradient(circle at 2px 2px, #d4af37 1px, transparent 0)`,
               backgroundSize: '40px 40px' 
             }}></div>
        
        <div className="relative z-10 flex flex-col items-center text-center space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-left duration-1000">
          <div className="relative">
            <div className="absolute inset-0 bg-amber-400/20 blur-[60px] rounded-full animate-pulse"></div>
            <div className="w-40 h-40 lg:w-48 lg:h-48 bg-white/5 backdrop-blur-md rounded-[3rem] flex items-center justify-center p-8 border border-white/10 shadow-2xl relative">
              <img src={SCHOOL_LOGO_BASE64} alt="School Seal" className="w-full h-full object-contain filter drop-shadow-2xl" />
            </div>
          </div>

          <div className="space-y-4 max-w-2xl px-6">
            <h1 className="text-white text-3xl lg:text-5xl font-black uppercase tracking-tight italic leading-tight drop-shadow-2xl">
              IBN AL HYTHAM <span className="text-[#d4af37]">ISLAMIC SCHOOL</span>
            </h1>
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-8 lg:w-12 bg-amber-400/30"></div>
              <p className="text-amber-400 font-bold text-[10px] lg:text-xs uppercase tracking-[0.5em]">TEACHER PORTAL</p>
              <div className="h-px w-8 lg:w-12 bg-amber-400/30"></div>
            </div>
          </div>

          <div className="max-w-md">
            <p className="text-white/40 text-[9px] lg:text-[10px] font-black uppercase tracking-[0.3em] leading-relaxed italic">
              School Management System & Attendance Gateway
            </p>
          </div>
        </div>

        {/* Branding Footer Decoration */}
        <div className="absolute bottom-12 left-12 opacity-20 pointer-events-none">
          <p className="text-white text-[8px] font-black uppercase tracking-0.4em rotate-90 origin-left whitespace-nowrap">
            RESPECT • INTEGRITY • EXCELLENCE
          </p>
        </div>
      </div>

      {/* AUTHENTICATION WIDGET (RIGHT SIDE) */}
      <div className="w-full lg:w-[550px] min-h-screen flex items-center justify-center p-4 sm:p-12 relative z-20 py-12 lg:py-0">
        <div className="w-full max-w-sm flex flex-col space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-8 lg:slide-in-from-right duration-700">
          
          {/* Mobile Header (Only visible on small screens) */}
          <div className="lg:hidden flex flex-col items-center space-y-4 mb-2">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 border border-white/20 shadow-xl">
              <img src={SCHOOL_LOGO_BASE64} alt="School Logo" className="w-full h-full object-contain" />
            </div>
            <div className="text-center px-4">
              <h2 className="text-white text-lg sm:text-xl font-black uppercase tracking-widest leading-tight">{SCHOOL_NAME}</h2>
              <p className="text-amber-400 text-[8px] font-black uppercase tracking-[0.3em] mt-1">TEACHER PORTAL</p>
            </div>
          </div>

          {/* Glassmorphic Auth Card */}
          <div className="bg-white/10 dark:bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] sm:rounded-[3rem] p-6 sm:p-10 border border-amber-400/30 shadow-[0_32px_64px_-15px_rgba(0,0,0,0.5)] flex flex-col relative overflow-hidden group">
            {/* Shimmer Effect on Card */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none"></div>
            
            <div className="space-y-2 mb-6 sm:mb-8 relative z-10">
              <h3 className="text-white text-xl sm:text-2xl font-black italic tracking-tight uppercase leading-none">Staff Login</h3>
              <p className="text-slate-400 text-[8px] sm:text-[9px] font-black uppercase tracking-[0.3em]">Access your school account</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4 sm:space-y-6 relative z-10">
              <div className="space-y-2">
                <label className="text-[8px] sm:text-[9px] font-black text-amber-400/60 uppercase tracking-[0.2em] ml-2">Employee ID</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. emp001"
                    value={employeeId}
                    onChange={(e) => { setEmployeeId(e.target.value); setError(''); }}
                    className="w-full px-6 sm:px-8 py-4 sm:py-5 bg-white/5 border border-white/10 focus:border-[#d4af37] focus:ring-4 focus:ring-[#d4af37]/10 rounded-xl sm:rounded-2xl outline-none transition-all text-white font-bold text-sm shadow-inner placeholder:text-white/10"
                  />
                  <div className="absolute right-5 sm:right-6 top-1/2 -translate-y-1/2 text-white/20">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[8px] sm:text-[9px] font-black text-amber-400/60 uppercase tracking-[0.2em] ml-2">Password</label>
                <div className="relative group/pass">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    className="w-full px-6 sm:px-8 py-4 sm:py-5 bg-white/5 border border-white/10 focus:border-[#d4af37] focus:ring-4 focus:ring-[#d4af37]/10 rounded-xl sm:rounded-2xl outline-none transition-all text-white font-bold text-sm shadow-inner placeholder:text-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-5 sm:right-6 top-1/2 -translate-y-1/2 text-white/20 hover:text-amber-400 transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    ) : (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L1 1m11.939 11.939l11.06 11.06" /></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-rose-500/20 animate-in shake duration-300">
                  <p className="text-[9px] sm:text-[10px] font-black text-rose-500 uppercase tracking-tight text-center">{error}</p>
                </div>
              )}

              <div className="space-y-3 sm:space-y-4 pt-4">
                <button
                  type="submit"
                  className="w-full bg-white text-[#001f3f] py-4 sm:py-6 rounded-xl sm:rounded-2xl font-black text-[10px] sm:text-xs uppercase tracking-[0.3em] sm:tracking-[0.4em] shadow-2xl hover:bg-amber-400 transition-all active:scale-95"
                >
                  Sign In
                </button>

                {canUseBiometrics && (
                  <button
                    type="button"
                    onClick={handleBiometricLogin}
                    className="w-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-[#001f3f] py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 sm:gap-3 active:scale-95 transition-all group/bio overflow-hidden relative"
                  >
                    <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover/bio:translate-x-full transition-transform duration-700 pointer-events-none"></div>
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z" />
                    </svg>
                    <span className="relative z-10">Login with Fingerprint/Face</span>
                  </button>
                )}
              </div>
            </form>

            <div className="mt-8 sm:mt-12 text-center">
              <p className="text-[7px] sm:text-[8px] font-black text-amber-400 uppercase tracking-widest opacity-60">
                Developed by Ahmed Minwal
              </p>
            </div>
          </div>

          <div className="text-center px-4 pb-12 lg:pb-8">
            <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.4em] leading-relaxed">
              IHIS PORTAL 2026-27
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
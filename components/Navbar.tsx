
import React from 'react';
import { User } from '../types.ts';
import { SCHOOL_NAME } from '../constants.ts';

interface NavbarProps {
  user: User;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ user, onLogout, isDarkMode, toggleDarkMode }) => {
  return (
    <header className="bg-transparent border-b border-slate-200/50 dark:border-white/10 px-8 py-5 flex items-center justify-between z-10">
      <div className="flex items-center space-x-4">
        {/* Desktop Branding: Prominently display the school name in theme-aware colors */}
        <div className="hidden md:block">
           <h1 className="text-lg md:text-xl font-black text-[#001f3f] dark:text-white uppercase tracking-[0.2em] italic">
             {SCHOOL_NAME}
           </h1>
        </div>
        {/* Mobile view message */}
        <div className="md:hidden">
          <h2 className="text-[10px] font-black text-[#001f3f]/40 dark:text-white/40 uppercase tracking-[0.4em]">Authorized Access</h2>
        </div>
      </div>
      
      <div className="flex items-center space-x-5 md:space-x-8">
        <button 
          onClick={toggleDarkMode}
          className="p-2.5 rounded-2xl bg-[#001f3f]/5 dark:bg-white/10 text-amber-600 dark:text-amber-400 hover:bg-amber-600 dark:hover:bg-amber-400 hover:text-white dark:hover:text-[#001f3f] transition-all duration-300 shadow-sm border border-slate-200 dark:border-white/10"
          aria-label="Toggle Adaptive Display"
        >
          {isDarkMode ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
        </button>

        <div className="text-right hidden sm:block">
          <p className="text-sm font-black text-[#001f3f] dark:text-white leading-none tracking-tight">{user.name}</p>
          <p className="text-[9px] text-amber-600 dark:text-amber-400 font-black uppercase tracking-[0.2em] mt-1">{user.role.replace(/_/g, ' ')}</p>
        </div>
        
        <button 
          onClick={onLogout}
          className="bg-[#001f3f]/5 dark:bg-white/10 hover:bg-[#001f3f] dark:hover:bg-white text-[#001f3f] dark:text-white hover:text-white dark:hover:text-[#001f3f] px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 border border-slate-200 dark:border-white/10 shadow-sm"
        >
          SIGN OUT
        </button>
      </div>
    </header>
  );
};

export default Navbar;

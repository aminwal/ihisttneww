
import React, { useState } from 'react';
import { User, SchoolNotification } from '../types.ts';
import { SCHOOL_NAME } from '../constants.ts';

interface NavbarProps {
  user: User;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
  notifications: SchoolNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
}

const Navbar: React.FC<NavbarProps> = ({ user, onLogout, isDarkMode, toggleDarkMode, toggleSidebar, notifications, setNotifications }) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <header className="bg-transparent border-b border-slate-200/50 dark:border-white/10 px-4 md:px-8 pt-10 pb-5 md:py-5 flex items-center justify-between z-[160]">
      <div className="flex items-center space-x-4">
        <button 
          onClick={toggleSidebar}
          className="p-2.5 rounded-2xl bg-[#001f3f]/5 dark:bg-white/10 text-[#001f3f] dark:white border border-slate-200 dark:border-white/10 hover:scale-110 active:scale-95 transition-all shadow-sm"
          aria-label="Toggle Menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="hidden lg:block">
           <h1 className="text-lg md:text-xl font-black text-[#001f3f] dark:text-white uppercase tracking-[0.2em] italic">
             {SCHOOL_NAME}
           </h1>
        </div>
        
        <div className="lg:hidden">
          <div className="w-10 h-8 bg-[#001f3f] rounded-lg flex items-center justify-center font-black text-[10px] text-[#d4af37]">IHIS</div>
        </div>
      </div>
      
      <div className="flex items-center space-x-3 md:space-x-6">
        {/* Notification Bell */}
        <div className="relative">
          <button 
            onClick={() => { setShowNotifs(!showNotifs); if (!showNotifs) markAllRead(); }}
            className="p-2.5 rounded-2xl bg-white dark:bg-slate-900 text-slate-400 hover:text-[#d4af37] transition-all shadow-sm border border-slate-200 dark:border-white/10 relative"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white dark:border-slate-950 animate-bounce">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            /* UPDATED: Changed from absolute right-0 to fixed centering on mobile, absolute right-0 on md+ screens */
            <div className="fixed md:absolute inset-x-4 md:inset-auto md:right-0 mt-4 md:mt-4 md:w-80 top-24 md:top-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-white/10 overflow-hidden z-[200] animate-in slide-in-from-top-2 duration-300">
              <div className="p-5 border-b border-slate-50 dark:border-white/5 flex justify-between items-center">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Duty Alerts</h3>
                <button onClick={() => setNotifications([])} className="text-[9px] font-black text-rose-500 uppercase hover:underline">Clear All</button>
              </div>
              <div className="max-h-96 overflow-y-auto scrollbar-hide">
                {notifications.length > 0 ? (
                  notifications.map(n => (
                    <div key={n.id} className={`p-5 border-b border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${!n.read ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}>
                      <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase italic mb-1">{n.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{n.message}</p>
                      <p className="text-[8px] text-slate-300 mt-2 font-black uppercase">{new Date(n.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-10 text-center">
                    <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">No active alerts</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
          className="bg-[#001f3f]/5 dark:bg-white/10 hover:bg-[#001f3f] dark:hover:bg-white text-[#001f3f] dark:text-white hover:text-white dark:hover:text-[#001f3f] px-4 md:px-5 py-2.5 rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 border border-slate-200 dark:border-white/10 shadow-sm"
        >
          SIGN OUT
        </button>
      </div>
    </header>
  );
};

export default Navbar;

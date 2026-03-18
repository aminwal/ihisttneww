
import React, { useState, useEffect } from 'react';
import { UserRole, SchoolConfig, AppTab } from '../types.ts';
import { SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';

interface SidebarProps {
  role: UserRole;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  config: SchoolConfig;
  isSidebarOpen?: boolean;
  onClose?: () => void;
  hasAccess: (tab: AppTab) => boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ role, activeTab, setActiveTab, config, isSidebarOpen, onClose, hasAccess }) => {
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  const handleOfflineSync = async () => {
    if (isSyncingOffline) return;
    setIsSyncingOffline(true);
    setSyncProgress(0);
    HapticService.light();

    const steps = 10;
    for (let i = 1; i <= steps; i++) {
       await new Promise(r => setTimeout(r, 150));
       setSyncProgress((i / steps) * 100);
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
       navigator.serviceWorker.controller.postMessage({ type: 'PRE_CACHE_OFFLINE' });
    }

    HapticService.success();
    setTimeout(() => {
       setIsSyncingOffline(false);
       setSyncProgress(0);
    }, 2000);
  };

  const ALL_ITEMS: { id: AppTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: 'otp', label: 'Attendance PIN', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
    { id: 'timetable_hub', label: 'Timetable Hub', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
    { id: 'operations_hub', label: 'Operations Hub', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { id: 'academic_tracking', label: 'Academic Tracking', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'ai_analytics', label: 'Matrix AI Analyst', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { id: 'admin_hub', label: 'Admin Console', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { id: 'profile', label: 'My Profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }
  ];

  const visibleItems = ALL_ITEMS.filter(item => hasAccess(item.id));

  return (
    <>
      <aside 
        className={`fixed inset-y-0 left-0 z-[200] w-64 bg-[#00112b] text-white flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] border-r border-white/10 shadow-2xl overflow-hidden shrink-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-6 mb-10 border-b border-white/5">
          <button 
            onClick={() => { setActiveTab('dashboard'); if(onClose) onClose(); }}
            className="flex items-center space-x-3 group text-left outline-none"
          >
            <div className="w-12 h-10 bg-white rounded-xl flex items-center justify-center font-black text-base text-[#001f3f] shadow-[0_0_15px_rgba(255,255,255,0.1)] shrink-0 group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300 ease-out p-1">
              <img src={SCHOOL_LOGO_BASE64} alt="Brand" className="w-full h-full object-contain" />
            </div>
            <div>
              <span className="block font-black text-lg tracking-tight leading-none group-hover:text-amber-200 transition-colors uppercase">IHIS</span>
              <span className="block text-[8px] font-black text-amber-200 uppercase tracking-[0.3em] opacity-70">Staff Portal</span>
            </div>
          </button>
          
          <button 
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-all active:scale-95"
            aria-label="Close Menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <nav className="flex-1 space-y-1.5 px-3 overflow-y-auto scrollbar-hide">
          {visibleItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); if(onClose) onClose(); }}
              className={`w-full flex items-center space-x-3 p-3.5 rounded-xl transition-all duration-300 ${
                activeTab === item.id 
                  ? 'bg-[#d4af37] text-[#001f3f] shadow-lg font-black' 
                  : 'text-amber-100/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <svg className={`w-5 h-5 flex-shrink-0 ${activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="font-bold tracking-tight text-sm truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 mx-3 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-3">
           <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                 <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Offline Sync</p>
              </div>
           </div>
           <p className="text-[7px] font-bold text-white/30 uppercase leading-relaxed">Secure local copy of timetable & admin guides.</p>
           <button 
             onClick={handleOfflineSync}
             disabled={isSyncingOffline}
             className="w-full bg-emerald-500 text-white py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
           >
             {isSyncingOffline ? 'Synchronizing...' : 'Sync for Offline Use'}
           </button>
        </div>
        
        <div className="p-6 text-[9px] font-black text-amber-200/30 uppercase tracking-[0.3em]">
          Institutional Excellence
        </div>
      </aside>
    </>
  );
};

export default Sidebar;

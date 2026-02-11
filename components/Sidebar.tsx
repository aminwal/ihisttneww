
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
    { id: 'substitutions', label: 'Proxy List', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 v12a2 2 0 01-2 2z' },
    { id: 'timetable', label: 'Edit Timetable', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'batch_timetable', label: 'Print Timetables', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { id: 'occupancy', label: 'Campus Map', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
    { id: 'history', label: 'Staff Attendance', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'reports', label: 'School Reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2' },
    { id: 'ai_analytics', label: 'Matrix AI Analyst', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { id: 'lesson_architect', label: 'Lesson Architect', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { id: 'exam_preparer', label: 'Exam Preparer', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { id: 'handbook', label: 'Admin Guide', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477-4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { id: 'assignments', label: 'Teacher Workloads', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { id: 'groups', label: 'Class Groupings', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { id: 'extra_curricular', label: 'Activities List', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'users', label: 'Manage Staff', icon: 'M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
    { id: 'deployment', label: 'Database', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { id: 'config', label: 'School Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
    { id: 'control_center', label: 'Advanced Controls', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { id: 'sandbox_control', label: 'Practice Mode', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
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

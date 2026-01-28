
import React from 'react';
import { AppTab, UserRole } from '../types.ts';

interface MobileNavProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  role: UserRole;
  hasAccess: (tab: AppTab) => boolean;
}

const MobileNav: React.FC<MobileNavProps> = ({ activeTab, setActiveTab, role, hasAccess }) => {
  const ALL_NAVS: { id: AppTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: 'timetable', label: 'Creator', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'substitutions', label: 'Proxies', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2z' },
    { id: 'history', label: 'Attendance', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'profile', label: 'Profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }
  ];

  // Filter based on access, limit to max 5 for mobile spacing
  const visibleNavs = ALL_NAVS.filter(nav => hasAccess(nav.id)).slice(0, 5);

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-[500] bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-200 dark:border-white/10 pb-safe">
      <div className="flex justify-around items-center h-16">
        {visibleNavs.map(nav => (
          <button
            key={nav.id}
            onClick={() => setActiveTab(nav.id)}
            className={`flex flex-col items-center justify-center w-full h-full transition-all ${
              activeTab === nav.id ? 'text-[#001f3f] dark:text-amber-400' : 'text-slate-400'
            }`}
          >
            <svg className={`w-6 h-6 ${activeTab === nav.id ? 'stroke-[2.5px]' : 'stroke-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={nav.icon} />
            </svg>
            <span className="text-[10px] font-black uppercase tracking-tighter mt-1">{nav.label}</span>
            {activeTab === nav.id && <span className="w-1 h-1 rounded-full bg-current mt-0.5 animate-pulse"></span>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MobileNav;

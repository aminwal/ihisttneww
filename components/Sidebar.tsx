
import React from 'react';
import { UserRole, SchoolConfig, AppTab } from '../types.ts';

interface SidebarProps {
  role: UserRole;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  config: SchoolConfig;
}

const Sidebar: React.FC<SidebarProps> = ({ role, activeTab, setActiveTab, config }) => {
  const isManagement = role === UserRole.ADMIN || role.startsWith('INCHARGE_');
  const isAdmin = role === UserRole.ADMIN;
  const isAdminStaff = role === UserRole.ADMIN_STAFF;

  const navItems: { id: AppTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Attendance', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    ...(((!config.hideTimetableFromTeachers || isManagement) && !isAdminStaff) ? [{ id: 'timetable' as AppTab, label: 'Time Table', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' }] : []),
    ...(!isAdminStaff ? [{ id: 'substitutions' as AppTab, label: 'Substitutions', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2z' }] : []),
    { id: 'history', label: 'History', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    ...(isManagement ? [{ id: 'reports' as AppTab, label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2' }] : []),
    ...(isManagement ? [{ id: 'assignments' as AppTab, label: 'Loads', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' }] : []),
    ...(isManagement ? [{ id: 'users' as AppTab, label: 'Staff', icon: 'M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' }] : []),
    ...(isAdmin ? [{ id: 'deployment' as AppTab, label: 'Cloud', icon: 'M13 10V3L4 14h7v7l9-11h-7z' }] : []),
    ...(isAdmin ? [{ id: 'config' as AppTab, label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }] : []),
    { id: 'profile', label: 'Profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }
  ];

  return (
    <aside className="hidden md:flex w-64 bg-[#00112b]/95 backdrop-blur-md text-white flex-col transition-all duration-300 border-r border-white/10 shadow-2xl z-20 overflow-hidden shrink-0">
      <button 
        onClick={() => setActiveTab('dashboard')}
        className="p-6 flex items-center space-x-3 mb-10 border-b border-white/5 hover:bg-white/5 transition-colors group text-left outline-none"
      >
        <div className="w-12 h-10 bg-[#d4af37] rounded-xl flex items-center justify-center font-black text-base text-[#001f3f] shadow-[0_0_15px_rgba(212,175,55,0.3)] shrink-0 group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300 ease-out">
          IHIS
        </div>
        <div>
          <span className="block font-black text-lg tracking-tight leading-none group-hover:text-amber-200 transition-colors">IHIS</span>
          <span className="block text-[8px] font-black text-amber-200 uppercase tracking-[0.3em] opacity-70">Staff Gateway</span>
        </div>
      </button>
      
      <nav className="flex-1 space-y-1.5 px-3 overflow-y-auto scrollbar-hide">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
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
      
      <div className="p-6 text-[9px] font-black text-amber-200/30 uppercase tracking-[0.3em]">
        Institutional Excellence
      </div>
    </aside>
  );
};

export default Sidebar;

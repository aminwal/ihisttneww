import React from 'react';
import { Sparkles, Activity, Clock, Layout, User as UserIcon, Home, Palette, Zap, Info } from 'lucide-react';
import { User, UserRole, SchoolConfig } from '../../types';

interface TimetableHeaderProps {
  user: User;
  isDraftMode: boolean;
  isManagement: boolean;
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
  setViewMode: (val: 'SECTION' | 'TEACHER' | 'ROOM') => void;
  selectedTargetId: string;
  setSelectedTargetId: (val: string) => void;
  config: SchoolConfig;
  users: User[];
  colorMode: 'DEFAULT' | 'SUBJECT' | 'TEACHER' | 'GRADE';
  setColorMode: (val: 'DEFAULT' | 'SUBJECT' | 'TEACHER' | 'GRADE') => void;
  isSwapMode: boolean;
  setIsSwapMode: (val: boolean) => void;
  compactMode: boolean;
  setCompactMode: (val: boolean) => void;
  isAiProcessing: boolean;
}

export const TimetableHeader: React.FC<TimetableHeaderProps> = ({
  user,
  isDraftMode,
  isManagement,
  viewMode,
  setViewMode,
  selectedTargetId,
  setSelectedTargetId,
  config,
  users,
  colorMode,
  setColorMode,
  isSwapMode,
  setIsSwapMode,
  compactMode,
  setCompactMode,
  isAiProcessing,
}) => {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-8">
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border-4 border-[#001f3f]/5 relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-amber-400/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-sky-400/5 rounded-full blur-3xl animate-pulse" />

        <div className="flex flex-col lg:flex-row items-center justify-between gap-12 relative z-10">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-amber-400 to-sky-400 rounded-[2.5rem] blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
              <div className="relative w-24 h-24 bg-[#001f3f] rounded-[2.5rem] flex items-center justify-center text-[#d4af37] shadow-2xl transform group-hover:scale-105 transition-all duration-500">
                <Clock className="w-10 h-10" />
              </div>
            </div>
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-3 mb-3">
                <h2 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Timetable Engine</h2>
                {isDraftMode && (
                  <span className="px-4 py-1.5 bg-amber-400 text-[#001f3f] rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg animate-pulse">Draft Mode</span>
                )}
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] flex items-center justify-center md:justify-start gap-2">
                <Activity className="w-3 h-3 text-emerald-500" /> Multi-Dimensional Resource Orchestrator
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            {isManagement && (
              <div className="flex bg-slate-50 dark:bg-slate-800 p-2 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-inner">
                <button 
                  onClick={() => setViewMode('SECTION')}
                  className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Layout className="w-4 h-4" /> Section
                </button>
                <button 
                  onClick={() => setViewMode('TEACHER')}
                  className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <UserIcon className="w-4 h-4" /> Teacher
                </button>
                <button 
                  onClick={() => setViewMode('ROOM')}
                  className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Home className="w-4 h-4" /> Room
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <select 
                value={selectedTargetId} 
                onChange={e => setSelectedTargetId(e.target.value)}
                className="min-w-[240px] p-4 bg-slate-50 dark:bg-slate-800 rounded-[1.5rem] text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all shadow-sm"
              >
                <option value="">Select {viewMode}...</option>
                {viewMode === 'SECTION' && config.sections.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                {viewMode === 'TEACHER' && users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                {viewMode === 'ROOM' && config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Quick Controls Bar */}
        <div className="mt-12 pt-8 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Color Mode</span>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700">
                {(['DEFAULT', 'SUBJECT', 'TEACHER', 'GRADE'] as const).map(mode => (
                  <button 
                    key={mode}
                    onClick={() => setColorMode(mode)}
                    className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${colorMode === mode ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-white shadow-sm' : 'text-slate-400'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Swap Mode</span>
              <button 
                onClick={() => setIsSwapMode(!isSwapMode)}
                className={`w-10 h-5 rounded-full transition-all relative ${isSwapMode ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isSwapMode ? 'left-6' : 'left-1'}`} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Compact</span>
              <button 
                onClick={() => setCompactMode(!compactMode)}
                className={`w-10 h-5 rounded-full transition-all relative ${compactMode ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${compactMode ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isAiProcessing && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800 animate-pulse">
                <Zap className="w-3 h-3 text-amber-500" />
                <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">AI Optimizing...</span>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
              <Info className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                {config.sections.length} Sections • {users.filter(u => !u.isResigned).length} Staff • {config.rooms.length} Rooms
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { ChevronDown, RefreshCw, Lock, Unlock, Archive, Maximize2, Minimize2, Palette, Lightbulb, MoreHorizontal, Activity, CheckCircle2, AlertCircle, Clock, Info, Sparkles, Bot, MessageSquare, Send, ShieldAlert, Plus, Trash2, History as HistoryIcon, Wand2, Share2 } from 'lucide-react';
import { User, SchoolConfig, UserRole } from '../../types';

interface TimetableToolbarProps {
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
  setViewMode: (mode: 'SECTION' | 'TEACHER' | 'ROOM') => void;
  selectedTargetId: string;
  setSelectedTargetId: (id: string) => void;
  activeWingId: string;
  setActiveWingId: (id: string) => void;
  accessibleWings: any[];
  config: SchoolConfig;
  users: any[];
  isDraftMode: boolean;
  setIsDraftMode: (val: boolean) => void;
  isManagement: boolean;
  isProcessing: boolean;
  isAutoSaving: boolean;
  isPurgeMode: boolean;
  setIsPurgeMode: (val: boolean) => void;
  compactMode: boolean;
  setCompactMode: (val: boolean) => void;
  colorMode: string;
  setColorMode: (mode: any) => void;
  isSwapMode: boolean;
  setIsSwapMode: (val: boolean) => void;
  swapSource: any;
  setSwapSource: (val: any) => void;
  setIsParkingLotOpen: (val: boolean) => void;
  setIsVersionsModalOpen: (val: boolean) => void;
  setIsAiArchitectOpen: (val: boolean) => void;
  handleAiConductor: () => void;
  handleDeployDraft: () => void;
  handlePurgeDraft: (type: string) => void;
  isPurgeMenuOpen: boolean;
  setIsPurgeMenuOpen: (val: boolean) => void;
  setIsAuditDrawerOpen: (val: boolean) => void;
  onManualEntry: () => void;
}

export const TimetableToolbar: React.FC<TimetableToolbarProps> = ({
  viewMode,
  setViewMode,
  selectedTargetId,
  setSelectedTargetId,
  activeWingId,
  setActiveWingId,
  accessibleWings,
  config,
  users,
  isDraftMode,
  setIsDraftMode,
  isManagement,
  isProcessing,
  isAutoSaving,
  isPurgeMode,
  setIsPurgeMode,
  compactMode,
  setCompactMode,
  colorMode,
  setColorMode,
  isSwapMode,
  setIsSwapMode,
  swapSource,
  setSwapSource,
  setIsParkingLotOpen,
  setIsVersionsModalOpen,
  setIsAiArchitectOpen,
  handleAiConductor,
  handleDeployDraft,
  handlePurgeDraft,
  isPurgeMenuOpen,
  setIsPurgeMenuOpen,
  setIsAuditDrawerOpen,
  onManualEntry,
}) => {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* View Controls & Search */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between bg-white dark:bg-slate-900 p-4 rounded-[2rem] shadow-sm border border-slate-100 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {['SECTION', 'TEACHER', 'ROOM'].map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode as any);
                setSelectedTargetId('');
              }}
              className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                viewMode === mode 
                  ? 'bg-[#001f3f] text-[#d4af37] shadow-lg scale-105' 
                  : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 flex-1 max-w-2xl">
          {viewMode === 'SECTION' && (
            <div className="flex gap-2 flex-1">
              <select
                value={activeWingId}
                onChange={(e) => {
                  setActiveWingId(e.target.value);
                  setSelectedTargetId('');
                }}
                className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-[11px] font-bold text-[#001f3f] dark:text-white focus:ring-2 focus:ring-amber-400"
              >
                {accessibleWings.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <select
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className="flex-[2] px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-[11px] font-bold text-[#001f3f] dark:text-white focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Select Section</option>
                {config.sections
                  .filter(s => s.wingId === activeWingId)
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
              </select>
            </div>
          )}

          {viewMode === 'TEACHER' && (
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-[11px] font-bold text-[#001f3f] dark:text-white focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Select Teacher</option>
              {users
                .filter(u => u.role !== UserRole.STUDENT)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          )}

          {viewMode === 'ROOM' && (
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-[11px] font-bold text-[#001f3f] dark:text-white focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Select Room</option>
              {Array.from(new Set(config.sections.map(s => `ROOM ${s.fullName}`)))
                .concat(config.labBlocks?.flatMap(l => l.allocations.map(a => a.room)) || [])
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .sort()
                .map(room => (
                  <option key={room} value={room}>{room}</option>
                ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCompactMode(!compactMode)}
            className={`p-2.5 rounded-xl transition-all ${compactMode ? 'bg-amber-100 text-amber-600' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
            title="Toggle Compact Mode"
          >
            {compactMode ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          <div className="relative group">
            <button className="p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 transition-all">
              <Palette className="w-5 h-5" />
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
              {['DEFAULT', 'SUBJECT', 'TEACHER', 'GRADE'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setColorMode(mode as any)}
                  className={`w-full text-left px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest ${colorMode === mode ? 'bg-amber-50 text-amber-600' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  {mode} Color
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Draft Mode Toolbar */}
      {isManagement && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-amber-400/10 dark:bg-amber-400/5 p-4 rounded-[2rem] border-2 border-amber-400/20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isDraftMode ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-[11px] font-black uppercase tracking-widest text-[#001f3f] dark:text-white">
                {isDraftMode ? 'Draft Mode Active' : 'Live Schedule'}
              </span>
            </div>
            {isAutoSaving && (
              <div className="flex items-center gap-2 text-slate-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span className="text-[9px] font-bold uppercase tracking-widest italic">Auto-saving...</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button 
              onClick={() => setIsDraftMode(!isDraftMode)}
              className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isDraftMode 
                  ? 'bg-white dark:bg-slate-900 text-amber-600 border border-amber-200' 
                  : 'bg-amber-400 text-[#001f3f] shadow-lg hover:bg-amber-500'
              }`}
            >
              {isDraftMode ? 'Exit Draft' : 'Enter Draft'}
            </button>

            {isDraftMode && (
              <>
                <div className="h-8 w-px bg-amber-400/20 mx-2 hidden md:block" />
                
                <button 
                  onClick={() => setIsSwapMode(!isSwapMode)}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                    isSwapMode 
                      ? 'bg-amber-100 text-amber-700 border border-amber-300 shadow-inner' 
                      : 'bg-white dark:bg-slate-900 border border-amber-200 text-slate-600 hover:bg-amber-50'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${isSwapMode ? 'animate-spin' : ''}`} />
                  {isSwapMode ? 'Swap Active' : 'Swap Periods'}
                </button>

                <button 
                  onClick={onManualEntry}
                  className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-amber-50 transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Manual Entry
                </button>

                <button 
                  onClick={() => setIsAuditDrawerOpen(true)}
                  className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-amber-50 transition-all flex items-center gap-2"
                >
                  <Activity className="w-4 h-4" /> Audit
                </button>

                <button 
                  onClick={() => setIsVersionsModalOpen(true)}
                  className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-amber-50 transition-all flex items-center gap-2"
                >
                  <HistoryIcon className="w-4 h-4" /> Versions
                </button>

                <button 
                  onClick={() => setIsAiArchitectOpen(true)}
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2 group"
                >
                  <Bot className="w-4 h-4 group-hover:animate-bounce" /> AI Architect
                </button>

                <button 
                  onClick={handleAiConductor}
                  disabled={isProcessing}
                  className="px-5 py-2.5 bg-[#001f3f] text-[#d4af37] rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-950 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" /> Auto-Generate All
                </button>

                <button 
                  onClick={handleDeployDraft}
                  className="px-6 py-2.5 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2"
                >
                  <Share2 className="w-4 h-4" /> Deploy Live
                </button>

                <div className="relative">
                  <button 
                    onClick={() => setIsPurgeMenuOpen(!isPurgeMenuOpen)}
                    className="p-2.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl hover:bg-rose-100 transition-all"
                    title="Purge Options"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  {isPurgeMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-rose-100 dark:border-rose-900/30 z-50 p-2 animate-in slide-in-from-top-2 duration-200">
                      <button onClick={() => handlePurgeDraft('ALL')} className="w-full text-left px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-rose-600 hover:bg-rose-50">Purge Everything</button>
                      <button onClick={() => handlePurgeDraft('AUTO')} className="w-full text-left px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-rose-500 hover:bg-rose-50">Purge Auto-Gen</button>
                      <button onClick={() => handlePurgeDraft('SECTION')} className="w-full text-left px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-rose-400 hover:bg-rose-50">Purge Current View</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

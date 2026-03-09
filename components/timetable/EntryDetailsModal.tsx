import React from 'react';
import { X, Trash2, RefreshCw, Lock, Unlock, MessageSquare, ExternalLink } from 'lucide-react';
import { TimeTableEntry, SchoolConfig, User } from '../../types';

interface EntryDetailsModalProps {
  viewingEntryId: string | null;
  setViewingEntryId: (val: string | null) => void;
  currentTimetable: TimeTableEntry[];
  config: SchoolConfig;
  users: User[];
  isDraftMode: boolean;
  isManagement: boolean;
  lockedSectionIds: string[];
  setLockedSectionIds: (val: string[] | ((prev: string[]) => string[])) => void;
  handleDeleteEntry: (id: string) => void;
  handleReplaceEntry: (id: string) => void;
  findSafeSlots: (id: string) => void;
  setNoteModal: (val: any) => void;
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
}

export const EntryDetailsModal: React.FC<EntryDetailsModalProps> = ({
  viewingEntryId,
  setViewingEntryId,
  currentTimetable,
  config,
  users,
  isDraftMode,
  isManagement,
  lockedSectionIds,
  setLockedSectionIds,
  handleDeleteEntry,
  handleReplaceEntry,
  findSafeSlots,
  setNoteModal,
  viewMode,
}) => {
  if (!viewingEntryId) return null;

  const entry = currentTimetable.find(e => e.id === viewingEntryId);
  if (!entry) return null;

  const teacher = users.find(u => u.id === entry.teacherId);
  const section = config.sections.find(s => s.id === entry.sectionId);
  const isLocked = lockedSectionIds.includes(entry.sectionId);

  return (
    <div className="fixed inset-0 z-[1000] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2.5rem] md:rounded-[3.5rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-hidden relative">
        <button onClick={() => setViewingEntryId(null)} className="absolute top-8 right-8 p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors">
          <X className="w-6 h-6 text-slate-400" />
        </button>

        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-[#001f3f] rounded-3xl flex items-center justify-center text-[#d4af37] shadow-lg">
              <span className="text-2xl font-black">{(entry.subject || "U").charAt(0)}</span>
            </div>
            <div>
              <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{entry.subject || 'Unknown'}</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{entry.day} • Period {entry.slotId}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Assigned Faculty</p>
              <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{teacher?.name || entry.teacherName}</p>
            </div>
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Target Class</p>
              <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{section?.fullName || entry.className}</p>
            </div>
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Room Allocation</p>
              <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{entry.room || 'N/A'}</p>
            </div>
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Entry Status</p>
              <p className={`text-[10px] font-black uppercase ${entry.isManual ? 'text-amber-500' : 'text-emerald-500'}`}>{entry.isManual ? 'Manual Override' : 'AI Optimized'}</p>
            </div>
          </div>

          {entry.blockId && (
            <div className="p-5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-3xl">
              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                <RefreshCw className="w-3 h-3" /> Synchronized Group Period
              </p>
              <p className="text-[11px] font-bold text-amber-500 mt-2 italic">This period is part of the "{entry.blockName}" pool. Changes will affect all linked sections.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-4">
            {isDraftMode && isManagement && (
              <>
                <button 
                  onClick={() => handleDeleteEntry(entry.id)}
                  className="p-4 bg-rose-50 text-rose-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
                <button 
                  onClick={() => handleReplaceEntry(entry.id)}
                  className="p-4 bg-amber-50 text-amber-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-100 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Re-Assign
                </button>
                <button 
                  onClick={() => findSafeSlots(entry.id)}
                  className="col-span-2 p-4 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-colors flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" /> Find Safe Slots
                </button>
                <button 
                  onClick={() => {
                    setLockedSectionIds(prev => isLocked ? prev.filter(id => id !== entry.sectionId) : [...prev, entry.sectionId]);
                    setViewingEntryId(null);
                  }}
                  className={`col-span-2 p-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ${isLocked ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {isLocked ? <><Unlock className="w-4 h-4" /> Unlock Section</> : <><Lock className="w-4 h-4" /> Lock Section</>}
                </button>
              </>
            )}
            <button 
              onClick={() => {
                setNoteModal({ viewMode, targetId: entry.sectionId, day: entry.day, slotId: entry.slotId });
                setViewingEntryId(null);
              }}
              className="col-span-2 p-4 bg-slate-50 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-colors flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" /> Add/Edit Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

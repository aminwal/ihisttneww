
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { HapticService } from '../services/hapticService.ts';

interface TimeTableViewProps {
  user: User;
  users: User[];
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  timetableDraft: TimeTableEntry[];
  setTimetableDraft: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  isDraftMode: boolean;
  setIsDraftMode: (val: boolean) => void;
  substitutions: SubstitutionRecord[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  onManualSync: () => void;
  triggerConfirm: (message: string, onConfirm: () => void) => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ 
  user, users, timetable, setTimetable, timetableDraft, setTimetableDraft, 
  isDraftMode, setIsDraftMode, substitutions, config, assignments, 
  setAssignments, onManualSync, triggerConfirm, isSandbox, addSandboxLog
}) => {
  const isManagement = user?.role === UserRole.ADMIN || user?.role.startsWith('INCHARGE_');
  const isAdmin = user?.role === UserRole.ADMIN;
  const isGlobalIncharge = user?.role === UserRole.INCHARGE_ALL;
  
  // ROLE-BASED VISIBILITY SCOPING
  const userWingScope = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return null; // All scopes
    if (user.role === UserRole.INCHARGE_PRIMARY) return 'wing-p';
    if (user.role === UserRole.INCHARGE_SECONDARY) return 'wing-sb'; // General Secondary scope
    return null;
  }, [user.role, isAdmin, isGlobalIncharge]);

  const [activeWingId, setActiveWingId] = useState<string>(() => {
    if (userWingScope) return userWingScope;
    return config.wings[0]?.id || '';
  });

  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>(isManagement ? 'SECTION' : 'TEACHER');
  
  // Initialize teacher to their own ID automatically
  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => {
    if (!isManagement) return user.id;
    return '';
  });

  const [isProcessing, setIsProcessing] = useState(false);
  
  // SWAP ENGINE STATE
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{ day: string, slotId: number, entryId: string } | null>(null);

  const currentTimetable = isDraftMode ? timetableDraft : timetable;
  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const slots = useMemo(() => {
    const wing = config.wings.find(w => w.id === activeWingId);
    return config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || PRIMARY_SLOTS;
  }, [activeWingId, config.slotDefinitions, config.wings]);

  /**
   * GRANULAR VISIBILITY FILTER
   * Enforces data silos based on the provided requirements.
   */
  const filteredEntities = useMemo(() => {
    // ADMIN / GLOBAL INCHARGE: Full Matrix Visibility
    if (isAdmin || isGlobalIncharge) {
      if (viewMode === 'SECTION') return config.sections.filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
      if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
      return config.rooms.map(r => ({ id: r, name: r }));
    }

    // DEPARTMENTAL INCHARGE: Restrict to Wing/Department Scope
    if (isManagement) {
      const scope = userWingScope;
      if (viewMode === 'SECTION') {
        return config.sections
          .filter(s => scope ? s.wingId === scope : true)
          .filter(s => s.wingId === activeWingId)
          .map(s => ({ id: s.id, name: s.fullName }));
      }
      if (viewMode === 'TEACHER') {
        return users.filter(u => {
          if (u.isResigned || u.role === UserRole.ADMIN) return false;
          // Show only staff whose role category matches the in-charge's scope
          if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY');
          if (user.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY');
          return true;
        }).map(u => ({ id: u.id, name: u.name }));
      }
      return config.rooms.map(r => ({ id: r, name: r }));
    }

    // TEACHERS: Restrict to Personal + Class Teacher Scope
    if (viewMode === 'TEACHER') {
      return [{ id: user.id, name: `${user.name} (Self)` }];
    }
    if (viewMode === 'SECTION') {
      if (user.classTeacherOf) {
        const sect = config.sections.find(s => s.id === user.classTeacherOf);
        if (sect) return [{ id: sect.id, name: `${sect.fullName} (My Class)` }];
      }
      return []; // No access to other class timetables
    }
    return []; // No access to room timetables
  }, [viewMode, config.sections, config.rooms, users, activeWingId, user, isManagement, isAdmin, isGlobalIncharge, userWingScope]);

  // Restrict wings available in the dropdown based on role
  const accessibleWings = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return config.wings;
    if (user.role === UserRole.INCHARGE_PRIMARY) return config.wings.filter(w => w.id === 'wing-p');
    if (user.role === UserRole.INCHARGE_SECONDARY) return config.wings.filter(w => w.id.includes('wing-s'));
    return config.wings; // For teachers, keep wings visible so they can see their own slots
  }, [config.wings, user.role, isAdmin, isGlobalIncharge]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(e => {
      const key = `${e.day}-${e.slotId}`;
      if (!registry.has(key)) registry.set(key, [e]);
      else registry.get(key)!.push(e);
    });
    return registry;
  }, [currentTimetable]);

  /**
   * COLLISION DETECTION ENGINE
   * Hardcoded Rule 7: Never altered without explicit request.
   */
  const checkCollision = (teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string) => {
    const dayEntries = currentTimetable.filter(e => e.day === day && e.slotId === slotId && e.id !== excludeEntryId);
    
    const teacherClash = dayEntries.find(e => e.teacherId === teacherId);
    if (teacherClash) return `Teacher Conflict: ${teacherClash.teacherName} is already in ${teacherClash.className}`;

    const sectionClash = dayEntries.find(e => e.sectionId === sectionId);
    if (sectionClash) return `Class Conflict: ${sectionClash.className} already has ${sectionClash.subject}`;

    const roomClash = dayEntries.find(e => e.room === room && room !== 'Default' && room !== '');
    if (roomClash) return `Room Conflict: ${room} is occupied by ${roomClash.teacherName} (${roomClash.className})`;

    return null;
  };

  /**
   * CONFLICT SENTINEL (Ghosting Logic)
   * Calculates potential conflicts for a target cell relative to the active swap source.
   */
  const getConflictForTarget = (targetDay: string, targetSlotId: number) => {
    if (!isSwapMode || !swapSource) return null;
    const sourceEntry = currentTimetable.find(e => e.id === swapSource.entryId);
    if (!sourceEntry) return null;
    
    // Prevent marking the source cell itself as a conflict
    if (targetDay === swapSource.day && targetSlotId === swapSource.slotId) return null;

    return checkCollision(
      sourceEntry.teacherId,
      sourceEntry.sectionId,
      targetDay,
      targetSlotId,
      sourceEntry.room || '',
      swapSource.entryId
    );
  };

  const handleCellClick = (day: string, slotId: number, entryId?: string) => {
    if (!isSwapMode || !isDraftMode || !isManagement) return;
    HapticService.light();

    if (!swapSource) {
      if (!entryId) return;
      setSwapSource({ day, slotId, entryId });
    } else {
      executeSwap(swapSource, { day, slotId, entryId });
    }
  };

  const executeSwap = async (source: { day: string, slotId: number, entryId: string }, target: { day: string, slotId: number, entryId?: string }) => {
    const sourceEntry = currentTimetable.find(e => e.id === source.entryId);
    if (!sourceEntry) return;

    // Protocol: Atomic Collision Validation for Target Slot
    const collision = checkCollision(sourceEntry.teacherId, sourceEntry.sectionId, target.day, target.slotId, sourceEntry.room || '', source.entryId);
    if (collision) {
      alert(`SWAP REJECTED: ${collision}`);
      setSwapSource(null);
      return;
    }

    // Logic: Reciprocal Swap Handler
    const updated = [...currentTimetable].map(e => {
      if (e.id === source.entryId) {
        return { ...e, day: target.day, slotId: target.slotId };
      }
      // If target had an entry, move it back to source slot (Reciprocal)
      if (target.entryId && e.id === target.entryId) {
        return { ...e, day: source.day, slotId: source.slotId };
      }
      return e;
    });

    setCurrentTimetable(updated);
    setSwapSource(null);
    HapticService.success();
  };

  const handlePublishToLive = async () => {
    if (!confirm("Are you sure you want to deploy this matrix to PRODUCTION? This will overwrite the live schedule.")) return;
    setIsProcessing(true);
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('timetable_entries').delete().neq('id', 'SYSTEM_LOCK');
        const payload = timetableDraft.map(e => ({
          id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId,
          section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId,
          subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId,
          teacher_name: e.teacherName, room: e.room, is_substitution: false,
          is_manual: e.isManual, block_id: e.blockId, block_name: e.blockName
        }));
        await supabase.from('timetable_entries').insert(payload);
      }
      setTimetable([...timetableDraft]);
      setIsDraftMode(false);
      alert("INSTITUTIONAL SYNC COMPLETE: Matrix Live.");
    } catch (e: any) { alert("Deployment Error: " + e.message); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-in fade-in duration-700 pb-20 px-2 relative">
      {/* MATRIX CONTROL HEADER - RESTORED PILL DESIGN */}
      <div className="flex flex-col xl:flex-row justify-between items-center gap-6 bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800">
         <div className="space-y-1">
            <h1 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em]">Institutional Integrity Sentinel • {isDraftMode ? 'Draft' : 'Live'}</p>
         </div>

         {isManagement && (
           <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700">
                 <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-2">Engine:</span>
                 <button className="px-3 py-1.5 bg-[#001f3f] text-amber-400 rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all">Anchors</button>
                 <button className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all">Pools</button>
                 <button className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all">Curriculars</button>
                 <button className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all">Loads</button>
              </div>

              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden md:block"></div>

              <button 
                onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }}
                className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-md ${isSwapMode ? 'bg-amber-400 text-[#001f3f] scale-105 ring-4 ring-amber-400/20' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
              >
                {isSwapMode ? 'Swap Mode Active' : 'Swap Mode'}
              </button>

              <button 
                onClick={handlePublishToLive}
                disabled={!isDraftMode || isProcessing}
                className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all disabled:opacity-30 disabled:grayscale"
              >
                Deploy Live
              </button>

              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shadow-inner border border-slate-200 dark:border-slate-700">
                 <button onClick={() => setIsDraftMode(false)} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${!isDraftMode ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'}`}>Live</button>
                 <button onClick={() => setIsDraftMode(true)} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${isDraftMode ? 'bg-[#4338ca] text-white shadow-lg' : 'text-slate-400'}`}>Draft</button>
              </div>
           </div>
         )}
      </div>

      {/* VIEW MODE TABS - ALIGNED WITH BLUEPRINT */}
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col h-full max-h-[calc(100vh-220px)]">
        <div className="p-3 md:p-5 border-b dark:border-slate-800 bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
           <div className="flex bg-white dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
              {(['SECTION', 'TEACHER', 'ROOM'] as const).map(mode => (
                <button 
                  key={mode} 
                  onClick={() => { setViewMode(mode); setSelectedTargetId(isManagement ? '' : (mode === 'TEACHER' ? user.id : '')); }}
                  className={`px-6 md:px-10 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === mode ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400 hover:text-[#001f3f]'}`}
                >
                  {mode === 'SECTION' ? 'Class' : mode === 'TEACHER' ? 'Staff' : 'Room'}
                </button>
              ))}
           </div>

           <select 
             className="flex-1 max-w-2xl p-4 bg-white dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase italic outline-none border-2 border-slate-100 focus:border-amber-400 transition-all dark:text-white shadow-sm"
             value={selectedTargetId}
             onChange={e => setSelectedTargetId(e.target.value)}
           >
              <option value="">MATRIX TARGET DISCOVERY...</option>
              {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>

           <select 
              className={`bg-white dark:bg-slate-800 p-4 rounded-2xl text-[11px] font-black uppercase border border-slate-100 outline-none min-w-[180px] ${!isAdmin && !isGlobalIncharge ? 'opacity-50 cursor-not-allowed' : ''}`}
              value={activeWingId}
              onChange={e => !userWingScope && setActiveWingId(e.target.value)}
              disabled={!!userWingScope}
            >
              {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
           </select>
        </div>

        {/* MAIN MATRIX SURFACE - OPTIMIZED FOR SINGLE SCREEN PERSISTENCE */}
        <div className="flex-1 overflow-auto scrollbar-hide">
           <table className="w-full border-separate border-spacing-0 table-fixed min-w-[1000px]">
              <thead>
                 <tr className="bg-[#001f3f] text-white sticky top-0 z-[60]">
                    <th className="w-28 p-4 text-[10px] font-black uppercase italic tracking-[0.3em] border-r border-white/5 bg-[#001f3f]">Day</th>
                    {slots.map(s => (
                      <th key={s.id} className="p-4 text-center border-r border-white/5 bg-[#001f3f]">
                         <p className="text-[11px] font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p>
                         <p className="text-[9px] font-bold opacity-40 mt-1 tracking-widest">{s.startTime}</p>
                      </th>
                    ))}
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                 {DAYS.map(day => (
                   <tr key={day} className="h-24">
                      <td className="bg-[#001f3f] text-white font-black text-center text-[11px] uppercase border-r border-white/5 sticky left-0 z-40 italic tracking-widest shadow-xl">
                         {day.toUpperCase()}
                      </td>
                      {slots.map(s => {
                        const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                        const act = ents.find(t => 
                          viewMode === 'SECTION' ? t.sectionId === selectedTargetId : 
                          viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : 
                          t.room === selectedTargetId
                        );

                        const isBeingSwapped = swapSource?.day === day && swapSource?.slotId === s.id;
                        const conflict = getConflictForTarget(day, s.id);
                        
                        let brickStyles = 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800';
                        if (act) {
                           if (act.slotId === 1 && users.find(u => u.id === act.teacherId)?.classTeacherOf === act.sectionId) brickStyles = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 text-emerald-700 shadow-md';
                           else if (act.blockId) brickStyles = 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 text-amber-700 shadow-md';
                           else brickStyles = 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 text-sky-700 shadow-md';
                        }

                        if (isBeingSwapped) brickStyles = 'ring-4 ring-amber-400 bg-amber-100 border-transparent z-50 scale-105 rotate-1 shadow-2xl';
                        
                        // CONFLICT SENTINEL VISUALS
                        if (conflict) {
                           brickStyles = 'ring-2 ring-rose-500 bg-rose-50 dark:bg-rose-900/20 border-rose-500/50 shadow-inner scale-[0.98] opacity-90';
                        }

                        return (
                          <td 
                            key={s.id} 
                            onClick={() => handleCellClick(day, s.id, act?.id)}
                            className={`border-r border-slate-100 dark:border-slate-800 p-1.5 transition-all relative ${isSwapMode && isDraftMode ? 'cursor-pointer hover:bg-amber-50/50' : ''}`}
                          >
                             {s.isBreak ? (
                               <div className="h-full w-full flex items-center justify-center opacity-30">
                                  <span className="text-[8px] font-black uppercase tracking-[0.4em] -rotate-12">Recess</span>
                               </div>
                             ) : act ? (
                               <div className={`h-full w-full p-2 border-2 rounded-2xl flex flex-col justify-center text-center animate-in zoom-in duration-300 ${brickStyles}`}>
                                  <p className="text-[10px] font-black uppercase italic tracking-tighter leading-tight truncate">{act.subject}</p>
                                  <div className="mt-1">
                                     <p className="text-[8px] font-bold opacity-60 uppercase truncate">
                                        {viewMode === 'TEACHER' ? act.className : act.teacherName}
                                     </p>
                                     {viewMode !== 'ROOM' && <p className="text-[7px] font-black text-sky-600 dark:text-sky-400 uppercase tracking-widest mt-0.5 truncate">{act.room}</p>}
                                  </div>
                                  {conflict && (
                                    <div className="mt-1 absolute inset-x-0 -bottom-2 flex justify-center">
                                       <span className="bg-rose-600 text-white text-[6px] font-black px-1.5 py-0.5 rounded shadow-lg uppercase whitespace-nowrap">Conflict Warning</span>
                                    </div>
                                  )}
                               </div>
                             ) : (
                               <div className={`h-full w-full border-2 border-dashed rounded-2xl flex items-center justify-center transition-all ${conflict ? 'border-rose-400 bg-rose-50/50' : 'border-slate-50 dark:border-slate-800'}`}>
                                  {conflict ? (
                                    <div className="flex flex-col items-center gap-1">
                                      <svg className="w-3 h-3 text-rose-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                      <span className="text-[6px] font-black text-rose-600 uppercase tracking-widest">Locked</span>
                                    </div>
                                  ) : (
                                    <span className="text-[7px] font-black text-slate-100 dark:text-slate-800 uppercase italic opacity-50">Empty</span>
                                  )}
                               </div>
                             )}
                          </td>
                        );
                      })}
                   </tr>
                 ))}
              </tbody>
           </table>
        </div>
      </div>

      {isSwapMode && isDraftMode && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] bg-[#001f3f] text-white px-8 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-amber-400 animate-in slide-in-from-bottom-8 duration-500 flex items-center gap-6">
           <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping"></div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{swapSource ? `Source: Period ${swapSource.slotId} Selected` : 'Select cell to begin trade'}</span>
           </div>
           {swapSource && (
             <div className="flex items-center gap-4 border-l border-white/10 pl-6">
               <div className="flex flex-col">
                 <span className="text-[7px] font-black text-amber-500 uppercase tracking-widest">Conflict Sentinel</span>
                 <span className="text-[8px] font-bold text-white/60">Glow Red = Collision Detected</span>
               </div>
               <button onClick={() => setSwapSource(null)} className="text-[9px] font-black uppercase border-b border-white/20 hover:text-rose-400">Reset</button>
             </div>
           )}
           <button onClick={() => setIsSwapMode(false)} className="text-rose-400 hover:text-rose-600 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
      )}

      <div className="text-center opacity-20 py-2">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.6em]">Institutional Matrix v5.3 • Academic Year 2026-2027</p>
      </div>
    </div>
  );
};

export default TimeTableView;

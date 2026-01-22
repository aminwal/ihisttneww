
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, SchoolSection } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

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
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ 
  user, users, timetable, setTimetable, timetableDraft, setTimetableDraft, 
  isDraftMode, setIsDraftMode, substitutions, config, assignments, 
  setAssignments, onManualSync, triggerConfirm 
}) => {
  const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.INCHARGE_ALL;
  const isCloudActive = IS_CLOUD_ENABLED;
  
  const currentTimetable = (isDraftMode ? timetableDraft : timetable) || [];
  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const [activeWingId, setActiveWingId] = useState<string>(config.wings[0]?.id || '');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>('SECTION');
  const [editingCell, setEditingCell] = useState<{day: string, slotId: number} | null>(null);
  const [cellForm, setCellForm] = useState({ teacherId: '', subject: '', room: '', blockId: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  // New states for Swap and Drag & Drop
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{day: string, slotId: number} | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{day: string, slotId: number} | null>(null);

  const getSlotsForWing = useCallback((wingId: string): TimeSlot[] => {
    const wing = config.wings.find(w => w.id === wingId);
    if (!wing) return SECONDARY_BOYS_SLOTS;
    return config.slotDefinitions?.[wing.sectionType] || SECONDARY_BOYS_SLOTS;
  }, [config.wings, config.slotDefinitions]);

  const slots = useMemo(() => viewMode === 'SECTION' ? getSlotsForWing(activeWingId) : SECONDARY_BOYS_SLOTS.filter(s => !s.isBreak), [viewMode, activeWingId, getSlotsForWing]);

  const filteredEntities = useMemo(() => {
    if (viewMode === 'SECTION') return config.sections.filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
    if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
    return (config.rooms || []).map(r => ({ id: r, name: r }));
  }, [viewMode, activeWingId, config.sections, config.rooms, users]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(entry => {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) registry.set(key, [entry]);
      else registry.get(key)!.push(entry);
    });
    return registry;
  }, [currentTimetable]);

  const handlePublishMatrix = () => {
    triggerConfirm("This will push ALL DRAFT assignments to the LIVE timetable. Current live data for involved sections will be merged or replaced. Proceed?", async () => {
      setIsProcessing(true);
      try {
        if (isCloudActive) {
          const dbDraft = timetableDraft.map(e => ({
            id: e.id,
            section: e.section,
            wing_id: e.wingId,
            grade_id: e.gradeId,
            section_id: e.sectionId,
            class_name: e.className,
            day: e.day,
            slot_id: e.slotId,
            subject: e.subject,
            subject_category: e.subjectCategory,
            teacher_id: e.teacherId,
            teacher_name: e.teacherName,
            room: e.room,
            date: e.date,
            is_substitution: e.isSubstitution,
            block_id: e.blockId,
            block_name: e.blockName
          }));
          await supabase.from('timetable_entries').insert(dbDraft);
        }
        setTimetable([...timetable, ...timetableDraft]);
        setIsDraftMode(false);
        alert("Institutional Matrix Published Successfully.");
      } catch (err) { alert("Matrix Sync Error."); }
      finally { setIsProcessing(false); }
    });
  };

  const handleGradeAutoFill = () => {
    if (!selectedTargetId || viewMode !== 'SECTION') return;
    const targetSection = config.sections.find(s => s.id === selectedTargetId)!;
    const gradeId = targetSection.gradeId;
    const gradeName = config.grades.find(g => g.id === gradeId)?.name || "Grade";
    
    triggerConfirm(`DANGER: This will perform a synchronized Grade-wide fill for ${gradeName}. Proceed?`, () => {
      setIsProcessing(true);
      
      const sectionsInGrade = config.sections.filter(s => s.gradeId === gradeId);
      const blocksInGrade = config.combinedBlocks.filter(b => b.gradeId === gradeId);
      const gradeAssignments = assignments.filter(a => a.gradeId === gradeId);
      
      let newDraft: TimeTableEntry[] = [...timetableDraft.filter(t => !sectionsInGrade.some(s => s.id === t.sectionId))];
      
      blocksInGrade.forEach(block => {
        const blockTeachersIds = block.allocations.map(a => a.teacherId);
        const requiredPeriods = Math.max(...gradeAssignments.filter(a => blockTeachersIds.includes(a.teacherId)).map(a => a.groupPeriods || 0), 0);
        
        if (requiredPeriods === 0) return;

        let deployedCount = 0;
        const wingSlots = getSlotsForWing(block.gradeId ? config.grades.find(g => g.id === block.gradeId)?.wingId || '' : '').filter(s => !s.isBreak);

        for (const day of DAYS) {
          if (deployedCount >= requiredPeriods) break;
          for (const slot of wingSlots) {
            if (deployedCount >= requiredPeriods) break;

            const sectionsFree = block.sectionIds.every(sid => !newDraft.some(t => t.sectionId === sid && t.day === day && t.slotId === slot.id));
            const teachersFree = block.allocations.every(alloc => {
              const teacherBusyInTimetable = timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === alloc.teacherId);
              const teacherBusyInNewDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === alloc.teacherId);
              return !teacherBusyInTimetable && !teacherBusyInNewDraft;
            });

            if (sectionsFree && teachersFree) {
              block.sectionIds.forEach(sid => {
                const sect = config.sections.find(s => s.id === sid)!;
                block.allocations.forEach(alloc => {
                  newDraft.push({
                    id: generateUUID(),
                    section: config.wings.find(w => w.id === sect.wingId)?.sectionType || 'PRIMARY',
                    wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                    day, slotId: slot.id, subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                    teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '',
                    blockId: block.id, blockName: block.title
                  });
                });
              });
              deployedCount++;
            }
          }
        }
      });

      sectionsInGrade.forEach(sect => {
        const sectAssignments = gradeAssignments.filter(a => a.targetSectionIds?.includes(sect.id));
        const wingSlots = getSlotsForWing(sect.wingId).filter(s => !s.isBreak);
        
        sectAssignments.forEach(asgn => {
          asgn.loads.forEach(load => {
            let placed = 0;
            for (const day of DAYS) {
              if (placed >= load.periods) break;
              for (const slot of wingSlots) {
                if (placed >= load.periods) break;
                const slotBusy = newDraft.some(t => t.sectionId === sect.id && t.day === day && t.slotId === slot.id);
                const teacherBusy = timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === asgn.teacherId) ||
                                  newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === asgn.teacherId);
                if (!slotBusy && !teacherBusy) {
                  const teacher = users.find(u => u.id === asgn.teacherId);
                  newDraft.push({
                    id: generateUUID(),
                    section: config.wings.find(w => w.id === sect.wingId)?.sectionType || 'PRIMARY',
                    wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                    day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE,
                    teacherId: asgn.teacherId, teacherName: teacher?.name || 'Unknown', room: load.room || ''
                  });
                  placed++;
                }
              }
            }
          });
        });
      });

      setTimetableDraft(newDraft);
      setIsProcessing(false);
      alert(`Synchronized Genesis Complete for ${gradeName}.`);
    });
  };

  // EXECUTE SWAP OR MOVE LOGIC
  const executeMoveOrSwap = async (source: {day: string, slotId: number}, target: {day: string, slotId: number}) => {
    if (source.day === target.day && source.slotId === target.slotId) return;
    if (!selectedTargetId) return;

    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    
    // Find entries for the selected target in source and target cells
    const allSourceEntries = cellRegistry.get(`${source.day}-${source.slotId}`) || [];
    const allTargetEntries = cellRegistry.get(`${target.day}-${target.slotId}`) || [];

    const sourceEntry = allSourceEntries.find(t => {
      if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
      if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
      return t.room === selectedTargetId;
    });

    const targetEntry = allTargetEntries.find(t => {
      if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
      if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
      return t.room === selectedTargetId;
    });

    if (!sourceEntry && !targetEntry) {
      setIsProcessing(false);
      return;
    }

    const updatedSource = sourceEntry ? { ...sourceEntry, day: target.day, slotId: target.slotId, id: targetEntry ? sourceEntry.id : generateUUID() } : null;
    const updatedTarget = targetEntry ? { ...targetEntry, day: source.day, slotId: source.slotId, id: sourceEntry ? targetEntry.id : generateUUID() } : null;

    if (isCloudActive) {
      try {
        // Delete old positions for this specific class/teacher/room
        if (viewMode === 'SECTION') {
          await supabase.from(table).delete().match({ section_id: selectedTargetId, day: source.day, slot_id: source.slotId });
          await supabase.from(table).delete().match({ section_id: selectedTargetId, day: target.day, slot_id: target.slotId });
        } else if (viewMode === 'TEACHER') {
          await supabase.from(table).delete().match({ teacher_id: selectedTargetId, day: source.day, slot_id: source.slotId });
          await supabase.from(table).delete().match({ teacher_id: selectedTargetId, day: target.day, slot_id: target.slotId });
        }

        const toInsert = [];
        if (updatedSource) toInsert.push({ 
           id: updatedSource.id, section: updatedSource.section, wing_id: updatedSource.wingId, grade_id: updatedSource.gradeId, 
           section_id: updatedSource.sectionId, class_name: updatedSource.className, day: updatedSource.day, slot_id: updatedSource.slotId, 
           subject: updatedSource.subject, subject_category: updatedSource.subjectCategory, teacher_id: updatedSource.teacherId, 
           teacher_name: updatedSource.teacherName, room: updatedSource.room, block_id: updatedSource.blockId 
        });
        if (updatedTarget) toInsert.push({ 
           id: updatedTarget.id, section: updatedTarget.section, wing_id: updatedTarget.wingId, grade_id: updatedTarget.gradeId, 
           section_id: updatedTarget.sectionId, class_name: updatedTarget.className, day: updatedTarget.day, slot_id: updatedTarget.slotId, 
           subject: updatedTarget.subject, subject_category: updatedTarget.subjectCategory, teacher_id: updatedTarget.teacherId, 
           teacher_name: updatedTarget.teacherName, room: updatedTarget.room, block_id: updatedTarget.blockId 
        });

        if (toInsert.length > 0) await supabase.from(table).insert(toInsert);
      } catch (err) {
        console.error("Cloud movement failed", err);
      }
    }

    setCurrentTimetable(prev => {
      let filtered = prev.filter(t => {
        if (viewMode === 'SECTION') return !(t.sectionId === selectedTargetId && ((t.day === source.day && t.slotId === source.slotId) || (t.day === target.day && t.slotId === target.slotId)));
        if (viewMode === 'TEACHER') return !(t.teacherId === selectedTargetId && ((t.day === source.day && t.slotId === source.slotId) || (t.day === target.day && t.slotId === target.slotId)));
        return !(t.room === selectedTargetId && ((t.day === source.day && t.slotId === source.slotId) || (t.day === target.day && t.slotId === target.slotId)));
      });
      if (updatedSource) filtered.push(updatedSource);
      if (updatedTarget) filtered.push(updatedTarget);
      return filtered;
    });

    setIsProcessing(false);
    setSwapSource(null);
  };

  const saveCell = async () => {
    if (!editingCell || !selectedTargetId) return;
    setIsProcessing(true);
    const targetSection = config.sections.find(s => s.id === selectedTargetId)!;
    const teacher = users.find(u => u.id === cellForm.teacherId);
    const entry: TimeTableEntry = { id: generateUUID(), section: config.wings.find(w => w.id === targetSection.wingId)?.sectionType || 'PRIMARY', wingId: targetSection.wingId, gradeId: targetSection.gradeId, sectionId: targetSection.id, className: targetSection.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: teacher?.name || 'Unknown', room: cellForm.room, blockId: cellForm.blockId || undefined };
    
    if (isCloudActive) {
      const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
      await supabase.from(table).delete().match({ section_id: entry.sectionId, day: entry.day, slot_id: entry.slotId });
      if (entry.teacherId) {
        await supabase.from(table).insert({ 
          id: entry.id,
          section: entry.section,
          wing_id: entry.wingId,
          grade_id: entry.gradeId,
          section_id: entry.sectionId,
          class_name: entry.className,
          day: entry.day,
          slot_id: entry.slotId,
          subject: entry.subject,
          subject_category: entry.subjectCategory,
          teacher_id: entry.teacherId,
          teacher_name: entry.teacherName,
          room: entry.room,
          block_id: entry.blockId,
          is_substitution: entry.isSubstitution || false
        });
      }
    }
    setCurrentTimetable(prev => [...prev.filter(t => !(t.sectionId === entry.sectionId && t.day === entry.day && t.slotId === entry.slotId)), ...(entry.teacherId ? [entry] : [])]);
    setEditingCell(null);
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col h-full space-y-6 animate-in fade-in duration-700 pb-32">
      <div className="flex flex-col md:flex-row justify-between items-center px-2 gap-4">
         <div className="space-y-1">
            <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Scheduling Protocol Active</p>
         </div>
         <div className="flex flex-wrap gap-3 justify-center">
            {isDraftMode && (
               <button onClick={handlePublishMatrix} disabled={isProcessing} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-emerald-700 transition-all border border-emerald-400/20">Publish to Live</button>
            )}
            {isDraftMode && viewMode === 'SECTION' && selectedTargetId && (
              <button onClick={handleGradeAutoFill} disabled={isProcessing} className="bg-sky-500 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-sky-600 transition-all flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                Grade Master Fill
              </button>
            )}
            {isDraftMode && (
              <button onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg transition-all flex items-center gap-2 ${isSwapMode ? 'bg-amber-400 text-[#001f3f]' : 'bg-slate-100 text-slate-400'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                Swap Mode
              </button>
            )}
            {isAdmin && (
               <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800">
                  <button onClick={() => setIsDraftMode(false)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${!isDraftMode ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Live</button>
                  <button onClick={() => setIsDraftMode(true)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${isDraftMode ? 'bg-purple-600 text-white' : 'text-slate-400'}`}>Draft</button>
               </div>
            )}
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[600px]">
        <div className="p-4 border-b bg-slate-50/50 dark:bg-slate-800/30 flex flex-col xl:flex-row items-center gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm w-full xl:w-auto">
              <button onClick={() => setViewMode('SECTION')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
              <button onClick={() => setViewMode('TEACHER')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
              <button onClick={() => setViewMode('ROOM')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>
           </div>
           {viewMode === 'SECTION' && (
             <div className="flex gap-2 bg-white dark:bg-slate-950 p-1 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-hide">
               {config.wings.map(w => (
                 <button key={w.id} onClick={() => { setActiveWingId(w.id); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all whitespace-nowrap ${activeWingId === w.id ? 'bg-amber-400 text-[#001f3f]' : 'text-slate-400'}`}>{w.name}</button>
               ))}
             </div>
           )}
           <select className="flex-1 px-5 py-3 rounded-xl border-2 text-[10px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white" value={selectedTargetId} onChange={e => setSelectedTargetId(e.target.value)}>
             <option value="">Select Target Entity...</option>
             {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse table-fixed min-w-[1000px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr>
                <th className="w-24 p-4 text-[10px] font-black uppercase italic border border-white/10">Day</th>
                {slots.map(s => (
                  <th key={s.id} className="p-3 border border-white/10">
                    <p className="text-[10px] font-black uppercase">{s.label.replace('Period ', 'P')}</p>
                    <p className="text-[7px] opacity-60 font-bold">{s.startTime}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {DAYS.map(day => (
                <tr key={day} className="h-24">
                  <td className="bg-slate-50 dark:bg-slate-800/50 text-[#001f3f] dark:text-amber-400 font-black text-center text-xs uppercase border italic">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td 
                      key={s.id} 
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (isDraftMode && selectedTargetId) setDragOverCell({day, slotId: s.id});
                      }}
                      onDragLeave={() => setDragOverCell(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverCell(null);
                        const sourceData = e.dataTransfer.getData("cell");
                        if (sourceData) {
                          const source = JSON.parse(sourceData);
                          executeMoveOrSwap(source, {day, slotId: s.id});
                        }
                      }}
                      className={`border p-1 relative transition-all ${s.isBreak ? 'bg-amber-50/20' : ''} ${dragOverCell?.day === day && dragOverCell?.slotId === s.id ? 'bg-sky-100/50 ring-2 ring-sky-400 ring-inset' : ''}`}
                    >
                      {s.isBreak ? <div className="text-center text-[8px] font-black text-amber-500 opacity-40 uppercase">Recess</div> : (
                        <div 
                          draggable={isDraftMode && !!selectedTargetId}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("cell", JSON.stringify({day, slotId: s.id}));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => {
                            if (!isDraftMode || !selectedTargetId) return;
                            if (isSwapMode) {
                              if (!swapSource) {
                                setSwapSource({day, slotId: s.id});
                              } else {
                                executeMoveOrSwap(swapSource, {day, slotId: s.id});
                              }
                            } else {
                              setEditingCell({day, slotId: s.id});
                            }
                          }} 
                          className={`h-full min-h-[60px] ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50' : ''} ${swapSource?.day === day && swapSource?.slotId === s.id ? 'ring-4 ring-amber-400 ring-inset animate-pulse bg-amber-50' : ''}`}
                        >
                          {(() => {
                            const entriesInSlot = cellRegistry.get(`${day}-${s.id}`) || [];
                            const activeEntry = entriesInSlot.find(t => {
                              if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
                              if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
                              return t.room === selectedTargetId;
                            });
                            if (!activeEntry) return null;
                            const isBlock = activeEntry.blockId;
                            return (
                              <div className={`h-full p-2 border-2 rounded-lg bg-white shadow-sm flex flex-col justify-center text-center transition-all ${isBlock ? 'border-amber-400 bg-amber-50/20' : 'border-transparent'}`}>
                                <p className={`text-[10px] font-black uppercase truncate ${isBlock ? 'text-amber-600' : 'text-[#001f3f] dark:text-sky-700'}`}>{activeEntry.subject}</p>
                                <p className="text-[8px] font-bold text-slate-500 truncate mt-1">{viewMode === 'TEACHER' ? activeEntry.className : activeEntry.teacherName?.split(' ')[0]}</p>
                                {activeEntry.room && viewMode !== 'ROOM' && <p className="text-[7px] font-black text-amber-500 uppercase mt-0.5">{activeEntry.room}</p>}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingCell && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Edit Slot Assignment</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{editingCell.day} • Period {editingCell.slotId}</p>
              </div>
              <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}>
                          <option value="">Vacant / Remove</option>
                          {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                       </select>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                       <input placeholder="e.g. MATH" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})} />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Room</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}>
                          <option value="">Section Room</option>
                          {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                       </select>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Parallel Block</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}>
                          <option value="">None</option>
                          {config.combinedBlocks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                       </select>
                    </div>
                 </div>
              </div>
              <div className="pt-6 flex gap-4">
                 <button onClick={saveCell} disabled={isProcessing} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all">Commit Slot</button>
                 <button onClick={() => setEditingCell(null)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase">Cancel</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

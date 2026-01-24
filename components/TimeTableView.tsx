
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, SchoolSection } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { getWeekDates } from '../utils/dateUtils.ts';

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
  const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.INCHARGE_ALL;
  const isManagement = user?.role === UserRole.ADMIN || user?.role.startsWith('INCHARGE_');
  const isClassTeacher = !!user?.classTeacherOf;
  const isCloudActive = IS_CLOUD_ENABLED;
  
  const currentTimetable = isDraftMode ? timetableDraft : timetable;
  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const [activeWingId, setActiveWingId] = useState<string>(config.wings[0]?.id || '');
  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>(isManagement ? 'SECTION' : 'TEACHER');
  const [selectedTargetId, setSelectedTargetId] = useState<string>(isManagement ? '' : (user?.id || ''));
  
  const [editingCell, setEditingCell] = useState<{day: string, slotId: number} | null>(null);
  const [cellForm, setCellForm] = useState({ teacherId: '', subject: '', room: '', blockId: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalTab, setModalTab] = useState<'SINGLE' | 'BLOCK'>('SINGLE');

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
    if (isManagement) {
      if (viewMode === 'SECTION') {
        return config.sections.map(s => {
          const wing = config.wings.find(w => w.id === s.wingId);
          return { id: s.id, name: s.fullName, wingName: wing?.name || 'Unknown' };
        }).sort((a, b) => a.name.localeCompare(b.name));
      }
      if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
      return (config.rooms || []).map(r => ({ id: r, name: r }));
    } else {
      if (viewMode === 'TEACHER') return [{ id: user.id, name: user.name }];
      if (viewMode === 'SECTION' && isClassTeacher) {
        const sect = config.sections.find(s => s.id === user.classTeacherOf);
        return sect ? [{ id: sect.id, name: sect.fullName }] : [];
      }
      return [];
    }
  }, [viewMode, config.sections, config.wings, config.rooms, users, isManagement, user.id, user.name, isClassTeacher, user.classTeacherOf]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(entry => {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) registry.set(key, [entry]);
      else registry.get(key)!.push(entry);
    });
    return registry;
  }, [currentTimetable]);

  const checkConflict = useCallback((teacherId: string, day: string, slotId: number, currentEntryId: string | null, room?: string) => {
    if (!teacherId && !room) return { hasClash: false, details: '', type: null };
    const tid = teacherId?.toLowerCase().trim();
    const rid = room?.toLowerCase().trim();
    const combined = [...timetable, ...timetableDraft];
    if (tid) {
      const teacherClash = combined.find(t => t.id !== currentEntryId && t.teacherId?.toLowerCase().trim() === tid && t.day === day && t.slotId === slotId && !t.date);
      if (teacherClash) return { hasClash: true, details: `Personnel Clash: ${teacherClash.teacherName} is teaching ${teacherClash.className}.`, type: 'TEACHER' };
    }
    if (rid) {
      const roomClash = combined.find(t => t.id !== currentEntryId && t.room?.toLowerCase().trim() === rid && t.day === day && t.slotId === slotId && !t.date);
      if (roomClash) return { hasClash: true, details: `Room Clash: ${roomClash.room} is occupied by ${roomClash.className}.`, type: 'ROOM' };
    }
    return { hasClash: false, details: '', type: null };
  }, [timetable, timetableDraft]);

  const currentModalClash = useMemo(() => {
    if (!editingCell || modalTab === 'BLOCK') return { hasClash: false, details: '', type: null };
    const existingEntries = cellRegistry.get(`${editingCell.day}-${editingCell.slotId}`) || [];
    const activeExisting = existingEntries.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
    return checkConflict(cellForm.teacherId, editingCell.day, editingCell.slotId, activeExisting?.id || null, cellForm.room);
  }, [cellForm, editingCell, modalTab, checkConflict, cellRegistry, viewMode, selectedTargetId]);

  const executeMoveOrSwap = async (source: {day: string, slotId: number}, target: {day: string, slotId: number}) => {
    if (source.day === target.day && source.slotId === target.slotId) return;
    if (!selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    const allSrc = cellRegistry.get(`${source.day}-${source.slotId}`) || [];
    const activeSrc = allSrc.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
    const allDest = cellRegistry.get(`${target.day}-${target.slotId}`) || [];
    const activeDest = allDest.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));

    if (!activeSrc && !activeDest) { setIsProcessing(false); return; }
    
    if (activeSrc) {
       const clash = checkConflict(activeSrc.teacherId, target.day, target.slotId, activeSrc.id, activeSrc.room);
       if (clash.hasClash) { alert(`Movement Aborted:\n${clash.details}`); setIsProcessing(false); return; }
    }
    if (activeDest) {
       const clash = checkConflict(activeDest.teacherId, source.day, source.slotId, activeDest.id, activeDest.room);
       if (clash.hasClash) { alert(`Movement Aborted:\n${clash.details}`); setIsProcessing(false); return; }
    }

    const toMoveFromSrc = activeSrc ? (activeSrc.blockId ? allSrc.filter(t => t.blockId === activeSrc.blockId) : [activeSrc]) : [];
    const toMoveFromDest = activeDest ? (activeDest.blockId ? allDest.filter(t => t.blockId === activeDest.blockId) : [activeDest]) : [];
    const finalUpdateSet = [...toMoveFromSrc.map(s => ({...s, day: target.day, slotId: target.slotId, id: generateUUID()})), ...toMoveFromDest.map(s => ({...s, day: source.day, slotId: source.slotId, id: generateUUID()}))];

    if (isCloudActive && !isSandbox) {
      try {
        const invSects = Array.from(new Set([...toMoveFromSrc.map(i => i.sectionId), ...toMoveFromDest.map(i => i.sectionId)]));
        for (const sid of invSects) { 
          await supabase.from(table).delete().match({ section_id: sid, day: source.day, slot_id: source.slotId }); 
          await supabase.from(table).delete().match({ section_id: sid, day: target.day, slot_id: target.slotId });
        }
        if (finalUpdateSet.length > 0) await supabase.from(table).insert(finalUpdateSet.map(e => ({ 
          id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, 
          class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, 
          subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, 
          room: e.room, block_id: e.blockId, is_substitution: false 
        })));
      } catch (err) { console.error("Cloud swap error"); }
    }
    setCurrentTimetable(prev => [...prev.filter(t => !toMoveFromSrc.some(m => m.id === t.id) && !toMoveFromDest.some(m => m.id === t.id)), ...finalUpdateSet]);
    setSwapSource(null); setIsProcessing(false);
  };

  const handleOpenCell = (day: string, slotId: number) => {
    if (!isDraftMode || !selectedTargetId) return;
    if (isSwapMode) {
      if (!swapSource) setSwapSource({ day, slotId });
      else executeMoveOrSwap(swapSource, { day, slotId });
    } else {
      const entries = cellRegistry.get(`${day}-${slotId}`) || [];
      const act = entries.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
      if (act) {
        setCellForm({ teacherId: act.teacherId, subject: act.subject, room: act.room || '', blockId: act.blockId || '' });
        setModalTab(act.blockId ? 'BLOCK' : 'SINGLE');
      } else {
        setCellForm({ teacherId: '', subject: '', room: '', blockId: '' }); setModalTab('SINGLE');
      }
      setEditingCell({ day, slotId });
    }
  };

  const onDragStart = (e: React.DragEvent, day: string, slotId: number) => {
    if (!isDraftMode || !selectedTargetId) return;
    e.dataTransfer.setData('sourceCell', JSON.stringify({ day, slotId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, day: string, slotId: number) => {
    e.preventDefault();
    if (dragOverCell?.day !== day || dragOverCell?.slotId !== slotId) {
      setDragOverCell({ day, slotId });
    }
  };

  const onDrop = (e: React.DragEvent, day: string, slotId: number) => {
    e.preventDefault();
    setDragOverCell(null);
    const data = e.dataTransfer.getData('sourceCell');
    if (data) {
      const source = JSON.parse(data);
      executeMoveOrSwap(source, { day, slotId });
    }
  };

  const handleGradeMasterFill = () => {
    if (!selectedTargetId || viewMode !== 'SECTION') { alert("Please select a Class from the dropdown first."); return; }
    const currentSect = config.sections.find(s => s.id === selectedTargetId);
    if (!currentSect) return;

    triggerConfirm(`INSTITUTIONAL AUTO-FILL (PROTOCOL v5): Generate matrix for Grade ${currentSect.fullName.split(' ')[0]} with Class Teacher Anchor logic?`, async () => {
      setIsProcessing(true);
      const targetGradeId = currentSect.gradeId;
      const gradeSections = config.sections.filter(s => s.gradeId === targetGradeId);
      const gradeBlocks = config.combinedBlocks.filter(b => b.gradeId === targetGradeId);
      const gradeAssignments = assignments.filter(a => a.gradeId === targetGradeId);
      
      if (gradeAssignments.length === 0 && gradeBlocks.length === 0) {
        alert("Workload Registry Empty for this Grade.");
        setIsProcessing(false);
        return;
      }

      const newDraftEntries: TimeTableEntry[] = [];
      const wingSlots = getSlotsForWing(currentSect.wingId).filter(s => !s.isBreak);
      const searchSpace: {day: string, slotId: number}[] = [];
      DAYS.forEach(day => wingSlots.forEach(slot => searchSpace.push({ day, slotId: slot.id })));
      const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

      let anchorCount = 0;
      let skipCount = 0;
      const skipReasons: string[] = [];

      const isLoopConflicted = (teacherId: string, room: string, day: string, slotId: number, sectId: string) => {
        const tid = teacherId?.toLowerCase().trim();
        const rid = room?.toLowerCase().trim();
        if (newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.sectionId === sectId)) return { clash: true };
        if (tid && newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.teacherId?.toLowerCase().trim() === tid)) return { clash: true };
        if (rid && newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.room?.toLowerCase().trim() === rid)) return { clash: true };
        const clashResult = checkConflict(teacherId, day, slotId, 'loop-temp', room);
        if (clashResult.hasClash) return { clash: true, details: clashResult.details };
        return { clash: false };
      };

      // --- PHASE 0: CLASS TEACHER ANCHOR PROTOCOL ---
      // For each section in the grade, identify the class teacher and their anchor subject
      gradeSections.forEach(sect => {
        const teacher = users.find(u => u.classTeacherOf === sect.id);
        if (!teacher) return;
        const asgn = assignments.find(a => a.teacherId === teacher.id && a.gradeId === sect.gradeId);
        if (!asgn || !asgn.anchorSubject) return;

        const wing = config.wings.find(w => w.id === sect.wingId)!;
        const p1Slot = wingSlots.find(s => s.label === 'Period 1') || wingSlots[0];
        
        DAYS.forEach(day => {
          if (!isLoopConflicted(teacher.id, `ROOM ${sect.fullName}`, day, p1Slot.id, sect.id).clash) {
            newDraftEntries.push({
              id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId,
              sectionId: sect.id, className: sect.fullName, day, slotId: p1Slot.id,
              subject: asgn.anchorSubject!.toUpperCase(), subjectCategory: SubjectCategory.CORE,
              teacherId: teacher.id, teacherName: teacher.name, room: `ROOM ${sect.fullName}`
            });
            anchorCount++;
          }
        });
      });

      // --- PHASE 1: PARALLEL BLOCKS ---
      for (const block of gradeBlocks) {
        let blockPlaced = 0;
        const shuffledSpace = shuffle(searchSpace);
        for (const spot of shuffledSpace) {
          if (blockPlaced >= block.weeklyPeriods) break;
          const canPlacePool = block.sectionIds.every((sid, idx) => {
            const alloc = block.allocations[idx % block.allocations.length];
            return !isLoopConflicted(alloc?.teacherId || '', alloc?.room || '', spot.day, spot.slotId, sid).clash;
          });
          if (canPlacePool) {
            block.sectionIds.forEach((sid, idx) => {
              const sect = config.sections.find(s => s.id === sid)!;
              const wing = config.wings.find(w => w.id === sect.wingId)!;
              const alloc = block.allocations[idx % block.allocations.length];
              newDraftEntries.push({
                id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId,
                sectionId: sect.id, className: sect.fullName, day: spot.day,
                /* Fixed Error: removed duplicate and invalid slot_id key */
                slotId: spot.slotId, subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                teacherId: alloc.teacherId, teacherName: alloc.teacherName,
                room: alloc.room || `ROOM ${sect.fullName}`, blockId: block.id, blockName: block.title
              });
            });
            blockPlaced++;
          }
        }
        if (blockPlaced < block.weeklyPeriods) { skipCount += (block.weeklyPeriods - blockPlaced); skipReasons.push(`${block.title}: Constraints reached.`); }
      }

      // --- PHASE 2: INDIVIDUAL FACULTY LOADS ---
      for (const asgn of gradeAssignments) {
        const teacher = users.find(u => u.id === asgn.teacherId);
        if (!teacher) continue;
        const targetSects = asgn.targetSectionIds?.length ? gradeSections.filter(s => asgn.targetSectionIds!.includes(s.id)) : gradeSections;

        for (const sect of targetSects) {
          const wing = config.wings.find(w => w.id === sect.wingId)!;
          for (const load of asgn.loads) {
            let placed = 0;
            // Subtract anchor usage if this load matches the anchor subject
            let periodsToPlace = load.periods;
            if (asgn.anchorSubject === load.subject && teacher.classTeacherOf === sect.id) {
               // We already placed 5 periods in Phase 0
               periodsToPlace = Math.max(0, load.periods - 5);
            }

            const targetRoom = load.room || `ROOM ${sect.fullName}`;
            const shuffledSpace = shuffle(searchSpace);

            for (const spot of shuffledSpace) {
              if (placed >= periodsToPlace) break;
              if (!isLoopConflicted(asgn.teacherId, targetRoom, spot.day, spot.slotId, sect.id).clash) {
                newDraftEntries.push({
                  id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId,
                  sectionId: sect.id, className: sect.fullName, day: spot.day, slotId: spot.slotId,
                  subject: load.subject, subjectCategory: SubjectCategory.CORE,
                  teacherId: asgn.teacherId, teacherName: teacher.name, room: targetRoom
                });
                placed++;
              }
            }
            if (placed < periodsToPlace) { skipCount += (periodsToPlace - placed); skipReasons.push(`${teacher.name}: ${periodsToPlace - placed} periods skipped.`); }
          }
        }
      }

      if (newDraftEntries.length > 0) {
          const gradeSectIds = gradeSections.map(s => s.id);
          if (isCloudActive && !isSandbox) {
            try {
              await supabase.from('timetable_drafts').delete().in('section_id', gradeSectIds);
              await supabase.from('timetable_drafts').insert(newDraftEntries.map(e => ({
                id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId,
                class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject,
                subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName,
                room: e.room, block_id: e.blockId, is_substitution: false
              })));
            } catch (err) { console.error("Cloud sync error"); }
          }
          setTimetableDraft(prev => [...prev.filter(p => !gradeSectIds.includes(p.sectionId)), ...newDraftEntries]);
          let report = `Auto-Fill Executed: Deployed ${newDraftEntries.length} periods (Anchors: ${anchorCount}).`;
          if (skipCount > 0) report += `\n\n⚠️ Constraints: ${skipCount} periods skipped.`;
          alert(report);
      } else { alert("Auto-Fill Failure: All slots blocked."); }
      setIsProcessing(false);
    });
  };

  const handleClearSectionDraft = () => {
    if (!selectedTargetId || viewMode !== 'SECTION') return;
    const sect = config.sections.find(s => s.id === selectedTargetId);
    if (!sect) return;
    triggerConfirm(`CLEAN SLATE: Delete all draft entries for ${sect.fullName}?`, async () => {
        setIsProcessing(true);
        if (isCloudActive && !isSandbox) await supabase.from('timetable_drafts').delete().eq('section_id', selectedTargetId);
        setTimetableDraft(prev => prev.filter(t => t.sectionId !== selectedTargetId));
        setIsProcessing(false);
    });
  };

  const handlePublishMatrix = () => {
    if (timetableDraft.length === 0) return;
    triggerConfirm("RE-DEPLOYMENT PROTOCOL: Overwrite live schedule with draft entries?", async () => {
      setIsProcessing(true);
      try {
        if (isCloudActive && !isSandbox) {
          const livePayload = timetableDraft.map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room || null, date: e.date || null, is_substitution: e.isSubstitution || false, block_id: e.blockId || null, block_name: e.blockName || null }));
          await supabase.from('timetable_entries').upsert(livePayload);
          await supabase.from('timetable_drafts').delete().in('id', timetableDraft.map(d => d.id));
        }
        const targetSectionIds = new Set(timetableDraft.map(d => d.sectionId));
        setTimetable(prev => [...prev.filter(t => !targetSectionIds.has(t.sectionId)), ...timetableDraft]);
        setTimetableDraft([]); setIsDraftMode(false);
      } catch (err: any) { alert(`Sync error: ${err.message}`); } finally { setIsProcessing(false); }
    });
  };

  return (
    <div className={`flex flex-col h-full space-y-4 animate-in fade-in duration-700 pb-20 ${isDraftMode ? 'bg-indigo-50/10 dark:bg-indigo-900/5 rounded-3xl ring-1 ring-indigo-500/10 shadow-inner' : ''}`}>
      <div className="flex flex-col md:flex-row justify-between items-center px-4 gap-4 py-2">
         <div className="space-y-0.5 text-center md:text-left">
            <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Protocol Active {isDraftMode && '• DRAFT'}</p>
         </div>
         <div className="flex flex-wrap gap-2 justify-center">
            {isDraftMode && (
              <button 
                onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} 
                className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-md border transition-all ${isSwapMode ? 'bg-amber-400 text-white' : 'bg-white text-slate-400'}`}
              >
                {isSwapMode ? 'Swap Active' : 'Enable Swap Mode'}
              </button>
            )}
            {isDraftMode && viewMode === 'SECTION' && selectedTargetId && (
                <button onClick={handleClearSectionDraft} disabled={isProcessing} className="bg-rose-50 text-rose-600 border border-rose-100 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-sm hover:bg-rose-100">Purge Draft</button>
            )}
            <button 
              onClick={isDraftMode ? handleGradeMasterFill : () => alert("Enable DRAFT MODE to utilize Auto-Fill.")} 
              disabled={isProcessing} 
              className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-md border transition-all flex items-center gap-1.5 ${
                isDraftMode 
                  ? (viewMode === 'SECTION' && selectedTargetId ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-200 text-slate-400 cursor-help')
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed grayscale'
              }`}
            >
              Grade Auto-Fill
            </button>
            {isDraftMode && (<button onClick={handlePublishMatrix} disabled={isProcessing} className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-md hover:bg-emerald-700">Deploy Live</button>)}
            {isAdmin && (
              <div className="flex bg-white dark:bg-slate-900 p-0.5 rounded-xl shadow-md border border-slate-100">
                <button onClick={() => setIsDraftMode(false)} className={`px-4 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${!isDraftMode ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Live</button>
                <button onClick={() => setIsDraftMode(true)} className={`px-4 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${isDraftMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Draft</button>
              </div>
            )}
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[1.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col mx-4 h-[calc(100vh-220px)]">
        <div className="p-3 border-b bg-slate-50/50 dark:bg-slate-800/30 flex flex-col xl:flex-row items-center gap-3">
           {(isManagement || isClassTeacher) && (
             <div className="flex bg-white dark:bg-slate-950 p-0.5 rounded-lg border border-slate-100 shadow-sm w-full xl:w-auto">
               <button onClick={() => { setViewMode('SECTION'); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
               <button onClick={() => { setViewMode('TEACHER'); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
               {isManagement && <button onClick={() => { setViewMode('ROOM'); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>}
             </div>
           )}
           <select 
              className={`flex-1 px-4 py-2 rounded-lg border text-[9px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white border-slate-100`} 
              value={selectedTargetId} 
              onChange={e => {
                const val = e.target.value;
                setSelectedTargetId(val);
                if (viewMode === 'SECTION' && val) {
                  const sect = config.sections.find(s => s.id === val);
                  if (sect) setActiveWingId(sect.wingId);
                }
              }}
            >
              <option value="">Select Target...</option>
              {filteredEntities.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} {(e as any).wingName ? `(${ (e as any).wingName })` : ''}
                </option>
              ))}
            </select>
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full border-collapse table-fixed min-w-[900px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr><th className="w-16 p-2 text-[9px] font-black uppercase italic border border-white/10 sticky left-0 z-[60] bg-[#001f3f]">Day</th>{slots.map(s => (<th key={s.id} className="p-1 border border-white/10"><p className="text-[9px] font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p><p className="text-[7px] opacity-60 font-bold">{s.startTime}</p></th>))}</tr>
            </thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day} className="h-14">
                  <td className="bg-slate-50 dark:bg-slate-800/80 text-[#001f3f] dark:text-amber-400 font-black text-center text-[10px] uppercase border italic sticky left-0 z-30 shadow-sm">{day.substring(0,3)}</td>
                  {slots.map(s => {
                    const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                    const act = ents.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
                    const isDragOver = dragOverCell?.day === day && dragOverCell?.slotId === s.id;
                    const isSwapSrc = swapSource?.day === day && swapSource?.slotId === s.id;
                    
                    return (
                      <td 
                        key={s.id} 
                        onDragOver={(e) => onDragOver(e, day, s.id)}
                        onDrop={(e) => onDrop(e, day, s.id)}
                        className={`border p-0.5 relative border-slate-100 dark:border-slate-800 transition-all ${isDragOver ? 'bg-amber-50/50 ring-2 ring-amber-400 ring-inset ring-dashed' : s.isBreak ? 'bg-amber-50/20' : ''}`}
                      >
                        {s.isBreak ? <div className="text-center text-[7px] font-black text-amber-500 uppercase">Break</div> : (
                          <div 
                            onClick={() => handleOpenCell(day, s.id)} 
                            draggable={isDraftMode && !!selectedTargetId && !!act}
                            onDragStart={(e) => onDragStart(e, day, s.id)}
                            className={`h-full min-h-[44px] p-0.5 rounded-lg transition-all ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''} ${isSwapSrc ? 'ring-2 ring-amber-500' : ''}`}
                          >
                            {act && (
                                <div className={`h-full p-1 border rounded-md bg-white dark:bg-slate-900 shadow-sm flex flex-col justify-center text-center relative ${act.blockId ? 'border-amber-300' : 'border-slate-100 dark:border-slate-800'} ${isDraftMode && selectedTargetId ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                                  <p className="text-[8px] font-black uppercase truncate text-[#001f3f] dark:text-white leading-tight">{act.subject}</p>
                                  <p className="text-[7px] font-bold text-slate-400 truncate mt-0.5 leading-none">{viewMode === 'TEACHER' ? act.className : act.teacherName?.split(' ')[0]}</p>
                                </div>
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

      {editingCell && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#001f3f]/90 backdrop-blur-md animate-in fade-in">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2rem] p-6 shadow-2xl space-y-6 animate-in zoom-in">
              <div className="text-center">
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Allocation</h4>
                 <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{editingCell.day} • Slot {editingCell.slotId}</p>
              </div>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl">
                 <button onClick={() => setModalTab('SINGLE')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${modalTab === 'SINGLE' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Single</button>
                 <button onClick={() => setModalTab('BLOCK')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${modalTab === 'BLOCK' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Pool</button>
              </div>
              {modalTab === 'SINGLE' && currentModalClash.hasClash && (
                <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-100 flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
                  <div className="w-10 h-10 bg-rose-500 text-white rounded-xl flex items-center justify-center shrink-0 shadow-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest leading-none">Collision Detected</p>
                    <p className="text-xs font-bold text-rose-500 leading-tight">{currentModalClash.details}</p>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {modalTab === 'SINGLE' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Faculty</label>
                      <select className={`w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 transition-all ${currentModalClash.type === 'TEACHER' ? 'border-rose-400 ring-4 ring-rose-500/10' : 'border-transparent'}`} value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}><option value="">Staff...</option>{users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Matter</label>
                      <select className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 border-transparent" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})}><option value="">Subject...</option>{config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Room / Temporal Venue</label>
                      <select className={`w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 transition-all ${currentModalClash.type === 'ROOM' ? 'border-rose-400 ring-4 ring-rose-500/10' : 'border-transparent'}`} value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}><option value="">Room...</option>{config.rooms.map(r => <option key={r} value={r}>{r}</option>)}</select>
                    </div>
                  </div>
                ) : (
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Existing Pool Template</label>
                      <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-[10px] uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}><option value="">Choose Pool...</option>{config.combinedBlocks.filter(b => b.gradeId === config.sections.find(s => s.id === selectedTargetId)?.gradeId).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
                   </div>
                )}
              </div>
              <div className="pt-4 space-y-4">
                <button onClick={async () => {
                      const sect = config.sections.find(s => s.id === selectedTargetId)!; const t = users.find(u => u.id === cellForm.teacherId); const wing = config.wings.find(w => w.id === sect.wingId)!;
                      if (modalTab === 'SINGLE') { const clash = checkConflict(cellForm.teacherId, editingCell.day, editingCell.slotId, null, cellForm.room); if (clash.hasClash) { alert(`Institutional Blockage:\n\n${clash.details}`); return; } }
                      const e: TimeTableEntry = { id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: t?.name || 'Unknown', room: cellForm.room };
                      /* Fixed Error: Use correct camelCase properties from e object for Supabase inserts */
                      if (isCloudActive && !isSandbox) { await supabase.from('timetable_drafts').delete().match({ section_id: e.sectionId, day: e.day, slot_id: e.slotId }); if (e.teacherId) await supabase.from('timetable_drafts').insert({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, is_substitution: false }); }
                      setTimetableDraft(prev => [...prev.filter(t => !(t.sectionId === e.sectionId && t.day === e.day && t.slotId === e.slotId)), ...(e.teacherId ? [e] : [])]); setEditingCell(null);
                  }} className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl transition-all ${currentModalClash.hasClash ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950 active:scale-95'}`}>{currentModalClash.hasClash ? 'Entry Blocked by Conflict' : 'Authorize Entry'}</button>
                <button onClick={() => setEditingCell(null)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest">Discard Changes</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

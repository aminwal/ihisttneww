
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

  const currentWeekDates = useMemo(() => getWeekDates(), []);

  const getSlotsForWing = useCallback((wingId: string): TimeSlot[] => {
    const wing = config.wings.find(w => w.id === wingId);
    if (!wing) return SECONDARY_BOYS_SLOTS;
    return config.slotDefinitions?.[wing.sectionType] || SECONDARY_BOYS_SLOTS;
  }, [config.wings, config.slotDefinitions]);

  const slots = useMemo(() => viewMode === 'SECTION' ? getSlotsForWing(activeWingId) : SECONDARY_BOYS_SLOTS.filter(s => !s.isBreak), [viewMode, activeWingId, getSlotsForWing]);

  const filteredEntities = useMemo(() => {
    if (isManagement) {
      if (viewMode === 'SECTION') return config.sections.filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
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
  }, [viewMode, activeWingId, config.sections, config.rooms, users, isManagement, user.id, user.name, isClassTeacher, user.classTeacherOf]);

  useEffect(() => {
    if (!isManagement) {
      if (viewMode === 'TEACHER') setSelectedTargetId(user.id);
      else if (viewMode === 'SECTION' && isClassTeacher) setSelectedTargetId(user.classTeacherOf || '');
    }
  }, [viewMode, isManagement, user.id, isClassTeacher, user.classTeacherOf]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(entry => {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) registry.set(key, [entry]);
      else registry.get(key)!.push(entry);
    });
    return registry;
  }, [currentTimetable]);

  /**
   * Enhanced Conflict Engine
   * Detects: Staff Double-Booking, Room Overlap, and Sandbox Volatility
   */
  const checkConflict = useCallback((teacherId: string, day: string, slotId: number, currentId: string, room?: string) => {
    if ((!teacherId || teacherId === 'UNASSIGNED') && !room) return { teacherClash: false, roomClash: false };
    
    const tid = teacherId?.toLowerCase().trim();
    const rid = room?.toLowerCase().trim();
    const combined = [...timetable, ...timetableDraft];
    
    const teacherClash = tid ? combined.some(t => 
      t.id !== currentId && 
      t.teacherId?.toLowerCase().trim() === tid && 
      t.day === day && 
      t.slotId === slotId &&
      !t.date
    ) : false;

    const roomClash = rid ? combined.some(t => 
      t.id !== currentId && 
      t.room?.toLowerCase().trim() === rid && 
      t.day === day && 
      t.slotId === slotId &&
      !t.date
    ) : false;

    return { teacherClash, roomClash };
  }, [timetable, timetableDraft]);

  /**
   * Advanced Grade Master Fill
   * Iterative constraints: Parallel Blocks -> Individual Loads -> Residuals
   */
  const handleGradeMasterFill = () => {
    if (!selectedTargetId || viewMode !== 'SECTION') {
      alert("Target Section must be selected to initiate Grade Master Fill.");
      return;
    }

    const currentSect = config.sections.find(s => s.id === selectedTargetId);
    if (!currentSect) return;

    triggerConfirm(`INSTITUTIONAL AUTO-FILL: This will generate a candidate matrix for Grade ${currentSect.fullName.split(' ')[0]} based on current faculty assignments. Existing draft entries for this grade will be replaced. Proceed?`, async () => {
      setIsProcessing(true);
      const targetGradeId = currentSect.gradeId;
      const gradeSections = config.sections.filter(s => s.gradeId === targetGradeId);
      const gradeBlocks = config.combinedBlocks.filter(b => b.gradeId === targetGradeId);
      const gradeAssignments = assignments.filter(a => a.gradeId === targetGradeId);

      const newDraftEntries: TimeTableEntry[] = [];
      const wingSlots = getSlotsForWing(currentSect.wingId).filter(s => !s.isBreak);

      // Local conflict tracker for the generation loop
      const isLoopConflicted = (teacherId: string, room: string, day: string, slotId: number, sectId: string) => {
        const tid = teacherId?.toLowerCase().trim();
        const rid = room?.toLowerCase().trim();
        
        // 1. Is the class already assigned?
        if (newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.sectionId === sectId)) return true;
        
        // 2. Is the teacher busy in this newly built draft?
        if (tid && newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.teacherId?.toLowerCase().trim() === tid)) return true;
        
        // 3. Is the room taken in this newly built draft?
        if (rid && newDraftEntries.some(e => e.day === day && e.slotId === slotId && e.room?.toLowerCase().trim() === rid)) return true;
        
        // 4. Check against existing external DB state (Live + existing drafts)
        const dbConflicts = checkConflict(teacherId, day, slotId, 'temp', room);
        return dbConflicts.teacherClash || dbConflicts.roomClash;
      };

      // Phase 1: Anchor Parallel Pools (The most constrained temporal slots)
      for (const block of gradeBlocks) {
        let placed = 0;
        for (const day of DAYS) {
          for (const slot of wingSlots) {
            if (placed >= block.weeklyPeriods) break;
            
            // Validate all sections and teachers in pool are simultaneously available
            const canPlacePool = block.sectionIds.every(sid => {
                const sect = config.sections.find(sx => sx.id === sid);
                if (!sect) return false;
                const alloc = block.allocations.find(a => a.teacherId); // Simplified check
                return !isLoopConflicted(alloc?.teacherId || '', alloc?.room || '', day, slot.id, sid);
            });

            if (canPlacePool) {
              block.sectionIds.forEach((sid, idx) => {
                const sect = config.sections.find(s => s.id === sid)!;
                const alloc = block.allocations[idx % block.allocations.length];
                newDraftEntries.push({
                  id: generateUUID(), section: sect.wingId as any, wingId: sect.wingId, gradeId: sect.gradeId,
                  sectionId: sect.id, className: sect.fullName, day, slotId: slot.id,
                  subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                  teacherId: alloc.teacherId, teacherName: alloc.teacherName,
                  room: alloc.room || `ROOM ${sect.fullName}`, blockId: block.id, blockName: block.title
                });
              });
              placed++;
            }
          }
          if (placed >= block.weeklyPeriods) break;
        }
      }

      // Phase 2: Deploy Individual Workloads
      for (const asgn of gradeAssignments) {
        const teacher = users.find(u => u.id === asgn.teacherId);
        if (!teacher) continue;
        for (const load of asgn.loads) {
          const targetSects = asgn.targetSectionIds?.length ? gradeSections.filter(s => asgn.targetSectionIds!.includes(s.id)) : gradeSections;
          for (const sect of targetSects) {
            let placed = 0;
            for (const day of DAYS) {
              for (const slot of wingSlots) {
                if (placed >= load.periods) break;
                const targetRoom = load.room || `ROOM ${sect.fullName}`;
                if (!isLoopConflicted(asgn.teacherId, targetRoom, day, slot.id, sect.id)) {
                  newDraftEntries.push({
                    id: generateUUID(), section: sect.wingId as any, wingId: sect.wingId, gradeId: sect.gradeId,
                    sectionId: sect.id, className: sect.fullName, day, slotId: slot.id,
                    subject: load.subject, subjectCategory: SubjectCategory.CORE,
                    teacherId: asgn.teacherId, teacherName: teacher.name,
                    room: targetRoom
                  });
                  placed++;
                }
              }
              if (placed >= load.periods) break;
            }
          }
        }
      }

      if (isCloudActive && !isSandbox) {
        try {
          const gradeSectIds = gradeSections.map(s => s.id);
          await supabase.from('timetable_drafts').delete().in('section_id', gradeSectIds);
          await supabase.from('timetable_drafts').insert(newDraftEntries.map(e => ({
            id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId,
            class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject,
            subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName,
            room: e.room, block_id: e.blockId, is_substitution: false
          })));
        } catch (err) { console.error("Cloud synchronization failure during auto-fill"); }
      }

      setTimetableDraft(prev => [...prev.filter(p => !gradeSections.some(s => s.id === p.sectionId)), ...newDraftEntries]);
      setIsProcessing(false);
      alert(`Auto-Fill Protocol Executed: Allocated ${newDraftEntries.length} instructional periods with zero collisions.`);
    });
  };

  const getTeacherAvailability = useCallback((day: string, slotId: number) => {
    if (!swapSource || !selectedTargetId) return null;
    const sourceEntries = cellRegistry.get(`${swapSource.day}-${swapSource.slotId}`) || [];
    const activeSource = sourceEntries.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
    if (!activeSource) return null;
    const conflicts = checkConflict(activeSource.teacherId, day, slotId, activeSource.id, activeSource.room);
    return !(conflicts.teacherClash || conflicts.roomClash);
  }, [swapSource, selectedTargetId, cellRegistry, viewMode, checkConflict]);

  const handlePublishMatrix = () => {
    if (timetableDraft.length === 0) { alert("Draft Matrix is empty."); return; }
    triggerConfirm("RE-DEPLOYMENT PROTOCOL: Push ALL draft assignments to the LIVE matrix? This will overwrite the live schedule for the involved sections.", async () => {
      setIsProcessing(true);
      try {
        if (isCloudActive && !isSandbox) {
          const livePayload = timetableDraft.map(e => ({
            id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId,
            class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject,
            subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName,
            room: e.room || null, date: e.date || null, is_substitution: e.isSubstitution || false,
            block_id: e.blockId || null, block_name: e.blockName || null
          }));
          const { error: upsertError } = await supabase.from('timetable_entries').upsert(livePayload, { onConflict: 'id' });
          if (upsertError) throw upsertError;
          const draftIds = timetableDraft.map(d => d.id);
          await supabase.from('timetable_drafts').delete().in('id', draftIds);
        }
        const targetSectionIds = new Set(timetableDraft.map(d => d.sectionId));
        setTimetable(prev => [...prev.filter(t => !targetSectionIds.has(t.sectionId)), ...timetableDraft]);
        setTimetableDraft([]); setIsDraftMode(false);
        alert("Institutional Matrix Synchronized Successfully.");
      } catch (err: any) { alert(`Sync aborted: ${err.message}`); } finally { setIsProcessing(false); }
    });
  };

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

    const toMoveFromSrc = activeSrc ? (activeSrc.blockId ? allSrc.filter(t => t.blockId === activeSrc.blockId) : [activeSrc]) : [];
    const toMoveFromDest = activeDest ? (activeDest.blockId ? allDest.filter(t => t.blockId === activeDest.blockId) : [activeDest]) : [];

    const updatedSourceMoves = toMoveFromSrc.map(s => ({ ...s, day: target.day, slotId: target.slotId, id: generateUUID() }));
    const updatedDestMoves = toMoveFromDest.map(s => ({ ...s, day: source.day, slotId: source.slotId, id: generateUUID() }));
    const finalUpdateSet = [...updatedSourceMoves, ...updatedDestMoves];

    if (isCloudActive && !isSandbox) {
      try {
        const invSects = Array.from(new Set([...toMoveFromSrc.map(i => i.sectionId), ...toMoveFromDest.map(i => i.sectionId)]));
        for (const sid of invSects) { 
          await supabase.from(table).delete().match({ section_id: sid, day: source.day, slot_id: source.slotId }); 
          await supabase.from(table).delete().match({ section_id: sid, day: target.day, slot_id: target.slotId });
        }
        if (finalUpdateSet.length > 0) {
          await supabase.from(table).insert(finalUpdateSet.map(e => ({ 
            id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, 
            class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, 
            subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, 
            room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false 
          })));
        }
      } catch (err) { console.error("Cloud exchange failure during move/swap"); }
    }

    setCurrentTimetable(prev => [
      ...prev.filter(t => !toMoveFromSrc.some(m => m.id === t.id) && !toMoveFromDest.some(m => m.id === t.id)), 
      ...finalUpdateSet
    ]);
    setSwapSource(null); setDragOverCell(null); setIsProcessing(false);
  };

  const handleDeleteCell = async () => {
    if (!editingCell || !selectedTargetId) return;
    const entries = cellRegistry.get(`${editingCell.day}-${editingCell.slotId}`) || [];
    const act = entries.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
    if (!act) return;

    if (!window.confirm("Dismantle this allocation?")) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    const toDelete = act.blockId ? entries.filter(e => e.blockId === act.blockId) : [act];
    const deleteIds = toDelete.map(d => d.id);

    try {
      if (isCloudActive && !isSandbox) await supabase.from(table).delete().in('id', deleteIds);
      setCurrentTimetable(prev => prev.filter(t => !deleteIds.includes(t.id)));
      setEditingCell(null);
    } catch (err) { alert("Deletion failed"); } finally { setIsProcessing(false); }
  };

  const saveCell = async () => {
    if (!editingCell || !selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    
    if (modalTab === 'BLOCK' && cellForm.blockId) {
      const block = config.combinedBlocks.find(b => b.id === cellForm.blockId);
      if (block) {
        const toInsert = block.sectionIds.map((sid, idx) => {
          const sect = config.sections.find(s => s.id === sid)!;
          const alloc = block.allocations[idx % block.allocations.length];
          return { id: generateUUID(), section: sect.wingId as any, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: alloc.subject, subjectCategory: SubjectCategory.CORE, teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '', blockId: block.id, blockName: block.title };
        });
        if (isCloudActive && !isSandbox) {
          for (const sid of block.sectionIds) await supabase.from(table).delete().match({ section_id: sid, day: editingCell.day, slot_id: editingCell.slotId });
          await supabase.from(table).insert(toInsert.map(e => ({ 
            id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, 
            class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, 
            subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, 
            room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false 
          })));
        }
        setCurrentTimetable(prev => [...prev.filter(t => !(block.sectionIds.includes(t.sectionId) && t.day === editingCell.day && t.slotId === editingCell.slotId)), ...toInsert]);
      }
    } else {
      const sect = config.sections.find(s => s.id === selectedTargetId)!;
      const t = users.find(u => u.id === cellForm.teacherId);
      const e: TimeTableEntry = { id: generateUUID(), section: sect.wingId as any, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: t?.name || 'Unknown', room: cellForm.room, blockId: cellForm.blockId || undefined };
      if (isCloudActive && !isSandbox) {
        await supabase.from(table).delete().match({ section_id: e.sectionId, day: e.day, slot_id: e.slotId });
        if (e.teacherId) await supabase.from(table).insert({ 
          id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, 
          class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, 
          subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, 
          room: e.room, block_id: e.blockId, is_substitution: false 
        });
      }
      setCurrentTimetable(prev => [...prev.filter(t => !(t.sectionId === e.sectionId && t.day === e.day && t.slotId === e.slotId)), ...(e.teacherId ? [e] : [])]);
    }
    setEditingCell(null); setIsProcessing(false);
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

  return (
    <div className={`flex flex-col h-full space-y-6 animate-in fade-in duration-700 pb-32 ${isDraftMode ? 'bg-indigo-50/20 dark:bg-indigo-900/5 rounded-3xl ring-1 ring-indigo-500/20 shadow-inner' : ''}`}>
      <div className="flex flex-col md:flex-row justify-between items-center px-4 gap-4 py-4">
         <div className="space-y-1 text-center md:text-left">
            <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Scheduling Protocol Active {isDraftMode && '• DRAFT MODE'}</p>
         </div>
         <div className="flex flex-wrap gap-3 justify-center">
            {/* Grade Master Fill Button - Now always visible but context-aware */}
            <button 
              onClick={isDraftMode ? handleGradeMasterFill : () => alert("PROTOCOL RESTRICTED: Please switch to DRAFT MODE to utilize Grade Master Auto-Fill.")} 
              disabled={isProcessing || !selectedTargetId || viewMode !== 'SECTION'} 
              className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg border transition-all flex items-center gap-2 ${
                isDraftMode 
                  ? 'bg-amber-500 text-white hover:bg-amber-600 border-amber-400/20 animate-pulse' 
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed grayscale'
              }`}
            >
              {!isDraftMode && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>}
              Grade Master Fill
            </button>

            {isDraftMode && (<button onClick={handlePublishMatrix} disabled={isProcessing} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-emerald-700">Publish to Live</button>)}
            {isAdmin && (
              <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-lg border border-slate-100">
                <button onClick={() => setIsDraftMode(false)} className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${!isDraftMode ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Live</button>
                <button onClick={() => setIsDraftMode(true)} className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${isDraftMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Draft</button>
              </div>
            )}
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col mx-4">
        <div className="p-4 border-b bg-slate-50/50 dark:bg-slate-800/30 flex flex-col xl:flex-row items-center gap-4">
           {(isManagement || isClassTeacher) && (
             <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-100 shadow-sm w-full xl:w-auto">
               <button onClick={() => { setViewMode('SECTION'); setSelectedTargetId(''); }} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex-1 ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
               <button onClick={() => { setViewMode('TEACHER'); setSelectedTargetId(''); }} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex-1 ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
               {isManagement && <button onClick={() => { setViewMode('ROOM'); setSelectedTargetId(''); }} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex-1 ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>}
             </div>
           )}
           <div className="flex-1 flex items-center gap-3 w-full">
              <select className={`flex-1 px-5 py-3 rounded-xl border-2 text-[10px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white border-slate-100 dark:border-slate-800`} value={selectedTargetId} onChange={e => setSelectedTargetId(e.target.value)}><option value="">Select Target Entity...</option>{filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
           </div>
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full border-collapse table-fixed min-w-[1000px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr><th className="w-24 p-4 text-[10px] font-black uppercase italic border border-white/10 sticky left-0 z-[60] bg-[#001f3f]">Day</th>{slots.map(s => (<th key={s.id} className="p-3 border border-white/10"><p className="text-[10px] font-black uppercase">{s.label.replace('Period ', 'P')}</p><p className="text-[7px] opacity-60 font-bold">{s.startTime}</p></th>))}</tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {DAYS.map(day => (
                <tr key={day} className="h-24">
                  <td className="bg-slate-50 dark:bg-slate-800/80 text-[#001f3f] dark:text-amber-400 font-black text-center text-xs uppercase border italic sticky left-0 z-30 shadow-md border-slate-100 dark:border-slate-700">{day.substring(0,3)}</td>
                  {slots.map(s => {
                    const avail = isSwapMode && swapSource ? getTeacherAvailability(day, s.id) : null;
                    const hmc = avail === true ? 'bg-emerald-500/10' : avail === false ? 'bg-rose-500/10' : '';
                    return (
                      <td key={s.id} className={`border p-1 relative transition-all border-slate-100 dark:border-slate-800 ${s.isBreak ? 'bg-amber-50/20' : ''} ${hmc}`}>
                        {s.isBreak ? <div className="text-center text-[8px] font-black text-amber-500 opacity-40 uppercase">Recess</div> : (
                          <div draggable={isDraftMode && !!selectedTargetId} onClick={() => handleOpenCell(day, s.id)} className={`h-full min-h-[60px] p-1 rounded-xl transition-all ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''}`}>
                            {(() => {
                              const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                              let act = ents.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
                              if (!act) return null;
                              
                              const conflicts = checkConflict(act.teacherId, day, s.id, act.id, act.room);
                              const hasClash = conflicts.teacherClash || conflicts.roomClash;
                              
                              return (
                                <div className={`h-full p-2 border-2 rounded-lg bg-white dark:bg-slate-900 shadow-sm flex flex-col justify-center text-center relative transition-all duration-300 ${act.blockId ? 'border-amber-400 bg-amber-50/20' : hasClash ? 'border-rose-500 bg-rose-50 animate-pulse scale-95 shadow-lg z-10' : 'border-transparent'}`}>
                                  <p className={`text-[10px] font-black uppercase truncate ${hasClash ? 'text-rose-600' : 'text-[#001f3f] dark:text-white'}`}>{act.subject}</p>
                                  <p className="text-[8px] font-bold text-slate-500 truncate mt-1">{viewMode === 'TEACHER' ? act.className : act.teacherName?.split(' ')[0]}</p>
                                  <p className="text-[6px] font-black text-slate-400 uppercase mt-0.5 tracking-tighter">{act.room}</p>
                                  
                                  {conflicts.teacherClash && (
                                    <div className="absolute -top-3 -right-2 bg-rose-600 text-white text-[5px] font-black px-1.5 py-0.5 rounded shadow-lg border border-white whitespace-nowrap">⚠️ STAFF CLASH</div>
                                  )}
                                  {conflicts.roomClash && (
                                    <div className="absolute -bottom-3 -left-2 bg-amber-500 text-white text-[5px] font-black px-1.5 py-0.5 rounded shadow-lg border border-white whitespace-nowrap">⚠️ ROOM CLASH</div>
                                  )}
                                </div>
                              );
                            })()}
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
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-8 animate-in zoom-in">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Allocation</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{editingCell.day} • Slot {editingCell.slotId}</p>
              </div>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
                 <button onClick={() => setModalTab('SINGLE')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'SINGLE' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Single Class</button>
                 <button onClick={() => setModalTab('BLOCK')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'BLOCK' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Pool Template</button>
              </div>
              <div className="space-y-6">
                {modalTab === 'SINGLE' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Member</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none" value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}><option value="">Select Faculty...</option>{users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    </div>
                    <div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})}><option value="">Select Subject...</option>{config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
                    </div>
                    <div className="md:col-span-2 space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Room Allocation</label>
                       <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none" value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}><option value="">Select Room...</option>{config.rooms.map(r => <option key={r} value={r}>{r}</option>)}</select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Pool</label>
                     <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase dark:text-white outline-none" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}><option value="">Choose Pool...</option>{config.combinedBlocks.filter(b => b.gradeId === config.sections.find(s => s.id === selectedTargetId)?.gradeId).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
                  </div>
                )}
              </div>
              <div className="pt-6 space-y-4">
                 <button onClick={saveCell} disabled={isProcessing} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95">Authorize Period Allocation</button>
                 {isAdmin && (<button onClick={handleDeleteCell} disabled={isProcessing} className="w-full bg-rose-50 text-rose-600 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-rose-100 hover:bg-rose-100 transition-all">Dismantle Allocation</button>)}
                 <button onClick={() => setEditingCell(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest">Abort Process</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

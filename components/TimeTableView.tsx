import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, SchoolSection } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { getWeekDates, getBahrainTime, formatBahrainDate } from '../utils/dateUtils.ts';

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
  const [completedPhases, setCompletedPhases] = useState<number[]>([]);

  // INSTITUTIONAL TEMPORAL CONTEXT - EXPANDED TO FULL WEEK
  const currentWeekDates = useMemo(() => getWeekDates(), []);
  const todayDate = useMemo(() => formatBahrainDate(), []);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(getBahrainTime()), []);

  // FEEDBACK STATE
  const [statusMessage, setStatusMessage] = useState<{text: string, type: 'info' | 'warning' | 'error' | 'success'} | null>(null);
  const [auditReport, setAuditReport] = useState<{title: string, count: number, issues: string[]} | null>(null);
  const [collisionCell, setCollisionCell] = useState<{day: string, slotId: number} | null>(null);

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

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
       if (clash.hasClash) { 
         setCollisionCell(target);
         setStatusMessage({text: `Movement Aborted: ${clash.details}`, type: 'error'}); 
         setTimeout(() => setCollisionCell(null), 2000);
         setIsProcessing(false); return; 
       }
    }
    if (activeDest) {
       const clash = checkConflict(activeDest.teacherId, source.day, source.slotId, activeDest.id, activeDest.room);
       if (clash.hasClash) { 
         setCollisionCell(source);
         setStatusMessage({text: `Movement Aborted: ${clash.details}`, type: 'error'}); 
         setTimeout(() => setCollisionCell(null), 2000);
         setIsProcessing(false); return; 
       }
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
    setStatusMessage({text: "Matrix Position Updated.", type: 'success'});
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

  const isLoopConflicted = useCallback((teacherId: string, room: string, day: string, slotId: number, sectId: string, batchEntries: TimeTableEntry[], targetGradeSections: SchoolSection[]) => {
    const tid = teacherId?.toLowerCase().trim();
    const rid = room?.toLowerCase().trim();
    if (batchEntries.some(e => e.day === day && e.slotId === slotId && e.sectionId === sectId)) return true;
    if (tid && batchEntries.some(e => e.day === day && e.slotId === slotId && e.teacherId?.toLowerCase().trim() === tid)) return true;
    if (rid && batchEntries.some(e => e.day === day && e.slotId === slotId && e.room?.toLowerCase().trim() === rid)) return true;
    const combined = [...timetable, ...timetableDraft].filter(t => !targetGradeSections.some(gs => gs.id === t.sectionId));
    if (tid) {
      const teacherClash = combined.find(t => t.teacherId?.toLowerCase().trim() === tid && t.day === day && t.slotId === slotId && !t.date);
      if (teacherClash) return true;
    }
    if (rid) {
      const roomClash = combined.find(t => t.room?.toLowerCase().trim() === rid && t.day === day && t.slotId === slotId && !t.date);
      if (roomClash) return true;
    }
    return false;
  }, [timetable, timetableDraft]);

  const executePhaseAction = async (phase: 1 | 2 | 3) => {
    if (!selectedTargetId || viewMode !== 'SECTION') {
       setStatusMessage({text: "Operational Error: Targeted Class Selection Required.", type: 'warning'});
       return;
    }
    const currentSect = config.sections.find(s => s.id === selectedTargetId);
    if (!currentSect) return;

    const targetGradeId = currentSect.gradeId;
    const gradeSections = config.sections.filter(s => s.gradeId === targetGradeId);
    const wingSlots = getSlotsForWing(currentSect.wingId).filter(s => !s.isBreak);
    const searchSpace: {day: string, slotId: number}[] = [];
    DAYS.forEach(day => wingSlots.forEach(slot => searchSpace.push({ day, slotId: slot.id })));
    const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

    setIsProcessing(true);
    setStatusMessage({text: `Phase ${phase}: Crunching constraints...`, type: 'info'});
    let newEntries: TimeTableEntry[] = [];
    let count = 0;
    let issues: string[] = [];

    if (phase === 1) {
      gradeSections.forEach(sect => {
        const teacher = users.find(u => u.classTeacherOf === sect.id);
        if (!teacher) return;
        const asgn = assignments.find(a => a.teacherId === teacher.id && a.gradeId === sect.gradeId);
        if (!asgn || !asgn.anchorSubject) {
          issues.push(`${sect.fullName}: No Anchor Subject defined in Load Intelligence.`);
          return;
        }
        const wing = config.wings.find(w => w.id === sect.wingId)!;
        const p1Slot = wingSlots.find(s => s.label.toLowerCase().replace(/\s+/g, '') === 'period1') || wingSlots[0];
        DAYS.forEach(day => {
          if (!isLoopConflicted(teacher.id, `ROOM ${sect.fullName}`, day, p1Slot.id, sect.id, [], gradeSections)) {
            newEntries.push({ id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day, slotId: p1Slot.id, subject: asgn.anchorSubject!.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: teacher.id, teacherName: teacher.name, room: `ROOM ${sect.fullName}` });
            count++;
          } else {
             issues.push(`${teacher.name} (${sect.fullName}): Anchor Collision at P1 on ${day}.`);
          }
        });
      });
    } else if (phase === 2) {
      const gradeBlocks = config.combinedBlocks.filter(b => b.gradeId === targetGradeId);
      for (const block of gradeBlocks) {
        let blockPlaced = 0;
        const shuffledSpace = shuffle(searchSpace);
        for (const spot of shuffledSpace) {
          if (blockPlaced >= block.weeklyPeriods) break;
          const canPlacePool = block.sectionIds.every((sid, idx) => {
            const alloc = block.allocations[idx % block.allocations.length];
            return !isLoopConflicted(alloc?.teacherId || '', alloc?.room || '', spot.day, spot.slotId, sid, newEntries, gradeSections);
          });
          if (canPlacePool) {
            block.sectionIds.forEach((sid, idx) => {
              const sect = config.sections.find(s => s.id === sid)!;
              const wing = config.wings.find(w => w.id === sect.wingId)!;
              const alloc = block.allocations[idx % block.allocations.length];
              newEntries.push({ id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: spot.day, slotId: spot.slotId, subject: alloc.subject, subjectCategory: SubjectCategory.CORE, teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || `ROOM ${sect.fullName}`, blockId: block.id, blockName: block.title });
            });
            blockPlaced++;
            count++;
          }
        }
        if (blockPlaced < block.weeklyPeriods) issues.push(`Pool "${block.title}": Placed ${blockPlaced}/${block.weeklyPeriods} periods. Grid saturated.`);
      }
    } else if (phase === 3) {
      const gradeAssignments = assignments.filter(a => a.gradeId === targetGradeId);
      for (const asgn of gradeAssignments) {
        const teacher = users.find(u => u.id === asgn.teacherId);
        if (!teacher) continue;
        const targetSects = asgn.targetSectionIds?.length ? gradeSections.filter(s => asgn.targetSectionIds!.includes(s.id)) : gradeSections;
        for (const sect of targetSects) {
          const wing = config.wings.find(w => w.id === sect.wingId)!;
          for (const load of asgn.loads) {
            let placed = 0;
            let periodsToPlace = load.periods;
            if (asgn.anchorSubject === load.subject && teacher.classTeacherOf === sect.id) periodsToPlace = Math.max(0, load.periods - 5);
            const targetRoom = load.room || `ROOM ${sect.fullName}`;
            const shuffledSpace = shuffle(searchSpace);
            for (const spot of shuffledSpace) {
              if (placed >= periodsToPlace) break;
              if (!isLoopConflicted(asgn.teacherId, targetRoom, spot.day, spot.slotId, sect.id, newEntries, gradeSections)) {
                newEntries.push({ id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: spot.day, slotId: spot.slotId, subject: load.subject, subjectCategory: SubjectCategory.CORE, teacherId: asgn.teacherId, teacherName: teacher.name, room: targetRoom });
                placed++;
                count++;
              }
            }
            if (placed < periodsToPlace) issues.push(`${teacher.name}: Could only place ${placed}/${periodsToPlace} periods of ${load.subject} in ${sect.fullName}.`);
          }
        }
      }
    }

    if (newEntries.length > 0) {
      setTimetableDraft(prev => [...prev, ...newEntries]);
      setCompletedPhases(prev => Array.from(new Set([...prev, phase])));
      setAuditReport({title: `Phase ${phase} Audit Complete`, count, issues});
    } else {
      setStatusMessage({text: "Phase Failure: Institutional constraints blocking all potential allocations.", type: 'error'});
    }
    setIsProcessing(false);
  };

  const purgePhase = (phase: number) => {
    if (!selectedTargetId) return;
    const currentSect = config.sections.find(s => s.id === selectedTargetId);
    if (!currentSect) return;
    const gradeSectIds = config.sections.filter(s => s.gradeId === currentSect.gradeId).map(s => s.id);
    triggerConfirm(`Purge logic for Phase ${phase}? This will remove specific automated entries from the current draft.`, () => {
      setTimetableDraft(prev => prev.filter(t => {
        if (!gradeSectIds.includes(t.sectionId)) return true;
        if (phase === 1) {
           const isP1 = slots.find(s => s.id === t.slotId)?.label.toLowerCase().replace(/\s+/g, '') === 'period1';
           const teacher = users.find(u => u.id === t.teacherId);
           return !(isP1 && teacher?.classTeacherOf === t.sectionId);
        }
        if (phase === 2) return !t.blockId;
        if (phase === 3) {
           const isP1 = slots.find(s => s.id === t.slotId)?.label.toLowerCase().replace(/\s+/g, '') === 'period1';
           const teacher = users.find(u => u.id === t.teacherId);
           const isAnchor = isP1 && teacher?.classTeacherOf === t.sectionId;
           return t.blockId || isAnchor;
        }
        return true;
      }));
      setCompletedPhases(prev => prev.filter(p => p !== phase));
      setStatusMessage({text: `Phase ${phase} purged from matrix.`, type: 'info'});
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
        setCompletedPhases([]);
        setIsProcessing(false);
        setStatusMessage({text: "Draft purge complete.", type: 'success'});
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
        setStatusMessage({text: "Matrix Published: Cloud Handshake Complete.", type: 'success'});
      } catch (err: any) { setStatusMessage({text: `Sync error: ${err.message}`, type: 'error'}); } finally { setIsProcessing(false); }
    });
  };

  return (
    <div className={`flex flex-col h-full space-y-4 animate-in fade-in duration-700 pb-20 relative ${isDraftMode ? 'bg-indigo-50/10 dark:bg-indigo-900/5 rounded-3xl ring-1 ring-indigo-500/10' : ''}`}>
      {/* MATRIX STATUS SENTINEL */}
      {statusMessage && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[1001] px-6 py-3 rounded-2xl shadow-2xl border-2 flex items-center gap-3 animate-in slide-in-from-top-4 ${
          statusMessage.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-600' : 
          statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' :
          statusMessage.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-600' :
          'bg-[#001f3f] border-amber-400/20 text-white'
        }`}>
          <div className={`w-2 h-2 rounded-full animate-pulse ${
            statusMessage.type === 'error' ? 'bg-rose-500' : 
            statusMessage.type === 'success' ? 'bg-emerald-500' : 
            statusMessage.type === 'warning' ? 'bg-amber-500' : 
            statusMessage.type === 'info' ? 'bg-amber-400' : 'bg-amber-400'
          }`}></div>
          <p className="text-[10px] font-black uppercase tracking-widest">{statusMessage.text}</p>
        </div>
      )}

      {/* PROCESSING OVERLAY */}
      {isProcessing && (
        <div className="absolute inset-0 z-[1002] bg-white/20 dark:bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center rounded-[3rem]">
           <div className="bg-[#001f3f] text-white px-8 py-6 rounded-[2rem] shadow-2xl border-2 border-amber-400/20 flex items-center gap-4 animate-in zoom-in">
              <div className="w-6 h-6 border-4 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-black uppercase tracking-[0.2em] italic">AI Matrix Engine Active</p>
           </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-center px-4 gap-4 py-2">
         <div className="space-y-0.5 text-center md:text-left">
            <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mt-1">Institutional Integrity Sentinel {isDraftMode && '• DRAFT'}</p>
         </div>
         
         <div className="flex flex-wrap gap-2 justify-center items-center">
            {isDraftMode && (
              <div className="flex items-center gap-1 bg-white/50 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm mr-2 group/sentinel">
                 <div className="flex items-center gap-1.5 px-2 relative">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Builder:</span>
                    <div className="absolute bottom-full left-0 mb-2 w-48 p-3 bg-[#001f3f] text-white rounded-xl text-[7px] font-bold uppercase tracking-widest hidden group-hover/sentinel:block z-[200] shadow-2xl border border-amber-400/20 leading-relaxed italic">
                       The Protocol Builder ensures a logical sequence. Anchors lock the schedule, Pools manage groups, and Loads fill the residuals.
                    </div>
                 </div>
                 
                 <div className="flex gap-1">
                    {[1, 2, 3].map(phase => {
                      const isDone = completedPhases.includes(phase);
                      const isNext = (phase === 1 && completedPhases.length === 0) || (phase === 2 && completedPhases.includes(1) && !completedPhases.includes(2)) || (phase === 3 && completedPhases.includes(2) && !completedPhases.includes(3));
                      const label = phase === 1 ? 'Anchors' : phase === 2 ? 'Pools' : 'Loads';
                      
                      return (
                        <div key={phase} className="flex items-center group/btn relative">
                           <button 
                             onClick={() => executePhaseAction(phase as 1|2|3)}
                             disabled={isProcessing || (!isNext && !isDone) || !selectedTargetId || viewMode !== 'SECTION'}
                             className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all flex items-center gap-1.5 border ${
                               isDone 
                                 ? 'bg-emerald-500 text-white border-emerald-600' 
                                 : isNext 
                                   ? 'bg-amber-500 text-white border-amber-600 animate-pulse shadow-amber-500/20 shadow-lg' 
                                   : 'bg-slate-100 text-slate-300 border-slate-200 cursor-help'
                             }`}
                           >
                              {isDone && <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"/></svg>}
                              {label}
                           </button>
                           {(!isNext && !isDone && selectedTargetId) && (
                             <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-rose-500 text-white rounded text-[6px] font-black uppercase hidden group-hover/btn:block z-[200] whitespace-nowrap shadow-lg">
                               Locked: Complete Phase {phase - 1} First
                             </div>
                           )}
                           {isDone && (
                             <button onClick={() => purgePhase(phase)} className="ml-0.5 p-1 text-rose-400 hover:text-rose-600 opacity-0 group-hover/btn:opacity-100 transition-opacity" title="Purge Phase Data">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                             </button>
                           )}
                        </div>
                      );
                    })}
                 </div>
              </div>
            )}

            {isDraftMode && (
              <button 
                onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} 
                className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-md border transition-all ${isSwapMode ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-white text-slate-400'}`}
              >
                {isSwapMode ? 'Swap Mode On' : 'Swap Mode'}
              </button>
            )}
            
            {isDraftMode && viewMode === 'SECTION' && selectedTargetId && (
                <button onClick={handleClearSectionDraft} disabled={isProcessing} className="bg-rose-50 text-rose-600 border border-rose-100 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase shadow-sm hover:bg-rose-100">Purge Draft</button>
            )}

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
               <button onClick={() => { setViewMode('SECTION'); setSelectedTargetId(''); setCompletedPhases([]); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
               <button onClick={() => { setViewMode('TEACHER'); setSelectedTargetId(''); setCompletedPhases([]); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
               {isManagement && <button onClick={() => { setViewMode('ROOM'); setSelectedTargetId(''); setCompletedPhases([]); }} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase flex-1 ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>}
             </div>
           )}
           <select 
              className={`flex-1 px-4 py-2 rounded-lg border text-[9px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white border-slate-100 shadow-sm`} 
              value={selectedTargetId} 
              onChange={e => {
                const val = e.target.value;
                setSelectedTargetId(val);
                setCompletedPhases([]);
                if (viewMode === 'SECTION' && val) {
                  const sect = config.sections.find(s => s.id === val);
                  if (sect) setActiveWingId(sect.wingId);
                }
              }}
            >
              <option value="">Matrix Target Discovery...</option>
              {filteredEntities.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} {(e as any).wingName ? `(${ (e as any).wingName })` : ''}
                </option>
              ))}
            </select>
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full border-separate border-spacing-0 table-fixed min-w-[900px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr><th className="w-16 p-3 text-[9px] font-black uppercase italic border-r border-white/10 sticky left-0 z-[60] bg-[#001f3f]">Day</th>{slots.map(s => (<th key={s.id} className="p-1 border-r border-white/10"><p className="text-[9px] font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p><p className="text-[7px] opacity-60 font-bold">{s.startTime}</p></th>))}</tr>
            </thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day} className="h-16">
                  <td className="bg-slate-50 dark:bg-slate-800/80 text-[#001f3f] dark:text-amber-400 font-black text-center text-[10px] uppercase border italic sticky left-0 z-30 shadow-sm">{day.substring(0,3)}</td>
                  {slots.map(s => {
                    const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                    const act = ents.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
                    
                    // WEEKLY PROXY INTERCEPTOR: Checks substitutions for the entire Sunday-Thursday cycle
                    const targetDateForDay = currentWeekDates[day];
                    const liveProxy = substitutions.find(sub => 
                      sub.date === targetDateForDay && 
                      sub.slotId === s.id && 
                      !sub.isArchived && 
                      (viewMode === 'SECTION' ? sub.sectionId === selectedTargetId : 
                       viewMode === 'TEACHER' ? sub.substituteTeacherId === selectedTargetId : 
                       sub.room === selectedTargetId)
                    );

                    const isDragOver = dragOverCell?.day === day && dragOverCell?.slotId === s.id;
                    const isSwapSrc = swapSource?.day === day && swapSource?.slotId === s.id;
                    const isCollision = collisionCell?.day === day && collisionCell?.slotId === s.id;
                    
                    return (
                      <td 
                        key={s.id} 
                        onDragOver={(e) => onDragOver(e, day, s.id)}
                        onDrop={(e) => onDrop(e, day, s.id)}
                        className={`border p-1 relative border-slate-100 dark:border-slate-800 transition-all ${isDragOver ? 'bg-amber-50 ring-2 ring-amber-400 ring-inset ring-dashed' : s.isBreak ? 'bg-slate-50/50' : ''}`}
                      >
                        {isCollision && <div className="absolute inset-0 bg-rose-500/20 animate-pulse z-20"></div>}
                        {s.isBreak ? <div className="text-center text-[7px] font-black text-slate-300 uppercase italic">Recess</div> : (
                          <div 
                            onClick={() => handleOpenCell(day, s.id)} 
                            draggable={isDraftMode && !!selectedTargetId && !!act}
                            onDragStart={(e) => onDragStart(e, day, s.id)}
                            className={`h-full min-h-[48px] p-0.5 rounded-xl transition-all ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 group/cell' : ''} ${isSwapSrc ? 'ring-4 ring-amber-500 ring-offset-2' : ''}`}
                          >
                            {/* PRIORITY 1: WEEKLY PROXY SENTINEL (Only when not in Draft Mode) */}
                            {liveProxy && !isDraftMode ? (
                               <div className="h-full p-2 border-2 border-emerald-400 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 shadow-md flex flex-col justify-center text-center relative animate-in fade-in zoom-in">
                                  <p className="text-[9px] font-black uppercase truncate text-emerald-700 dark:text-emerald-400 leading-tight">{liveProxy.subject}</p>
                                  <p className="text-[7px] font-bold text-emerald-600 dark:text-emerald-500 truncate mt-1 leading-none">
                                    {viewMode === 'TEACHER' ? liveProxy.className : `Proxy: ${liveProxy.substituteTeacherName.split(' ')[0]}`}
                                  </p>
                                  {/* Badge specifically notes if it is 'Today' or another day of the week */}
                                  <span className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 ${liveProxy.date === todayDate ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-600/60'} text-white text-[5px] font-black rounded-full uppercase shadow-sm`}>
                                    {liveProxy.date === todayDate ? 'Live Proxy' : 'Substitution'}
                                  </span>
                               </div>
                            ) : act ? (
                                <div className={`h-full p-2 border rounded-lg bg-white dark:bg-slate-900 shadow-sm flex flex-col justify-center text-center relative ${act.blockId ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-100 dark:border-slate-800'} ${isDraftMode && selectedTargetId ? 'cursor-grab active:cursor-grabbing group-hover/cell:shadow-lg' : ''}`}>
                                  <p className="text-[9px] font-black uppercase truncate text-[#001f3f] dark:text-white leading-tight">{act.subject}</p>
                                  <p className="text-[7px] font-bold text-slate-400 truncate mt-1 leading-none">{viewMode === 'TEACHER' ? act.className : act.teacherName?.split(' ')[0]}</p>
                                  {act.blockId && <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-amber-400 text-white text-[5px] font-black rounded-full uppercase shadow-sm">Pool</span>}
                                </div>
                            ) : null}
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

      {/* DEPLOYMENT AUDIT REPORT MODAL */}
      {auditReport && (
        <div className="fixed inset-0 z-[1003] flex items-center justify-center p-4 bg-[#001f3f]/90 backdrop-blur-md animate-in fade-in">
           <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 animate-in zoom-in border border-amber-400/30">
              <div className="flex justify-between items-start">
                 <div className="space-y-1">
                    <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{auditReport.title}</h4>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Deployed: {auditReport.count} Successful Allocations</p>
                 </div>
                 <button onClick={() => setAuditReport(null)} className="p-2 text-slate-400 hover:text-rose-500 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>
              
              <div className="space-y-4">
                 <div className="flex items-center gap-3">
                    <div className="h-[1px] flex-1 bg-slate-100 dark:bg-slate-800"></div>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.4em]">Audit Logs & Constraints</span>
                    <div className="h-[1px] flex-1 bg-slate-100 dark:bg-slate-800"></div>
                 </div>
                 
                 <div className="max-h-64 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                    {auditReport.issues.length > 0 ? auditReport.issues.map((iss, i) => (
                      <div key={i} className="flex gap-3 p-4 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30 rounded-2xl animate-in slide-in-from-left duration-300">
                         <svg className="w-4 h-4 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                         <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase leading-relaxed">{iss}</p>
                      </div>
                    )) : (
                      <div className="flex flex-col items-center justify-center py-10 opacity-30">
                         <svg className="w-12 h-12 text-emerald-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                         <p className="text-[10px] font-black uppercase tracking-widest">No Constraints Detected</p>
                      </div>
                    )}
                 </div>
              </div>

              <div className="pt-4">
                 <button onClick={() => setAuditReport(null)} className="w-full py-4 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-slate-950 transition-all">Close Report</button>
              </div>
           </div>
        </div>
      )}

      {editingCell && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#001f3f]/90 backdrop-blur-md animate-in fade-in">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2rem] p-6 shadow-2xl space-y-6 animate-in zoom-in border border-amber-400/20">
              <div className="text-center">
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Allocation</h4>
                 <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{editingCell.day} • Slot {editingCell.slotId}</p>
              </div>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl shadow-inner">
                 <button onClick={() => setModalTab('SINGLE')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${modalTab === 'SINGLE' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Single</button>
                 <button onClick={() => setModalTab('BLOCK')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${modalTab === 'BLOCK' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Pool Template</button>
              </div>
              {modalTab === 'SINGLE' && currentModalClash.hasClash && (
                <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-100 flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
                  <div className="w-10 h-10 bg-rose-500 text-white rounded-xl flex items-center justify-center shrink-0 shadow-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest leading-none">Matrix Collision Detected</p>
                    <p className="text-xs font-bold text-rose-500 leading-tight">{currentModalClash.details}</p>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {modalTab === 'SINGLE' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel</label>
                      <select className={`w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 transition-all ${currentModalClash.type === 'TEACHER' ? 'border-rose-400 ring-4 ring-rose-500/10' : 'border-transparent shadow-sm'}`} value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}><option value="">Select Faculty...</option>{users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Matter</label>
                      <select className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 border-transparent shadow-sm" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})}><option value="">Select Subject...</option>{config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Temporal Venue (Room)</label>
                      <select className={`w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white border-2 transition-all ${currentModalClash.type === 'ROOM' ? 'border-rose-400 ring-4 ring-rose-500/10' : 'border-transparent shadow-sm'}`} value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}><option value="">Select Room...</option>{config.rooms.map(r => <option key={r} value={r}>{r}</option>)}</select>
                    </div>
                  </div>
                ) : (
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Active Pool Blueprint</label>
                      <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-[10px] uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 shadow-sm" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}><option value="">Choose Pool...</option>{config.combinedBlocks.filter(b => b.gradeId === config.sections.find(s => s.id === selectedTargetId)?.gradeId).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
                   </div>
                )}
              </div>
              <div className="pt-4 space-y-4">
                <button onClick={async () => {
                      const sect = config.sections.find(s => s.id === selectedTargetId)!; const t = users.find(u => u.id === cellForm.teacherId); const wing = config.wings.find(w => w.id === sect.wingId)!;
                      if (modalTab === 'SINGLE') { const clash = checkConflict(cellForm.teacherId, editingCell.day, editingCell.slotId, null, cellForm.room); if (clash.hasClash) { setStatusMessage({text: `Institutional Blockage: ${clash.details}`, type: 'error'}); return; } }
                      const e: TimeTableEntry = { id: generateUUID(), section: wing.sectionType, wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: t?.name || 'Unknown', room: cellForm.room };
                      // Fix: Correct camelCase property access on TimeTableEntry object 'e'
                      if (isCloudActive && !isSandbox) { await supabase.from('timetable_drafts').delete().match({ section_id: e.sectionId, day: e.day, slot_id: e.slotId }); if (e.teacherId) await supabase.from('timetable_drafts').insert({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, is_substitution: false }); }
                      setTimetableDraft(prev => [...prev.filter(t => !(t.sectionId === e.sectionId && t.day === e.day && t.slotId === e.slotId)), ...(e.teacherId ? [e] : [])]); setEditingCell(null);
                      setStatusMessage({text: "Matrix Point Secured.", type: 'success'});
                  }} className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl transition-all ${currentModalClash.hasClash ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950 active:scale-95'}`}>{currentModalClash.hasClash ? 'Entry Blocked' : 'Authorize Entry'}</button>
                <button onClick={() => setEditingCell(null)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest">Discard Changes</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;
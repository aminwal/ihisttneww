import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface TimeTableViewProps {
  user: User;
  users: User[];
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  substitutions: SubstitutionRecord[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  onManualSync: () => void;
  triggerConfirm: (message: string, onConfirm: () => void) => void;
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ user, users, timetable, setTimetable, substitutions, config, assignments, setAssignments, onManualSync, triggerConfirm }) => {
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.INCHARGE_ALL;
  const isCloudActive = IS_CLOUD_ENABLED;
  
  const [activeSection, setActiveSection] = useState<SectionType>('PRIMARY');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [viewMode, setViewMode] = useState<'CLASS' | 'TEACHER' | 'ROOM'>(() => {
    if (user.role.startsWith('TEACHER_')) return 'TEACHER';
    return 'CLASS';
  });
  const [isDesigning, setIsDesigning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewDate, setViewDate] = useState<string>(() => new Date().toISOString().split('T')[0]); 
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot, targetId?: string} | null>(null);
  const [entryType, setEntryType] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '', room: '', blockId: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  const [draggingEntry, setDraggingEntry] = useState<TimeTableEntry | null>(null);
  const [dragOverPos, setDragOverPos] = useState<{day: string, slotId: number} | null>(null);

  // --- ACCESS CONTROL LOGIC ---
  const filteredClasses = useMemo(() => {
    if (isAdmin) return config.classes;
    if (user.role === UserRole.INCHARGE_PRIMARY) return config.classes.filter(c => c.section === 'PRIMARY');
    if (user.role === UserRole.INCHARGE_SECONDARY) return config.classes.filter(c => c.section !== 'PRIMARY');
    if (user.role.startsWith('TEACHER_')) return config.classes.filter(c => c.name === user.classTeacherOf);
    return [];
  }, [config.classes, user, isAdmin]);

  // FIX: Admin should be able to view the timetable of ALL staff members
  const availableTeachers = useMemo(() => {
    if (isAdmin) return users.filter(u => !u.isResigned).sort((a, b) => a.name.localeCompare(b.name));
    if (user.role === UserRole.INCHARGE_PRIMARY) return users.filter(u => !u.isResigned && (u.role.includes('PRIMARY') || u.secondaryRoles?.some(r => r.includes('PRIMARY'))));
    if (user.role === UserRole.INCHARGE_SECONDARY) return users.filter(u => !u.isResigned && (u.role.includes('SECONDARY') || u.secondaryRoles?.some(r => r.includes('SECONDARY'))));
    return users.filter(u => u.id === user.id);
  }, [users, user, isAdmin]);

  const canViewClassTab = isAdmin || user.role.startsWith('INCHARGE_') || !!user.classTeacherOf;

  useEffect(() => {
    if (viewMode === 'TEACHER' && !selectedClass) {
      setSelectedClass(user.id);
    } else if (viewMode === 'CLASS' && !selectedClass && filteredClasses.length > 0) {
      if (user.role.startsWith('TEACHER_')) {
        setSelectedClass(user.classTeacherOf || '');
      }
    }
  }, [viewMode, user, filteredClasses, selectedClass]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    for (const entry of timetable) {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) { registry.set(key, [entry]); } 
      else { registry.get(key)!.push(entry); }
    }
    return registry;
  }, [timetable]);

  const classTeacher = useMemo(() => {
    if (viewMode !== 'CLASS' || !selectedClass) return null;
    return users.find(u => u.classTeacherOf === selectedClass);
  }, [viewMode, selectedClass, users]);

  const selectedTeacherAssignments = useMemo(() => {
    if (viewMode !== 'TEACHER' || !selectedClass) return [];
    return assignments.filter(a => a.teacherId === selectedClass);
  }, [viewMode, selectedClass, assignments]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getSlotsForSection = useCallback((section: SectionType) => {
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section === 'SECONDARY_GIRLS' || section === 'SENIOR_SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, []);

  const slots = useMemo(() => {
    let targetSection = activeSection;
    let isPrimaryContext = false;
    if (selectedClass) {
      if (viewMode === 'CLASS') {
        const classObj = config.classes.find(c => c.name === selectedClass);
        if (classObj) targetSection = classObj.section;
      } else if (viewMode === 'TEACHER') {
        const teacher = users.find(u => u.id === selectedClass);
        if (teacher) {
          if (teacher.role.includes('PRIMARY')) { targetSection = 'PRIMARY'; isPrimaryContext = true; } 
          else { targetSection = 'SECONDARY_BOYS'; }
        }
      } else if (viewMode === 'ROOM') {
        targetSection = 'SECONDARY_BOYS';
      }
    }
    const allSlots = getSlotsForSection(targetSection);
    if (((viewMode === 'TEACHER' && !isPrimaryContext) || viewMode === 'ROOM')) {
      return allSlots.filter(s => !s.isBreak);
    }
    return allSlots;
  }, [activeSection, selectedClass, config.classes, viewMode, users, getSlotsForSection]);

  const openEntryModal = useCallback((day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
    setEditContext({ day, slot, targetId: entry?.id });
    if (entry) {
      if (entry.blockId) {
        setEntryType('GROUP');
        setManualData({ teacherId: '', subject: '', className: entry.className, room: entry.room || '', blockId: entry.blockId });
      } else {
        setEntryType('INDIVIDUAL');
        setManualData({ teacherId: entry.teacherId, subject: entry.subject, className: entry.className, room: entry.room || '', blockId: '' });
      }
    } else {
      setEntryType('INDIVIDUAL');
      setManualData({
        teacherId: viewMode === 'TEACHER' ? selectedClass : '',
        subject: '',
        className: viewMode === 'CLASS' ? selectedClass : '',
        room: viewMode === 'ROOM' ? selectedClass : '',
        blockId: ''
      });
    }
    setShowEditModal(true);
  }, [viewMode, selectedClass]);

  const handleDragStart = useCallback((e: React.DragEvent, entry: TimeTableEntry) => {
    if (!isDesigning) return;
    setDraggingEntry(entry);
    e.dataTransfer.effectAllowed = "move";
  }, [isDesigning]);

  const handleDragOver = useCallback((e: React.DragEvent, day: string, slotId: number) => {
    if (!isDesigning || !draggingEntry) return;
    e.preventDefault();
    setDragOverPos({ day, slotId });
  }, [isDesigning, draggingEntry]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetDay: string, targetSlotId: number) => {
    if (!isDesigning || !draggingEntry) return;
    e.preventDefault();
    const sourceEntry = draggingEntry;
    setDraggingEntry(null);
    setDragOverPos(null);
    if (sourceEntry.day === targetDay && sourceEntry.slotId === targetSlotId) return;
    setIsProcessing(true);
    try {
      if (sourceEntry.blockId) {
        const block = config.combinedBlocks.find(b => b.id === sourceEntry.blockId);
        if (!block) throw new Error("Registry Error: Source block not found.");
        const affectedEntries = timetable.filter(t => t.blockId === sourceEntry.blockId && t.day === sourceEntry.day && t.slotId === sourceEntry.slotId && (t.date || null) === (sourceEntry.date || null));
        const conflicts: string[] = [];
        for (const sectionName of block.sectionNames) {
          const busy = timetable.some(t => t.className === sectionName && t.day === targetDay && t.slotId === targetSlotId && (t.date || null) === (sourceEntry.date || null) && !affectedEntries.some(ae => ae.id === t.id));
          if (busy) conflicts.push(sectionName);
        }
        if (conflicts.length > 0) {
          setStatus({ type: 'error', message: `Block Conflict: ${conflicts.join(', ')} occupied in target slot.` });
          setIsProcessing(false);
          return;
        }
        const newEntries = affectedEntries.map(old => ({ ...old, id: `block-entry-${block.id}-${old.className}-${targetDay}-${targetSlotId}`, day: targetDay, slotId: targetSlotId }));
        if (isCloudActive) {
          await supabase.from('timetable_entries').delete().in('id', affectedEntries.map(ae => ae.id));
          // Corrected property naming from e.subject_category, e.teacher_id, e.teacher_name to camelCase to match TimeTableEntry type
          const cloudPayload = newEntries.map(e => ({ id: e.id, section: e.section, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room || null, date: e.date || null, is_substitution: !!e.isSubstitution, block_id: e.blockId }));
          await supabase.from('timetable_entries').upsert(cloudPayload);
        }
        setTimetable(prev => [...prev.filter(t => !affectedEntries.some(ae => ae.id === t.id)), ...newEntries]);
        setStatus({ type: 'success', message: `Parallel Block shifted to ${targetDay} P${targetSlotId}` });
      } else {
        const isTeacherBusy = timetable.some(t => t.teacherId === sourceEntry.teacherId && t.day === targetDay && t.slotId === targetSlotId && (t.date || null) === (sourceEntry.date || null) && t.id !== sourceEntry.id);
        if (isTeacherBusy) {
           const teacherName = sourceEntry.teacherName.split(' ')[0];
           setStatus({ type: 'error', message: `Conflict: ${teacherName} already assigned at ${targetDay} P${targetSlotId}` });
           setIsProcessing(false);
           return;
        }
        const newEntry = { ...sourceEntry, day: targetDay, slotId: targetSlotId, id: (sourceEntry.date ? `sub-${sourceEntry.className}-${targetDay}-${targetSlotId}-${Date.now()}` : `base-${sourceEntry.className}-${targetDay}-${targetSlotId}`) };
        if (isCloudActive) {
          await supabase.from('timetable_entries').delete().eq('id', sourceEntry.id);
          await supabase.from('timetable_entries').upsert({ id: newEntry.id, section: newEntry.section, class_name: newEntry.className, day: newEntry.day, slot_id: newEntry.slotId, subject: newEntry.subject, subject_category: newEntry.subjectCategory, teacher_id: String(newEntry.teacherId), teacher_name: newEntry.teacherName, room: newEntry.room || null, date: newEntry.date || null, is_substitution: !!newEntry.isSubstitution });
        }
        setTimetable(prev => [...prev.filter(t => t.id !== sourceEntry.id), newEntry]);
        setStatus({ type: 'success', message: `Shifted ${sourceEntry.subject} to ${targetDay} P${targetSlotId}` });
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: "Operational Handshake Failed." });
    } finally {
      setIsProcessing(false);
    }
  }, [isDesigning, draggingEntry, config.combinedBlocks, timetable, isCloudActive, setTimetable]);

  const handleSaveEntry = async () => {
    if (!editContext) return;
    if (entryType === 'GROUP') {
      const block = config.combinedBlocks.find(b => b.id === manualData.blockId);
      if (!block) {
        setStatus({ type: 'error', message: 'Registry Error: Invalid Group Period selected.' });
        return;
      }
      setIsProcessing(true);
      const newEntries: TimeTableEntry[] = [];
      const cloudEntries: any[] = [];
      const conflictSections: string[] = [];
      for (const sectionName of block.sectionNames) {
        const busy = timetable.some(t => t.className === sectionName && t.day === editContext.day && t.slotId === editContext.slot.id && (t.date || null) === (viewDate || null) && t.id !== editContext.targetId);
        if (busy) { conflictSections.push(sectionName); continue; }
        const classObj = config.classes.find(c => c.name === sectionName);
        if (!classObj) continue;
        const entry: TimeTableEntry = { id: `block-entry-${block.id}-${sectionName}-${editContext.day}-${editContext.slot.id}`, section: classObj.section, className: sectionName, day: editContext.day, slotId: editContext.slot.id, subject: block.name, subjectCategory: SubjectCategory.CORE, teacherId: 'BLOCK_RESOURCE', teacherName: 'Group Period', room: block.allocations.map(a => a.room).filter(Boolean).join(', '), blockId: block.id, blockName: block.name, date: viewDate || undefined };
        newEntries.push(entry);
        if (isCloudActive) { cloudEntries.push({ id: entry.id, section: entry.section, class_name: entry.className, day: entry.day, slot_id: entry.slotId, subject: entry.subject, subject_category: entry.subjectCategory, teacher_id: entry.teacherId, teacher_name: entry.teacherName, room: entry.room || null, date: entry.date || null, is_substitution: !!entry.isSubstitution, block_id: entry.blockId }); }
      }
      if (conflictSections.length > 0) {
        setStatus({ type: 'error', message: `Conflict detected in: ${conflictSections.join(', ')}` });
        setIsProcessing(false);
        return;
      }
      if (isCloudActive && cloudEntries.length > 0) {
        const { error } = await supabase.from('timetable_entries').upsert(cloudEntries, { onConflict: 'id' });
        if (error) { setStatus({ type: 'error', message: `Cloud Sync Error: ${error.message}` }); setIsProcessing(false); return; }
      }
      setTimetable(prev => { const idsToRemove = new Set(newEntries.map(e => e.id)); return [...prev.filter(t => !idsToRemove.has(t.id)), ...newEntries]; });
      setShowEditModal(false);
      setStatus({ type: 'success', message: `Group Period Authorized Successfully.` });
      setIsProcessing(false);
      return;
    }
    if (!manualData.subject || !manualData.teacherId || !manualData.className) return;
    const teacher = users.find(u => u.id === manualData.teacherId);
    const classObj = config.classes.find(c => c.name === manualData.className);
    const subject = config.subjects.find(s => s.name === manualData.subject);
    if (!teacher || !classObj || !subject) return;
    const entryId = editContext.targetId || (viewDate ? `sub-${manualData.className}-${editContext.day}-${editContext.slot.id}-${Date.now()}` : `base-${manualData.className}-${editContext.day}-${editContext.slot.id}`);
    const newEntry: TimeTableEntry = { id: entryId, section: classObj.section, className: manualData.className, day: editContext.day, slotId: editContext.slot.id, subject: manualData.subject, subjectCategory: subject.category, teacherId: teacher.id, teacherName: teacher.name, room: manualData.room, date: viewDate || undefined, isSubstitution: !!viewDate };
    setIsProcessing(true);
    if (isCloudActive) {
      const payload = { id: String(newEntry.id), section: newEntry.section, class_name: newEntry.className, day: newEntry.day, slot_id: newEntry.slotId, subject: newEntry.subject, subject_category: newEntry.subjectCategory, teacher_id: String(newEntry.teacherId), teacher_name: newEntry.teacherName, room: newEntry.room || null, date: newEntry.date || null, is_substitution: !!newEntry.isSubstitution };
      const { error } = await supabase.from('timetable_entries').upsert(payload, { onConflict: 'id' });
      if (error) { setStatus({ type: 'error', message: `Cloud Handshake Failed: ${error.message}` }); setIsProcessing(false); return; }
    }
    setTimetable(prev => [...prev.filter(t => t.id !== entryId), newEntry]);
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Individual Entry Authorized.' });
    setIsProcessing(false);
  };

  const handleDecommissionEntry = async () => {
    if (!editContext) return;
    const dayRegistry = cellRegistry.get(`${editContext.day}-${editContext.slot.id}`) || [];
    const target = dayRegistry.find(t => (viewMode === 'CLASS' ? t.className === selectedClass : viewMode === 'TEACHER' ? (t.teacherId === selectedClass || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === selectedClass))) : t.room === selectedClass) && (t.date || null) === (viewDate || null));
    if (!target) { setShowEditModal(false); return; }
    setIsProcessing(true);
    try {
      const idsToDelete = target.blockId ? timetable.filter(t => t.blockId === target.blockId && t.day === target.day && t.slotId === target.slotId && (t.date || null) === (target.date || null)).map(t => t.id) : [target.id];
      if (isCloudActive) { const { error } = await supabase.from('timetable_entries').delete().in('id', idsToDelete); if (error) throw error; }
      setTimetable(prev => prev.filter(t => !idsToDelete.includes(t.id)));
      setShowEditModal(false);
      setStatus({ type: 'success', message: 'Registry Entry Decommissioned.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: `Decommission Failed.` });
    } finally {
      setIsProcessing(false);
    }
  };

  const renderGridCell = useCallback((day: string, slot: TimeSlot, targetId: string, currentViewMode: 'CLASS' | 'TEACHER' | 'ROOM') => {
    if (slot.isBreak || !targetId) return null;
    const key = `${day}-${slot.id}`;
    const dayEntries = cellRegistry.get(key) || [];
    const candidates = dayEntries.filter(t => {
      if (currentViewMode === 'CLASS') return t.className === targetId;
      if (currentViewMode === 'TEACHER') {
        if (t.teacherId === targetId) return true;
        if (t.blockId) {
          const block = config.combinedBlocks.find(b => b.id === t.blockId);
          return block?.allocations.some(a => a.teacherId === targetId);
        }
        return false;
      }
      if (currentViewMode === 'ROOM') {
        if (t.room === targetId) return true;
        if (t.blockId) {
          const block = config.combinedBlocks.find(b => b.id === t.blockId);
          return block?.allocations.some(a => a.room === targetId);
        }
        return false;
      }
      return false;
    });
    let activeEntry = candidates.find(t => t.date === viewDate && viewDate !== '');
    if (!activeEntry) activeEntry = candidates.find(t => !t.date);
    if (!activeEntry) {
      const isTargetCell = dragOverPos?.day === day && dragOverPos?.slotId === slot.id;
      return (
        <div onDragOver={(e) => handleDragOver(e, day, slot.id)} onDrop={(e) => handleDrop(e, day, slot.id)} onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800 rounded-sm flex items-center justify-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''} ${isTargetCell ? 'bg-sky-50/50 border-sky-400 ring-2 ring-sky-300 ring-inset' : ''}`}>
          {isDesigning && <span className="text-slate-300 text-lg">+</span>}
        </div>
      );
    }
    const isSub = !!activeEntry.isSubstitution;
    const isBlock = !!activeEntry.blockId;
    let displaySubject = activeEntry.subject;
    let displayMeta = activeEntry.teacherName.split(' ')[0];
    let displaySubMeta = activeEntry.className;
    let displayRoom = activeEntry.room;
    if (currentViewMode === 'TEACHER') {
      displayMeta = activeEntry.className;
      if (isBlock) {
        const block = config.combinedBlocks.find(b => b.id === activeEntry.blockId);
        const allocation = block?.allocations.find(a => a.teacherId === targetId);
        if (allocation) { displaySubject = allocation.subject; displayRoom = allocation.room || activeEntry.room; }
      }
    } else if (currentViewMode === 'ROOM') {
      displayMeta = activeEntry.className;
      if (isBlock) {
        const block = config.combinedBlocks.find(b => b.id === activeEntry.blockId);
        const allocation = block?.allocations.find(a => a.room === targetId);
        if (allocation) {
          displaySubject = allocation.subject;
          const teacher = users.find(u => u.id === allocation.teacherId);
          displaySubMeta = teacher ? teacher.name.split(' ')[0] : 'Faculty';
        } else { displaySubMeta = activeEntry.teacherName.split(' ')[0]; }
      } else { displaySubMeta = activeEntry.teacherName.split(' ')[0]; }
    }
    const isTargetCell = dragOverPos?.day === day && dragOverPos?.slotId === slot.id;
    return (
      <div draggable={isDesigning} onDragStart={(e) => handleDragStart(e, activeEntry!)} onDragOver={(e) => handleDragOver(e, day, slot.id)} onDrop={(e) => handleDrop(e, day, slot.id)} onClick={() => isDesigning && openEntryModal(day, slot, activeEntry)} className={`h-full p-2 border-2 rounded-lg flex flex-col justify-center text-center transition-all w-full relative group shadow-sm ${isBlock ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-400' : isSub ? 'bg-amber-50 dark:bg-amber-900/40 border-dashed border-amber-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'} ${isDesigning ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400' : ''} ${isTargetCell ? 'ring-4 ring-sky-400 scale-[1.05] z-50 shadow-2xl' : ''}`}>
        {isSub && <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] px-1.5 py-0.5 font-black rounded-bl-lg shadow-sm">SUB</div>}
        {isBlock && <div className="absolute top-0 left-0 bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 font-black rounded-br-lg shadow-sm">GRP</div>}
        <p className={`text-[12px] font-black uppercase leading-tight tracking-tight ${isBlock ? 'text-indigo-700' : isSub ? 'text-amber-700' : 'text-sky-700'}`}>{displaySubject}</p>
        <p className={`text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate mt-1`}>{displayMeta}</p>
        <p className={`text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5 italic`}>{displaySubMeta}</p>
        {displayRoom && currentViewMode !== 'ROOM' && <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mt-1">Rm: {displayRoom}</p>}
      </div>
    );
  }, [cellRegistry, config.combinedBlocks, users, viewDate, dragOverPos, isDesigning, handleDragStart, handleDragOver, handleDrop, openEntryModal]);

  const handleAutoGenerateGrade = async () => {
    if (viewMode !== 'CLASS' || !selectedClass) { setStatus({ type: 'error', message: 'Target selection required for Grade Matrix optimization.' }); return; }
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 800));
    const sourceClass = config.classes.find(c => c.name === selectedClass);
    if (!sourceClass) { setIsProcessing(false); return; }
    const grade = sourceClass.name.match(/[IVX]+/)?.[0] ? `Grade ${sourceClass.name.match(/[IVX]+/)?.[0]}` : sourceClass.name;
    const siblingClasses = config.classes.filter(c => (c.name.match(/[IVX]+/)?.[0] ? `Grade ${c.name.match(/[IVX]+/)?.[0]}` : c.name) === grade);
    const gradeAssignments = assignments.filter(a => a.grade === grade);
    if (gradeAssignments.length === 0) { setStatus({ type: 'warning', message: `Optimization Halted: No faculty workload found for ${grade}.` }); setIsProcessing(false); return; }
    const siblingNames = siblingClasses.map(c => c.name);
    const isSeniorSecondary = siblingClasses.some(c => c.section.includes('SENIOR_SECONDARY'));
    const PARALLEL_SUBJECTS = ['MATHEMATICS', 'IP', 'MARKETING', 'COMPUTER SCIENCE', 'BIOLOGY', 'CS'];
    if (isCloudActive) { await supabase.from('timetable_entries').delete().in('class_name', siblingNames).is('date', null); }
    const siblingNamesSet = new Set(siblingNames);
    let workingTimetable = timetable.filter(t => !siblingNamesSet.has(t.className) || !!t.date || !!t.blockId);
    const newCloudEntries: any[] = [];
    const perClassPool: Record<string, { subject: string, teacherId: string, teacherName: string, category: SubjectCategory, room?: string, weeklyLoad: number }[]> = {};
    siblingClasses.forEach(c => perClassPool[c.name] = []);
    gradeAssignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      if (!teacher) return;
      const applicableClasses = (asgn.targetSections && asgn.targetSections.length > 0) ? siblingClasses.filter(c => asgn.targetSections?.includes(c.name)) : siblingClasses;
      if (applicableClasses.length === 0) return;
      asgn.loads.forEach(load => {
        const sub = config.subjects.find(s => s.name === load.subject);
        if (!sub) return;
        const totalPeriods = Number(load.periods) || 0;
        const basePerClass = Math.floor(totalPeriods / applicableClasses.length);
        const remainder = totalPeriods % applicableClasses.length;
        applicableClasses.forEach((cls, idx) => {
          const count = basePerClass + (idx < remainder ? 1 : 0);
          for (let i = 0; i < count; i++) { perClassPool[cls.name].push({ subject: load.subject, teacherId: teacher.id, teacherName: teacher.name, category: sub.category, room: load.room, weeklyLoad: count }); }
        });
      });
    });
    Object.keys(perClassPool).forEach(cls => { perClassPool[cls].sort((a, b) => b.weeklyLoad - a.weeklyLoad); });
    let totalAdded = 0;
    for (const day of DAYS) {
      const sectionSlots = getSlotsForSection(siblingClasses[0].section).filter(s => !s.isBreak);
      for (const slot of sectionSlots) {
        const hasManualBlock = siblingClasses.some(cls => workingTimetable.some(t => t.className === cls.name && t.day === day && t.slotId === slot.id && !!t.blockId));
        if (hasManualBlock) continue;
        if (isSeniorSecondary) {
          const parallelCandidates: Record<string, number> = {};
          let foundParallel = false;
          siblingClasses.forEach(cls => { const idx = perClassPool[cls.name].findIndex(p => PARALLEL_SUBJECTS.includes(p.subject.toUpperCase())); if (idx !== -1) { parallelCandidates[cls.name] = idx; foundParallel = true; } });
          if (foundParallel) {
            let slotValid = true; const tUsed = new Set<string>(); const rUsed = new Set<string>();
            for (const cls of siblingClasses) {
              const pIdx = parallelCandidates[cls.name];
              if (pIdx !== undefined) {
                const p = perClassPool[cls.name][pIdx];
                const isTeacherTrulyBusy = workingTimetable.some(t => t.day === day && t.slotId === slot.id && (t.teacherId === p.teacherId || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === p.teacherId))));
                if (isTeacherTrulyBusy || tUsed.has(p.teacherId) || (p.room && rUsed.has(p.room))) { slotValid = false; break; }
                tUsed.add(p.teacherId); if (p.room) rUsed.add(p.room);
              }
            }
            if (slotValid) {
              for (const cls of siblingClasses) {
                const pIdx = parallelCandidates[cls.name];
                if (pIdx !== undefined) {
                  const period = perClassPool[cls.name].splice(pIdx, 1)[0];
                  const entry: TimeTableEntry = { id: `base-${cls.name}-${day}-${slot.id}`, section: cls.section, className: cls.name, day, slotId: slot.id, subject: period.subject, subjectCategory: period.category, teacherId: period.teacherId, teacherName: period.teacherName, room: period.room };
                  workingTimetable.push(entry);
                  newCloudEntries.push({ id: String(entry.id), section: entry.section, class_name: entry.className, day: entry.day, slot_id: entry.slotId, subject: entry.subject, subject_category: entry.subjectCategory, teacher_id: String(entry.teacherId), teacher_name: entry.teacherName, room: entry.room || null, date: null, is_substitution: false });
                  totalAdded++;
                }
              }
              continue; 
            }
          }
        }
        const shuffledSiblings = [...siblingClasses].sort(() => Math.random() - 0.5);
        for (const cls of shuffledSiblings) {
          if (workingTimetable.some(t => t.className === cls.name && t.day === day && t.slotId === slot.id)) continue;
          const pool = perClassPool[cls.name];
          if (pool.length === 0) continue;
          const validIdx = pool.findIndex(p => {
            const isTeacherTrulyBusy = workingTimetable.some(t => t.day === day && t.slotId === slot.id && (t.teacherId === p.teacherId || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === p.teacherId))));
            if (isTeacherTrulyBusy) return false;
            if (p.room && workingTimetable.some(t => t.room === p.room && t.day === day && t.slotId === slot.id)) return false;
            const subjectTodayCount = workingTimetable.filter(t => t.className === cls.name && t.day === day && t.subject === p.subject).length;
            const maxAllowedToday = p.weeklyLoad > 5 ? 2 : 1;
            if (subjectTodayCount >= maxAllowedToday) return false;
            return true;
          });
          if (validIdx !== -1) {
            const period = pool.splice(validIdx, 1)[0];
            const entry: TimeTableEntry = { id: `base-${cls.name}-${day}-${slot.id}`, section: cls.section, className: cls.name, day, slotId: slot.id, subject: period.subject, subjectCategory: period.category, teacherId: period.teacherId, teacherName: period.teacherName, room: period.room };
            workingTimetable.push(entry);
            newCloudEntries.push({ id: String(entry.id), section: entry.section, class_name: entry.className, day: entry.day, slot_id: entry.slotId, subject: entry.subject, subject_category: entry.subjectCategory, teacher_id: String(entry.teacherId), teacher_name: entry.teacherName, room: entry.room || null, date: null, is_substitution: false });
            totalAdded++;
          }
        }
      }
    }
    if (isCloudActive && newCloudEntries.length > 0) { await supabase.from('timetable_entries').upsert(newCloudEntries, { onConflict: 'id' }); }
    setTimetable(workingTimetable);
    setStatus({ type: 'success', message: `Matrix Synced: ${totalAdded} periods committed.` });
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col h-full min-h-screen space-y-4 animate-in fade-in duration-700 w-full px-1 sm:px-2 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 no-pdf no-print shrink-0 mt-2">
        <div className="flex flex-col text-center md:text-left">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Institutional Matrix</h1>
          {viewMode === 'CLASS' && selectedClass && (
            <div className="flex items-center justify-center md:justify-start gap-2 mt-3">
              <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[10px] font-black text-amber-600 uppercase">Division: {selectedClass}</span>
              <span className="text-[10px] font-black text-slate-400 uppercase">Lead: <span className="text-[#001f3f] dark:text-white italic">{classTeacher ? classTeacher.name : 'N/A'}</span></span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
           {isManagement && (
             <>
               <button onClick={handleAutoGenerateGrade} disabled={isProcessing || !selectedClass || viewMode !== 'CLASS'} className="flex-1 md:flex-none bg-sky-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-lg disabled:opacity-50 transition-all active:scale-95">{isProcessing ? 'SYNCING...' : 'Auto-Fill'}</button>
               <button onClick={() => setIsDesigning(!isDesigning)} className={`flex-1 md:flex-none px-5 py-3 rounded-2xl text-[10px] font-black uppercase transition-all shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Exit' : 'Edit Matrix'}</button>
             </>
           )}
        </div>
      </div>

      <div id="timetable-export-container" className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[600px] relative z-0">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 no-pdf no-print flex flex-col xl:flex-row items-center gap-4 shrink-0 overflow-x-auto">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border dark:border-slate-800 shadow-sm shrink-0 w-full xl:w-auto">
              {canViewClassTab && (
                <button onClick={() => { setViewMode('CLASS'); setSelectedClass(user.role.startsWith('TEACHER_') ? user.classTeacherOf || '' : ''); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
              )}
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(user.id); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
              {isManagement && <button onClick={() => { setViewMode('ROOM'); setSelectedClass(''); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>}
           </div>
           
           <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm shrink-0 w-full xl:w-auto">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date:</span>
             <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white" />
           </div>

           <select 
             className="bg-white dark:bg-slate-950 px-5 py-3 rounded-xl border-2 border-slate-100 dark:border-slate-800 text-[11px] font-black uppercase flex-1 min-w-[240px] outline-none focus:border-amber-400 transition-all dark:text-white" 
             value={selectedClass} 
             onChange={e => setSelectedClass(e.target.value)}
             disabled={viewMode === 'TEACHER' && !isAdmin && !user.role.startsWith('INCHARGE_') || (viewMode === 'CLASS' && !isAdmin && user.role.startsWith('TEACHER_'))}
           >
             <option value="">Choose Target Focus...</option>
             {viewMode === 'CLASS' ? filteredClasses.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : viewMode === 'TEACHER' ? availableTeachers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>) : config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
           </select>
           {status && (<div className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all animate-in slide-in-from-left duration-300 ${status.type === 'error' ? 'text-red-600 bg-red-50 border-red-100' : status.type === 'warning' ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>{status.message}</div>)}
        </div>
        
        <div className="flex-1 overflow-x-auto overflow-y-auto bg-slate-50/20 max-h-[70vh] scrollbar-hide">
          <table className="w-full border-collapse table-fixed min-w-[1200px]">
            <thead className="bg-[#00122b] sticky top-0 z-[40]">
              <tr className="h-16">
                <th className="w-32 border border-white/10 text-[13px] font-black text-amber-500 uppercase tracking-[0.2em] italic sticky left-0 z-[50] bg-[#00122b]">Day</th>
                {slots.map(s => <th key={s.id} className="text-white text-[11px] font-black uppercase border border-white/5 bg-[#001f3f] p-2">
                  <p className="leading-none">{s.label.replace('Period ', 'P')}</p>
                  <p className="text-[9px] opacity-40 font-bold tracking-tight mt-1">{s.startTime}-{s.endTime}</p>
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {DAYS.map((day) => (
                <tr key={day} className="h-32 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="bg-[#00122b] text-white font-black text-center text-[13px] uppercase border border-white/5 tracking-tighter italic sticky left-0 z-[30] shadow-xl">
                    {day.toUpperCase()}
                  </td>
                  {slots.map(s => (<td key={s.id} className={`border border-slate-100 dark:border-slate-800/40 p-1.5 relative ${s.isBreak ? 'bg-amber-50/20' : ''}`}>
                    {s.isBreak ? (
                      <div className="flex items-center justify-center h-full">
                        <span className="text-amber-500/40 font-black text-[12px] tracking-[0.6em] uppercase transform rotate-90 xl:rotate-0">RECESS</span>
                      </div>
                    ) : renderGridCell(day, s, selectedClass, viewMode)}
                  </td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {viewMode === 'TEACHER' && selectedClass && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-4 duration-500 no-pdf no-print mt-4">
           <div className="flex items-center gap-4 mb-10">
              <div className="w-12 h-12 bg-[#001f3f] text-amber-400 rounded-2xl flex items-center justify-center font-black shadow-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg></div>
              <div>
                <h3 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Load Distribution Registry</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Authorized subject assignments for faculty</p>
              </div>
           </div>
           {selectedTeacherAssignments.length > 0 ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
                {selectedTeacherAssignments.map(asgn => (
                  <div key={asgn.id} className="bg-slate-50/50 dark:bg-slate-800/40 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm group hover:-translate-y-1 transition-all">
                     <p className="text-[11px] font-black text-amber-600 uppercase tracking-[0.2em] italic mb-5 border-b border-amber-100 dark:border-amber-900/40 pb-2">{asgn.grade}</p>
                     <div className="space-y-4">
                        {asgn.loads.map((load, idx) => (
                          <div key={idx} className="flex justify-between items-start">
                             <div className="flex flex-col">
                               <p className="text-[13px] font-black text-[#001f3f] dark:text-white uppercase leading-none">{load.subject}</p>
                               {load.room && <p className="text-[10px] font-black text-slate-400 uppercase mt-1.5 tracking-tighter">Location: {load.room}</p>}
                             </div>
                             <span className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase shadow-sm whitespace-nowrap">{load.periods}P</span>
                          </div>
                        ))}
                     </div>
                  </div>
                ))}
             </div>
           ) : (<div className="py-24 text-center bg-slate-50/30 dark:bg-slate-950/20 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800"><p className="text-sm font-black text-slate-300 uppercase tracking-[0.5em] italic">No active workload detected</p></div>)}
        </div>
      )}

      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/90 backdrop-blur-md no-pdf no-print">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
             <div className="pt-10 pb-6 text-center shrink-0">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-tight">Period Controller</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{editContext.day.toUpperCase()} — {editContext.slot.label.toUpperCase()}</p>
             </div>
             <div className="px-10 pb-8 shrink-0">
               <div className="bg-slate-100 dark:bg-slate-800 p-1.5 rounded-[2rem] flex">
                 <button onClick={() => setEntryType('INDIVIDUAL')} className={`flex-1 py-4 rounded-[1.75rem] text-[11px] font-black uppercase transition-all duration-300 ${entryType === 'INDIVIDUAL' ? 'bg-[#001f3f] text-white shadow-xl' : 'text-slate-400 hover:text-slate-600'}`}>Individual</button>
                 <button onClick={() => setEntryType('GROUP')} className={`flex-1 py-4 rounded-[1.75rem] text-[11px] font-black uppercase transition-all duration-300 ${entryType === 'GROUP' ? 'bg-[#001f3f] text-white shadow-xl' : 'text-slate-400 hover:text-slate-600'}`}>Group Block</button>
               </div>
             </div>
             <div className="px-10 space-y-8 flex-1 overflow-y-auto scrollbar-hide">
                {entryType === 'INDIVIDUAL' ? (
                  <div className="space-y-6 pb-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Faculty</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20 transition-all" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                        <option value="">Select Personnel...</option>
                        {users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Section</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20 transition-all" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                        <option value="">Select Division...</option>
                        {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                        <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20 transition-all" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                          <option value="">Subject...</option>
                          {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Room No</label>
                        <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20 transition-all" value={manualData.room} onChange={e => setManualData({...manualData, room: e.target.value})}>
                          <option value="">Location...</option>
                          {(config.rooms || []).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 pb-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Parallel Matrix Group</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-5 font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-indigo-400/20 transition-all" value={manualData.blockId} onChange={e => setManualData({...manualData, blockId: e.target.value})}>
                        <option value="">Select Group Identity...</option>
                        {config.combinedBlocks.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
                      </select>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 italic text-center px-4 leading-relaxed">Assigning a group will automatically distribute parallel instructional units to all mapped sections in this slot.</p>
                  </div>
                )}
             </div>
             <div className="p-10 space-y-4 shrink-0 border-t border-slate-100 dark:border-slate-800">
                <button onClick={handleSaveEntry} disabled={isProcessing} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-50">{isProcessing ? 'SYNCHRONIZING...' : 'AUTHORIZE REGISTRY'}</button>
                <div className="flex w-full gap-4">
                  <button onClick={handleDecommissionEntry} disabled={isProcessing} className="flex-1 text-rose-500 font-black text-[11px] uppercase tracking-widest hover:bg-rose-50 py-3 rounded-xl transition-all disabled:opacity-50">Decommission</button>
                  <button onClick={() => setShowEditModal(false)} className="flex-1 text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 py-3 rounded-xl transition-all">Abort Action</button>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;
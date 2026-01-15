import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

declare var html2pdf: any;

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
  const [isExporting, setIsExporting] = useState(false);
  
  const [viewDate, setViewDate] = useState<string>(() => new Date().toISOString().split('T')[0]); 
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot, targetId?: string} | null>(null);
  const [entryType, setEntryType] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '', room: '', blockId: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  const [draggingEntry, setDraggingEntry] = useState<TimeTableEntry | null>(null);
  const [dragOverPos, setDragOverPos] = useState<{day: string, slotId: number} | null>(null);

  const classTeacher = useMemo(() => {
    if (viewMode !== 'CLASS' || !selectedClass) return null;
    return users.find(u => u.classTeacherOf === selectedClass);
  }, [viewMode, selectedClass, users]);

  const selectedTeacherAssignments = useMemo(() => {
    if (viewMode !== 'TEACHER' || !selectedClass) return [];
    return assignments.filter(a => a.teacherId === selectedClass);
  }, [viewMode, selectedClass, assignments]);

  useEffect(() => {
    if (viewMode === 'TEACHER' && !isManagement && !selectedClass) {
      setSelectedClass(user.id);
    }
  }, [viewMode, isManagement, user.id, selectedClass]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getGradeFromClassName = (name: string) => {
    const romanMatch = name.match(/[IVX]+/);
    if (romanMatch) return `Grade ${romanMatch[0]}`;
    const digitMatch = name.match(/\d+/);
    if (digitMatch) return `Grade ${digitMatch[0]}`;
    return name;
  };

  const isLimitedSubject = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('art') || n.includes('phe') || n.includes('library') || n.includes('physical education') || n.trim().toUpperCase() === 'CEP';
  };

  const getSlotsForSection = (section: SectionType) => {
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section === 'SECONDARY_GIRLS' || section === 'SENIOR_SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  };

  const slots = useMemo(() => {
    let targetSection = activeSection;
    let isTeacherView = viewMode === 'TEACHER';
    let isPrimaryContext = false;

    if (selectedClass) {
      if (viewMode === 'CLASS') {
        const classObj = config.classes.find(c => c.name === selectedClass);
        if (classObj) targetSection = classObj.section;
      } else if (viewMode === 'TEACHER') {
        const teacher = users.find(u => u.id === selectedClass);
        if (teacher) {
          if (teacher.role.includes('PRIMARY')) {
            targetSection = 'PRIMARY';
            isPrimaryContext = true;
          } else {
            // For non-primary teachers (Secondary/Senior), we use the Boys template as a length standard
            targetSection = 'SECONDARY_BOYS'; 
          }
        }
      }
    }
    
    const allSlots = getSlotsForSection(targetSection);
    
    // Logic: Remove recess columns for non-primary staff in Teacher View 
    // to prevent grid distortion when staff move between Boys/Girls wings.
    if (isTeacherView && !isPrimaryContext) {
      return allSlots.filter(s => !s.isBreak);
    }
    
    return allSlots;
  }, [activeSection, selectedClass, config.classes, viewMode, users]);

  const availableTeachers = useMemo(() => {
    return users.filter(u => {
      if (u.role === UserRole.ADMIN || u.isResigned) return false;
      if (isAdmin) return true;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY') || u.secondaryRoles?.some(r => r.includes('PRIMARY'));
      if (user.role === UserRole.INCHARGE_SECONDARY) return !u.role.includes('PRIMARY');
      return u.id === user.id;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [users, isAdmin, user.role]);

  const handleExportPDF = async () => {
    if (!selectedClass) {
      setStatus({ type: 'error', message: 'Target selection required for PDF export.' });
      return;
    }
    setIsExporting(true);
    const element = document.getElementById('timetable-export-container');
    const scrollContainer = element?.querySelector('.overflow-auto');
    
    if (!element) {
      setIsExporting(false);
      return;
    }

    if (scrollContainer) {
      scrollContainer.scrollLeft = 0;
      scrollContainer.scrollTop = 0;
    }

    const originalStyle = element.style.cssText;
    element.classList.add('pdf-export-mode');
    
    element.style.height = 'auto';
    element.style.width = '297mm'; 
    element.style.maxWidth = '297mm';
    element.style.overflow = 'visible';
    element.style.padding = '0';
    element.style.margin = '0';

    const filename = `Timetable_${selectedClass.replace(/\s+/g, '_')}_2026_27.pdf`;

    const opt = {
      margin: [2, 2, 2, 2], // Minimal margins
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff',
        logging: false,
        letterRendering: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: 1400 // Wide capture window to ensure P9/P10 visible
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
      pagebreak: { mode: 'avoid-all' } 
    };

    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (typeof html2pdf !== 'undefined') {
        await html2pdf().set(opt).from(element).save();
      }
    } catch (err) {
      console.error("Timetable PDF Export Error:", err);
    } finally {
      element.classList.remove('pdf-export-mode');
      element.style.cssText = originalStyle;
      setIsExporting(false);
    }
  };

  const openEntryModal = (day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
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
  };

  const handleDragStart = (e: React.DragEvent, entry: TimeTableEntry) => {
    if (!isDesigning) return;
    setDraggingEntry(entry);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, day: string, slotId: number) => {
    if (!isDesigning || !draggingEntry) return;
    e.preventDefault();
    setDragOverPos({ day, slotId });
  };

  const handleDrop = async (e: React.DragEvent, targetDay: string, targetSlotId: number) => {
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

        const affectedEntries = timetable.filter(t => 
          t.blockId === sourceEntry.blockId && 
          t.day === sourceEntry.day && 
          t.slotId === sourceEntry.slotId && 
          (t.date || null) === (sourceEntry.date || null)
        );

        const conflicts: string[] = [];
        for (const sectionName of block.sectionNames) {
          const busy = timetable.some(t => 
            t.className === sectionName && 
            t.day === targetDay && 
            t.slotId === targetSlotId && 
            (t.date || null) === (sourceEntry.date || null) &&
            !affectedEntries.some(ae => ae.id === t.id)
          );
          if (busy) conflicts.push(sectionName);
        }

        if (conflicts.length > 0) {
          setStatus({ type: 'error', message: `Block Conflict: ${conflicts.join(', ')} occupied in target slot.` });
          setIsProcessing(false);
          return;
        }

        const newEntries = affectedEntries.map(old => ({
          ...old,
          id: `block-entry-${block.id}-${old.className}-${targetDay}-${targetSlotId}`,
          day: targetDay,
          slotId: targetSlotId
        }));

        if (isCloudActive) {
          await supabase.from('timetable_entries').delete().in('id', affectedEntries.map(ae => ae.id));
          const cloudPayload = newEntries.map(e => ({
            id: e.id, section: e.section, class_name: e.className, day: e.day, slot_id: e.slotId,
            subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId,
            teacher_name: e.teacherName, room: e.room || null, date: e.date || null,
            is_substitution: !!e.isSubstitution, block_id: e.blockId
          }));
          await supabase.from('timetable_entries').upsert(cloudPayload);
        }

        setTimetable(prev => [
          ...prev.filter(t => !affectedEntries.some(ae => ae.id === t.id)),
          ...newEntries
        ]);
        setStatus({ type: 'success', message: `Parallel Block shifted to ${targetDay} P${targetSlotId}` });

      } else {
        const isTeacherBusy = timetable.some(t => 
          t.teacherId === sourceEntry.teacherId && 
          t.day === targetDay && 
          t.slotId === targetSlotId && 
          (t.date || null) === (sourceEntry.date || null) &&
          t.id !== sourceEntry.id
        );

        if (isTeacherBusy) {
           const teacherName = sourceEntry.teacherName.split(' ')[0];
           setStatus({ type: 'error', message: `Conflict: ${teacherName} already assigned at ${targetDay} P${targetSlotId}` });
           setIsProcessing(false);
           return;
        }

        const newEntry = { 
          ...sourceEntry, 
          day: targetDay, 
          slotId: targetSlotId, 
          id: (sourceEntry.date ? `sub-${sourceEntry.className}-${targetDay}-${targetSlotId}-${Date.now()}` : `base-${sourceEntry.className}-${targetDay}-${targetSlotId}`)
        };

        if (isCloudActive) {
          await supabase.from('timetable_entries').delete().eq('id', sourceEntry.id);
          await supabase.from('timetable_entries').upsert({
            id: newEntry.id, section: newEntry.section, class_name: newEntry.className, day: newEntry.day, slot_id: newEntry.slotId,
            subject: newEntry.subject, subject_category: newEntry.subjectCategory, teacher_id: String(newEntry.teacherId),
            teacher_name: newEntry.teacherName, room: newEntry.room || null, date: newEntry.date || null,
            is_substitution: !!newEntry.isSubstitution
          });
        }

        setTimetable(prev => [...prev.filter(t => t.id !== sourceEntry.id), newEntry]);
        setStatus({ type: 'success', message: `Shifted ${sourceEntry.subject} to ${targetDay} P${targetSlotId}` });
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: "Operational Handshake Failed." });
    } finally {
      setIsProcessing(false);
    }
  };

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
        const busy = timetable.some(t => 
          t.className === sectionName && 
          t.day === editContext.day && 
          t.slotId === editContext.slot.id && 
          (t.date || null) === (viewDate || null) &&
          t.id !== editContext.targetId
        );
        if (busy) {
          conflictSections.push(sectionName);
          continue;
        }

        const classObj = config.classes.find(c => c.name === sectionName);
        if (!classObj) continue;

        const entry: TimeTableEntry = {
          id: `block-entry-${block.id}-${sectionName}-${editContext.day}-${editContext.slot.id}`,
          section: classObj.section,
          className: sectionName,
          day: editContext.day,
          slotId: editContext.slot.id,
          subject: block.name,
          subjectCategory: SubjectCategory.CORE,
          teacherId: 'BLOCK_RESOURCE',
          teacherName: 'Group Period',
          room: block.allocations.map(a => a.room).filter(Boolean).join(', '),
          blockId: block.id,
          blockName: block.name,
          date: viewDate || undefined
        };

        newEntries.push(entry);
        if (isCloudActive) {
          cloudEntries.push({
            id: entry.id, section: entry.section, class_name: entry.className, day: entry.day, slot_id: entry.slotId,
            subject: entry.subject, subject_category: entry.subjectCategory, teacher_id: entry.teacherId,
            teacher_name: entry.teacherName, room: entry.room || null, date: entry.date || null,
            is_substitution: !!entry.isSubstitution, block_id: entry.blockId
          });
        }
      }

      if (conflictSections.length > 0) {
        setStatus({ type: 'error', message: `Conflict detected in: ${conflictSections.join(', ')}` });
        setIsProcessing(false);
        return;
      }

      if (isCloudActive && cloudEntries.length > 0) {
        const { error } = await supabase.from('timetable_entries').upsert(cloudEntries, { onConflict: 'id' });
        if (error) {
          setStatus({ type: 'error', message: `Cloud Sync Error: ${error.message}` });
          setIsProcessing(false);
          return;
        }
      }

      setTimetable(prev => {
        const idsToRemove = new Set(newEntries.map(e => e.id));
        return [...prev.filter(t => !idsToRemove.has(t.id)), ...newEntries];
      });

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

    const entryId = editContext.targetId || (viewDate 
      ? `sub-${manualData.className}-${editContext.day}-${editContext.slot.id}-${Date.now()}`
      : `base-${manualData.className}-${editContext.day}-${editContext.slot.id}`);

    const newEntry: TimeTableEntry = {
      id: entryId, section: classObj.section, className: manualData.className, day: editContext.day, slotId: editContext.slot.id,
      subject: manualData.subject, subjectCategory: subject.category, teacherId: teacher.id, teacherName: teacher.name,
      room: manualData.room, date: viewDate || undefined, isSubstitution: !!viewDate
    };

    setIsProcessing(true);
    if (isCloudActive) {
      const payload = {
        id: String(newEntry.id), section: newEntry.section, class_name: newEntry.className, day: newEntry.day, slot_id: newEntry.slotId,
        subject: newEntry.subject, subject_category: newEntry.subjectCategory, teacher_id: String(newEntry.teacherId),
        teacher_name: newEntry.teacherName, room: newEntry.room || null, date: newEntry.date || null,
        is_substitution: !!newEntry.isSubstitution
      };
      const { error } = await supabase.from('timetable_entries').upsert(payload, { onConflict: 'id' });
      if (error) {
        setStatus({ type: 'error', message: `Cloud Handshake Failed: ${error.message}` });
        setIsProcessing(false);
        return;
      }
    }
    setTimetable(prev => [...prev.filter(t => t.id !== entryId), newEntry]);
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Individual Entry Authorized.' });
    setIsProcessing(false);
  };

  const handleDecommissionEntry = async () => {
    if (!editContext) return;
    const target = timetable.find(t => 
      t.day === editContext.day && t.slotId === editContext.slot.id && 
      (viewMode === 'CLASS' ? t.className === selectedClass : viewMode === 'TEACHER' ? (t.teacherId === selectedClass || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === selectedClass))) : t.room === selectedClass) && 
      (t.date || null) === (viewDate || null)
    );
    if (!target) { setShowEditModal(false); return; }
    setIsProcessing(true);
    try {
      const idsToDelete = target.blockId 
        ? timetable.filter(t => t.blockId === target.blockId && t.day === target.day && t.slotId === target.slotId && (t.date || null) === (target.date || null)).map(t => t.id)
        : [target.id];
      if (isCloudActive) {
        const { error } = await supabase.from('timetable_entries').delete().in('id', idsToDelete);
        if (error) throw error;
      }
      setTimetable(prev => prev.filter(t => !idsToDelete.includes(t.id)));
      setShowEditModal(false);
      setStatus({ type: 'success', message: 'Registry Entry Decommissioned.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: `Decommission Failed.` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutoGenerateGrade = async () => {
    if (viewMode !== 'CLASS' || !selectedClass) {
      setStatus({ type: 'error', message: 'Target selection required for Grade Matrix optimization.' });
      return;
    }

    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 800));

    const sourceClass = config.classes.find(c => c.name === selectedClass);
    if (!sourceClass) { setIsProcessing(false); return; }

    const grade = getGradeFromClassName(selectedClass);
    const siblingClasses = config.classes.filter(c => getGradeFromClassName(c.name) === grade);
    const gradeAssignments = assignments.filter(a => a.grade === grade);
    
    if (gradeAssignments.length === 0) {
      setStatus({ type: 'warning', message: `Optimization Halted: No faculty workload found for ${grade}.` });
      setIsProcessing(false);
      return;
    }

    const siblingNames = siblingClasses.map(c => c.name);
    const isSeniorSecondary = siblingClasses.some(c => c.section.includes('SENIOR_SECONDARY'));
    const PARALLEL_SUBJECTS = ['MATHEMATICS', 'IP', 'MARKETING', 'COMPUTER SCIENCE', 'BIOLOGY', 'CS'];

    if (isCloudActive) {
      await supabase.from('timetable_entries').delete().in('class_name', siblingNames).is('date', null);
    }

    const siblingNamesSet = new Set(siblingNames);
    let workingTimetable = timetable.filter(t => !siblingNamesSet.has(t.className) || !!t.date || !!t.blockId);
    const newCloudEntries: any[] = [];

    const perClassPool: Record<string, { subject: string, teacherId: string, teacherName: string, category: SubjectCategory, room?: string, weeklyLoad: number }[]> = {};
    siblingClasses.forEach(c => perClassPool[c.name] = []);

    gradeAssignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      if (!teacher) return;
      const applicableClasses = (asgn.targetSections && asgn.targetSections.length > 0)
        ? siblingClasses.filter(c => asgn.targetSections?.includes(c.name))
        : siblingClasses;
      if (applicableClasses.length === 0) return;
      asgn.loads.forEach(load => {
        const sub = config.subjects.find(s => s.name === load.subject);
        if (!sub) return;
        const totalPeriods = Number(load.periods) || 0;
        const basePerClass = Math.floor(totalPeriods / applicableClasses.length);
        const remainder = totalPeriods % applicableClasses.length;
        applicableClasses.forEach((cls, idx) => {
          const count = basePerClass + (idx < remainder ? 1 : 0);
          for (let i = 0; i < count; i++) {
            perClassPool[cls.name].push({ subject: load.subject, teacherId: teacher.id, teacherName: teacher.name, category: sub.category, room: load.room, weeklyLoad: count });
          }
        });
      });
    });

    Object.keys(perClassPool).forEach(cls => {
      perClassPool[cls].sort((a, b) => b.weeklyLoad - a.weeklyLoad);
    });

    let totalAdded = 0;
    const days = DAYS;
    for (const day of days) {
      const sectionSlots = getSlotsForSection(siblingClasses[0].section).filter(s => !s.isBreak);
      for (const slot of sectionSlots) {
        const hasManualBlock = siblingClasses.some(cls => workingTimetable.some(t => t.className === cls.name && t.day === day && t.slotId === slot.id && !!t.blockId));
        if (hasManualBlock) continue;

        if (isSeniorSecondary) {
          const parallelCandidates: Record<string, number> = {};
          let foundParallel = false;
          siblingClasses.forEach(cls => {
            const idx = perClassPool[cls.name].findIndex(p => PARALLEL_SUBJECTS.includes(p.subject.toUpperCase()));
            if (idx !== -1) { parallelCandidates[cls.name] = idx; foundParallel = true; }
          });
          if (foundParallel) {
            let slotValid = true;
            const tUsed = new Set<string>();
            const rUsed = new Set<string>();
            for (const cls of siblingClasses) {
              const pIdx = parallelCandidates[cls.name];
              if (pIdx !== undefined) {
                const p = perClassPool[cls.name][pIdx];
                const isTeacherTrulyBusy = workingTimetable.some(t => 
                  t.day === day && t.slotId === slot.id && (
                    t.teacherId === p.teacherId || 
                    (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === p.teacherId))
                  )
                );
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
            const isTeacherTrulyBusy = workingTimetable.some(t => 
              t.day === day && t.slotId === slot.id && (
                t.teacherId === p.teacherId || 
                (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === p.teacherId))
              )
            );
            if (isTeacherTrulyBusy) return false;
            
            if (p.room && workingTimetable.some(t => t.room === p.room && t.day === day && t.slotId === slot.id)) return false;
            
            const subjectTodayCount = workingTimetable.filter(t => t.className === cls.name && t.day === day && t.subject === p.subject).length;
            const maxAllowedToday = p.weeklyLoad > 5 ? 2 : 1;
            if (subjectTodayCount >= maxAllowedToday && !isLimitedSubject(p.subject)) return false;
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
    if (isCloudActive && newCloudEntries.length > 0) {
      await supabase.from('timetable_entries').upsert(newCloudEntries, { onConflict: 'id' });
    }
    setTimetable(workingTimetable);
    setStatus({ type: 'success', message: `Matrix Synced: ${totalAdded} periods committed.` });
    setIsProcessing(false);
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER' | 'ROOM') => {
    if (slot.isBreak || !targetId) return null;

    const candidates = timetable.filter(t => {
      if (t.day !== day || t.slotId !== slot.id) return false;

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
        if (allocation) { 
          displaySubject = allocation.subject; 
          displayRoom = allocation.room || activeEntry.room; 
        }
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
        } else {
          displaySubMeta = activeEntry.teacherName.split(' ')[0];
        }
      } else {
        displaySubMeta = activeEntry.teacherName.split(' ')[0];
      }
    }

    const isTargetCell = dragOverPos?.day === day && dragOverPos?.slotId === slot.id;
    return (
      <div draggable={isDesigning} onDragStart={(e) => handleDragStart(e, activeEntry!)} onDragOver={(e) => handleDragOver(e, day, slot.id)} onDrop={(e) => handleDrop(e, day, slot.id)} onClick={() => isDesigning && openEntryModal(day, slot, activeEntry)} className={`h-full p-1 border-2 rounded-sm flex flex-col justify-center text-center transition-all w-full relative group ${isBlock ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-400 shadow-[inset_0_0_8px_rgba(79,70,229,0.1)]' : isSub ? 'bg-amber-50 dark:bg-amber-900/20 border-dashed border-amber-400' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'} ${isDesigning ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400' : ''} ${isTargetCell ? 'ring-4 ring-sky-400 scale-[1.05] z-50 shadow-2xl' : ''}`}>
        {isSub && <div className="absolute top-0 right-0 bg-amber-400 text-[#001f3f] text-[6px] px-1 font-black rounded-bl shadow-sm">SUB</div>}
        {isBlock && <div className="absolute top-0 left-0 bg-indigo-500 text-white text-[6px] px-1 font-black rounded-br shadow-sm">GROUP</div>}
        <p className={`text-[9px] font-black uppercase leading-tight ${isBlock ? 'text-indigo-600' : isSub ? 'text-amber-600' : 'text-sky-600'}`}>{displaySubject}</p>
        <p className={`text-[8px] font-bold text-[#001f3f] dark:text-white truncate mt-0.5 opacity-80`}>{displayMeta}</p>
        <p className={`text-[7px] font-medium text-slate-400 truncate`}>{displaySubMeta}</p>
        {displayRoom && currentViewMode !== 'ROOM' && <p className="text-[6px] font-black text-slate-400 uppercase tracking-tighter mt-0.5">Rm: {displayRoom}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-in fade-in duration-700 overflow-hidden w-full px-2 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 no-pdf shrink-0">
        <div className="flex flex-col">
          <h1 className="text-xl md:text-2xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Institutional Timetable</h1>
          {viewMode === 'CLASS' && selectedClass && (
            <div className="flex items-center gap-2 mt-2">
              <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-800 rounded-lg text-[10px] font-black text-amber-600 uppercase">Class: {selectedClass}</span>
              <span className="text-[10px] font-black text-slate-400 uppercase">Teacher: <span className="text-[#001f3f] dark:text-white italic">{classTeacher ? classTeacher.name : 'Unassigned'}</span></span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
           {isManagement && (
             <>
               <button onClick={handleAutoGenerateGrade} disabled={isProcessing || !selectedClass || viewMode !== 'CLASS'} className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all hover:scale-105 active:scale-95">{isProcessing ? 'Synchronizing...' : 'Auto-Fill Grade'}</button>
               <button onClick={() => setIsDesigning(!isDesigning)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Exit Designer' : 'Edit Matrix'}</button>
             </>
           )}
           <button onClick={handleExportPDF} disabled={isExporting || !selectedClass} className="bg-[#d4af37] text-[#001f3f] px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-xl transition-all hover:scale-105 disabled:opacity-50">
             {isExporting ? 'Generating...' : 'Export PDF'}
           </button>
           <button onClick={() => window.print()} className="bg-[#001f3f] text-amber-400 px-4 py-2 rounded-xl text-[9px] font-black uppercase border border-amber-400 shadow-xl transition-all hover:scale-105">Print View</button>
        </div>
      </div>

      <div id="timetable-export-container" className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex-1 flex flex-col min-h-0">
        
        {/* INSTITUTIONAL PDF HEADER */}
        <div className="pdf-only p-8 pb-8 bg-white border-b-4 border-[#001f3f] text-center">
           <div className="space-y-3 mb-6">
              <h2 className="text-3xl md:text-4xl font-black text-[#001f3f] uppercase tracking-tight">IBN AL HYTHAM ISLAMIC SCHOOL</h2>
              <p className="text-lg md:text-xl font-black text-amber-600 uppercase tracking-[0.6em] italic">ACADEMIC YEAR 2026-27</p>
           </div>
           
           <div className="flex flex-col items-center gap-2 border-t-2 border-slate-100 pt-4">
              <p className="text-xl font-black text-[#001f3f] uppercase tracking-tight italic">
                {viewMode === 'CLASS' ? `CLASS: ${selectedClass}` : viewMode === 'TEACHER' ? `FACULTY: ${users.find(u => u.id === selectedClass)?.name || 'N/A'}` : `ROOM: ${selectedClass}`}
              </p>
              {viewMode === 'CLASS' && classTeacher && (
                <p className="text-lg font-bold text-slate-500 uppercase italic tracking-widest">CLASS TEACHER: {classTeacher.name.toUpperCase()}</p>
              )}
           </div>
        </div>

        {/* WEB-ONLY CONTROLS */}
        <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/20 no-pdf flex flex-col xl:flex-row items-center gap-4 shrink-0">
           <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800 shadow-sm shrink-0">
              <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class View</button>
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff View</button>
              {isManagement && <button onClick={() => { setViewMode('ROOM'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room View</button>}
           </div>
           <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Schedule Context:</span>
             <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
             {viewDate && <button onClick={() => setViewDate('')} className="text-[8px] font-black text-rose-500 uppercase hover:underline">Reset</button>}
           </div>
           <select className="bg-white dark:bg-slate-900 px-5 py-2.5 rounded-xl border-2 border-slate-100 dark:border-slate-800 text-[11px] font-black uppercase flex-1 min-w-[200px] outline-none focus:border-amber-400 transition-all dark:text-white" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} disabled={viewMode === 'TEACHER' && !isManagement}>
             <option value="">Select Targeted Entity...</option>
             {viewMode === 'CLASS' ? config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : viewMode === 'TEACHER' ? availableTeachers.map(u => <option key={u.id} value={u.id}>{u.name}</option>) : config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
           </select>
           {status && (<div className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all animate-in slide-in-from-left duration-300 ${status.type === 'error' ? 'text-red-500 bg-red-50 border border-red-100' : status.type === 'warning' ? 'text-amber-600 bg-amber-50 border border-amber-100' : 'text-emerald-600 bg-emerald-50 border border-emerald-100'}`}>{status.message}</div>)}
        </div>
        
        <div className="flex-1 overflow-auto scrollbar-hide pdf-export-mode:overflow-visible">
          <table className="w-full h-full border-collapse table-fixed min-w-[900px] pdf-export-mode:min-w-0">
            <thead className="bg-[#00122b] sticky top-0 z-10 pdf-export-mode:bg-white">
              <tr className="h-12">
                <th className="w-24 border border-white/5 text-[11px] font-black text-amber-500 uppercase tracking-[0.2em] italic day-column-cell">Day</th>
                {slots.map(s => <th key={s.id} className="text-white pdf-export-mode:text-[#001f3f] text-[9px] font-black uppercase border border-white/5 pdf-export-mode:border-slate-300 bg-[#001f3f]/50 pdf-export-mode:bg-white">{s.label.replace('Period ', 'P')}<div className="text-[7px] opacity-40 font-bold tracking-tight mt-0.5">{s.startTime} - {s.endTime}</div></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/20 pdf-export-mode:divide-slate-300">
              {DAYS.map((day, idx) => (
                <tr key={day} className="h-20 hover:bg-slate-50/30 transition-colors pdf-export-mode:h-24">
                  <td className="bg-[#00122b] text-white font-black text-center text-[11px] uppercase border border-white/5 tracking-tighter italic day-column-cell">
                    {day.toUpperCase()}
                  </td>
                  {slots.map(s => (<td key={s.id} className={`border border-slate-100 dark:border-slate-800/10 pdf-export-mode:border-slate-300 p-0.5 relative ${s.isBreak ? 'bg-amber-50/10' : ''}`}>{s.isBreak ? (<div className="flex items-center justify-center h-full"><span className="text-amber-500/30 pdf-export-mode:text-slate-300 font-black text-[9px] tracking-[0.4em] uppercase rotate-90 md:rotate-0">RECESS</span></div>) : renderGridCell(day, s, idx, selectedClass, viewMode)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* INSTITUTIONAL PDF FOOTER - Refined alignment */}
        <div className="pdf-only flex justify-end px-12 pt-10 pb-6 bg-white">
           <div className="flex flex-col items-center">
              <div className="w-[60mm] h-[1px] bg-[#001f3f] mb-1.5"></div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#001f3f]">PRINCIPAL'S SIGN</p>
           </div>
        </div>
      </div>
      
      {viewMode === 'TEACHER' && selectedClass && (
        <div className="bg-slate-50/50 dark:bg-slate-800/20 rounded-[2.5rem] p-8 border border-slate-100 dark:border-slate-800/50 animate-in slide-in-from-bottom-4 duration-500 no-pdf">
           <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs shadow-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg></div>
                 <div><h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest">Faculty Load Registry</h3><p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Assigned subject units for selected staff</p></div>
              </div>
           </div>
           {selectedTeacherAssignments.length > 0 ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {selectedTeacherAssignments.map(asgn => (
                  <div key={asgn.id} className="bg-white dark:bg-slate-950 p-6 rounded-[2rem] border-2 border-slate-50 dark:border-slate-800 shadow-xl relative overflow-hidden group">
                     <p className="text-[10px] font-black text-[#d4af37] uppercase tracking-widest italic mb-4">{asgn.grade}</p>
                     <div className="space-y-4">
                        {asgn.loads.map((load, idx) => (
                          <div key={idx} className="flex justify-between items-start border-b border-slate-50 dark:border-slate-900 pb-3 last:border-0 last:pb-0">
                             <div className="flex flex-col"><p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase truncate max-w-[140px]">{load.subject}</p>{load.room && <p className="text-[7px] font-black text-slate-400 uppercase">Room: {load.room}</p>}</div>
                             <span className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-[8px] font-black text-slate-600 dark:text-slate-400 uppercase whitespace-nowrap">{load.periods} Periods</span>
                          </div>
                        ))}
                        {(asgn.groupPeriods || 0) > 0 && (
                          <div className="flex justify-between items-start pt-3 border-t border-dashed border-amber-200">
                             <div className="flex flex-col"><p className="text-[11px] font-black text-amber-600 uppercase italic">Subject Groups</p></div>
                             <span className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800 text-[8px] font-black text-amber-600 uppercase whitespace-nowrap">{asgn.groupPeriods} Periods</span>
                          </div>
                        )}
                     </div>
                  </div>
                ))}
             </div>
           ) : (<div className="py-20 text-center bg-white/40 dark:bg-slate-900/40 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800"><p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">No manual assignments detected</p></div>)}
        </div>
      )}
      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-[#001f3f]/80 backdrop-blur-sm no-pdf">
          <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[2.5rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in duration-300 flex flex-col">
             <div className="pt-8 pb-4 text-center">
                <h4 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-tight">Period Controller</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{editContext.day.toUpperCase()} — {editContext.slot.label.toUpperCase()}</p>
             </div>
             <div className="px-10 pb-8">
               <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-[1.5rem] flex">
                 <button onClick={() => setEntryType('INDIVIDUAL')} className={`flex-1 py-3.5 rounded-[1.25rem] text-[10px] font-black uppercase transition-all duration-300 ${entryType === 'INDIVIDUAL' ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'}`}>Individual</button>
                 <button onClick={() => setEntryType('GROUP')} className={`flex-1 py-3.5 rounded-[1.25rem] text-[10px] font-black uppercase transition-all duration-300 ${entryType === 'GROUP' ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'}`}>Group</button>
               </div>
             </div>
             <div className="px-10 space-y-6 flex-1 min-h-0">
                {entryType === 'INDIVIDUAL' ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-4 font-bold text-xs dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37] transition-all" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                        <option value="">Choose Personnel...</option>
                        {users.filter(u => u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-4 font-bold text-xs dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37] transition-all" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                        <option value="">Choose Division...</option>
                        {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                        <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-4 font-bold text-xs dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37] transition-all" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                          <option value="">Unit...</option>
                          {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Room No</label>
                        <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-4 font-bold text-xs dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37] transition-all" value={manualData.room} onChange={e => setManualData({...manualData, room: e.target.value})}>
                          <option value="">Room...</option>
                          {(config.rooms || []).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Group Period</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-5 font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-[#001f3f] transition-all" value={manualData.blockId} onChange={e => setManualData({...manualData, blockId: e.target.value})}>
                        <option value="">Choose Group...</option>
                        {config.combinedBlocks.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
                      </select>
                    </div>
                  </div>
                )}
             </div>
             <div className="px-10 pb-10 pt-8 space-y-4 flex flex-col items-center">
                <button onClick={handleSaveEntry} disabled={isProcessing} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-[1.25rem] font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-900 transition-all active:scale-95 disabled:opacity-50">{isProcessing ? 'SYNCHRONIZING...' : 'Authorize Entry'}</button>
                <button onClick={handleDecommissionEntry} disabled={isProcessing} className="text-rose-500 font-black text-[10px] uppercase tracking-widest hover:underline disabled:opacity-50">Decommission Period</button>
                <button onClick={() => setShowEditModal(false)} className="text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors">Abort</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;
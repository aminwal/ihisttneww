
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
  const isCloudActive = IS_CLOUD_ENABLED;
  
  const [activeSection, setActiveSection] = useState<SectionType>('PRIMARY');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [viewMode, setViewMode] = useState<'CLASS' | 'TEACHER'>(isManagement ? 'CLASS' : 'TEACHER');
  const [isDesigning, setIsDesigning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [viewDate, setViewDate] = useState<string>(() => new Date().toISOString().split('T')[0]); 
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot, targetId?: string} | null>(null);
  const [entryType, setEntryType] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '', room: '', blockId: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  // Drag and Drop State
  const [draggingEntry, setDraggingEntry] = useState<TimeTableEntry | null>(null);
  const [dragOverPos, setDragOverPos] = useState<{day: string, slotId: number} | null>(null);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Fix: Defined getGradeFromClassName to resolve reference errors on lines 472 and 473
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
    if (selectedClass && viewMode === 'CLASS') {
      const classObj = config.classes.find(c => c.name === selectedClass);
      if (classObj) targetSection = classObj.section;
    }
    return getSlotsForSection(targetSection);
  }, [activeSection, selectedClass, config.classes, viewMode]);

  const selectedTeacherAssignments = useMemo(() => {
    if (viewMode !== 'TEACHER' || !selectedClass) return [];
    return assignments.filter(a => a.teacherId === selectedClass);
  }, [viewMode, selectedClass, assignments]);

  const openEntryModal = (day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
    setEditContext({ day, slot, targetId: entry?.id });
    if (entry) {
      if (entry.blockId) {
        setEntryType('GROUP');
        setManualData({
          teacherId: '',
          subject: '',
          className: entry.className,
          room: '',
          blockId: entry.blockId
        });
      } else {
        setEntryType('INDIVIDUAL');
        setManualData({
          teacherId: entry.teacherId,
          subject: entry.subject,
          className: entry.className,
          room: entry.room || '',
          blockId: ''
        });
      }
    } else {
      setEntryType('INDIVIDUAL');
      setManualData({
        teacherId: viewMode === 'TEACHER' ? selectedClass : '',
        subject: '',
        className: viewMode === 'CLASS' ? selectedClass : '',
        room: '',
        blockId: ''
      });
    }
    setShowEditModal(true);
  };

  // DRAG AND DROP HANDLERS
  const handleDragStart = (e: React.DragEvent, entry: TimeTableEntry) => {
    if (!isDesigning) return;
    setDraggingEntry(entry);
    e.dataTransfer.effectAllowed = "move";
    // Create a ghost image if needed, but default is usually fine
    // e.dataTransfer.setDragImage(canvas, 0, 0);
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

    // Prevent drop on same slot
    if (sourceEntry.day === targetDay && sourceEntry.slotId === targetSlotId) return;

    setIsProcessing(true);
    try {
      if (sourceEntry.blockId) {
        // Move Entire Block
        const block = config.combinedBlocks.find(b => b.id === sourceEntry.blockId);
        if (!block) throw new Error("Registry Error: Source block not found.");

        const affectedEntries = timetable.filter(t => 
          t.blockId === sourceEntry.blockId && 
          t.day === sourceEntry.day && 
          t.slotId === sourceEntry.slotId && 
          (t.date || null) === (sourceEntry.date || null)
        );

        // Validation for each section in block
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

        // Construction of new block entries at target
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
        // Move Individual Entry
        // Teacher conflict check
        const isTeacherBusy = timetable.some(t => 
          t.teacherId === sourceEntry.teacherId && 
          t.day === targetDay && 
          t.slotId === targetSlotId && 
          (t.date || null) === (sourceEntry.date || null) &&
          t.id !== sourceEntry.id
        );

        if (isTeacherBusy) {
           const teacherName = sourceEntry.teacherName.split(' ')[0];
           setStatus({ type: 'error', message: `Conflict: ${teacherName} is already assigned to this slot.` });
           setIsProcessing(false);
           return;
        }

        // Room conflict check
        if (sourceEntry.room) {
          const isRoomBusy = timetable.some(t => 
            t.room === sourceEntry.room && 
            t.day === targetDay && 
            t.slotId === targetSlotId && 
            (t.date || null) === (sourceEntry.date || null) &&
            t.id !== sourceEntry.id
          );
          if (isRoomBusy) {
            setStatus({ type: 'error', message: `Conflict: Room ${sourceEntry.room} is occupied.` });
            setIsProcessing(false);
            return;
          }
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
            subject: newEntry.subject, subject_category: newEntry.subjectCategory, teacher_id: newEntry.teacherId,
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
            id: entry.id,
            section: entry.section,
            class_name: entry.className,
            day: entry.day,
            slot_id: entry.slotId,
            subject: entry.subject,
            subject_category: entry.subjectCategory,
            teacher_id: entry.teacherId,
            teacher_name: entry.teacherName,
            room: entry.room || null,
            date: entry.date || null,
            is_substitution: !!entry.isSubstitution,
            block_id: entry.blockId
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

    if (manualData.room) {
      const roomBusy = timetable.some(t => 
        t.room === manualData.room && 
        t.day === editContext.day && 
        t.slotId === editContext.slot.id && 
        (t.date || null) === (viewDate || null) &&
        t.className !== manualData.className &&
        t.id !== editContext.targetId
      );
      if (roomBusy) {
        setStatus({ type: 'error', message: `Room ${manualData.room} is occupied at this time.` });
        return;
      }
    }

    const entryId = editContext.targetId || (viewDate 
      ? `sub-${manualData.className}-${editContext.day}-${editContext.slot.id}-${Date.now()}`
      : `base-${manualData.className}-${editContext.day}-${editContext.slot.id}`);

    const newEntry: TimeTableEntry = {
      id: entryId,
      section: classObj.section,
      className: manualData.className,
      day: editContext.day,
      slotId: editContext.slot.id,
      subject: manualData.subject,
      subjectCategory: subject.category,
      teacherId: teacher.id,
      teacherName: teacher.name,
      room: manualData.room,
      date: viewDate || undefined,
      isSubstitution: !!viewDate
    };

    setIsProcessing(true);
    if (isCloudActive) {
      const payload = {
        id: String(newEntry.id),
        section: newEntry.section,
        class_name: newEntry.className,
        day: newEntry.day,
        slot_id: newEntry.slotId,
        subject: newEntry.subject,
        subject_category: newEntry.subjectCategory,
        teacher_id: String(newEntry.teacherId),
        teacher_name: newEntry.teacherName,
        room: newEntry.room || null,
        date: newEntry.date || null,
        is_substitution: !!newEntry.isSubstitution
      };

      const { error } = await supabase.from('timetable_entries').upsert(payload, { onConflict: 'id' });
      if (error) {
        setStatus({ type: 'error', message: `Cloud Handshake Failed: ${error.message}` });
        setIsProcessing(false);
        return;
      }
    }

    setTimetable(prev => {
      const filtered = prev.filter(t => t.id !== entryId);
      return [...filtered, newEntry];
    });
    
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Individual Entry Authorized.' });
    setIsProcessing(false);
  };

  const handleDecommissionEntry = async () => {
    if (!editContext) return;
    
    const target = timetable.find(t => 
      t.day === editContext.day && 
      t.slotId === editContext.slot.id && 
      (viewMode === 'CLASS' ? t.className === selectedClass : t.teacherId === selectedClass) && 
      (t.date || null) === (viewDate || null)
    );

    if (!target) {
      setShowEditModal(false);
      return;
    }

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
      const { error } = await supabase
        .from('timetable_entries')
        .delete()
        .in('class_name', siblingNames)
        .is('date', null);
      
      if (error) {
        setStatus({ type: 'error', message: `Cloud Sync Error: ${error.message}` });
        setIsProcessing(false);
        return;
      }
    }

    const siblingNamesSet = new Set(siblingNames);
    let workingTimetable = timetable.filter(t => !siblingNamesSet.has(t.className) || !!t.date);
    const newCloudEntries: any[] = [];

    const perClassPool: Record<string, { subject: string, teacherId: string, teacherName: string, category: SubjectCategory, room?: string }[]> = {};
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
            perClassPool[cls.name].push({ 
              subject: load.subject, 
              teacherId: teacher.id, 
              teacherName: teacher.name, 
              category: sub.category, 
              room: load.room 
            });
          }
        });
      });
    });

    let totalAdded = 0;
    for (const day of DAYS) {
      const sectionSlots = getSlotsForSection(siblingClasses[0].section).filter(s => !s.isBreak);
      
      for (const slot of sectionSlots) {
        if (isSeniorSecondary) {
          const parallelCandidates: Record<string, number> = {};
          let foundParallel = false;
          
          siblingClasses.forEach(cls => {
            const idx = perClassPool[cls.name].findIndex(p => PARALLEL_SUBJECTS.includes(p.subject.toUpperCase()));
            if (idx !== -1) {
              parallelCandidates[cls.name] = idx;
              foundParallel = true;
            }
          });

          if (foundParallel) {
            let slotValidForParallel = true;
            const teachersUsedInThisParallelSlot = new Set<string>();
            const roomsUsedInThisParallelSlot = new Set<string>();

            for (const cls of siblingClasses) {
              const pIdx = parallelCandidates[cls.name];
              if (pIdx !== undefined) {
                const p = perClassPool[cls.name][pIdx];
                const teacherBusy = workingTimetable.some(t => t.teacherId === p.teacherId && t.day === day && t.slotId === slot.id);
                const roomBusy = workingTimetable.some(t => t.room === p.room && t.day === day && t.slotId === slot.id && !!p.room);
                
                if (teacherBusy || teachersUsedInThisParallelSlot.has(p.teacherId) || 
                    roomBusy || (!!p.room && roomsUsedInThisParallelSlot.has(p.room))) {
                  slotValidForParallel = false;
                  break;
                }
                teachersUsedInThisParallelSlot.add(p.teacherId);
                if (p.room) roomsUsedInThisParallelSlot.add(p.room);
              }
            }

            if (slotValidForParallel) {
              for (const cls of siblingClasses) {
                const pIdx = parallelCandidates[cls.name];
                if (pIdx !== undefined) {
                  const period = perClassPool[cls.name].splice(pIdx, 1)[0];
                  const entry: TimeTableEntry = {
                    id: `base-${cls.name}-${day}-${slot.id}`,
                    section: cls.section,
                    className: cls.name,
                    day: day,
                    slotId: slot.id,
                    subject: period.subject,
                    subjectCategory: period.category,
                    teacherId: period.teacherId,
                    teacherName: period.teacherName,
                    room: period.room
                  };
                  workingTimetable.push(entry);
                  newCloudEntries.push({
                    id: String(entry.id),
                    section: entry.section,
                    class_name: entry.className,
                    day: entry.day,
                    slot_id: entry.slotId,
                    subject: entry.subject,
                    subject_category: entry.subjectCategory,
                    teacher_id: String(entry.teacherId),
                    teacher_name: entry.teacherName,
                    room: entry.room || null,
                    date: null,
                    is_substitution: false
                  });
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
            const teacherBusy = workingTimetable.some(t => t.teacherId === p.teacherId && t.day === day && t.slotId === slot.id);
            if (teacherBusy) return false;
            
            const roomBusy = workingTimetable.some(t => t.room === p.room && t.day === day && t.slotId === slot.id && !!p.room);
            if (roomBusy) return false;

            const sameSubToday = workingTimetable.some(t => t.className === cls.name && t.day === day && t.subject === p.subject);
            if (sameSubToday && !isLimitedSubject(p.subject)) return false;
            return true;
          });

          if (validIdx !== -1) {
            const period = pool.splice(validIdx, 1)[0];
            const entry: TimeTableEntry = {
              id: `base-${cls.name}-${day}-${slot.id}`,
              section: cls.section,
              className: cls.name,
              day: day,
              slotId: slot.id,
              subject: period.subject,
              subjectCategory: period.category,
              teacherId: period.teacherId,
              teacherName: period.teacherName,
              room: period.room
            };
            workingTimetable.push(entry);
            newCloudEntries.push({
              id: String(entry.id),
              section: entry.section,
              class_name: entry.className,
              day: entry.day,
              slot_id: entry.slotId,
              subject: entry.subject,
              subject_category: entry.subjectCategory,
              teacher_id: String(entry.teacherId),
              teacher_name: entry.teacherName,
              room: entry.room || null,
              date: null,
              is_substitution: false
            });
            totalAdded++;
          }
        }
      }
    }

    if (isCloudActive && newCloudEntries.length > 0) {
      const { error } = await supabase.from('timetable_entries').upsert(newCloudEntries, { onConflict: 'id' });
      if (error) {
        setStatus({ type: 'error', message: `Sync Failed: ${error.message}` });
        setIsProcessing(false);
        return;
      }
    }

    setTimetable(workingTimetable);
    setStatus({ type: 'success', message: `Matrix Synced: ${totalAdded} periods committed.` });
    setIsProcessing(false);
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER') => {
    if (slot.isBreak || !targetId) return null;
    const isTeacherView = currentViewMode === 'TEACHER';
    
    const allMatching = timetable.filter(t => 
      t.day === day && 
      t.slotId === slot.id && 
      (isTeacherView 
        ? (t.teacherId === targetId || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === targetId)))
        : t.className === targetId)
    );

    let activeEntry = allMatching.find(t => t.date === viewDate && viewDate !== '');
    if (!activeEntry) activeEntry = allMatching.find(t => !t.date);

    if (!activeEntry) {
      const isTargetCell = dragOverPos?.day === day && dragOverPos?.slotId === slot.id;
      return (
        <div 
          onDragOver={(e) => handleDragOver(e, day, slot.id)}
          onDrop={(e) => handleDrop(e, day, slot.id)}
          onClick={() => isDesigning && openEntryModal(day, slot)} 
          className={`h-full border border-slate-100 dark:border-slate-800 rounded-sm flex items-center justify-center transition-all w-full ${
            isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''
          } ${isTargetCell ? 'bg-sky-50/50 border-sky-400 ring-2 ring-sky-300 ring-inset' : ''}`}
        >
          {isDesigning && <span className="text-slate-300 text-lg">+</span>}
        </div>
      );
    }

    const isSub = !!activeEntry.isSubstitution;
    const isBlock = !!activeEntry.blockId;
    
    let displaySubject = activeEntry.subject;
    let displayMeta = isTeacherView ? activeEntry.className : activeEntry.teacherName.split(' ')[0];
    let displayRoom = activeEntry.room;

    if (isBlock && isTeacherView) {
      const block = config.combinedBlocks.find(b => b.id === activeEntry?.blockId);
      const allocation = block?.allocations.find(a => a.teacherId === targetId);
      if (allocation) {
        displaySubject = allocation.subject;
        displayRoom = allocation.room || activeEntry.room;
        const classNames = Array.from(new Set(allMatching.filter(t => t.blockId === activeEntry?.blockId).map(t => t.className))).join(', ');
        displayMeta = classNames;
      }
    }

    const isTargetCell = dragOverPos?.day === day && dragOverPos?.slotId === slot.id;

    return (
      <div 
        draggable={isDesigning}
        onDragStart={(e) => handleDragStart(e, activeEntry!)}
        onDragOver={(e) => handleDragOver(e, day, slot.id)}
        onDrop={(e) => handleDrop(e, day, slot.id)}
        onClick={() => isDesigning && openEntryModal(day, slot, activeEntry)} 
        className={`h-full p-1 border-2 rounded-sm flex flex-col justify-center text-center transition-all w-full relative group ${
          isBlock ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-400 shadow-[inset_0_0_8px_rgba(79,70,229,0.1)]' :
          isSub ? 'bg-amber-50 dark:bg-amber-900/20 border-dashed border-amber-400' : 
          'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
        } ${isDesigning ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400' : ''} ${
          isTargetCell ? 'ring-4 ring-sky-400 scale-[1.05] z-50 shadow-2xl' : ''
        }`}
      >
        {isSub && <div className="absolute top-0 right-0 bg-amber-400 text-[#001f3f] text-[6px] px-1 font-black rounded-bl shadow-sm">SUB</div>}
        {isBlock && <div className="absolute top-0 left-0 bg-indigo-500 text-white text-[6px] px-1 font-black rounded-br shadow-sm">GROUP</div>}
        <p className={`text-[9px] font-black uppercase truncate leading-tight ${isBlock ? 'text-indigo-600' : isSub ? 'text-amber-600' : 'text-sky-600'}`}>
          {displaySubject}
        </p>
        <p className={`text-[8px] font-bold text-[#001f3f] dark:text-white truncate mt-0.5 opacity-80`}>
          {displayMeta}
        </p>
        {displayRoom && <p className="text-[6px] font-black text-slate-400 uppercase tracking-tighter mt-0.5">Rm: {displayRoom}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-in fade-in duration-700 overflow-hidden w-full px-2 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 no-print shrink-0">
        <h1 className="text-xl md:text-2xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Institutional Timetable</h1>
        <div className="flex items-center gap-2">
           {isManagement && (
             <>
               <button 
                 onClick={handleAutoGenerateGrade} 
                 disabled={isProcessing || !selectedClass || viewMode !== 'CLASS'}
                 className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
               >
                 {isProcessing ? 'Synchronizing...' : 'Auto-Fill Grade'}
               </button>
               <button onClick={() => setIsDesigning(!isDesigning)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Exit Designer' : 'Edit Matrix'}</button>
             </>
           )}
           <button onClick={() => window.print()} className="bg-[#001f3f] text-amber-400 px-4 py-2 rounded-xl text-[9px] font-black uppercase border border-amber-400 shadow-xl transition-all hover:scale-105">Print View</button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/20 no-print flex flex-col xl:flex-row items-center gap-4 shrink-0">
           <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800 shadow-sm shrink-0">
              <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class View</button>
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff View</button>
           </div>
           
           <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Schedule Context:</span>
             <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
             {viewDate && <button onClick={() => setViewDate('')} className="text-[8px] font-black text-rose-500 uppercase hover:underline">Reset to Base</button>}
             {!viewDate && <span className="text-[8px] font-black text-emerald-500 uppercase">Base Matrix Active</span>}
           </div>

           <select className="bg-white dark:bg-slate-900 px-5 py-2.5 rounded-xl border-2 border-slate-100 dark:border-slate-800 text-[11px] font-black uppercase flex-1 min-w-[200px] outline-none focus:border-amber-400 transition-all dark:text-white" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
             <option value="">Select Targeted Entity...</option>
             {viewMode === 'CLASS' ? config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : users.filter(u => u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
           </select>

           {status && (
             <div className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all animate-in slide-in-from-left duration-300 ${status.type === 'error' ? 'text-red-500 bg-red-50 border border-red-100' : status.type === 'warning' ? 'text-amber-600 bg-amber-50 border border-amber-100' : 'text-emerald-600 bg-emerald-50 border border-emerald-100'}`}>
               {status.message}
             </div>
           )}
        </div>
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full h-full border-collapse table-fixed min-w-[900px]">
            <thead className="bg-[#00122b] sticky top-0 z-10">
              <tr className="h-12">
                <th className="w-20 border border-white/5 text-[9px] font-black text-amber-500 uppercase tracking-widest italic">Day</th>
                {slots.map(s => <th key={s.id} className="text-white text-[9px] font-black uppercase border border-white/5 bg-[#001f3f]/50">
                  {s.label.replace('Period ', 'P')}
                  <div className="text-[7px] opacity-40 font-bold tracking-tight mt-0.5">{s.startTime} - {s.endTime}</div>
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/20">
              {DAYS.map((day, idx) => (
                <tr key={day} className="h-20 hover:bg-slate-50/30 transition-colors">
                  <td className="bg-[#00122b] text-white font-black text-center text-[10px] uppercase border border-white/5 tracking-tighter italic">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td 
                      key={s.id} 
                      className={`border border-slate-100 dark:border-slate-800/10 p-0.5 relative ${s.isBreak ? 'bg-amber-50/10' : ''}`}
                    >
                      {s.isBreak ? (
                        <div className="flex items-center justify-center h-full">
                           <span className="text-amber-500/30 font-black text-[9px] tracking-[0.4em] uppercase rotate-90 md:rotate-0">RECESS</span>
                        </div>
                      ) : renderGridCell(day, s, idx, selectedClass, viewMode)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewMode === 'TEACHER' && selectedClass && (
        <div className="bg-slate-50/50 dark:bg-slate-800/20 rounded-[2.5rem] p-8 border border-slate-100 dark:border-slate-800/50 animate-in slide-in-from-bottom-4 duration-500">
           <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs shadow-lg">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                 </div>
                 <div>
                    <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest">Faculty Load Registry</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Manual subject assignments for the selected personnel</p>
                 </div>
              </div>
              <div className="bg-white dark:bg-slate-900 px-6 py-3 rounded-2xl border shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Weekly Scheduled Intensity</p>
                <div className="flex items-center gap-3">
                   <div className="h-2.5 w-32 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${Math.min(100, (timetable.filter(t => (t.teacherId === selectedClass || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === selectedClass))) && !t.isBreak).length / 30) * 100)}%` }} 
                        className="h-full bg-[#001f3f] dark:bg-[#d4af37]"
                      ></div>
                   </div>
                   <span className="text-[11px] font-black text-[#001f3f] dark:text-white">{timetable.filter(t => (t.teacherId === selectedClass || (t.blockId && config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === selectedClass))) && !t.isBreak).length} / 30P</span>
                </div>
              </div>
           </div>

           {selectedTeacherAssignments.length > 0 ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {selectedTeacherAssignments.map(asgn => (
                  <div key={asgn.id} className="bg-white dark:bg-slate-950 p-6 rounded-[2rem] border-2 border-slate-50 dark:border-slate-800 shadow-xl relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-4 opacity-5 transform group-hover:scale-110 transition-transform">
                        <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                     </div>
                     <p className="text-[10px] font-black text-[#d4af37] uppercase tracking-widest italic mb-4">{asgn.grade}</p>
                     <div className="space-y-4">
                        {asgn.loads.map((load, idx) => (
                          <div key={idx} className="flex justify-between items-start border-b border-slate-50 dark:border-slate-900 pb-3 last:border-0 last:pb-0">
                             <div className="space-y-1">
                                <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase truncate max-w-[140px]">{load.subject}</p>
                                {load.room && <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Base Room: {load.room}</p>}
                             </div>
                             <span className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-[8px] font-black text-slate-600 dark:text-slate-400 uppercase whitespace-nowrap">{load.periods} Periods</span>
                          </div>
                        ))}
                     </div>
                  </div>
                ))}
             </div>
           ) : (
             <div className="py-20 text-center bg-white/40 dark:bg-slate-900/40 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">No manual assignments detected for this personnel</p>
             </div>
           )}
        </div>
      )}

      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-[#001f3f]/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[2.5rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in duration-300 flex flex-col">
             
             {/* Modal Header */}
             <div className="pt-8 pb-4 text-center">
                <h4 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-tight">Period Controller</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  {editContext.day.toUpperCase()} — {editContext.slot.label.toUpperCase()}
                </p>
             </div>

             {/* Functional Tabs */}
             <div className="px-10 pb-8">
               <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-[1.5rem] flex">
                 <button 
                   onClick={() => setEntryType('INDIVIDUAL')}
                   className={`flex-1 py-3.5 rounded-[1.25rem] text-[10px] font-black uppercase transition-all duration-300 ${
                     entryType === 'INDIVIDUAL' ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'
                   }`}
                 >
                   Individual
                 </button>
                 <button 
                   onClick={() => setEntryType('GROUP')}
                   className={`flex-1 py-3.5 rounded-[1.25rem] text-[10px] font-black uppercase transition-all duration-300 ${
                     entryType === 'GROUP' ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'
                   }`}
                 >
                   Group Period
                 </button>
               </div>
             </div>

             {/* Content Area */}
             <div className="px-10 space-y-6 flex-1 min-h-0">
                {entryType === 'INDIVIDUAL' ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Division</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-4 font-bold text-xs dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37] transition-all" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                        <option value="">Choose Personnel...</option>
                        {users.filter(u => u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class/Section</label>
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
                      <select 
                        className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-[1.25rem] px-5 py-5 font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-[#001f3f] transition-all"
                        value={manualData.blockId}
                        onChange={e => setManualData({...manualData, blockId: e.target.value})}
                      >
                        <option value="">Choose Group...</option>
                        {config.combinedBlocks.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[7px] text-slate-400 font-bold uppercase tracking-tight leading-relaxed px-1">
                      * This will deploy entries for all sections in the group simultaneously.
                    </p>
                  </div>
                )}
             </div>

             {/* Action Buttons */}
             <div className="px-10 pb-10 pt-8 space-y-4 flex flex-col items-center">
                <button 
                  onClick={handleSaveEntry} 
                  disabled={isProcessing}
                  className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-[1.25rem] font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-900 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? 'SYNCHRONIZING...' : 'Authorize Entry'}
                </button>
                
                <button 
                  onClick={handleDecommissionEntry} 
                  disabled={isProcessing}
                  className="text-rose-500 font-black text-[10px] uppercase tracking-widest hover:underline disabled:opacity-50"
                >
                  Decommission Period
                </button>
                
                <button 
                  onClick={() => setShowEditModal(false)} 
                  className="text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors"
                >
                  Abort Process
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
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
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [viewMode, setViewMode] = useState<'CLASS' | 'TEACHER' | 'ROOM'>(() => {
    if (user.role.startsWith('TEACHER_')) return 'TEACHER';
    return 'CLASS';
  });
  const [isDesigning, setIsDesigning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  
  const [viewDate, setViewDate] = useState<string>(() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }); 
  
  const [activeDay, setActiveDay] = useState<string>(() => {
    const currentDayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date());
    const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
    return validDays.includes(currentDayName) ? currentDayName : 'Sunday';
  });

  // Sync activeDay with viewDate for mobile users
  useEffect(() => {
    if (viewDate) {
      const [year, month, day] = viewDate.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
      if (validDays.includes(dayName)) {
        setActiveDay(dayName);
      }
    }
  }, [viewDate]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot, targetId?: string} | null>(null);
  const [entryType, setEntryType] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '', room: '', blockId: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info', message: string } | null>(null);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  /**
   * Helper to check if a class falls under the I-X rule
   */
  const isGradeItoX = useCallback((className: string) => {
    if (!className) return false;
    const match = className.match(/^(I|II|III|IV|V|VI|VII|VIII|IX|X)\b/i);
    return !!match;
  }, []);

  /**
   * Helper to get implicit Class Teacher duty for Period 1
   */
  const getImplicitEntry = useCallback((day: string, slotId: number, targetId: string, currentViewMode: string): Partial<TimeTableEntry> | null => {
    if (slotId !== 1) return null;

    const normTarget = targetId.toLowerCase().trim();

    if (currentViewMode === 'CLASS') {
      if (!isGradeItoX(targetId)) return null;
      const classTeacher = users.find(u => u.classTeacherOf?.toLowerCase().trim() === normTarget);
      if (!classTeacher) return null;
      
      const romanMatch = targetId.match(/[IVX]+/);
      const gradePrefix = romanMatch ? `Grade ${romanMatch[0]}` : targetId;
      const asgn = assignments.find(a => a.teacherId === classTeacher.id && a.grade === gradePrefix);
      const assignedSubject = asgn?.loads?.[0]?.subject || 'CLASS TEACHER P1';

      return {
        subject: assignedSubject,
        teacherName: classTeacher.name,
        teacherId: classTeacher.id,
        className: targetId,
        isSubstitution: false
      };
    } else if (currentViewMode === 'TEACHER') {
      const teacher = users.find(u => u.id.toLowerCase().trim() === normTarget);
      if (!teacher || !teacher.classTeacherOf || !isGradeItoX(teacher.classTeacherOf)) return null;
      
      const romanMatch = teacher.classTeacherOf.match(/[IVX]+/);
      const gradePrefix = romanMatch ? `Grade ${romanMatch[0]}` : teacher.classTeacherOf;
      const asgn = assignments.find(a => a.teacherId === teacher.id && a.grade === gradePrefix);
      const assignedSubject = asgn?.loads?.[0]?.subject || 'CLASS TEACHER P1';

      return {
        subject: assignedSubject,
        teacherName: teacher.name,
        teacherId: teacher.id,
        className: teacher.classTeacherOf,
        isSubstitution: false
      };
    }
    return null;
  }, [users, assignments, isGradeItoX]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    for (const entry of timetable) {
      const effectiveSlotId = (entry as any).slotId ?? (entry as any).slot_id;
      if (effectiveSlotId === undefined || effectiveSlotId === null) continue;
      
      const key = `${entry.day}-${effectiveSlotId}`;
      if (!registry.has(key)) { registry.set(key, [entry]); } 
      else { registry.get(key)!.push(entry); }
    }
    return registry;
  }, [timetable]);

  const filteredEntities = useMemo(() => {
    if (viewMode === 'CLASS') {
      if (isAdmin) return config.classes.map(c => ({ id: c.name, name: c.name }));
      if (user.role === UserRole.INCHARGE_PRIMARY) return config.classes.filter(c => c.section === 'PRIMARY').map(c => ({ id: c.name, name: c.name }));
      if (user.role === UserRole.INCHARGE_SECONDARY) return config.classes.filter(c => c.section !== 'PRIMARY').map(c => ({ id: c.name, name: c.name }));
      return config.classes.filter(c => c.name === user.classTeacherOf).map(c => ({ id: c.name, name: c.name }));
    } else if (viewMode === 'TEACHER') {
      return users.filter(u => !u.isResigned).map(u => ({ id: u.id, name: u.name }));
    } else {
      return (config.rooms || []).map(r => ({ id: r, name: r }));
    }
  }, [viewMode, config, users, user, isAdmin]);

  const canViewClassTab = isAdmin || user.role.startsWith('INCHARGE_') || !!user.classTeacherOf;

  useEffect(() => {
    if (viewMode === 'TEACHER' && !selectedTarget) {
      setSelectedTarget(user.id);
    } else if (viewMode === 'CLASS' && !selectedTarget && filteredEntities.length > 0) {
      if (user.role.startsWith('TEACHER_')) {
        setSelectedTarget(user.classTeacherOf || '');
      }
    }
  }, [viewMode, user, filteredEntities, selectedTarget]);

  function getSlotsForSection(section: SectionType) {
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section === 'SECONDARY_GIRLS' || section === 'SENIOR_SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }

  const slots = useMemo(() => {
    let targetSection = activeSection;
    let isPrimaryContext = false;
    if (selectedTarget) {
      if (viewMode === 'CLASS') {
        const classObj = config.classes.find(c => c.name === selectedTarget);
        if (classObj) targetSection = classObj.section;
      } else if (viewMode === 'TEACHER') {
        const teacher = users.find(u => u.id.toLowerCase() === selectedTarget.toLowerCase());
        if (teacher) {
          if (teacher.role.includes('PRIMARY') || teacher.secondaryRoles?.some(r => r.includes('PRIMARY'))) { 
            targetSection = 'PRIMARY'; 
            isPrimaryContext = true; 
          } else { 
            targetSection = 'SECONDARY_BOYS'; 
          }
        }
      }
    }
    const allSlots = getSlotsForSection(targetSection);
    if (((viewMode === 'TEACHER' && !isPrimaryContext) || viewMode === 'ROOM')) {
      return allSlots.filter(s => !s.isBreak);
    }
    return allSlots;
  }, [activeSection, selectedTarget, config.classes, viewMode, users]);

  const handleDragStart = (e: React.DragEvent, entryId: string) => {
    if (!isDesigning) return;
    setDraggedEntryId(entryId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDesigning) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  /**
   * REFINED: Multi-Entity Collision Engine
   * Handles Individual vs Individual, Individual vs Group, and Group vs Group.
   */
  const checkStaffCollision = (targetSlotEntries: TimeTableEntry[], movingTeacherId: string, movingBlockId?: string, excludeEntryId?: string) => {
    const normMovingTeacher = movingTeacherId.toLowerCase().trim();
    const normMovingBlock = movingBlockId?.toLowerCase().trim();
    
    // If moving a block, we need its full roster for roster-level intersection checks
    const movingBlockObj = normMovingBlock ? config.combinedBlocks.find(b => b.id.toLowerCase().trim() === normMovingBlock) : null;

    return targetSlotEntries.find(existing => {
      // Ignore current entry being moved and daily substitutions
      if (existing.id === excludeEntryId || existing.date) return false;
      
      const existingTId = (existing.teacherId || (existing as any).teacher_id || "").toLowerCase().trim();
      const existingBlockId = (existing.blockId || "").toLowerCase().trim();

      // CASE A: EXISTING IS INDIVIDUAL
      if (!existingBlockId || existingTId !== 'block_resource') {
        // 1. Moving Individual vs Existing Individual
        if (!normMovingBlock) {
          return existingTId === normMovingTeacher;
        }
        // 2. Moving Block vs Existing Individual
        if (movingBlockObj) {
          return movingBlockObj.allocations.some(a => a.teacherId.toLowerCase().trim() === existingTId);
        }
      }

      // CASE B: EXISTING IS A BLOCK
      if (existingBlockId) {
        const existingBlockObj = config.combinedBlocks.find(b => b.id.toLowerCase().trim() === existingBlockId);
        if (!existingBlockObj) return false;

        // 1. Moving Individual vs Existing Block
        if (!normMovingBlock) {
          return existingBlockObj.allocations.some(a => a.teacherId.toLowerCase().trim() === normMovingTeacher);
        }
        // 2. Moving Block vs Existing Block
        if (movingBlockObj) {
          // Check for intersection of the two rosters
          return movingBlockObj.allocations.some(ma => 
            existingBlockObj.allocations.some(ea => ea.teacherId.toLowerCase().trim() === ma.teacherId.toLowerCase().trim())
          );
        }
      }

      return false;
    });
  };

  /**
   * Institutional Rule: Cannot have more than 2 same periods on trot for any class.
   */
  const checkConsecutiveViolation = (day: string, slotId: number, className: string, subject: string, excludeId?: string, tempEntries: TimeTableEntry[] = []) => {
    const normClass = className.toLowerCase().trim();
    const normSubject = subject.toLowerCase().trim();
    
    // Combine existing timetable with temporary entries being generated by autofill
    const classEntries = [
      ...timetable.filter(t => t.day === day && t.className.toLowerCase().trim() === normClass && t.id !== excludeId && !t.date),
      ...tempEntries.filter(t => t.day === day && t.className.toLowerCase().trim() === normClass && t.id !== excludeId)
    ];

    const getSubjectAt = (sid: number) => {
      const entry = classEntries.find(t => t.slotId === sid);
      return entry?.subject.toLowerCase().trim();
    };

    // Check pattern: [S-2, S-1, CURRENT]
    if (getSubjectAt(slotId - 1) === normSubject && getSubjectAt(slotId - 2) === normSubject) return true;
    // Check pattern: [S-1, CURRENT, S+1]
    if (getSubjectAt(slotId - 1) === normSubject && getSubjectAt(slotId + 1) === normSubject) return true;
    // Check pattern: [CURRENT, S+1, S+2]
    if (getSubjectAt(slotId + 1) === normSubject && getSubjectAt(slotId + 2) === normSubject) return true;

    return false;
  };

  const handleDrop = async (e: React.DragEvent, day: string, slotId: number) => {
    if (!isDesigning || !draggedEntryId) return;
    e.preventDefault();
    
    const entry = timetable.find(t => t.id === draggedEntryId);
    if (!entry || (entry.day === day && entry.slotId === slotId)) return;

    setIsProcessing(true);
    try {
      const targetKey = `${day}-${slotId}`;
      const existingInSlot = cellRegistry.get(targetKey) || [];
      
      // 1. Check Pedagogical Violation (3-in-a-row)
      if (checkConsecutiveViolation(day, slotId, entry.className, entry.subject, entry.id)) {
        throw new Error(`Pedagogical Violation: ${entry.className} cannot have more than 2 consecutive periods of ${entry.subject}.`);
      }

      // 2. Check Staff Collision (REFINED)
      const staffConflict = checkStaffCollision(existingInSlot, entry.teacherId, entry.blockId, entry.id);
      if (staffConflict) throw new Error(`Staff Collision: One or more involved faculty members are busy in ${staffConflict.className}.`);

      // 3. Check Class Collision
      const classConflict = existingInSlot.find(t => t.className.toLowerCase().trim() === entry.className.toLowerCase().trim() && t.id !== entry.id && !t.date);
      if (classConflict) throw new Error(`Class Collision: ${entry.className} already has ${classConflict.subject}.`);

      // 4. Check Room Collision
      if (entry.room) {
        const normalizedEntryRooms = entry.room.toLowerCase().split(',').map(r => r.trim());
        const roomConflict = existingInSlot.find(t => {
           if (t.id === entry.id || t.date) return false;
           const existingRooms = (t.room || "").toLowerCase().split(',').map(r => r.trim());
           return normalizedEntryRooms.some(nr => existingRooms.includes(nr));
        });
        if (roomConflict) throw new Error(`Room Conflict: One or more rooms in ${entry.room} are occupied by ${roomConflict.className}.`);
      }

      // 5. Check Implicit P1 Duty
      if (entry.teacherId && entry.teacherId !== 'BLOCK_RESOURCE') {
         const implicitDuty = getImplicitEntry(day, slotId, entry.teacherId, 'TEACHER');
         if (implicitDuty && implicitDuty.className?.toLowerCase().trim() !== entry.className.toLowerCase().trim()) {
           throw new Error(`Institutional Conflict: Class Teacher Duty in ${implicitDuty.className} during P1.`);
         }
      }

      const updatedEntry = { ...entry, day, slotId };
      if (isCloudActive) {
        const { error } = await supabase.from('timetable_entries').update({ day, slot_id: slotId }).eq('id', entry.id);
        if (error) throw error;
      }

      setTimetable(prev => prev.map(t => t.id === entry.id ? updatedEntry : t));
      setStatus({ type: 'success', message: 'Matrix Adjusted Successfully.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Operation Blocked.' });
    } finally {
      setIsProcessing(false);
      setDraggedEntryId(null);
    }
  };

  const handleSaveEntry = async () => {
    if (!editContext) return;
    setIsProcessing(true);
    try {
      const key = `${editContext.day}-${editContext.slot.id}`;
      const existingInSlot = cellRegistry.get(key) || [];

      if (entryType === 'GROUP') {
        const block = config.combinedBlocks.find(b => b.id === manualData.blockId);
        if (!block) throw new Error("Select Group.");

        // Pedagogical Violation Check for Subject Group
        for (const sectionName of block.sectionNames) {
          if (checkConsecutiveViolation(editContext.day, editContext.slot.id, sectionName, block.heading, editContext.targetId)) {
            throw new Error(`Pedagogical Violation: ${sectionName} cannot have more than 2 consecutive periods of ${block.heading}.`);
          }
        }

        // Collision Check for Subject Group
        for (const sectionName of block.sectionNames) {
          const normSect = sectionName.toLowerCase().trim();
          const classConflict = existingInSlot.find(t => t.className.toLowerCase().trim() === normSect && t.blockId !== block.id && !t.date);
          if (classConflict) throw new Error(`Class Collision: ${sectionName} already has ${classConflict.subject} scheduled.`);
        }

        // Staff Integrity Check (for every teacher in the block)
        for (const alloc of block.allocations) {
          const teacherConflict = checkStaffCollision(existingInSlot, alloc.teacherId, block.id, editContext.targetId);
          if (teacherConflict) {
            const teacher = users.find(u => u.id === alloc.teacherId);
            throw new Error(`Staff Conflict: ${teacher?.name || 'Faculty'} is busy in ${teacherConflict.className}.`);
          }

          const implicitDuty = getImplicitEntry(editContext.day, editContext.slot.id, alloc.teacherId, 'TEACHER');
          if (implicitDuty && !block.sectionNames.some(sn => sn.toLowerCase().trim() === implicitDuty.className?.toLowerCase().trim())) {
             throw new Error(`Institutional Conflict: ${alloc.teacherName} is busy in ${implicitDuty.className} (Implicit P1 Duty).`);
          }
        }

        const newEntries: TimeTableEntry[] = [];
        const cloudEntries: any[] = [];
        for (const sectionName of block.sectionNames) {
          const classObj = config.classes.find(c => c.name === sectionName);
          if (!classObj) continue;
          const entryId = `block-${block.id}-${sectionName}-${editContext.day}-${editContext.slot.id}`;
          const entry: TimeTableEntry = { 
            id: entryId, section: classObj.section, className: sectionName, day: editContext.day, 
            slotId: editContext.slot.id, subject: block.heading, subjectCategory: SubjectCategory.CORE, 
            teacherId: 'BLOCK_RESOURCE', teacherName: 'Group Period', 
            room: block.allocations.map(a => a.room).filter(Boolean).join(', '), 
            blockId: block.id, blockName: block.title 
          };
          newEntries.push(entry);
          if (isCloudActive) cloudEntries.push({ 
            id: entry.id, section: entry.section, class_name: entry.className, day: entry.day, 
            slot_id: entry.slotId, subject: entry.subject, subject_category: entry.subjectCategory, 
            teacher_id: entry.teacherId, teacher_name: entry.teacherName, room: entry.room || null, 
            block_id: entry.blockId, block_name: entry.blockName 
          });
        }
        if (isCloudActive) await supabase.from('timetable_entries').upsert(cloudEntries);
        setTimetable(prev => {
          const ids = new Set(newEntries.map(e => e.id));
          return [...prev.filter(t => !ids.has(t.id)), ...newEntries];
        });
      } else {
        const teacher = users.find(u => u.id === manualData.teacherId);
        const classObj = config.classes.find(c => c.name === manualData.className);
        const subject = config.subjects.find(s => s.name === manualData.subject);
        if (!teacher || !classObj || !subject) throw new Error("Missing entities.");

        // Pedagogical Violation Check (only for base timetable, not daily substitutions)
        if (!viewDate && checkConsecutiveViolation(editContext.day, editContext.slot.id, manualData.className, manualData.subject, editContext.targetId)) {
          throw new Error(`Pedagogical Violation: ${manualData.className} cannot have more than 2 consecutive periods of ${manualData.subject}.`);
        }

        const tConflict = checkStaffCollision(existingInSlot, teacher.id, undefined, editContext.targetId);
        if (tConflict) throw new Error(`Staff Collision: ${teacher.name} is busy in ${tConflict.className}.`);

        const cConflict = existingInSlot.find(t => t.className.toLowerCase().trim() === classObj.name.toLowerCase().trim() && t.id !== editContext.targetId && !t.date);
        if (cConflict) throw new Error(`Class Collision: ${classObj.name} already has ${cConflict.subject}.`);

        const implicitDuty = getImplicitEntry(editContext.day, editContext.slot.id, teacher.id, 'TEACHER');
        if (implicitDuty && implicitDuty.className?.toLowerCase().trim() !== classObj.name.toLowerCase().trim()) {
           throw new Error(`Institutional Conflict: ${teacher.name} has Class Teacher duty in ${implicitDuty.className}.`);
        }

        const entryId = editContext.targetId || `base-${manualData.className}-${editContext.day}-${editContext.slot.id}`;
        const newEntry: TimeTableEntry = { 
          id: entryId, section: classObj.section, className: manualData.className, 
          day: editContext.day, slotId: editContext.slot.id, subject: manualData.subject, 
          subjectCategory: subject.category, teacherId: teacher.id, teacherName: teacher.name, 
          room: manualData.room, date: viewDate || undefined, isSubstitution: !!viewDate 
        };
        if (isCloudActive) await supabase.from('timetable_entries').upsert({ 
          id: String(newEntry.id), section: newEntry.section, class_name: newEntry.className, 
          day: newEntry.day, slot_id: newEntry.slotId, subject: newEntry.subject, 
          subject_category: newEntry.subjectCategory, teacher_id: String(newEntry.teacherId), 
          teacher_name: newEntry.teacherName, room: newEntry.room || null, 
          date: newEntry.date || null, is_substitution: !!newEntry.isSubstitution 
        });
        setTimetable(prev => [...prev.filter(t => t.id !== entryId), newEntry]);
      }
      setShowEditModal(false);
      setStatus({ type: 'success', message: 'Registry updated.' });
    } catch (err: any) { setStatus({ type: 'error', message: err.message }); }
    finally { setIsProcessing(false); }
  };

  const handleDeleteEntry = async () => {
    if (!editContext?.targetId) return;
    if (!confirm("Are you sure you want to remove this entry?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive) await supabase.from('timetable_entries').delete().eq('id', editContext.targetId);
      setTimetable(prev => prev.filter(t => t.id !== editContext.targetId));
      setShowEditModal(false);
      setStatus({ type: 'success', message: 'Purged Successfully.' });
    } catch (err: any) { setStatus({ type: 'error', message: err.message }); }
    finally { setIsProcessing(false); }
  };

  const handleAutoFill = async () => {
    if (viewMode !== 'CLASS' || !selectedTarget) return;
    const classObj = config.classes.find(c => c.name === selectedTarget);
    if (!classObj) return;
    setIsProcessing(true);
    try {
      // 1. Prepare local deep copy of assignments for this class
      const localAssignments = JSON.parse(JSON.stringify(assignments.filter(a => 
        a.targetSections ? a.targetSections.includes(selectedTarget) : a.grade.includes(selectedTarget.split(' ')[0])
      )));

      // 2. Pre-calculate Fair Distribution Caps for each subject
      const subjectCaps = new Map<string, number>();
      localAssignments.forEach((asgn: TeacherAssignment) => {
        asgn.loads.forEach(l => {
          const cap = Math.ceil(l.periods / 5);
          subjectCaps.set(`${asgn.teacherId}-${l.subject}`, cap);
        });
      });

      const newEntries: TimeTableEntry[] = [];
      const cloudEntries: any[] = [];
      const currentSlots = getSlotsForSection(classObj.section).filter(s => !s.isBreak);
      
      const dailyUsage = new Map<string, number>(); // key: "day-teacherId-subject"

      // 3. Iterative Strategy: Iterate by SLOTS then by DAYS to ensure horizontal distribution
      for (const slot of currentSlots) {
        for (const day of DAYS) {
          const key = `${day}-${slot.id}`;
          
          const existing = (cellRegistry.get(key) || []).find(t => t.className.toLowerCase().trim() === selectedTarget.toLowerCase().trim() && !t.date);
          if (existing) continue;

          const potentialLoad = localAssignments.find((asgn: TeacherAssignment) => {
            const currentSubjLoad = asgn.loads.find(l => l.periods > 0);
            if (!currentSubjLoad) return false;

            const usageKey = `${day}-${asgn.teacherId}-${currentSubjLoad.subject}`;
            const currentDayCount = dailyUsage.get(usageKey) || 0;
            const maxAllowed = subjectCaps.get(`${asgn.teacherId}-${currentSubjLoad.subject}`) || 1;

            if (currentDayCount >= maxAllowed) return false;

            const isBusy = (cellRegistry.get(key) || []).some(t => {
              if (t.blockId) return config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId.toLowerCase().trim() === asgn.teacherId.toLowerCase().trim());
              return (t.teacherId || (t as any).teacher_id || "").toLowerCase().trim() === asgn.teacherId.toLowerCase().trim();
            });
            if (isBusy) return false;

            if (checkConsecutiveViolation(day, slot.id, selectedTarget, currentSubjLoad.subject, undefined, newEntries)) return false;

            return true;
          });

          if (potentialLoad) {
            const loadItem = potentialLoad.loads.find(l => l.periods > 0)!;
            const teacher = users.find(u => u.id === potentialLoad.teacherId)!;
            const entryId = `base-${selectedTarget}-${day}-${slot.id}`;
            const newEntry: TimeTableEntry = {
              id: entryId, section: classObj.section, className: selectedTarget,
              day, slotId: slot.id, subject: loadItem.subject, subjectCategory: SubjectCategory.CORE, 
              teacherId: teacher.id, teacherName: teacher.name, room: loadItem.room || selectedTarget
            };
            
            newEntries.push(newEntry);
            if (isCloudActive) cloudEntries.push({
              id: entryId, section: newEntry.section, class_name: newEntry.className,
              day: newEntry.day, slot_id: newEntry.slotId, subject: newEntry.subject, 
              subject_category: newEntry.subjectCategory, teacher_id: newEntry.teacherId,
              teacher_name: newEntry.teacherName, room: newEntry.room || null
            });

            loadItem.periods--;
            const usageKey = `${day}-${potentialLoad.teacherId}-${loadItem.subject}`;
            dailyUsage.set(usageKey, (dailyUsage.get(usageKey) || 0) + 1);
          }
        }
      }

      if (newEntries.length > 0) {
        if (isCloudActive) await supabase.from('timetable_entries').upsert(cloudEntries);
        setTimetable(prev => [...prev, ...newEntries]);
        setStatus({ type: 'success', message: `Deployed ${newEntries.length} periods with weekly distribution.` });
      } else {
        setStatus({ type: 'info', message: 'No slots available for distribution.' });
      }
    } catch (err: any) { setStatus({ type: 'error', message: err.message }); }
    finally { setIsProcessing(false); }
  };

  const openEntryModal = useCallback((day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
    setEditContext({ day, slot, targetId: entry?.id });
    if (entry) {
      if (entry.blockId) {
        setEntryType('GROUP');
        setManualData({ teacherId: '', subject: '', className: entry.className, room: entry.room || '', blockId: entry.blockId });
      } else {
        setEntryType('INDIVIDUAL');
        const tId = entry.teacherId || (entry as any).teacher_id;
        setManualData({ teacherId: tId, subject: entry.subject, className: entry.className, room: entry.room || '', blockId: '' });
      }
    } else {
      setEntryType('INDIVIDUAL');
      setManualData({
        teacherId: viewMode === 'TEACHER' ? selectedTarget : '',
        subject: '',
        className: viewMode === 'CLASS' ? selectedTarget : '',
        room: viewMode === 'ROOM' ? selectedTarget : '',
        blockId: ''
      });
    }
    setShowEditModal(true);
  }, [viewMode, selectedTarget]);

  const renderGridCell = (day: string, slot: TimeSlot, targetId: string, currentViewMode: 'CLASS' | 'TEACHER' | 'ROOM') => {
    if (slot.isBreak || !targetId) return null;
    const key = `${day}-${slot.id}`;
    const dayEntries = cellRegistry.get(key) || [];
    
    const candidates = dayEntries.filter(t => {
      const normTarget = targetId.toLowerCase().trim();
      if (currentViewMode === 'CLASS') return t.className.toLowerCase().trim() === normTarget;
      if (currentViewMode === 'ROOM') return (t.room || "").toLowerCase().trim().split(',').map(r => r.trim()).includes(normTarget);
      if (currentViewMode === 'TEACHER') {
        const tId = (t.teacherId || (t as any).teacher_id || "").toLowerCase().trim();
        if (tId === normTarget) return true;
        if (t.blockId) return config.combinedBlocks.find(b => b.id.toLowerCase().trim() === t.blockId.toLowerCase().trim())?.allocations.some(a => a.teacherId.toLowerCase().trim() === normTarget);
      }
      return false;
    });

    let activeEntry = candidates.find(t => t.date === viewDate && viewDate !== '');
    if (!activeEntry) activeEntry = candidates.find(t => !t.date); 

    let isImplicit = false;
    if (!activeEntry) {
      const implicit = getImplicitEntry(day, slot.id, targetId, currentViewMode);
      if (implicit) {
        activeEntry = { ...implicit, id: `implicit-${targetId}-${day}-${slot.id}`, day, slotId: slot.id, section: 'PRIMARY', subjectCategory: SubjectCategory.CORE } as TimeTableEntry;
        isImplicit = true;
      }
    }

    if (!activeEntry) {
      return (
        <div onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800 rounded-sm flex items-center justify-center transition-all w-full min-h-[60px] ${isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
          {isDesigning && <span className="text-slate-300 text-lg">+</span>}
        </div>
      );
    }

    const isSub = !!activeEntry.isSubstitution || !!activeEntry.date;
    const isBlock = !!activeEntry.blockId;
    let displaySubject = activeEntry.subject;
    let displayMeta = activeEntry.teacherName ? activeEntry.teacherName.split(' ')[0] : 'N/A';
    let displaySubMeta = activeEntry.className;

    if (currentViewMode === 'TEACHER') displayMeta = activeEntry.className;
    else if (currentViewMode === 'ROOM') displayMeta = `${activeEntry.className} • ${displayMeta}`;

    return (
      <div 
        draggable={isDesigning && !isImplicit}
        onDragStart={(e) => handleDragStart(e, activeEntry!.id)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, day, slot.id)}
        onClick={() => isDesigning && openEntryModal(day, slot, isImplicit ? undefined : activeEntry)} 
        className={`h-full p-2 border-2 rounded-lg flex flex-col justify-center text-center transition-all w-full relative group shadow-sm min-h-[80px] ${isImplicit ? 'bg-slate-50/50 dark:bg-slate-800/30 border-dashed border-slate-200 opacity-80' : isBlock ? 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-400' : isSub ? 'bg-amber-50 dark:bg-amber-900/40 border-dashed border-amber-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'} ${isDesigning && !isImplicit ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400' : ''} ${draggedEntryId === activeEntry.id ? 'opacity-40 grayscale scale-95' : ''}`}
      >
        {isSub && <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] px-1.5 py-0.5 font-black rounded-bl-lg shadow-sm">SUB</div>}
        {isBlock && <div className="absolute top-0 left-0 bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 font-black rounded-br-lg shadow-sm">GRP</div>}
        {isImplicit && <div className="absolute top-0 left-0 bg-[#001f3f] text-[#d4af37] text-[8px] px-1.5 py-0.5 font-black rounded-br-lg shadow-sm">CT</div>}
        <p className={`text-[11px] font-black uppercase leading-tight tracking-tight ${isImplicit ? 'text-slate-400' : isBlock ? 'text-indigo-700' : isSub ? 'text-amber-700' : 'text-sky-700'}`}>{displaySubject}</p>
        <p className="text-[10px] font-bold text-slate-800 dark:text-slate-100 truncate mt-1">{displayMeta}</p>
        <p className="text-[9px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5 italic">{displaySubMeta}</p>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-screen space-y-4 animate-in fade-in duration-700 w-full px-1 sm:px-2 pb-24">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 mt-2">
        <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Institutional Matrix</h1>
        <div className="flex items-center gap-3">
           {isManagement && (
             <>
               {isDesigning && viewMode === 'CLASS' && selectedTarget && (
                 <button onClick={handleAutoFill} disabled={isProcessing} className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 border border-white/10">Auto-Fill</button>
               )}
               <button onClick={() => setIsDesigning(!isDesigning)} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase transition-all shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Lock' : 'Edit Matrix'}</button>
             </>
           )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[600px] relative">
        {status && (
          <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-[100] px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl animate-in slide-in-from-top-4 border ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-white border-rose-100'}`}>
            {status.message}
          </div>
        )}
        
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 flex flex-col xl:flex-row items-center gap-4 shrink-0">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border dark:border-slate-800 shadow-sm shrink-0 w-full xl:w-auto">
              {canViewClassTab && <button onClick={() => { setViewMode('CLASS'); setSelectedTarget(''); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>}
              <button onClick={() => { setViewMode('TEACHER'); setSelectedTarget(user.id); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
              <button onClick={() => { setViewMode('ROOM'); setSelectedTarget(''); }} className={`flex-1 xl:flex-none px-4 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>
           </div>
           <div className="flex items-center gap-3 bg-white dark:bg-slate-900 px-4 py-3 md:py-2 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm shrink-0 w-full xl:w-auto">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date:</span>
             <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white" />
           </div>
           <select className="bg-white dark:bg-slate-950 px-5 py-3 rounded-xl border-2 border-slate-100 dark:border-slate-800 text-[11px] font-black uppercase flex-1 outline-none focus:border-amber-400 transition-all dark:text-white" value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)}>
             <option value="">Select Target...</option>
             {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>
        </div>
        
        <div className="hidden md:block flex-1 overflow-x-auto overflow-y-auto bg-slate-50/20 max-h-[70vh] scrollbar-hide">
          <table className="w-full border-collapse table-fixed min-w-[1000px]">
            <thead className="bg-[#00122b] sticky top-0 z-[40]">
              <tr className="h-14">
                <th className="w-24 border border-white/10 text-[12px] font-black text-amber-500 uppercase italic day-column-cell sticky left-0 z-[50] bg-[#00122b]">Day</th>
                {slots.map(s => <th key={s.id} className="text-white text-[10px] font-black uppercase border border-white/5 bg-[#001f3f] p-2">
                  <p className="leading-none">{s.label.replace('Period ', 'P')}</p>
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {DAYS.map((day) => (
                <tr key={day} className="h-28">
                  <td className="bg-[#00122b] text-white font-black text-center text-[12px] uppercase border border-white/5 italic day-column-cell sticky left-0 z-[30] shadow-xl">{day.substring(0,3).toUpperCase()}</td>
                  {slots.map(s => (<td key={s.id} className={`border border-slate-100 dark:border-slate-800/40 p-1 relative ${s.isBreak ? 'bg-amber-50/20' : ''}`}>
                    {s.isBreak ? <div className="flex items-center justify-center h-full"><span className="text-amber-500/40 font-black text-[10px] tracking-[0.4em] uppercase">R</span></div> : renderGridCell(day, s, selectedTarget, viewMode)}
                  </td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Mobile View */}
        <div className="md:hidden flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/20 scrollbar-hide">
          <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide mb-4">
            {DAYS.map(day => (
              <button key={day} onClick={() => setActiveDay(day)} className={`flex-1 px-4 py-3 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeDay === day ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{day.substring(0,3)}</button>
            ))}
          </div>
          <div className="space-y-4">
            {slots.map(slot => (
              <div key={slot.id} className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 flex justify-between items-center shadow-sm">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs shadow-lg">{slot.id}</div>
                    {renderGridCell(activeDay, slot, selectedTarget, viewMode)}
                 </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/90 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
             <div className="pt-10 pb-6 text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Period Controller</h4>
                <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">{editContext.day} • {editContext.slot.label}</p>
             </div>
             <div className="px-10 pb-6">
               <div className="bg-slate-100 dark:bg-slate-800 p-1.5 rounded-[2rem] flex">
                 <button onClick={() => setEntryType('INDIVIDUAL')} className={`flex-1 py-3 rounded-[1.5rem] text-[10px] font-black uppercase transition-all ${entryType === 'INDIVIDUAL' ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-white shadow-md' : 'text-slate-400'}`}>Individual</button>
                 <button onClick={() => setEntryType('GROUP')} className={`flex-1 py-3 rounded-[1.5rem] text-[10px] font-black uppercase transition-all ${entryType === 'GROUP' ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-white shadow-md' : 'text-slate-400'}`}>Group</button>
               </div>
             </div>
             <div className="px-10 space-y-4 flex-1 overflow-y-auto">
                {entryType === 'INDIVIDUAL' ? (
                  <>
                    <select className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                      <option value="">Select Class...</option>
                      {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <select className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                      <option value="">Select Teacher...</option>
                      {users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <select className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                      <option value="">Select Subject...</option>
                      {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <select className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none" value={manualData.room} onChange={e => setManualData({...manualData, room: e.target.value})}>
                      <option value="">Select Room...</option>
                      {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </>
                ) : (
                  <select className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-6 py-4 font-bold text-sm dark:text-white outline-none" value={manualData.blockId} onChange={e => setManualData({...manualData, blockId: e.target.value})}>
                    <option value="">Select Group...</option>
                    {config.combinedBlocks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                )}
             </div>
             <div className="p-10 space-y-4">
                <button onClick={handleSaveEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-2xl active:scale-95">AUTHORIZE ENTRY</button>
                {editContext.targetId && (
                  <button onClick={handleDeleteEntry} disabled={isProcessing} className="w-full bg-rose-50 text-rose-600 py-4 rounded-2xl font-black text-[10px] uppercase border border-rose-100 hover:bg-rose-500 hover:text-white transition-all active:scale-95">
                    {isProcessing ? 'Purging...' : 'Purge Registry Entry'}
                  </button>
                )}
                <button onClick={() => setShowEditModal(false)} className="text-slate-400 font-black text-[10px] uppercase w-full">Abort</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;
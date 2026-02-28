
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, ExtraCurricularRule } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { HapticService } from '../services/hapticService.ts';

import { Plus, Trash2, ChevronDown, RefreshCw } from 'lucide-react';

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
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ 
  user, users, timetable, setTimetable, timetableDraft, setTimetableDraft, 
  isDraftMode, setIsDraftMode, substitutions, config, assignments, 
  setAssignments, onManualSync, triggerConfirm, showToast, isSandbox, addSandboxLog
}) => {
  const isManagement = user?.role === UserRole.ADMIN || user?.role.startsWith('INCHARGE_');
  const isAdmin = user?.role === UserRole.ADMIN;
  const isGlobalIncharge = user?.role === UserRole.INCHARGE_ALL;
  
  const userWingScope = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return null;
    if (user.role === UserRole.INCHARGE_PRIMARY) return 'wing-p';
    if (user.role === UserRole.INCHARGE_SECONDARY) return 'wing-sb';
    return null;
  }, [user.role, isAdmin, isGlobalIncharge]);

  const accessibleWings = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return config.wings;
    if (user.role === UserRole.INCHARGE_PRIMARY) return config.wings.filter(w => w.id === 'wing-p');
    if (user.role === UserRole.INCHARGE_SECONDARY) return config.wings.filter(w => w.id.includes('wing-s'));
    return config.wings; 
  }, [config.wings, user.role, isAdmin, isGlobalIncharge]);

  const [activeWingId, setActiveWingId] = useState<string>(() => {
    if (userWingScope) return userWingScope;
    const wingWithData = config.wings.find(w => config.sections.some(s => s.wingId === w.id));
    return wingWithData?.id || config.wings[0]?.id || '';
  });

  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>(isManagement ? 'SECTION' : 'TEACHER');
  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => !isManagement ? user.id : '');

  const [isPurgeMode, setIsPurgeMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{ day: string, slotId: number, entryId: string } | null>(null);
  const [selectedDayMobile, setSelectedDayMobile] = useState<string>(() => {
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date());
    return DAYS.includes(today) ? today : 'Sunday';
  });

  const [assigningSlot, setAssigningSlot] = useState<{ day: string, slotId: number, sectionId?: string } | null>(null);
  const [viewingEntryId, setViewingEntryId] = useState<string | null>(null);
  const [assignmentType, setAssignmentType] = useState<'STANDARD' | 'POOL' | 'ACTIVITY' | 'LAB'>('STANDARD');
  const [selAssignTeacherId, setSelAssignTeacherId] = useState('');
  const [selLabTechnicianId, setSelLabTechnicianId] = useState('');
  const [selLabSection2Id, setSelLabSection2Id] = useState('');
  
  const [selLab2Subject, setSelLab2Subject] = useState('');
  const [selLab2TeacherId, setSelLab2TeacherId] = useState('');
  const [selLab2TechnicianId, setSelLab2TechnicianId] = useState('');
  const [selLab2Room, setSelLab2Room] = useState('');

  const [selLab3Subject, setSelLab3Subject] = useState('');
  const [selLab3TeacherId, setSelLab3TeacherId] = useState('');
  const [selLab3TechnicianId, setSelLab3TechnicianId] = useState('');
  const [selLab3Room, setSelLab3Room] = useState('');

  const [selAssignSubject, setSelAssignSubject] = useState('');
  const [selAssignRoom, setSelAssignRoom] = useState('');
  const [selPoolId, setSelPoolId] = useState('');
  const [selActivityId, setSelActivityId] = useState('');
  const [selAssignDay, setSelAssignDay] = useState<string>('');
  const [selAssignSlotId, setSelAssignSlotId] = useState<number>(1);
  const [selAssignSectionId, setSelAssignSectionId] = useState<string>('');

  const [isPurgeMenuOpen, setIsPurgeMenuOpen] = useState(false);

  const currentTimetable = useMemo(() => {
    const primary = isDraftMode ? timetableDraft : timetable;
    if (primary.length === 0) return isDraftMode ? timetable : timetableDraft;
    return primary;
  }, [isDraftMode, timetable, timetableDraft]);

  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const slots = useMemo(() => {
    if (viewMode === 'TEACHER' || viewMode === 'ROOM') {
      return config.slotDefinitions?.['SECONDARY_BOYS'] || SECONDARY_BOYS_SLOTS;
    }
    const wing = config.wings.find(w => w.id === activeWingId);
    return config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || PRIMARY_SLOTS;
  }, [activeWingId, config.slotDefinitions, config.wings, viewMode]);

  const displayedSlots = useMemo(() => {
    if (viewMode === 'SECTION') return slots;
    return slots.filter(s => !s.isBreak);
  }, [slots, viewMode]);

  const filteredEntities = useMemo(() => {
    if (isAdmin || isGlobalIncharge) {
      if (viewMode === 'SECTION') return config.sections.filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
      if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
      return config.rooms.map(r => ({ id: r, name: r }));
    }
    if (isManagement) {
      const scope = userWingScope;
      if (viewMode === 'SECTION') return config.sections.filter(s => scope ? s.wingId.includes(scope.substring(0, 6)) : true).filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
      if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
      return config.rooms.map(r => ({ id: r, name: r }));
    }
    if (viewMode === 'TEACHER') return [{ id: user.id, name: `${user.name} (Self)` }];
    if (viewMode === 'SECTION') {
      const sect = config.sections.find(s => s.id === user.classTeacherOf);
      return sect ? [{ id: sect.id, name: `${sect.fullName} (My Class)` }] : [];
    }
    return [];
  }, [viewMode, config.sections, config.rooms, users, activeWingId, user, isManagement, isAdmin, isGlobalIncharge, userWingScope]);

  useEffect(() => {
    if (filteredEntities.length > 0) {
      const isValid = filteredEntities.some(e => e.id === selectedTargetId);
      if (!isValid || selectedTargetId === '') setSelectedTargetId(filteredEntities[0].id);
    }
  }, [filteredEntities, viewMode, activeWingId, isManagement, user.id, selectedTargetId]);

  const activeData = useMemo(() => {
    return currentTimetable.filter(e => !e.date);
  }, [currentTimetable]);

  const checkCollision = useCallback((teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string, currentBatch?: TimeTableEntry[], blockId?: string, secondaryTeacherId?: string, isSplitLab?: boolean) => {
    const dataset = currentBatch || currentTimetable;
    const dayEntries = dataset.filter(e => e.day === day && e.slotId === slotId && e.id !== excludeEntryId);
    
    let incomingTeachers = [teacherId];
    if (secondaryTeacherId) incomingTeachers.push(secondaryTeacherId);
    let incomingRooms = [room];
    
    if (teacherId === 'POOL_VAR') {
       const targetBlockId = blockId || dataset.find(e => e.day === day && e.slotId === slotId && e.blockId)?.blockId;
       const poolTemplate = config.combinedBlocks?.find(b => b.id === targetBlockId);
       if (poolTemplate) {
          incomingTeachers = poolTemplate.allocations.map(a => a.teacherId);
          incomingRooms = poolTemplate.allocations.map(a => a.room).filter((r): r is string => !!r);
       }
    }

    for (const e of dayEntries) {
      if (e.sectionId === sectionId && (!e.isSplitLab || !isSplitLab)) return `Class Collision: ${e.className} already has ${e.subject} at this time.`;

      const existingTeachers = e.blockId 
        ? (config.combinedBlocks?.find(b => b.id === e.blockId)?.allocations.map(a => a.teacherId) || [])
        : [e.teacherId];
      
      if (e.secondaryTeacherId) existingTeachers.push(e.secondaryTeacherId);

      const teacherClash = incomingTeachers.find(t => t !== 'POOL_VAR' && existingTeachers.includes(t));
      if (teacherClash) {
         const tName = users.find(u => u.id === teacherClash)?.name || teacherClash;
         return `Teacher Collision: ${tName} is already assigned to class ${e.className}.`;
      }

      const existingRooms = e.blockId
        ? (config.combinedBlocks?.find(b => b.id === e.blockId)?.allocations.map(a => a.room).filter((r): r is string => !!r) || [e.room])
        : [e.room];

      const roomClash = incomingRooms.find(ir => 
        ir && ir !== 'Default' && !ir.startsWith('ROOM ') && existingRooms.includes(ir)
      );

      if (roomClash) return `Room Collision: ${roomClash} is currently occupied by ${e.className}.`;
    }

    // Continuity Check: Max 2 continuous periods for a teacher in a specific class
    for (const tId of incomingTeachers) {
      if (tId === 'POOL_VAR') continue;
      
      const teacherSectionDayEntries = dataset.filter(e => 
        e.day === day && 
        e.sectionId === sectionId && 
        e.id !== excludeEntryId &&
        (e.teacherId === tId || (e.blockId && config.combinedBlocks?.find(b => b.id === e.blockId)?.allocations.some(a => a.teacherId === tId)))
      );
      
      const occupiedSlots = teacherSectionDayEntries.map(e => e.slotId);
      if (
        (occupiedSlots.includes(slotId - 1) && occupiedSlots.includes(slotId - 2)) ||
        (occupiedSlots.includes(slotId + 1) && occupiedSlots.includes(slotId + 2)) ||
        (occupiedSlots.includes(slotId - 1) && occupiedSlots.includes(slotId + 1))
      ) {
        const tName = users.find(u => u.id === tId)?.name || tId;
        return `Continuity Violation: ${tName} cannot have more than 2 continuous periods in this class.`;
      }
    }

    return null;
  }, [currentTimetable, config.combinedBlocks, users]);

  const currentClash = useMemo(() => {
    if (!assigningSlot) return null;
    const finalSectionId = assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
    const finalDay = assigningSlot.day || selAssignDay;
    const finalSlotId = assigningSlot.slotId || selAssignSlotId;

    if (assignmentType === 'STANDARD') {
      if (!selAssignTeacherId || !finalSectionId) return null;
      return checkCollision(selAssignTeacherId, finalSectionId, finalDay, finalSlotId, selAssignRoom);
    } 
    else if (assignmentType === 'POOL') {
      if (!selPoolId) return null;
      const pool = config.combinedBlocks?.find(b => b.id === selPoolId);
      if (!pool || !pool.sectionIds) return null;
      for (const sid of pool.sectionIds) {
        const clash = checkCollision('POOL_VAR', sid, finalDay, finalSlotId, '', undefined, undefined, selPoolId);
        if (clash) return `Pool Clash (Section ${config.sections.find(s => s.id === sid)?.name}): ${clash}`;
      }
    }
    else if (assignmentType === 'LAB') {
      if (!selAssignTeacherId || !selLabTechnicianId || !finalSectionId) return null;
      
      const checkLabGroup = (tId: string, lTId: string, sub: string, rm: string, batch: TimeTableEntry[]) => {
        const c1 = checkCollision(tId, finalSectionId, finalDay, finalSlotId, rm, undefined, batch, undefined, lTId, true);
        if (c1) return c1;

        const nextSlot = slots.find(s => s.id === finalSlotId + 1);
        if (!nextSlot) return "Lab Error: Cannot assign double period at the end of the day.";
        if (nextSlot.isBreak) return "Lab Error: Consecutive period is a break.";

        const c2 = checkCollision(tId, finalSectionId, finalDay, finalSlotId + 1, rm, undefined, batch, undefined, lTId, true);
        if (c2) return `Slot ${finalSlotId + 1} Clash: ${c2}`;

        if (selLabSection2Id) {
          const c3 = checkCollision(tId, selLabSection2Id, finalDay, finalSlotId, rm, undefined, batch, undefined, lTId, true);
          if (c3) return `Section 2 Clash: ${c3}`;
          const c4 = checkCollision(tId, selLabSection2Id, finalDay, finalSlotId + 1, rm, undefined, batch, undefined, lTId, true);
          if (c4) return `Section 2 Slot ${finalSlotId + 1} Clash: ${c4}`;
        }
        return null;
      };

      const tempBatch: TimeTableEntry[] = [...currentTimetable];
      
      // Group 1
      const g1Err = checkLabGroup(selAssignTeacherId, selLabTechnicianId, selAssignSubject, selAssignRoom, tempBatch);
      if (g1Err) return `Group 1: ${g1Err}`;
      
      // Add mock entries to tempBatch to check for internal clashes between groups
      const mockEntry: TimeTableEntry = { id: 'mock1', day: finalDay, slotId: finalSlotId, sectionId: finalSectionId, teacherId: selAssignTeacherId, secondaryTeacherId: selLabTechnicianId, room: selAssignRoom, isSplitLab: true } as any;
      tempBatch.push(mockEntry);

      // Group 2
      if (selLab2Subject && selLab2TeacherId && selLab2TechnicianId) {
        const g2Err = checkLabGroup(selLab2TeacherId, selLab2TechnicianId, selLab2Subject, selLab2Room, tempBatch);
        if (g2Err) return `Group 2: ${g2Err}`;
        tempBatch.push({ id: 'mock2', day: finalDay, slotId: finalSlotId, sectionId: finalSectionId, teacherId: selLab2TeacherId, secondaryTeacherId: selLab2TechnicianId, room: selLab2Room, isSplitLab: true } as any);
      }

      // Group 3
      if (selLab3Subject && selLab3TeacherId && selLab3TechnicianId) {
        const g3Err = checkLabGroup(selLab3TeacherId, selLab3TechnicianId, selLab3Subject, selLab3Room, tempBatch);
        if (g3Err) return `Group 3: ${g3Err}`;
      }
    }
    else if (assignmentType === 'ACTIVITY') {
      if (!selActivityId || !finalSectionId) return null;
      const rule = config.extraCurricularRules?.find(r => r.id === selActivityId);
      if (!rule) return null;
      return checkCollision(rule.teacherId, finalSectionId, finalDay, finalSlotId, rule.room);
    }
    return null;
  }, [assigningSlot, selAssignSectionId, selectedTargetId, viewMode, selAssignDay, selAssignSlotId, assignmentType, selAssignTeacherId, selAssignRoom, selPoolId, selActivityId, checkCollision, config.combinedBlocks, config.extraCurricularRules, config.sections, selLabTechnicianId, selLabSection2Id, slots]);

  const handleQuickAssign = () => {
    if (!assigningSlot) return;
    const finalSectionId = assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
    
    if (!finalSectionId) {
      alert("Operational Error: You must select a Target Class (Section) from the dropdown.");
      return;
    }

    const finalDay = assigningSlot.day || selAssignDay;
    const finalSlotId = assigningSlot.slotId || selAssignSlotId;

    const currentSection = config.sections.find(s => s.id === finalSectionId);
    if (!currentSection) {
      alert("Registry Error: Selected class no longer exists in the hierarchy.");
      return;
    }

    if (assignmentType === 'STANDARD') {
      if (!selAssignTeacherId || !selAssignSubject) return;
      const teacher = users.find(u => u.id === selAssignTeacherId);
      if (!teacher) return;
      
      const clash = checkCollision(selAssignTeacherId, finalSectionId, finalDay, finalSlotId, selAssignRoom);
      if (clash) { alert(clash); return; }

      const newEntry: TimeTableEntry = {
        id: generateUUID(),
        section: currentSection.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
        wingId: currentSection.wingId,
        gradeId: currentSection.gradeId,
        sectionId: currentSection.id,
        className: currentSection.fullName,
        day: finalDay,
        slotId: finalSlotId,
        subject: selAssignSubject,
        subjectCategory: SubjectCategory.CORE,
        teacherId: selAssignTeacherId,
        teacherName: teacher.name,
        room: selAssignRoom,
        isManual: true
      };
      setCurrentTimetable(prev => [...prev, newEntry]);
    } 
    else if (assignmentType === 'LAB') {
      if (!selAssignTeacherId || !selLabTechnicianId || !selAssignSubject) return;
      
      const labEntries: TimeTableEntry[] = [];
      const blockId = generateUUID();
      const sectionsToAssign = [finalSectionId];
      if (selLabSection2Id) sectionsToAssign.push(selLabSection2Id);

      const addGroup = (tId: string, lTId: string, sub: string, rm: string) => {
        const teacher = users.find(u => u.id === tId);
        const technician = users.find(u => u.id === lTId);
        if (!teacher || !technician) return;

        for (const sid of sectionsToAssign) {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) continue;

          // Slot N
          labEntries.push({
            id: generateUUID(),
            section: sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
            wingId: sect.wingId,
            gradeId: sect.gradeId,
            sectionId: sect.id,
            className: sect.fullName,
            day: finalDay,
            slotId: finalSlotId,
            subject: sub,
            subjectCategory: SubjectCategory.CORE,
            teacherId: tId,
            teacherName: teacher.name,
            secondaryTeacherId: lTId,
            secondaryTeacherName: technician.name,
            room: rm,
            isManual: true,
            isDouble: true,
            isSplitLab: true,
            blockId: blockId,
            blockName: `${sub} Lab`
          });

          // Slot N+1
          labEntries.push({
            id: generateUUID(),
            section: sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
            wingId: sect.wingId,
            gradeId: sect.gradeId,
            sectionId: sect.id,
            className: sect.fullName,
            day: finalDay,
            slotId: finalSlotId + 1,
            subject: sub,
            subjectCategory: SubjectCategory.CORE,
            teacherId: tId,
            teacherName: teacher.name,
            secondaryTeacherId: lTId,
            secondaryTeacherName: technician.name,
            room: rm,
            isManual: true,
            isDouble: true,
            isSplitLab: true,
            blockId: blockId,
            blockName: `${sub} Lab`
          });
        }
      };

      // Group 1
      addGroup(selAssignTeacherId, selLabTechnicianId, selAssignSubject, selAssignRoom);
      
      // Group 2
      if (selLab2Subject && selLab2TeacherId && selLab2TechnicianId) {
        addGroup(selLab2TeacherId, selLab2TechnicianId, selLab2Subject, selLab2Room);
      }

      // Group 3
      if (selLab3Subject && selLab3TeacherId && selLab3TechnicianId) {
        addGroup(selLab3TeacherId, selLab3TechnicianId, selLab3Subject, selLab3Room);
      }

      setCurrentTimetable(prev => [...prev, ...labEntries]);
    }
    else if (assignmentType === 'POOL') {
      const pool = config.combinedBlocks?.find(b => b.id === selPoolId);
      if (!pool || !pool.sectionIds) return;
      
      for (const sid of pool.sectionIds) {
        const clash = checkCollision('POOL_VAR', sid, finalDay, finalSlotId, '', undefined, undefined, selPoolId);
        if (clash) { alert(`Pool Clash for Section ${config.sections.find(s => s.id === sid)?.name}: ${clash}`); return; }
      }

      const newEntries: TimeTableEntry[] = (pool.sectionIds || []).map(sid => {
        const sect = config.sections.find(s => s.id === sid);
        if (!sect) return null;
        return {
          id: generateUUID(),
          section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
          wingId: sect.wingId,
          gradeId: sect.gradeId,
          sectionId: sect.id,
          className: sect.fullName,
          day: finalDay,
          slotId: finalSlotId,
          subject: pool.heading,
          subjectCategory: SubjectCategory.CORE,
          teacherId: 'POOL_VAR',
          teacherName: 'Multiple Staff',
          blockId: pool.id,
          blockName: pool.title,
          isManual: true
        } as TimeTableEntry;
      }).filter((e): e is TimeTableEntry => e !== null);
      setCurrentTimetable(prev => [...prev, ...newEntries]);
    }
    else if (assignmentType === 'ACTIVITY') {
      const rule = config.extraCurricularRules?.find(r => r.id === selActivityId);
      if (!rule) return;
      const teacher = users.find(u => u.id === rule.teacherId);
      
      const clash = checkCollision(rule.teacherId, finalSectionId, finalDay, finalSlotId, rule.room);
      if (clash) { alert(clash); return; }

      const newEntry: TimeTableEntry = {
        id: generateUUID(),
        section: currentSection.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
        wingId: currentSection.wingId,
        gradeId: currentSection.gradeId,
        sectionId: currentSection.id,
        className: currentSection.fullName,
        day: finalDay,
        slotId: finalSlotId,
        subject: rule.subject,
        subjectCategory: SubjectCategory.CORE,
        teacherId: rule.teacherId,
        teacherName: teacher?.name || 'Specialist',
        room: rule.room,
        isManual: true
      };
      setCurrentTimetable(prev => [...prev, newEntry]);
    }
    setAssigningSlot(null);
    HapticService.success();
  };

  const handleSelectivePurge = (type: 'ALL' | 'LOADS' | 'POOLS' | 'ANCHORS' | 'CURRICULAR') => {
    if (!isDraftMode || viewMode !== 'SECTION' || !selectedTargetId) return;
    
    const activeSectionId = selectedTargetId;
    const curricularSubjects = (config.extraCurricularRules || []).map(r => r.subject);

    setCurrentTimetable(prev => prev.filter(e => {
      // If not the current section, keep it
      if (e.sectionId !== activeSectionId) return true;
      
      // If manual, keep it
      if (e.isManual) return true;

      // Selective logic
      switch (type) {
        case 'ALL':
          return false; // Purge all non-manual
        case 'LOADS':
          // Standard load is not a block, not slot 1, and not curricular
          const isPool = !!e.blockId;
          const isAnchor = e.slotId === 1;
          const isCurricular = curricularSubjects.includes(e.subject);
          return isPool || isAnchor || isCurricular;
        case 'POOLS':
          return !e.blockId;
        case 'ANCHORS':
          return e.slotId !== 1;
        case 'CURRICULAR':
          return !curricularSubjects.includes(e.subject);
        default:
          return true;
      }
    }));
    
    HapticService.notification();
    showToast(`Purge Complete: ${type} periods cleared for this class.`, "info");
    setIsPurgeMenuOpen(false);
  };

  const handleGenerateAnchors = () => {
    if (!isDraftMode) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      const teachersWithAnchors = users.filter(u => !u.isResigned && !!u.classTeacherOf);
      let sectionIdsToPurge = teachersWithAnchors.map(t => t.classTeacherOf).filter((sid): sid is string => !!sid);
      if (activeSectionId) {
        sectionIdsToPurge = sectionIdsToPurge.filter(sid => sid === activeSectionId);
      }
      baseTimetable = baseTimetable.filter(e => 
        !(e.slotId === 1 && sectionIdsToPurge.includes(e.sectionId) && !e.isManual)
      );
    }

    showToast("Phase 1: Analyzing registry anchors...", "info");
    const teachersWithAnchors = users.filter(u => {
      if (u.isResigned || !u.classTeacherOf) return false;
      if (activeSectionId && u.classTeacherOf !== activeSectionId) return false;
      return true;
    });
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    teachersWithAnchors.forEach(teacher => {
      const section = config.sections.find(s => s.id === teacher.classTeacherOf);
      const asgn = assignments.find(a => a.teacherId === teacher.id);
      if (!section || !asgn || !asgn.anchorSubject) return;

      // Exclude Grade 11 and 12 from Anchor Protocol
      const grade = config.grades.find(g => g.id === section.gradeId);
      if (grade && (grade.name.includes('XI') || grade.name.includes('XII'))) return;

      DAYS.forEach(day => {
        const clash = checkCollision(teacher.id, section.id, day, 1, `ROOM ${section.fullName}`, undefined, [...baseTimetable, ...newEntries]);
        if (!clash) {
          newEntries.push({
            id: generateUUID(),
            section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
            wingId: section.wingId,
            gradeId: section.gradeId,
            sectionId: section.id,
            className: section.fullName,
            day, slotId: 1,
            subject: asgn.anchorSubject!,
            subjectCategory: SubjectCategory.CORE,
            teacherId: teacher.id,
            teacherName: teacher.name,
            room: `ROOM ${section.fullName}`,
            isManual: false
          });
          count++;
        }
      });
    });

    if (count > 0 || isPurgeMode) {
      setCurrentTimetable([...baseTimetable, ...newEntries]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      showToast(`Phase 1 Complete: ${count} anchors assigned for ${targetName}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
    } else {
      showToast("Phase 1: No eligible anchors found for deployment.", "warning");
    }
  };

  const handleGeneratePools = () => {
    if (!isDraftMode || !config.combinedBlocks) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      const poolBlockIds = (config.combinedBlocks || []).map(p => p.id);
      baseTimetable = baseTimetable.filter(e => {
        const isPool = e.blockId && poolBlockIds.includes(e.blockId) && !e.isManual;
        if (!isPool) return true;
        if (activeSectionId && e.sectionId !== activeSectionId) return true;
        return false;
      });
    }

    showToast("Phase 2: Synchronizing subject pools...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    (config.combinedBlocks || []).forEach(pool => {
      if (!pool.sectionIds) return;
      // For group periods, allow generation for the whole grade if a section from that grade is active
      if (activeGradeId && pool.gradeId !== activeGradeId) return;
      
      // Count existing slots for this pool in baseTimetable
      const existingPoolSlots = baseTimetable.filter(e => e.blockId === pool.id);
      const uniqueExistingSlots = new Set(existingPoolSlots.map(e => `${e.day}-${e.slotId}`));
      let placed = uniqueExistingSlots.size;
      
      // Create all possible (day, slot) pairs and shuffle them for randomness
      let possibleSlots: { day: string, slot: number }[] = [];
      DAYS.forEach(day => {
        for (let slot = 1; slot <= 10; slot++) {
          if (pool.restrictedSlots && pool.restrictedSlots.includes(slot)) continue;
          possibleSlots.push({ day, slot });
        }
      });
      
      // Shuffle the slots
      for (let i = possibleSlots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [possibleSlots[i], possibleSlots[j]] = [possibleSlots[j], possibleSlots[i]];
      }

      // Sort to prioritize preferred slots
      if (pool.preferredSlots && pool.preferredSlots.length > 0) {
        possibleSlots.sort((a, b) => {
          const aPref = pool.preferredSlots!.includes(a.slot) ? -1 : 1;
          const bPref = pool.preferredSlots!.includes(b.slot) ? -1 : 1;
          return aPref - bPref;
        });
      }

      const dayCounts: Record<string, number> = {};

      for (const { day, slot } of possibleSlots) {
        if (placed >= pool.weeklyPeriods) break;
        
        // Limit to 2 periods per day for this pool
        if ((dayCounts[day] || 0) >= 2) continue;
        
        let allFree = true;
        let isBreakAnywhere = false;

        for (const sid of (pool.sectionIds || [])) {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) continue;

          const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
          const slotObj = wingSlots.find(s => s.id === slot);
          if (!slotObj || slotObj.isBreak) {
            isBreakAnywhere = true;
            break;
          }

          if (checkCollision('POOL_VAR', sid, day, slot, '', undefined, [...baseTimetable, ...newEntries], pool.id)) {
            allFree = false;
            break;
          }
        }

        if (allFree && !isBreakAnywhere) {
          (pool.sectionIds || []).forEach(sid => {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) return;

            newEntries.push({
              id: generateUUID(),
              section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
              wingId: sect.wingId,
              gradeId: sect.gradeId,
              sectionId: sect.id,
              className: sect.fullName,
              day, slotId: slot,
              subject: pool.heading,
              subjectCategory: SubjectCategory.CORE,
              teacherId: 'POOL_VAR',
              teacherName: 'Multiple Staff',
              blockId: pool.id,
              blockName: pool.title,
              isManual: false
            });
          });
          dayCounts[day] = (dayCounts[day] || 0) + 1;
          placed++;
          count++;
        }
      }
    });

    if (count > 0 || isPurgeMode) {
      setCurrentTimetable([...baseTimetable, ...newEntries]);
      HapticService.success();
      const targetName = activeGradeId ? config.grades.find(g => g.id === activeGradeId)?.name : 'all grades';
      showToast(`Phase 2 Complete: ${count} parallel pool periods synchronized for ${targetName}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
    } else {
      showToast("Phase 2: Matrix full. No additional pool slots could be synchronized.", "warning");
    }
  };

  const handleGenerateCurriculars = () => {
    if (!isDraftMode || !config.extraCurricularRules) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      const curricularSubjects = (config.extraCurricularRules || []).map(r => r.subject);
      let curricularSectionIds = (config.extraCurricularRules || []).flatMap(r => r.sectionIds || []);
      if (activeSectionId) {
        curricularSectionIds = curricularSectionIds.filter(sid => sid === activeSectionId);
      }
      baseTimetable = baseTimetable.filter(e => 
        !(curricularSubjects.includes(e.subject) && curricularSectionIds.includes(e.sectionId) && !e.isManual)
      );
    }

    showToast("Phase 3: Deploying curricular mandates...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    config.extraCurricularRules.forEach(rule => {
      const teacher = users.find(u => u.id === rule.teacherId);
      if (!teacher || !rule.sectionIds) return;

      const filteredSectionIds = activeSectionId 
        ? rule.sectionIds.filter(sid => sid === activeSectionId)
        : rule.sectionIds;

      filteredSectionIds.forEach(sid => {
        const section = config.sections.find(s => s.id === sid);
        if (!section) return;

        // Count existing entries for this rule and section in baseTimetable
        let placed = baseTimetable.filter(e => 
          e.sectionId === sid && 
          e.subject === rule.subject && 
          e.teacherId === rule.teacherId
        ).length;

        for (const day of DAYS) {
          if (placed >= rule.periodsPerWeek) break;
          for (let slot = 1; slot <= 10; slot++) {
            const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
            const slotObj = wingSlots.find(s => s.id === slot);
            if (!slotObj || slotObj.isBreak) continue;

            if (placed >= rule.periodsPerWeek) break;
            const clash = checkCollision(teacher.id, section.id, day, slot, rule.room, undefined, [...baseTimetable, ...newEntries]);
            if (!clash) {
              newEntries.push({
                id: generateUUID(),
                section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                wingId: section.wingId,
                gradeId: section.gradeId,
                sectionId: section.id,
                className: section.fullName,
                day, slotId: slot,
                subject: rule.subject,
                subjectCategory: SubjectCategory.CORE,
                teacherId: teacher.id,
                teacherName: teacher.name,
                room: rule.room,
                isManual: false
              });
              placed++;
              count++;
            }
          }
        }
      });
    });

    if (count > 0 || isPurgeMode) {
      setCurrentTimetable([...baseTimetable, ...newEntries]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      showToast(`Phase 3 Complete: ${count} specialized curricular periods deployed for ${targetName}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
    } else {
      showToast("Phase 3: No valid slots identified for curricular rules.", "warning");
    }
  };

  const handleGenerateLoads = () => {
    if (!isDraftMode) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      // Purge standard loads (non-manual, non-block, non-anchor)
      // We KEEP entries that are manual, blocks, or anchors
      baseTimetable = baseTimetable.filter(e => {
        const isStandardLoad = !(e.isManual || e.blockId || e.slotId === 1);
        if (!isStandardLoad) return true;
        if (activeSectionId && e.sectionId !== activeSectionId) return true;
        return false;
      });
    }

    showToast("Phase 4: Distributing remaining loads...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    assignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      if (!teacher) return;

      asgn.loads.forEach(load => {
        let placed = 0;
        
        // Respect specific section assignment if present in the load object
        let targetSections = load.sectionId 
          ? config.sections.filter(s => s.id === load.sectionId)
          : config.sections.filter(s => 
              asgn.targetSectionIds.length > 0 
                ? asgn.targetSectionIds.includes(s.id) 
                : s.gradeId === asgn.gradeId
            );
        
        if (activeSectionId) {
          targetSections = targetSections.filter(s => s.id === activeSectionId);
        }
        
        targetSections.forEach(section => {
          // Count existing entries for this teacher, subject and section in baseTimetable
          let sectionPlaced = baseTimetable.filter(e => 
            e.sectionId === section.id && 
            e.teacherId === teacher.id && 
            e.subject === load.subject
          ).length;
          
          const targetPerSection = load.periods;

          for (const day of DAYS) {
            if (sectionPlaced >= targetPerSection) break;
            for (let slot = 1; slot <= 10; slot++) {
              if (sectionPlaced >= targetPerSection) break;
              const clash = checkCollision(teacher.id, section.id, day, slot, load.room || `ROOM ${section.fullName}`, undefined, [...baseTimetable, ...newEntries]);
              if (!clash) {
                newEntries.push({
                  id: generateUUID(),
                  section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                  wingId: section.wingId,
                  gradeId: section.gradeId,
                  sectionId: section.id,
                  className: section.fullName,
                  day, slotId: slot,
                  subject: load.subject,
                  subjectCategory: SubjectCategory.CORE,
                  teacherId: teacher.id,
                  teacherName: teacher.name,
                  room: load.room || `ROOM ${section.fullName}`,
                  isManual: false
                });
                sectionPlaced++;
                count++;
              }
            }
          }
        });
      });
    });

    if (count > 0 || isPurgeMode) {
      setCurrentTimetable([...baseTimetable, ...newEntries]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      showToast(`Phase 4 Complete: ${count} instructional load periods distributed for ${targetName}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
    } else {
      showToast("Phase 4: Optimization complete. No deployable loads remaining.", "info");
    }
  };

  const handleCellClick = (day: string, slotId: number, entryId?: string) => {
    if (!isDraftMode || !isManagement) return;
    HapticService.light();

    if (isSwapMode) {
      if (!swapSource) { if (entryId) setSwapSource({ day, slotId, entryId }); }
      else { executeSwap(swapSource, { day, slotId, entryId }); }
    } else {
      if (!entryId) {
        setAssigningSlot({ day, slotId });
        setAssignmentType('STANDARD');
        setSelAssignSubject('');
        setSelPoolId('');
        setSelActivityId('');
        setSelLabTechnicianId('');
        setSelLabSection2Id('');
        setSelLab2Subject('');
        setSelLab2TeacherId('');
        setSelLab2TechnicianId('');
        setSelLab2Room('');
        setSelLab3Subject('');
        setSelLab3TeacherId('');
        setSelLab3TechnicianId('');
        setSelLab3Room('');
        
        if (viewMode === 'SECTION') {
          setSelAssignTeacherId('');
          const sect = config.sections.find(s => s.id === selectedTargetId);
          setSelAssignRoom(sect ? `ROOM ${sect.fullName}` : '');
          setSelAssignSectionId(selectedTargetId);
        } else if (viewMode === 'TEACHER') {
          setSelAssignTeacherId(selectedTargetId);
          setSelAssignRoom('');
          setSelAssignSectionId('');
        } else if (viewMode === 'ROOM') {
          setSelAssignTeacherId('');
          setSelAssignRoom(selectedTargetId);
          setSelAssignSectionId('');
        }
      } else {
        setViewingEntryId(entryId);
      }
    }
  };

  const handleDeleteEntry = (entryId: string) => {
    const entry = currentTimetable.find(e => e.id === entryId);
    if (!entry) return;

    if (entry.blockId) {
      triggerConfirm(`This is a Group Period (${entry.blockName}). Deleting it will remove the entire synchronized block across all sections. Proceed?`, () => {
        setCurrentTimetable(prev => prev.filter(e => e.blockId !== entry.blockId));
        setViewingEntryId(null);
        showToast("Group block dismantled successfully.", "success");
      });
    } else {
      triggerConfirm("Dismantle this instruction brick?", () => {
        setCurrentTimetable(prev => prev.filter(e => e.id !== entryId));
        setViewingEntryId(null);
        showToast("Period removed.", "info");
      });
    }
  };

  const handleReplaceEntry = (entryId: string) => {
    const entry = currentTimetable.find(e => e.id === entryId);
    if (!entry) return;

    // Remove the current entry first (or block)
    if (entry.blockId) {
      setCurrentTimetable(prev => prev.filter(e => e.blockId !== entry.blockId));
    } else {
      setCurrentTimetable(prev => prev.filter(e => e.id !== entryId));
    }

    // Open assignment form for this slot
    setAssigningSlot({ day: entry.day, slotId: entry.slotId });
    setAssignmentType(entry.blockId ? 'POOL' : 'STANDARD');
    setSelAssignDay(entry.day);
    setSelAssignSlotId(entry.slotId);
    setSelAssignSectionId(entry.sectionId);
    setSelAssignTeacherId(entry.teacherId);
    setSelAssignSubject(entry.subject);
    setSelAssignRoom(entry.room || '');
    setSelPoolId(entry.blockId || '');
    setViewingEntryId(null);
  };

  const openFormBasedCreation = () => {
    setAssigningSlot({ day: DAYS[0], slotId: 1, sectionId: config.sections[0]?.id });
    setSelAssignDay(DAYS[0]);
    setSelAssignSlotId(1);
    setSelAssignSectionId(config.sections[0]?.id || '');
    setAssignmentType('STANDARD');
    setSelAssignTeacherId('');
    setSelAssignSubject('');
    setSelAssignRoom('');
    HapticService.light();
  };

  const executeSwap = async (source: { day: string, slotId: number, entryId: string }, target: { day: string, slotId: number, entryId?: string }) => {
    const sourceEntry = currentTimetable.find(e => e.id === source.entryId);
    if (!sourceEntry) return;

    const sourceBlockId = sourceEntry.blockId;
    const targetEntry = target.entryId ? currentTimetable.find(e => e.id === target.entryId) : null;
    const targetBlockId = targetEntry?.blockId;

    // 1. Identify all entries to move from source
    const sourceEntriesToMove = sourceBlockId 
      ? currentTimetable.filter(e => e.blockId === sourceBlockId && e.day === source.day && e.slotId === source.slotId)
      : [sourceEntry];

    // 2. Identify all entries to move from target (if any)
    const targetEntriesToMove = targetBlockId
      ? currentTimetable.filter(e => e.blockId === targetBlockId && e.day === target.day && e.slotId === target.slotId)
      : (targetEntry ? [targetEntry] : []);

    const sourceIds = sourceEntriesToMove.map(e => e.id);
    const targetIds = targetEntriesToMove.map(e => e.id);

    // 3. Collision Check for Source -> Target
    // We must check if source entries can fit into target slot, assuming target entries are GONE
    const timetableWithoutTarget = currentTimetable.filter(e => !targetIds.includes(e.id));
    for (const se of sourceEntriesToMove) {
      const collision = checkCollision(se.teacherId, se.sectionId, target.day, target.slotId, se.room || '', se.id, timetableWithoutTarget, se.blockId);
      if (collision) { alert(`REJECTED (Source Block Conflict): ${collision}`); setSwapSource(null); return; }
    }

    // 4. Collision Check for Target -> Source
    // We must check if target entries can fit into source slot, assuming source entries are GONE
    const timetableWithoutSource = currentTimetable.filter(e => !sourceIds.includes(e.id));
    for (const te of targetEntriesToMove) {
      const collision = checkCollision(te.teacherId, te.sectionId, source.day, source.slotId, te.room || '', te.id, timetableWithoutSource, te.blockId);
      if (collision) { alert(`REJECTED (Target Block Conflict): ${collision}`); setSwapSource(null); return; }
    }

    // 5. Execute Update
    const updated = currentTimetable.map(e => {
      if (sourceIds.includes(e.id)) return { ...e, day: target.day, slotId: target.slotId };
      if (targetIds.includes(e.id)) return { ...e, day: source.day, slotId: source.slotId };
      return e;
    });

    setCurrentTimetable(updated);
    setSwapSource(null);
    HapticService.success();
  };

  const handleSaveDraft = async () => {
    setIsProcessing(true);
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('timetable_drafts').delete().neq('id', 'SYSTEM_LOCK');
        await supabase.from('timetable_drafts').insert(timetableDraft.map(e => ({
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
          is_substitution: false,
          is_manual: e.isManual, 
          block_id: e.blockId,
          block_name: e.blockName
        })));
      }
      showToast("Draft Matrix saved to Cloud Registry.", "success");
    } catch (e: any) { alert(e.message); } finally { setIsProcessing(false); }
  };

  const handlePublishToLive = async () => {
    if (!confirm("Deploy Matrix to Production?")) return;
    setIsProcessing(true);
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('timetable_entries').delete().neq('id', 'SYSTEM_LOCK');
        await supabase.from('timetable_entries').insert(timetableDraft.map(e => ({
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
          is_substitution: false,
          is_manual: e.isManual, 
          block_id: e.blockId,
          block_name: e.blockName
        })));
        // Also clear draft from cloud after publishing
        await supabase.from('timetable_drafts').delete().neq('id', 'SYSTEM_LOCK');
      }
      setTimetable([...timetableDraft]);
      setIsDraftMode(false);
      showToast("Matrix successfully deployed to Production Registry.", "success");
    } catch (e: any) { alert(e.message); } finally { setIsProcessing(false); }
  };

  const isQuickAssignValid = useMemo(() => {
    const finalSectionId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
    const hasSubject = assignmentType === 'STANDARD' ? !!selAssignSubject : assignmentType === 'POOL' ? !!selPoolId : assignmentType === 'LAB' ? !!selAssignSubject : !!selActivityId;
    const hasTeacher = assignmentType === 'STANDARD' ? !!selAssignTeacherId : assignmentType === 'LAB' ? (!!selAssignTeacherId && !!selLabTechnicianId) : true;
    return !!finalSectionId && hasSubject && hasTeacher && !currentClash;
  }, [assigningSlot, selAssignSectionId, viewMode, selectedTargetId, assignmentType, selAssignSubject, selPoolId, selActivityId, selAssignTeacherId, selLabTechnicianId, currentClash]);

  const clashMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!isDraftMode || !isManagement) return map;

    if (assigningSlot && selAssignTeacherId) {
      const targetSectionId = assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
      if (targetSectionId) {
        DAYS.forEach(day => {
          slots.forEach(slot => {
            if (slot.isBreak) return;
            const clash = checkCollision(selAssignTeacherId, targetSectionId, day, slot.id, selAssignRoom);
            if (clash) map[`${day}-${slot.id}`] = clash;
          });
        });
      }
    }
    else if (isSwapMode && swapSource) {
      const sourceEntry = currentTimetable.find(e => e.id === swapSource.entryId);
      if (sourceEntry) {
        DAYS.forEach(day => {
          slots.forEach(slot => {
            if (slot.isBreak) return;
            const clash = checkCollision(sourceEntry.teacherId, sourceEntry.sectionId, day, slot.id, sourceEntry.room || '', sourceEntry.id);
            if (clash) map[`${day}-${slot.id}`] = clash;
          });
        });
      }
    }
    return map;
  }, [isDraftMode, isManagement, assigningSlot, selAssignTeacherId, selAssignSectionId, selectedTargetId, viewMode, slots, selAssignRoom, isSwapMode, swapSource, currentTimetable, checkCollision]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
            {isDraftMode ? 'Matrix' : 'Live'} <span className="text-[#d4af37]">Timetable</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">
            {isDraftMode ? 'Staging Environment - Volatile' : 'Production Registry - Read Only'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {isManagement && (
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
              <button 
                onClick={() => setIsDraftMode(false)} 
                className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${!isDraftMode ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
              >
                Live
              </button>
              <button 
                onClick={() => setIsDraftMode(true)} 
                className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${isDraftMode ? 'bg-amber-50 text-[#001f3f] font-black shadow-inner' : 'text-slate-400'}`}
              >
                Draft
              </button>
            </div>
          )}
          
          {isDraftMode && isManagement && (
            <>
              <button 
                onClick={openFormBasedCreation}
                className="flex-1 md:flex-none bg-[#001f3f] text-[#d4af37] px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all"
              >
                Manual Entry
              </button>
              <button 
                onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }}
                className={`flex-1 md:flex-none px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all ${isSwapMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 border border-indigo-100'}`}
              >
                {isSwapMode ? 'Cancel Swap' : 'Swap Mode'}
              </button>
              <button 
                onClick={handleSaveDraft}
                disabled={isProcessing}
                className="flex-1 md:flex-none bg-amber-500 text-[#001f3f] px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all"
              >
                {isProcessing ? 'Saving...' : 'Save Draft'}
              </button>
              <button 
                onClick={handlePublishToLive}
                disabled={isProcessing}
                className="flex-1 md:flex-none bg-[#001f3f] text-[#d4af37] px-6 py-3 md:px-8 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg active:scale-95"
              >
                {isProcessing ? 'Deploying...' : 'Deploy Live'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[3rem] p-4 md:p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
        <div className="flex flex-col xl:flex-row items-center gap-6">
           <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 w-full xl:w-auto">
             {(['SECTION', 'TEACHER', 'ROOM'] as const).map(mode => (
               <button key={mode} onClick={() => setViewMode(mode)} className={`flex-1 xl:flex-none px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === mode ? 'bg-white dark:bg-slate-900 text-[#001f3f] dark:text-white shadow-sm' : 'text-slate-400'}`}>{mode}</button>
             ))}
           </div>

           <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
              <select 
                value={activeWingId} 
                onChange={(e) => setActiveWingId(e.target.value)}
                disabled={viewMode !== 'SECTION'}
                className={`w-full sm:w-auto bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white transition-all ${viewMode !== 'SECTION' ? 'opacity-50 cursor-not-allowed border-slate-200' : ''}`}
              >
                {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>

            <select 
                value={selectedTargetId} 
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className="w-full sm:w-auto bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white min-w-[200px]"
              >
                {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>

              {(viewMode === 'TEACHER' || viewMode === 'ROOM') && selectedTargetId && (
                <div className="bg-[#001f3f] text-[#d4af37] px-5 py-3 rounded-2xl flex items-center gap-3 shadow-lg animate-in zoom-in duration-300">
                  <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Total Periods:</span>
                  <span className="text-sm font-black italic">
                    {(() => {
                      const targetIdLower = selectedTargetId.toLowerCase().trim();
                      const entries = currentTimetable.filter(e => {
                        if (viewMode === 'TEACHER') {
                          if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
                          if (e.blockId) {
                            const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                            return block?.allocations.some(a => a.teacherId?.toLowerCase().trim() === targetIdLower);
                          }
                        } else {
                          if (e.room?.toLowerCase().trim() === targetIdLower) return true;
                          if (e.blockId) {
                            const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                            return block?.allocations.some(a => a.room?.toLowerCase().trim() === targetIdLower);
                          }
                        }
                        return false;
                      });
                      
                      const distinctEntries = entries.filter((v, i, a) => {
                        if (!v.blockId) return true;
                        return a.findIndex(t => t.blockId === v.blockId && t.day === v.day && t.slotId === v.slotId) === i;
                      });
                      
                      return distinctEntries.length;
                    })()}
                  </span>
                </div>
              )}
           </div>
        </div>

        {isDraftMode && isManagement && (
          <div className="flex flex-wrap items-center gap-2 md:gap-3 p-4 md:p-6 bg-amber-50 dark:bg-amber-900/10 rounded-[2rem] md:rounded-[2.5rem] border border-amber-200 dark:border-amber-900/30">
            <div className="w-full flex justify-between items-center mb-2">
              <p className="text-[9px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest italic">Intelligence Matrix Generators:</p>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-amber-600 uppercase">Purge Mode</span>
                <button 
                  onClick={() => setIsPurgeMode(!isPurgeMode)}
                  className={`w-10 h-5 rounded-full transition-all relative ${isPurgeMode ? 'bg-rose-500' : 'bg-slate-200'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${isPurgeMode ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </div>
            <button onClick={handleGenerateAnchors} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 1</button>
            <button onClick={handleGeneratePools} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 2</button>
            <button onClick={handleGenerateCurriculars} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 3</button>
            <button onClick={handleGenerateLoads} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 4</button>
            
            {viewMode === 'SECTION' && (
              <div className="relative">
                <button 
                  onClick={() => setIsPurgeMenuOpen(!isPurgeMenuOpen)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-rose-50 dark:bg-rose-900/20 text-rose-600 border border-rose-100 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-rose-100 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                  Selective Purge
                  <ChevronDown className={`w-3 h-3 transition-transform ${isPurgeMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isPurgeMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 z-[100] p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <button 
                      onClick={() => handleSelectivePurge('ALL')}
                      className="w-full text-left px-4 py-3 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl text-[9px] font-black uppercase text-rose-600 flex items-center gap-3"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Purge All Automated
                    </button>
                    <div className="h-px bg-slate-50 dark:bg-slate-800 my-1"></div>
                    <button 
                      onClick={() => handleSelectivePurge('LOADS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Loads (Ph 4)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('POOLS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Pools (Ph 2)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('ANCHORS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Anchors (Ph 1)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('CURRICULAR')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Activities (Ph 3)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DESKTOP TABLE VIEW */}
        <div className="hidden md:block overflow-x-auto scrollbar-hide">
           <table className="w-full border-collapse border border-slate-300 dark:border-slate-700">
             <thead>
               <tr className="bg-slate-100 dark:bg-slate-800">
                  <th className="p-4 border border-slate-300 dark:border-slate-700 text-[12px] font-black uppercase text-slate-600 dark:text-slate-300 w-24">Day</th>
                  {displayedSlots.map(slot => (
                    <th key={slot.id} className="p-4 border border-slate-300 dark:border-slate-700 text-center bg-[#001f3f]/10 min-w-[120px]">
                       <p className="text-[13px] font-black text-[#001f3f] dark:text-white tabular-nums leading-none">{slot.startTime} - {slot.endTime}</p>
                       <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-2 opacity-100 italic">{slot.label}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {DAYS.map(day => (
                 <tr key={day}>
                   <td className="p-4 border border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50 font-black text-[12px] uppercase text-slate-700 dark:text-slate-200 italic">{day}</td>
                   {displayedSlots.map(slot => {
                     const cellEntries = activeData.filter(e => {
                       if (e.day !== day || e.slotId !== slot.id) return false;
                       
                       const targetIdLower = selectedTargetId?.toLowerCase().trim();

                       if (viewMode === 'SECTION') return e.sectionId?.toLowerCase().trim() === targetIdLower;
                       if (viewMode === 'TEACHER') {
                         if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
                         if (e.blockId) {
                           const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                           return block?.allocations.some(a => a.teacherId?.toLowerCase().trim() === targetIdLower);
                         }
                         return false;
                       }
                       if (viewMode === 'ROOM') {
                         if (e.room?.toLowerCase().trim() === targetIdLower) return true;
                         if (e.blockId) {
                           const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                           return block?.allocations.some(a => a.room?.toLowerCase().trim() === targetIdLower);
                         }
                         return false;
                       }
                       return false;
                     });

                     const distinctEntries = (viewMode === 'TEACHER' || viewMode === 'ROOM') 
                       ? cellEntries.filter((v, i, a) => {
                          if (!v.blockId) return true;
                          return a.findIndex(t => t.blockId === v.blockId) === i;
                       })
                       : cellEntries;

                     const isSource = swapSource && swapSource.day === day && swapSource.slotId === slot.id;
                     const clashReason = clashMap[`${day}-${slot.id}`];

                     return (
                       <td 
                         key={slot.id} 
                         onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
                         className={`p-4 border border-slate-300 dark:border-slate-700 relative min-h-[100px] transition-all ${slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10' : isSource ? 'bg-indigo-100 ring-2 ring-indigo-500' : clashReason ? 'bg-rose-50/60 dark:bg-rose-900/20' : 'hover:bg-amber-50/20 cursor-pointer'}`}
                       >
                         {clashReason && (
                           <div className="absolute top-1 right-1 z-10" title={clashReason}>
                             <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></div>
                           </div>
                         )}
                         {slot.isBreak ? (
                           <div className="text-center"><p className="text-[11px] font-black text-amber-600 dark:text-amber-400 uppercase italic">Recess</p></div>
                         ) : distinctEntries.length > 0 ? (
                           distinctEntries.map(e => {
                             let displaySubject = e.subject;
                             let displaySubtext = viewMode === 'TEACHER' ? e.className : e.teacherName;
                             if (e.secondaryTeacherName && viewMode !== 'TEACHER') {
                               displaySubtext = `${e.teacherName} + ${e.secondaryTeacherName}`;
                             }
                             let displayRoom = e.room;
                             let displayClass = e.className;

                             const entryWing = config.wings.find(w => w.id === e.wingId);
                             const wingLabel = entryWing ? (entryWing.name.includes('Boys') ? 'B' : entryWing.name.includes('Girls') ? 'G' : 'P') : '';

                             if (e.blockId) {
                               const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                               if (viewMode === 'TEACHER') {
                                 const alloc = block?.allocations.find(a => a.teacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                                 if (alloc) {
                                   displaySubject = alloc.subject;
                                   displayRoom = alloc.room || 'Pool';
                                 }
                               } else if (viewMode === 'ROOM') {
                                 const alloc = block?.allocations.find(a => a.room?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                                 if (alloc) {
                                   displaySubject = alloc.subject;
                                   displaySubtext = alloc.teacherName;
                                   // Collect all classes in this room for this block
                                   displayClass = cellEntries
                                     .filter(ce => ce.blockId === e.blockId)
                                     .map(ce => ce.className)
                                     .join(' + ');
                                 }
                               }
                             }

                             return (
                               <div key={e.id} className="space-y-1.5 text-center relative">
                                 <div className="flex flex-col items-center justify-center gap-1">
                                    <div className="flex items-center gap-2">
                                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase leading-tight break-words whitespace-normal">{displaySubject}</p>
                                       {(viewMode === 'TEACHER' || viewMode === 'ROOM') && wingLabel && (
                                         <span className={`px-1 rounded-[4px] text-[7px] font-black leading-none py-0.5 border ${wingLabel === 'B' ? 'bg-sky-50 text-sky-600 border-sky-100' : wingLabel === 'G' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`} title={entryWing?.name}>
                                            {wingLabel}
                                         </span>
                                       )}
                                    </div>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase leading-tight break-words whitespace-normal">{displaySubtext}</p>
                                    {viewMode === 'ROOM' && <p className="text-[7px] font-black text-amber-500 uppercase leading-tight break-words whitespace-normal mt-1">{displayClass}</p>}
                                 </div>
                                 {viewMode !== 'ROOM' && <p className="text-[7px] font-black text-sky-500 uppercase italic opacity-70 leading-tight break-words whitespace-normal">{displayRoom}</p>}
                                 {e.isManual && <div className="w-1 h-1 bg-amber-400 rounded-full mx-auto" title="Manual Entry"></div>}
                               </div>
                             );
                           })
                         ) : isDraftMode && isManagement ? (
                           <div className="flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                             <span className="text-[18px] text-amber-400 font-black">+</span>
                           </div>
                         ) : null}
                       </td>
                     );
                   })}
                 </tr>
               ))}
             </tbody>
           </table>
        </div>

        {/* MOBILE VERTICAL VIEW */}
        <div className="md:hidden space-y-6">
           <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
              {DAYS.map(day => (
                <button 
                  key={day} 
                  onClick={() => setSelectedDayMobile(day)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${selectedDayMobile === day ? 'bg-[#001f3f] text-[#d4af37] shadow-lg scale-105' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border border-slate-100 dark:border-slate-700'}`}
                >
                  {day}
                </button>
              ))}
           </div>

           <div className="space-y-4">
              {displayedSlots.map(slot => {
                const day = selectedDayMobile;
                const cellEntries = activeData.filter(e => {
                  if (e.day !== day || e.slotId !== slot.id) return false;
                  const targetIdLower = selectedTargetId?.toLowerCase().trim();
                  if (viewMode === 'SECTION') return e.sectionId?.toLowerCase().trim() === targetIdLower;
                  if (viewMode === 'TEACHER') {
                    if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
                    if (e.blockId) {
                      const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                      return block?.allocations.some(a => a.teacherId?.toLowerCase().trim() === targetIdLower);
                    }
                    return false;
                  }
                  if (viewMode === 'ROOM') {
                    if (e.room?.toLowerCase().trim() === targetIdLower) return true;
                    if (e.blockId) {
                      const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                      return block?.allocations.some(a => a.room?.toLowerCase().trim() === targetIdLower);
                    }
                    return false;
                  }
                  return false;
                });

                const distinctEntries = (viewMode === 'TEACHER' || viewMode === 'ROOM') 
                  ? cellEntries.filter((v, i, a) => {
                     if (!v.blockId) return true;
                     return a.findIndex(t => t.blockId === v.blockId) === i;
                  })
                  : cellEntries;

                const isSource = swapSource && swapSource.day === day && swapSource.slotId === slot.id;
                const clashReason = clashMap[`${day}-${slot.id}`];

                return (
                  <div 
                    key={slot.id} 
                    onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
                    className={`p-5 rounded-[2rem] border relative transition-all ${slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-300 dark:border-amber-700' : isSource ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500' : clashReason ? 'bg-rose-50 border-rose-200' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                       <div className="flex items-center gap-3">
                          <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{slot.label}</span>
                          <span className="text-[13px] font-black text-[#001f3f] dark:text-white tabular-nums">{slot.startTime} - {slot.endTime}</span>
                       </div>
                       {clashReason && <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></div>}
                    </div>

                    {slot.isBreak ? (
                      <p className="text-center text-[12px] font-black text-amber-600 dark:text-amber-400 uppercase italic py-2">Recess Break</p>
                    ) : distinctEntries.length > 0 ? (
                      <div className="space-y-3">
                        {distinctEntries.map(e => {
                          let displaySubject = e.subject;
                          let displaySubtext = viewMode === 'TEACHER' ? e.className : e.teacherName;
                          if (e.secondaryTeacherName && viewMode !== 'TEACHER') {
                            displaySubtext = `${e.teacherName} + ${e.secondaryTeacherName}`;
                          }
                          let displayRoom = e.room;
                          let displayClass = e.className;

                          const entryWing = config.wings.find(w => w.id === e.wingId);
                          const wingLabel = entryWing ? (entryWing.name.includes('Boys') ? 'B' : entryWing.name.includes('Girls') ? 'G' : 'P') : '';

                          if (e.blockId) {
                            const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                            if (viewMode === 'TEACHER') {
                              const alloc = block?.allocations.find(a => a.teacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displayRoom = alloc.room || 'Pool';
                              }
                            } else if (viewMode === 'ROOM') {
                              const alloc = block?.allocations.find(a => a.room?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displaySubtext = alloc.teacherName;
                                // Collect all classes in this room for this block
                                displayClass = cellEntries
                                  .filter(ce => ce.blockId === e.blockId)
                                  .map(ce => ce.className)
                                  .join(' + ');
                              }
                            }
                          }

                          return (
                            <div key={e.id} className="flex items-center justify-between">
                               <div>
                                  <div className="flex items-center gap-2">
                                     <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase leading-tight break-words whitespace-normal">{displaySubject}</p>
                                     {(viewMode === 'TEACHER' || viewMode === 'ROOM') && wingLabel && (
                                       <span className={`px-1.5 rounded-[4px] text-[8px] font-black leading-none py-0.5 border ${wingLabel === 'B' ? 'bg-sky-50 text-sky-600 border-sky-100' : wingLabel === 'G' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                          {wingLabel}
                                       </span>
                                     )}
                                  </div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase leading-tight break-words whitespace-normal mt-1">{displaySubtext}</p>
                                  {viewMode === 'ROOM' && <p className="text-[9px] font-black text-amber-500 uppercase leading-tight break-words whitespace-normal mt-1">{displayClass}</p>}
                               </div>
                               <div className="text-right">
                                  <p className="text-[9px] font-black text-sky-500 uppercase italic leading-tight break-words whitespace-normal">{displayRoom}</p>
                                  {e.isManual && <p className="text-[7px] font-black text-amber-500 uppercase mt-1">Manual</p>}
                               </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : isDraftMode && isManagement ? (
                      <div className="flex items-center justify-center py-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl">
                         <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">+ Assign Class</span>
                      </div>
                    ) : (
                      <p className="text-center text-[9px] font-black text-slate-300 uppercase italic py-2">Free Period</p>
                    )}
                  </div>
                );
              })}
           </div>
        </div>
      </div>

      {viewingEntryId && (
        <div className="fixed inset-0 z-[1100] bg-[#001f3f]/90 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-8 md:p-10 shadow-2xl border-4 border-amber-400/20 animate-in zoom-in duration-300">
              {(() => {
                const entry = currentTimetable.find(e => e.id === viewingEntryId);
                if (!entry) return null;
                const block = entry.blockId ? config.combinedBlocks?.find(b => b.id === entry.blockId) : null;
                
                return (
                  <div className="space-y-8">
                    <div className="text-center">
                       <div className="w-16 h-16 bg-amber-50 rounded-3xl flex items-center justify-center text-amber-500 mx-auto mb-6 border-2 border-amber-100">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                       </div>
                       <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{entry.subject}</h4>
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">{entry.day} • Period {entry.slotId}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                       <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Subject Teacher</p>
                          <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase">{entry.teacherName}</p>
                       </div>
                       {entry.secondaryTeacherName && (
                         <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-800">
                            <p className="text-[7px] font-black text-amber-600 uppercase tracking-widest mb-1">Lab Technician</p>
                            <p className="text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase">{entry.secondaryTeacherName}</p>
                         </div>
                       )}
                       <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Room</p>
                          <p className="text-[11px] font-black text-sky-500 uppercase italic">{entry.room || 'N/A'}</p>
                       </div>
                       <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Class</p>
                          <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase">{entry.className}</p>
                       </div>
                       <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Identity</p>
                          <p className="text-[11px] font-black text-amber-500 uppercase">{entry.blockId ? 'Group Block' : entry.isManual ? 'Manual' : 'System Gen'}</p>
                       </div>
                    </div>

                    {block && (
                      <div className="p-5 bg-sky-50 border-2 border-sky-100 rounded-3xl">
                         <p className="text-[8px] font-black text-sky-600 uppercase tracking-widest mb-2 italic">Synchronized Block Details:</p>
                         <p className="text-[10px] font-bold text-sky-700 leading-relaxed uppercase">This period is part of the "{block.title}" group. Actions will affect all synchronized sections.</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 pt-4">
                       <button 
                         onClick={() => handleReplaceEntry(entry.id)}
                         className="py-5 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all"
                       >
                         Replace Period
                       </button>
                       <button 
                         onClick={() => handleDeleteEntry(entry.id)}
                         className="py-5 bg-rose-50 text-rose-600 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 border-rose-100 hover:bg-rose-100 transition-all"
                       >
                         Delete Period
                       </button>
                    </div>
                    <button onClick={() => setViewingEntryId(null)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-[#001f3f] transition-colors">Close Details</button>
                  </div>
                );
              })()}
           </div>
        </div>
      )}

      {assigningSlot && (
        <div className="fixed inset-0 z-[1000] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 shadow-2xl space-y-6 md:space-y-8 animate-in zoom-in duration-300 overflow-y-auto max-h-[90vh] scrollbar-hide">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Manual Allocation</h4>
                 {!assigningSlot.sectionId ? (
                   <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-3">{assigningSlot.day} • Period {assigningSlot.slotId}</p>
                 ) : (
                   <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mt-3">Advanced Form Deployment</p>
                 )}
              </div>

              <div className="flex bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
                {(['STANDARD', 'POOL', 'ACTIVITY', 'LAB'] as const).map(type => (
                  <button key={type} onClick={() => setAssignmentType(type)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${assignmentType === type ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{type}</button>
                ))}
              </div>

              <div className="space-y-4">
                 {(!assigningSlot.sectionId || viewMode !== 'SECTION') && (
                    <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
                       <div className="space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Day</label>
                          <select value={selAssignDay} onChange={e => setSelAssignDay(e.target.value)} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none">
                             {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Period</label>
                          <select value={selAssignSlotId} onChange={e => setSelAssignSlotId(parseInt(e.target.value))} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none">
                             {slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                       </div>
                       <div className="col-span-2 space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Class (Section)</label>
                          <select value={selAssignSectionId} onChange={e => setSelAssignSectionId(e.target.value)} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none border-2 border-amber-400/50">
                             <option value="">Select Section...</option>
                             {config.sections.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                          </select>
                       </div>
                    </div>
                 )}

                 {assignmentType === 'STANDARD' && (
                    <>
                       <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Faculty Member</label>
                          <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                             <option value="">Select Staff...</option>
                             {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Instructional Domain</label>
                          <select value={selAssignSubject} onChange={e => setSelAssignSubject(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                             <option value="">Select Subject...</option>
                             {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Room Allocation</label>
                          <select value={selAssignRoom} onChange={e => setSelAssignRoom(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                             <option value="">Assign Room...</option>
                             {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                       </div>
                    </>
                 )}
                 {assignmentType === 'LAB' && (
                    <div className="space-y-6">
                       {/* Group 1 */}
                       <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                          <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 1 (Primary)</p>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                                <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                                <select value={selLabTechnicianId} onChange={e => setSelLabTechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                                <select value={selAssignSubject} onChange={e => setSelAssignSubject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Subject...</option>
                                   {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                                <select value={selAssignRoom} onChange={e => setSelAssignRoom(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Assign Room...</option>
                                   {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                             </div>
                          </div>
                       </div>

                       {/* Group 2 */}
                       <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                          <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 2 (Optional)</p>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                                <select value={selLab2TeacherId} onChange={e => setSelLab2TeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                                <select value={selLab2TechnicianId} onChange={e => setSelLab2TechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                                <select value={selLab2Subject} onChange={e => setSelLab2Subject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Subject...</option>
                                   {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                                <select value={selLab2Room} onChange={e => setSelLab2Room(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Assign Room...</option>
                                   {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                             </div>
                          </div>
                       </div>

                       {/* Group 3 */}
                       <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                          <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 3 (Optional)</p>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                                <select value={selLab3TeacherId} onChange={e => setSelLab3TeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                                <select value={selLab3TechnicianId} onChange={e => setSelLab3TechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Staff...</option>
                                   {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                             </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                                <select value={selLab3Subject} onChange={e => setSelLab3Subject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Select Subject...</option>
                                   {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                                <select value={selLab3Room} onChange={e => setSelLab3Room(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                                   <option value="">Assign Room...</option>
                                   {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                             </div>
                          </div>
                       </div>

                       <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Secondary Section (Optional)</label>
                          <select value={selLabSection2Id} onChange={e => setSelLabSection2Id(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                             <option value="">None (Single Section)</option>
                             {config.sections.filter(s => s.id !== (assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : ''))).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                          </select>
                       </div>
                       
                       <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                          <p className="text-[10px] font-black text-amber-600 uppercase italic">Note: Lab periods are automatically assigned as a double period (2 consecutive slots). Multiple groups will be assigned to the same section(s) simultaneously.</p>
                       </div>
                    </div>
                 )}
                 {assignmentType === 'POOL' && (
                    <div className="space-y-1">
                       <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Grade Pool Template</label>
                       <select value={selPoolId} onChange={e => setSelPoolId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                          <option value="">Select Template...</option>
                          {config.combinedBlocks?.filter(b => {
                             const targetSecId = assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                             const targetSec = config.sections.find(s => s.id === targetSecId);
                             if (!targetSec) return false;
                             const targetGradeName = config.grades.find(g => g.id === targetSec.gradeId)?.name;
                             const blockGradeName = config.grades.find(g => g.id === b.gradeId)?.name;
                             return targetGradeName === blockGradeName || (b.sectionIds && b.sectionIds.includes(targetSec.id));
                          }).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                       </select>
                    </div>
                 )}
                 {assignmentType === 'ACTIVITY' && (
                    <div className="space-y-1">
                       <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Extra Curricular Rule</label>
                       <select value={selActivityId} onChange={e => setSelActivityId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                          <option value="">Select Rule...</option>
                          {config.extraCurricularRules?.filter(r => (r.sectionIds || []).includes(assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : ''))).map(r => <option key={r.id} value={r.id}>{r.subject}</option>)}
                       </select>
                    </div>
                 )}
              </div>

              {currentClash && (
                 <div className="p-5 bg-rose-50 border-2 border-rose-200 rounded-3xl animate-pulse">
                    <div className="flex items-center gap-3">
                       <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                       <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest leading-tight">Institutional Policy Conflict Detected</p>
                    </div>
                    <p className="text-[11px] font-bold text-rose-500 mt-3 italic">“{currentClash}”</p>
                 </div>
              )}

              <div className="pt-6 space-y-4">
                 <button 
                   onClick={handleQuickAssign} 
                   disabled={!isQuickAssignValid}
                   className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 ${!isQuickAssignValid ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950'}`}
                 >
                   Authorize Allocation
                 </button>
                 <button onClick={() => setAssigningSlot(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-rose-500 transition-colors">Abort Changes</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

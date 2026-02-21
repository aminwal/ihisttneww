
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, ExtraCurricularRule } from '../types.ts';
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

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{ day: string, slotId: number, entryId: string } | null>(null);

  const [assigningSlot, setAssigningSlot] = useState<{ day: string, slotId: number, sectionId?: string } | null>(null);
  const [assignmentType, setAssignmentType] = useState<'STANDARD' | 'POOL' | 'ACTIVITY'>('STANDARD');
  const [selAssignTeacherId, setSelAssignTeacherId] = useState('');
  const [selAssignSubject, setSelAssignSubject] = useState('');
  const [selAssignRoom, setSelAssignRoom] = useState('');
  const [selPoolId, setSelPoolId] = useState('');
  const [selActivityId, setSelActivityId] = useState('');
  const [selAssignDay, setSelAssignDay] = useState<string>('');
  const [selAssignSlotId, setSelAssignSlotId] = useState<number>(1);
  const [selAssignSectionId, setSelAssignSectionId] = useState<string>('');

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

  const checkCollision = useCallback((teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string, currentBatch?: TimeTableEntry[]) => {
    const dataset = currentBatch || currentTimetable;
    const dayEntries = dataset.filter(e => e.day === day && e.slotId === slotId && e.id !== excludeEntryId);
    
    let incomingTeachers = [teacherId];
    let incomingRooms = [room];
    
    if (teacherId === 'POOL_VAR') {
       const poolTemplate = config.combinedBlocks?.find(b => b.id === (dataset.find(e => e.day === day && e.slotId === slotId && e.blockId)?.blockId));
       if (poolTemplate) {
          incomingTeachers = poolTemplate.allocations.map(a => a.teacherId);
          incomingRooms = poolTemplate.allocations.map(a => a.room).filter((r): r is string => !!r);
       }
    }

    for (const e of dayEntries) {
      if (e.sectionId === sectionId) return `Class Collision: ${e.className} already has ${e.subject} at this time.`;

      const existingTeachers = e.blockId 
        ? (config.combinedBlocks?.find(b => b.id === e.blockId)?.allocations.map(a => a.teacherId) || [])
        : [e.teacherId];

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
      if (!pool) return null;
      for (const sid of pool.sectionIds) {
        const clash = checkCollision('POOL_VAR', sid, finalDay, finalSlotId, '');
        if (clash) return `Pool Clash (Section ${config.sections.find(s => s.id === sid)?.name}): ${clash}`;
      }
    }
    else if (assignmentType === 'ACTIVITY') {
      if (!selActivityId || !finalSectionId) return null;
      const rule = config.extraCurricularRules?.find(r => r.id === selActivityId);
      if (!rule) return null;
      return checkCollision(rule.teacherId, finalSectionId, finalDay, finalSlotId, rule.room);
    }
    return null;
  }, [assigningSlot, selAssignSectionId, selectedTargetId, viewMode, selAssignDay, selAssignSlotId, assignmentType, selAssignTeacherId, selAssignRoom, selPoolId, selActivityId, checkCollision, config.combinedBlocks, config.extraCurricularRules, config.sections]);

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
    else if (assignmentType === 'POOL') {
      const pool = config.combinedBlocks?.find(b => b.id === selPoolId);
      if (!pool) return;
      
      for (const sid of pool.sectionIds) {
        const clash = checkCollision('POOL_VAR', sid, finalDay, finalSlotId, '');
        if (clash) { alert(`Pool Clash for Section ${config.sections.find(s => s.id === sid)?.name}: ${clash}`); return; }
      }

      const newEntries: TimeTableEntry[] = pool.sectionIds.map(sid => {
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

  const handleGenerateAnchors = () => {
    if (!isDraftMode) return;
    showToast("Phase 1: Analyzing registry anchors...", "info");
    const teachersWithAnchors = users.filter(u => !u.isResigned && !!u.classTeacherOf);
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    teachersWithAnchors.forEach(teacher => {
      const section = config.sections.find(s => s.id === teacher.classTeacherOf);
      const asgn = assignments.find(a => a.teacherId === teacher.id);
      if (!section || !asgn || !asgn.anchorSubject) return;

      DAYS.forEach(day => {
        const clash = checkCollision(teacher.id, section.id, day, 1, `ROOM ${section.fullName}`, undefined, [...currentTimetable, ...newEntries]);
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

    if (count > 0) {
      setCurrentTimetable(prev => [...prev, ...newEntries]);
      HapticService.success();
      showToast(`Phase 1: Successfully deployed ${count} morning registry anchors.`, "success");
    } else {
      showToast("Phase 1: No eligible anchors found for deployment.", "warning");
    }
  };

  const handleGeneratePools = () => {
    if (!isDraftMode || !config.combinedBlocks) return;
    showToast("Phase 2: Synchronizing subject pools...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    config.combinedBlocks.forEach(pool => {
      let placed = 0;
      for (const day of DAYS) {
        if (placed >= pool.weeklyPeriods) break;
        for (const slot of [4, 5, 6, 7, 8]) {
          if (placed >= pool.weeklyPeriods) break;
          
          let allFree = true;
          for (const sid of pool.sectionIds) {
            if (checkCollision('POOL_VAR', sid, day, slot, '', undefined, [...currentTimetable, ...newEntries])) {
              allFree = false;
              break;
            }
          }

          if (allFree) {
            pool.sectionIds.forEach(sid => {
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
            placed++;
            count++;
          }
        }
      }
    });

    if (count > 0) {
      setCurrentTimetable(prev => [...prev, ...newEntries]);
      HapticService.success();
      showToast(`Phase 2: Synchronized ${count} grade-wide parallel blocks.`, "success");
    } else {
      showToast("Phase 2: Matrix full. No additional pool slots could be synchronized.", "warning");
    }
  };

  const handleGenerateCurriculars = () => {
    if (!isDraftMode || !config.extraCurricularRules) return;
    showToast("Phase 3: Deploying curricular mandates...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    config.extraCurricularRules.forEach(rule => {
      const teacher = users.find(u => u.id === rule.teacherId);
      if (!teacher) return;

      rule.sectionIds.forEach(sid => {
        const section = config.sections.find(s => s.id === sid);
        if (!section) return;

        let placed = 0;
        for (const day of DAYS) {
          if (placed >= rule.periodsPerWeek) break;
          for (let slot = 1; slot <= 10; slot++) {
            const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
            const slotObj = wingSlots.find(s => s.id === slot);
            if (!slotObj || slotObj.isBreak) continue;

            if (placed >= rule.periodsPerWeek) break;
            const clash = checkCollision(teacher.id, section.id, day, slot, rule.room, undefined, [...currentTimetable, ...newEntries]);
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

    if (count > 0) {
      setCurrentTimetable(prev => [...prev, ...newEntries]);
      HapticService.success();
      showToast(`Phase 3: Deployed ${count} specialized curricular periods.`, "success");
    } else {
      showToast("Phase 3: No valid slots identified for curricular rules.", "warning");
    }
  };

  const handleGenerateLoads = () => {
    if (!isDraftMode) return;
    showToast("Phase 4: Distributing remaining loads...", "info");
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    assignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      if (!teacher) return;

      asgn.loads.forEach(load => {
        let placed = 0;
        
        // Correct Cross-Wing recognition logic for automated load generation
        const targetSections = config.sections.filter(s => 
          asgn.targetSectionIds.length > 0 
            ? asgn.targetSectionIds.includes(s.id) 
            : s.gradeId === asgn.gradeId
        );
        
        targetSections.forEach(section => {
          let sectionPlaced = 0;
          const targetPerSection = load.periods;

          for (const day of DAYS) {
            if (sectionPlaced >= targetPerSection) break;
            for (let slot = 1; slot <= 10; slot++) {
              if (sectionPlaced >= targetPerSection) break;
              const clash = checkCollision(teacher.id, section.id, day, slot, load.room || `ROOM ${section.fullName}`, undefined, [...currentTimetable, ...newEntries]);
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

    if (count > 0) {
      setCurrentTimetable(prev => [...prev, ...newEntries]);
      HapticService.success();
      showToast(`Phase 4: Distributed ${count} instructional load blocks.`, "success");
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
      } else if (entryId) {
        if(confirm("Dismantle this instruction brick?")) {
           setCurrentTimetable(prev => prev.filter(e => e.id !== entryId));
        }
      }
    }
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
    
    const collision = checkCollision(sourceEntry.teacherId, sourceEntry.sectionId, target.day, target.slotId, sourceEntry.room || '', source.entryId);
    if (collision) { alert(`REJECTED: ${collision}`); setSwapSource(null); return; }
    
    const updated = [...currentTimetable].map(e => {
      if (e.id === source.entryId) return { ...e, day: target.day, slotId: target.slotId };
      if (target.entryId && e.id === target.entryId) return { ...e, day: source.day, slotId: source.slotId };
      return e;
    });
    setCurrentTimetable(updated);
    setSwapSource(null);
    HapticService.success();
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
      }
      setTimetable([...timetableDraft]);
      setIsDraftMode(false);
      showToast("Matrix successfully deployed to Production Registry.", "success");
    } catch (e: any) { alert(e.message); } finally { setIsProcessing(false); }
  };

  const isQuickAssignValid = useMemo(() => {
    const finalSectionId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
    const hasSubject = assignmentType === 'STANDARD' ? !!selAssignSubject : assignmentType === 'POOL' ? !!selPoolId : !!selActivityId;
    const hasTeacher = assignmentType === 'STANDARD' ? !!selAssignTeacherId : true;
    return !!finalSectionId && hasSubject && hasTeacher && !currentClash;
  }, [assigningSlot, selAssignSectionId, viewMode, selectedTargetId, assignmentType, selAssignSubject, selPoolId, selActivityId, selAssignTeacherId, currentClash]);

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
                className="bg-[#001f3f] text-[#d4af37] px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all"
              >
                Manual Entry
              </button>
              <button 
                onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }}
                className={`px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all ${isSwapMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 border border-indigo-100'}`}
              >
                {isSwapMode ? 'Cancel Swap' : 'Swap Mode'}
              </button>
              <button 
                onClick={handlePublishToLive}
                disabled={isProcessing}
                className="bg-[#001f3f] text-[#d4af37] px-8 py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg active:scale-95"
              >
                {isProcessing ? 'Deploying...' : 'Deploy Live'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
        <div className="flex flex-col xl:flex-row items-center gap-6">
           <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
             {(['SECTION', 'TEACHER', 'ROOM'] as const).map(mode => (
               <button key={mode} onClick={() => setViewMode(mode)} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === mode ? 'bg-white dark:bg-slate-900 text-[#001f3f] dark:text-white shadow-sm' : 'text-slate-400'}`}>{mode}</button>
             ))}
           </div>

           <div className="flex flex-wrap items-center gap-4">
              <select 
                value={activeWingId} 
                onChange={(e) => setActiveWingId(e.target.value)}
                disabled={viewMode !== 'SECTION'}
                className={`bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white transition-all ${viewMode !== 'SECTION' ? 'opacity-50 cursor-not-allowed border-slate-200' : ''}`}
              >
                {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>

              <select 
                value={selectedTargetId} 
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className="bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white min-w-[200px]"
              >
                {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
           </div>
        </div>

        {isDraftMode && isManagement && (
          <div className="flex flex-wrap gap-3 p-6 bg-amber-50 dark:bg-amber-900/10 rounded-[2.5rem] border border-amber-200 dark:border-amber-900/30">
            <p className="w-full text-[9px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-2 italic">Intelligence Matrix Generators:</p>
            <button onClick={handleGenerateAnchors} className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 1: Anchors</button>
            <button onClick={handleGeneratePools} className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 2: Pools</button>
            <button onClick={handleGenerateCurriculars} className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 3: Activities</button>
            <button onClick={handleGenerateLoads} className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all">Phase 4: Loads</button>
          </div>
        )}

        <div className="overflow-x-auto scrollbar-hide">
           <table className="w-full border-collapse border border-slate-100 dark:border-slate-800">
             <thead>
               <tr className="bg-slate-50 dark:bg-slate-800/50">
                  <th className="p-4 border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase text-slate-400 w-24">Day</th>
                  {displayedSlots.map(slot => (
                    <th key={slot.id} className="p-4 border border-slate-100 dark:border-slate-800 text-center bg-[#001f3f]/5 min-w-[120px]">
                       <p className="text-[11px] font-black text-[#001f3f] dark:text-white tabular-nums leading-none">{slot.startTime} - {slot.endTime}</p>
                       <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1.5 opacity-60 italic">{slot.label}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {DAYS.map(day => (
                 <tr key={day}>
                   <td className="p-4 border border-slate-100 dark:border-slate-800 bg-slate-50/50 font-black text-[10px] uppercase text-slate-500 italic">{day}</td>
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

                     const distinctEntries = viewMode === 'TEACHER' 
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
                         className={`p-4 border border-slate-100 dark:border-slate-800 relative min-h-[100px] transition-all ${slot.isBreak ? 'bg-amber-50/50' : isSource ? 'bg-indigo-100 ring-2 ring-indigo-500' : clashReason ? 'bg-rose-50/60 dark:bg-rose-900/20' : 'hover:bg-amber-50/20 cursor-pointer'}`}
                       >
                         {clashReason && (
                           <div className="absolute top-1 right-1 z-10" title={clashReason}>
                             <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></div>
                           </div>
                         )}
                         {slot.isBreak ? (
                           <div className="text-center"><p className="text-[9px] font-black text-amber-500 uppercase italic">Recess</p></div>
                         ) : distinctEntries.length > 0 ? (
                           distinctEntries.map(e => {
                             let displaySubject = e.blockId ? e.blockName : e.subject;
                             let displaySubtext = viewMode === 'TEACHER' ? e.className : e.teacherName;
                             let displayRoom = e.room;

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
                                 }
                               }
                             }

                             return (
                               <div key={e.id} className="space-y-1.5 text-center relative">
                                 <div className="flex flex-col items-center justify-center gap-1">
                                    <div className="flex items-center gap-2">
                                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase leading-tight">{displaySubject}</p>
                                       {(viewMode === 'TEACHER' || viewMode === 'ROOM') && wingLabel && (
                                         <span className={`px-1 rounded-[4px] text-[7px] font-black leading-none py-0.5 border ${wingLabel === 'B' ? 'bg-sky-50 text-sky-600 border-sky-100' : wingLabel === 'G' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`} title={entryWing?.name}>
                                            {wingLabel}
                                         </span>
                                       )}
                                    </div>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase leading-none">{displaySubtext}</p>
                                 </div>
                                 {viewMode !== 'ROOM' && <p className="text-[7px] font-black text-sky-500 uppercase italic opacity-70">{displayRoom}</p>}
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
      </div>

      {assigningSlot && (
        <div className="fixed inset-0 z-[1000] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-y-auto max-h-[90vh] scrollbar-hide">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Manual Allocation</h4>
                 {!assigningSlot.sectionId ? (
                   <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-3">{assigningSlot.day} • Period {assigningSlot.slotId}</p>
                 ) : (
                   <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mt-3">Advanced Form Deployment</p>
                 )}
              </div>

              <div className="flex bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
                {(['STANDARD', 'POOL', 'ACTIVITY'] as const).map(type => (
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
                             return targetGradeName === blockGradeName || b.sectionIds.includes(targetSec.id);
                          }).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                       </select>
                    </div>
                 )}
                 {assignmentType === 'ACTIVITY' && (
                    <div className="space-y-1">
                       <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Extra Curricular Rule</label>
                       <select value={selActivityId} onChange={e => setSelActivityId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                          <option value="">Select Rule...</option>
                          {config.extraCurricularRules?.filter(r => r.sectionIds.includes(assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : ''))).map(r => <option key={r.id} value={r.id}>{r.subject}</option>)}
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

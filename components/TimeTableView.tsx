
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
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ 
  user, users, timetable, setTimetable, timetableDraft, setTimetableDraft, 
  isDraftMode, setIsDraftMode, substitutions, config, assignments, 
  setAssignments, onManualSync, triggerConfirm, isSandbox, addSandboxLog
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

  // ASSIGNMENT DRAWER STATE
  const [assigningSlot, setAssigningSlot] = useState<{ day: string, slotId: number } | null>(null);
  const [assignmentType, setAssignmentType] = useState<'STANDARD' | 'POOL' | 'ACTIVITY'>('STANDARD');
  const [selAssignTeacherId, setSelAssignTeacherId] = useState('');
  const [selAssignSubject, setSelAssignSubject] = useState('');
  const [selAssignRoom, setSelAssignRoom] = useState('');
  const [selPoolId, setSelPoolId] = useState('');
  const [selActivityId, setSelActivityId] = useState('');

  const currentTimetable = useMemo(() => {
    const primary = isDraftMode ? timetableDraft : timetable;
    if (primary.length === 0) return isDraftMode ? timetable : timetableDraft;
    return primary;
  }, [isDraftMode, timetable, timetableDraft]);

  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const slots = useMemo(() => {
    const wing = config.wings.find(w => w.id === activeWingId);
    return config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || PRIMARY_SLOTS;
  }, [activeWingId, config.slotDefinitions, config.wings]);

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

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(e => {
      const key = `${e.day}-${e.slotId}`;
      if (!registry.has(key)) registry.set(key, [e]);
      else registry.get(key)!.push(e);
    });
    return registry;
  }, [currentTimetable]);

  // COLLISION ENGINE
  const checkCollision = (teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string, currentBatch?: TimeTableEntry[]) => {
    const dataset = currentBatch || currentTimetable;
    const dayEntries = dataset.filter(e => e.day === day && e.slotId === slotId && e.id !== excludeEntryId);
    
    const teacherClash = dayEntries.find(e => e.teacherId === teacherId);
    if (teacherClash && teacherId !== 'POOL_VAR') return `Teacher Collision: ${teacherClash.teacherName} in ${teacherClash.className}`;
    
    const sectionClash = dayEntries.find(e => e.sectionId === sectionId);
    if (sectionClash) return `Class Collision: ${sectionClash.className} has ${sectionClash.subject}`;
    
    if (room && room !== 'Default' && !room.startsWith('ROOM ')) { 
      const roomClash = dayEntries.find(e => e.room === room);
      if (roomClash) return `Room Collision: ${room} occupied by ${roomClash.teacherName}`;
    }
    return null;
  };

  /**
   * RESTORED ENGINE LOGIC: PHASE 1 - ANCHORS
   */
  const handleGenerateAnchors = () => {
    if (!isDraftMode) return;
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

    setCurrentTimetable(prev => [...prev, ...newEntries]);
    HapticService.success();
    alert(`ANCHOR ENGINE: ${count} Morning Registry slots locked.`);
  };

  /**
   * RESTORED ENGINE LOGIC: PHASE 2 - POOLS
   */
  const handleGeneratePools = () => {
    if (!isDraftMode || !config.combinedBlocks) return;
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    config.combinedBlocks.forEach(pool => {
      let placed = 0;
      // Simple greedy search for synchronized slots
      for (const day of DAYS) {
        if (placed >= pool.weeklyPeriods) break;
        // Search available periods (usually later in the day for pools)
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
              const sect = config.sections.find(s => s.id === sid)!;
              newEntries.push({
                id: generateUUID(),
                section: sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
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

    setCurrentTimetable(prev => [...prev, ...newEntries]);
    HapticService.success();
    alert(`POOL ENGINE: ${count} Grade-wide parallel blocks synchronized.`);
  };

  /**
   * RESTORED ENGINE LOGIC: PHASE 3 - CURRICULARS
   */
  const handleGenerateCurriculars = () => {
    if (!isDraftMode || !config.extraCurricularRules) return;
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    config.extraCurricularRules.forEach(rule => {
      const teacher = users.find(u => u.id === rule.teacherId);
      if (!teacher) return;

      rule.sectionIds.forEach(sid => {
        const section = config.sections.find(s => s.id === sid)!;
        let placed = 0;
        for (const day of DAYS) {
          if (placed >= rule.periodsPerWeek) break;
          for (const slot of [3, 4, 7, 8, 9]) {
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

    setCurrentTimetable(prev => [...prev, ...newEntries]);
    HapticService.success();
    alert(`CURRICULAR ENGINE: ${count} Specialized activities deployed.`);
  };

  /**
   * RESTORED ENGINE LOGIC: PHASE 4 - LOADS
   */
  const handleGenerateLoads = () => {
    if (!isDraftMode) return;
    let newEntries: TimeTableEntry[] = [];
    let count = 0;

    assignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      if (!teacher) return;

      asgn.loads.forEach(load => {
        let placed = 0;
        const targetSections = config.sections.filter(s => s.gradeId === asgn.gradeId && (asgn.targetSectionIds.length === 0 || asgn.targetSectionIds.includes(s.id)));
        
        targetSections.forEach(section => {
          let sectionPlaced = 0;
          const targetPerSection = load.periods; // For simplicity, assume load.periods is total for this grade

          for (const day of DAYS) {
            if (sectionPlaced >= targetPerSection) break;
            for (let slot = 1; slot <= 9; slot++) {
              if (sectionPlaced >= targetPerSection) break;
              const clash = checkCollision(teacher.id, section.id, day, slot, `ROOM ${section.fullName}`, undefined, [...currentTimetable, ...newEntries]);
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

    setCurrentTimetable(prev => [...prev, ...newEntries]);
    HapticService.success();
    alert(`LOAD ENGINE: Distributed ${count} instructional blocks.`);
  };

  const handleCellClick = (day: string, slotId: number, entryId?: string) => {
    if (!isDraftMode || !isManagement) return;
    HapticService.light();

    if (isSwapMode) {
      if (!swapSource) { if (entryId) setSwapSource({ day, slotId, entryId }); }
      else { executeSwap(swapSource, { day, slotId, entryId }); }
    } else {
      if (!entryId && viewMode === 'SECTION') {
        setAssigningSlot({ day, slotId });
        setAssignmentType('STANDARD');
        setSelAssignTeacherId('');
        setSelAssignSubject('');
        setSelPoolId('');
        setSelActivityId('');
        const sect = config.sections.find(s => s.id === selectedTargetId);
        setSelAssignRoom(sect ? `ROOM ${sect.fullName}` : '');
      } else if (entryId) {
        if(confirm("Dismantle this instruction brick?")) {
           setCurrentTimetable(prev => prev.filter(e => e.id !== entryId));
        }
      }
    }
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

  const handleQuickAssign = () => {
    if (!assigningSlot) return;
    const currentSection = config.sections.find(s => s.id === selectedTargetId);
    if (!currentSection) return;

    if (assignmentType === 'STANDARD') {
      if (!selAssignTeacherId || !selAssignSubject) return;
      const teacher = users.find(u => u.id === selAssignTeacherId);
      if (!teacher) return;
      
      const clash = checkCollision(selAssignTeacherId, selectedTargetId, assigningSlot.day, assigningSlot.slotId, selAssignRoom);
      if (clash) { alert(clash); return; }

      const newEntry: TimeTableEntry = {
        id: generateUUID(),
        section: currentSection.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
        wingId: currentSection.wingId,
        gradeId: currentSection.gradeId,
        sectionId: currentSection.id,
        className: currentSection.fullName,
        day: assigningSlot.day,
        slotId: assigningSlot.slotId,
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
      const newEntries: TimeTableEntry[] = pool.sectionIds.map(sid => {
        const sect = config.sections.find(s => s.id === sid)!;
        return {
          id: generateUUID(),
          section: sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
          wingId: sect.wingId,
          gradeId: sect.gradeId,
          section_id: sect.id,
          sectionId: sect.id,
          className: sect.fullName,
          day: assigningSlot.day,
          slot_id: assigningSlot.slotId,
          slotId: assigningSlot.slotId,
          subject: pool.heading,
          subjectCategory: SubjectCategory.CORE,
          teacherId: 'POOL_VAR',
          teacherName: 'Multiple Staff',
          blockId: pool.id,
          blockName: pool.title,
          isManual: true
        };
      });
      setCurrentTimetable(prev => [...prev, ...newEntries]);
    }
    else if (assignmentType === 'ACTIVITY') {
      const rule = config.extraCurricularRules?.find(r => r.id === selActivityId);
      if (!rule) return;
      const teacher = users.find(u => u.id === rule.teacherId);
      const newEntry: TimeTableEntry = {
        id: generateUUID(),
        section: currentSection.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
        wingId: currentSection.wingId,
        gradeId: currentSection.gradeId,
        sectionId: currentSection.id,
        className: currentSection.fullName,
        day: assigningSlot.day,
        slotId: assigningSlot.slotId,
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

  const handlePublishToLive = async () => {
    if (!confirm("Deploy Matrix to Production?")) return;
    setIsProcessing(true);
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('timetable_entries').delete().neq('id', 'SYSTEM_LOCK');
        await supabase.from('timetable_entries').insert(timetableDraft.map(e => ({
          id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId,
          section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId,
          subject: e.subject, subject_category: e.subject_category, teacher_id: e.teacherId,
          teacher_name: e.teacherName, room: e.room, is_substitution: false,
          is_manual: e.isManual, block_id: e.blockId, block_name: e.blockName
        })));
      }
      setTimetable([...timetableDraft]);
      setIsDraftMode(false);
      alert("Matrix Deployed.");
    } catch (e: any) { alert(e.message); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex flex-col space-y-4 animate-in fade-in duration-700 pb-20 px-2 relative min-h-[600px]">
      {/* RESTORED HEADER CONTROLS WITH ENGINE BUTTONS */}
      <div className="flex flex-col xl:flex-row justify-between items-center gap-6 bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800">
         <div className="space-y-1">
            <h1 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em]">Institutional Integrity Sentinel • {isDraftMode ? 'Draft' : 'Live'}</p>
         </div>

         {isManagement && (
           <div className="flex flex-wrap items-center justify-center gap-3">
              {/* RESTORED: Generation Engine Group */}
              {isDraftMode && (
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700">
                   <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-2">Engine:</span>
                   <button onClick={handleGenerateAnchors} className="px-3 py-1.5 bg-[#001f3f] text-amber-400 rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all shadow-sm">Anchors</button>
                   <button onClick={handleGeneratePools} className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all shadow-sm">Pools</button>
                   <button onClick={handleGenerateCurriculars} className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all shadow-sm">Curriculars</button>
                   <button onClick={handleGenerateLoads} className="px-3 py-1.5 bg-[#001f3f] text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-950 transition-all shadow-sm">Loads</button>
                   <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                   <button onClick={() => { if(confirm("Purge Draft Matrix?")) setCurrentTimetable([]); }} className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[8px] font-black uppercase hover:bg-rose-700 transition-all shadow-sm">Purge</button>
                </div>
              )}

              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden md:block"></div>

              <button onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-md ${isSwapMode ? 'bg-amber-400 text-[#001f3f] scale-105 ring-4 ring-amber-400/20' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                {isSwapMode ? 'Swap Mode Active' : 'Swap Mode'}
              </button>
              
              <button onClick={handlePublishToLive} disabled={!isDraftMode || isProcessing} className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all disabled:opacity-30">Deploy Live</button>
              
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shadow-inner border border-slate-200 dark:border-slate-700">
                 <button onClick={() => setIsDraftMode(false)} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${!isDraftMode ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'}`}>Live</button>
                 <button onClick={() => setIsDraftMode(true)} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${isDraftMode ? 'bg-[#4338ca] text-white shadow-lg' : 'text-slate-400'}`}>Draft</button>
              </div>
           </div>
         )}
      </div>

      {/* MATRIX SELECTORS */}
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col h-[calc(100vh-240px)]">
        <div className="p-3 md:p-5 border-b dark:border-slate-800 bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
           <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
              {(['SECTION', 'TEACHER', 'ROOM'] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)} className={`px-6 md:px-10 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === mode ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400 hover:text-[#001f3f]'}`}>{mode === 'SECTION' ? 'Class' : mode === 'TEACHER' ? 'Staff' : 'Room'}</button>
              ))}
           </div>
           <select className="flex-1 max-w-2xl p-4 bg-white dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase italic outline-none border-2 border-slate-100 focus:border-amber-400 transition-all dark:text-white shadow-sm" value={selectedTargetId} onChange={e => setSelectedTargetId(e.target.value)}>
              <option value="">MATRIX TARGET DISCOVERY...</option>
              {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>
           <select className={`bg-white dark:bg-slate-800 p-4 rounded-2xl text-[11px] font-black uppercase border border-slate-100 outline-none min-w-[180px] ${!isAdmin && !isGlobalIncharge ? 'opacity-50 cursor-not-allowed' : ''}`} value={activeWingId} onChange={e => !userWingScope && setActiveWingId(e.target.value)} disabled={!!userWingScope}>
              {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
           </select>
        </div>

        {/* THE MATRIX GRID */}
        <div className="flex-1 overflow-auto scrollbar-hide">
           <table className="w-full border-separate border-spacing-0 table-fixed min-w-[1000px]">
              <thead>
                 <tr className="bg-[#001f3f] text-white sticky top-0 z-[60]">
                    <th className="w-28 p-4 text-[10px] font-black uppercase italic tracking-[0.3em] border-r border-white/5 bg-[#001f3f]">Day</th>
                    {slots.map(s => (
                      <th key={s.id} className="p-4 text-center border-r border-white/5 bg-[#001f3f]">
                         <p className="text-[11px] font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p>
                         <p className="text-[9px] font-bold opacity-40 mt-1 tracking-widest">{s.startTime}</p>
                      </th>
                    ))}
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                 {DAYS.map(day => (
                   <tr key={day} className="h-24">
                      <td className="bg-[#001f3f] text-white font-black text-center text-[11px] uppercase border-r border-white/5 sticky left-0 z-40 italic tracking-widest shadow-xl">{day.toUpperCase()}</td>
                      {slots.map(s => {
                        const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                        const act = ents.find(t => viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId);
                        const isBeingSwapped = swapSource?.day === day && swapSource?.slotId === s.id;
                        
                        let brickStyles = 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800';
                        if (act) {
                           if (act.blockId) brickStyles = 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 text-amber-700 shadow-md';
                           else if (config.extraCurricularRules?.some(r => r.subject === act.subject)) brickStyles = 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 text-emerald-700 shadow-md';
                           else brickStyles = 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 text-sky-700 shadow-md';
                        }

                        return (
                          <td key={s.id} onClick={() => handleCellClick(day, s.id, act?.id)} className={`border-r border-slate-100 dark:border-slate-800 p-1.5 transition-all relative ${isDraftMode && isManagement ? 'cursor-pointer hover:bg-amber-50/50' : ''}`}>
                             {s.isBreak ? <div className="h-full w-full flex items-center justify-center opacity-30"><span className="text-[8px] font-black uppercase tracking-[0.4em] -rotate-12">Recess</span></div> : act ? (
                               <div className={`h-full w-full p-2 border-2 rounded-2xl flex flex-col justify-center text-center animate-in zoom-in duration-300 ${isBeingSwapped ? 'ring-4 ring-amber-400 bg-amber-100 scale-105 z-50' : brickStyles}`}>
                                  <p className="text-[10px] font-black uppercase italic tracking-tighter leading-tight truncate">{act.subject}</p>
                                  <p className="text-[8px] font-bold opacity-60 uppercase truncate mt-1">{viewMode === 'TEACHER' ? act.className : act.teacherName}</p>
                                  <p className="text-[7px] font-black text-sky-600 uppercase tracking-widest mt-0.5 truncate">{act.room}</p>
                               </div>
                             ) : (
                               <div className={`h-full w-full border-2 border-dashed rounded-2xl flex items-center justify-center transition-all border-slate-50 dark:border-slate-800`}>
                                  <span className="text-[7px] font-black text-slate-100 dark:text-slate-800 uppercase italic opacity-50">Empty</span>
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

      {/* QUICK ASSIGNMENT DRAWER */}
      {assigningSlot && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl p-8 md:p-12 animate-in slide-in-from-right duration-500 overflow-y-auto">
              <div className="flex justify-between items-start mb-10">
                 <div className="space-y-1">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Assigning: {config.sections.find(s => s.id === selectedTargetId)?.fullName}</p>
                    <h3 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{assigningSlot.day} • P{assigningSlot.slotId}</h3>
                 </div>
                 <button onClick={() => setAssigningSlot(null)} className="p-3 text-slate-400 hover:text-rose-500 transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>

              <div className="space-y-8">
                 <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                    {(['STANDARD', 'POOL', 'ACTIVITY'] as const).map(type => (
                       <button 
                          key={type} 
                          onClick={() => setAssignmentType(type)}
                          className={`flex-1 py-3 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${assignmentType === type ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-white shadow-md' : 'text-slate-400'}`}
                       >
                          {type}
                       </button>
                    ))}
                 </div>

                 {assignmentType === 'STANDARD' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-2">
                       <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Select Staff</label>
                          <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-[1.5rem] font-bold text-sm outline-none border-2 border-transparent focus:border-amber-400">
                             <option value="">Choose Teacher...</option>
                             {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                       </div>
                       <div className={`space-y-3 transition-all ${!selAssignTeacherId ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Domain (Subject)</label>
                          <div className="grid grid-cols-2 gap-2">
                             {config.subjects.map(s => (
                               <button key={s.id} onClick={() => setSelAssignSubject(s.name)} className={`p-4 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${selAssignSubject === s.name ? 'bg-[#001f3f] text-white' : 'bg-slate-50 border-transparent text-slate-500'}`}>{s.name}</button>
                             ))}
                          </div>
                       </div>
                       <div className={`space-y-3 transition-all ${!selAssignSubject ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Location (Room)</label>
                          <select value={selAssignRoom} onChange={e => setSelAssignRoom(e.target.value)} className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-[1.5rem] font-bold text-sm outline-none">
                             {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                       </div>
                       <button onClick={handleQuickAssign} disabled={!selAssignRoom || !selAssignSubject} className="w-full py-6 bg-[#001f3f] text-[#d4af37] rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30">Pin to Matrix</button>
                    </div>
                 )}

                 {assignmentType === 'POOL' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Institutional Pool</p>
                       <div className="space-y-3">
                          {(config.combinedBlocks || []).map(pool => (
                             <button key={pool.id} onClick={() => setSelPoolId(pool.id)} className={`w-full p-6 rounded-[2rem] border-2 transition-all text-left ${selPoolId === pool.id ? 'bg-amber-400 border-transparent shadow-lg' : 'bg-slate-50 border-transparent'}`}>
                                <p className={`text-[11px] font-black uppercase italic ${selPoolId === pool.id ? 'text-[#001f3f]' : 'text-slate-600'}`}>{pool.title}</p>
                             </button>
                          ))}
                       </div>
                       <button onClick={handleQuickAssign} disabled={!selPoolId} className="w-full py-6 bg-[#001f3f] text-[#d4af37] rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30">Synchronize Pool</button>
                    </div>
                 )}

                 {assignmentType === 'ACTIVITY' && (
                    <div className="space-y-6 animate-in slide-in-from-bottom-2">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Curricular Activity</p>
                       <div className="space-y-3">
                          {(config.extraCurricularRules || []).map(rule => (
                             <button key={rule.id} onClick={() => setSelActivityId(rule.id)} className={`w-full p-6 rounded-[2rem] border-2 transition-all text-left ${selActivityId === rule.id ? 'bg-emerald-500 border-transparent shadow-lg' : 'bg-slate-50 border-transparent'}`}>
                                <p className={`text-[11px] font-black uppercase italic ${selActivityId === rule.id ? 'text-white' : 'text-slate-600'}`}>{rule.subject}</p>
                             </button>
                          ))}
                       </div>
                       <button onClick={handleQuickAssign} disabled={!selActivityId} className="w-full py-6 bg-[#001f3f] text-[#d4af37] rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30">Deploy Activity</button>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {isSwapMode && isDraftMode && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] bg-[#001f3f] text-white px-8 py-4 rounded-full shadow-2xl border border-amber-400 flex items-center gap-6 animate-in slide-in-from-bottom-8">
           <div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full bg-amber-400 animate-ping"></div><span className="text-[10px] font-black uppercase tracking-widest">{swapSource ? `Moving: P${swapSource.slotId}` : 'Pick a brick to move'}</span></div>
           <button onClick={() => setIsSwapMode(false)} className="text-rose-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

import { TimeTableEntry, SchoolConfig, User, TeacherAssignment, ParkedItem, SubjectLoad, SchoolSection, SectionType, SubjectCategory } from '../types';
import { checkCollision } from '../utils/timetable/autoScheduler';
import { generateUUID } from '../utils/idUtils';
import { DAYS, PRIMARY_SLOTS } from '../constants';

export interface WorkerInput {
  phase: 'POOLS' | 'LABS' | 'CURRICULARS' | 'LOADS' | 'FULL';
  config: SchoolConfig;
  users: User[];
  assignments: TeacherAssignment[];
  lockedSectionIds: string[];
  currentTimetable: TimeTableEntry[];
  activeSectionId: string | null;
  isPurgeMode: boolean;
}

export interface WorkerOutput {
  newTimetable: TimeTableEntry[];
  parkedItems: ParkedItem[];
  logs: any[];
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  console.log('Worker received message:', e.data);
  const { phase, config, users, assignments, lockedSectionIds, currentTimetable, activeSectionId, isPurgeMode } = e.data;

  let baseTimetable = [...currentTimetable];
  let newParkedItems: ParkedItem[] = [];
  let logs: any[] = [];

  const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
  const activeGradeId = activeSection?.gradeId;

  // --- PHASE 2: POOLS ---
  const runPools = (timetable: TimeTableEntry[]) => {
    if (!config.combinedBlocks) return timetable;
    let current = [...timetable];
    
    if (isPurgeMode) {
      const poolBlockIds = (config.combinedBlocks || []).map(p => p.id);
      current = current.filter(e => {
        const isPool = e.blockId && poolBlockIds.includes(e.blockId) && !e.isManual;
        if (!isPool) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    (config.combinedBlocks || []).forEach(pool => {
      if (!pool.sectionIds) return;
      if (activeGradeId && pool.gradeId !== activeGradeId) return;
      if (pool.sectionIds.some(sid => lockedSectionIds.includes(sid))) return;
      
      const existingPoolSlots = current.filter(e => e.blockId === pool.id);
      const uniqueExistingSlots = new Set(existingPoolSlots.map(e => `${e.day}-${e.slotId}`));
      let placed = uniqueExistingSlots.size;
      
      let possibleSlots: { day: string, slot: number }[] = [];
      DAYS.forEach(day => {
        for (let slot = 1; slot <= 10; slot++) {
          if (pool.restrictedSlots && pool.restrictedSlots.includes(slot)) continue;
          possibleSlots.push({ day, slot });
        }
      });
      
      possibleSlots.sort(() => Math.random() - 0.5);
      if (pool.preferredSlots && pool.preferredSlots.length > 0) {
        possibleSlots.sort((a, b) => (pool.preferredSlots!.includes(a.slot) ? -1 : 1) - (pool.preferredSlots!.includes(b.slot) ? -1 : 1));
      }

      const dayCounts: Record<string, number> = {};
      // ... (simplified logic for pools, labs, etc. for brevity in worker but keeping core logic)
      // For brevity, I will implement the core logic for each phase in the worker
      // ...
      
      // (Implementation of Pools logic from TimeTableView.tsx)
      for (const { day, slot } of possibleSlots) {
        if (placed >= pool.weeklyPeriods) break;
        if ((dayCounts[day] || 0) >= 2) continue;
        
        let allFree = true;
        let isBreakAnywhere = false;

        for (const sid of (pool.sectionIds || [])) {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) continue;
          const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
          const slotObj = wingSlots.find(s => s.id === slot);
          if (!slotObj || slotObj.isBreak) { isBreakAnywhere = true; break; }
          if (checkCollision('POOL_VAR', sid, day, slot, '', config, users, current, undefined, undefined, pool.id)) { allFree = false; break; }
        }

        if (allFree && !isBreakAnywhere) {
          (pool.sectionIds || []).forEach(sid => {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) return;
            current.push({
              id: generateUUID(),
              section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
              wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
              day, slotId: slot, subject: pool.heading, subjectCategory: SubjectCategory.CORE,
              teacherId: 'POOL_VAR', teacherName: 'Multiple Staff', blockId: pool.id, blockName: pool.title, isManual: false
            });
          });
          placed++;
          dayCounts[day] = (dayCounts[day] || 0) + 1;
        }
      }
    });
    return current;
  };

  // --- PHASE 3: LABS ---
  const runLabs = (timetable: TimeTableEntry[]) => {
    if (!config.labBlocks) return timetable;
    let current = [...timetable];
    
    if (isPurgeMode) {
      const labBlockIds = (config.labBlocks || []).map(p => p.id);
      current = current.filter(e => {
        const isLab = e.blockId && labBlockIds.includes(e.blockId) && !e.isManual;
        if (!isLab) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    (config.labBlocks || []).forEach(lab => {
      if (!lab.sectionIds) return;
      if (activeGradeId && lab.gradeId !== activeGradeId) return;
      if (lab.sectionIds.some(sid => lockedSectionIds.includes(sid))) return;
      
      const existingLabSlots = current.filter(e => e.blockId === lab.id);
      const uniqueExistingSlots = new Set(existingLabSlots.map(e => `${e.day}-${e.slotId}`));
      let placed = uniqueExistingSlots.size;
      
      let possibleSlots: { day: string, slot: number }[] = [];
      DAYS.forEach(day => {
        for (let slot = 1; slot <= (lab.isDoublePeriod ? 9 : 10); slot++) {
          if (lab.restrictedSlots && (lab.restrictedSlots.includes(slot) || (lab.isDoublePeriod && lab.restrictedSlots.includes(slot + 1)))) continue;
          possibleSlots.push({ day, slot });
        }
      });
      
      possibleSlots.sort(() => Math.random() - 0.5);

      for (const { day, slot } of possibleSlots) {
        if (placed >= lab.weeklyOccurrences) break;
        
        let allFree = true;
        let isBreakAnywhere = false;

        for (const sid of (lab.sectionIds || [])) {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) continue;
          const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
          const slotObj1 = wingSlots.find(s => s.id === slot);
          if (!slotObj1 || slotObj1.isBreak) { isBreakAnywhere = true; break; }
          
          for (const alloc of lab.allocations) {
            if (checkCollision(alloc.teacherId, sid, day, slot, alloc.room, config, users, current, undefined, undefined, lab.id)) { allFree = false; break; }
          }
          if (!allFree) break;

          if (lab.isDoublePeriod) {
            const slotObj2 = wingSlots.find(s => s.id === slot + 1);
            if (!slotObj2 || slotObj2.isBreak) { isBreakAnywhere = true; break; }
            for (const alloc of lab.allocations) {
              if (checkCollision(alloc.teacherId, sid, day, slot + 1, alloc.room, config, users, current, undefined, undefined, lab.id)) { allFree = false; break; }
            }
            if (!allFree) break;
          }
        }

        if (allFree && !isBreakAnywhere) {
          (lab.sectionIds || []).forEach(sid => {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) return;
            lab.allocations.forEach(alloc => {
              const teacher = users.find(u => u.id === alloc.teacherId)!;
              current.push({
                id: generateUUID(),
                section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                day, slotId: slot, subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                teacherId: alloc.teacherId, teacherName: teacher.name, blockId: lab.id, blockName: lab.title, isManual: false,
                isDouble: lab.isDoublePeriod, isSplitLab: true
              });
              if (lab.isDoublePeriod) {
                current.push({
                  id: generateUUID(),
                  section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                  wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                  day, slotId: slot + 1, subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                  teacherId: alloc.teacherId, teacherName: teacher.name, blockId: lab.id, blockName: lab.title, isManual: false,
                  isDouble: lab.isDoublePeriod, isSplitLab: true
                });
              }
            });
          });
          placed += lab.isDoublePeriod ? 2 : 1;
        }
      }
    });
    return current;
  };

  // --- PHASE 4: CURRICULARS ---
  const runCurriculars = (timetable: TimeTableEntry[]) => {
    if (!config.extraCurricularRules) return timetable;
    let current = [...timetable];
    
    if (isPurgeMode) {
      const curricularSubjects = (config.extraCurricularRules || []).map(r => r.subject);
      current = current.filter(e => {
        const isCurricular = curricularSubjects.includes(e.subject) && !e.isManual;
        if (!isCurricular) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    (config.extraCurricularRules || []).forEach(rule => {
      let targetSections = config.sections.filter(s => rule.sectionIds.includes(s.id));
      if (activeSectionId) targetSections = targetSections.filter(s => s.id === activeSectionId);
      targetSections = targetSections.filter(s => !lockedSectionIds.includes(s.id));

      targetSections.forEach(section => {
        const teacher = users.find(u => u.id === rule.teacherId);
        if (!teacher) return;

        let placed = current.filter(e => e.sectionId === section.id && e.teacherId === teacher.id && e.subject === rule.subject).length;
        let possibleSlots: { day: string, slot: number }[] = [];
        DAYS.forEach(day => {
          for (let slot = 1; slot <= 10; slot++) {
            if (rule.restrictedSlots && rule.restrictedSlots.includes(slot)) continue;
            possibleSlots.push({ day, slot });
          }
        });
        possibleSlots.sort(() => Math.random() - 0.5);

        for (const { day, slot } of possibleSlots) {
          if (placed >= rule.periodsPerWeek) break;
          const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
          const slotObj = wingSlots.find(s => s.id === slot);
          if (!slotObj || slotObj.isBreak) continue;

          if (!checkCollision(teacher.id, section.id, day, slot, rule.room || '', config, users, current)) {
            current.push({
              id: generateUUID(),
              section: (section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
              wingId: section.wingId, gradeId: section.gradeId, sectionId: section.id, className: section.fullName,
              day, slotId: slot, subject: rule.subject, subjectCategory: SubjectCategory.CORE,
              teacherId: teacher.id, teacherName: teacher.name, room: rule.room || '', isManual: false
            });
            placed++;
          }
        }
      });
    });
    return current;
  };

  // --- PHASE 5: LOADS (Genetic Algorithm) ---
  const runLoads = (timetable: TimeTableEntry[]) => {
    let bestTimetable = [...timetable];
    let bestParkedItems: ParkedItem[] = [];
    let minParkedCount = Infinity;

    // Pre-calculate teacher total loads
    const teacherTotalLoads: Record<string, number> = {};
    assignments.forEach(asgn => {
      let total = 0;
      asgn.loads.forEach(load => {
        let targetSections = load.sectionId 
          ? config.sections.filter(s => s.id === load.sectionId)
          : config.sections.filter(s => asgn.targetSectionIds.length > 0 ? asgn.targetSectionIds.includes(s.id) : s.gradeId === asgn.gradeId);
        total += load.periods * targetSections.length;
      });
      teacherTotalLoads[asgn.teacherId] = (teacherTotalLoads[asgn.teacherId] || 0) + total;
    });

    let loadJobs: any[] = [];
    assignments.forEach(asgn => {
      const teacher = users.find(u => u.id === asgn.teacherId);
      console.log('Assignment:', asgn, 'Teacher:', teacher);
      if (!teacher) return;
      asgn.loads.forEach(load => {
        let targetSections = load.sectionId 
          ? config.sections.filter(s => s.id === load.sectionId)
          : config.sections.filter(s => asgn.targetSectionIds.length > 0 ? asgn.targetSectionIds.includes(s.id) : s.gradeId === asgn.gradeId);
        if (activeSectionId) targetSections = targetSections.filter(s => s.id === activeSectionId);
        targetSections = targetSections.filter(s => !lockedSectionIds.includes(s.id));
        targetSections.forEach(section => {
          loadJobs.push({ teacher, load, section, targetPerSection: load.periods, teacherTotalLoad: teacherTotalLoads[teacher.id] || 0 });
        });
      });
    });

    loadJobs.sort((a, b) => (b.teacherTotalLoad - a.teacherTotalLoad) || (b.targetPerSection - a.targetPerSection));

    const MAX_ITERATIONS = 10; // Increased for worker
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let currentIterationTimetable = [...timetable];
      let currentIterationParked: ParkedItem[] = [];
      let iterationJobs = [...loadJobs];
      if (iteration > 0) iterationJobs.sort(() => Math.random() - 0.5);

      iterationJobs.forEach(job => {
        const { teacher, load, section, targetPerSection } = job;
        let sectionPlaced = currentIterationTimetable.filter(e => e.sectionId === section.id && e.teacherId === teacher.id && e.subject === load.subject && !e.blockId).length;
        const daysWithSubject = new Set(currentIterationTimetable.filter(e => e.sectionId === section.id && e.teacherId === teacher.id && e.subject === load.subject && !e.blockId).map(e => e.day));

        while (sectionPlaced < targetPerSection) {
          let placed = false;
          let availableDays = [...DAYS].sort(() => Math.random() - 0.5);

          for (const day of availableDays) {
            if (placed) break;
            const slots = [...PRIMARY_SLOTS].filter(s => !s.isBreak).sort(() => Math.random() - 0.5);
            for (const slot of slots) {
              if (checkCollision(teacher.id, section.id, day, slot.id, load.room || '', config, users, currentIterationTimetable)) continue;
              currentIterationTimetable.push({
                id: generateUUID(),
                section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                wingId: section.wingId, gradeId: section.gradeId, sectionId: section.id, className: section.fullName,
                day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE,
                teacherId: teacher.id, teacherName: teacher.name, room: load.room || '', isManual: false
              });
              sectionPlaced++;
              placed = true;
              break;
            }
          }
          if (!placed) {
            currentIterationParked.push({ id: generateUUID(), entries: [], type: 'SINGLE', reason: `Could not place ${load.subject} for ${section.fullName}` });
            break;
          }
        }
      });

      if (currentIterationParked.length < minParkedCount) {
        minParkedCount = currentIterationParked.length;
        bestTimetable = currentIterationTimetable;
        bestParkedItems = currentIterationParked;
      }
      if (minParkedCount === 0) break;
    }
    newParkedItems = bestParkedItems;
    return bestTimetable;
  };

  let finalTimetable = [...baseTimetable];
  if (phase === 'POOLS' || phase === 'FULL') finalTimetable = runPools(finalTimetable);
  if (phase === 'LABS' || phase === 'FULL') finalTimetable = runLabs(finalTimetable);
  if (phase === 'CURRICULARS' || phase === 'FULL') finalTimetable = runCurriculars(finalTimetable);
  if (phase === 'LOADS' || phase === 'FULL') finalTimetable = runLoads(finalTimetable);

  self.postMessage({
    newTimetable: finalTimetable,
    parkedItems: newParkedItems,
    logs: logs
  });
};


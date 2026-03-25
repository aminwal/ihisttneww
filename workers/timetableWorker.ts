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
  isOnlineView: boolean;
}

export interface WorkerOutput {
  newTimetable: TimeTableEntry[];
  parkedItems: ParkedItem[];
  logs: any[];
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    console.log('Worker received message:', e.data);
    const { phase, config, users, assignments, lockedSectionIds, currentTimetable, activeSectionId, isPurgeMode, isOnlineView } = e.data;

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
        if (isOnlineView) {
          if ((config.onlineExcludedSubjects || []).includes(pool.id)) return;
        }

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
        
        const targetPeriods = isOnlineView && config.onlineSubjectPeriods?.[pool.id] !== undefined 
          ? config.onlineSubjectPeriods[pool.id] 
          : pool.weeklyPeriods;

        for (const { day, slot } of possibleSlots) {
          if (placed >= targetPeriods) break;
          
          // If onTrot is enabled, try to place 2 periods consecutively if we still need at least 2
          const periodsToPlace = (pool.onTrot && (targetPeriods - placed) >= 2) ? 2 : 1;
          
          if ((dayCounts[day] || 0) + periodsToPlace > 2) continue;
          
          let allFree = true;
          let isBreakAnywhere = false;

          for (let i = 0; i < periodsToPlace; i++) {
            const currentSlot = slot + i;
            if (currentSlot > 10) { allFree = false; break; }

            for (const sid of (pool.sectionIds || [])) {
              const sect = config.sections.find(s => s.id === sid);
              if (!sect) continue;
              const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
              const slotObj = wingSlots.find(s => s.id === currentSlot);
              if (!slotObj || slotObj.isBreak) { isBreakAnywhere = true; break; }
              if (checkCollision('POOL_VAR', sid, day, currentSlot, '', config, users, current, undefined, undefined, pool.id, undefined, undefined, undefined, isOnlineView)) { allFree = false; break; }
            }
            if (!allFree || isBreakAnywhere) break;
          }

          if (allFree && !isBreakAnywhere) {
            for (let i = 0; i < periodsToPlace; i++) {
              const currentSlot = slot + i;
              (pool.sectionIds || []).forEach(sid => {
                const sect = config.sections.find(s => s.id === sid);
                if (!sect) return;
                
                pool.allocations.forEach(alloc => {
                  current.push({
                    id: generateUUID(),
                    section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                    wingId: sect.wingId, 
                    gradeId: sect.gradeId, 
                    sectionId: sect.id, 
                    className: sect.fullName,
                    day, 
                    slotId: currentSlot, 
                    subject: alloc.subject, 
                    subjectCategory: SubjectCategory.GROUP_PERIOD,
                    teacherId: alloc.teacherId, 
                    teacherName: alloc.teacherName, 
                    blockId: pool.id, 
                    blockName: pool.title, 
                    room: alloc.room,
                    isManual: false,
                    isDouble: pool.onTrot,
                    isOnline: isOnlineView
                  });
                });
              });
              placed++;
            }
            dayCounts[day] = (dayCounts[day] || 0) + periodsToPlace;
          }
        }
        
        while (placed < pool.weeklyPeriods) {
          newParkedItems.push({
            id: generateUUID(),
            type: 'BLOCK',
            blockId: pool.id,
            entries: pool.sectionIds.flatMap(sid => {
              const sect = config.sections.find(s => s.id === sid);
              return pool.allocations.map(alloc => ({
                id: generateUUID(),
                subject: alloc.subject,
                teacherId: alloc.teacherId,
                teacherName: alloc.teacherName,
                className: sect?.fullName || sid,
                sectionId: sid,
                gradeId: pool.gradeId,
                wingId: sect?.wingId || '',
                day: '',
                slotId: 0,
                section: (sect?.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                subjectCategory: SubjectCategory.GROUP_PERIOD,
                blockId: pool.id,
                blockName: pool.title,
                room: alloc.room,
                isManual: false,
                isDouble: pool.onTrot
              } as TimeTableEntry));
            }),
            reason: `Could not place Group Period for ${pool.title}`
          });
          placed++;
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
        if (isOnlineView) {
          if ((config.onlineExcludedSubjects || []).includes(lab.id)) return;
        }

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

        const targetOccurrences = isOnlineView && config.onlineSubjectPeriods?.[lab.id] !== undefined 
          ? config.onlineSubjectPeriods[lab.id] 
          : lab.weeklyOccurrences;

        for (const { day, slot } of possibleSlots) {
          if (placed >= targetOccurrences) break;
          
          let allFree = true;
          let isBreakAnywhere = false;

          for (const sid of (lab.sectionIds || [])) {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) continue;
            const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
            const slotObj1 = wingSlots.find(s => s.id === slot);
            if (!slotObj1 || slotObj1.isBreak) { isBreakAnywhere = true; break; }
            
            for (const alloc of lab.allocations) {
              if (checkCollision(alloc.teacherId, sid, day, slot, alloc.room, config, users, current, undefined, undefined, lab.id, undefined, undefined, undefined, isOnlineView)) { allFree = false; break; }
            }
            if (!allFree) break;

            if (lab.isDoublePeriod) {
              const slotObj2 = wingSlots.find(s => s.id === slot + 1);
              if (!slotObj2 || slotObj2.isBreak) { isBreakAnywhere = true; break; }
              for (const alloc of lab.allocations) {
                if (checkCollision(alloc.teacherId, sid, day, slot + 1, alloc.room, config, users, current, undefined, undefined, lab.id, undefined, undefined, undefined, isOnlineView)) { allFree = false; break; }
              }
              if (!allFree) break;
            }
          }

          if (allFree && !isBreakAnywhere) {
            (lab.sectionIds || []).forEach(sid => {
              const sect = config.sections.find(s => s.id === sid);
              if (!sect) return;
              lab.allocations.forEach(alloc => {
                const teacher = users.find(u => u.id === alloc.teacherId);
                if (!teacher) return;
                current.push({
                  id: generateUUID(),
                  section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                  wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                  day, slotId: slot, subject: alloc.subject, subjectCategory: SubjectCategory.LAB_PERIOD,
                  teacherId: alloc.teacherId, teacherName: teacher.name, blockId: lab.id, blockName: lab.title, isManual: false,
                  isDouble: lab.isDoublePeriod, isSplitLab: true, isOnline: isOnlineView
                });
                if (lab.isDoublePeriod) {
                  current.push({
                    id: generateUUID(),
                    section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                    wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName,
                    day, slotId: slot + 1, subject: alloc.subject, subjectCategory: SubjectCategory.LAB_PERIOD,
                    teacherId: alloc.teacherId, teacherName: teacher.name, blockId: lab.id, blockName: lab.title, isManual: false,
                    isDouble: lab.isDoublePeriod, isSplitLab: true, isOnline: isOnlineView
                  });
                }
              });
            });
            placed += lab.isDoublePeriod ? 2 : 1;
          }
        }
        
        while (placed < lab.weeklyOccurrences) {
          newParkedItems.push({
            id: generateUUID(),
            type: 'BLOCK',
            blockId: lab.id,
            entries: lab.sectionIds.flatMap(sid => {
              const sect = config.sections.find(s => s.id === sid);
              return lab.allocations.map(alloc => {
                const teacher = users.find(u => u.id === alloc.teacherId);
                return {
                  id: generateUUID(),
                  subject: alloc.subject,
                  teacherId: alloc.teacherId,
                  teacherName: teacher?.name || alloc.teacherId,
                  className: sect?.fullName || sid,
                  sectionId: sid,
                  gradeId: lab.gradeId,
                  wingId: sect?.wingId || '',
                  day: '',
                  slotId: 0,
                  section: (sect?.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                  subjectCategory: SubjectCategory.CORE,
                  blockId: lab.id,
                  blockName: lab.title,
                  isManual: false,
                  isSplitLab: true,
                  isDouble: lab.isDoublePeriod
                } as TimeTableEntry;
              });
            }),
            reason: `Could not place Lab Period for ${lab.title}`
          });
          placed += lab.isDoublePeriod ? 2 : 1;
        }
      });
      return current;
    };

    // --- PHASE 4: CURRICULARS ---
    const runCurriculars = (timetable: TimeTableEntry[]) => {
      console.log('runCurriculars started, extraCurricularRules:', config.extraCurricularRules);
      if (!config.extraCurricularRules) return timetable;
      let current = [...timetable];
      
      if (isPurgeMode) {
        const curricularIdentifiers = (config.extraCurricularRules || []).flatMap(r => [r.subject, r.heading].filter(Boolean));
        current = current.filter(e => {
          const isCurricular = curricularIdentifiers.includes(e.subject) && !e.isManual;
          if (!isCurricular) return true;
          if (activeGradeId) return e.gradeId !== activeGradeId;
          return false;
        });
      }

      (config.extraCurricularRules || []).forEach(rule => {
        if (isOnlineView) {
          const subjectObj = config.subjects.find(s => s.name === rule.subject);
          if (subjectObj && (config.onlineExcludedSubjects || []).includes(subjectObj.id)) {
            return; // Skip excluded subjects in online mode
          }
        }

        let targetSections = config.sections.filter(s => (rule.sectionIds || []).includes(s.id));
        if (activeSectionId) targetSections = targetSections.filter(s => s.id === activeSectionId);
        targetSections = targetSections.filter(s => !lockedSectionIds.includes(s.id));

        console.log(`Processing rule for ${rule.subject}, target sections:`, targetSections.map(s => s.id));

        targetSections.forEach(section => {
          let targetPeriodsPerWeek = rule.periodsPerWeek;
          if (isOnlineView) {
            const subjectObj = config.subjects.find(s => s.name === rule.subject);
            if (subjectObj && config.onlineSubjectPeriods?.[subjectObj.id] !== undefined) {
              targetPeriodsPerWeek = config.onlineSubjectPeriods[subjectObj.id];
            }
          }

          const allocations = rule.allocations && rule.allocations.length > 0 
            ? rule.allocations 
            : [{ teacherId: rule.teacherId, teacherName: '', subject: rule.subject, room: rule.room }];
            
          allocations.forEach(allocation => {
            const teacher = users.find(u => u.id === allocation.teacherId);
            if (!teacher) {
              console.log(`Teacher not found for rule ${rule.subject}, teacherId: ${allocation.teacherId}`);
              return;
            }

            let placed = current.filter(e => e.sectionId === section.id && e.teacherId === teacher.id && (e.subject === rule.subject || e.subject === rule.heading || e.subject === allocation.subject)).length;
            console.log(`Section ${section.id}, teacher ${teacher.id}, already placed: ${placed}, target: ${targetPeriodsPerWeek}`);
            
            let possibleSlots: { day: string, slot: number }[] = [];
            DAYS.forEach(day => {
              for (let slot = 1; slot <= 10; slot++) {
                if (rule.restrictedSlots && rule.restrictedSlots.includes(slot)) continue;
                possibleSlots.push({ day, slot });
              }
            });
            possibleSlots.sort(() => Math.random() - 0.5);

            const dayCounts: Record<string, number> = {};
            // Pre-fill dayCounts with existing placements
            current.filter(e => e.sectionId === section.id && e.teacherId === teacher.id && (e.subject === rule.subject || e.subject === rule.heading || e.subject === allocation.subject)).forEach(e => {
              dayCounts[e.day] = (dayCounts[e.day] || 0) + 1;
            });

            for (const { day, slot } of possibleSlots) {
              if (placed >= targetPeriodsPerWeek) break;
              
              const periodsToPlace = (rule.onTrot && (targetPeriodsPerWeek - placed) >= 2) ? 2 : 1;
              if ((dayCounts[day] || 0) + periodsToPlace > 2) continue;

              let allFree = true;
              let isBreakAnywhere = false;
              
              for (let i = 0; i < periodsToPlace; i++) {
                const currentSlot = slot + i;
                if (currentSlot > 10) { allFree = false; break; }
                
                const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : section.wingId.includes('wing-sg') ? 'SECONDARY_GIRLS' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
                const slotObj = wingSlots.find(s => s.id === currentSlot);
                if (!slotObj || slotObj.isBreak) { isBreakAnywhere = true; break; }
                
                if (checkCollision(teacher.id, section.id, day, currentSlot, allocation.room || rule.room || '', config, users, current, undefined, undefined, undefined, undefined, undefined, undefined, isOnlineView)) {
                  allFree = false;
                  break;
                }
              }

              if (allFree && !isBreakAnywhere) {
                for (let i = 0; i < periodsToPlace; i++) {
                  const currentSlot = slot + i;
                  let sectionType: SectionType = 'PRIMARY';
                  if (section.wingId.includes('wing-p')) sectionType = 'PRIMARY';
                  else if (section.wingId.includes('wing-sg')) sectionType = 'SECONDARY_GIRLS';
                  else if (section.wingId.includes('wing-sb')) sectionType = 'SECONDARY_BOYS';
                  else sectionType = 'SENIOR_SECONDARY_BOYS';

                  current.push({
                    id: generateUUID(),
                    section: sectionType,
                    wingId: section.wingId, gradeId: section.gradeId, sectionId: section.id, className: section.fullName,
                    day, slotId: currentSlot, subject: rule.heading || allocation.subject || rule.subject, subjectCategory: SubjectCategory.EXTRA_CURRICULAR,
                    teacherId: teacher.id, teacherName: teacher.name, room: allocation.room || rule.room || '', isManual: false, isOnline: isOnlineView
                  });
                  placed++;
                }
                dayCounts[day] = (dayCounts[day] || 0) + periodsToPlace;
              }
            }
            
            if (placed < targetPeriodsPerWeek) {
              console.log(`Could not place all periods for ${rule.subject} in section ${section.id}. Placed: ${placed}, target: ${targetPeriodsPerWeek}`);
            }
            
            while (placed < targetPeriodsPerWeek) {
              newParkedItems.push({
                id: generateUUID(),
                type: 'SINGLE',
                entries: [{
                  id: generateUUID(),
                  subject: rule.heading || allocation.subject || rule.subject,
                  teacherId: teacher.id,
                  teacherName: teacher.name,
                  className: section.fullName,
                  sectionId: section.id,
                  gradeId: section.gradeId,
                  wingId: section.wingId,
                  day: '',
                  slotId: 0,
                  section: (section.wingId.includes('wing-p') ? 'PRIMARY' : section.wingId.includes('wing-sg') ? 'SECONDARY_GIRLS' : 'SECONDARY_BOYS') as SectionType,
                  subjectCategory: SubjectCategory.EXTRA_CURRICULAR,
                  isManual: false
                } as TimeTableEntry],
                reason: `Could not place ${rule.subject} for ${section.fullName}`
              });
              placed++;
            }
          });
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
          if (isOnlineView) {
            const subjectObj = config.subjects.find(s => s.name === load.subject);
            if (subjectObj && (config.onlineExcludedSubjects || []).includes(subjectObj.id)) {
              return; // Skip excluded subjects in online mode
            }
          }

          let targetSections = load.sectionId 
            ? config.sections.filter(s => s.id === load.sectionId)
            : config.sections.filter(s => asgn.targetSectionIds.length > 0 ? asgn.targetSectionIds.includes(s.id) : s.gradeId === asgn.gradeId);
          if (activeSectionId) targetSections = targetSections.filter(s => s.id === activeSectionId);
          targetSections = targetSections.filter(s => !lockedSectionIds.includes(s.id));
          targetSections.forEach(section => {
            let targetPerSection = load.periods;
            if (isOnlineView) {
              const subjectObj = config.subjects.find(s => s.name === load.subject);
              if (subjectObj && config.onlineSubjectPeriods?.[subjectObj.id] !== undefined) {
                targetPerSection = config.onlineSubjectPeriods[subjectObj.id];
              }
            }
            loadJobs.push({ teacher, load, section, targetPerSection, teacherTotalLoad: teacherTotalLoads[teacher.id] || 0 });
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
            
            // 1. Try to place on a day without this subject
            let availableDays = [...DAYS].filter(d => !daysWithSubject.has(d)).sort(() => Math.random() - 0.5);
            
            // 2. If no days available, allow all days
            if (availableDays.length === 0) {
              availableDays = [...DAYS].sort(() => Math.random() - 0.5);
            }

            for (const day of availableDays) {
              if (placed) break;
              const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : section.wingId.includes('wing-sg') ? 'SECONDARY_GIRLS' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
              const slots = [...wingSlots].filter(s => !s.isBreak).sort(() => Math.random() - 0.5);
              for (const slot of slots) {
                // Check if already 2 periods of this subject for this section on this day for this teacher
                const existingSubjectCount = currentIterationTimetable.filter(e => 
                  e.day === day && 
                  e.sectionId === section.id && 
                  e.subject === load.subject &&
                  (e.teacherId === teacher.id || e.secondaryTeacherId === teacher.id)
                ).length;
                
                if (existingSubjectCount >= 2) continue;

                if (checkCollision(teacher.id, section.id, day, slot.id, load.room || '', config, users, currentIterationTimetable, undefined, undefined, undefined, undefined, undefined, undefined, isOnlineView)) continue;
                
                let sectionType: SectionType = 'PRIMARY';
                if (section.wingId.includes('wing-p')) sectionType = 'PRIMARY';
                else if (section.wingId.includes('wing-sg')) sectionType = 'SECONDARY_GIRLS';
                else if (section.wingId.includes('wing-sb')) sectionType = 'SECONDARY_BOYS';
                else sectionType = 'SENIOR_SECONDARY_BOYS';

                currentIterationTimetable.push({
                  id: generateUUID(),
                  section: sectionType,
                  wingId: section.wingId, gradeId: section.gradeId, sectionId: section.id, className: section.fullName,
                  day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE,
                  teacherId: teacher.id, teacherName: teacher.name, room: load.room || '', isManual: false, isOnline: isOnlineView
                });
                daysWithSubject.add(day);
                sectionPlaced++;
                placed = true;
                break;
              }
            }
            if (!placed) {
              currentIterationParked.push({ 
                id: generateUUID(), 
                entries: [{
                  id: generateUUID(),
                  subject: load.subject,
                  teacherId: teacher.id,
                  teacherName: teacher.name,
                  className: section.fullName,
                  sectionId: section.id,
                  gradeId: section.gradeId,
                  wingId: section.wingId,
                  day: '',
                  slotId: 0,
                  section: (section.wingId.includes('wing-p') ? 'PRIMARY' : section.wingId.includes('wing-sg') ? 'SECONDARY_GIRLS' : 'SECONDARY_BOYS') as SectionType,
                  subjectCategory: SubjectCategory.CORE,
                  isManual: false
                } as TimeTableEntry], 
                type: 'SINGLE', 
                reason: `Could not place ${load.subject} for ${section.fullName}` 
              });
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
      newParkedItems.push(...bestParkedItems);
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
  } catch (err: any) {
    console.error('Worker Error:', err);
    self.postMessage({
      newTimetable: [],
      parkedItems: [],
      logs: [],
      error: err.message || String(err)
    });
  }
};


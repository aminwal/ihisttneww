import { TimeTableEntry, SchoolConfig, User, TeacherAssignment, SubjectCategory, ParkedItem, AssignmentLogEntry } from '../../types';
import { DAYS, PRIMARY_SLOTS } from '../../constants';
import { generateUUID } from '../idUtils';

export const checkCollision = (
  teacherId: string, 
  sectionId: string, 
  day: string, 
  slotId: number, 
  room: string, 
  config: SchoolConfig,
  users: User[],
  currentTimetable: TimeTableEntry[],
  excludeEntryId?: string, 
  currentBatch?: TimeTableEntry[], 
  blockId?: string, 
  secondaryTeacherId?: string, 
  isSplitLab?: boolean,
  assignments?: TeacherAssignment[]
) => {
  // 0. Check if slot is a break for the section
  if (sectionId && sectionId !== 'POOL_VAR') {
    const sect = config.sections.find(s => s.id === sectionId);
    if (sect) {
      const wing = config.wings.find(w => w.id === sect.wingId);
      const wingSlots = wing ? (config.slotDefinitions?.[wing.sectionType] || PRIMARY_SLOTS) : PRIMARY_SLOTS;
      const slotObj = wingSlots.find(s => s.id === slotId);
      if (slotObj?.isBreak) {
        return `Break Time Conflict: Section ${sect.fullName} has a break at Period ${slotId}.`;
      }
    }
  }

  // Check Restricted Slots and Break Times if blockId is provided
  if (blockId) {
    const pool = config.combinedBlocks?.find(b => b.id === blockId);
    if (pool) {
      if (pool.restrictedSlots && pool.restrictedSlots.includes(slotId)) {
        return `Restricted Slot: This group period is not allowed in Period ${slotId}.`;
      }
      
      if (pool.sectionIds) {
        const wingIds = new Set<string>();
        let anySlotObj: any = null;

        for (const sid of pool.sectionIds) {
           const sect = config.sections.find(s => s.id === sid);
           if (sect) {
              wingIds.add(sect.wingId);
              const wing = config.wings.find(w => w.id === sect.wingId);
              const wingSlots = wing ? (config.slotDefinitions?.[wing.sectionType] || PRIMARY_SLOTS) : PRIMARY_SLOTS;
              const slotObj = wingSlots.find(s => s.id === slotId);
              if (!anySlotObj) anySlotObj = slotObj;
              if (slotObj?.isBreak) {
                 return `Break Time Conflict: Section ${sect.fullName} has a break at Period ${slotId}.`;
              }
           }
        }
      }
    }
    
    const lab = config.labBlocks?.find(l => l.id === blockId);
    if (lab) {
      if (lab.restrictedSlots && (lab.restrictedSlots.includes(slotId) || (lab.isDoublePeriod && lab.restrictedSlots.includes(slotId + 1)))) {
        return `Restricted Slot: This lab period is not allowed in Period ${slotId}.`;
      }
      
      if (lab.sectionIds) {
        for (const sid of lab.sectionIds) {
           const sect = config.sections.find(s => s.id === sid);
           if (sect) {
              const wingSlots = (config.slotDefinitions?.[config.wings.find(w => w.id === sect.wingId)?.sectionType || 'PRIMARY'] || PRIMARY_SLOTS);
              const slotObj1 = wingSlots.find(s => s.id === slotId);
              if (slotObj1?.isBreak) {
                 return `Break Time Conflict: Section ${sect.fullName} has a break at Period ${slotId}.`;
              }
              if (lab.isDoublePeriod) {
                const slotObj2 = wingSlots.find(s => s.id === slotId + 1);
                if (slotObj2?.isBreak) {
                   return `Break Time Conflict: Section ${sect.fullName} has a break at Period ${slotId + 1}.`;
                }
              }
           }
        }
      }
    }
  }

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

  // Check restricted slots from teacher assignments
  if (assignments) {
    for (const tId of incomingTeachers) {
      if (tId === 'POOL_VAR') continue;
      const tAssignments = assignments.filter(a => a.teacherId === tId);
      for (const asgn of tAssignments) {
        if (asgn.restrictedSlots?.includes(slotId.toString())) {
          const tName = users.find(u => u.id === tId)?.name || tId;
          return `Restricted Slot: ${tName} has restricted Period ${slotId} in their workload preferences.`;
        }
      }
    }
  }

  for (const e of dayEntries) {
    // If we are checking for a synchronized block, ignore entries that belong to the same block
    // as they are part of the same session across different sections.
    if (blockId && e.blockId === blockId) continue;

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

  // Teacher Fatigue Check: Max 4 consecutive periods across ALL classes
  const MAX_CONSECUTIVE = 3;
  for (const tId of incomingTeachers) {
    if (tId === 'POOL_VAR') continue;
    
    const teacherDayEntries = dataset.filter(e => 
      e.day === day && 
      e.id !== excludeEntryId &&
      (e.teacherId === tId || e.secondaryTeacherId === tId || (e.blockId && config.combinedBlocks?.find(b => b.id === e.blockId)?.allocations.some(a => a.teacherId === tId)))
    );
    
    const occupiedSlots = teacherDayEntries.map(e => e.slotId);
    
    // Get the wing slots to check for breaks
    const sect = config.sections.find(s => s.id === sectionId);
    const wingSlots = sect ? (config.slotDefinitions?.[config.wings.find(w => w.id === sect.wingId)?.sectionType || 'PRIMARY'] || PRIMARY_SLOTS) : PRIMARY_SLOTS;
    
    let consecutiveCount = 1; // The slot we are trying to place
    
    // Check backwards
    let checkSlot = slotId - 1;
    while (occupiedSlots.includes(checkSlot)) {
      const slotObj = wingSlots.find(s => s.id === checkSlot);
      if (slotObj?.isBreak) break; // Break resets the count
      consecutiveCount++;
      checkSlot--;
    }
    
    // Check forwards
    checkSlot = slotId + 1;
    while (occupiedSlots.includes(checkSlot)) {
      const slotObj = wingSlots.find(s => s.id === checkSlot);
      if (slotObj?.isBreak) break; // Break resets the count
      consecutiveCount++;
      checkSlot++;
    }
    
    if (consecutiveCount > MAX_CONSECUTIVE) {
      const tName = users.find(u => u.id === tId)?.name || tId;
      return `Teacher Fatigue: ${tName} cannot teach more than ${MAX_CONSECUTIVE} consecutive periods without a break.`;
    }
  }

  // Group Period Continuity Check: Different group periods should not come back to back in Primary/Secondary wings
  if (sectionId && sectionId !== 'POOL_VAR') {
    const sect = config.sections.find(s => s.id === sectionId);
    if (sect) {
      const wing = config.wings.find(w => w.id === sect.wingId);
      if (wing && ['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'].includes(wing.sectionType)) {
        // If the current entry being placed is a group period (CombinedBlock)
        if (blockId && config.combinedBlocks?.some(b => b.id === blockId)) {
          const adjacentSlots = [slotId - 1, slotId + 1];
          for (const adjSlotId of adjacentSlots) {
            const adjEntry = dataset.find(e => e.day === day && e.slotId === adjSlotId && e.sectionId === sectionId);
            if (adjEntry && adjEntry.blockId && adjEntry.blockId !== blockId) {
              const isAdjGroup = config.combinedBlocks?.some(b => b.id === adjEntry.blockId);
              if (isAdjGroup) {
                return `Group Period Violation: Different group periods cannot be back-to-back in ${wing.name}.`;
              }
            }
          }
        }
      }
    }
  }

  return null;
};

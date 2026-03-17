import { useCallback } from 'react';
import { TimeTableEntry, SchoolConfig, User, TeacherAssignment, ParkedItem, AssignmentLogEntry } from '../types';
import { checkCollision as checkCollisionUtil } from '../utils/timetable/autoScheduler';
import { generateUUID } from '../utils/idUtils';
import { HapticService } from '../services/hapticService';
import { DAYS, PRIMARY_SLOTS } from '../constants';

interface UseAutoSchedulerProps {
  config: SchoolConfig;
  users: User[];
  lockedSectionIds: string[];
  assignments: TeacherAssignment[];
  isPurgeMode: boolean;
  viewMode: string;
  selectedTargetId: string;
  currentTimetable: TimeTableEntry[];
  setCurrentTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  setParkedEntries: React.Dispatch<React.SetStateAction<ParkedItem[]>>;
  setAssignmentLogs: React.Dispatch<React.SetStateAction<AssignmentLogEntry[]>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isDraftMode: boolean;
  isOnlineView: boolean;
}

export const useAutoScheduler = ({
  config,
  users,
  lockedSectionIds,
  assignments,
  isPurgeMode,
  viewMode,
  selectedTargetId,
  currentTimetable,
  setCurrentTimetable,
  setParkedEntries,
  setAssignmentLogs,
  showToast,
  isDraftMode,
  isOnlineView
}: UseAutoSchedulerProps) => {

  const checkCollision = useCallback((teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string, currentBatch?: TimeTableEntry[], blockId?: string, secondaryTeacherId?: string, isSplitLab?: boolean) => {
    return checkCollisionUtil(
      teacherId, sectionId, day, slotId, room, 
      config, users, currentTimetable, 
      excludeEntryId, currentBatch, blockId, secondaryTeacherId, isSplitLab,
      undefined, isOnlineView
    );
  }, [currentTimetable, config, users, isOnlineView]);

  // We will move the handleGenerate functions here in the next steps

  return {
    checkCollision
  };
};

import { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  User, UserRole, TimeTableEntry, SectionType, SubstitutionRecord, 
  SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, 
  ExtraCurricularRule, LabBlock, LabAllocation, TimetableVersion, 
  AssignmentLogEntry, ParkedItem, SubjectLoad, SchoolSection 
} from '../types';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS } from '../constants';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient';
import { generateUUID } from '../utils/idUtils';
import { HapticService } from '../services/hapticService';
import { MatrixService } from '../services/matrixService';
import { checkCollision as checkCollisionUtil } from '../utils/timetable/autoScheduler';

export const useTimetable = (
  user: User,
  users: User[],
  timetable: TimeTableEntry[],
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>,
  timetableDraft: TimeTableEntry[],
  setTimetableDraft: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>,
  isDraftMode: boolean,
  setIsDraftMode: (val: boolean) => void,
  config: SchoolConfig,
  assignments: TeacherAssignment[],
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void,
  isSandbox?: boolean
) => {
  const isManagement = user?.role === UserRole.ADMIN || user?.role.startsWith('INCHARGE_');
  const isAdmin = user?.role === UserRole.ADMIN;
  const isGlobalIncharge = user?.role === UserRole.INCHARGE_ALL;

  const [activeWingId, setActiveWingId] = useState<string>(() => {
    const wingWithData = config.wings.find(w => config.sections.some(s => s.wingId === w.id));
    return wingWithData?.id || config.wings[0]?.id || '';
  });

  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>(isManagement ? 'SECTION' : 'TEACHER');
  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => !isManagement ? user.id : '');
  const [isPurgeMode, setIsPurgeMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(() => {
    const saved = localStorage.getItem('ihis_autosave_enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [lastSavedDraft, setLastSavedDraft] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [assignmentLogs, setAssignmentLogs] = useState<AssignmentLogEntry[]>([]);
  const [versions, setVersions] = useState<TimetableVersion[]>(() => {
    try {
      const saved = localStorage.getItem('ihis_timetable_versions');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [parkedEntries, setParkedEntries] = useState<ParkedItem[]>(() => {
    try {
      const saved = localStorage.getItem('ihis_parked_entries');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [cellNotes, setCellNotes] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('ihis_cell_notes');
      return saved ? JSON.parse(saved) : {};
    } catch { return []; }
  });

  const [lockedSectionIds, setLockedSectionIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('ihis_locked_sections');
    return saved ? JSON.parse(saved) : [];
  });

  const [compactMode, setCompactMode] = useState(false);
  const [colorMode, setColorMode] = useState<'DEFAULT' | 'SUBJECT' | 'TEACHER' | 'GRADE'>('DEFAULT');
  const [swapSource, setSwapSource] = useState<any>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ day: string, slotId: number } | null>(null);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [isParkingLotOpen, setIsParkingLotOpen] = useState(false);
  const [isVersionsModalOpen, setIsVersionsModalOpen] = useState(false);
  const [isAiArchitectOpen, setIsAiArchitectOpen] = useState(false);

  // Persistence effects
  useEffect(() => {
    localStorage.setItem('ihis_timetable_versions', JSON.stringify(versions));
  }, [versions]);

  useEffect(() => {
    localStorage.setItem('ihis_parked_entries', JSON.stringify(parkedEntries));
  }, [parkedEntries]);

  useEffect(() => {
    localStorage.setItem('ihis_cell_notes', JSON.stringify(cellNotes));
  }, [cellNotes]);

  useEffect(() => {
    if (!isSandbox) {
      localStorage.setItem('ihis_locked_sections', JSON.stringify(lockedSectionIds));
    }
  }, [lockedSectionIds, isSandbox]);

  useEffect(() => {
    localStorage.setItem('ihis_autosave_enabled', JSON.stringify(isAutoSaveEnabled));
  }, [isAutoSaveEnabled]);

  const [history, setHistory] = useState<TimeTableEntry[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Initialize history when draft mode starts
  useEffect(() => {
    if (isDraftMode && history.length === 0 && timetableDraft.length > 0) {
      setHistory([timetableDraft]);
      setHistoryIndex(0);
    }
  }, [isDraftMode, timetableDraft, history.length]);

  const recordHistory = useCallback((newTimetable: TimeTableEntry[]) => {
    if (!isDraftMode) return;
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      // Avoid adding duplicate states
      if (newHistory.length > 0 && JSON.stringify(newHistory[newHistory.length - 1]) === JSON.stringify(newTimetable)) {
        return prev;
      }
      const updatedHistory = [...newHistory, newTimetable];
      if (updatedHistory.length > 50) return updatedHistory.slice(1);
      return updatedHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex, isDraftMode]);

  const resetHistory = useCallback((initialTimetable: TimeTableEntry[]) => {
    setHistory([initialTimetable]);
    setHistoryIndex(0);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setTimetableDraft(prev);
      setHistoryIndex(historyIndex - 1);
      HapticService.light();
      showToast("Undo successful", "info");
    }
  }, [history, historyIndex, setTimetableDraft, showToast]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setTimetableDraft(next);
      setHistoryIndex(historyIndex + 1);
      HapticService.light();
      showToast("Redo successful", "info");
    }
  }, [history, historyIndex, setTimetableDraft, showToast]);

  const currentTimetable = isDraftMode ? timetableDraft : timetable;
  
  const setCurrentTimetable = useCallback((val: React.SetStateAction<TimeTableEntry[]>) => {
    if (isDraftMode) {
      setTimetableDraft(prev => {
        const next = typeof val === 'function' ? (val as (prev: TimeTableEntry[]) => TimeTableEntry[])(prev) : val;
        recordHistory(next);
        return next;
      });
    } else {
      setTimetable(val);
    }
  }, [isDraftMode, setTimetableDraft, setTimetable, recordHistory]);

  const checkCollision = useCallback((
    teacherId: string, 
    sectionId: string, 
    day: string, 
    slotId: number, 
    room: string, 
    excludeEntryId?: string, 
    customTimetable?: TimeTableEntry[], 
    blockId?: string, 
    secondaryTeacherId?: string, 
    isSplitLab?: boolean
  ) => {
    return checkCollisionUtil(
      teacherId, sectionId, day, slotId, room, config, users, 
      currentTimetable, excludeEntryId, customTimetable,
      blockId, secondaryTeacherId, isSplitLab
    );
  }, [config, users, currentTimetable]);

  const accessibleWings = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return config.wings;
    if (user.role === UserRole.INCHARGE_PRIMARY) return config.wings.filter(w => w.id === 'wing-p');
    if (user.role === UserRole.INCHARGE_SECONDARY) return config.wings.filter(w => w.id.includes('wing-s'));
    return config.wings; 
  }, [config.wings, user.role, isAdmin, isGlobalIncharge]);

  return {
    isManagement, isAdmin, isGlobalIncharge,
    activeWingId, setActiveWingId,
    accessibleWings,
    viewMode, setViewMode,
    selectedTargetId, setSelectedTargetId,
    isPurgeMode, setIsPurgeMode,
    isProcessing, setIsProcessing,
    isAutoSaving, setIsAutoSaving,
    isAutoSaveEnabled, setIsAutoSaveEnabled,
    isAiProcessing, setIsAiProcessing,
    assignmentLogs, setAssignmentLogs,
    versions, setVersions,
    parkedEntries, setParkedEntries,
    cellNotes, setCellNotes,
    lockedSectionIds, setLockedSectionIds,
    compactMode, setCompactMode,
    colorMode, setColorMode,
    swapSource, setSwapSource,
    dragOverTarget, setDragOverTarget,
    isSwapMode, setIsSwapMode,
    isParkingLotOpen, setIsParkingLotOpen,
    isVersionsModalOpen, setIsVersionsModalOpen,
    isAiArchitectOpen, setIsAiArchitectOpen,
    currentTimetable, setCurrentTimetable,
    checkCollision,
    handleUndo, handleRedo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    resetHistory
  };
};

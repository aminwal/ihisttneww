
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  User, UserRole, TimeTableEntry, SectionType, TimeSlot, 
  SubstitutionRecord, SchoolConfig, TeacherAssignment, 
  SubjectCategory, CombinedBlock, ExtraCurricularRule, 
  LabBlock, LabAllocation, TimetableVersion, AssignmentLogEntry, 
  ParkedItem, SubjectLoad, SchoolSection, SectionAuditData, AiResolutionPlan, SwapSuggestion 
} from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { HapticService } from '../services/hapticService.ts';
import { MatrixService } from '../services/matrixService.ts';
import { checkCollision as checkCollisionUtil } from '../utils/timetable/autoScheduler.ts';
import { useTimetable } from '../hooks/useTimetable.ts';

// Modular Components
import { TimetableGrid } from './timetable/TimetableGrid.tsx';
import { TimetableHeader } from './timetable/TimetableHeader.tsx';
import { TimetableDraftControls } from './timetable/TimetableDraftControls.tsx';
import { TimetableConductor } from './timetable/TimetableConductor.tsx';
import { TimetableMobileView } from './timetable/TimetableMobileView.tsx';
import { AssignmentLog } from './timetable/AssignmentLog.tsx';
import { TimetableAuditDrawer } from './timetable/TimetableAuditDrawer.tsx';
import { AssignmentModal } from './timetable/AssignmentModal.tsx';
import { EntryDetailsModal } from './timetable/EntryDetailsModal.tsx';
import { AiResolutionModal } from './timetable/AiResolutionModal.tsx';
import { AiResolutionPlanModal } from './timetable/AiResolutionPlanModal.tsx';
import { NoteModal } from './timetable/NoteModal.tsx';
import { ParkingLot } from './timetable/ParkingLot.tsx';
import { TimetableVersions } from './timetable/TimetableVersions.tsx';
import { TimetableMatrix } from './timetable/TimetableMatrix.tsx';
import { AiArchitectChat } from './AiArchitectChat.tsx';
import { TimetableToolbar } from './timetable/TimetableToolbar.tsx';
import { ContextMenu } from './timetable/ContextMenu.tsx';
import { FloatingActionBar } from './timetable/FloatingActionBar.tsx';
import { ParkingLotPanel } from './ParkingLotPanel.tsx';

import { 
  RefreshCw, Sparkles, Bot, CheckCircle2, AlertCircle, Clock, Lock, Unlock, Zap, Wand2, Share2, Maximize2, Minimize2, History as HistoryIcon
} from 'lucide-react';

interface ContextMenuState {
  x: number;
  y: number;
  day: string;
  slotId: number;
  entryId?: string;
}

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
  const {
    isManagement, isAdmin, isGlobalIncharge,
    activeWingId, setActiveWingId,
    viewMode, setViewMode,
    selectedTargetId, setSelectedTargetId,
    isPurgeMode, setIsPurgeMode,
    isProcessing, setIsProcessing,
    isAutoSaving, setIsAutoSaving,
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
    currentTimetable, setCurrentTimetable,
    checkCollision,
    isParkingLotOpen, setIsParkingLotOpen,
    isVersionsModalOpen, setIsVersionsModalOpen,
    isAiArchitectOpen, setIsAiArchitectOpen,
    accessibleWings
  } = useTimetable(
    user, users, timetable, setTimetable, timetableDraft, setTimetableDraft,
    isDraftMode, setIsDraftMode, config, assignments, showToast, isSandbox
  );

  const [lastSavedDraft, setLastSavedDraft] = useState<string>('');
  
  const userWingScope = useMemo(() => {
    if (user.role === UserRole.INCHARGE_PRIMARY) return 'PRIMARY';
    if (user.role === UserRole.INCHARGE_SECONDARY) return 'SECONDARY';
    return null;
  }, [user.role]);

  const handlePurgeDraft = useCallback(() => {
    setTimetableDraft([]);
    showToast("Draft cleared", "info");
  }, [setTimetableDraft, showToast]);

  // AI Architect State
  const [aiMessages, setAiMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isGatingError, setIsGatingError] = useState(false);
  const [aiResolutionModal, setAiResolutionModal] = useState<{ conflict: any, source: any, target: any } | null>(null);
  const [aiResolutionPlan, setAiResolutionPlan] = useState<any>(null);

  // Auto-save effect
  useEffect(() => {
    if (!isDraftMode || !isManagement || isSandbox || !IS_CLOUD_ENABLED) return;

    const currentDraftStr = JSON.stringify(timetableDraft);
    if (currentDraftStr === lastSavedDraft) return;

    const autoSaveTimer = setTimeout(async () => {
      setIsAutoSaving(true);
      try {
        const { error: delError } = await supabase.from('timetable_drafts').delete().neq('id', 'SYSTEM_LOCK');
        if (delError) throw delError;
        
        if (timetableDraft.length > 0) {
          const mappedDraft = timetableDraft.map(e => ({
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
            block_name: e.blockName,
            is_double: e.isDouble,
            is_split_lab: e.isSplitLab,
            secondary_teacher_id: e.secondaryTeacherId,
            secondary_teacher_name: e.secondaryTeacherName
          }));
          
          const chunkSize = 500;
          for (let i = 0; i < mappedDraft.length; i += chunkSize) {
            const chunk = mappedDraft.slice(i, i + chunkSize);
            const { error: insError } = await supabase.from('timetable_drafts').insert(chunk);
            if (insError) throw insError;
          }
        }
        setLastSavedDraft(currentDraftStr);
      } catch (e: any) { 
        console.error("Auto-save failed:", e);
      } finally { 
        setIsAutoSaving(true); 
      }
    }, 15000); // Auto-save after 15 seconds of inactivity

    return () => clearTimeout(autoSaveTimer);
  }, [timetableDraft, isDraftMode, isManagement, isSandbox, lastSavedDraft]);

  const [resolvingParkedItemId, setResolvingParkedItemId] = useState<string | null>(null);
  const [swapSuggestions, setSwapSuggestions] = useState<any[]>([]);

  const [selectedDayMobile, setSelectedDayMobile] = useState<string>(() => {
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date());
    return DAYS.includes(today) ? today : 'Sunday';
  });

  const [assigningSlot, setAssigningSlot] = useState<{ day: string, slotId: number, sectionId?: string } | null>(null);
  const [viewingEntryId, setViewingEntryId] = useState<string | null>(null);
  const [safeSlots, setSafeSlots] = useState<{day: string, slotId: number}[] | null>(null);
  const [noteModal, setNoteModal] = useState<{day: string, slotId: number, targetId: string, viewMode: string} | null>(null);

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
  const [selLabBlockId, setSelLabBlockId] = useState('');
  const [selActivityId, setSelActivityId] = useState('');
  const [selAssignDay, setSelAssignDay] = useState<string>('');
  const [selAssignSlotId, setSelAssignSlotId] = useState<number>(1);
  const [selAssignSectionId, setSelAssignSectionId] = useState<string>('');

  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);
  const [isPurgeMenuOpen, setIsPurgeMenuOpen] = useState(false);

  const [clipboard, setClipboard] = useState<TimeTableEntry[] | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragSource, setDragSource] = useState<{ day: string, slotId: number, entryId?: string } | null>(null);

  useEffect(() => {
    if (!isSandbox) {
      localStorage.setItem('ihis_locked_sections', JSON.stringify(lockedSectionIds));
    }
  }, [lockedSectionIds, isSandbox]);

  useEffect(() => {
    if (selLabBlockId) {
      const lab = config.labBlocks?.find(l => l.id === selLabBlockId);
      if (lab) {
        // Group 1
        if (lab.allocations[0]) {
          setSelAssignSubject(lab.allocations[0].subject);
          setSelAssignTeacherId(lab.allocations[0].teacherId);
          setSelLabTechnicianId(lab.allocations[0].technicianId || '');
          setSelAssignRoom(lab.allocations[0].room);
        }
        // Group 2
        if (lab.allocations[1]) {
          setSelLab2Subject(lab.allocations[1].subject);
          setSelLab2TeacherId(lab.allocations[1].teacherId);
          setSelLab2TechnicianId(lab.allocations[1].technicianId || '');
          setSelLab2Room(lab.allocations[1].room);
        } else {
          setSelLab2Subject('');
          setSelLab2TeacherId('');
          setSelLab2TechnicianId('');
          setSelLab2Room('');
        }
        // Group 3
        if (lab.allocations[2]) {
          setSelLab3Subject(lab.allocations[2].subject);
          setSelLab3TeacherId(lab.allocations[2].teacherId);
          setSelLab3TechnicianId(lab.allocations[2].technicianId || '');
          setSelLab3Room(lab.allocations[2].room);
        } else {
          setSelLab3Subject('');
          setSelLab3TeacherId('');
          setSelLab3TechnicianId('');
          setSelLab3Room('');
        }
        
        // Handle secondary section if applicable
        const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
        const otherSecId = lab.sectionIds?.find(sid => sid !== targetSecId);
        if (otherSecId) {
          setSelLabSection2Id(otherSecId);
        } else {
          setSelLabSection2Id('');
        }
      }
    }
  }, [selLabBlockId, config.labBlocks, assigningSlot, selAssignSectionId, viewMode, selectedTargetId]);

  const toggleSectionLock = (sectionId: string) => {
    setLockedSectionIds(prev => 
      prev.includes(sectionId) ? prev.filter(id => id !== sectionId) : [...prev, sectionId]
    );
    HapticService.light();
  };

  const sectionAuditData = useMemo(() => {
    if (viewMode !== 'SECTION' || !selectedTargetId) return null;
    const sectionId = selectedTargetId;
    const section = config.sections.find(s => s.id === sectionId);
    if (!section) return null;

    // Determine valid slots for this section
    const sectionSlots = config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS;
    const validSlotIds = sectionSlots.map(s => s.id);

    const entries = currentTimetable.filter(e => e.sectionId === sectionId);
    
    // 1. Anchors (Class Teacher)
    const classTeacher = users.find(u => u.classTeacherOf === sectionId);
    const anchorAssignment = assignments.find(a => 
      a.teacherId === classTeacher?.id && 
      (a.targetSectionIds?.includes(sectionId) || a.loads?.some(l => l.sectionId === sectionId))
    );
    const anchorAllocated = anchorAssignment?.anchorPeriods || (classTeacher ? 5 : 0);
    const anchorAssigned = entries.filter(e => e.teacherId === classTeacher?.id && e.slotId === 1 && validSlotIds.includes(e.slotId)).length;

    // 2. Pools
    const pools = (config.combinedBlocks || []).filter(b => b.sectionIds?.includes(sectionId)).map(b => {
      const allocated = b.weeklyPeriods;
      const relevantEntries = entries.filter(e => e.blockId === b.id && validSlotIds.includes(e.slotId));
      const uniqueSlots = new Set(relevantEntries.map(e => `${e.day}-${e.slotId}`));
      return {
        id: b.id,
        name: b.title,
        allocated,
        assigned: uniqueSlots.size,
        teachers: b.allocations.map(a => a.teacherName).join(', ')
      };
    });

    // 3. Labs
    const labs = (config.labBlocks || []).filter(l => l.sectionIds?.includes(sectionId)).map(l => {
      const allocated = l.weeklyOccurrences * (l.isDoublePeriod ? 2 : 1);
      const relevantEntries = entries.filter(e => e.blockId === l.id && validSlotIds.includes(e.slotId));
      const uniqueSlots = new Set(relevantEntries.map(e => `${e.day}-${e.slotId}`));
      return {
        id: l.id,
        name: l.title,
        allocated,
        assigned: uniqueSlots.size,
        teachers: l.allocations.map(a => users.find(u => u.id === a.teacherId)?.name || a.teacherId).join(', ')
      };
    });

    // 4. Standard Loads
    const rawStandardLoads = assignments
      .filter(a => a.targetSectionIds?.includes(sectionId) || a.loads?.some(l => l.sectionId === sectionId))
      .flatMap(a => {
        const teacher = users.find(u => u.id === a.teacherId);
        return (a.loads || [])
          .filter(l => !l.sectionId || l.sectionId === sectionId)
          .map(l => ({
            teacherId: a.teacherId,
            teacherName: teacher?.name || 'Unknown',
            subject: l.subject,
            allocated: l.periods
          }));
      });

    // Group standard loads by teacher and subject to avoid duplicate rows and incorrect counters
    const standardLoadsMap: Record<string, { teacherId: string, teacherName: string, subject: string, allocated: number, assigned: number }> = {};
    
    rawStandardLoads.forEach(load => {
      const key = `${load.teacherId}-${load.subject.toLowerCase().trim()}`;
      if (!standardLoadsMap[key]) {
        standardLoadsMap[key] = { ...load, assigned: 0 };
      } else {
        standardLoadsMap[key].allocated += load.allocated;
      }
    });

    // Calculate assigned periods for grouped loads
    Object.values(standardLoadsMap).forEach(load => {
      const relevantEntries = entries.filter(e => 
        e.teacherId === load.teacherId && 
        e.subject.toLowerCase().trim() === load.subject.toLowerCase().trim() && 
        !e.blockId && 
        e.slotId !== 1 && 
        !e.isSplitLab &&
        validSlotIds.includes(e.slotId)
      );
      const uniqueSlots = new Set(relevantEntries.map(e => `${e.day}-${e.slotId}`));
      load.assigned = uniqueSlots.size;
    });

    const standardLoads = Object.values(standardLoadsMap);

    // 5. Extra-Curricular
    const curriculars = (config.extraCurricularRules || []).filter(r => r.sectionIds?.includes(sectionId)).map(r => {
      const teacher = users.find(u => u.id === r.teacherId);
      const allocated = r.periodsPerWeek;
      const relevantEntries = entries.filter(e => 
        e.teacherId === r.teacherId && 
        e.subject.toLowerCase().trim() === r.subject.toLowerCase().trim() &&
        validSlotIds.includes(e.slotId)
      );
      const uniqueSlots = new Set(relevantEntries.map(e => `${e.day}-${e.slotId}`));
      return {
        id: r.id,
        name: r.subject,
        allocated,
        assigned: uniqueSlots.size,
        teacherName: teacher?.name || 'Unknown'
      };
    });

    // Helper to check registry match
    const matchesRegistry = (e: TimeTableEntry) => {
      const subjectLower = e.subject.toLowerCase().trim();
      
      const isAnchor = e.slotId === 1 && e.teacherId === classTeacher?.id;
      
      const isPool = !!e.blockId && config.combinedBlocks?.some(b => 
        b.id === e.blockId && b.sectionIds?.includes(sectionId)
      );
      
      const isLab = !!e.blockId && config.labBlocks?.some(l => 
        l.id === e.blockId && l.sectionIds?.includes(sectionId)
      );
      
      const isCurricular = config.extraCurricularRules?.some(r => 
        r.teacherId === e.teacherId && 
        r.subject.toLowerCase().trim() === subjectLower && 
        r.sectionIds?.includes(sectionId)
      );
      
      const isStandard = assignments.some(a => 
        a.teacherId === e.teacherId && 
        (a.targetSectionIds?.includes(sectionId) || a.loads?.some(l => l.sectionId === sectionId)) && 
        a.loads?.some(l => 
          l.subject.toLowerCase().trim() === subjectLower &&
          (!l.sectionId || l.sectionId === sectionId)
        )
      );
      
      return isAnchor || isPool || isLab || isCurricular || isStandard;
    };

    // 6. Unlinked Entries (Ghost Detection) - Non-manual entries that don't match registry
    const unlinked = entries.filter(e => !e.isManual && !matchesRegistry(e));

    // 7. Manual & Extra Periods - Manual entries that don't match registry (Extras)
    const manualPeriods = entries.filter(e => e.isManual && !matchesRegistry(e));

    return {
      sectionName: section.fullName,
      anchors: { teacherName: classTeacher?.name, allocated: anchorAllocated, assigned: anchorAssigned },
      pools,
      labs,
      standardLoads,
      curriculars,
      manualPeriods,
      unlinkedCount: unlinked.length,
      unlinkedEntries: unlinked
    };
  }, [viewMode, selectedTargetId, config, currentTimetable, assignments, users]);

  const getGlobalTeacherLoad = useCallback((teacherId: string) => {
    const assigned = currentTimetable.filter(e => e.teacherId === teacherId).length;
    const teacher = users.find(u => u.id === teacherId);
    if (!teacher) return { assigned, target: 0 };
    
    const policy = config.loadPolicies[teacher.role] || config.loadPolicies['DEFAULT'] || { baseTarget: 30 };
    return { assigned, target: policy.baseTarget };
  }, [currentTimetable, users, config.loadPolicies]);

  const AuditStatusBadge = ({ assigned, allocated }: { assigned: number, allocated: number }) => {
    if (assigned === allocated) return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black rounded-full flex items-center gap-1"><CheckCircle2 className="w-2 h-2" /> COMPLETE</span>;
    if (assigned > allocated) return <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[8px] font-black rounded-full flex items-center gap-1"><AlertCircle className="w-2 h-2" /> OVER ({assigned - allocated})</span>;
    return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black rounded-full flex items-center gap-1"><Clock className="w-2 h-2" /> PENDING ({allocated - assigned})</span>;
  };


  const [history, setHistory] = useState<TimeTableEntry[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    if (isDraftMode && history.length === 0 && timetableDraft.length > 0) {
      setHistory([timetableDraft]);
      setHistoryIndex(0);
    }
  }, [isDraftMode, timetableDraft, history.length]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isDraftMode || !isManagement) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            handleRedo();
          } else {
            e.preventDefault();
            handleUndo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDraftMode, isManagement, handleUndo, handleRedo]);

  const isCellLocked = useCallback((day: string, slotId: number, sectionId: string) => {
    if (!isDraftMode) return false;
    // Explicitly locked section
    if (lockedSectionIds.includes(sectionId)) return true;

    // Check if this cell contains a group period that involves a locked section
    const entries = currentTimetable.filter(e => e.day === day && e.slotId === slotId);
    const sectionEntry = entries.find(e => e.sectionId === sectionId);
    
    if (sectionEntry?.blockId) {
      const block = config.combinedBlocks?.find(b => b.id === sectionEntry.blockId) 
                 || config.labBlocks?.find(b => b.id === sectionEntry.blockId);
      if (block?.sectionIds?.some(sid => lockedSectionIds.includes(sid))) {
        return true;
      }
    }
    return false;
  }, [lockedSectionIds, currentTimetable, config.combinedBlocks, config.labBlocks, isDraftMode]);

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

  const handleMagicFill = () => {
    if (!assigningSlot) return;
    const { day, slotId, sectionId } = assigningSlot;
    const targetSectionId = sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
    
    if (!targetSectionId) {
      showToast("Please select a section first.", "error");
      return;
    }

    // Find teachers available in this slot
    const availableTeachers = users.filter(u => {
      if (u.role === UserRole.ADMIN || u.isResigned) return false;
      // Check collision
      const clash = checkCollision(u.id, targetSectionId, day, slotId, '');
      return !clash;
    });

    if (availableTeachers.length === 0) {
      showToast("No available teachers found for this slot.", "info");
      return;
    }

    // Sort by load (ascending)
    availableTeachers.sort((a, b) => {
      const loadA = currentTimetable.filter(e => e.teacherId === a.id).length;
      const loadB = currentTimetable.filter(e => e.teacherId === b.id).length;
      return loadA - loadB;
    });

    // Pick top one
    const bestTeacher = availableTeachers[0];
    setSelAssignTeacherId(bestTeacher.id);
    showToast(`Suggested: ${bestTeacher.name} (Load: ${currentTimetable.filter(e => e.teacherId === bestTeacher.id).length})`, "success");
    HapticService.light();
  };

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
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'MANUAL',
        subject: selAssignSubject,
        teacherName: teacher.name,
        status: 'SUCCESS',
        details: `Manually assigned ${selAssignSubject} to ${currentSection.fullName} on ${finalDay} Period ${finalSlotId}.`,
        assignedCount: 1,
        totalCount: 1
      }, ...prev]);
    } 
    else if (assignmentType === 'LAB') {
      if (!selAssignTeacherId || !selLabTechnicianId || !selAssignSubject) return;
      
      const labEntries: TimeTableEntry[] = [];
      const blockId = generateUUID();
      
      // Helper to create entries for a specific section
      const createLabEntriesForSection = (
        sectionId: string, 
        tId: string, 
        lTId: string, 
        sub: string, 
        rm: string,
        groupName: string
      ) => {
        const teacher = users.find(u => u.id === tId);
        const technician = users.find(u => u.id === lTId);
        const sect = config.sections.find(s => s.id === sectionId);
        
        if (!teacher || !technician || !sect) return;

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
          blockName: `${sub} Lab (${groupName})`
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
          blockName: `${sub} Lab (${groupName})`
        });
      };

      // Group 1 -> Section 1
      createLabEntriesForSection(finalSectionId, selAssignTeacherId, selLabTechnicianId, selAssignSubject, selAssignRoom, "G1");

      // Group 2 -> Section 2 (if exists)
      if (selLabSection2Id && selLab2Subject && selLab2TeacherId && selLab2TechnicianId) {
         createLabEntriesForSection(selLabSection2Id, selLab2TeacherId, selLab2TechnicianId, selLab2Subject, selLab2Room, "G2");
      } 
      // Fallback: If Section 2 exists but NO Group 2 defined, do we assign Group 1 to Section 2 as well?
      // Let's assume yes, it's a combined class with same teacher.
      else if (selLabSection2Id && (!selLab2Subject || !selLab2TeacherId)) {
         createLabEntriesForSection(selLabSection2Id, selAssignTeacherId, selLabTechnicianId, selAssignSubject, selAssignRoom, "G1");
      }
      
      setCurrentTimetable(prev => [...prev, ...labEntries]);
      
      const mainTeacher = users.find(u => u.id === selAssignTeacherId);
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'MANUAL',
        subject: 'Lab Group',
        teacherName: mainTeacher?.name || 'Unknown',
        status: 'SUCCESS',
        details: `Manually assigned Lab Group to ${currentSection.fullName} on ${finalDay} Period ${finalSlotId}.`,
        assignedCount: labEntries.length,
        totalCount: labEntries.length
      }, ...prev]);
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
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'MANUAL',
        subject: pool.heading,
        teacherName: 'Multiple Staff',
        status: 'SUCCESS',
        details: `Manually assigned Pool ${pool.title} to ${pool.sectionIds.length} sections on ${finalDay} Period ${finalSlotId}.`,
        assignedCount: newEntries.length,
        totalCount: newEntries.length
      }, ...prev]);
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
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'MANUAL',
        subject: rule.subject,
        teacherName: teacher?.name || 'Specialist',
        status: 'SUCCESS',
        details: `Manually assigned ${rule.subject} to ${currentSection.fullName} on ${finalDay} Period ${finalSlotId}.`,
        assignedCount: 1,
        totalCount: 1
      }, ...prev]);
    }
    setAssigningSlot(null);
    HapticService.success();
  };

  const handleManualEntry = () => {
    setAssigningSlot({ day: 'Sunday', slotId: 1 });
    setSelAssignDay('Sunday');
    setSelAssignSlotId(1);
    setSelAssignSectionId('');
    setSelAssignTeacherId('');
    setSelAssignSubject('');
    setSelAssignRoom('');
    setAssignmentType('STANDARD');
  };

  const handleSelectivePurge = (type: 'ALL' | 'LOADS' | 'POOLS' | 'ANCHORS' | 'CURRICULAR' | 'LABS') => {
    if (!isDraftMode || viewMode !== 'SECTION' || !selectedTargetId) return;
    
    if (lockedSectionIds.includes(selectedTargetId)) {
      showToast("This section is locked. Unlock it to purge periods.", "warning");
      return;
    }

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
          // Standard load is not a block, not slot 1, not curricular, and not a lab
          const isPool = !!e.blockId && !e.isSplitLab;
          const isAnchor = e.slotId === 1;
          const isCurricular = curricularSubjects.includes(e.subject);
          const isLab = e.isSplitLab;
          return isPool || isAnchor || isCurricular || isLab;
        case 'POOLS':
          return !(e.blockId && !e.isSplitLab);
        case 'ANCHORS':
          return e.slotId !== 1;
        case 'CURRICULAR':
          return !curricularSubjects.includes(e.subject);
        case 'LABS':
          return !e.isSplitLab;
        default:
          return true;
      }
    }));
    
    HapticService.notification();
    showToast(`Purge Complete: ${type} periods cleared for this class.`, "info");
    setIsPurgeMenuOpen(false);
  };

  const handleGenerateAnchors = (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = inputTimetable ? [...inputTimetable] : [...currentTimetable];
    if (isPurgeMode) {
      const teachersWithAnchors = users.filter(u => !u.isResigned && !!u.classTeacherOf);
      let sectionIdsToPurge = teachersWithAnchors.map(t => t.classTeacherOf).filter((sid): sid is string => !!sid);
      
      if (activeGradeId) {
        sectionIdsToPurge = sectionIdsToPurge.filter(sid => {
          const s = config.sections.find(sect => sect.id === sid);
          return s?.gradeId === activeGradeId;
        });
      }
      if (activeSectionId) {
        sectionIdsToPurge = sectionIdsToPurge.filter(sid => sid === activeSectionId);
      }
      
      baseTimetable = baseTimetable.filter(e => 
        !(e.slotId === 1 && sectionIdsToPurge.includes(e.sectionId) && !e.isManual)
      );
    }

    if (!inputTimetable) showToast("Phase 1: Analyzing registry anchors...", "info");
    const teachersWithAnchors = users.filter(u => {
      if (u.isResigned || !u.classTeacherOf) return false;
      if (activeSectionId && u.classTeacherOf !== activeSectionId) return false;
      if (lockedSectionIds.includes(u.classTeacherOf)) return false;
      return true;
    });
    let newEntries: TimeTableEntry[] = [];
    let newParkedItems: ParkedItem[] = [];
    let count = 0;
    let parkedCount = 0;
    let conflicts: string[] = [];

    teachersWithAnchors.forEach(teacher => {
      const section = config.sections.find(s => s.id === teacher.classTeacherOf);
      if (!section) return;

      const asgn = assignments.find(a => a.teacherId === teacher.id && a.gradeId === section.gradeId);
      if (!asgn || !asgn.anchorSubject) return;

      // Idea #1: Respect the "Force Slot 1" flag. Default to true if undefined to maintain backward compatibility.
      if (asgn.forceAnchorSlot1 === false) return;

      const targetCount = asgn.anchorPeriods !== undefined ? asgn.anchorPeriods : 5;
      const targetDays = DAYS.slice(0, targetCount);

      targetDays.forEach(day => {
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
        } else {
          // Idea #2: Log conflict for reporting
          conflicts.push(`${section.fullName} (${day})`);
          
          // Park unplaced anchor
          const parkedEntry: TimeTableEntry = {
            id: generateUUID(),
            section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
            wingId: section.wingId,
            gradeId: section.gradeId,
            sectionId: section.id,
            className: section.fullName,
            day: '', slotId: 0,
            subject: asgn.anchorSubject!,
            subjectCategory: SubjectCategory.CORE,
            teacherId: teacher.id,
            teacherName: teacher.name,
            room: `ROOM ${section.fullName}`,
            isManual: false
          };
          newParkedItems.push({
            id: generateUUID(),
            entries: [parkedEntry],
            type: 'SINGLE',
            reason: `Could not place Anchor Subject (${asgn.anchorSubject}) for ${section.fullName}. Teacher ${teacher.name} may be fully booked or hit consecutive class limits, or no valid slots available.`
          });
          parkedCount++;
        }
      });
    });

    const finalTimetable = [...baseTimetable, ...newEntries];

    if (!inputTimetable) {
      if (count > 0 || isPurgeMode || parkedCount > 0) {
        if (count > 0 || isPurgeMode) setCurrentTimetable(finalTimetable);
        if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
        HapticService.success();
        const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
        
        const parkMsg = parkedCount > 0 ? ` (${parkedCount} parked)` : '';
        if (conflicts.length > 0) {
           showToast(`Generated ${count} anchors${parkMsg}. Skipped ${conflicts.length} due to conflicts in: ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '...' : ''}`, "warning");
           
           setAssignmentLogs(prev => [{
              id: generateUUID(),
              timestamp: new Date().toLocaleTimeString(),
              actionType: 'AUTO_ANCHOR',
              subject: 'Anchor Subjects',
              teacherName: 'System',
              status: 'PARTIAL',
              details: `Generated ${count} anchors. ${parkedCount} parked. Conflicts: ${conflicts.slice(0, 3).join(', ')}...`,
              assignedCount: count,
              totalCount: count + parkedCount + conflicts.length
           }, ...prev]);
        } else {
           showToast(`Phase 1 Complete: ${count} anchors assigned for ${targetName}${parkMsg}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
           
           setAssignmentLogs(prev => [{
              id: generateUUID(),
              timestamp: new Date().toLocaleTimeString(),
              actionType: 'AUTO_ANCHOR',
              subject: 'Anchor Subjects',
              teacherName: 'System',
              status: 'SUCCESS',
              details: `Successfully assigned ${count} anchors for ${targetName}.`,
              assignedCount: count,
              totalCount: count
           }, ...prev]);
        }
      } else if (conflicts.length > 0) {
         showToast(`Phase 1 Failed: ${conflicts.length} conflicts detected (e.g. ${conflicts[0]}). No anchors generated.`, "error");
         
         setAssignmentLogs(prev => [{
            id: generateUUID(),
            timestamp: new Date().toLocaleTimeString(),
            actionType: 'AUTO_ANCHOR',
            subject: 'Anchor Subjects',
            teacherName: 'System',
            status: 'FAILED',
            details: `Failed to assign anchors. ${conflicts.length} conflicts detected.`,
            assignedCount: 0,
            totalCount: conflicts.length
         }, ...prev]);
      } else {
        showToast("Phase 1: No eligible anchors found for deployment.", "warning");
      }
    }
    
    return finalTimetable;
  };

  const runWorkerPhase = async (phase: 'POOLS' | 'LABS' | 'CURRICULARS' | 'LOADS' | 'FULL', inputTimetable?: TimeTableEntry[]) => {
    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    
    return new Promise<TimeTableEntry[]>((resolve) => {
      const worker = new Worker(new URL('../workers/timetableWorker.ts', import.meta.url), { type: 'module' });
      
      worker.onmessage = (e) => {
        const { newTimetable, parkedItems } = e.data;
        const count = newTimetable.length - (inputTimetable ? inputTimetable.length : currentTimetable.length);
        const parkedCount = parkedItems.length;

        if (!inputTimetable) {
          if (count > 0 || isPurgeMode || parkedCount > 0) {
            if (count > 0 || isPurgeMode) setCurrentTimetable(newTimetable);
            if (parkedCount > 0) setParkedEntries(prev => [...prev, ...parkedItems]);
            HapticService.success();
            showToast(`Phase ${phase} Complete: ${count} periods distributed. ${parkedCount} parked.`, "success");
          }
        }
        
        worker.terminate();
        resolve(newTimetable);
      };

      worker.onerror = (error) => {
        console.error("Worker error:", error);
        showToast(`Phase ${phase}: Worker encountered an error.`, "error");
        worker.terminate();
        resolve(inputTimetable || currentTimetable);
      };

      worker.postMessage({
        phase, config, users, assignments, lockedSectionIds,
        currentTimetable: inputTimetable || currentTimetable,
        activeSectionId, isPurgeMode
      });
    });
  };

  const handleGeneratePools = async (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;
    showToast("Phase 2: Synchronizing subject pools via Worker...", "info");
    return runWorkerPhase('POOLS', inputTimetable);
  };

  const _old_handleGeneratePools = (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode || !config.combinedBlocks) return inputTimetable || currentTimetable;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = inputTimetable ? [...inputTimetable] : [...currentTimetable];
    if (isPurgeMode) {
      const poolBlockIds = (config.combinedBlocks || []).map(p => p.id);
      baseTimetable = baseTimetable.filter(e => {
        const isPool = e.blockId && poolBlockIds.includes(e.blockId) && !e.isManual;
        if (!isPool) return true;
        // For synchronized blocks, always purge the whole grade to maintain alignment
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    if (!inputTimetable) showToast("Phase 3: Synchronizing subject pools...", "info");
    let newEntries: TimeTableEntry[] = [];
    let newParkedItems: ParkedItem[] = [];
    let count = 0;
    let parkedCount = 0;

    (config.combinedBlocks || []).forEach(pool => {
      if (!pool.sectionIds) return;
      // For group periods, allow generation for the whole grade if a section from that grade is active
      if (activeGradeId && pool.gradeId !== activeGradeId) return;
      
      // Skip if any section in the pool is locked
      if (pool.sectionIds.some(sid => lockedSectionIds.includes(sid))) return;
      
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

      if (pool.onTrot) {
        let possiblePairStarts: { day: string, slot: number }[] = [];
        DAYS.forEach(day => {
          for (let slot = 1; slot < 10; slot++) {
            if (pool.restrictedSlots && (pool.restrictedSlots.includes(slot) || pool.restrictedSlots.includes(slot + 1))) continue;
            possiblePairStarts.push({ day, slot });
          }
        });

        for (let i = possiblePairStarts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [possiblePairStarts[i], possiblePairStarts[j]] = [possiblePairStarts[j], possiblePairStarts[i]];
        }

        for (const { day, slot } of possiblePairStarts) {
          if (placed >= pool.weeklyPeriods - 1) break;
          if ((dayCounts[day] || 0) >= 1) continue;

          let allFree = true;
          let isBreakAnywhere = false;

          for (const sid of (pool.sectionIds || [])) {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) continue;

            const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
            
            const s1 = wingSlots.find(s => s.id === slot);
            if (!s1 || s1.isBreak) { isBreakAnywhere = true; break; }
            if (checkCollision('POOL_VAR', sid, day, slot, '', undefined, [...baseTimetable, ...newEntries], pool.id)) { allFree = false; break; }

            const s2 = wingSlots.find(s => s.id === slot + 1);
            if (!s2 || s2.isBreak) { isBreakAnywhere = true; break; }
            if (checkCollision('POOL_VAR', sid, day, slot + 1, '', undefined, [...baseTimetable, ...newEntries], pool.id)) { allFree = false; break; }
          }

          if (allFree && !isBreakAnywhere) {
            (pool.sectionIds || []).forEach(sid => {
              const sect = config.sections.find(s => s.id === sid);
              if (!sect) return;

              [slot, slot + 1].forEach(s => {
                newEntries.push({
                  id: generateUUID(),
                  section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                  wingId: sect.wingId,
                  gradeId: sect.gradeId,
                  sectionId: sect.id,
                  className: sect.fullName,
                  day, slotId: s,
                  subject: pool.heading,
                  subjectCategory: SubjectCategory.CORE,
                  teacherId: 'POOL_VAR',
                  teacherName: 'Multiple Staff',
                  blockId: pool.id,
                  blockName: pool.title,
                  isManual: false
                });
              });
            });
            placed += 2;
            dayCounts[day] = (dayCounts[day] || 0) + 2;
          }
        }
      }

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
      
      // Park unplaced pool blocks
      if (placed < pool.weeklyPeriods) {
        const unplacedCount = pool.weeklyPeriods - placed;
        for (let i = 0; i < unplacedCount; i++) {
          const blockEntries: TimeTableEntry[] = [];
          (pool.sectionIds || []).forEach(sid => {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) return;

            blockEntries.push({
              id: generateUUID(),
              section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
              wingId: sect.wingId,
              gradeId: sect.gradeId,
              sectionId: sect.id,
              className: sect.fullName,
              day: '', slotId: 0,
              subject: pool.heading,
              subjectCategory: SubjectCategory.CORE,
              teacherId: 'POOL_VAR',
              teacherName: 'Multiple Staff',
              blockId: pool.id,
              blockName: pool.title,
              isManual: false
            });
          });
          
          if (blockEntries.length > 0) {
            newParkedItems.push({
              id: generateUUID(),
              entries: blockEntries,
              type: 'BLOCK',
              blockId: pool.id,
              reason: `Could not place Pool (${pool.title}). One or more teachers/rooms are occupied, or it hits a break time.`
            });
            parkedCount++;
          }
        }
      }
    });

    const finalTimetable = [...baseTimetable, ...newEntries];

    if (!inputTimetable) {
      if (count > 0 || isPurgeMode || parkedCount > 0) {
        if (count > 0 || isPurgeMode) setCurrentTimetable(finalTimetable);
        if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
        HapticService.success();
        const targetName = activeGradeId ? config.grades.find(g => g.id === activeGradeId)?.name : 'all grades';
        const parkMsg = parkedCount > 0 ? ` (${parkedCount} blocks parked)` : '';
        showToast(`Phase 2 Complete: ${count} parallel pool periods synchronized for ${targetName}${parkMsg}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
        
        setAssignmentLogs(prev => [{
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AUTO_POOL',
          subject: 'Subject Pools',
          teacherName: 'System',
          status: parkedCount > 0 ? 'PARTIAL' : 'SUCCESS',
          details: `Assigned ${count} pool periods for ${targetName}. ${parkedCount} blocks parked.`,
          assignedCount: count,
          totalCount: count + parkedCount
        }, ...prev]);
      } else {
        showToast("Phase 2: Matrix full. No additional pool slots could be synchronized.", "warning");
        
        setAssignmentLogs(prev => [{
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AUTO_POOL',
          subject: 'Subject Pools',
          teacherName: 'System',
          status: 'FAILED',
          details: 'Matrix full. No pool slots synchronized.',
          assignedCount: 0,
          totalCount: 0
        }, ...prev]);
      }
    }
    
    return finalTimetable;
  };

  const handleGenerateCurriculars = async (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;
    showToast("Phase 4: Distributing curricular activities via Worker...", "info");
    return runWorkerPhase('CURRICULARS', inputTimetable);
  };

  const _old_handleGenerateCurriculars = (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode || !config.extraCurricularRules) return inputTimetable || currentTimetable;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = inputTimetable ? [...inputTimetable] : [...currentTimetable];
    if (isPurgeMode) {
      const curricularSubjects = (config.extraCurricularRules || []).map(r => r.subject);
      baseTimetable = baseTimetable.filter(e => {
        const isCurricular = curricularSubjects.includes(e.subject) && !e.isManual;
        if (!isCurricular) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    if (!inputTimetable) showToast("Phase 4: Deploying curricular mandates...", "info");
    let newEntries: TimeTableEntry[] = [];
    let newParkedItems: ParkedItem[] = [];
    let count = 0;
    let parkedCount = 0;

    config.extraCurricularRules.forEach(rule => {
      const teacher = users.find(u => u.id === rule.teacherId);
      if (!teacher || !rule.sectionIds) return;

      const filteredSectionIds = activeSectionId 
        ? rule.sectionIds.filter(sid => sid === activeSectionId)
        : rule.sectionIds;

      filteredSectionIds.forEach(sid => {
        const section = config.sections.find(s => s.id === sid);
        if (!section) return;
        
        // Skip if section is locked
        if (lockedSectionIds.includes(sid)) return;

        // Count existing entries for this rule and section in baseTimetable
        let placed = baseTimetable.filter(e => 
          e.sectionId === sid && 
          e.subject === rule.subject && 
          e.teacherId === rule.teacherId
        ).length;

        // Keep track of days already having this subject
        const daysWithSubject = new Set(
          baseTimetable.filter(e => 
            e.sectionId === sid && 
            e.subject === rule.subject && 
            e.teacherId === rule.teacherId
          ).map(e => e.day)
        );

        // First pass: Try to place 1 per day on days that don't have it yet
        for (const day of DAYS) {
          if (placed >= rule.periodsPerWeek) break;
          if (daysWithSubject.has(day)) continue;

          for (let slot = 1; slot <= 10; slot++) {
            const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
            const slotObj = wingSlots.find(s => s.id === slot);
            if (!slotObj || slotObj.isBreak) continue;

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
              daysWithSubject.add(day);
              break; // Move to the next day
            }
          }
        }

        // Second pass: If still not placed, just place anywhere
        if (placed < rule.periodsPerWeek) {
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
        }
        
        // Park unplaced curricular periods
        if (placed < rule.periodsPerWeek) {
          const unplacedCount = rule.periodsPerWeek - placed;
          for (let i = 0; i < unplacedCount; i++) {
            const parkedEntry: TimeTableEntry = {
              id: generateUUID(),
              section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
              wingId: section.wingId,
              gradeId: section.gradeId,
              sectionId: section.id,
              className: section.fullName,
              day: '', slotId: 0,
              subject: rule.subject,
              subjectCategory: SubjectCategory.CORE,
              teacherId: teacher.id,
              teacherName: teacher.name,
              room: rule.room,
              isManual: false
            };
            newParkedItems.push({
              id: generateUUID(),
              entries: [parkedEntry],
              type: 'SINGLE',
              reason: `Could not place Activity (${rule.subject}) for ${section.fullName}. Teacher ${teacher.name} may be fully booked or hit consecutive class limits, or no valid slots available.`
            });
            parkedCount++;
          }
        }
      });
    });

    const finalTimetable = [...baseTimetable, ...newEntries];

    if (!inputTimetable) {
      if (count > 0 || isPurgeMode || parkedCount > 0) {
        if (count > 0 || isPurgeMode) setCurrentTimetable(finalTimetable);
        if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
        HapticService.success();
        const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
        const parkMsg = parkedCount > 0 ? ` (${parkedCount} periods parked)` : '';
        showToast(`Phase 3 Complete: ${count} specialized curricular periods deployed for ${targetName}${parkMsg}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
      } else {
        showToast("Phase 3: No valid slots identified for curricular rules.", "warning");
      }
    }
    
    return finalTimetable;
  };

  const handleGenerateLoads = async (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;
    showToast("Phase 5: Optimizing instructional loads via Worker...", "info");
    return runWorkerPhase('LOADS', inputTimetable);
  };

  const handleGapCloser = async (inputTimetable: TimeTableEntry[]) => {
    showToast("AI Gap Closer: Identifying critical gaps...", "info");
    
    // 1. Identify Gaps
    const gaps: { teacherId: string, subject: string, sectionId: string, missing: number, load: any }[] = [];
    
    assignments.forEach(asgn => {
       asgn.loads.forEach(load => {
          const targetSections = load.sectionId 
          ? config.sections.filter(s => s.id === load.sectionId)
          : config.sections.filter(s => 
              asgn.targetSectionIds.length > 0 
                ? asgn.targetSectionIds.includes(s.id) 
                : s.gradeId === asgn.gradeId
            );
            
          targetSections.forEach(section => {
             const placed = inputTimetable.filter(e => 
                e.sectionId === section.id && 
                e.teacherId === asgn.teacherId && 
                e.subject === load.subject &&
                !e.blockId
             ).length;
             
             if (placed < load.periods) {
                gaps.push({
                   teacherId: asgn.teacherId,
                   subject: load.subject,
                   sectionId: section.id,
                   missing: load.periods - placed,
                   load: load
                });
             }
          });
       });
    });
    
    if (gaps.length === 0) {
       showToast("Gap Closer: No gaps found! Timetable is complete.", "success");
       return;
    }
    
    // 2. Prioritize Gaps (Top 3)
    gaps.sort((a, b) => b.missing - a.missing);
    const topGaps = gaps.slice(0, 3);
    
    showToast(`Gap Closer: Attempting to resolve ${topGaps.length} critical gaps via AI...`, "info");
    
    // 3. Resolve Gaps one by one
    for (const gap of topGaps) {
       const teacher = users.find(u => u.id === gap.teacherId);
       const section = config.sections.find(s => s.id === gap.sectionId);
       if (!teacher || !section) continue;
       
       let bestCandidate: { day: string, slot: number, conflictCount: number, conflictSourceId?: string } | null = null;
       
       for (const day of DAYS) {
          for (let slot = 1; slot <= 10; slot++) {
             const wingSlots = (config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
             const slotObj = wingSlots.find(s => s.id === slot);
             if (!slotObj || slotObj.isBreak) continue;
             
             const teacherBusy = inputTimetable.some(e => e.teacherId === teacher.id && e.day === day && e.slotId === slot);
             if (teacherBusy) continue;
             
             const sectionEntry = inputTimetable.find(e => e.sectionId === section.id && e.day === day && e.slotId === slot);
             
             if (sectionEntry) {
                if (!bestCandidate) {
                   bestCandidate = { day, slot, conflictCount: 1, conflictSourceId: sectionEntry.id };
                }
             } else {
                const roomClash = checkCollision(teacher.id, section.id, day, slot, gap.load.room || `ROOM ${section.fullName}`, undefined, inputTimetable);
                if (!roomClash) {
                   inputTimetable.push({
                      id: generateUUID(),
                      section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                      wingId: section.wingId,
                      gradeId: section.gradeId,
                      sectionId: section.id,
                      className: section.fullName,
                      day, slotId: slot,
                      subject: gap.subject,
                      subjectCategory: SubjectCategory.CORE,
                      teacherId: teacher.id,
                      teacherName: teacher.name,
                      room: gap.load.room || `ROOM ${section.fullName}`,
                      isManual: false
                   });
                   setCurrentTimetable([...inputTimetable]);
                   showToast(`Gap Closer: Auto-filled ${gap.subject} for ${section.fullName} at ${day} P${slot}`, "success");
                   return;
                }
             }
          }
       }
       
       if (bestCandidate && bestCandidate.conflictSourceId) {
          const conflictEntry = inputTimetable.find(e => e.id === bestCandidate!.conflictSourceId);
          if (conflictEntry) {
             setAiResolutionModal({
                conflict: `Gap Closer Request: Need to free up ${bestCandidate.day} P${bestCandidate.slot} for ${gap.subject} (${teacher.name}). Slot currently occupied by ${conflictEntry.subject}.`,
                source: { 
                   id: "GAP_CLOSER_VIRTUAL_ID", 
                   teacherId: gap.teacherId, 
                   sectionId: gap.sectionId,
                   day: bestCandidate.day, 
                   slotId: bestCandidate.slot,
                   subject: gap.subject
                } as any, // Cast as any to bypass strict type checks for virtual entry
                target: {
                   day: bestCandidate.day,
                   slotId: bestCandidate.slot
                }
             });
             return;
          }
       }
    }
    
    showToast("Gap Closer: Could not automatically resolve remaining gaps. Please use AI Architect.", "warning");
  };

  const handleAiConductor = async () => {
    if (!isDraftMode) return;
    setIsAiProcessing(true);
    showToast("AI Conductor: Initiating full generation sequence...", "info");
    
    try {
      // Step 1: Anchors
      let current = handleGenerateAnchors(currentTimetable) || currentTimetable;
      await new Promise(r => setTimeout(r, 500));
      
      // Step 2: Pools
      current = await handleGeneratePools(current) || current;
      await new Promise(r => setTimeout(r, 500));
      
      // Step 3: Labs
      current = await handleGenerateLabs(current) || current;
      await new Promise(r => setTimeout(r, 500));

      // Step 4: Curriculars
      current = await handleGenerateCurriculars(current) || current;
      await new Promise(r => setTimeout(r, 500));
      
      // Step 5: Loads
      current = await handleGenerateLoads(current) || current;
      
      setCurrentTimetable(current);
      
      // Step 6: Gap Closer
      await handleGapCloser(current);
      
    } catch (error: any) {
      console.error("AI Conductor Error:", error);
      if (error.message?.includes('GATING_ERROR')) {
        setIsGatingError(true);
        setIsAiArchitectOpen(true);
      }
      showToast("AI Conductor encountered an error.", "error");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleGenerateLabs = async (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;
    showToast("Phase 3: Deploying lab blocks via Worker...", "info");
    return runWorkerPhase('LABS', inputTimetable);
  };

  const _old_handleGenerateLabs = (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode || !config.labBlocks) return inputTimetable || currentTimetable;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = inputTimetable ? [...inputTimetable] : [...currentTimetable];
    if (isPurgeMode) {
      const labBlockIds = (config.labBlocks || []).map(p => p.id);
      baseTimetable = baseTimetable.filter(e => {
        const isLab = e.blockId && labBlockIds.includes(e.blockId) && !e.isManual;
        if (!isLab) return true;
        // For synchronized blocks, always purge the whole grade to maintain alignment
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    showToast("Phase 2: Synchronizing lab periods...", "info");
    let newEntries: TimeTableEntry[] = [];
    let newParkedItems: ParkedItem[] = [];
    let count = 0;
    let parkedCount = 0;

    (config.labBlocks || []).forEach(rawLab => {
      // Migration for old lab format
      const lab: LabBlock = rawLab.allocations ? rawLab : {
        ...rawLab,
        allocations: [{
          id: generateUUID(),
          subject: (rawLab as any).subject,
          teacherId: (rawLab as any).teacherId,
          technicianId: (rawLab as any).technicianId,
          room: (rawLab as any).room
        }]
      };

      if (!lab.sectionIds || lab.sectionIds.length === 0) return;
      if (activeGradeId && lab.gradeId !== activeGradeId) return;
      
      // Skip if any section in the lab is locked
      if (lab.sectionIds.some(sid => lockedSectionIds.includes(sid))) return;
      
      const existingLabSlots = baseTimetable.filter(e => e.blockId === lab.id);
      const uniqueExistingSlots = new Set(existingLabSlots.map(e => `${e.day}-${e.slotId}`));
      let placed = lab.isDoublePeriod ? uniqueExistingSlots.size / 2 : uniqueExistingSlots.size;
      
      let possibleSlots: { day: string, slot: number }[] = [];
      DAYS.forEach(day => {
        for (let slot = 1; slot <= (lab.isDoublePeriod ? 9 : 10); slot++) {
          if (lab.restrictedSlots && (lab.restrictedSlots.includes(slot) || (lab.isDoublePeriod && lab.restrictedSlots.includes(slot + 1)))) continue;
          possibleSlots.push({ day, slot });
        }
      });
      
      for (let i = possibleSlots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [possibleSlots[i], possibleSlots[j]] = [possibleSlots[j], possibleSlots[i]];
      }

      if (lab.preferredSlots && lab.preferredSlots.length > 0) {
        possibleSlots.sort((a, b) => {
          const aPref = lab.preferredSlots!.includes(a.slot) ? -1 : 1;
          const bPref = lab.preferredSlots!.includes(b.slot) ? -1 : 1;
          return aPref - bPref;
        });
      }

      const dayCounts: Record<string, number> = {};
      existingLabSlots.forEach(e => {
        dayCounts[e.day] = (dayCounts[e.day] || 0) + 1;
      });

      const tryPlaceLab = (day: string, slot: number) => {
        let allFree = true;
        let isBreakAnywhere = false;

        for (const sid of (lab.sectionIds || [])) {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) continue;

          const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
          const slotObj1 = wingSlots.find(s => s.id === slot);
          if (!slotObj1 || slotObj1.isBreak) {
            isBreakAnywhere = true;
            break;
          }

          for (const alloc of lab.allocations) {
            if (checkCollision(alloc.teacherId, sid, day, slot, alloc.room, undefined, [...baseTimetable, ...newEntries], lab.id)) {
              allFree = false;
              break;
            }
            if (alloc.technicianId && checkCollision(alloc.technicianId, sid, day, slot, alloc.room, undefined, [...baseTimetable, ...newEntries], lab.id)) {
              allFree = false;
              break;
            }
          }
          if (!allFree) break;

          if (lab.isDoublePeriod) {
            const slotObj2 = wingSlots.find(s => s.id === slot + 1);
            if (!slotObj2 || slotObj2.isBreak) {
              isBreakAnywhere = true;
              break;
            }
            for (const alloc of lab.allocations) {
              if (checkCollision(alloc.teacherId, sid, day, slot + 1, alloc.room, undefined, [...baseTimetable, ...newEntries], lab.id)) {
                allFree = false;
                break;
              }
              if (alloc.technicianId && checkCollision(alloc.technicianId, sid, day, slot + 1, alloc.room, undefined, [...baseTimetable, ...newEntries], lab.id)) {
                allFree = false;
                break;
              }
            }
            if (!allFree) break;
          }
        }

        if (allFree && !isBreakAnywhere) {
          const allPersonnelExist = lab.allocations.every(alloc => {
            const teacher = users.find(u => u.id === alloc.teacherId);
            return !!teacher; // Technician is optional
          });
          if (!allPersonnelExist) return false;

          (lab.sectionIds || []).forEach(sid => {
            const sect = config.sections.find(s => s.id === sid);
            if (!sect) return;

            lab.allocations.forEach(alloc => {
              const teacher = users.find(u => u.id === alloc.teacherId)!;
              const technician = alloc.technicianId ? users.find(u => u.id === alloc.technicianId) : null;

              newEntries.push({
                id: generateUUID(),
                section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                wingId: sect.wingId,
                gradeId: sect.gradeId,
                sectionId: sect.id,
                className: sect.fullName,
                day, slotId: slot,
                subject: alloc.subject,
                subjectCategory: SubjectCategory.CORE,
                teacherId: alloc.teacherId,
                teacherName: teacher.name,
                secondaryTeacherId: technician?.id,
                secondaryTeacherName: technician?.name,
                room: alloc.room,
                isManual: false,
                isDouble: lab.isDoublePeriod,
                isSplitLab: true,
                blockId: lab.id,
                blockName: lab.title
              });

              if (lab.isDoublePeriod) {
                newEntries.push({
                  id: generateUUID(),
                  section: (sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS') as SectionType,
                  wingId: sect.wingId,
                  gradeId: sect.gradeId,
                  sectionId: sect.id,
                  className: sect.fullName,
                  day, slotId: slot + 1,
                  subject: alloc.subject,
                  subjectCategory: SubjectCategory.CORE,
                  teacherId: alloc.teacherId,
                  teacherName: teacher.name,
                  secondaryTeacherId: technician?.id,
                  secondaryTeacherName: technician?.name,
                  room: alloc.room,
                  isManual: false,
                  isDouble: lab.isDoublePeriod,
                  isSplitLab: true,
                  blockId: lab.id,
                  blockName: lab.title
                });
              }
            });
          });
          return true;
        }
        return false;
      };

      // Phase 1: Spread across days
      for (const { day, slot } of possibleSlots) {
        if (placed >= lab.weeklyOccurrences) break;
        if ((dayCounts[day] || 0) >= 1) continue;
        
        if (tryPlaceLab(day, slot)) {
          dayCounts[day] = (dayCounts[day] || 0) + 1;
          placed++;
          count++;
        }
      }

      // Phase 2: Fill remaining if needed (allowing up to 2 per day)
      if (placed < lab.weeklyOccurrences) {
        for (const { day, slot } of possibleSlots) {
          if (placed >= lab.weeklyOccurrences) break;
          if ((dayCounts[day] || 0) >= 2) continue;
          
          if (tryPlaceLab(day, slot)) {
            dayCounts[day] = (dayCounts[day] || 0) + 1;
            placed++;
            count++;
          }
        }
      }
      
      // Park unplaced lab blocks
      if (placed < lab.weeklyOccurrences) {
        const unplacedCount = lab.weeklyOccurrences - placed;
        for (let i = 0; i < unplacedCount; i++) {
          const blockEntries: TimeTableEntry[] = [];
          lab.sectionIds.forEach(sid => {
            const section = config.sections.find(s => s.id === sid);
            if (!section) return;

            lab.allocations.forEach(alloc => {
              const teacher = users.find(u => u.id === alloc.teacherId);
              const technician = alloc.technicianId ? users.find(u => u.id === alloc.technicianId) : null;
              if (!teacher) return;

              blockEntries.push({
                id: generateUUID(),
                section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                wingId: section.wingId,
                gradeId: section.gradeId,
                sectionId: section.id,
                className: section.fullName,
                day: '', slotId: 0,
                subject: alloc.subject,
                subjectCategory: SubjectCategory.CORE,
                teacherId: teacher.id,
                teacherName: teacher.name,
                secondaryTeacherId: technician?.id,
                secondaryTeacherName: technician?.name,
                room: alloc.room,
                isManual: false,
                isDouble: lab.isDoublePeriod,
                isSplitLab: true,
                blockId: lab.id,
                blockName: lab.title
              });

              if (lab.isDoublePeriod) {
                blockEntries.push({
                  id: generateUUID(),
                  section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                  wingId: section.wingId,
                  gradeId: section.gradeId,
                  sectionId: section.id,
                  className: section.fullName,
                  day: '', slotId: 0,
                  subject: alloc.subject,
                  subjectCategory: SubjectCategory.CORE,
                  teacherId: teacher.id,
                  teacherName: teacher.name,
                  secondaryTeacherId: technician?.id,
                  secondaryTeacherName: technician?.name,
                  room: alloc.room,
                  isManual: false,
                  isDouble: lab.isDoublePeriod,
                  isSplitLab: true,
                  blockId: lab.id,
                  blockName: lab.title
                });
              }
            });
          });
          
          if (blockEntries.length > 0) {
            newParkedItems.push({
              id: generateUUID(),
              entries: blockEntries,
              type: 'BLOCK',
              blockId: lab.id,
              reason: `Could not place Lab (${lab.title}). One or more teachers/rooms are occupied, or it hits a break time.`
            });
            parkedCount++;
          }
        }
      }
    });

    const finalTimetable = [...baseTimetable, ...newEntries];

    if (!inputTimetable) {
      if (count > 0 || isPurgeMode || parkedCount > 0) {
        if (count > 0 || isPurgeMode) setCurrentTimetable(finalTimetable);
        if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
        HapticService.success();
        const targetName = activeGradeId ? config.grades.find(g => g.id === activeGradeId)?.name : 'all grades';
        const parkMsg = parkedCount > 0 ? ` (${parkedCount} blocks parked)` : '';
        showToast(`Phase 5 Complete: ${count} lab periods synchronized for ${targetName}${parkMsg}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
        
        setAssignmentLogs(prev => [{
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AUTO_LAB',
          subject: 'Lab Periods',
          teacherName: 'System',
          status: parkedCount > 0 ? 'PARTIAL' : 'SUCCESS',
          details: `Assigned ${count} lab periods for ${targetName}. ${parkedCount} blocks parked.`,
          assignedCount: count,
          totalCount: count + parkedCount
        }, ...prev]);
      } else {
        showToast("Phase 5: Matrix full. No additional lab slots could be synchronized.", "warning");
        
        setAssignmentLogs(prev => [{
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AUTO_LAB',
          subject: 'Lab Periods',
          teacherName: 'System',
          status: 'FAILED',
          details: 'Matrix full. No lab slots synchronized.',
          assignedCount: 0,
          totalCount: 0
        }, ...prev]);
      }
    }

    return finalTimetable;
  };

  const handleParkSource = () => {
    if (!swapSource || swapSource.isFromParkingLot) return;
    
    const sourceEntry = currentTimetable.find(e => e.id === swapSource.entryId);
    if (!sourceEntry) return;

    const sourceBlockId = sourceEntry.blockId;
    const entriesToPark = sourceBlockId 
      ? currentTimetable.filter(e => e.blockId === sourceBlockId && e.day === swapSource.day && e.slotId === swapSource.slotId)
      : [sourceEntry];

    if (entriesToPark.length === 0) {
      setSwapSource(null);
      return;
    }

    if (entriesToPark.some(e => lockedSectionIds.includes(e.sectionId))) {
      showToast("Cannot park this entry because one or more associated sections are locked.", "error");
      return;
    }

    const newParkedItem: ParkedItem = {
      id: generateUUID(),
      entries: entriesToPark,
      type: sourceBlockId ? 'BLOCK' : 'SINGLE',
      blockId: sourceBlockId,
      reason: 'Manually moved to the parking lot.'
    };

    setParkedEntries(prev => [...prev, newParkedItem]);
    
    const entryIdsToRemove = entriesToPark.map(e => e.id);
    setCurrentTimetable(prev => prev.filter(e => !entryIdsToRemove.includes(e.id)));
    
    setSwapSource(null);
    setIsParkingLotOpen(true);
    HapticService.light();
    showToast("Moved to Parking Lot", "success");
  };

  const handleFindSwaps = (parked: ParkedItem) => {
    setResolvingParkedItemId(parked.id);
    setSwapSuggestions([]);
    
    const suggestions: SwapSuggestion[] = [];
    
    if (parked.type === 'SINGLE') {
      const MAX_DEPTH = 2; // Up to 2 displaced entries (3-step swap)
      const parkedEntry = parked.entries[0];

      const dfs = (
        entryToPlace: TimeTableEntry,
        currentTimetableState: TimeTableEntry[],
        depth: number,
        movesSoFar: { entryId: string, newDay: string, newSlot: number, subject: string, teacherName: string }[],
        placements: { parkedEntryId: string, day: string, slot: number }[]
      ) => {
        if (suggestions.length >= 5) return;

        for (const day of DAYS) {
          for (let slot = 1; slot <= 10; slot++) {
            // Check if slot is a break
            const section = config.sections.find(s => s.id === entryToPlace.sectionId);
            if (!section) continue;
            const wingSlots = config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS;
            const slotObj = wingSlots.find(s => s.id === slot);
            if (!slotObj || slotObj.isBreak) continue;

            const collisions = currentTimetableState.filter(e => 
              e.day === day && e.slotId === slot &&
              (e.teacherId === entryToPlace.teacherId || e.sectionId === entryToPlace.sectionId || (e.room && entryToPlace.room && e.room === entryToPlace.room))
            );

            if (collisions.length === 0) {
              const clash = checkCollision(entryToPlace.teacherId, entryToPlace.sectionId, day, slot, entryToPlace.room || '', undefined, currentTimetableState, entryToPlace.blockId, entryToPlace.secondaryTeacherId, entryToPlace.isSplitLab);
              if (!clash) {
                if (depth === 0) {
                  suggestions.push({
                    id: generateUUID(),
                    description: `Place ${entryToPlace.subject} directly at ${day} Slot ${slot} (No swaps needed).`,
                    moves: [],
                    placements: [{ parkedEntryId: parkedEntry.id, day, slot }]
                  });
                } else {
                  const newMoves = [...movesSoFar, { entryId: entryToPlace.id, newDay: day, newSlot: slot, subject: entryToPlace.subject, teacherName: entryToPlace.teacherName }];
                  let desc = "";
                  if (newMoves.length === 1) {
                    desc = `Move ${newMoves[0].subject} (${newMoves[0].teacherName}) to ${newMoves[0].newDay} S${newMoves[0].newSlot}, then place ${parkedEntry.subject} at ${placements[0].day} S${placements[0].slot}.`;
                  } else {
                    const movesDesc = newMoves.map(m => `${m.subject} to ${m.newDay} S${m.newSlot}`).join(', ');
                    desc = `Deep Swap: Move ${movesDesc}, then place ${parkedEntry.subject} at ${placements[0].day} S${placements[0].slot}.`;
                  }
                  suggestions.push({
                    id: generateUUID(),
                    description: desc,
                    moves: newMoves.map(m => ({ entryId: m.entryId, newDay: m.newDay, newSlot: m.newSlot })),
                    placements: placements
                  });
                }
              }
            } else if (collisions.length === 1 && depth < MAX_DEPTH) {
              const eToMove = collisions[0];
              if (eToMove.isManual || eToMove.slotId === 1 || eToMove.blockId) continue;
              if (movesSoFar.some(m => m.entryId === eToMove.id)) continue;
              if (eToMove.id === parkedEntry.id) continue;

              const nextTimetableState = currentTimetableState.filter(e => e.id !== eToMove.id);
              const clash = checkCollision(entryToPlace.teacherId, entryToPlace.sectionId, day, slot, entryToPlace.room || '', undefined, nextTimetableState, entryToPlace.blockId, entryToPlace.secondaryTeacherId, entryToPlace.isSplitLab);
              
              if (!clash) {
                let nextMoves = movesSoFar;
                let nextPlacements = placements;
                
                if (depth === 0) {
                  nextPlacements = [{ parkedEntryId: entryToPlace.id, day, slot }];
                } else {
                  nextMoves = [...movesSoFar, { entryId: entryToPlace.id, newDay: day, newSlot: slot, subject: entryToPlace.subject, teacherName: entryToPlace.teacherName }];
                }

                dfs(eToMove, nextTimetableState, depth + 1, nextMoves, nextPlacements);
              }
            }
          }
        }
      };

      dfs(parkedEntry, currentTimetable, 0, [], []);
    } else {
      // Try all possible (Day, Slot) for the parked item
      for (const day of DAYS) {
        for (let slot = 1; slot <= 10; slot++) {
          // Check if slot is a break for ANY of the parked entries
          let isBreak = false;
          for (const pEntry of parked.entries) {
            const section = config.sections.find(s => s.id === pEntry.sectionId);
            if (!section) continue;
            const wingSlots = config.slotDefinitions?.[section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS;
            const slotObj = wingSlots.find(s => s.id === slot);
            if (!slotObj || slotObj.isBreak) {
              isBreak = true;
              break;
            }
          }
          if (isBreak) continue;

          // Find collisions at (day, slot)
          const collisions = currentTimetable.filter(e => 
            e.day === day && e.slotId === slot &&
            parked.entries.some(pEntry => 
              e.teacherId === pEntry.teacherId || 
              e.sectionId === pEntry.sectionId || 
              (e.room && pEntry.room && e.room === pEntry.room)
            )
          );

          // We only handle up to 2 collisions for simplicity
          if (collisions.length > 0 && collisions.length <= 2) {
            // Don't move manual entries, anchors, or blocks
            if (collisions.some(e => e.isManual || e.slotId === 1 || e.blockId)) continue;

            // Temporarily remove collisions
            const tempTimetable = currentTimetable.filter(e => !collisions.some(c => c.id === e.id));
            
            // Double check parked entries can be placed here now
            let pClash = false;
            for (const pEntry of parked.entries) {
               if (checkCollision(pEntry.teacherId, pEntry.sectionId, day, slot, pEntry.room || '', undefined, tempTimetable, pEntry.blockId, pEntry.secondaryTeacherId, pEntry.isSplitLab)) {
                 pClash = true;
                 break;
               }
            }
            
            if (!pClash) {
              // Now try to find a new spot for the collisions
              const findSpotForEntry = (eToMove: TimeTableEntry, currentTemp: TimeTableEntry[]): {day: string, slot: number} | null => {
                for (const newDay of DAYS) {
                  for (let newSlot = 1; newSlot <= 10; newSlot++) {
                    if (newDay === day && newSlot === slot) continue;
                    
                    const eSection = config.sections.find(s => s.id === eToMove.sectionId);
                    if (!eSection) continue;
                    const eWingSlots = config.slotDefinitions?.[eSection.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS;
                    const eSlotObj = eWingSlots.find(s => s.id === newSlot);
                    if (!eSlotObj || eSlotObj.isBreak) continue;

                    const eClash = checkCollision(eToMove.teacherId, eToMove.sectionId, newDay, newSlot, eToMove.room || '', undefined, currentTemp);
                    if (!eClash) {
                      return { day: newDay, slot: newSlot };
                    }
                  }
                }
                return null;
              };

              if (collisions.length === 1) {
                const spot = findSpotForEntry(collisions[0], tempTimetable);
                if (spot) {
                  suggestions.push({
                    id: generateUUID(),
                    description: `Move ${collisions[0].subject} (${collisions[0].teacherName}) to ${spot.day} Slot ${spot.slot}, then place ${parked.type === 'BLOCK' ? 'Block' : parked.entries[0].subject} at ${day} Slot ${slot}.`,
                    moves: [{ entryId: collisions[0].id, newDay: spot.day, newSlot: spot.slot }],
                    placements: parked.entries.map(p => ({ parkedEntryId: p.id, day, slot }))
                  });
                }
              } else if (collisions.length === 2) {
                const spot1 = findSpotForEntry(collisions[0], tempTimetable);
                if (spot1) {
                  const tempWith1 = [...tempTimetable, { ...collisions[0], day: spot1.day, slotId: spot1.slot }];
                  const spot2 = findSpotForEntry(collisions[1], tempWith1);
                  if (spot2) {
                    suggestions.push({
                      id: generateUUID(),
                      description: `Move ${collisions[0].subject} to ${spot1.day} S${spot1.slot} & ${collisions[1].subject} to ${spot2.day} S${spot2.slot}, then place ${parked.type === 'BLOCK' ? 'Block' : parked.entries[0].subject} at ${day} Slot ${slot}.`,
                      moves: [
                        { entryId: collisions[0].id, newDay: spot1.day, newSlot: spot1.slot },
                        { entryId: collisions[1].id, newDay: spot2.day, newSlot: spot2.slot }
                      ],
                      placements: parked.entries.map(p => ({ parkedEntryId: p.id, day, slot }))
                    });
                  }
                }
              }
            }
          } else if (collisions.length === 0) {
             // If there are no collisions, we can just place it!
            let pClash = false;
            for (const pEntry of parked.entries) {
               if (checkCollision(pEntry.teacherId, pEntry.sectionId, day, slot, pEntry.room || '', undefined, currentTimetable, pEntry.blockId, pEntry.secondaryTeacherId, pEntry.isSplitLab)) {
                 pClash = true;
                 break;
               }
            }
            if (!pClash) {
               suggestions.push({
                  id: generateUUID(),
                  description: `Place ${parked.type === 'BLOCK' ? 'Block' : parked.entries[0].subject} directly at ${day} Slot ${slot} (No swaps needed).`,
                  moves: [],
                  placements: parked.entries.map(p => ({ parkedEntryId: p.id, day, slot }))
               });
            }
          }
          if (suggestions.length >= 3) break;
        }
        if (suggestions.length >= 3) break;
      }
    }
    
    setSwapSuggestions(suggestions);
  };

  const executeDominoSwap = (suggestion: SwapSuggestion, parked: ParkedItem) => {
    let updatedTimetable = [...currentTimetable];
    
    // 1. Apply moves
    suggestion.moves.forEach(move => {
      const entryIndex = updatedTimetable.findIndex(e => e.id === move.entryId);
      if (entryIndex !== -1) {
        updatedTimetable[entryIndex] = {
          ...updatedTimetable[entryIndex],
          day: move.newDay,
          slotId: move.newSlot
        };
      }
    });
    
    // 2. Apply placements
    suggestion.placements.forEach(placement => {
      const pEntry = parked.entries.find(e => e.id === placement.parkedEntryId);
      if (pEntry) {
        updatedTimetable.push({
          ...pEntry,
          day: placement.day,
          slotId: placement.slot
        });
      }
    });
    
    setCurrentTimetable(updatedTimetable);
    
    // 3. Remove parked item
    setParkedEntries(prev => prev.filter(p => p.id !== parked.id));
    setResolvingParkedItemId(null);
    
    showToast("Domino Swap executed successfully!", "success");
    HapticService.success();
  };

  const handleCopyDay = (sourceDay: string) => {
    if (!isDraftMode || !isManagement) return;
    
    // Find all entries for this day in the current view context
    const entriesToCopy = currentTimetable.filter(e => {
      if (e.day !== sourceDay) return false;
      if (viewMode === 'SECTION' && selectedTargetId && e.sectionId !== selectedTargetId) return false;
      if (viewMode === 'TEACHER' && selectedTargetId && e.teacherId !== selectedTargetId) return false;
      if (viewMode === 'ROOM' && selectedTargetId && e.room !== selectedTargetId) return false;
      return true;
    });

    if (entriesToCopy.length === 0) {
      showToast("No entries to copy for this day.", "info");
      return;
    }

    setClipboard(entriesToCopy);
    showToast(`Copied ${entriesToCopy.length} entries from ${sourceDay}. Select another day header to paste.`, "success");
    HapticService.light();
  };

  const handlePasteDay = (targetDay: string) => {
    if (!isDraftMode || !isManagement || !clipboard || clipboard.length === 0) return;

    triggerConfirm(`Paste ${clipboard.length} entries into ${targetDay}? This will overwrite existing entries in conflicting slots.`, () => {
      // Remove existing entries in target day that conflict
      const newEntries = clipboard.map(e => ({
        ...e,
        id: generateUUID(),
        day: targetDay,
        // Keep other properties
      }));

      const targetSlots = newEntries.map(e => e.slotId);
      
      setCurrentTimetable(prev => {
        // Remove entries in target day that are being overwritten
        const filtered = prev.filter(e => {
          if (e.day !== targetDay) return true;
          if (viewMode === 'SECTION' && selectedTargetId && e.sectionId !== selectedTargetId) return true;
          // For Teacher/Room views, we might not want to overwrite everything, but let's stick to simple logic for now
          if (targetSlots.includes(e.slotId)) return false;
          return true;
        });
        return [...filtered, ...newEntries];
      });
      
      showToast("Schedule pasted successfully.", "success");
      HapticService.success();
    });
  };

  const onDragStart = (e: React.DragEvent, day: string, slotId: number, entryId?: string) => {
    if (!isDraftMode || !isManagement) return;
    // Set data transfer for compatibility
    e.dataTransfer.setData('text/plain', JSON.stringify({ day, slotId, entryId }));
    e.dataTransfer.effectAllowed = 'move';
    setDragSource({ day, slotId, entryId });
    HapticService.light();
  };

  const onDragOver = (e: React.DragEvent, day: string, slotId: number) => {
    e.preventDefault();
    if (!isDraftMode || !isManagement) return;
    if (dragOverTarget?.day !== day || dragOverTarget?.slotId !== slotId) {
      setDragOverTarget({ day, slotId });
    }
  };

  const onDrop = (e: React.DragEvent, targetDay: string, targetSlotId: number) => {
    e.preventDefault();
    setDragOverTarget(null);
    if (!dragSource) return;

    // Same slot check
    if (dragSource.day === targetDay && dragSource.slotId === targetSlotId) {
      setDragSource(null);
      return;
    }

    executeSwap(dragSource, { day: targetDay, slotId: targetSlotId });
    setDragSource(null);
  };

  const getCellColor = (entries: TimeTableEntry[]) => {
    if (entries.length === 0) return '';
    const entry = entries[0];
    
    if (colorMode === 'SUBJECT') {
      // Simple hash for consistent colors
      const colors = ['bg-red-100 text-red-800', 'bg-orange-100 text-orange-800', 'bg-amber-100 text-amber-800', 'bg-yellow-100 text-yellow-800', 'bg-lime-100 text-lime-800', 'bg-green-100 text-green-800', 'bg-emerald-100 text-emerald-800', 'bg-teal-100 text-teal-800', 'bg-cyan-100 text-cyan-800', 'bg-sky-100 text-sky-800', 'bg-blue-100 text-blue-800', 'bg-indigo-100 text-indigo-800', 'bg-violet-100 text-violet-800', 'bg-purple-100 text-purple-800', 'bg-fuchsia-100 text-fuchsia-800', 'bg-pink-100 text-pink-800', 'bg-rose-100 text-rose-800'];
      const hash = entry.subject.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return colors[hash % colors.length];
    }
    
    if (colorMode === 'TEACHER') {
      const colors = ['bg-slate-100', 'bg-gray-100', 'bg-zinc-100', 'bg-neutral-100', 'bg-stone-100', 'bg-red-50', 'bg-orange-50', 'bg-amber-50', 'bg-yellow-50', 'bg-lime-50', 'bg-green-50', 'bg-emerald-50', 'bg-teal-50', 'bg-cyan-50', 'bg-sky-50', 'bg-blue-50', 'bg-indigo-50', 'bg-violet-50', 'bg-purple-50', 'bg-fuchsia-50', 'bg-pink-50', 'bg-rose-50'];
      const hash = entry.teacherId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return colors[hash % colors.length] + ' text-slate-800';
    }

    if (colorMode === 'GRADE') {
       if (entry.gradeId.includes('11') || entry.gradeId.includes('12')) return 'bg-purple-50 text-purple-900';
       if (entry.gradeId.includes('9') || entry.gradeId.includes('10')) return 'bg-blue-50 text-blue-900';
       return 'bg-green-50 text-green-900';
    }

    return ''; // Default
  };

  const handleContextMenu = (e: React.MouseEvent, day: string, slotId: number, entryId?: string) => {
    e.preventDefault();
    if (!isDraftMode || !isManagement) return;
    setContextMenu({ x: e.clientX, y: e.clientY, day, slotId, entryId });
    HapticService.light();
  };

  const handleCellClick = (day: string, slotId: number, entryId?: string) => {
    if (!isDraftMode || !isManagement) return;
    HapticService.light();

    if (isSwapMode || swapSource) {
      if (!swapSource) { if (entryId) setSwapSource({ day, slotId, entryId }); }
      else { executeSwap(swapSource, { day, slotId, entryId }); }
    } else {
      if (!entryId) {
        setAssigningSlot({ day, slotId });
        setAssignmentType('STANDARD');
        setSelAssignSubject('');
        setSelPoolId('');
        setSelLabBlockId('');
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
      triggerConfirm(`This is a Group Period (${entry.blockName}). Deleting it will remove this specific session across all synchronized sections. Proceed?`, () => {
        setCurrentTimetable(prev => prev.filter(e => !(e.blockId === entry.blockId && e.day === entry.day && e.slotId === entry.slotId)));
        setViewingEntryId(null);
        showToast("Group session removed.", "success");
      });
    } else {
      triggerConfirm("Dismantle this instruction brick?", () => {
        setCurrentTimetable(prev => prev.filter(e => e.id !== entryId));
        setViewingEntryId(null);
        showToast("Period removed.", "info");
      });
    }
  };

  const findSafeSlots = (entryId: string) => {
    const sourceEntry = currentTimetable.find(e => e.id === entryId);
    if (!sourceEntry) return;

    const sourceBlockId = sourceEntry.blockId;
    const entriesToMove = sourceBlockId 
      ? currentTimetable.filter(e => e.blockId === sourceBlockId && e.day === sourceEntry.day && e.slotId === sourceEntry.slotId)
      : [sourceEntry];

    const safe: {day: string, slotId: number}[] = [];
    const tempTimetable = currentTimetable.filter(ce => !entriesToMove.some(em => em.id === ce.id));

    DAYS.forEach(day => {
      slots.forEach(slot => {
        if (slot.isBreak) return;
        if (day === sourceEntry.day && slot.id === sourceEntry.slotId) return;

        let hasClash = false;
        for (const e of entriesToMove) {
          const clash = checkCollision(e.teacherId, e.sectionId, day, slot.id, e.room || '', undefined, tempTimetable, e.blockId, e.secondaryTeacherId, e.isSplitLab);
          if (clash) {
            hasClash = true;
            break;
          }
        }
        if (!hasClash) {
          safe.push({day, slotId: slot.id});
        }
      });
    });

    setSafeSlots(safe);
    HapticService.light();
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
    setSelLabBlockId('');
    setSelAssignSubject('');
    setSelAssignRoom('');
    HapticService.light();
  };

  const executeSwap = async (source: { day?: string, slotId?: number, entryId?: string, isFromParkingLot?: boolean, parkedItemId?: string }, target: { day: string, slotId: number, entryId?: string }) => {
    if (source.isFromParkingLot && source.parkedItemId) {
      const parkedItem = parkedEntries.find(p => p.id === source.parkedItemId);
      if (!parkedItem) {
        setSwapSource(null);
        return;
      }

      let targetEntries = currentTimetable.filter(e => e.day === target.day && e.slotId === target.slotId);
      const sectionsInvolved = parkedItem.entries.map(e => e.sectionId);
      targetEntries = targetEntries.filter(e => sectionsInvolved.includes(e.sectionId));

      if (targetEntries.some(e => lockedSectionIds.includes(e.sectionId))) {
        showToast("Cannot place here because one or more target sections are locked.", "error");
        return;
      }
      
      if (sectionsInvolved.some(secId => lockedSectionIds.includes(secId))) {
        showToast("Cannot place here because one or more involved sections are locked.", "error");
        return;
      }

      let targetEntryIds: string[] = [];
      const newParkedItems: ParkedItem[] = [];

      if (targetEntries.length > 0) {
        const processedIds = new Set<string>();
        
        targetEntries.forEach(te => {
          if (processedIds.has(te.id)) return;
          if (te.blockId) {
            const blockEntries = currentTimetable.filter(e => e.day === target.day && e.slotId === target.slotId && e.blockId === te.blockId);
            newParkedItems.push({
              id: generateUUID(),
              entries: blockEntries,
              type: 'BLOCK',
              blockId: te.blockId,
              reason: 'Manually swapped out to make room for another item.'
            });
            blockEntries.forEach(be => processedIds.add(be.id));
          } else {
            newParkedItems.push({
              id: generateUUID(),
              entries: [te],
              type: 'SINGLE',
              reason: 'Manually swapped out to make room for another item.'
            });
            processedIds.add(te.id);
          }
        });
        
        targetEntryIds = Array.from(processedIds);
      }

      // Collision Check
      const timetableForCheck = currentTimetable.filter(e => !targetEntryIds.includes(e.id));
      
      for (const entry of parkedItem.entries) {
         const collision = checkCollision(
            entry.teacherId, 
            entry.sectionId, 
            target.day, 
            target.slotId, 
            entry.room || '', 
            entry.id, 
            timetableForCheck, 
            entry.blockId,
            entry.secondaryTeacherId,
            entry.isSplitLab
         );
         
         if (collision) {
            showToast(`Collision detected: ${collision}`, "error");
            setSwapSource(null);
            return;
         }
      }

      if (targetEntries.length > 0) {
        setParkedEntries(prev => [...prev.filter(p => p.id !== parkedItem.id), ...newParkedItems]);
      } else {
        setParkedEntries(prev => prev.filter(p => p.id !== parkedItem.id));
      }

      const newEntries = parkedItem.entries.map(e => ({ ...e, day: target.day, slotId: target.slotId }));
      setCurrentTimetable(prev => [
        ...prev.filter(e => !targetEntryIds.includes(e.id)),
        ...newEntries
      ]);

      setSwapSource(null);
      HapticService.light();
      showToast("Placed from Parking Lot", "success");
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'DRAG_DROP',
        subject: parkedItem.entries[0].subject,
        teacherName: parkedItem.entries[0].teacherName,
        status: 'SUCCESS',
        details: `Manually placed from parking lot to ${target.day} Period ${target.slotId}.`,
        assignedCount: 1,
        totalCount: 1
      }, ...prev]);
      return;
    }

    if (!source.entryId || !source.day || !source.slotId) return;

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
      if (collision) { 
        setAiResolutionModal({
          conflict: collision,
          source: se,
          target: { day: target.day, slotId: target.slotId }
        });
        setSwapSource(null); 
        return; 
      }
    }

    // 4. Collision Check for Target -> Source
    // We must check if target entries can fit into source slot, assuming source entries are GONE
    const timetableWithoutSource = currentTimetable.filter(e => !sourceIds.includes(e.id));
    for (const te of targetEntriesToMove) {
      const collision = checkCollision(te.teacherId, te.sectionId, source.day, source.slotId, te.room || '', te.id, timetableWithoutSource, te.blockId);
      if (collision) { 
        setAiResolutionModal({
          conflict: collision,
          source: te,
          target: { day: source.day, slotId: source.slotId }
        });
        setSwapSource(null); 
        return; 
      }
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

  const handleAutoFill = () => {
    if (!isDraftMode || !isManagement) return;
    
    triggerConfirm("Run Auto-Fill Optimizer? This will attempt to schedule all remaining unassigned loads into available slots. This process cannot be undone.", () => {
      setIsProcessing(true);
      
      // Basic Auto-Fill Logic (Greedy Approach)
      // 1. Calculate remaining loads for all teachers
      // 2. Iterate through empty slots and try to place them
      
      setTimeout(() => {
        let newEntries: TimeTableEntry[] = [];
        let baseTimetable = [...currentTimetable];
        let placedCount = 0;
        
        // Calculate remaining loads
        const remainingLoads: { teacherId: string, subject: string, sectionId: string, count: number }[] = [];
        
        assignments.forEach(assignment => {
          assignment.loads.forEach(load => {
            if (!load.sectionId) return; // Only standard loads
            
            const currentCount = baseTimetable.filter(e => 
              e.teacherId === assignment.teacherId && 
              e.sectionId === load.sectionId && 
              e.subject === load.subject &&
              !e.blockId
            ).length;
            
            if (currentCount < load.periods) {
              remainingLoads.push({
                teacherId: assignment.teacherId,
                subject: load.subject,
                sectionId: load.sectionId,
                count: load.periods - currentCount
              });
            }
          });
        });
        
        // Sort by most constrained (teachers with most remaining loads)
        remainingLoads.sort((a, b) => b.count - a.count);
        
        // Try to place them
        for (const load of remainingLoads) {
          let placedForThisLoad = 0;
          
          for (const day of DAYS) {
            if (placedForThisLoad >= load.count) break;
            
            for (const slot of slots) {
              if (slot.isBreak) continue;
              if (placedForThisLoad >= load.count) break;
              
              // Check if slot is empty for this section
              const isSectionOccupied = baseTimetable.some(e => e.day === day && e.slotId === slot.id && e.sectionId === load.sectionId);
              if (isSectionOccupied) continue;
              
              // Check collision
              const clash = checkCollision(load.teacherId, load.sectionId, day, slot.id, load.sectionId, undefined, baseTimetable);
              
              if (!clash) {
                const sectionObj = config.sections.find(s => s.id === load.sectionId);
                const teacherObj = users.find(u => u.id === load.teacherId);
                
                const newEntry: TimeTableEntry = {
                  id: generateUUID(),
                  section: sectionObj?.wingId === config.wings[0]?.id ? 'PRIMARY' : 'SECONDARY_BOYS',
                  wingId: sectionObj?.wingId || '',
                  gradeId: sectionObj?.gradeId || '',
                  sectionId: load.sectionId,
                  className: sectionObj?.fullName || '',
                  teacherId: load.teacherId,
                  teacherName: teacherObj?.name || '',
                  subject: load.subject,
                  subjectCategory: SubjectCategory.CORE,
                  day,
                  slotId: slot.id,
                  room: load.sectionId, // Default to section room
                  isManual: false
                };
                
                baseTimetable.push(newEntry);
                newEntries.push(newEntry);
                placedForThisLoad++;
                placedCount++;
              }
            }
          }
        }
        
        if (placedCount > 0) {
          setCurrentTimetable(baseTimetable);
          showToast(`Auto-Fill complete: ${placedCount} periods scheduled.`, "success");
          HapticService.success();
        } else {
          showToast("Auto-Fill could not find any valid slots for remaining loads.", "warning");
        }
        
        setIsProcessing(false);
      }, 500); // Simulate processing time
    });
  };

  const handleSaveVersion = () => {
    const name = prompt("Enter a name for this version (e.g., 'Pre-Labs', 'Final V1'):");
    if (!name) return;
    
    const newVersion: TimetableVersion = {
      id: generateUUID(),
      name,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      entries: [...timetableDraft],
      isShared: false
    };
    
    setVersions(prev => [newVersion, ...prev]);
    showToast(`Version '${name}' saved successfully.`, "success");
    HapticService.success();
  };

  const handleRestoreVersion = (version: TimetableVersion) => {
    triggerConfirm(`Restore version '${version.name}'? This will overwrite your current draft.`, () => {
      setTimetableDraft([...version.entries]);
      setHistory([[...version.entries]]);
      setHistoryIndex(0);
      setIsVersionsModalOpen(false);
      showToast(`Restored version '${version.name}'.`, "success");
      HapticService.success();
    });
  };

  const handleShareVersion = (versionId: string) => {
    setVersions(prev => prev.map(v => v.id === versionId ? { ...v, isShared: !v.isShared } : v));
    const v = versions.find(v => v.id === versionId);
    showToast(`Version '${v?.name}' is now ${!v?.isShared ? 'Shared (Read-Only)' : 'Private'}.`, "info");
    HapticService.light();
  };

  const handleDeleteVersion = (versionId: string) => {
    triggerConfirm("Delete this version permanently?", () => {
      setVersions(prev => prev.filter(v => v.id !== versionId));
      showToast("Version deleted.", "info");
      HapticService.light();
    });
  };

  const handleSaveDraft = async () => {
    setIsProcessing(true);
    let cloudSuccess = false;
    let errorMsg = '';

    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        // 1. Attempt Cloud Save
        const { error: delError } = await supabase.from('timetable_drafts').delete().neq('id', 'SYSTEM_LOCK');
        if (delError) throw delError;
        
        if (timetableDraft.length > 0) {
          const mappedDraft = timetableDraft.map(e => ({
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
            block_name: e.blockName,
            is_double: e.isDouble,
            is_split_lab: e.isSplitLab,
            secondary_teacher_id: e.secondaryTeacherId,
            secondary_teacher_name: e.secondaryTeacherName
          }));
          
          const chunkSize = 500;
          for (let i = 0; i < mappedDraft.length; i += chunkSize) {
            const chunk = mappedDraft.slice(i, i + chunkSize);
            const { error: insError } = await supabase.from('timetable_drafts').insert(chunk);
            if (insError) throw insError;
          }
        }
        cloudSuccess = true;
      }
    } catch (e: any) {
      console.error("Cloud Save Failed:", e);
      errorMsg = e.message || "Unknown Database Error";
    }

    // 2. Local Storage Fallback (Always run if cloud failed or disabled)
    if (!cloudSuccess && !isSandbox) {
      try {
        localStorage.setItem('ihis_timetable_draft', JSON.stringify(timetableDraft));
        console.log("Draft saved to LocalStorage (Fallback)");
      } catch (e) {
        console.error("LocalStorage Save Failed:", e);
        alert("CRITICAL: Could not save to Cloud OR Local Storage. Check device memory.");
        setIsProcessing(false);
        return;
      }
    }

    setIsProcessing(false);

    if (cloudSuccess) {
      showToast("Draft Matrix saved successfully to Cloud.", "success");
    } else if (IS_CLOUD_ENABLED && !isSandbox) {
      showToast(`Cloud Save Failed (${errorMsg}). Saved locally instead.`, "warning");
      // If schema error, alert user to run migration
      if (errorMsg.includes("Could not find") || errorMsg.includes("column")) {
        alert(`Database Schema Mismatch: ${errorMsg}\n\nPlease go to 'Deployment' tab and run the Migration Script V9.5 to fix missing columns.`);
      }
    } else {
      showToast("Draft Matrix saved successfully (Local Only).", "success");
    }
  };

  const handlePublishToLive = async () => {
    if (!confirm("Deploy Matrix to Production?")) return;
    setIsProcessing(true);
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        const { error: delError } = await supabase.from('timetable_entries').delete().neq('id', 'SYSTEM_LOCK');
        if (delError) throw delError;
        
        if (timetableDraft.length > 0) {
          const mappedDraft = timetableDraft.map(e => ({
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
            block_name: e.blockName,
            is_double: e.isDouble,
            is_split_lab: e.isSplitLab,
            secondary_teacher_id: e.secondaryTeacherId,
            secondary_teacher_name: e.secondaryTeacherName
          }));
          
          const chunkSize = 500;
          for (let i = 0; i < mappedDraft.length; i += chunkSize) {
            const chunk = mappedDraft.slice(i, i + chunkSize);
            const { error: insError } = await supabase.from('timetable_entries').insert(chunk);
            if (insError) throw insError;
          }
        }
        // Also clear draft from cloud after publishing
        const { error: delDraftError } = await supabase.from('timetable_drafts').delete().neq('id', 'SYSTEM_LOCK');
        if (delDraftError) throw delDraftError;
      } else if (!isSandbox) {
        localStorage.setItem('ihis_timetable', JSON.stringify(timetableDraft));
        localStorage.removeItem('ihis_timetable_draft');
      }
      setTimetable([...timetableDraft]);
      setIsDraftMode(false);
      showToast("Matrix successfully deployed to Production Registry.", "success");
    } catch (e: any) { alert(e.message); } finally { setIsProcessing(false); }
  };

  const handleAiArchitectSubmit = async () => {
    if (!aiInput.trim()) return;
    
    const userMsg = { role: 'user' as const, content: aiInput };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setIsAiProcessing(true);

    try {
      const context = {
        timetableSummary: `Current timetable has ${currentTimetable.length} entries.`,
        draftMode: isDraftMode,
        viewMode: viewMode,
        selectedTarget: selectedTargetId,
        parkedEntries: parkedEntries.length
      };

      const prompt = `
        You are the AI Architect for the school timetable.
        Context: ${JSON.stringify(context)}
        User Request: ${userMsg.content}
        
        Analyze the request and provide a helpful response. If the user asks for changes, suggest a plan.
        Keep responses concise and actionable.
      `;

      const response = await MatrixService.architectRequest(prompt);
      setAiMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
      setIsGatingError(false);
    } catch (error: any) {
      if (error.message?.includes('GATING_ERROR')) {
        setIsGatingError(true);
      }
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleAiResolve = async () => {
    if (!aiResolutionModal) return;
    setIsAiProcessing(true);
    
    try {
      const { conflict, source, target } = aiResolutionModal;
      
      // Filter relevant timetable entries to avoid token limits
      const relevantEntries = currentTimetable.filter(e => 
        e.day === target.day || e.day === source.day || 
        e.teacherId === source.teacherId || e.sectionId === source.sectionId
      );

      const prompt = `
        I am trying to move an entry but there is a conflict.
        Source Entry: ${JSON.stringify(source)}
        Target Slot: ${JSON.stringify(target)}
        Conflict Reason: ${JSON.stringify(conflict)}
        
        Relevant Timetable Entries:
        ${JSON.stringify(relevantEntries)}
        
        Please analyze this situation and propose a series of moves (swaps) to resolve this conflict and allow the move.
        The goal is to place the Source Entry into the Target Slot by moving conflicting items elsewhere.
        
        Return ONLY a JSON object with the following structure:
        {
          "planDescription": "Short description of the plan",
          "steps": [
            { "action": "MOVE", "entryId": "ID_OF_ENTRY", "toDay": "DAY", "toSlot": SLOT_NUMBER, "description": "Move Math to Monday P1" },
            ...
          ]
        }
      `;
      
      const response = await MatrixService.architectRequest(prompt, [], { responseMimeType: "application/json" });
      const plan = JSON.parse(response.text);
      setAiResolutionPlan(plan);
      setIsGatingError(false);
    } catch (error: any) {
      if (error.message?.includes('GATING_ERROR')) {
        setIsGatingError(true);
        setIsAiArchitectOpen(true);
      }
      showToast(`AI Resolution Failed: ${error.message}`, 'error');
    } finally {
      setIsAiProcessing(false);
    }
  };

  const applyAiPlan = () => {
    if (!aiResolutionPlan || !aiResolutionModal) return;
    
    let newTimetable = [...currentTimetable];
    const logs: AssignmentLogEntry[] = [];
    
    // 1. Apply AI-suggested moves to clear conflicts
    aiResolutionPlan.steps.forEach((step: any) => {
      if (step.action === 'MOVE') {
        const entryIndex = newTimetable.findIndex(e => e.id === step.entryId);
        if (entryIndex !== -1) {
          const oldEntry = newTimetable[entryIndex];
          newTimetable[entryIndex] = {
            ...oldEntry,
            day: step.toDay,
            slotId: step.toSlot
          };
          
          logs.push({
            id: generateUUID(),
            timestamp: new Date().toLocaleTimeString(),
            actionType: 'AI_RESOLVE',
            subject: oldEntry.subject,
            teacherName: oldEntry.teacherName,
            status: 'SUCCESS',
            details: step.description || `AI Move: ${oldEntry.subject} to ${step.toDay} P${step.toSlot}`
          });
        }
      }
    });

    // 2. Perform the original assignment/move that was blocked
    const { source, target } = aiResolutionModal;
    
    if (source.id && source.id !== "GAP_CLOSER_VIRTUAL_ID") {
      // It's an existing entry being moved
      const sourceIdx = newTimetable.findIndex(e => e.id === source.id);
      if (sourceIdx !== -1) {
        const oldEntry = newTimetable[sourceIdx];
        newTimetable[sourceIdx] = {
          ...oldEntry,
          day: target.day,
          slotId: target.slotId
        };
        
        logs.push({
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AI_RESOLVE',
          subject: oldEntry.subject,
          teacherName: oldEntry.teacherName,
          status: 'SUCCESS',
          details: `Original move completed: ${oldEntry.subject} placed in ${target.day} P${target.slotId}`
        });
      }
    } else {
      // It's a new assignment (or virtual gap closer)
      const teacher = users.find(u => u.id === source.teacherId);
      const section = config.sections.find(s => s.id === source.sectionId);
      
      if (teacher && section) {
        newTimetable.push({
          id: generateUUID(),
          section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
          wingId: section.wingId,
          gradeId: section.gradeId,
          sectionId: section.id,
          className: section.fullName,
          day: target.day,
          slotId: target.slotId,
          subject: source.subject,
          subjectCategory: source.subjectCategory || SubjectCategory.CORE,
          teacherId: source.teacherId,
          teacherName: teacher.name,
          room: source.room || `ROOM ${section.fullName}`,
          isManual: true
        });

        logs.push({
          id: generateUUID(),
          timestamp: new Date().toLocaleTimeString(),
          actionType: 'AI_RESOLVE',
          subject: source.subject,
          teacherName: teacher.name,
          status: 'SUCCESS',
          details: `Original assignment completed: ${source.subject} placed in ${target.day} P${target.slotId}`
        });
      }
    }
    
    if (isDraftMode) {
      setTimetableDraft(newTimetable);
    } else {
      setTimetable(newTimetable);
    }
    
    setAssignmentLogs(prev => [...logs, ...prev]);
    setAiResolutionModal(null);
    setAiResolutionPlan(null);
    showToast("AI Plan Applied Successfully", "success");
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
      let entriesToMove: TimeTableEntry[] = [];
      if (swapSource.isFromParkingLot && swapSource.parkedItemId) {
        const parkedItem = parkedEntries.find(p => p.id === swapSource.parkedItemId);
        if (parkedItem) entriesToMove = parkedItem.entries;
      } else if (swapSource.entryId) {
        const sourceEntry = currentTimetable.find(e => e.id === swapSource.entryId);
        if (sourceEntry) {
          const sourceBlockId = sourceEntry.blockId;
          entriesToMove = sourceBlockId 
            ? currentTimetable.filter(e => e.blockId === sourceBlockId && e.day === sourceEntry.day && e.slotId === sourceEntry.slotId)
            : [sourceEntry];
        }
      }

      if (entriesToMove.length > 0) {
        const tempTimetable = currentTimetable.filter(ce => !entriesToMove.some(em => em.id === ce.id));
        DAYS.forEach(day => {
          slots.forEach(slot => {
            if (slot.isBreak) return;
            if (!swapSource.isFromParkingLot && day === swapSource.day && slot.id === swapSource.slotId) return;

            let hasClash = false;
            let clashMsg = '';
            for (const e of entriesToMove) {
              const clash = checkCollision(e.teacherId, e.sectionId, day, slot.id, e.room || '', undefined, tempTimetable, e.blockId, e.secondaryTeacherId, e.isSplitLab);
              if (clash) {
                hasClash = true;
                clashMsg = clash;
                break;
              }
            }
            if (hasClash) {
              map[`${day}-${slot.id}`] = clashMsg;
            }
          });
        });
      }
    }
    return map;
  }, [isDraftMode, isManagement, assigningSlot, selAssignTeacherId, selAssignSectionId, selectedTargetId, viewMode, slots, selAssignRoom, isSwapMode, swapSource, currentTimetable, checkCollision]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      {isManagement && assignmentLogs.length > 0 && (
        <AssignmentLog assignmentLogs={assignmentLogs} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          day={contextMenu.day}
          slotId={contextMenu.slotId}
          entryId={contextMenu.entryId}
          onClose={() => setContextMenu(null)}
          onCopy={() => {
            const entry = currentTimetable.find(e => e.id === contextMenu.entryId);
            if (entry) {
              setClipboard([entry]);
              showToast("Period copied to clipboard.", "success");
            }
            setContextMenu(null);
          }}
          onDelete={() => {
            handleDeleteEntry(contextMenu.entryId!);
            setContextMenu(null);
          }}
          onPaste={() => {
            const newEntry = { ...clipboard[0], id: generateUUID(), day: contextMenu.day, slotId: contextMenu.slotId };
            setCurrentTimetable(prev => [...prev, newEntry]);
            setContextMenu(null);
            showToast("Period pasted.", "success");
          }}
          onNote={() => {
            setNoteModal({ day: contextMenu.day, slotId: contextMenu.slotId, targetId: selectedTargetId, viewMode });
            setContextMenu(null);
          }}
          onToggleLock={() => {
            toggleSectionLock(selectedTargetId);
            setContextMenu(null);
          }}
          isLocked={lockedSectionIds.includes(selectedTargetId)}
          canPaste={!!(clipboard && clipboard.length === 1)}
          viewMode={viewMode}
        />
      )}

      <FloatingActionBar
        swapSource={swapSource}
        onPark={handleParkSource}
        onCancel={() => setSwapSource(null)}
      />

      <ParkingLotPanel
        isOpen={isParkingLotOpen}
        setIsOpen={setIsParkingLotOpen}
        parkedEntries={parkedEntries}
        setParkedEntries={setParkedEntries}
        swapSource={swapSource}
        setSwapSource={setSwapSource}
        resolvingParkedItemId={resolvingParkedItemId}
        swapSuggestions={swapSuggestions}
        handleFindSwaps={handleFindSwaps}
        executeDominoSwap={executeDominoSwap}
        config={config}
      />

      <TimetableToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        selectedTargetId={selectedTargetId}
        setSelectedTargetId={setSelectedTargetId}
        activeWingId={activeWingId}
        setActiveWingId={setActiveWingId}
        accessibleWings={accessibleWings}
        config={config}
        users={users}
        isDraftMode={isDraftMode}
        setIsDraftMode={setIsDraftMode}
        isManagement={isManagement}
        isProcessing={isProcessing}
        isAutoSaving={isAutoSaving}
        isPurgeMode={isPurgeMode}
        setIsPurgeMode={setIsPurgeMode}
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        colorMode={colorMode}
        setColorMode={setColorMode}
        isSwapMode={isSwapMode}
        setIsSwapMode={setIsSwapMode}
        swapSource={swapSource}
        setSwapSource={setSwapSource}
        isParkingLotOpen={isParkingLotOpen}
        setIsParkingLotOpen={setIsParkingLotOpen}
        setIsVersionsModalOpen={setIsVersionsModalOpen}
        setIsAiArchitectOpen={setIsAiArchitectOpen}
        handleAiConductor={handleAiConductor}
        handleDeployDraft={handlePublishToLive}
        handlePurgeDraft={handlePurgeDraft}
        isPurgeMenuOpen={isPurgeMenuOpen}
        setIsPurgeMenuOpen={setIsPurgeMenuOpen}
        setIsAuditDrawerOpen={setIsAuditDrawerOpen}
        onManualEntry={handleManualEntry}
      />

      <div className={`bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[3rem] p-4 md:p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 transition-all duration-300 ${isParkingLotOpen ? 'mr-80' : ''}`}>
        <div className="flex flex-col xl:flex-row items-center gap-6">
           <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 w-full xl:w-auto">
             {(['SECTION', 'TEACHER', 'ROOM'] as const).map(mode => (
               <button key={mode} onClick={() => setViewMode(mode)} className={`flex-1 xl:flex-none px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === mode ? 'bg-white dark:bg-slate-900 text-[#001f3f] dark:text-white shadow-sm' : 'text-slate-400'}`}>{mode}</button>
             ))}
           </div>

           {/* View Options */}
           <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
              <button 
                onClick={() => setCompactMode(!compactMode)}
                className={`p-2.5 rounded-xl transition-all ${compactMode ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                title={compactMode ? "Expand View" : "Compact View"}
              >
                {compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
              {(['DEFAULT', 'SUBJECT', 'TEACHER', 'GRADE'] as const).map(mode => (
                <button 
                  key={mode} 
                  onClick={() => setColorMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${colorMode === mode ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {mode}
                </button>
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

              {viewMode === 'SECTION' && selectedTargetId && isDraftMode && (
                <button
                  onClick={() => toggleSectionLock(selectedTargetId)}
                  className={`p-3 rounded-2xl border transition-all flex items-center gap-2 ${
                    lockedSectionIds.includes(selectedTargetId)
                      ? 'bg-rose-50 border-rose-200 text-rose-600'
                      : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
                  }`}
                  title={lockedSectionIds.includes(selectedTargetId) ? "Unlock Section" : "Lock Section"}
                >
                  {lockedSectionIds.includes(selectedTargetId) ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span className="text-[9px] font-black uppercase">Locked</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4" />
                      <span className="text-[9px] font-black uppercase">Unlocked</span>
                    </>
                  )}
                </button>
              )}

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

      <TimetableConductor
        isDraftMode={isDraftMode}
        isManagement={isManagement}
        isPurgeMode={isPurgeMode}
        setIsPurgeMode={setIsPurgeMode}
        handleGeneratePools={handleGeneratePools}
        handleGenerateAnchors={() => handleGenerateAnchors(currentTimetable)}
        handleGenerateCurriculars={handleGenerateCurriculars}
        handleGenerateLoads={handleGenerateLoads}
        handleGenerateLabs={handleGenerateLabs}
        isAiProcessing={isAiProcessing}
        handleGapCloser={() => handleGapCloser(currentTimetable)}
      />

      <TimetableGrid
        compactMode={compactMode}
        displayedSlots={displayedSlots}
        activeData={activeData}
        selectedTargetId={selectedTargetId}
        viewMode={viewMode}
        isDraftMode={isDraftMode}
        isManagement={isManagement}
        isSwapMode={isSwapMode}
        swapSource={swapSource}
        clashMap={clashMap}
        cellNotes={cellNotes}
        isCellLocked={isCellLocked}
        handleCellClick={handleCellClick}
        handleContextMenu={handleContextMenu}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        config={config}
        dragOverTarget={dragOverTarget}
        getCellColor={getCellColor}
      />

      <TimetableMobileView
        selectedDayMobile={selectedDayMobile}
        setSelectedDayMobile={setSelectedDayMobile}
        displayedSlots={displayedSlots}
        activeData={activeData}
        viewMode={viewMode}
        selectedTargetId={selectedTargetId}
        config={config}
        isDraftMode={isDraftMode}
        isManagement={isManagement}
        swapSource={swapSource}
        clashMap={clashMap}
        isCellLocked={isCellLocked}
        isSwapMode={isSwapMode}
        cellNotes={cellNotes}
        handleCellClick={handleCellClick}
        handleContextMenu={handleContextMenu}
      />
      </div>

      <EntryDetailsModal
        viewingEntryId={viewingEntryId}
        setViewingEntryId={setViewingEntryId}
        currentTimetable={currentTimetable}
        config={config}
        users={users}
        isDraftMode={isDraftMode}
        isManagement={isManagement}
        lockedSectionIds={lockedSectionIds}
        setLockedSectionIds={setLockedSectionIds}
        handleDeleteEntry={handleDeleteEntry}
        handleReplaceEntry={handleReplaceEntry}
        findSafeSlots={findSafeSlots}
        setNoteModal={setNoteModal}
        viewMode={viewMode}
      />

      <TimetableVersions
        isOpen={isVersionsModalOpen}
        onClose={() => setIsVersionsModalOpen(false)}
        versions={versions}
        timetableDraft={timetableDraft}
        handleSaveVersion={handleSaveVersion}
        handleShareVersion={handleShareVersion}
        handleRestoreVersion={handleRestoreVersion}
        handleDeleteVersion={handleDeleteVersion}
      />

      <NoteModal
        noteModal={noteModal}
        setNoteModal={setNoteModal}
        cellNotes={cellNotes}
        setCellNotes={setCellNotes}
      />

      <AssignmentModal
        assigningSlot={assigningSlot}
        setAssigningSlot={setAssigningSlot}
        assignmentType={assignmentType}
        setAssignmentType={setAssignmentType}
        selAssignDay={selAssignDay}
        setSelAssignDay={setSelAssignDay}
        selAssignSlotId={selAssignSlotId}
        setSelAssignSlotId={setSelAssignSlotId}
        selAssignSectionId={selAssignSectionId}
        setSelAssignSectionId={setSelAssignSectionId}
        selAssignTeacherId={selAssignTeacherId}
        setSelAssignTeacherId={setSelAssignTeacherId}
        selAssignSubject={selAssignSubject}
        setSelAssignSubject={setSelAssignSubject}
        selAssignRoom={selAssignRoom}
        setSelAssignRoom={setSelAssignRoom}
        selLabBlockId={selLabBlockId}
        setSelLabBlockId={setSelLabBlockId}
        selLabTechnicianId={selLabTechnicianId}
        setSelLabTechnicianId={setSelLabTechnicianId}
        selLabSection2Id={selLabSection2Id}
        setSelLabSection2Id={setSelLabSection2Id}
        selLab2TeacherId={selLab2TeacherId}
        setSelLab2TeacherId={setSelLab2TeacherId}
        selLab2TechnicianId={selLab2TechnicianId}
        setSelLab2TechnicianId={setSelLab2TechnicianId}
        selLab2Subject={selLab2Subject}
        setSelLab2Subject={setSelLab2Subject}
        selLab2Room={selLab2Room}
        setSelLab2Room={setSelLab2Room}
        selLab3TeacherId={selLab3TeacherId}
        setSelLab3TeacherId={setSelLab3TeacherId}
        selLab3TechnicianId={selLab3TechnicianId}
        setSelLab3TechnicianId={setSelLab3TechnicianId}
        selLab3Subject={selLab3Subject}
        setSelLab3Subject={setSelLab3Subject}
        selLab3Room={selLab3Room}
        setSelLab3Room={setSelLab3Room}
        selPoolId={selPoolId}
        setSelPoolId={setSelPoolId}
        selActivityId={selActivityId}
        setSelActivityId={setSelActivityId}
        currentClash={currentClash}
        setAiResolutionModal={setAiResolutionModal}
        handleMagicFill={handleMagicFill}
        handleQuickAssign={handleQuickAssign}
        isQuickAssignValid={isQuickAssignValid}
        config={config}
        users={users}
        currentTimetable={currentTimetable}
        slots={slots}
        viewMode={viewMode}
        selectedTargetId={selectedTargetId || ''}
      />
      <TimetableAuditDrawer
        isAuditDrawerOpen={isAuditDrawerOpen}
        setIsAuditDrawerOpen={setIsAuditDrawerOpen}
        sectionAuditData={sectionAuditData}
        getGlobalTeacherLoad={getGlobalTeacherLoad}
        setCurrentTimetable={setCurrentTimetable}
        showToast={showToast}
      />
      {/* AI Architect Sidebar */}
      {/* AI Architect Sidebar */}
      <AiArchitectChat
        isOpen={isAiArchitectOpen}
        setIsOpen={setIsAiArchitectOpen}
        isDraftMode={isDraftMode}
        isAiProcessing={isAiProcessing}
        handleAiConductor={handleAiConductor}
        isGatingError={isGatingError}
        setIsGatingError={setIsGatingError}
        showToast={showToast}
        aiMessages={aiMessages}
        aiInput={aiInput}
        setAiInput={setAiInput}
        handleAiArchitectSubmit={handleAiArchitectSubmit}
      />

      <AiResolutionModal
        aiResolutionModal={aiResolutionModal}
        setAiResolutionModal={setAiResolutionModal}
        isAiProcessing={isAiProcessing}
        handleAiResolve={handleAiResolve}
        config={config}
        users={users}
      />

      <AiResolutionPlanModal
        aiResolutionPlan={aiResolutionPlan}
        setAiResolutionPlan={setAiResolutionPlan}
        applyAiPlan={applyAiPlan}
      />
    </div>
  );
};

export default TimeTableView;

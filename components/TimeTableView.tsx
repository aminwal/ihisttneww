
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, ExtraCurricularRule, LabBlock, LabAllocation, TimetableVersion, AssignmentLogEntry } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { HapticService } from '../services/hapticService.ts';

import { Plus, Trash2, ChevronDown, RefreshCw, Lock, Unlock, Archive, X, Undo2, Redo2, Wand2, Share2, History, Copy, ClipboardCopy, ClipboardPaste, Maximize2, Minimize2, Palette, Lightbulb, MoreHorizontal, ArrowRight, GripHorizontal, Check, Activity, CheckCircle2, AlertCircle, Clock, Info, Sparkles } from 'lucide-react';

interface ParkedItem {
  id: string;
  entries: TimeTableEntry[];
  type: 'SINGLE' | 'BLOCK';
  blockId?: string;
}

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
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSavedDraft, setLastSavedDraft] = useState<string>('');

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
        setIsAutoSaving(false); 
      }
    }, 15000); // Auto-save after 15 seconds of inactivity

    return () => clearTimeout(autoSaveTimer);
  }, [timetableDraft, isDraftMode, isManagement, isSandbox, lastSavedDraft]);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [isVersionsModalOpen, setIsVersionsModalOpen] = useState(false);
  const [assignmentLogs, setAssignmentLogs] = useState<AssignmentLogEntry[]>([]);
  const [versions, setVersions] = useState<TimetableVersion[]>(() => {
    try {
      const saved = localStorage.getItem('ihis_timetable_versions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('ihis_timetable_versions', JSON.stringify(versions));
  }, [versions]);
  const [swapSource, setSwapSource] = useState<{ 
    day?: string, 
    slotId?: number, 
    entryId?: string,
    isFromParkingLot?: boolean,
    parkedItemId?: string
  } | null>(null);
  const [isParkingLotOpen, setIsParkingLotOpen] = useState(false);
  const [parkedEntries, setParkedEntries] = useState<ParkedItem[]>(() => {
    try {
      const saved = localStorage.getItem('ihis_parked_entries');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  interface SwapSuggestion {
    id: string;
    description: string;
    moves: {
      entryId: string;
      newDay: string;
      newSlot: number;
    }[];
    placements: {
      parkedEntryId: string;
      day: string;
      slot: number;
    }[];
  }

  const [resolvingParkedItemId, setResolvingParkedItemId] = useState<string | null>(null);
  const [swapSuggestions, setSwapSuggestions] = useState<SwapSuggestion[]>([]);

  useEffect(() => {
    localStorage.setItem('ihis_parked_entries', JSON.stringify(parkedEntries));
  }, [parkedEntries]);
  const [selectedDayMobile, setSelectedDayMobile] = useState<string>(() => {
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date());
    return DAYS.includes(today) ? today : 'Sunday';
  });

  const [assigningSlot, setAssigningSlot] = useState<{ day: string, slotId: number, sectionId?: string } | null>(null);
  const [viewingEntryId, setViewingEntryId] = useState<string | null>(null);
  const [safeSlots, setSafeSlots] = useState<{day: string, slotId: number}[] | null>(null);
  const [noteModal, setNoteModal] = useState<{day: string, slotId: number, targetId: string, viewMode: string} | null>(null);
  const [cellNotes, setCellNotes] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('ihis_cell_notes');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('ihis_cell_notes', JSON.stringify(cellNotes));
  }, [cellNotes]);

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
  const [lockedSectionIds, setLockedSectionIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('ihis_locked_sections');
    return saved ? JSON.parse(saved) : [];
  });

  // New UI/UX State
  const [compactMode, setCompactMode] = useState(false);
  const [colorMode, setColorMode] = useState<'DEFAULT' | 'SUBJECT' | 'TEACHER' | 'GRADE'>('DEFAULT');
  const [clipboard, setClipboard] = useState<TimeTableEntry[] | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragSource, setDragSource] = useState<{ day: string, slotId: number, entryId?: string } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ day: string, slotId: number } | null>(null);

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

  const currentTimetable = useMemo(() => {
    const primary = isDraftMode ? timetableDraft : timetable;
    if (primary.length === 0) return isDraftMode ? timetable : timetableDraft;
    return primary;
  }, [isDraftMode, timetable, timetableDraft]);

  const sectionAuditData = useMemo(() => {
    if (viewMode !== 'SECTION' || !selectedTargetId) return null;
    const sectionId = selectedTargetId;
    const section = config.sections.find(s => s.id === sectionId);
    if (!section) return null;

    const entries = currentTimetable.filter(e => e.sectionId === sectionId);
    
    // 1. Anchors (Class Teacher)
    const classTeacher = users.find(u => u.classTeacherOf === sectionId);
    const anchorAssignment = assignments.find(a => 
      a.teacherId === classTeacher?.id && 
      (a.targetSectionIds?.includes(sectionId) || a.loads?.some(l => l.sectionId === sectionId))
    );
    const anchorAllocated = anchorAssignment?.anchorPeriods || (classTeacher ? 5 : 0);
    const anchorAssigned = entries.filter(e => e.teacherId === classTeacher?.id && e.slotId === 1).length;

    // 2. Pools
    const pools = (config.combinedBlocks || []).filter(b => b.sectionIds?.includes(sectionId)).map(b => {
      const allocated = b.weeklyPeriods;
      const assigned = entries.filter(e => e.blockId === b.id).length;
      return {
        id: b.id,
        name: b.title,
        allocated,
        assigned,
        teachers: b.allocations.map(a => a.teacherName).join(', ')
      };
    });

    // 3. Labs
    const labs = (config.labBlocks || []).filter(l => l.sectionIds?.includes(sectionId)).map(l => {
      const allocated = l.weeklyOccurrences * (l.isDoublePeriod ? 2 : 1);
      const assigned = entries.filter(e => e.blockId === l.id).length;
      return {
        id: l.id,
        name: l.title,
        allocated,
        assigned,
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
      load.assigned = entries.filter(e => 
        e.teacherId === load.teacherId && 
        e.subject.toLowerCase().trim() === load.subject.toLowerCase().trim() && 
        !e.blockId && 
        e.slotId !== 1 && 
        !e.isSplitLab
      ).length;
    });

    const standardLoads = Object.values(standardLoadsMap);

    // 5. Extra-Curricular
    const curriculars = (config.extraCurricularRules || []).filter(r => r.sectionIds?.includes(sectionId)).map(r => {
      const teacher = users.find(u => u.id === r.teacherId);
      const allocated = r.periodsPerWeek;
      const assigned = entries.filter(e => 
        e.teacherId === r.teacherId && 
        e.subject.toLowerCase().trim() === r.subject.toLowerCase().trim()
      ).length;
      return {
        id: r.id,
        name: r.subject,
        allocated,
        assigned,
        teacherName: teacher?.name || 'Unknown'
      };
    });

    // 6. Unlinked Entries (Ghost Detection)
    const unlinked = entries.filter(e => {
      const subjectLower = e.subject.toLowerCase().trim();
      
      // Check if it matches any of the above
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
      
      return !(isAnchor || isPool || isLab || isCurricular || isStandard);
    });

    // 7. Manual & Extra Periods (Explicitly tracked manual entries)
    const manualPeriods = entries.filter(e => e.isManual && !e.blockId && e.slotId !== 1);

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

  const setCurrentTimetable = useCallback((newDraftOrUpdater: React.SetStateAction<TimeTableEntry[]>) => {
    if (!isDraftMode) {
      setTimetable(newDraftOrUpdater);
      return;
    }

    setTimetableDraft(prev => {
      const next = typeof newDraftOrUpdater === 'function' ? (newDraftOrUpdater as any)(prev) : newDraftOrUpdater;
      
      setHistory(h => {
        const newHistory = h.slice(0, historyIndex + 1);
        newHistory.push(next);
        return newHistory;
      });
      setHistoryIndex(i => i + 1);
      
      return next;
    });
  }, [isDraftMode, setTimetable, setTimetableDraft, historyIndex]);

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

  const checkCollision = useCallback((teacherId: string, sectionId: string, day: string, slotId: number, room: string, excludeEntryId?: string, currentBatch?: TimeTableEntry[], blockId?: string, secondaryTeacherId?: string, isSplitLab?: boolean) => {
    // Check Restricted Slots and Break Times if blockId is provided
    if (blockId) {
      const pool = config.combinedBlocks?.find(b => b.id === blockId);
      if (pool) {
        if (pool.restrictedSlots && pool.restrictedSlots.includes(slotId)) {
          return `Restricted Slot: This group period is not allowed in Period ${slotId}.`;
        }
        
        if (pool.sectionIds) {
          for (const sid of pool.sectionIds) {
             const sect = config.sections.find(s => s.id === sid);
             if (sect) {
                const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
                const slotObj = wingSlots.find(s => s.id === slotId);
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
                const wingSlots = (config.slotDefinitions?.[sect.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS'] || PRIMARY_SLOTS);
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

  const handleGenerateAnchors = () => {
    if (!isDraftMode) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = [...currentTimetable];
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

    showToast("Phase 1: Analyzing registry anchors...", "info");
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
            type: 'SINGLE'
          });
          parkedCount++;
        }
      });
    });

    if (count > 0 || isPurgeMode || parkedCount > 0) {
      if (count > 0 || isPurgeMode) setCurrentTimetable([...baseTimetable, ...newEntries]);
      if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      
      const parkMsg = parkedCount > 0 ? ` (${parkedCount} parked)` : '';
      if (conflicts.length > 0) {
         // Idea #2: Interactive Feedback
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
        // For synchronized blocks, always purge the whole grade to maintain alignment
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    showToast("Phase 3: Synchronizing subject pools...", "info");
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
              blockId: pool.id
            });
            parkedCount++;
          }
        }
      }
    });

    if (count > 0 || isPurgeMode || parkedCount > 0) {
      if (count > 0 || isPurgeMode) setCurrentTimetable([...baseTimetable, ...newEntries]);
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
  };

  const handleGenerateCurriculars = () => {
    if (!isDraftMode || !config.extraCurricularRules) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      const curricularSubjects = (config.extraCurricularRules || []).map(r => r.subject);
      baseTimetable = baseTimetable.filter(e => {
        const isCurricular = curricularSubjects.includes(e.subject) && !e.isManual;
        if (!isCurricular) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    showToast("Phase 4: Deploying curricular mandates...", "info");
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
              type: 'SINGLE'
            });
            parkedCount++;
          }
        }
      });
    });

    if (count > 0 || isPurgeMode || parkedCount > 0) {
      if (count > 0 || isPurgeMode) setCurrentTimetable([...baseTimetable, ...newEntries]);
      if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      const parkMsg = parkedCount > 0 ? ` (${parkedCount} periods parked)` : '';
      showToast(`Phase 3 Complete: ${count} specialized curricular periods deployed for ${targetName}${parkMsg}. Total periods: ${baseTimetable.length + newEntries.length}`, "success");
    } else {
      showToast("Phase 3: No valid slots identified for curricular rules.", "warning");
    }
  };

  const handleGenerateLoads = () => {
    if (!isDraftMode) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = [...currentTimetable];
    if (isPurgeMode) {
      // Purge standard loads (non-manual, non-block, non-anchor)
      // We KEEP entries that are manual, blocks, or anchors
      baseTimetable = baseTimetable.filter(e => {
        const isStandardLoad = !(e.isManual || e.blockId || e.slotId === 1);
        if (!isStandardLoad) return true;
        if (activeGradeId) return e.gradeId !== activeGradeId;
        return false;
      });
    }

    showToast("Phase 5: Distributing remaining loads...", "info");
    let newEntries: TimeTableEntry[] = [];
    let newParkedItems: ParkedItem[] = [];
    let count = 0;
    let parkedCount = 0;

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
        
        // Exclude locked sections
        targetSections = targetSections.filter(s => !lockedSectionIds.includes(s.id));
        
        targetSections.forEach(section => {
          // Count existing entries for this teacher, subject and section in baseTimetable
          // EXCLUDE blocks (Labs, Combined) so they don't count towards the "Standard Load" target
          let sectionPlaced = baseTimetable.filter(e => 
            e.sectionId === section.id && 
            e.teacherId === teacher.id && 
            e.subject === load.subject &&
            !e.blockId
          ).length;
          
          const targetPerSection = load.periods;

          for (const day of DAYS) {
            if (sectionPlaced >= targetPerSection) break;
            
            // Check daily limit for this teacher and subject
            const dailySubjectCount = [...baseTimetable, ...newEntries].filter(e => 
              e.teacherId === teacher.id && 
              e.subject === load.subject && 
              e.day === day
            ).length;
            
            if (dailySubjectCount >= 2) continue; // Skip this day if already 2 periods

            for (let slot = 1; slot <= 10; slot++) {
              if (sectionPlaced >= targetPerSection) break;
              
              // Re-check daily limit inside slot loop in case we just added one
              const currentDailySubjectCount = [...baseTimetable, ...newEntries].filter(e => 
                e.teacherId === teacher.id && 
                e.subject === load.subject && 
                e.day === day
              ).length;
              
              if (currentDailySubjectCount >= 2) break; // Move to next day

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
          
          // Park unplaced periods
          if (sectionPlaced < targetPerSection) {
            const unplacedCount = targetPerSection - sectionPlaced;
            for (let i = 0; i < unplacedCount; i++) {
              const parkedEntry: TimeTableEntry = {
                id: generateUUID(),
                section: section.wingId.includes('wing-p') ? 'PRIMARY' : 'SECONDARY_BOYS',
                wingId: section.wingId,
                gradeId: section.gradeId,
                sectionId: section.id,
                className: section.fullName,
                day: '', slotId: 0,
                subject: load.subject,
                subjectCategory: SubjectCategory.CORE,
                teacherId: teacher.id,
                teacherName: teacher.name,
                room: load.room || `ROOM ${section.fullName}`,
                isManual: false
              };
              newParkedItems.push({
                id: generateUUID(),
                entries: [parkedEntry],
                type: 'SINGLE'
              });
              parkedCount++;
            }
          }
        });
      });
    });

    if (count > 0 || isPurgeMode || parkedCount > 0) {
      if (count > 0 || isPurgeMode) setCurrentTimetable([...baseTimetable, ...newEntries]);
      if (parkedCount > 0) setParkedEntries(prev => [...prev, ...newParkedItems]);
      HapticService.success();
      const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
      const parkMsg = parkedCount > 0 ? ` (${parkedCount} periods parked)` : '';
      showToast(`Phase 5 Complete: ${count} instructional load periods distributed for ${targetName}${parkMsg}.`, "success");
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'AUTO_POOL', // Reusing AUTO_POOL for general load distribution as it's similar
        subject: 'Instructional Loads',
        teacherName: 'System',
        status: parkedCount > 0 ? 'PARTIAL' : 'SUCCESS',
        details: `Distributed ${count} load periods for ${targetName}. ${parkedCount} periods parked.`,
        assignedCount: count,
        totalCount: count + parkedCount
      }, ...prev]);
    } else {
      showToast("Phase 5: Optimization complete. No deployable loads remaining.", "info");
      
      setAssignmentLogs(prev => [{
        id: generateUUID(),
        timestamp: new Date().toLocaleTimeString(),
        actionType: 'AUTO_POOL',
        subject: 'Instructional Loads',
        teacherName: 'System',
        status: 'FAILED',
        details: 'Optimization complete. No deployable loads remaining.',
        assignedCount: 0,
        totalCount: 0
      }, ...prev]);
    }
  };

  const handleGenerateLabs = () => {
    if (!isDraftMode || !config.labBlocks) return;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    let baseTimetable = [...currentTimetable];
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
              blockId: lab.id
            });
            parkedCount++;
          }
        }
      }
    });

    if (count > 0 || isPurgeMode || parkedCount > 0) {
      if (count > 0 || isPurgeMode) setCurrentTimetable([...baseTimetable, ...newEntries]);
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
      blockId: sourceBlockId
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
              blockId: te.blockId
            });
            blockEntries.forEach(be => processedIds.add(be.id));
          } else {
            newParkedItems.push({
              id: generateUUID(),
              entries: [te],
              type: 'SINGLE'
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
      {/* Assignment Activity Log */}
      {isManagement && assignmentLogs.length > 0 && (
        <div className="w-full max-w-7xl mx-auto px-4 mt-8">
          <details className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-600 dark:text-indigo-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Assignment Activity Log</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Track automatic and manual assignment events</p>
                </div>
              </div>
              <ChevronDown className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            
            <div className="border-t border-slate-100 dark:border-slate-800 max-h-96 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Time</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject/Group</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {assignmentLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-slate-500 font-mono">{log.timestamp}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                          log.actionType.includes('AUTO') 
                            ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
                            : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                        }`}>
                          {log.actionType.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {log.subject}
                        <span className="block text-[10px] font-normal text-slate-400">{log.teacherName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' :
                          log.status === 'PARTIAL' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' :
                          'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            log.status === 'SUCCESS' ? 'bg-emerald-500' :
                            log.status === 'PARTIAL' ? 'bg-amber-500' :
                            'bg-rose-500'
                          }`} />
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate" title={log.details}>
                        {log.details}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-[1300] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-48 py-1 animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{contextMenu.day} • P{contextMenu.slotId}</p>
          </div>
          
          {contextMenu.entryId ? (
            <>
              <button 
                onClick={() => {
                  const entry = currentTimetable.find(e => e.id === contextMenu.entryId);
                  if (entry) {
                    setClipboard([entry]);
                    showToast("Period copied to clipboard.", "success");
                  }
                  setContextMenu(null);
                }}
                className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
              >
                <Copy className="w-3 h-3" /> Copy Period
              </button>
              <button 
                onClick={() => {
                  handleDeleteEntry(contextMenu.entryId!);
                  setContextMenu(null);
                }}
                className="w-full text-left px-4 py-2 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-xs font-medium text-rose-600 flex items-center gap-2"
              >
                <Trash2 className="w-3 h-3" /> Delete Period
              </button>
            </>
          ) : (
            clipboard && clipboard.length === 1 && (
              <button 
                onClick={() => {
                  const newEntry = { ...clipboard[0], id: generateUUID(), day: contextMenu.day, slotId: contextMenu.slotId };
                  setCurrentTimetable(prev => [...prev, newEntry]);
                  setContextMenu(null);
                  showToast("Period pasted.", "success");
                }}
                className="w-full text-left px-4 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs font-medium text-emerald-600 flex items-center gap-2"
              >
                <ClipboardPaste className="w-3 h-3" /> Paste Period
              </button>
            )
          )}
          
          <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
          
          <button 
            onClick={() => {
              setNoteModal({ day: contextMenu.day, slotId: contextMenu.slotId, targetId: selectedTargetId, viewMode });
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
          >
            <MoreHorizontal className="w-3 h-3" /> Cell Note
          </button>
          
          {viewMode === 'SECTION' && (
             <button 
               onClick={() => {
                 toggleSectionLock(selectedTargetId);
                 setContextMenu(null);
               }}
               className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
             >
               {lockedSectionIds.includes(selectedTargetId) ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
               {lockedSectionIds.includes(selectedTargetId) ? 'Unlock Section' : 'Lock Section'}
             </button>
          )}
        </div>
      )}

      {/* Floating Action Bar for Swap/Park */}
      {swapSource && !swapSource.isFromParkingLot && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50 animate-in slide-in-from-bottom-10">
          <span className="text-sm font-medium">Select destination to swap</span>
          <div className="w-px h-4 bg-slate-700 dark:bg-slate-300" />
          <button onClick={handleParkSource} className="text-sm font-bold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1">
            <Archive className="w-4 h-4" /> Park Entry
          </button>
          <button onClick={() => setSwapSource(null)} className="text-sm font-bold text-slate-400 hover:text-slate-500 transition-colors">
            Cancel
          </button>
        </div>
      )}
      {swapSource && swapSource.isFromParkingLot && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50 animate-in slide-in-from-bottom-10">
          <span className="text-sm font-medium">Select destination to place parked item</span>
          <div className="w-px h-4 bg-slate-700 dark:bg-slate-300" />
          <button onClick={() => setSwapSource(null)} className="text-sm font-bold text-slate-400 hover:text-slate-500 transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Parking Lot Sidebar */}
      {isParkingLotOpen && (
        <div className="fixed top-0 right-0 h-full w-80 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 z-[9999] flex flex-col animate-in slide-in-from-right">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 mt-16 md:mt-0">
            <div className="flex items-center gap-2">
              <Archive className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Parking Lot</h3>
            </div>
            <button onClick={() => setIsParkingLotOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer relative z-50">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {parkedEntries.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                <Archive className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Parking lot is empty.</p>
                <p className="text-xs mt-1">Select an entry and click "Park Entry" to move it here.</p>
              </div>
            ) : (
              parkedEntries.map(item => {
                const isSelected = swapSource?.isFromParkingLot && swapSource.parkedItemId === item.id;
                const mainEntry = item.entries[0];
                const isBlock = item.type === 'BLOCK';
                
                return (
                  <div 
                    key={item.id}
                    onClick={() => {
                      if (isSelected) setSwapSource(null);
                      else {
                        setSwapSource({ isFromParkingLot: true, parkedItemId: item.id });
                        HapticService.light();
                      }
                    }}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected 
                        ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500 dark:bg-indigo-900/30' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{mainEntry.subject}</span>
                      {isBlock && (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 px-1.5 py-0.5 rounded uppercase">Group</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      <p><span className="font-medium">Teacher:</span> {mainEntry.teacherName} {mainEntry.secondaryTeacherName ? `+ ${mainEntry.secondaryTeacherName}` : ''}</p>
                      <p><span className="font-medium">Room:</span> {mainEntry.room || 'TBD'}</p>
                      <p><span className="font-medium">Sections:</span> {
                        isBlock 
                          ? item.entries.map(e => {
                              const sec = config.sections.find(s => s.id === e.sectionId);
                              return sec ? sec.name : e.sectionId;
                            }).join(', ')
                          : (config.sections.find(s => s.id === mainEntry.sectionId)?.name || mainEntry.sectionId)
                      }</p>
                    </div>
                    <div className="mt-3 flex justify-between items-center">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFindSwaps(item);
                        }}
                        className="flex-1 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center justify-center gap-1 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors mr-2"
                      >
                         <Sparkles className="w-3 h-3" /> AI Resolve
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setParkedEntries(prev => prev.filter(p => p.id !== item.id));
                          if (isSelected) setSwapSource(null);
                        }}
                        className="text-rose-500 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
                        title="Delete permanently"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {resolvingParkedItemId === item.id && (
                      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                        {swapSuggestions.length > 0 ? (
                           swapSuggestions.map(suggestion => (
                             <div key={suggestion.id} className="p-2 bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg">
                               <p className="text-[9px] text-slate-600 dark:text-slate-400 mb-2 leading-tight">{suggestion.description}</p>
                               <button onClick={() => executeDominoSwap(suggestion, item)} className="w-full bg-indigo-600 text-white py-1.5 rounded text-[9px] font-black uppercase shadow-sm hover:bg-indigo-700 transition-colors">Execute Swap</button>
                             </div>
                           ))
                        ) : (
                           <div className="p-2 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg text-center">
                             <p className="text-[9px] text-slate-500 dark:text-slate-400">No simple 1-step swaps found.</p>
                           </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className={`flex flex-col md:flex-row md:items-end justify-between gap-6 px-2 transition-all duration-300 ${isParkingLotOpen ? 'mr-80' : ''}`}>
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
            {isDraftMode ? 'Matrix' : 'Live'} <span className="text-[#d4af37]">Timetable</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">
            {isDraftMode ? 'Staging Environment - Volatile' : 'Production Registry - Read Only'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {isDraftMode && isManagement && (
            <button 
              onClick={() => setIsAuditDrawerOpen(true)}
              className={`p-3 rounded-2xl transition-all flex items-center gap-2 ${isAuditDrawerOpen ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 shadow-sm border border-slate-100 dark:border-slate-700'}`}
            >
              <Activity className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Audit Registry</span>
              {sectionAuditData && (sectionAuditData.unlinkedCount > 0 || sectionAuditData.standardLoads.some(l => l.assigned < l.allocated)) && (
                <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
              )}
            </button>
          )}

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
                onClick={() => setIsParkingLotOpen(!isParkingLotOpen)}
                className={`flex-1 md:flex-none px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all flex items-center justify-center gap-2 ${isParkingLotOpen ? 'bg-slate-800 text-white' : 'bg-white text-slate-800 border border-slate-200'}`}
              >
                <Archive className="w-4 h-4" />
                Parking Lot
                {parkedEntries.length > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {parkedEntries.length}
                  </span>
                )}
              </button>
              <div className="flex gap-2">
                <button 
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="p-3 md:px-4 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="p-3 md:px-4 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
              <button 
                onClick={handleAutoFill}
                disabled={isProcessing}
                className="flex-1 md:flex-none bg-emerald-500 text-white px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Wand2 className="w-4 h-4" /> Auto-Fill
              </button>
              <button 
                onClick={() => setIsVersionsModalOpen(true)}
                className="flex-1 md:flex-none bg-sky-500 text-white px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-2"
              >
                <History className="w-4 h-4" /> Versions
              </button>
              <button 
                onClick={handleSaveDraft}
                disabled={isProcessing || isAutoSaving}
                className="flex-1 md:flex-none bg-amber-500 text-[#001f3f] px-4 py-3 md:px-6 md:py-3.5 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-2"
              >
                {isProcessing ? 'Saving...' : isAutoSaving ? <><RefreshCw className="w-3 h-3 animate-spin" /> Auto-Saving...</> : 'Save Draft'}
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
            <button onClick={handleGenerateAnchors} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center">
              <span className="text-[7px] opacity-50 mb-0.5">Anchors</span>
              Phase 1
            </button>
            <button onClick={handleGeneratePools} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center">
              <span className="text-[7px] opacity-50 mb-0.5">Pools</span>
              Phase 2
            </button>
            <button onClick={handleGenerateCurriculars} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center">
              <span className="text-[7px] opacity-50 mb-0.5">Activities</span>
              Phase 3
            </button>
            <button onClick={handleGenerateLoads} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center">
              <span className="text-[7px] opacity-50 mb-0.5">Loads</span>
              Phase 4
            </button>
            <button onClick={handleGenerateLabs} className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center">
              <span className="text-[7px] opacity-50 mb-0.5">Labs</span>
              Phase 5
            </button>
            
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
                      onClick={() => handleSelectivePurge('ANCHORS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Anchors (Ph 1)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('LABS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Labs (Ph 2)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('POOLS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Pools (Ph 3)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('CURRICULAR')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Activities (Ph 4)
                    </button>
                    <button 
                      onClick={() => handleSelectivePurge('LOADS')}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[9px] font-black uppercase text-slate-500"
                    >
                      Purge Only Loads (Ph 5)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DESKTOP TABLE VIEW */}
        <div className={`hidden md:block overflow-x-auto ${compactMode ? 'scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700' : 'scrollbar-hide'} pb-12 transition-all duration-300 ${isParkingLotOpen ? 'mr-80' : ''}`}>
           <table className={`w-full border-separate ${compactMode ? 'border-spacing-1' : 'border-spacing-2'}`}>
             <thead>
               <tr>
                  <th className={`sticky top-0 left-0 z-30 bg-white dark:bg-slate-950 ${compactMode ? 'p-2 w-20' : 'p-4 w-32'} border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm transition-all`}>
                    <span className="text-[10px] font-black uppercase text-slate-400">Day</span>
                  </th>
                  {displayedSlots.map(slot => (
                    <th key={slot.id} className={`sticky top-0 z-20 bg-white dark:bg-slate-950 ${compactMode ? 'p-2 min-w-[100px]' : 'p-4 min-w-[140px]'} border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm transition-all`}>
                       <p className="text-[13px] font-black text-[#001f3f] dark:text-white tabular-nums leading-none">{slot.startTime} - {slot.endTime}</p>
                       <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1 opacity-100 italic">{slot.label}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {DAYS.map(day => (
                 <tr key={day}>
                   <td className={`sticky left-0 z-20 bg-white dark:bg-slate-950 ${compactMode ? 'p-2' : 'p-4'} border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm align-top transition-all`}>
                      <div className="flex flex-col items-center justify-between h-full min-h-[80px]">
                        <span className="text-[12px] font-black uppercase text-slate-700 dark:text-slate-200 italic writing-mode-vertical">{day}</span>
                         {isDraftMode && isManagement && (
                           <div className="flex flex-col gap-1 mt-2">
                             <button 
                               onClick={() => handleCopyDay(day)}
                               className="p-1.5 rounded-full bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
                               title={`Copy ${day}'s Schedule`}
                             >
                               <Copy className="w-3 h-3" />
                             </button>
                             {clipboard && clipboard.length > 1 && (
                               <button 
                                 onClick={() => handlePasteDay(day)}
                                 className="p-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors"
                                 title={`Paste to ${day}`}
                               >
                                 <ClipboardPaste className="w-3 h-3" />
                               </button>
                             )}
                           </div>
                         )}
                      </div>
                   </td>
                   {displayedSlots.map(slot => {
                     const cellEntries = activeData.filter(e => {
                       if (e.day !== day || e.slotId !== slot.id) return false;
                       
                       const targetIdLower = selectedTargetId?.toLowerCase().trim();

                       if (viewMode === 'SECTION') return e.sectionId?.toLowerCase().trim() === targetIdLower;
                       if (viewMode === 'TEACHER') {
                         if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
                         if (e.secondaryTeacherId?.toLowerCase().trim() === targetIdLower) return true;
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

                      const isSource = swapSource && !swapSource.isFromParkingLot && swapSource.day === day && swapSource.slotId === slot.id;
                      const clashReason = clashMap[`${day}-${slot.id}`];
                      const isLocked = viewMode === 'SECTION' && isCellLocked(day, slot.id, selectedTargetId);
                      const isValidDrop = isSwapMode && swapSource && !isSource && !slot.isBreak && !clashReason && !isLocked;
                      const cellNoteKey = `${viewMode}-${selectedTargetId}-${day}-${slot.id}`;
                      const hasNote = !!cellNotes[cellNoteKey];

                      return (
                       <td 
                         key={slot.id} 
                         onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
                         onContextMenu={(e) => handleContextMenu(e, day, slot.id, distinctEntries[0]?.id)}
                         onDragOver={(e) => onDragOver(e, day, slot.id)}
                         onDrop={(e) => onDrop(e, day, slot.id)}
                         className={`border border-slate-200 dark:border-slate-800 relative transition-all ${compactMode ? 'p-2 min-h-[60px]' : 'p-4 min-h-[100px]'} ${
                            slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10' : 
                            isSource ? 'bg-indigo-100 ring-2 ring-indigo-500' : 
                            dragOverTarget?.day === day && dragOverTarget?.slotId === slot.id ? 'bg-indigo-50 ring-2 ring-indigo-400' :
                            clashReason ? 'bg-rose-50/60 dark:bg-rose-900/20' : 
                            isLocked ? 'bg-slate-100/80 dark:bg-slate-800/80' :
                            isValidDrop ? 'bg-emerald-50/40 dark:bg-emerald-900/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 cursor-pointer border-emerald-200 dark:border-emerald-800' :
                            getCellColor(distinctEntries) || 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer'
                          } shadow-sm rounded-xl`}
                       >
                         <div 
                           draggable={!slot.isBreak && distinctEntries.length > 0 && isDraftMode && isManagement}
                           onDragStart={(e) => onDragStart(e, day, slot.id, distinctEntries[0]?.id)}
                           className={`w-full h-full flex flex-col justify-center ${!slot.isBreak && distinctEntries.length > 0 && isDraftMode && isManagement ? 'cursor-grab active:cursor-grabbing' : ''}`}
                         >
                           {hasNote && (
                             <div className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full shadow-sm" title={cellNotes[cellNoteKey]} />
                           )}
                           {isLocked && !slot.isBreak && (
                             <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none overflow-hidden">
                               <Lock className="w-24 h-24 rotate-12" />
                             </div>
                           )}
                           {isLocked && !slot.isBreak && (
                             <div className="absolute top-1 left-1 z-10" title="This period is locked">
                               <Lock className="w-2.5 h-2.5 text-slate-400" />
                             </div>
                           )}
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

                               // Lab Technician View Logic
                               if (viewMode === 'TEACHER' && e.secondaryTeacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim()) {
                                  displaySubject = `${e.subject} (Lab)`;
                                  displaySubtext = `${e.className} w/ ${e.teacherName}`;
                               }
 
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
                         </div>
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

                const isSource = swapSource && !swapSource.isFromParkingLot && swapSource.day === day && swapSource.slotId === slot.id;
                const clashReason = clashMap[`${day}-${slot.id}`];
                const isLocked = viewMode === 'SECTION' && isCellLocked(day, slot.id, selectedTargetId);
                const isValidDrop = isSwapMode && swapSource && !isSource && !slot.isBreak && !clashReason && !isLocked;
                const cellNoteKey = `${viewMode}-${selectedTargetId}-${day}-${slot.id}`;
                const hasNote = !!cellNotes[cellNoteKey];

                return (
                  <div 
                    key={slot.id} 
                    onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
                    onContextMenu={(e) => handleContextMenu(e, day, slot.id)}
                    className={`p-5 rounded-[2rem] border relative transition-all ${
                      slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-300 dark:border-amber-700' : 
                      isSource ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500' : 
                      clashReason ? 'bg-rose-50 border-rose-200' : 
                      isLocked ? 'bg-slate-100/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700' :
                      isValidDrop ? 'bg-emerald-50/40 dark:bg-emerald-900/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 cursor-pointer border-emerald-200 dark:border-emerald-800' :
                      'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm'
                    }`}
                  >
                    {hasNote && (
                      <div className="absolute top-2 right-2 w-2.5 h-2.5 bg-amber-400 rounded-full shadow-sm" title={cellNotes[cellNoteKey]} />
                    )}
                    {isLocked && !slot.isBreak && (
                      <div className="absolute top-4 right-4 z-10">
                        <Lock className="w-3 h-3 text-slate-400" />
                      </div>
                    )}
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

                          // Lab Technician View Logic
                          if (viewMode === 'TEACHER' && e.secondaryTeacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim()) {
                             displaySubject = `${e.subject} (Lab)`;
                             displaySubtext = `${e.className} w/ ${e.teacherName}`;
                          }

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
                    {isDraftMode && isManagement && (
                      <div className="pt-2">
                        <button 
                          onClick={() => findSafeSlots(entry.id)}
                          className="w-full py-3 bg-emerald-50 text-emerald-600 rounded-xl font-black text-[10px] uppercase tracking-widest border border-emerald-100 hover:bg-emerald-100 transition-all"
                        >
                          Find Safe Slots
                        </button>
                        {safeSlots && (
                          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-h-40 overflow-y-auto">
                            <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Available Safe Slots</h5>
                            {safeSlots.length === 0 ? (
                              <p className="text-xs text-rose-500 font-medium">No safe slots available without clashes.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {safeSlots.map((s, idx) => (
                                  <span key={idx} className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                    {s.day.substring(0, 3)} P{s.slotId}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={() => { setViewingEntryId(null); setSafeSlots(null); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-[#001f3f] transition-colors">Close Details</button>
                  </div>
                );
              })()}
           </div>
        </div>
      )}

      {isVersionsModalOpen && (
        <div className="fixed inset-0 z-[1200] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[2rem] p-6 md:p-8 shadow-2xl space-y-6 animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center">
                 <div>
                   <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Draft Versions</h4>
                   <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">Manage & Restore Snapshots</p>
                 </div>
                 <button onClick={() => setIsVersionsModalOpen(false)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                   <X className="w-5 h-5" />
                 </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl flex justify-between items-center">
                  <div>
                    <h5 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">Current Draft</h5>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">{timetableDraft.length} periods allocated</p>
                  </div>
                  <button 
                    onClick={handleSaveVersion}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors"
                  >
                    Save as Version
                  </button>
                </div>

                {versions.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <History className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-500">No saved versions yet.</p>
                  </div>
                ) : (
                  versions.map(v => (
                    <div key={v.id} className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-sm font-bold text-slate-900 dark:text-white">{v.name}</h5>
                          {v.isShared && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[8px] font-black uppercase tracking-widest">Shared</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {new Date(v.createdAt).toLocaleString()} • By {v.createdBy} • {v.entries.length} periods
                        </p>
                      </div>
                      <div className="flex gap-2 w-full md:w-auto">
                        <button 
                          onClick={() => handleShareVersion(v.id)}
                          className={`flex-1 md:flex-none px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-1 ${v.isShared ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                        >
                          <Share2 className="w-3 h-3" /> {v.isShared ? 'Shared' : 'Share'}
                        </button>
                        <button 
                          onClick={() => handleRestoreVersion(v)}
                          className="flex-1 md:flex-none px-3 py-2 bg-sky-50 text-sky-600 border border-sky-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-sky-100 transition-colors"
                        >
                          Restore
                        </button>
                        <button 
                          onClick={() => handleDeleteVersion(v.id)}
                          className="p-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
           </div>
        </div>
      )}

      {noteModal && (
        <div className="fixed inset-0 z-[1200] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2rem] p-6 md:p-8 shadow-2xl space-y-6 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Cell Note</h4>
                 <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-2">{noteModal.day} • Period {noteModal.slotId}</p>
              </div>
              <textarea
                autoFocus
                className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 focus:border-amber-400 focus:ring-0 resize-none"
                placeholder="Add a note for this specific cell..."
                defaultValue={cellNotes[`${noteModal.viewMode}-${noteModal.targetId}-${noteModal.day}-${noteModal.slotId}`] || ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim();
                    const key = `${noteModal.viewMode}-${noteModal.targetId}-${noteModal.day}-${noteModal.slotId}`;
                    setCellNotes(prev => {
                      const next = { ...prev };
                      if (val) next[key] = val;
                      else delete next[key];
                      return next;
                    });
                    setNoteModal(null);
                  }
                }}
                onBlur={(e) => {
                  const val = e.currentTarget.value.trim();
                  const key = `${noteModal.viewMode}-${noteModal.targetId}-${noteModal.day}-${noteModal.slotId}`;
                  setCellNotes(prev => {
                    const next = { ...prev };
                    if (val) next[key] = val;
                    else delete next[key];
                    return next;
                  });
                }}
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    const key = `${noteModal.viewMode}-${noteModal.targetId}-${noteModal.day}-${noteModal.slotId}`;
                    setCellNotes(prev => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    });
                    setNoteModal(null);
                  }}
                  className="flex-1 py-3 bg-rose-50 text-rose-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-colors"
                >
                  Clear
                </button>
                <button 
                  onClick={() => setNoteModal(null)}
                  className="flex-1 py-3 bg-[#001f3f] text-[#d4af37] rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-colors"
                >
                  Done
                </button>
              </div>
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
                          <div className="flex justify-between items-center ml-4 mr-2">
                             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Faculty Member</label>
                             <button onClick={handleMagicFill} className="text-[8px] font-black text-indigo-500 uppercase flex items-center gap-1 hover:text-indigo-600 transition-colors" title="Suggest available teacher with lowest load">
                               <Wand2 className="w-3 h-3" /> Suggest
                             </button>
                          </div>
                          <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                             <option value="">Select Staff...</option>
                             {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => {
                               const load = currentTimetable.filter(e => e.teacherId === u.id).length;
                               return <option key={u.id} value={u.id}>{u.name} ({load})</option>;
                             })}
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
                       {/* Lab Template Selection */}
                       <div className="space-y-1 px-4">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Lab Period Template</label>
                          <select value={selLabBlockId} onChange={e => setSelLabBlockId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-amber-400/50 focus:border-amber-400 transition-all">
                             <option value="">Manual Configuration (No Template)</option>
                             {config.labBlocks?.filter(l => {
                                const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                                return l.sectionIds?.includes(targetSecId);
                             }).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                          </select>
                       </div>

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
      {/* Timetable Audit Drawer */}
      {isAuditDrawerOpen && sectionAuditData && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsAuditDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-[#001f3f]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#d4af37]/20 rounded-xl">
                  <Activity className="w-5 h-5 text-[#d4af37]" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-widest">Registry Audit</h2>
                  <p className="text-[10px] font-bold text-[#d4af37] uppercase tracking-widest">{sectionAuditData.sectionName}</p>
                </div>
              </div>
              <button onClick={() => setIsAuditDrawerOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Unlinked Entries</p>
                  <p className={`text-xl font-black ${sectionAuditData.unlinkedCount > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {sectionAuditData.unlinkedCount}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Health Score</p>
                  <p className="text-xl font-black text-[#001f3f] dark:text-[#d4af37]">
                    {Math.round(((sectionAuditData.standardLoads.filter(l => l.assigned === l.allocated).length + 
                      sectionAuditData.pools.filter(p => p.assigned === p.allocated).length + 
                      sectionAuditData.labs.filter(l => l.assigned === l.allocated).length) / 
                      (sectionAuditData.standardLoads.length + sectionAuditData.pools.length + sectionAuditData.labs.length || 1)) * 100)}%
                  </p>
                </div>
              </div>

              {/* Anchors Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                  <Lock className="w-4 h-4" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest">Registry Anchors</h3>
                </div>
                <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{sectionAuditData.anchors.teacherName || 'Not Assigned'}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Class Teacher (Slot 1)</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-slate-900 dark:text-white">{sectionAuditData.anchors.assigned} / {sectionAuditData.anchors.allocated}</p>
                      <AuditStatusBadge assigned={sectionAuditData.anchors.assigned} allocated={sectionAuditData.anchors.allocated} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Standard Loads */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                  <ArrowRight className="w-4 h-4" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest">Standard Loads</h3>
                </div>
                <div className="space-y-2">
                  {sectionAuditData.standardLoads.sort((a, b) => (a.assigned === a.allocated ? 1 : -1)).map((load, idx) => {
                    const global = getGlobalTeacherLoad(load.teacherId);
                    return (
                      <div key={idx} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm hover:border-amber-400 transition-colors group">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{load.subject}</p>
                              {global.assigned > global.target && (
                                <span className="p-1 bg-rose-100 text-rose-600 rounded-md" title="Overloaded school-wide">
                                  <AlertCircle className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{load.teacherName}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all duration-500 ${load.assigned > load.allocated ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.min(100, (load.assigned / load.allocated) * 100)}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-black text-slate-400">{global.assigned}/{global.target} Total</span>
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            <p className="text-xs font-black text-slate-900 dark:text-white">{load.assigned} / {load.allocated}</p>
                            <AuditStatusBadge assigned={load.assigned} allocated={load.allocated} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pools Section */}
              {sectionAuditData.pools.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                    <RefreshCw className="w-4 h-4" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Parallel Pools</h3>
                  </div>
                  <div className="space-y-2">
                    {sectionAuditData.pools.map((pool) => (
                      <div key={pool.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{pool.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{pool.teachers}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black text-slate-900 dark:text-white">{pool.assigned} / {pool.allocated}</p>
                            <AuditStatusBadge assigned={pool.assigned} allocated={pool.allocated} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Labs Section */}
              {sectionAuditData.labs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                    <Wand2 className="w-4 h-4" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Specialist Labs</h3>
                  </div>
                  <div className="space-y-2">
                    {sectionAuditData.labs.map((lab) => (
                      <div key={lab.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{lab.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{lab.teachers}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black text-slate-900 dark:text-white">{lab.assigned} / {lab.allocated}</p>
                            <AuditStatusBadge assigned={lab.assigned} allocated={lab.allocated} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity Periods Section */}
              {sectionAuditData.curriculars.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                    <Palette className="w-4 h-4" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Activity Periods</h3>
                  </div>
                  <div className="space-y-2">
                    {sectionAuditData.curriculars.map((activity) => (
                      <div key={activity.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{activity.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{activity.teacherName}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black text-slate-900 dark:text-white">{activity.assigned} / {activity.allocated}</p>
                            <AuditStatusBadge assigned={activity.assigned} allocated={activity.allocated} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual & Extra Periods Section */}
              {sectionAuditData.manualPeriods.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                    <Plus className="w-4 h-4" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Manual & Extra Periods</h3>
                  </div>
                  <div className="space-y-2">
                    {sectionAuditData.manualPeriods.map((e, idx) => (
                      <div key={idx} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{e.subject}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{e.teacherName} • {e.day} P{e.slotId}</p>
                          </div>
                          <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[8px] font-black rounded-lg uppercase tracking-widest">Manual</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unlinked Entries */}
              {sectionAuditData.unlinkedCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-rose-500">
                    <AlertCircle className="w-4 h-4" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Unlinked (Ghost) Entries</h3>
                  </div>
                  <div className="p-4 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-100 dark:border-rose-900/30">
                    <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase mb-3">
                      The following entries exist in the timetable but have no matching record in the registry:
                    </p>
                    <div className="space-y-2">
                      {sectionAuditData.unlinkedEntries.map((e, idx) => (
                        <div key={idx} className="flex justify-between items-center p-2 bg-white dark:bg-slate-800 rounded-xl border border-rose-100 dark:border-rose-900/20">
                          <div>
                            <p className="text-[10px] font-black text-slate-900 dark:text-white uppercase">{e.subject}</p>
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{e.teacherName} • {e.day} P{e.slotId}</p>
                          </div>
                          <button 
                            onClick={() => {
                              setCurrentTimetable(prev => prev.filter(item => item.id !== e.id));
                              showToast("Ghost entry removed", "info");
                            }}
                            className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-slate-400 mt-0.5" />
                <p className="text-[9px] font-bold text-slate-400 uppercase leading-relaxed">
                  This audit report compares your current draft against the Teacher Workload, Group Period, and Lab Period registries. Use it to ensure 100% coverage before sharing.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;


import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, CombinedBlock, SchoolSection } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface FillReport {
  gradeName: string;
  totalRequested: number;
  placed: number;
  skipped: { teacher: string; subject: string; reason: string; day?: string; slot?: number }[];
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
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ 
  user, users, timetable, setTimetable, timetableDraft, setTimetableDraft, 
  isDraftMode, setIsDraftMode, substitutions, config, assignments, 
  setAssignments, onManualSync, triggerConfirm 
}) => {
  const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.INCHARGE_ALL;
  const isCloudActive = IS_CLOUD_ENABLED;
  
  const currentTimetable = (isDraftMode ? timetableDraft : timetable) || [];
  const setCurrentTimetable = isDraftMode ? setTimetableDraft : setTimetable;

  const [activeWingId, setActiveWingId] = useState<string>(config.wings[0]?.id || '');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'SECTION' | 'TEACHER' | 'ROOM'>('SECTION');
  const [editingCell, setEditingCell] = useState<{day: string, slotId: number} | null>(null);
  const [cellForm, setCellForm] = useState({ teacherId: '', subject: '', room: '', blockId: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalTab, setModalTab] = useState<'SINGLE' | 'BLOCK'>('SINGLE');

  // New States for Solution A & C
  const [ignoreLive, setIgnoreLive] = useState(false);
  const [showAutoFillDialog, setShowAutoFillDialog] = useState(false);
  const [report, setReport] = useState<FillReport | null>(null);

  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{day: string, slotId: number} | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{day: string, slotId: number} | null>(null);

  const getSlotsForWing = useCallback((wingId: string): TimeSlot[] => {
    const wing = config.wings.find(w => w.id === wingId);
    if (!wing) return SECONDARY_BOYS_SLOTS;
    return config.slotDefinitions?.[wing.sectionType] || SECONDARY_BOYS_SLOTS;
  }, [config.wings, config.slotDefinitions]);

  const slots = useMemo(() => viewMode === 'SECTION' ? getSlotsForWing(activeWingId) : SECONDARY_BOYS_SLOTS.filter(s => !s.isBreak), [viewMode, activeWingId, getSlotsForWing]);

  const filteredEntities = useMemo(() => {
    if (viewMode === 'SECTION') return config.sections.filter(s => s.wingId === activeWingId).map(s => ({ id: s.id, name: s.fullName }));
    if (viewMode === 'TEACHER') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name }));
    return (config.rooms || []).map(r => ({ id: r, name: r }));
  }, [viewMode, activeWingId, config.sections, config.rooms, users]);

  const getRelevantBlocks = useMemo(() => {
    if (viewMode !== 'SECTION' || !selectedTargetId) return [];
    const section = config.sections.find(s => s.id === selectedTargetId);
    if (!section) return [];
    return (config.combinedBlocks || []).filter(b => b.gradeId === section.gradeId);
  }, [viewMode, selectedTargetId, config.sections, config.combinedBlocks]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(entry => {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) registry.set(key, [entry]);
      else registry.get(key)!.push(entry);
    });
    return registry;
  }, [currentTimetable]);

  const handlePublishMatrix = () => {
    if (timetableDraft.length === 0) {
      alert("Institutional Draft is empty. No data to publish.");
      return;
    }

    triggerConfirm("RE-DEPLOYMENT PROTOCOL: This will push ALL DRAFT assignments to the LIVE matrix. Existing data for involved sections will be updated. Proceed?", async () => {
      setIsProcessing(true);
      try {
        if (isCloudActive) {
          const livePayload = timetableDraft.map(e => ({
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
            room: e.room || null,
            date: e.date || null,
            is_substitution: e.isSubstitution || false,
            block_id: e.blockId || null,
            block_name: e.blockName || null
          }));

          const { error: upsertError } = await supabase
            .from('timetable_entries')
            .upsert(livePayload, { onConflict: 'id' });

          if (upsertError) throw new Error(`Live Deployment Failure: ${upsertError.message}`);

          const draftIds = timetableDraft.map(d => d.id);
          const { error: deleteError } = await supabase
            .from('timetable_drafts')
            .delete()
            .in('id', draftIds);

          if (deleteError) console.warn("Partial Success: Matrix Published but Draft sandbox cleanup failed.");
        }

        const targetSectionIds = new Set(timetableDraft.map(d => d.sectionId));
        setTimetable(prev => [
          ...prev.filter(t => !targetSectionIds.has(t.sectionId)),
          ...timetableDraft
        ]);
        
        setTimetableDraft([]); 
        setIsDraftMode(false); 
        alert("Institutional Matrix Synchronized Successfully.");
      } catch (err: any) {
        console.error("Publish Critical Failure:", err);
        alert(`PROTOCOL ABORTED: ${err.message || 'Matrix Synchronization Error'}`);
      } finally {
        setIsProcessing(false);
      }
    });
  };

  const executeGradeAutoFill = async () => {
    if (!selectedTargetId || viewMode !== 'SECTION') return;
    const targetSection = config.sections.find(s => s.id === selectedTargetId)!;
    const gradeId = targetSection.gradeId;
    const gradeName = config.grades.find(g => g.id === gradeId)?.name || "Grade";
    
    setIsProcessing(true);
    setShowAutoFillDialog(false);
    
    const sectionsInGrade = config.sections.filter(s => s.gradeId === gradeId);
    const blocksInGrade = (config.combinedBlocks || []).filter(b => b.gradeId === gradeId);
    const gradeAssignments = assignments.filter(a => a.gradeId === gradeId);
    
    let newDraft: TimeTableEntry[] = [...timetableDraft.filter(t => !sectionsInGrade.some(s => s.id === t.sectionId))];
    const skippedEntries: FillReport['skipped'] = [];
    let totalLoadsCount = 0;
    let placedCount = 0;

    // PHASE 0: Class Teacher Anchors (Period 1 Preference)
    // Anchors designated Class Teachers to Period 1 for their primary subject
    sectionsInGrade.forEach(sect => {
      const classTeacher = users.find(u => u.classTeacherOf === sect.id);
      if (!classTeacher) return;

      const asgn = gradeAssignments.find(a => a.teacherId === classTeacher.id);
      if (!asgn || !asgn.loads.length) return;

      // Rule: Pick first subject from faculty load preference
      const primaryLoad = asgn.loads[0];
      // Rule: Anchor assigned number of periods, leave others open (Option B)
      const periodsToAnchor = Math.min(primaryLoad.periods, DAYS.length);

      for (let i = 0; i < periodsToAnchor; i++) {
        const day = DAYS[i];
        const slotId = 1; // Anchor strictly to Period 1

        newDraft.push({
          id: generateUUID(),
          section: 'PRIMARY',
          wingId: sect.wingId,
          gradeId: sect.gradeId,
          sectionId: sect.id,
          className: sect.fullName,
          day,
          slotId,
          subject: primaryLoad.subject,
          subjectCategory: SubjectCategory.CORE,
          teacherId: classTeacher.id,
          teacherName: classTeacher.name,
          room: primaryLoad.room || `ROOM ${sect.fullName}`
        });
        placedCount++;
      }
    });

    // PHASE 1: Deploy Parallel Blocks (VERTICAL SCANNED & SCATTERED)
    blocksInGrade.forEach(block => {
      const required = Number(block.weeklyPeriods) || 0;
      totalLoadsCount += (required * block.sectionIds.length);
      if (required === 0) return;

      let deployed = 0;
      const wingId = config.grades.find(g => g.id === block.gradeId)?.wingId;
      const wingSlots = getSlotsForWing(wingId || '').filter(s => !s.isBreak);

      for (const slot of wingSlots) {
        if (deployed >= required) break;
        for (const day of DAYS) {
          if (deployed >= required) break;

          const teachersFree = block.allocations.every(alloc => {
            const isBusyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === alloc.teacherId);
            const isBusyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === alloc.teacherId);
            return !isBusyDraft && !isBusyLive;
          });

          const classesFree = block.sectionIds.every(sid => !newDraft.some(t => t.day === day && t.slotId === slot.id && t.sectionId === sid));

          const roomsFree = block.allocations.every(alloc => {
            if (!alloc.room) return true;
            const isBusyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.room === alloc.room);
            const isBusyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.room === alloc.room);
            return !isBusyDraft && !isBusyLive;
          });

          if (teachersFree && classesFree && roomsFree) {
            block.sectionIds.forEach((sid, idx) => {
              const sect = config.sections.find(s => s.id === sid)!;
              const alloc = block.allocations[idx % block.allocations.length];
              newDraft.push({
                id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id,
                className: sect.fullName, day, slotId: slot.id, subject: alloc.subject, subjectCategory: SubjectCategory.CORE,
                teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '',
                blockId: block.id, blockName: block.title
              });
              placedCount++;
            });
            deployed++;
          }
        }
      }
      if (deployed < required) {
        skippedEntries.push({ teacher: "BLOCK", subject: block.title, reason: `Insufficient free synchronized slots (Placed ${deployed}/${required})` });
      }
    });

    // PHASE 2: Deploy Residual Individual Loads (VERTICAL SCANNED + DAY BALANCED)
    sectionsInGrade.forEach(sect => {
      const sectAssignments = gradeAssignments.filter(a => a.targetSectionIds?.includes(sect.id));
      const wingSlots = getSlotsForWing(sect.wingId).filter(s => !s.isBreak);
      const classTeacher = users.find(u => u.classTeacherOf === sect.id);
      
      sectAssignments.forEach(asgn => {
        asgn.loads.forEach(load => {
          totalLoadsCount += load.periods;
          
          // Detect if this is the primary load already handled in Phase 0
          const isPrimaryAnchor = classTeacher?.id === asgn.teacherId && asgn.loads[0].subject === load.subject;
          const periodsAlreadyAnchored = isPrimaryAnchor ? Math.min(load.periods, DAYS.length) : 0;
          
          let placed = periodsAlreadyAnchored;
          
          for (const slot of wingSlots) {
            if (placed >= load.periods) break;
            for (const day of DAYS) {
              if (placed >= load.periods) break;
              
              const subjectCountOnDay = newDraft.filter(t => t.sectionId === sect.id && t.day === day && t.subject === load.subject).length;
              const isAllowedByDayBalance = (load.periods <= DAYS.length) ? (subjectCountOnDay === 0) : (subjectCountOnDay < Math.ceil(load.periods / DAYS.length));

              if (!isAllowedByDayBalance) continue;

              const classBusy = newDraft.some(t => t.sectionId === sect.id && t.day === day && t.slotId === slot.id);
              const teacherBusyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === asgn.teacherId);
              const teacherBusyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === asgn.teacherId);
              
              const roomBusyDraft = load.room ? newDraft.some(t => t.day === day && t.slotId === slot.id && t.room === load.room) : false;
              const roomBusyLive = !ignoreLive && load.room ? timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.room === load.room) : false;

              if (!classBusy && !teacherBusyDraft && !teacherBusyLive && !roomBusyDraft && !roomBusyLive) {
                const teacher = users.find(u => u.id === asgn.teacherId);
                newDraft.push({
                  id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id,
                  className: sect.fullName, day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE,
                  teacherId: asgn.teacherId, teacherName: teacher?.name || 'Unknown', room: load.room || ''
                });
                placed++;
                placedCount++;
              }
            }
          }

          if (placed < load.periods) {
             for (const slot of wingSlots) {
                if (placed >= load.periods) break;
                for (const day of DAYS) {
                   if (placed >= load.periods) break;
                   
                   const alreadyAtThisSlot = newDraft.some(t => t.sectionId === sect.id && t.day === day && t.slotId === slot.id && t.subject === load.subject);
                   if (alreadyAtThisSlot) continue;

                   const classBusy = newDraft.some(t => t.sectionId === sect.id && t.day === day && t.slotId === slot.id);
                   const teacherBusyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === asgn.teacherId);
                   const teacherBusyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === asgn.teacherId);
                   const roomBusyDraft = load.room ? newDraft.some(t => t.day === day && t.slotId === slot.id && t.room === load.room) : false;
                   const roomBusyLive = !ignoreLive && load.room ? timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.room === load.room) : false;

                   if (!classBusy && !teacherBusyDraft && !teacherBusyLive && !roomBusyDraft && !roomBusyLive) {
                      newDraft.push({
                        id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id,
                        className: sect.fullName, day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE,
                        teacherId: asgn.teacherId, teacherName: users.find(u => u.id === asgn.teacherId)?.name || 'Unknown', room: load.room || ''
                      });
                      placed++;
                      placedCount++;
                   }
                }
             }
          }

          if (placed < load.periods) {
            const teacher = users.find(u => u.id === asgn.teacherId);
            skippedEntries.push({ teacher: teacher?.name || "Unknown", subject: load.subject, reason: `Only ${placed}/${load.periods} periods could be fitted.` });
          }
        });
      });
    });

    setTimetableDraft(newDraft);
    setReport({ gradeName, totalRequested: totalLoadsCount, placed: placedCount, skipped: skippedEntries });

    if (isCloudActive) {
      try {
        const dbReady = newDraft.filter(t => sectionsInGrade.some(s => s.id === t.sectionId)).map(e => ({
          id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, 
          class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, 
          subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, 
          room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false
        }));
        const sectionIds = sectionsInGrade.map(s => s.id);
        await supabase.from('timetable_drafts').delete().in('section_id', sectionIds);
        await supabase.from('timetable_drafts').insert(dbReady);
      } catch (err) {
        console.error("Cloud Sync Failure");
      }
    }
    setIsProcessing(false);
  };

  const executeMoveOrSwap = async (source: {day: string, slotId: number}, target: {day: string, slotId: number}) => {
    if (source.day === target.day && source.slotId === target.slotId) return;
    if (!selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    const allSourceEntries = cellRegistry.get(`${source.day}-${source.slotId}`) || [];
    const allTargetEntries = cellRegistry.get(`${target.day}-${target.slotId}`) || [];
    const activeSourceEntry = allSourceEntries.find(t => {
      if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
      if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
      return t.room === selectedTargetId;
    });
    if (!activeSourceEntry) { setIsProcessing(false); return; }
    let sourceItemsToMove: TimeTableEntry[] = [];
    let targetItemsToSwap: TimeTableEntry[] = [];
    if (activeSourceEntry.blockId) {
      sourceItemsToMove = allSourceEntries.filter(t => t.blockId === activeSourceEntry.blockId);
      const involvedSectionIds = sourceItemsToMove.map(t => t.sectionId);
      const involvedTeacherIds = sourceItemsToMove.map(t => t.teacherId);
      targetItemsToSwap = allTargetEntries.filter(t => involvedSectionIds.includes(t.sectionId) || involvedTeacherIds.includes(t.teacherId));
    } else {
      sourceItemsToMove = [activeSourceEntry];
      const activeTargetEntry = allTargetEntries.find(t => {
        if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
        if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
        return t.room === selectedTargetId;
      });
      if (activeTargetEntry) targetItemsToSwap = [activeTargetEntry];
    }
    const conflicts = sourceItemsToMove.some(item => {
      const teacherConflict = timetable.some(t => t.day === target.day && t.slotId === target.slotId && !t.date && t.teacherId === item.teacherId) ||
                             currentTimetable.some(t => t.day === target.day && t.slotId === target.slotId && t.teacherId === item.teacherId && (!item.blockId || t.blockId !== item.blockId));
      const sectionConflict = currentTimetable.some(t => t.day === target.day && t.slotId === target.slotId && t.sectionId === item.sectionId && (!item.blockId || t.blockId !== item.blockId));
      const roomConflict = item.room ? (timetable.some(t => t.day === target.day && t.slotId === target.slotId && !t.date && t.room === item.room) || currentTimetable.some(t => t.day === target.day && t.slotId === target.slotId && t.room === item.room && (!item.blockId || t.blockId !== item.blockId))) : false;
      return (teacherConflict && !targetItemsToSwap.some(swap => swap.teacherId === item.teacherId)) || (sectionConflict && !targetItemsToSwap.some(swap => swap.sectionId === item.sectionId)) || (roomConflict && !targetItemsToSwap.some(swap => swap.room === item.room));
    });
    if (conflicts) { alert("CONSTRAINT VIOLATION: Movement blocked."); setIsProcessing(false); setSwapSource(null); return; }
    const updatedSource = sourceItemsToMove.map(s => ({ ...s, day: target.day, slotId: target.slotId, id: generateUUID() }));
    const updatedTarget = targetItemsToSwap.map(s => ({ ...s, day: source.day, slotId: source.slotId, id: generateUUID() }));
    if (isCloudActive) {
      try {
        const involvedSectionsAll = Array.from(new Set([...sourceItemsToMove, ...targetItemsToSwap].map(i => i.sectionId)));
        for (const sid of involvedSectionsAll) {
          await supabase.from(table).delete().match({ section_id: sid, day: source.day, slot_id: source.slotId });
          await supabase.from(table).delete().match({ section_id: sid, day: target.day, slot_id: target.slotId });
        }
        const toInsert = [...updatedSource, ...updatedTarget].map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false }));
        if (toInsert.length > 0) await supabase.from(table).insert(toInsert);
      } catch (err) { console.error("Cloud displacement failed"); }
    }
    setCurrentTimetable(prev => { const movedIds = new Set([...sourceItemsToMove, ...targetItemsToSwap].map(i => i.id)); return [...prev.filter(t => !movedIds.has(t.id)), ...updatedSource, ...updatedTarget]; });
    setIsProcessing(false); setSwapSource(null);
  };

  const saveCell = async () => {
    if (!editingCell || !selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    if (modalTab === 'BLOCK' && cellForm.blockId) {
      const block = config.combinedBlocks.find(b => b.id === cellForm.blockId);
      if (block) {
        const toInsert: any[] = [];
        const sectionIds = block.sectionIds;
        sectionIds.forEach((sid, idx) => {
          const sect = config.sections.find(s => s.id === sid);
          if (!sect) return;
          const alloc = block.allocations[idx % block.allocations.length];
          toInsert.push({ id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: alloc.subject, subjectCategory: SubjectCategory.CORE, teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '', blockId: block.id, blockName: block.title });
        });
        if (isCloudActive) {
          for (const sid of sectionIds) { await supabase.from(table).delete().match({ section_id: sid, day: editingCell.day, slot_id: editingCell.slotId }); }
          const dbReady = toInsert.map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false }));
          await supabase.from(table).insert(dbReady);
        }
        setCurrentTimetable(prev => [...prev.filter(t => !(sectionIds.includes(t.sectionId) && t.day === editingCell.day && t.slotId === editingCell.slotId)), ...toInsert]);
      }
    } else {
      const targetSection = config.sections.find(s => s.id === selectedTargetId)!;
      const teacher = users.find(u => u.id === cellForm.teacherId);
      const entry: TimeTableEntry = { id: generateUUID(), section: 'PRIMARY', wingId: targetSection.wingId, gradeId: targetSection.gradeId, sectionId: targetSection.id, className: targetSection.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: teacher?.name || 'Unknown', room: cellForm.room, blockId: cellForm.blockId || undefined };
      if (isCloudActive) {
        await supabase.from(table).delete().match({ section_id: entry.sectionId, day: entry.day, slot_id: entry.slotId });
        if (entry.teacherId) { await supabase.from(table).insert({ id: entry.id, section: entry.section, wing_id: entry.wingId, grade_id: entry.gradeId, section_id: entry.sectionId, class_name: entry.className, day: entry.day, slot_id: entry.slotId, subject: entry.subject, subject_category: entry.subjectCategory, teacher_id: entry.teacherId, teacher_name: entry.teacherName, room: entry.room, block_id: entry.blockId, is_substitution: entry.isSubstitution || false }); }
      }
      setCurrentTimetable(prev => [...prev.filter(t => !(t.sectionId === entry.sectionId && t.day === entry.day && t.slotId === entry.slotId)), ...(entry.teacherId ? [entry] : [])]);
    }
    setEditingCell(null); setIsProcessing(false);
  };

  return (
    <div className="flex flex-col h-full space-y-6 animate-in fade-in duration-700 pb-32">
      <div className="flex flex-col md:flex-row justify-between items-center px-2 gap-4">
         <div className="space-y-1">
            <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Scheduling Protocol Active</p>
         </div>
         <div className="flex flex-wrap gap-3 justify-center">
            {isDraftMode && (
               <button onClick={handlePublishMatrix} disabled={isProcessing} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-emerald-700 transition-all border border-emerald-400/20">Publish to Live</button>
            )}
            {isDraftMode && viewMode === 'SECTION' && selectedTargetId && (
              <button onClick={() => setShowAutoFillDialog(true)} disabled={isProcessing} className="bg-sky-500 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-sky-600 transition-all flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                Grade Master Fill
              </button>
            )}
            {isDraftMode && (
              <button onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg transition-all flex items-center gap-2 ${isSwapMode ? 'bg-amber-400 text-[#001f3f]' : 'bg-slate-100 text-slate-400'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                Swap Mode
              </button>
            )}
            {isAdmin && (
               <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800">
                  <button onClick={() => setIsDraftMode(false)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${!isDraftMode ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Live</button>
                  <button onClick={() => setIsDraftMode(true)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${isDraftMode ? 'bg-purple-600 text-white' : 'text-slate-400'}`}>Draft</button>
               </div>
            )}
         </div>
      </div>

      {showAutoFillDialog && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Auto-Fill Configuration</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Initialize Grade-Wide Protocol</p>
              </div>
              
              <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl space-y-6 border border-slate-100 dark:border-slate-700">
                 <div className="flex items-center justify-between">
                    <div className="space-y-1">
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">Ignore Live Matrix</p>
                       <p className="text-[8px] font-bold text-slate-400 uppercase leading-none">Ignore Live Schedule Conflicts</p>
                    </div>
                    <button onClick={() => setIgnoreLive(!ignoreLive)} className={`w-12 h-6 rounded-full p-1 transition-all ${ignoreLive ? 'bg-amber-400' : 'bg-slate-300'}`}>
                       <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all ${ignoreLive ? 'translate-x-6' : ''}`}></div>
                    </button>
                 </div>
                 
                 <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl">
                    <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400 italic leading-relaxed">
                       PROCEEDING WILL OVERWRITE ALL EXISTING DRAFT ENTRIES FOR THIS GRADE.
                    </p>
                 </div>
              </div>

              <div className="flex gap-4">
                 <button onClick={executeGradeAutoFill} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all">Start Fill Engine</button>
                 <button onClick={() => setShowAutoFillDialog(false)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-6 bg-[#001f3f]/98 backdrop-blur-xl">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-12 shadow-2xl space-y-8 animate-in slide-in-from-bottom-8 overflow-hidden flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between">
                 <div>
                    <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Fill Report</h4>
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-2">{report.gradeName} Analytics</p>
                 </div>
                 <div className="bg-emerald-50 text-emerald-600 px-6 py-4 rounded-3xl text-center border border-emerald-100">
                    <p className="text-[8px] font-black uppercase">Fulfillment</p>
                    <p className="text-2xl font-black">{Math.round((report.placed / report.totalRequested) * 100)}%</p>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Requested</p>
                    <p className="text-xl font-black text-[#001f3f] dark:text-white">{report.totalRequested} Slots</p>
                 </div>
                 <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Successfully Placed</p>
                    <p className="text-xl font-black text-emerald-600">{report.placed} Slots</p>
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide space-y-4">
                 <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Constraint Exceptions ({report.skipped.length})</h5>
                 {report.skipped.length > 0 ? report.skipped.map((s, idx) => (
                   <div key={idx} className="p-4 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30 rounded-2xl flex items-center justify-between gap-4">
                      <div>
                         <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{s.teacher}: {s.subject}</p>
                         <p className="text-[9px] font-medium text-rose-600 italic mt-0.5">{s.reason}</p>
                      </div>
                      <div className="shrink-0 w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50"></div>
                   </div>
                 )) : (
                   <div className="py-10 text-center">
                      <p className="text-[10px] font-black text-emerald-500 uppercase italic">100% Efficiency: All loads deployed successfully.</p>
                   </div>
                 )}
              </div>

              <button onClick={() => setReport(null)} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl border border-white/5 active:scale-95">Accept Result</button>
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[600px]">
        <div className="p-4 border-b bg-slate-50/50 dark:bg-slate-800/30 flex flex-col xl:flex-row items-center gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm w-full xl:w-auto">
              <button onClick={() => setViewMode('SECTION')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
              <button onClick={() => setViewMode('TEACHER')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button>
              <button onClick={() => setViewMode('ROOM')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button>
           </div>
           {viewMode === 'SECTION' && (
             <div className="flex gap-2 bg-white dark:bg-slate-950 p-1 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-hide">
               {config.wings.map(w => (
                 <button key={w.id} onClick={() => { setActiveWingId(w.id); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all whitespace-nowrap ${activeWingId === w.id ? 'bg-amber-400 text-[#001f3f]' : 'text-slate-400'}`}>{w.name}</button>
               ))}
             </div>
           )}
           <select className="flex-1 px-5 py-3 rounded-xl border-2 text-[10px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white" value={selectedTargetId} onChange={e => setSelectedTargetId(e.target.value)}>
             <option value="">Select Target Entity...</option>
             {filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse table-fixed min-w-[1000px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr>
                <th className="w-24 p-4 text-[10px] font-black uppercase italic border border-white/10">Day</th>
                {slots.map(s => (
                  <th key={s.id} className="p-3 border border-white/10">
                    <p className="text-[10px] font-black uppercase">{s.label.replace('Period ', 'P')}</p>
                    <p className="text-[7px] opacity-60 font-bold">{s.startTime}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {DAYS.map(day => (
                <tr key={day} className="h-24">
                  <td className="bg-slate-50 dark:bg-slate-800/50 text-[#001f3f] dark:text-amber-400 font-black text-center text-xs uppercase border italic">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td 
                      key={s.id} 
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (isDraftMode && selectedTargetId) setDragOverCell({day, slotId: s.id});
                      }}
                      onDragLeave={() => setDragOverCell(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverCell(null);
                        const sourceData = e.dataTransfer.getData("cell");
                        if (sourceData) {
                          const source = JSON.parse(sourceData);
                          executeMoveOrSwap(source, {day, slotId: s.id});
                        }
                      }}
                      className={`border p-1 relative transition-all ${s.isBreak ? 'bg-amber-50/20' : ''} ${dragOverCell?.day === day && dragOverCell?.slotId === s.id ? 'bg-sky-100/50 ring-2 ring-sky-400 ring-inset' : ''}`}
                    >
                      {s.isBreak ? <div className="text-center text-[8px] font-black text-amber-500 opacity-40 uppercase">Recess</div> : (
                        <div 
                          draggable={isDraftMode && !!selectedTargetId}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("cell", JSON.stringify({day, slotId: s.id}));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => {
                            if (!isDraftMode || !selectedTargetId) return;
                            if (isSwapMode) {
                              if (!swapSource) {
                                setSwapSource({day, slotId: s.id});
                              } else {
                                executeMoveOrSwap(swapSource, {day, slotId: s.id});
                              }
                            } else {
                              setEditingCell({day, slotId: s.id});
                              setModalTab('SINGLE');
                            }
                          }} 
                          className={`h-full min-h-[60px] ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50' : ''} ${swapSource?.day === day && swapSource?.slotId === s.id ? 'ring-4 ring-amber-400 ring-inset animate-pulse bg-amber-50' : ''}`}
                        >
                          {(() => {
                            const entriesInSlot = cellRegistry.get(`${day}-${s.id}`) || [];
                            const activeEntry = entriesInSlot.find(t => {
                              if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
                              if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
                              return t.room === selectedTargetId;
                            });
                            if (!activeEntry) return null;
                            const isBlock = activeEntry.blockId;
                            return (
                              <div className={`h-full p-2 border-2 rounded-lg bg-white shadow-sm flex flex-col justify-center text-center transition-all ${isBlock ? 'border-amber-400 bg-amber-50/20' : 'border-transparent'}`}>
                                <p className={`text-[10px] font-black uppercase truncate ${isBlock ? 'text-amber-600' : 'text-[#001f3f] dark:text-white'}`}>{activeEntry.subject}</p>
                                <p className="text-[8px] font-bold text-slate-500 truncate mt-1">{viewMode === 'TEACHER' ? activeEntry.className : activeEntry.teacherName?.split(' ')[0]}</p>
                                {activeEntry.room && viewMode !== 'ROOM' && <p className="text-[7px] font-black text-amber-500 uppercase mt-0.5">{activeEntry.room}</p>}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingCell && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Edit Slot Assignment</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{editingCell.day} • Period {editingCell.slotId}</p>
              </div>

              <div className="flex p-1.5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                 <button onClick={() => setModalTab('SINGLE')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'SINGLE' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Individual Staff</button>
                 <button onClick={() => setModalTab('BLOCK')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'BLOCK' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Subject Pool</button>
              </div>

              {modalTab === 'SINGLE' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel</label>
                        <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}>
                            <option value="">Vacant / Remove</option>
                            {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                        <input placeholder="e.g. MATH" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})} />
                      </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Room</label>
                        <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}>
                            <option value="">Section Room</option>
                            {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Parallel Block Link</label>
                        <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}>
                            <option value="">None</option>
                            {config.combinedBlocks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                        </select>
                      </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Subject Pool</label>
                     <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl text-xs font-black uppercase border-2 border-transparent focus:border-amber-400 outline-none" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}>
                        <option value="">Select Predefined Pool...</option>
                        {getRelevantBlocks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                     </select>
                  </div>
                  
                  {cellForm.blockId && (
                    <div className="bg-amber-50/50 dark:bg-amber-900/10 p-6 rounded-[2rem] border-2 border-dashed border-amber-200">
                       <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-4">Distribution Logic</p>
                       <div className="space-y-3">
                          <p className="text-[9px] font-bold text-slate-500 uppercase">Impacted Sections:</p>
                          <div className="flex flex-wrap gap-2">
                             {config.combinedBlocks.find(b => b.id === cellForm.blockId)?.sectionIds.map(sid => (
                               <span key={sid} className="px-2 py-1 bg-white dark:bg-slate-800 text-[8px] font-black text-[#001f3f] dark:text-white rounded-lg border border-slate-100">{config.sections.find(s => s.id === sid)?.fullName}</span>
                             ))}
                          </div>
                          <p className="text-[8px] font-medium text-amber-800/70 italic mt-2 leading-relaxed">Committing this pool will automatically update the timetable for all classes listed above simultaneously.</p>
                       </div>
                    </div>
                  )}

                  {!getRelevantBlocks.length && (
                    <div className="text-center py-6 bg-slate-50 rounded-2xl">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">No blocks defined for this grade</p>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-6 flex gap-4">
                 <button onClick={saveCell} disabled={isProcessing || (modalTab === 'BLOCK' && !cellForm.blockId)} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all disabled:opacity-30">
                    {modalTab === 'BLOCK' ? 'Deploy Subject Pool' : 'Commit Slot'}
                 </button>
                 <button onClick={() => setEditingCell(null)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase">Cancel</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

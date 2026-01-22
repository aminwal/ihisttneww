
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

  const logMatrixChange = async (action: string, details: string) => {
    if (!isCloudActive) return;
    try {
      await supabase.from('change_logs').insert({
        id: generateUUID(),
        user_id: user.id,
        user_name: user.name,
        action,
        details,
        timestamp: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
      });
    } catch (e) { console.warn("Audit Log Sync Failed", e); }
  };

  const loadEfficiency = useMemo(() => {
    if (!selectedTargetId) return null;
    if (viewMode === 'TEACHER') {
      const targetAsgns = assignments.filter(a => a.teacherId === selectedTargetId);
      const totalRequired = targetAsgns.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0) + 
                            targetAsgns.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
      const currentlyPlaced = currentTimetable.filter(t => t.teacherId === selectedTargetId).length;
      return { placed: currentlyPlaced, required: totalRequired, label: 'Loads' };
    }
    if (viewMode === 'SECTION') {
       const targetAsgns = assignments.filter(a => a.targetSectionIds?.includes(selectedTargetId));
       const totalRequired = targetAsgns.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0) +
                             targetAsgns.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
       const currentlyPlaced = currentTimetable.filter(t => t.sectionId === selectedTargetId).length;
       return { placed: currentlyPlaced, required: totalRequired, label: 'Periods' };
    }
    return null;
  }, [selectedTargetId, viewMode, assignments, currentTimetable]);

  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    currentTimetable.forEach(entry => {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) registry.set(key, [entry]);
      else registry.get(key)!.push(entry);
    });
    return registry;
  }, [currentTimetable]);

  const getTeacherAvailability = useCallback((day: string, slotId: number) => {
    if (!swapSource || !selectedTargetId) return null;
    const sourceEntries = cellRegistry.get(`${swapSource.day}-${swapSource.slotId}`) || [];
    const activeSource = sourceEntries.find(t => {
      if (viewMode === 'SECTION') return t.sectionId === selectedTargetId;
      if (viewMode === 'TEACHER') return t.teacherId === selectedTargetId;
      return t.room === selectedTargetId;
    });
    if (!activeSource) return null;
    const teacherId = activeSource.teacherId;
    const isBusyLive = timetable.some(t => t.day === day && t.slotId === slotId && !t.date && t.teacherId === teacherId);
    const isBusyCurrent = currentTimetable.some(t => t.day === day && t.slotId === slotId && t.teacherId === teacherId && (!activeSource.blockId || t.blockId !== activeSource.blockId));
    return !(isBusyLive || isBusyCurrent);
  }, [swapSource, selectedTargetId, cellRegistry, viewMode, timetable, currentTimetable]);

  const handlePublishMatrix = () => {
    if (timetableDraft.length === 0) { alert("Institutional Draft is empty."); return; }
    triggerConfirm("RE-DEPLOYMENT PROTOCOL: This will push ALL DRAFT assignments to the LIVE matrix. Proceed?", async () => {
      setIsProcessing(true);
      try {
        if (isCloudActive) {
          const livePayload = timetableDraft.map(e => ({
            id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId,
            class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject,
            subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName,
            room: e.room || null, date: e.date || null, is_substitution: e.isSubstitution || false,
            block_id: e.blockId || null, block_name: e.blockName || null
          }));
          const { error: upsertError } = await supabase.from('timetable_entries').upsert(livePayload, { onConflict: 'id' });
          if (upsertError) throw upsertError;
          const draftIds = timetableDraft.map(d => d.id);
          await supabase.from('timetable_drafts').delete().in('id', draftIds);
        }
        const targetSectionIds = new Set(timetableDraft.map(d => d.sectionId));
        setTimetable(prev => [...prev.filter(t => !targetSectionIds.has(t.sectionId)), ...timetableDraft]);
        setTimetableDraft([]); setIsDraftMode(false);
        logMatrixChange("PUBLISH_LIVE", `Published ${timetableDraft.length} entries for ${targetSectionIds.size} sections.`);
        alert("Institutional Matrix Synchronized Successfully.");
      } catch (err: any) { alert(`PROTOCOL ABORTED: ${err.message}`); } finally { setIsProcessing(false); }
    });
  };

  const executeGradeAutoFill = async () => {
    if (!selectedTargetId || viewMode !== 'SECTION') return;
    const targetSection = config.sections.find(s => s.id === selectedTargetId)!;
    const gradeId = targetSection.gradeId;
    const gradeName = config.grades.find(g => g.id === gradeId)?.name || "Grade";
    setIsProcessing(true); setShowAutoFillDialog(false);
    const sectionsInGrade = config.sections.filter(s => s.gradeId === gradeId);
    const blocksInGrade = (config.combinedBlocks || []).filter(b => b.gradeId === gradeId);
    const gradeAssignments = assignments.filter(a => a.gradeId === gradeId);
    let newDraft: TimeTableEntry[] = [...timetableDraft.filter(t => !sectionsInGrade.some(s => s.id === t.sectionId))];
    const skippedEntries: FillReport['skipped'] = [];
    let totalLoadsCount = 0; let placedCount = 0;

    sectionsInGrade.forEach(sect => {
      const classTeacher = users.find(u => u.classTeacherOf === sect.id);
      if (!classTeacher) return;
      const asgn = gradeAssignments.find(a => a.teacherId === classTeacher.id);
      if (!asgn || !asgn.loads.length) return;
      const primaryLoad = asgn.loads[0];
      const periodsToAnchor = Math.min(primaryLoad.periods, DAYS.length);
      for (let i = 0; i < periodsToAnchor; i++) {
        const day = DAYS[i]; const slotId = 1;
        newDraft.push({ id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day, slotId, subject: primaryLoad.subject, subjectCategory: SubjectCategory.CORE, teacherId: classTeacher.id, teacherName: classTeacher.name, room: primaryLoad.room || `ROOM ${sect.fullName}` });
        placedCount++;
      }
    });

    blocksInGrade.forEach(block => {
      const required = Number(block.weeklyPeriods) || 0;
      totalLoadsCount += (required * block.sectionIds.length);
      if (required === 0) return;
      let deployed = 0;
      const wingSlots = getSlotsForWing(config.grades.find(g => g.id === block.gradeId)?.wingId || '').filter(s => !s.isBreak);
      for (const slot of wingSlots) {
        if (deployed >= required) break;
        for (const day of DAYS) {
          if (deployed >= required) break;
          const teachersFree = block.allocations.every(alloc => {
            const busyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === alloc.teacherId);
            const busyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === alloc.teacherId);
            return !busyDraft && !busyLive;
          });
          const classesFree = block.sectionIds.every(sid => !newDraft.some(t => t.day === day && t.slotId === slot.id && t.sectionId === sid));
          if (teachersFree && classesFree) {
            block.sectionIds.forEach((sid, idx) => {
              const sect = config.sections.find(s => s.id === sid)!;
              const alloc = block.allocations[idx % block.allocations.length];
              newDraft.push({ id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day, slotId: slot.id, subject: alloc.subject, subjectCategory: SubjectCategory.CORE, teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '', blockId: block.id, blockName: block.title });
              placedCount++;
            });
            deployed++;
          }
        }
      }
      if (deployed < required) skippedEntries.push({ teacher: "BLOCK", subject: block.title, reason: `Limited available synchronized slots.` });
    });

    sectionsInGrade.forEach(sect => {
      const sectAssignments = gradeAssignments.filter(a => a.targetSectionIds?.includes(sect.id));
      const wingSlots = getSlotsForWing(sect.wingId).filter(s => !s.isBreak);
      sectAssignments.forEach(asgn => {
        asgn.loads.forEach(load => {
          totalLoadsCount += load.periods;
          let placed = 0;
          for (const slot of wingSlots) {
            if (placed >= load.periods) break;
            for (const day of DAYS) {
              if (placed >= load.periods) break;
              if (newDraft.some(t => t.sectionId === sect.id && t.day === day && t.slotId === slot.id)) continue;
              const tBusyDraft = newDraft.some(t => t.day === day && t.slotId === slot.id && t.teacherId === asgn.teacherId);
              const tBusyLive = !ignoreLive && timetable.some(t => t.day === day && t.slotId === slot.id && !t.date && t.teacherId === asgn.teacherId);
              if (!tBusyDraft && !tBusyLive) {
                newDraft.push({ id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day, slotId: slot.id, subject: load.subject, subjectCategory: SubjectCategory.CORE, teacherId: asgn.teacherId, teacherName: users.find(u => u.id === asgn.teacherId)?.name || 'Unknown', room: load.room || '' });
                placed++; placedCount++;
              }
            }
          }
          if (placed < load.periods) skippedEntries.push({ teacher: users.find(u => u.id === asgn.teacherId)?.name || "Unknown", subject: load.subject, reason: `Only ${placed}/${load.periods} fitted.` });
        });
      });
    });

    setTimetableDraft(newDraft);
    setReport({ gradeName, totalRequested: totalLoadsCount, placed: placedCount, skipped: skippedEntries });
    if (isCloudActive) {
      try {
        const dbReady = newDraft.filter(t => sectionsInGrade.some(s => s.id === t.sectionId)).map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false }));
        const sectionIds = sectionsInGrade.map(s => s.id);
        await supabase.from('timetable_drafts').delete().in('section_id', sectionIds);
        await supabase.from('timetable_drafts').insert(dbReady);
      } catch (err) { console.error("Cloud Sync Failure"); }
    }
    logMatrixChange("AUTO_FILL", `Auto-filled grade ${gradeName}. Success Rate: ${Math.round((placedCount / totalLoadsCount) * 100)}%`);
    setIsProcessing(false);
  };

  const executeMoveOrSwap = async (source: {day: string, slotId: number}, target: {day: string, slotId: number}) => {
    if (source.day === target.day && source.slotId === target.slotId) return;
    if (!selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    const allSrc = cellRegistry.get(`${source.day}-${source.slotId}`) || [];
    const allTgt = cellRegistry.get(`${target.day}-${target.slotId}`) || [];
    const activeSrc = allSrc.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
    if (!activeSrc) { setIsProcessing(false); return; }
    let toMove: TimeTableEntry[] = activeSrc.blockId ? allSrc.filter(t => t.blockId === activeSrc.blockId) : [activeSrc];
    const updatedMove = toMove.map(s => ({ ...s, day: target.day, slotId: target.slotId, id: generateUUID() }));
    if (isCloudActive) {
      try {
        const invSects = Array.from(new Set(toMove.map(i => i.sectionId)));
        for (const sid of invSects) { 
          await supabase.from(table).delete().match({ section_id: sid, day: source.day, slot_id: source.slotId }); 
          await supabase.from(table).delete().match({ section_id: sid, day: target.day, slot_id: target.slotId });
        }
        await supabase.from(table).insert(updatedMove.map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false })));
      } catch (err) { console.error("Cloud displacement failed"); }
    }
    setCurrentTimetable(prev => [...prev.filter(t => !toMove.some(m => m.id === t.id)), ...updatedMove]);
    logMatrixChange("SWAP_MOVE", `Moved ${activeSrc.subject} for ${activeSrc.className} from ${source.day} P${source.slotId} to ${target.day} P${target.slotId}`);
    setIsProcessing(false); setSwapSource(null);
  };

  const saveCell = async () => {
    if (!editingCell || !selectedTargetId) return;
    setIsProcessing(true);
    const table = isDraftMode ? 'timetable_drafts' : 'timetable_entries';
    if (modalTab === 'BLOCK' && cellForm.blockId) {
      const block = config.combinedBlocks.find(b => b.id === cellForm.blockId);
      if (block) {
        const toInsert = block.sectionIds.map((sid, idx) => {
          const sect = config.sections.find(s => s.id === sid)!;
          const alloc = block.allocations[idx % block.allocations.length];
          return { id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: alloc.subject, subjectCategory: SubjectCategory.CORE, teacherId: alloc.teacherId, teacherName: alloc.teacherName, room: alloc.room || '', blockId: block.id, blockName: block.title } as TimeTableEntry;
        });
        if (isCloudActive) {
          for (const sid of block.sectionIds) await supabase.from(table).delete().match({ section_id: sid, day: editingCell.day, slot_id: editingCell.slotId });
          await supabase.from(table).insert(toInsert.map(e => ({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, block_name: e.blockName, is_substitution: false })));
        }
        setCurrentTimetable(prev => [...prev.filter(t => !(block.sectionIds.includes(t.sectionId) && t.day === editingCell.day && t.slotId === editingCell.slotId)), ...toInsert]);
        logMatrixChange("SAVE_BLOCK", `Deployed pool ${block.title} at ${editingCell.day} P${editingCell.slotId}.`);
      }
    } else {
      const sect = config.sections.find(s => s.id === selectedTargetId)!;
      const t = users.find(u => u.id === cellForm.teacherId);
      const e: TimeTableEntry = { id: generateUUID(), section: 'PRIMARY', wingId: sect.wingId, gradeId: sect.gradeId, sectionId: sect.id, className: sect.fullName, day: editingCell.day, slotId: editingCell.slotId, subject: cellForm.subject.toUpperCase(), subjectCategory: SubjectCategory.CORE, teacherId: cellForm.teacherId, teacherName: t?.name || 'Unknown', room: cellForm.room, blockId: cellForm.blockId || undefined };
      if (isCloudActive) {
        await supabase.from(table).delete().match({ section_id: e.sectionId, day: e.day, slot_id: e.slotId });
        if (e.teacherId) await supabase.from(table).insert({ id: e.id, section: e.section, wing_id: e.wingId, grade_id: e.gradeId, section_id: e.sectionId, class_name: e.className, day: e.day, slot_id: e.slotId, subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, teacher_name: e.teacherName, room: e.room, block_id: e.blockId, is_substitution: false });
      }
      setCurrentTimetable(prev => [...prev.filter(t => !(t.sectionId === e.sectionId && t.day === e.day && t.slotId === e.slotId)), ...(e.teacherId ? [e] : [])]);
      logMatrixChange("SAVE_CELL", `Manual edit: ${e.className} ${e.day} P${e.slotId} assigned to ${e.teacherName}.`);
    }
    setEditingCell(null); setIsProcessing(false);
  };

  return (
    <div className={`flex flex-col h-full space-y-6 animate-in fade-in duration-700 pb-32 ${isDraftMode ? 'bg-indigo-50/20 dark:bg-indigo-900/5 rounded-3xl ring-1 ring-indigo-500/20 shadow-inner' : ''}`}>
      <div className="flex flex-col md:flex-row justify-between items-center px-4 gap-4 py-4">
         <div className="space-y-1">
            <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Matrix <span className="text-[#d4af37]">Control</span></h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Scheduling Protocol Active {isDraftMode && '• SANDBOX ENABLED'}</p>
         </div>
         <div className="flex flex-wrap gap-3 justify-center">
            {isDraftMode && (<button onClick={handlePublishMatrix} disabled={isProcessing} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-emerald-700 border border-emerald-400/20">Publish to Live</button>)}
            {isDraftMode && viewMode === 'SECTION' && selectedTargetId && (<button onClick={() => setShowAutoFillDialog(true)} disabled={isProcessing} className="bg-sky-500 text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-sky-600 flex items-center gap-2"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Grade Master Fill</button>)}
            {isDraftMode && (<button onClick={() => { setIsSwapMode(!isSwapMode); setSwapSource(null); }} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg flex items-center gap-2 ${isSwapMode ? 'bg-amber-400 text-[#001f3f]' : 'bg-slate-100 text-slate-400'}`}><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>{isSwapMode ? 'Cancel Swap' : 'Swap Mode'}</button>)}
            {isAdmin && (<div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-800"><button onClick={() => setIsDraftMode(false)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${!isDraftMode ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Live</button><button onClick={() => setIsDraftMode(true)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase ${isDraftMode ? 'bg-purple-600 text-white' : 'text-slate-400'}`}>Draft</button></div>)}
         </div>
      </div>

      {showAutoFillDialog && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Auto-Fill Protocol</h4><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Initialize Grade-Wide Matrix Fill</p></div>
              <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl space-y-6 border border-slate-100 dark:border-slate-700">
                 <div className="flex items-center justify-between"><div className="space-y-1"><p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">Ignore Live Matrix</p></div><button onClick={() => setIgnoreLive(!ignoreLive)} className={`w-12 h-6 rounded-full p-1 transition-all ${ignoreLive ? 'bg-amber-400' : 'bg-slate-300'}`}><div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all ${ignoreLive ? 'translate-x-6' : ''}`}></div></button></div>
                 {(() => {
                    const gx = config.sections.find(sx => sx.id === selectedTargetId)?.gradeId;
                    const gradeSects = config.sections.filter(s => s.gradeId === gx);
                    const cap = gradeSects.length * slots.length * DAYS.length;
                    const lod = assignments.filter(a => gradeSects.some(s => a.targetSectionIds?.includes(s.id))).reduce((sum, a) => sum + a.loads.reduce((s, l) => s + l.periods, 0), 0);
                    if (lod > cap) return <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 rounded-2xl"><p className="text-[9px] font-black text-rose-600 uppercase mb-1">Overload Warning</p><p className="text-[8px] text-rose-500 italic">Grade loads ({lod}) exceed capacity ({cap}).</p></div>;
                    return null;
                 })()}
                 <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 rounded-2xl"><p className="text-[9px] font-bold text-amber-700 dark:text-amber-400 italic">DRAFT ENTRIES FOR THIS GRADE WILL BE OVERWRITTEN.</p></div>
              </div>
              <div className="flex gap-4"><button onClick={executeGradeAutoFill} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all">Start Fill Engine</button><button onClick={() => setShowAutoFillDialog(false)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase">Cancel</button></div>
           </div>
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-6 bg-[#001f3f]/98 backdrop-blur-xl">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-12 shadow-2xl space-y-8 animate-in slide-in-from-bottom-8 flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between"><div><h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Fill Report</h4><p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-2">{report.gradeName} Analysis</p></div><div className="bg-emerald-50 text-emerald-600 px-6 py-4 rounded-3xl text-center border border-emerald-100"><p className="text-[8px] font-black uppercase">Efficiency</p><p className="text-2xl font-black">{Math.round((report.placed / report.totalRequested) * 100)}%</p></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl"><p className="text-[9px] font-black text-slate-400 uppercase mb-1">Requested</p><p className="text-xl font-black text-[#001f3f] dark:text-white">{report.totalRequested} P</p></div><div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl"><p className="text-[9px] font-black text-slate-400 uppercase mb-1">Deployed</p><p className="text-xl font-black text-emerald-600">{report.placed} P</p></div></div>
              <div className="flex-1 overflow-y-auto scrollbar-hide space-y-4"><h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Exceptions ({report.skipped.length})</h5>{report.skipped.map((s, idx) => (<div key={idx} className="p-4 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 rounded-2xl flex items-center justify-between gap-4"><div><p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{s.teacher}: {s.subject}</p><p className="text-[9px] text-rose-600 italic mt-0.5">{s.reason}</p></div><div className="shrink-0 w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50"></div></div>))}</div>
              <button onClick={() => setReport(null)} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all">Accept Results</button>
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[600px] mx-4 mb-8">
        <div className="p-4 border-b bg-slate-50/50 dark:bg-slate-800/30 flex flex-col xl:flex-row items-center gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm w-full xl:w-auto"><button onClick={() => setViewMode('SECTION')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'SECTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button><button onClick={() => setViewMode('TEACHER')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff</button><button onClick={() => setViewMode('ROOM')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === 'ROOM' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Room</button></div>
           {viewMode === 'SECTION' && (<div className="flex gap-2 bg-white dark:bg-slate-950 p-1 rounded-xl shadow-sm border border-slate-100 overflow-x-auto scrollbar-hide">{config.wings.map(w => (<button key={w.id} onClick={() => { setActiveWingId(w.id); setSelectedTargetId(''); }} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all whitespace-nowrap ${activeWingId === w.id ? 'bg-amber-400 text-[#001f3f]' : 'text-slate-400'}`}>{w.name}</button>))}</div>)}
           <div className="flex-1 flex items-center gap-3">
              <select className="flex-1 px-5 py-3 rounded-xl border-2 text-[10px] font-black uppercase outline-none dark:bg-slate-950 dark:text-white" value={selectedTargetId} onChange={e => setSelectedTargetId(e.target.value)}><option value="">Select Target Entity...</option>{filteredEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              {loadEfficiency && (<div className="hidden md:flex flex-col items-end px-4 border-l"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{loadEfficiency.label}</p><p className="text-xs font-black text-[#001f3f] dark:text-[#d4af37] italic">{loadEfficiency.placed} / {loadEfficiency.required}</p><div className="w-16 h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden"><div style={{ width: `${Math.min(100, (loadEfficiency.placed / loadEfficiency.required) * 100)}%` }} className="h-full bg-emerald-500"></div></div></div>)}
           </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse table-fixed min-w-[1000px]">
            <thead className="bg-[#001f3f] text-white sticky top-0 z-50">
              <tr><th className="w-24 p-4 text-[10px] font-black uppercase italic border border-white/10 sticky left-0 z-[60] bg-[#001f3f]">Day</th>{slots.map(s => (<th key={s.id} className="p-3 border border-white/10"><p className="text-[10px] font-black uppercase">{s.label.replace('Period ', 'P')}</p><p className="text-[7px] opacity-60 font-bold">{s.startTime}</p></th>))}</tr>
            </thead>
            <tbody className="divide-y">
              {DAYS.map(day => (
                <tr key={day} className="h-24">
                  <td className="bg-slate-50 dark:bg-slate-800/80 text-[#001f3f] dark:text-amber-400 font-black text-center text-xs uppercase border italic sticky left-0 z-30 shadow-md">{day.substring(0,3)}</td>
                  {slots.map(s => {
                    const avail = isSwapMode && swapSource ? getTeacherAvailability(day, s.id) : null;
                    const hmc = avail === true ? 'bg-emerald-500/10' : avail === false ? 'bg-rose-500/10' : '';
                    return (
                      <td key={s.id} onDragOver={(e) => { e.preventDefault(); if (isDraftMode && selectedTargetId) setDragOverCell({day, slotId: s.id}); }} onDragLeave={() => setDragOverCell(null)} onDrop={(e) => { e.preventDefault(); setDragOverCell(null); const sd = e.dataTransfer.getData("cell"); if (sd) executeMoveOrSwap(JSON.parse(sd), {day, slotId: s.id}); }} className={`border p-1 relative transition-all ${s.isBreak ? 'bg-amber-50/20' : ''} ${hmc} ${dragOverCell?.day === day && dragOverCell?.slotId === s.id ? 'bg-sky-100/50 ring-2 ring-sky-400 ring-inset' : ''}`}>
                        {s.isBreak ? <div className="text-center text-[8px] font-black text-amber-500 opacity-40 uppercase">Recess</div> : (
                          <div draggable={isDraftMode && !!selectedTargetId} onDragStart={(e) => { e.dataTransfer.setData("cell", JSON.stringify({day, slotId: s.id})); e.dataTransfer.effectAllowed = "move"; }} onClick={() => { if (!isDraftMode || !selectedTargetId) return; if (isSwapMode) { if (!swapSource) setSwapSource({day, slotId: s.id}); else executeMoveOrSwap(swapSource, {day, slotId: s.id}); } else { setEditingCell({day, slotId: s.id}); setModalTab('SINGLE'); } }} className={`h-full min-h-[60px] ${isDraftMode && selectedTargetId ? 'cursor-pointer hover:bg-slate-50' : ''} ${swapSource?.day === day && swapSource?.slotId === s.id ? 'ring-4 ring-amber-400 ring-inset animate-pulse bg-amber-50' : ''}`}>
                            {(() => {
                              const ents = cellRegistry.get(`${day}-${s.id}`) || [];
                              let act = ents.find(t => (viewMode === 'SECTION' ? t.sectionId === selectedTargetId : viewMode === 'TEACHER' ? t.teacherId === selectedTargetId : t.room === selectedTargetId));
                              let prox: SubstitutionRecord | undefined = undefined;
                              if (!isDraftMode && selectedTargetId) {
                                prox = substitutions.find(sub => {
                                  const sd = new Date(sub.date).toLocaleDateString('en-US', { weekday: 'long' });
                                  if (sd !== day || sub.isArchived) return false;
                                  if (viewMode === 'SECTION' && sub.sectionId === selectedTargetId && sub.slotId === s.id) return true;
                                  if (viewMode === 'TEACHER' && sub.substituteTeacherId === selectedTargetId && sub.slotId === s.id) return true;
                                  if (viewMode === 'ROOM') {
                                    const od = timetable.find(t => t.day === day && t.slotId === s.id && t.teacherId === sub.absentTeacherId && !t.date);
                                    const subStaff = users.find(u => u.id === sub.substituteTeacherId);
                                    const subHome = subStaff?.classTeacherOf ? config.sections.find(sx => sx.id === subStaff.classTeacherOf) : null;
                                    const subRoom = subHome ? `ROOM ${subHome.fullName}` : null;
                                    return (subRoom === selectedTargetId) || (od?.room === selectedTargetId);
                                  }
                                  return false;
                                });
                              }
                              if (prox) return <div className="h-full p-2 border-2 border-amber-400 bg-amber-50/20 rounded-lg shadow-inner flex flex-col justify-center text-center relative overflow-hidden group/proxy"><div className="absolute top-0 left-0 right-0 bg-amber-400 py-0.5"><p className="text-[6px] font-black text-[#001f3f] uppercase tracking-widest">LIVE PROXY</p></div><p className="text-[10px] font-black uppercase text-amber-700 truncate mt-1">{prox.subject}</p><p className="text-[8px] font-bold text-slate-500 truncate">{viewMode === 'TEACHER' ? prox.className : `Sub: ${prox.substituteTeacherName.split(' ')[0]}`}</p></div>;
                              if (!act) return null;
                              return <div className={`h-full p-2 border-2 rounded-lg bg-white shadow-sm flex flex-col justify-center text-center transition-all ${act.blockId ? 'border-amber-400 bg-amber-50/20' : 'border-transparent'}`}><p className={`text-[10px] font-black uppercase truncate ${act.blockId ? 'text-amber-600' : 'text-[#001f3f] dark:text-white'}`}>{act.subject}</p><p className="text-[8px] font-bold text-slate-500 truncate mt-1">{viewMode === 'TEACHER' ? act.className : act.teacherName?.split(' ')[0]}</p></div>;
                            })()}
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

      {editingCell && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Edit Slot</h4><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{editingCell.day} • Period {editingCell.slotId}</p></div>
              <div className="flex p-1.5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700"><button onClick={() => setModalTab('SINGLE')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'SINGLE' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Individual Staff</button><button onClick={() => setModalTab('BLOCK')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${modalTab === 'BLOCK' ? 'bg-[#001f3f] text-[#d4af37] shadow-lg' : 'text-slate-400'}`}>Subject Pool</button></div>
              {modalTab === 'SINGLE' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.teacherId} onChange={e => setCellForm({...cellForm, teacherId: e.target.value})}><option value="">Vacant / Remove</option>{users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label><input placeholder="e.g. MATH" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.subject} onChange={e => setCellForm({...cellForm, subject: e.target.value})} /></div></div>
                  <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Room</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.room} onChange={e => setCellForm({...cellForm, room: e.target.value})}><option value="">Section Room</option>{config.rooms.map(r => <option key={r} value={r}>{r}</option>)}</select></div><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Block Link</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}><option value="">None</option>{config.combinedBlocks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></div></div>
                </div>
              ) : (
                <div className="space-y-6"><div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Pool</label><select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl text-xs font-black uppercase outline-none" value={cellForm.blockId} onChange={e => setCellForm({...cellForm, blockId: e.target.value})}><option value="">Select Pool...</option>{(config.combinedBlocks || []).filter(b => b.gradeId === config.sections.find(s => s.id === selectedTargetId)?.gradeId).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></div></div>
              )}
              <div className="pt-6 flex gap-4"><button onClick={saveCell} disabled={isProcessing || (modalTab === 'BLOCK' && !cellForm.blockId)} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all disabled:opacity-30">{modalTab === 'BLOCK' ? 'Deploy Pool' : 'Commit Slot'}</button><button onClick={() => setEditingCell(null)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-xs uppercase">Cancel</button></div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

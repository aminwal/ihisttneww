import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SectionType, TeacherAssignment, SchoolConfig, CombinedBlock, SchoolNotification, SubstitutionRecord, SubjectCategory, TimeSlot } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { NotificationService } from '../services/notificationService.ts';
import { GoogleGenAI } from "@google/genai";

const MAX_TOTAL_WEEKLY_LOAD = 35;

interface SubstitutionViewProps {
  user: User;
  users: User[];
  attendance: AttendanceRecord[];
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  substitutions: SubstitutionRecord[];
  setSubstitutions: React.Dispatch<React.SetStateAction<SubstitutionRecord[]>>;
  assignments: TeacherAssignment[];
  config: SchoolConfig;
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
}

const SubstitutionView: React.FC<SubstitutionViewProps> = ({ user, users, attendance, timetable, setTimetable, substitutions, setSubstitutions, assignments, config, setNotifications }) => {
  const [activeSection, setActiveSection] = useState<SectionType>(() => {
    const saved = localStorage.getItem('ihis_cached_section');
    return (saved as SectionType) || 'PRIMARY';
  });

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info', message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSmartProxyLoading, setIsSmartProxyLoading] = useState(false);
  
  const [manualAssignTarget, setManualAssignTarget] = useState<SubstitutionRecord | null>(null);
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);

  const isAdmin = user.role === UserRole.ADMIN;
  const isManagement = isAdmin || user.role.startsWith('INCHARGE_');
  const isCloudActive = IS_CLOUD_ENABLED;

  // Helper to get slots based on current section
  const getAvailableSlotsForSection = useCallback((section: SectionType) => {
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section.includes('GIRLS')) return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, []);

  // Helper to get descriptive label for a specific Physical Slot ID and Section
  const getSlotLabel = useCallback((slotId: number, section: SectionType) => {
    const wingSlots = getAvailableSlotsForSection(section);
    const slot = wingSlots.find(s => s.id === slotId);
    if (!slot) return `P${slotId}`;
    return slot.label.replace('Period ', 'P');
  }, [getAvailableSlotsForSection]);

  const currentSectionSlots = useMemo(() => 
    getAvailableSlotsForSection(activeSection).filter(s => !s.isBreak),
  [activeSection, getAvailableSlotsForSection]);

  const [newEntry, setNewEntry] = useState({
    absentTeacherId: '',
    className: '',
    subject: '',
    slotId: 1,
    section: activeSection
  });

  useEffect(() => {
    localStorage.setItem('ihis_cached_section', activeSection);
    // When section changes, reset the slot to the first valid one for that section
    const validSlots = getAvailableSlotsForSection(activeSection).filter(s => !s.isBreak);
    setNewEntry(prev => ({ 
      ...prev, 
      section: activeSection,
      slotId: validSlots[0]?.id || 1
    }));
  }, [activeSection, getAvailableSlotsForSection]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getWeekRange = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); 
    const sunday = new Date(date);
    sunday.setDate(date.getDate() - dayOfWeek);
    const thursday = new Date(sunday);
    thursday.setDate(sunday.getDate() + 4);
    return { start: sunday.toISOString().split('T')[0], end: thursday.toISOString().split('T')[0] };
  }, []);

  const getTeacherLoadBreakdown = useCallback((teacherId: string, dateStr: string, currentSubs: SubstitutionRecord[] = substitutions) => {
    const { start, end } = getWeekRange(dateStr);
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    
    const baseLoad = teacherAssignments.reduce((sum, a) => 
      sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0
    );
    const groupLoad = teacherAssignments.reduce((sum, a) => sum + (a.groupPeriods || 0), 0);
    
    const proxyLoad = currentSubs.reduce((count, s) => {
      if (s.substituteTeacherId === teacherId && s.date >= start && s.date <= end && !s.isArchived) {
        return count + 1;
      }
      return count;
    }, 0);

    const total = baseLoad + groupLoad + proxyLoad;
    return { base: baseLoad, groups: groupLoad, proxy: proxyLoad, total: total, remaining: Math.max(0, MAX_TOTAL_WEEKLY_LOAD - total) };
  }, [assignments, substitutions, getWeekRange]);

  const busyTeacherRegistry = useCallback((slotId: number, dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const busySet = new Set<string>();

    for (const t of timetable) {
      if (t.day === dayName && t.slotId === slotId && (!t.date || t.date === dateStr)) {
        if (t.teacherId && t.teacherId !== 'BLOCK_RESOURCE') busySet.add(t.teacherId);
        if (t.blockId) config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.forEach(a => busySet.add(a.teacherId));
      }
    }
    for (const s of substitutions) {
      if (s.date === dateStr && s.slotId === slotId && !s.isArchived && s.substituteTeacherId) busySet.add(s.substituteTeacherId);
    }
    return busySet;
  }, [timetable, substitutions, config.combinedBlocks]);

  const isTeacherAvailable = useCallback((teacherId: string, slotId: number, dateStr: string) => {
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    const busy = busyTeacherRegistry(slotId, dateStr);
    return !busy.has(teacherId);
  }, [attendance, busyTeacherRegistry]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    const allRoles = [u.role, ...(u.secondaryRoles || [])];
    const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    const isSecondary = allRoles.some(r => r.includes('SECONDARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    if (section === 'PRIMARY') return isPrimary;
    return isSecondary;
  }, []);

  const filteredSubs = useMemo(() => {
    const dateFiltered = substitutions.filter(s => s.date === selectedDate && !s.isArchived);
    if (isManagement) return dateFiltered.filter(s => s.section === activeSection);
    return dateFiltered.filter(s => s.substituteTeacherId === user.id);
  }, [substitutions, selectedDate, isManagement, activeSection, user.id]);

  const handleScanForAbsentees = async () => {
    setIsProcessing(true);
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const absentees = users.filter(u => {
      if (u.isResigned || u.role === UserRole.ADMIN) return false;
      const att = attendance.find(a => a.userId === u.id && a.date === selectedDate);
      return !att || att.checkIn === 'MEDICAL';
    });
    
    if (absentees.length === 0) {
      setStatus({ type: 'info', message: "Attendance scan complete: No absentees detected." });
      setIsProcessing(false);
      return;
    }

    let newRegistries: SubstitutionRecord[] = [];
    absentees.forEach(teacher => {
      const duties = timetable.filter(t => {
        if (t.day !== dayName || !!t.date) return false;
        if (t.teacherId === teacher.id) return true;
        if (t.blockId) return config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === teacher.id);
        return false;
      });
      
      duties.forEach(duty => {
        const exists = substitutions.some(s => 
          s.date === selectedDate && 
          s.absentTeacherId === teacher.id && 
          s.slotId === duty.slotId && 
          s.className === duty.className
        );
        
        if (!exists) {
           newRegistries.push({ 
             id: `auto-${generateUUID()}`, 
             date: selectedDate, 
             slotId: duty.slotId, 
             className: duty.className, 
             subject: duty.subject, 
             absentTeacherId: teacher.id, 
             absentTeacherName: teacher.name, 
             substituteTeacherId: '', 
             substituteTeacherName: 'PENDING ASSIGNMENT', 
             section: duty.section 
           });
        }
      });
    });

    if (newRegistries.length === 0) {
      setStatus({ type: 'info', message: `Identified ${absentees.length} absentees, but no scheduled duties found on ${dayName}.` });
      setIsProcessing(false);
      return;
    }

    if (newRegistries.length > 0 && isCloudActive) {
      const payload = newRegistries.map(r => ({
        id: r.id, 
        date: r.date, 
        slot_id: r.slotId, 
        class_name: r.className, 
        subject: r.subject,
        absent_teacher_id: r.absentTeacherId, 
        absent_teacher_name: r.absentTeacherName,
        substitute_teacher_id: r.substituteTeacherId || '', 
        substitute_teacher_name: r.substituteTeacherName || 'PENDING ASSIGNMENT',
        section: r.section, 
        is_archived: false
      }));
      await supabase.from('substitution_ledger').upsert(payload);
    }
    
    setSubstitutions(prev => [...newRegistries, ...prev]);
    setStatus({ type: 'success', message: `Scan successful: ${newRegistries.length} proxy slots identified.` });
    setIsProcessing(false);
  };

  const handleArchiveMatrix = async () => {
    if (!confirm("This will archive all active substitutions for the selected date and wing. Proceed?")) return;
    setIsProcessing(true);
    try {
      const targets = substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived);
      if (targets.length === 0) {
        setStatus({ type: 'warning', message: "No active records found for archival." });
        setIsProcessing(false);
        return;
      }

      if (isCloudActive) {
        const { error } = await supabase
          .from('substitution_ledger')
          .update({ is_archived: true })
          .in('id', targets.map(t => t.id));
        if (error) throw error;
      }

      setSubstitutions(prev => prev.map(s => 
        (s.date === selectedDate && s.section === activeSection) ? { ...s, isArchived: true } : s
      ));
      setStatus({ type: 'success', message: `Archived ${targets.length} records.` });
    } catch (e: any) {
      setStatus({ type: 'error', message: `Archival Failed: ${e.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSubstitution = async (subId: string) => {
    if (!window.confirm("CRITICAL ACTION: This will permanently delete the selected proxy duty record. This cannot be undone. Proceed?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive) {
        const { error: ledgerError } = await supabase.from('substitution_ledger').delete().eq('id', subId);
        if (ledgerError) throw ledgerError;
        await supabase.from('timetable_entries').delete().eq('id', `sub-entry-${subId}`);
      }

      setSubstitutions(prev => prev.filter(s => s.id !== subId));
      setTimetable(prev => prev.filter(t => t.id !== `sub-entry-${subId}`));
      setStatus({ type: 'success', message: "Record successfully purged from registry." });
    } catch (e: any) {
      setStatus({ type: 'error', message: `Purge Failure: ${e.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const commitSubstitution = async (subId: string, teacher: User) => {
    setIsProcessing(true);
    try {
      const subRecord = substitutions.find(s => s.id === subId);
      if (!subRecord) throw new Error("Registry record missing.");

      const [year, month, day] = selectedDate.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

      const newTimetableEntry: TimeTableEntry = {
        id: `sub-entry-${subId}`,
        section: subRecord.section,
        className: subRecord.className,
        day: dayName,
        slotId: subRecord.slotId,
        subject: subRecord.subject,
        subjectCategory: SubjectCategory.CORE,
        teacherId: teacher.id,
        teacherName: teacher.name,
        date: selectedDate,
        isSubstitution: true
      };

      if (isCloudActive) {
        const { error: subErr } = await supabase.from('substitution_ledger').upsert({
          id: subRecord.id,
          date: subRecord.date,
          slot_id: subRecord.slotId,
          class_name: subRecord.className,
          subject: subRecord.subject,
          absent_teacher_id: subRecord.absentTeacherId,
          absent_teacher_name: subRecord.absentTeacherName,
          substitute_teacher_id: teacher.id,
          substitute_teacher_name: teacher.name,
          section: subRecord.section,
          is_archived: false
        });
        if (subErr) throw subErr;

        const { error: ttErr } = await supabase.from('timetable_entries').upsert({
          id: newTimetableEntry.id,
          section: newTimetableEntry.section,
          class_name: newTimetableEntry.className,
          day: newTimetableEntry.day,
          slot_id: newTimetableEntry.slotId,
          subject: newTimetableEntry.subject,
          subject_category: newTimetableEntry.subjectCategory,
          teacher_id: newTimetableEntry.teacherId,
          teacher_name: newTimetableEntry.teacherName,
          date: newTimetableEntry.date,
          is_substitution: true
        });
        if (ttErr) throw ttErr;
      }

      // Sync local UI states immediately
      setSubstitutions(prev => prev.map(s => s.id === subId ? { ...s, substituteTeacherId: teacher.id, substituteTeacherName: teacher.name } : s));
      setTimetable(prev => {
        const filtered = prev.filter(t => t.id !== newTimetableEntry.id);
        return [...filtered, newTimetableEntry];
      });

      setStatus({ type: 'success', message: `Deployed ${teacher.name} to ${subRecord.className}` });
      setManualAssignTarget(null);
    } catch (e: any) { 
      setStatus({ type: 'error', message: `Operational Failure: ${e.message}` }); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const handleManualEntrySubmit = async () => {
    if (!newEntry.absentTeacherId || !newEntry.className || !newEntry.subject) {
      setStatus({ type: 'error', message: "Registry parameters incomplete." });
      return;
    }
    setIsProcessing(true);
    const absentTeacher = users.find(u => u.id === newEntry.absentTeacherId);
    const subRecord: SubstitutionRecord = {
      id: `manual-${generateUUID()}`,
      date: selectedDate,
      slotId: newEntry.slotId,
      className: newEntry.className,
      subject: newEntry.subject,
      absentTeacherId: newEntry.absentTeacherId,
      absentTeacherName: absentTeacher?.name || 'Unknown',
      substituteTeacherId: '',
      substituteTeacherName: 'PENDING ASSIGNMENT',
      section: newEntry.section
    };

    if (isCloudActive) {
      await supabase.from('substitution_ledger').insert({
        id: subRecord.id,
        date: subRecord.date,
        slot_id: subRecord.slotId,
        class_name: subRecord.className,
        subject: subRecord.subject,
        absent_teacher_id: subRecord.absentTeacherId,
        absent_teacher_name: subRecord.absentTeacherName,
        substitute_teacher_id: '',
        substitute_teacher_name: 'PENDING ASSIGNMENT',
        section: subRecord.section,
        is_archived: false
      });
    }
    setSubstitutions(prev => [subRecord, ...prev]);
    setIsNewEntryModalOpen(false);
    setIsProcessing(false);
    setStatus({ type: 'success', message: "Manual duty logged." });
  };

  const handleSmartProxy = async () => {
    const pendings = filteredSubs.filter(s => !s.substituteTeacherId);
    if (pendings.length === 0) {
      setStatus({ type: 'info', message: "All active slots are currently deployed." });
      return;
    }

    setIsSmartProxyLoading(true);
    try {
      const availableStaff = users
        .filter(u => u.role !== UserRole.ADMIN && !u.isResigned && isTeacherEligibleForSection(u, activeSection))
        .map(u => ({
          id: u.id,
          name: u.name,
          load: getTeacherLoadBreakdown(u.id, selectedDate).total,
          present: !!attendance.find(a => a.userId === u.id && a.date === selectedDate && a.checkIn !== 'MEDICAL')
        }))
        .filter(u => u.present);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Task: Academic Proxy Optimization for IHIS School. Date: ${selectedDate}, Section: ${activeSection}. PENDING DUTIES: ${pendings.map(p => `Slot P${p.slotId}, Class ${p.className}, Sub: ${p.subject}`).join('\n')} AVAILABLE STAFF: ${availableStaff.map(s => `${s.name} (ID: ${s.id}, Weekly Load: ${s.load})`).join('\n')} Rules: Return ONLY a JSON array of mappings: [{"subId": "...", "teacherId": "...", "teacherName": "..."}]`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const mappings = JSON.parse(response.text || '[]');
      let count = 0;
      for (const map of mappings) {
        const teacher = users.find(u => u.id === map.teacherId);
        if (teacher) {
          await commitSubstitution(map.subId, teacher);
          count++;
        }
      }
      setStatus({ type: 'success', message: `AI Intelligence: ${count} proxies successfully deployed.` });
    } catch (e: any) {
      setStatus({ type: 'error', message: "Smart Proxy matrix error." });
    } finally {
      setIsSmartProxyLoading(false);
    }
  };

  const deploymentCandidates = useMemo(() => {
    if (!manualAssignTarget) return [];
    return users
      .filter(u => u.id !== manualAssignTarget.absentTeacherId && !u.isResigned && isTeacherEligibleForSection(u, manualAssignTarget.section) && u.role !== UserRole.ADMIN)
      .map(teacher => ({ 
        teacher, 
        load: getTeacherLoadBreakdown(teacher.id, selectedDate), 
        available: isTeacherAvailable(teacher.id, manualAssignTarget.slotId, selectedDate) 
      }))
      .sort((a, b) => (a.available === b.available) ? (a.load.total - b.load.total) : (a.available ? -1 : 1));
  }, [manualAssignTarget, users, selectedDate, isTeacherEligibleForSection, isTeacherAvailable, getTeacherLoadBreakdown]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-1 md:px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print px-2">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Substitution Ledger</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Faculty Deployment Matrix</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManagement && (
            <>
              <button onClick={handleSmartProxy} disabled={isSmartProxyLoading} className="flex-1 md:flex-none bg-gradient-to-r from-amber-400 to-amber-500 text-[#001f3f] px-5 py-3 md:py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:scale-105 transition-all border border-white/20 flex items-center justify-center gap-2">
                <svg className={`w-4 h-4 ${isSmartProxyLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                {isSmartProxyLoading ? 'Thinking...' : 'Smart Proxy'}
              </button>
              <button onClick={() => setIsNewEntryModalOpen(true)} className="flex-1 md:flex-none bg-white dark:bg-slate-800 text-[#001f3f] dark:text-white px-5 py-3 md:py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-md border border-slate-200 dark:border-slate-700 transition-all hover:bg-slate-50 active:scale-95">Log Manual</button>
              <button onClick={handleScanForAbsentees} disabled={isProcessing} className="flex-1 md:flex-none bg-indigo-600 text-white px-5 py-3 md:py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-indigo-700 transition-all border border-white/10 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                Auto-Scan
              </button>
              <button onClick={handleArchiveMatrix} className="flex-1 md:flex-none bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-5 py-3 md:py-2.5 rounded-2xl text-[10px] font-black uppercase transition-all hover:bg-rose-50 hover:text-rose-500 active:scale-95">Archive Matrix</button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-4 md:p-8 border-b border-gray-100 dark:border-slate-800 flex flex-col lg:flex-row items-center justify-between no-print bg-slate-50/50 gap-4 md:gap-6">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide w-full lg:w-auto">
              {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS', 'SENIOR_SECONDARY_BOYS', 'SENIOR_SECONDARY_GIRLS'] as SectionType[]).map(s => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-4 md:px-5 py-2.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
           </div>
           
           <div className="flex items-center gap-3 bg-white dark:bg-slate-900 px-4 py-3 md:py-2 rounded-2xl border border-slate-100 dark:border-slate-800 w-full md:w-auto">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Active Date:</span>
             <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white flex-1" />
           </div>
        </div>

        <div className="flex-1">
           {status && (
             <div className={`m-4 md:m-8 p-4 rounded-2xl text-[10px] font-black uppercase border animate-in slide-in-from-top ${
               status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
               status.type === 'info' ? 'bg-sky-50 text-sky-600 border-sky-100' :
               'bg-amber-50 text-amber-600 border-amber-100'
             }`}>
               {status.message}
             </div>
           )}

           {/* DESKTOP VIEW: Structured Table */}
           <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                    <th className="px-10 py-6">Slot</th>
                    <th className="px-10 py-6">Division</th>
                    <th className="px-10 py-6">Absence</th>
                    <th className="px-10 py-6">Proxy Assigned</th>
                    {isManagement && <th className="px-10 py-6 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredSubs.map(s => (
                    <tr key={s.id} className="hover:bg-amber-50/5 transition-colors stagger-row">
                      <td className="px-10 py-8"><p className="font-black text-lg text-[#001f3f] dark:text-white italic leading-none tracking-tight">{getSlotLabel(s.slotId, s.section)}</p></td>
                      <td className="px-10 py-8"><p className="font-black text-sm text-[#001f3f] dark:text-white leading-none">{s.className}</p><p className="text-[10px] font-bold text-sky-600 uppercase mt-1.5 italic">{s.subject}</p></td>
                      <td className="px-10 py-8 text-rose-500 font-black text-xs italic">{s.absentTeacherName}</td>
                      <td className="px-10 py-8">
                        <span className={`text-sm font-black uppercase italic ${s.substituteTeacherId ? 'text-emerald-600' : 'text-amber-500'}`}>
                          {s.substituteTeacherName}
                        </span>
                      </td>
                      {isManagement && (
                        <td className="px-10 py-8 text-right">
                          <div className="flex items-center justify-end gap-2">
                             {isAdmin && (
                               <button 
                                 onClick={() => handleDeleteSubstitution(s.id)}
                                 className="p-2.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-all border border-transparent hover:border-rose-100"
                                 title="Delete Entry"
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                 </svg>
                               </button>
                             )}
                             <button onClick={() => setManualAssignTarget(s)} className="text-[10px] font-black uppercase text-sky-600 hover:text-sky-700 bg-sky-50 dark:bg-sky-950/30 px-4 py-2 rounded-xl border border-sky-100 transition-all hover:scale-105 active:scale-95">
                               Deploy Proxy
                             </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
           </div>

           {/* MOBILE VIEW: Card-based UX */}
           <div className="md:hidden p-4 space-y-4">
              {filteredSubs.map(s => (
                <div key={s.id} className={`p-6 rounded-[2rem] border transition-all shadow-sm ${s.substituteTeacherId ? 'bg-emerald-50/20 border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900/40' : 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs shadow-lg">{getSlotLabel(s.slotId, s.section)}</div>
                       <div>
                         <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{s.className}</p>
                         <p className="text-[8px] font-black text-sky-600 uppercase tracking-widest">{s.subject}</p>
                       </div>
                    </div>
                    {isManagement && (
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <button onClick={() => handleDeleteSubstitution(s.id)} className="p-3 text-rose-500 bg-rose-50 dark:bg-rose-950/20 rounded-xl active:scale-95 transition-all">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                             </svg>
                          </button>
                        )}
                        <button onClick={() => setManualAssignTarget(s)} className="p-3 bg-sky-600 text-white rounded-xl shadow-lg active:scale-95 transition-all">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/50">
                    <div className="flex justify-between items-center">
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Absence:</span>
                       <span className="text-[10px] font-black text-rose-500 italic">{s.absentTeacherName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Proxy:</span>
                       <span className={`text-[10px] font-black uppercase italic ${s.substituteTeacherId ? 'text-emerald-600' : 'text-amber-500'}`}>
                         {s.substituteTeacherName}
                       </span>
                    </div>
                  </div>
                  
                  {isManagement && (
                    <button onClick={() => setManualAssignTarget(s)} className="w-full mt-6 py-3 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase tracking-[0.2em] shadow-lg">
                      Deploy Proxy Asset
                    </button>
                  )}
                </div>
              ))}
           </div>

           {filteredSubs.length === 0 && (
             <div className="py-32 text-center">
                <div className="opacity-20 flex flex-col items-center gap-4">
                   <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                   <p className="text-sm font-black uppercase tracking-[0.4em]">No active duty requests</p>
                </div>
             </div>
           )}
        </div>
      </div>

      {isNewEntryModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Log Substitution</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Institutional Deployment</p>
             </div>
             <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[9px] font-black text-slate-400 uppercase">Absent Teacher</label>
                   <select value={newEntry.absentTeacherId} onChange={e => setNewEntry({...newEntry, absentTeacherId: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-4 text-xs font-bold dark:text-white outline-none">
                      <option value="">Select Personnel...</option>
                      {users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                   </select>
                </div>
                <div className="space-y-1">
                   <label className="text-[9px] font-black text-slate-400 uppercase">Section Name</label>
                   <select value={newEntry.className} onChange={e => setNewEntry({...newEntry, className: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-4 text-xs font-bold dark:text-white outline-none">
                      <option value="">Select Division...</option>
                      {config.classes.filter(c => c.section === activeSection).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">Institutional Slot</label>
                    <select value={newEntry.slotId} onChange={e => setNewEntry({...newEntry, slotId: parseInt(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-4 text-xs font-bold dark:text-white outline-none">
                       {currentSectionSlots.map(slot => (
                         <option key={slot.id} value={slot.id}>{slot.label}</option>
                       ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">Subject</label>
                    <select value={newEntry.subject} onChange={e => setNewEntry({...newEntry, subject: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-4 text-xs font-bold dark:text-white outline-none">
                       <option value="">Subject...</option>
                       {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
             </div>
             <div className="space-y-3">
               <button onClick={handleManualEntrySubmit} disabled={isProcessing} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all active:scale-95">Commit Registry</button>
               <button onClick={() => setIsNewEntryModalOpen(false)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest py-2">Discard</button>
             </div>
           </div>
        </div>
      )}

      {manualAssignTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-6 md:p-10 shadow-2xl space-y-6 md:space-y-8 border border-white/10 flex flex-col max-h-[90vh]">
             <div className="text-center shrink-0">
                <h4 className="text-xl md:text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Proxy Matrix Intelligence</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Deploying for {manualAssignTarget.className} — Slot {getSlotLabel(manualAssignTarget.slotId, manualAssignTarget.section)}</p>
             </div>
             <div className="flex-1 overflow-y-auto scrollbar-hide border border-slate-100 dark:border-slate-800 rounded-[2rem]">
                <table className="w-full text-left">
                   <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 z-10">
                      <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b"><th className="px-4 md:px-8 py-5">Personnel</th><th className="px-2 md:px-8 py-5 text-center">Workload</th><th className="px-4 md:px-8 py-5 text-right">Action</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {deploymentCandidates.map(({ teacher, load, available }) => (
                         <tr key={teacher.id} className="transition-all hover:bg-slate-50/50">
                            <td className="px-4 md:px-8 py-6"><p className="text-xs md:text-sm font-black text-[#001f3f] dark:text-white uppercase italic truncate max-w-[120px] md:max-w-none">{teacher.name}</p></td>
                            <td className="px-2 md:px-8 py-6 text-center">
                                 {!available ? (
                                   <span className="text-[7px] md:text-[8px] font-black text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 uppercase">Conflict</span>
                                 ) : (
                                   <span className="text-[10px] md:text-xs font-black text-slate-500">{load.total}/35</span>
                                 )}
                            </td>
                            <td className="px-4 md:px-8 py-6 text-right">
                                 <button 
                                   disabled={!available || load.total >= MAX_TOTAL_WEEKLY_LOAD || isProcessing}
                                   onClick={() => commitSubstitution(manualAssignTarget.id, teacher)}
                                   className={`text-[8px] md:text-[9px] font-black uppercase px-4 md:px-5 py-2.5 rounded-xl shadow-md transition-all ${!available ? 'bg-slate-100 text-slate-300' : 'bg-[#001f3f] text-[#d4af37] hover:scale-105 active:scale-95'}`}
                                 >
                                    {available ? 'Deploy' : 'Busy'}
                                 </button>
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
             <button onClick={() => setManualAssignTarget(null)} className="w-full text-slate-400 font-black text-[11px] uppercase py-4">Close Matrix</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;
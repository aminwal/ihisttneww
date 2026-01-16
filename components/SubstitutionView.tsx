import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SectionType, TeacherAssignment, SchoolConfig, CombinedBlock, SchoolNotification } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { NotificationService } from '../services/notificationService.ts';

// Capacity Policy: 35 Total Periods per week (Authorized Basis + Proxies)
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
  const [viewMode, setViewMode] = useState<'LIST' | 'CALENDAR'>('LIST');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [manualAssignTarget, setManualAssignTarget] = useState<SubstitutionRecord | null>(null);
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'INDIVIDUAL' | 'GROUP'>('INDIVIDUAL');

  const [newEntry, setNewEntry] = useState({
    absentTeacherId: '',
    className: '',
    subject: '',
    slotId: 1,
    section: activeSection
  });

  useEffect(() => {
    localStorage.setItem('ihis_cached_section', activeSection);
    setNewEntry(prev => ({ ...prev, section: activeSection }));
  }, [activeSection]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

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
    const proxyLoad = currentSubs.filter(s => 
      s.substituteTeacherId === teacherId && s.date >= start && s.date <= end && !s.isArchived
    ).length;
    const total = baseLoad + groupLoad + proxyLoad;
    return { base: baseLoad, groups: groupLoad, proxy: proxyLoad, total: total, remaining: Math.max(0, MAX_TOTAL_WEEKLY_LOAD - total) };
  }, [assignments, substitutions, getWeekRange]);

  const isTeacherAvailable = useCallback((teacherId: string, dateStr: string, slotId: number, currentSubs: SubstitutionRecord[] = substitutions) => {
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => {
      if (t.day !== dayName || t.slotId !== slotId) return false;
      if (t.date && t.date !== dateStr) return false; 
      if (t.teacherId === teacherId) return true;
      if (t.blockId) {
        const block = config.combinedBlocks.find(b => b.id === t.blockId);
        return block?.allocations.some(a => a.teacherId === teacherId);
      }
      return false;
    });
    if (isBusyInTimetable) return false;
    const isBusyInSubs = currentSubs.some(s => s.substituteTeacherId === teacherId && s.date === dateStr && s.slotId === slotId && !s.isArchived);
    return !isBusyInSubs;
  }, [timetable, substitutions, attendance, config.combinedBlocks]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    const allRoles = [u.role, ...(u.secondaryRoles || [])];
    const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    const isSecondary = allRoles.some(r => r === UserRole.TEACHER_SECONDARY || r === UserRole.INCHARGE_SECONDARY || r === UserRole.INCHARGE_ALL);
    if (section === 'PRIMARY') return isPrimary;
    return isSecondary;
  }, []);

  const filteredSubs = useMemo(() => {
    const dateFiltered = substitutions.filter(s => s.date === selectedDate && !s.isArchived);
    if (isManagement) return dateFiltered.filter(s => s.section === activeSection);
    return dateFiltered.filter(s => s.substituteTeacherId === user.id);
  }, [substitutions, selectedDate, isManagement, activeSection, user.id]);

  const handleWhatsAppNotify = (sub: SubstitutionRecord) => {
    const teacher = users.find(u => u.id === sub.substituteTeacherId);
    if (!teacher) return;
    if (!teacher.phone_number) {
      alert("Faculty contact number not found. Please link it in the Registry.");
      return;
    }
    NotificationService.sendWhatsAppAlert(teacher, sub);
  };

  const handleScanForAbsentees = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 1000));
    const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
    const absentees = users.filter(u => {
      if (u.isResigned || u.role === UserRole.ADMIN) return false;
      const att = attendance.find(a => a.userId === u.id && a.date === selectedDate);
      return !att || att.checkIn === 'MEDICAL';
    });
    let newRegistries: SubstitutionRecord[] = [];
    let count = 0;
    absentees.forEach(teacher => {
      const duties = timetable.filter(t => {
        if (t.day !== dayName || !!t.date) return false;
        if (t.teacherId === teacher.id) return true;
        if (t.blockId) {
           const block = config.combinedBlocks.find(b => b.id === t.blockId);
           return block?.allocations.some(a => a.teacherId === teacher.id);
        }
        return false;
      });
      duties.forEach(duty => {
        const exists = substitutions.some(s => s.date === selectedDate && s.absentTeacherId === teacher.id && s.slotId === duty.slotId && s.className === duty.className);
        if (!exists) {
           const subName = duty.blockId ? (config.combinedBlocks.find(b => b.id === duty.blockId)?.allocations.find(a => a.teacherId === teacher.id)?.subject || duty.subject) : duty.subject;
           newRegistries.push({ id: `auto-scan-${generateUUID()}`, date: selectedDate, slotId: duty.slotId, className: duty.className, subject: subName, absentTeacherId: teacher.id, absentTeacherName: teacher.name, substituteTeacherId: '', substituteTeacherName: 'PENDING ASSIGNMENT', section: duty.section });
           count++;
        }
      });
    });
    if (newRegistries.length > 0) {
      setSubstitutions(prev => [...newRegistries, ...prev]);
      setStatus({ type: 'success', message: `Intelligence Scan: Identified ${count} missing faculty periods.` });
    } else {
      setStatus({ type: 'info', message: 'Intelligence Scan: All duties accounted for.' } as any);
    }
    setIsProcessing(false);
  };

  const handleAutoAssignProxies = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 1200)); 
    let workingSubs = [...substitutions];
    let assignCount = 0;
    const newTimetableEntries: TimeTableEntry[] = [];
    const pending = workingSubs.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived && (!s.substituteTeacherId || s.substituteTeacherId === '' || s.substituteTeacherName === 'PENDING ASSIGNMENT'));
    pending.sort((a, b) => a.slotId - b.slotId);

    for (const s of pending) {
      const candidates = users
        .filter(u => u.id !== s.absentTeacherId && !u.isResigned && isTeacherEligibleForSection(u, s.section) && u.role.startsWith('TEACHER_'))
        .map(u => ({ user: u, load: getTeacherLoadBreakdown(u.id, selectedDate, workingSubs).total }))
        .filter(c => c.load < MAX_TOTAL_WEEKLY_LOAD && isTeacherAvailable(c.user.id, selectedDate, s.slotId, workingSubs))
        .sort((a, b) => a.load - b.load); 

      if (candidates.length > 0) {
        const best = candidates[0].user;
        workingSubs = workingSubs.map(item => item.id === s.id ? { ...item, substituteTeacherId: best.id, substituteTeacherName: best.name } : item);
        const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
        newTimetableEntries.push({ id: `sub-entry-${s.id}`, section: s.section, className: s.className, day: dayName, slotId: s.slotId, subject: s.subject, subjectCategory: config.subjects.find(sub => sub.name === s.subject)?.category || 'CORE' as any, teacherId: best.id, teacherName: best.name, date: selectedDate, isSubstitution: true });
        assignCount++;
      }
    }
    setSubstitutions(workingSubs);
    if (newTimetableEntries.length > 0) {
      setTimetable(prev => {
        const ids = new Set(newTimetableEntries.map(e => e.id));
        return [...prev.filter(t => !ids.has(t.id)), ...newTimetableEntries];
      });
    }
    setStatus({ type: 'success', message: `Deployment Engine: Authorized ${assignCount} proxies.` });
    setIsProcessing(false);
  };

  const commitSubstitution = async (subId: string, teacher: User) => {
    const { total } = getTeacherLoadBreakdown(teacher.id, selectedDate);
    if (total >= MAX_TOTAL_WEEKLY_LOAD) {
      setStatus({ type: 'error', message: `Policy Advisory: ${teacher.name} has reached institutional 35P weekly cap.` });
      return;
    }
    setIsProcessing(true);
    try {
      const updated = substitutions.map(s => s.id === subId ? { ...s, substituteTeacherId: teacher.id, substituteTeacherName: teacher.name } : s);
      setSubstitutions(updated);
      const subRecord = updated.find(s => s.id === subId);
      if (subRecord) {
        const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
        setTimetable(prev => [...prev.filter(t => t.id !== `sub-entry-${subId}`), { id: `sub-entry-${subId}`, section: subRecord.section, className: subRecord.className, day: dayName, slotId: subRecord.slotId, subject: subRecord.subject, subjectCategory: config.subjects.find(s => s.name === subRecord.subject)?.category || 'CORE' as any, teacherId: teacher.id, teacherName: teacher.name, date: selectedDate, isSubstitution: true }]);
      }
      setStatus({ type: 'success', message: `Manual Override: Assigned ${teacher.name}.` });
      setManualAssignTarget(null);
    } catch (e) { setStatus({ type: 'error', message: "Operational failed." }); } finally { setIsProcessing(false); }
  };

  const handlePurgeWeeklyMatrix = async () => {
    if (!window.confirm("Archive active substitutions for the selected week?")) return;
    setIsProcessing(true);
    const { start, end } = getWeekRange(selectedDate);
    try {
      setTimetable(prev => prev.filter(t => !t.isSubstitution || !t.date || t.date < start || t.date > end));
      setSubstitutions(prev => prev.map(s => (s.date >= start && s.date <= end) ? { ...s, isArchived: true } : s));
      setStatus({ type: 'success', message: 'Matrix successfully archived.' });
    } catch (e) { setStatus({ type: 'error', message: 'Registry cleanup failed.' }); } finally { setIsProcessing(false); }
  };

  const WorkloadMatrixChart = ({ teacherId, date, compact = false }: { teacherId: string, date: string, compact?: boolean }) => {
    const teacher = users.find(u => u.id === teacherId);
    if (!teacher) return null;
    const load = getTeacherLoadBreakdown(teacherId, date);
    const baseWidth = (load.base / MAX_TOTAL_WEEKLY_LOAD) * 100;
    const groupWidth = (load.groups / MAX_TOTAL_WEEKLY_LOAD) * 100;
    const proxyWidth = (load.proxy / MAX_TOTAL_WEEKLY_LOAD) * 100;
    const isOverloaded = load.total >= MAX_TOTAL_WEEKLY_LOAD;
    const statusInfo = isOverloaded ? { label: 'MAX', color: 'text-rose-500', bar: 'bg-rose-500' } : load.total > 30 ? { label: 'BUSY', color: 'text-amber-500', bar: 'bg-amber-500' } : { label: 'OK', color: 'text-emerald-500', bar: 'bg-[#001f3f]' };
    if (compact) return (<div className="w-full flex flex-col gap-1"><div className="flex justify-between items-center px-1"><span className="text-[7px] font-black text-slate-400 uppercase truncate max-w-[60px]">{(teacher.name || 'Staff').split(' ')[0]}</span><span className={`text-[8px] font-black ${statusInfo.color}`}>{load.total}/35</span></div><div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner"><div style={{ width: `${baseWidth}%` }} className="h-full bg-[#001f3f]"></div><div style={{ width: `${groupWidth}%` }} className="h-full bg-indigo-500"></div><div style={{ width: `${proxyWidth}%` }} className={`h-full ${statusInfo.bar}`}></div></div></div>);
    return (<div className="flex flex-col gap-2 w-full max-w-[180px]"><div className="flex items-center justify-between"><span className={`text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${isOverloaded ? 'bg-rose-50 text-rose-500' : 'bg-slate-50 text-slate-400'}`}>{statusInfo.label}</span><span className="text-[9px] font-black text-[#001f3f] dark:text-white">{load.total} <span className="text-slate-300">/ 35P</span></span></div><div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner border border-slate-100 dark:border-slate-800"><div style={{ width: `${baseWidth}%` }} className="h-full bg-[#001f3f] transition-all duration-700"></div><div style={{ width: `${groupWidth}%` }} className="h-full bg-indigo-500 transition-all duration-700 delay-75"></div><div style={{ width: `${proxyWidth}%` }} className={`h-full ${statusInfo.bar} transition-all duration-700 delay-150`}></div></div></div>);
  };

  const sectionStaff = useMemo(() => users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN && isTeacherEligibleForSection(u, activeSection)), [users, activeSection, isTeacherEligibleForSection]);

  const handleCreateEntry = async () => {
    if (!newEntry.absentTeacherId || !newEntry.className || !newEntry.subject) {
      setStatus({ type: 'error', message: 'Registry Error: All fields mandatory.' });
      return;
    }
    const teacher = users.find(u => u.id === newEntry.absentTeacherId);
    if (!teacher) return;
    const record: SubstitutionRecord = { id: `manual-${generateUUID()}`, date: selectedDate, slotId: newEntry.slotId, className: newEntry.className, subject: newEntry.subject, absentTeacherId: teacher.id, absentTeacherName: teacher.name, substituteTeacherId: '', substituteTeacherName: 'PENDING ASSIGNMENT', section: newEntry.section };
    setIsProcessing(true);
    try {
      setSubstitutions(prev => [record, ...prev]);
      setIsNewEntryModalOpen(false);
      setNewEntry({ absentTeacherId: '', className: '', subject: '', slotId: 1, section: activeSection });
      setStatus({ type: 'success', message: 'Manual absence registry created.' });
    } catch (e) { setStatus({ type: 'error', message: 'Registry synchronization issue.' }); } finally { setIsProcessing(false); }
  };

  // Calendar Logic
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    // Padding
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    // Month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = substitutions.filter(s => s.date === dateStr && !s.isArchived && (isManagement ? s.section === activeSection : s.substituteTeacherId === user.id)).length;
      days.push({ day: d, date: dateStr, count });
    }
    return days;
  }, [calendarMonth, substitutions, activeSection, isManagement, user.id]);

  const changeMonth = (offset: number) => {
    const next = new Date(calendarMonth);
    next.setMonth(next.getMonth() + offset);
    setCalendarMonth(next);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Substitution Ledger</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Faculty Deployment Matrix</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border dark:border-slate-800 shadow-md">
            <button onClick={() => setViewMode('LIST')} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === 'LIST' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>List View</button>
            <button onClick={() => setViewMode('CALENDAR')} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === 'CALENDAR' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Monthly View</button>
          </div>
          {isManagement && (
            <>
              <button onClick={handlePurgeWeeklyMatrix} className="bg-rose-600 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-rose-700 transition-all active:scale-95">Archive Matrix</button>
              <button onClick={handleScanForAbsentees} disabled={isProcessing} className="bg-indigo-600 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-indigo-700 transition-all border border-white/10 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                {isProcessing ? 'Scanning...' : 'Scan for Absentees'}
              </button>
              <button onClick={() => { setIsNewEntryModalOpen(true); setModalTab('INDIVIDUAL'); }} className="bg-[#001f3f] text-[#d4af37] px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/10">Log Absence</button>
              <button onClick={handleAutoAssignProxies} disabled={isProcessing} className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl transition-all flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                {isProcessing ? 'Optimizing...' : 'Smart Auto-Proxy'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-6 md:p-8 border-b border-gray-100 dark:border-slate-800 flex flex-col lg:flex-row items-center justify-between no-print bg-slate-50/50 gap-6">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide w-full lg:w-auto max-w-full">
              {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS', 'SENIOR_SECONDARY_BOYS', 'SENIOR_SECONDARY_GIRLS'] as SectionType[]).map(s => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap shrink-0 ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
           </div>
           
           {viewMode === 'LIST' && (
             <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-2xl border border-slate-100 dark:border-slate-800 shrink-0">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Date:</span>
               <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white" />
             </div>
           )}
        </div>

        {viewMode === 'LIST' ? (
          <div className="overflow-x-auto flex-1">
             <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                    <th className="px-10 py-6">Slot</th>
                    <th className="px-10 py-6">Division</th>
                    <th className="px-10 py-6">Absence</th>
                    <th className="px-10 py-6">Proxy Assigned</th>
                    <th className="px-10 py-6">Notify</th>
                    {isManagement && <th className="px-10 py-6 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredSubs.map(s => {
                    const subTeacher = users.find(u => u.id === s.substituteTeacherId);
                    const hasPhone = !!subTeacher?.phone_number;
                    
                    return (
                      <tr key={s.id} className="hover:bg-amber-50/5 transition-colors group stagger-row">
                        <td className="px-10 py-8"><p className="font-black text-lg text-[#001f3f] dark:text-white italic leading-none tracking-tight">P{s.slotId}</p></td>
                        <td className="px-10 py-8"><p className="font-black text-sm text-[#001f3f] dark:text-white leading-none">{s.className}</p><p className="text-[10px] font-bold text-sky-600 uppercase mt-1.5 italic">{s.subject}</p></td>
                        <td className="px-10 py-8 text-rose-500 font-black text-xs italic">{s.absentTeacherName}</td>
                        <td className="px-10 py-8">
                          <span className={`text-sm font-black uppercase italic ${s.substituteTeacherId ? 'text-emerald-600' : 'text-amber-500'}`}>
                            {s.substituteTeacherName}
                          </span>
                        </td>
                        <td className="px-10 py-8">
                          {s.substituteTeacherId && s.substituteTeacherId !== 'PENDING ASSIGNMENT' && (
                            <button 
                              onClick={() => handleWhatsAppNotify(s)}
                              className={`p-3 rounded-xl transition-all shadow-sm ${hasPhone ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:scale-110 active:scale-95' : 'bg-slate-50 text-slate-300 border border-slate-100 cursor-not-allowed opacity-50'}`}
                              title={hasPhone ? "Send WhatsApp Notification" : "Staff phone number missing"}
                            >
                               <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.222-4.032c1.53.939 3.274 1.443 5.066 1.444 5.439 0 9.865-4.427 9.867-9.867.001-2.63-1.023-5.102-2.884-6.964a9.774 9.774 0 00-6.977-2.881c-5.438 0-9.866 4.426-9.867 9.866 0 1.902.538 3.758 1.554 5.36l-.1.173-1.012 3.691 3.782-.992.174.103zm10.274-6.487c-.19-.094-1.128-.558-1.303-.622-.175-.064-.301-.097-.428.094-.127.19-.49.622-.601.748-.11.127-.222.143-.413.048-.19-.094-.8-.294-1.522-.94-.562-.5-1.026-1.119-1.137-1.309-.11-.19-.012-.294.083-.388.086-.085.19-.223.285-.335.095-.11.127-.19.19-.317.064-.127.032-.238-.016-.333-.048-.094-.428-1.03-.587-1.413-.155-.373-.31-.322-.428-.328-.11-.006-.238-.007-.365-.007-.127 0-.333.048-.508.238-.174.19-.667.651-.667 1.588 0 .937.683 1.842.778 1.968.095.127 1.343 2.051 3.255 2.877.455.197.81.314 1.086.402.458.145.874.124 1.205.075.369-.054 1.128-.461 1.286-.905.158-.444.158-.825.11-.905-.048-.08-.175-.127-.365-.221z"/></svg>
                            </button>
                          )}
                        </td>
                        {isManagement && (<td className="px-10 py-8 text-right"><button onClick={() => setManualAssignTarget(s)} className="text-[10px] font-black uppercase text-sky-600 hover:text-sky-700 bg-sky-50 dark:bg-sky-950/30 px-4 py-2 rounded-xl border border-sky-100 transition-all hover:scale-105 active:scale-95">Deploy Proxy</button></td>)}
                      </tr>
                    );
                  })}
                  {filteredSubs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-10 py-32 text-center">
                        <div className="max-w-xs mx-auto opacity-20">
                          <svg className="w-20 h-20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <p className="text-[10px] font-black uppercase tracking-[0.5em]">Clear Schedule Detected</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
             </table>
          </div>
        ) : (
          <div className="p-8 md:p-12 animate-in zoom-in-95 duration-500">
             <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-10">
                   <button onClick={() => changeMonth(-1)} className="p-4 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all">
                      <svg className="w-6 h-6 text-[#001f3f] dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"/></svg>
                   </button>
                   <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                      {calendarMonth.toLocaleString('default', { month: 'long' })} {calendarMonth.getFullYear()}
                   </h2>
                   <button onClick={() => changeMonth(1)} className="p-4 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all">
                      <svg className="w-6 h-6 text-[#001f3f] dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg>
                   </button>
                </div>

                <div className="grid grid-cols-7 gap-4">
                   {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
                     <div key={d} className="text-center text-[10px] font-black text-slate-300 uppercase tracking-widest pb-4">{d}</div>
                   ))}
                   {calendarDays.map((d, i) => (
                     <div key={i} className="aspect-square">
                        {d ? (
                          <button 
                            onClick={() => { setSelectedDate(d.date); setViewMode('LIST'); }}
                            className={`w-full h-full rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all group relative overflow-hidden ${
                              d.date === selectedDate 
                                ? 'bg-[#001f3f] border-[#d4af37] text-white shadow-xl scale-110 z-10' 
                                : d.count > 0 
                                  ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-[#001f3f] dark:text-white hover:border-amber-400' 
                                  : 'bg-white dark:bg-slate-950 border-slate-50 dark:border-slate-800 text-slate-400 hover:border-slate-200'
                            }`}
                          >
                             <span className="text-xs font-black">{d.day}</span>
                             {d.count > 0 && (
                               <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-lg ${d.date === selectedDate ? 'bg-white/10' : 'bg-amber-400 text-[#001f3f]'}`}>
                                 {d.count} Proxies
                               </span>
                             )}
                          </button>
                        ) : (
                          <div className="w-full h-full opacity-10"></div>
                        )}
                     </div>
                   ))}
                </div>
             </div>
          </div>
        )}
      </div>

      {manualAssignTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl space-y-8 border border-white/10 flex flex-col max-h-[90vh]">
             <div className="text-center shrink-0">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Proxy Matrix Intelligence</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Deploying for {manualAssignTarget.className} — Slot {manualAssignTarget.slotId}</p>
             </div>
             <div className="flex-1 overflow-y-auto scrollbar-hide border border-slate-100 dark:border-slate-800 rounded-[2rem]">
                <table className="w-full text-left">
                   <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 z-10">
                      <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b"><th className="px-8 py-5">Personnel</th><th className="px-8 py-5 text-center">Workload</th><th className="px-8 py-5 text-right">Action</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {users.filter(u => u.id !== manualAssignTarget.absentTeacherId && !u.isResigned && isTeacherEligibleForSection(u, manualAssignTarget.section) && u.role !== UserRole.ADMIN).map(teacher => {
                         const load = getTeacherLoadBreakdown(teacher.id, selectedDate);
                         const available = isTeacherAvailable(teacher.id, selectedDate, manualAssignTarget.slotId);
                         const atLimit = load.total >= MAX_TOTAL_WEEKLY_LOAD;
                         return (
                           <tr key={teacher.id} className="transition-all hover:bg-slate-50/50">
                              <td className="px-8 py-6">
                                <div className="flex flex-col">
                                  <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">{teacher.name}</p>
                                  {teacher.phone_number && <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">WhatsApp Linked</span>}
                                </div>
                              </td>
                              <td className="px-8 py-6 text-center">
                                 {!available ? (
                                   <div className="flex flex-col items-center">
                                      <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 uppercase">Conflict</span>
                                   </div>
                                 ) : (
                                   <WorkloadMatrixChart teacherId={teacher.id} date={selectedDate} compact />
                                 )}
                              </td>
                              <td className="px-8 py-6 text-right">
                                 <button 
                                   disabled={!available || atLimit || isProcessing}
                                   onClick={() => commitSubstitution(manualAssignTarget.id, teacher)}
                                   className={`text-[9px] font-black uppercase px-5 py-2.5 rounded-xl shadow-md transition-all ${!available ? 'bg-slate-100 text-slate-300' : atLimit ? 'bg-rose-50 text-rose-400' : 'bg-[#001f3f] text-[#d4af37] hover:scale-105 active:scale-95'}`}
                                 >
                                    {atLimit ? 'Cap' : !available ? 'Busy' : 'Deploy'}
                                 </button>
                              </td>
                           </tr>
                         );
                      })}
                   </tbody>
                </table>
             </div>
             <button onClick={() => setManualAssignTarget(null)} className="w-full text-slate-400 font-black text-[11px] uppercase py-4 rounded-3xl">Close Matrix</button>
          </div>
        </div>
      )}

      {isNewEntryModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Registry</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Log Personnel Absence</p>
             </div>
             
             <div className="space-y-6">
                <div className="space-y-1.5">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Absent Personnel</label>
                   <select 
                     className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm"
                     value={newEntry.absentTeacherId}
                     onChange={e => setNewEntry({...newEntry, absentTeacherId: e.target.value})}
                   >
                      <option value="">Select Faculty...</option>
                      {users.filter(u => u.role !== UserRole.ADMIN && !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                   </select>
                </div>
                <div className="space-y-1.5">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Classroom Section</label>
                   <select 
                     className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm"
                     value={newEntry.className}
                     onChange={e => setNewEntry({...newEntry, className: e.target.value})}
                   >
                      <option value="">Select Class...</option>
                      {config.classes.filter(c => c.section === activeSection).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                      <select 
                        className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm"
                        value={newEntry.subject}
                        onChange={e => setNewEntry({...newEntry, subject: e.target.value})}
                      >
                         <option value="">Subject...</option>
                         {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Slot Index</label>
                      <input 
                        type="number" 
                        min={1} 
                        max={10} 
                        className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm" 
                        value={newEntry.slotId} 
                        onChange={e => setNewEntry({...newEntry, slotId: parseInt(e.target.value) || 1})} 
                      />
                   </div>
                </div>
             </div>

             <button disabled={isProcessing} onClick={handleCreateEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/10 active:scale-95 disabled:opacity-50">
               {isProcessing ? 'SYNCHRONIZING...' : 'COMMIT ABSENCE REGISTRY'}
             </button>
             <button onClick={() => setIsNewEntryModalOpen(false)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-slate-600 transition-colors">Discard Process</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SectionType, TeacherAssignment, SchoolConfig } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

// Constants moved to top level to avoid TDZ (Temporal Dead Zone)
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
}

const SubstitutionView: React.FC<SubstitutionViewProps> = ({ user, users, attendance, timetable, setTimetable, substitutions, setSubstitutions, assignments, config }) => {
  // Efficiency: Cache the active section across tabs
  const [activeSection, setActiveSection] = useState<SectionType>(() => {
    const saved = localStorage.getItem('ihis_cached_section');
    return (saved as SectionType) || 'PRIMARY';
  });

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [manualAssignTarget, setManualAssignTarget] = useState<SubstitutionRecord | null>(null);
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);
  const [showWorkloadInsight, setShowWorkloadInsight] = useState(true);

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
    return {
      start: sunday.toISOString().split('T')[0],
      end: thursday.toISOString().split('T')[0]
    };
  }, []);

  const getTeacherLoadBreakdown = useCallback((teacherId: string, dateStr: string, currentSubs: SubstitutionRecord[] = substitutions) => {
    const { start, end } = getWeekRange(dateStr);
    const baseLoad = assignments.filter(a => a.teacherId === teacherId).reduce((sum, a) => sum + a.loads.reduce((s, l) => s + l.periods, 0), 0);
    const proxyLoad = currentSubs.filter(s => s.substituteTeacherId === teacherId && s.date >= start && s.date <= end && !s.isArchived).length;
    return { 
      base: baseLoad, 
      proxy: proxyLoad, 
      total: baseLoad + proxyLoad, 
      remaining: Math.max(0, MAX_TOTAL_WEEKLY_LOAD - (baseLoad + proxyLoad)) 
    };
  }, [assignments, substitutions, getWeekRange]);

  const isTeacherAvailable = useCallback((teacherId: string, dateStr: string, slotId: number, currentSubs: SubstitutionRecord[] = substitutions) => {
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => t.teacherId === teacherId && t.day === dayName && t.slotId === slotId && (!t.date || t.date === dateStr));
    if (isBusyInTimetable) return false;
    
    const isBusyInSubs = currentSubs.some(s => s.substituteTeacherId === teacherId && s.date === dateStr && s.slotId === slotId && !s.isArchived);
    if (isBusyInSubs) return false;
    
    return true;
  }, [timetable, substitutions, attendance]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    const allRoles = [u.role, ...(u.secondaryRoles || [])];
    const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    const isSecondary = allRoles.some(r => r.includes('SECONDARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    return section === 'PRIMARY' ? isPrimary : isSecondary;
  }, []);

  const filteredSubs = useMemo(() => {
    const dateFiltered = substitutions.filter(s => s.date === selectedDate && !s.isArchived);
    if (isManagement) {
      return dateFiltered.filter(s => activeSection === 'PRIMARY' ? s.section === 'PRIMARY' : s.section !== 'PRIMARY');
    }
    return dateFiltered.filter(s => s.substituteTeacherId === user.id);
  }, [substitutions, selectedDate, isManagement, activeSection, user.id]);

  const handleAutoAssignProxies = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 1200)); 
    
    let workingSubs = [...substitutions];
    let assignCount = 0;
    const newTimetableEntries: TimeTableEntry[] = [];
    
    const pending = workingSubs.filter(s => 
      s.date === selectedDate && 
      s.section === activeSection && 
      !s.isArchived && 
      (!s.substituteTeacherId || s.substituteTeacherId === '' || s.substituteTeacherName === 'PENDING ASSIGNMENT')
    );

    // Sort pending slots to process earliest periods first
    pending.sort((a, b) => a.slotId - b.slotId);

    for (const s of pending) {
      // Logic: Prioritize faculty with lowest (Base + Proxy) load for the week
      const candidates = users
        .filter(u => u.id !== s.absentTeacherId && isTeacherEligibleForSection(u, s.section) && u.role !== UserRole.ADMIN)
        .map(u => ({ 
          user: u, 
          // Re-calculate load for each iteration to account for proxies assigned in this batch
          load: getTeacherLoadBreakdown(u.id, selectedDate, workingSubs).total 
        }))
        .filter(c => c.load < MAX_TOTAL_WEEKLY_LOAD && isTeacherAvailable(c.user.id, selectedDate, s.slotId, workingSubs))
        .sort((a, b) => a.load - b.load); // Essential: Sort by lowest weekly total periods first

      if (candidates.length > 0) {
        const best = candidates[0].user;
        workingSubs = workingSubs.map(item => item.id === s.id ? { ...item, substituteTeacherId: best.id, substituteTeacherName: best.name } : item);
        
        const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
        newTimetableEntries.push({
          id: `sub-entry-${s.id}`,
          section: s.section,
          className: s.className,
          day: dayName,
          slotId: s.slotId,
          subject: s.subject,
          subjectCategory: config.subjects.find(sub => sub.name === s.subject)?.category || 'CORE' as any,
          teacherId: best.id,
          teacherName: best.name,
          date: selectedDate,
          isSubstitution: true
        });
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
    
    if (assignCount === 0 && pending.length > 0) {
      setStatus({ type: 'error', message: 'No available faculty found matching workload and schedule constraints.' });
    } else {
      setStatus({ type: 'success', message: `Deployment Engine: Successfully optimized and authorized ${assignCount} proxies based on lowest weekly workload.` });
    }
    setIsProcessing(false);
  };

  const commitSubstitution = async (subId: string, teacher: User) => {
    const { total } = getTeacherLoadBreakdown(teacher.id, selectedDate);
    if (total >= MAX_TOTAL_WEEKLY_LOAD) {
      setStatus({ type: 'error', message: `Policy Advisory: ${teacher.name} has reached 35P weekly cap.` });
      return;
    }
    setIsProcessing(true);
    try {
      const updated = substitutions.map(s => s.id === subId ? { ...s, substituteTeacherId: teacher.id, substituteTeacherName: teacher.name } : s);
      setSubstitutions(updated);
      const subRecord = updated.find(s => s.id === subId);
      if (subRecord) {
        const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
        setTimetable(prev => [...prev.filter(t => t.id !== `sub-entry-${subId}`), { 
          id: `sub-entry-${subId}`, section: subRecord.section, className: subRecord.className, day: dayName, slotId: subRecord.slotId, subject: subRecord.subject, subjectCategory: config.subjects.find(s => s.name === subRecord.subject)?.category || 'CORE' as any, teacherId: teacher.id, teacherName: teacher.name, date: selectedDate, isSubstitution: true 
        }]);
      }
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
      if (isCloudActive) await supabase.from('substitution_ledger').update({ substitute_teacher_id: teacher.id, substitute_teacher_name: teacher.name }).eq('id', subId);
      setStatus({ type: 'success', message: `Manual Override: Assigned ${teacher.name}.` });
      setManualAssignTarget(null);
    } catch (e) { setStatus({ type: 'error', message: "Operational handshake failed." }); }
    finally { setIsProcessing(false); }
  };

  const handlePurgeWeeklyMatrix = async () => {
    if (!window.confirm("CRITICAL: Archive active substitutions for the selected week?")) return;
    setIsProcessing(true);
    const { start, end } = getWeekRange(selectedDate);
    try {
      setTimetable(prev => prev.filter(t => !t.isSubstitution || !t.date || t.date < start || t.date > end));
      setSubstitutions(prev => prev.map(s => (s.date >= start && s.date <= end) ? { ...s, isArchived: true } : s));
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
      if (isCloudActive) {
        await supabase.from('substitution_ledger').update({ is_archived: true }).gte('date', start).lte('date', end);
      }
      setStatus({ type: 'success', message: 'Duty Matrix successfully archived.' });
    } catch (e) {
      setStatus({ type: 'error', message: 'Registry cleanup failed.' });
    } finally {
      setIsProcessing(false);
    }
  };

  // VISUAL REPRESENTATION: WORKLOAD MATRIX CHART
  const WorkloadMatrixChart = ({ teacherId, date, compact = false }: { teacherId: string, date: string, compact?: boolean }) => {
    const teacher = users.find(u => u.id === teacherId);
    if (!teacher) return null; // Prevent crash if teacher is missing

    const load = getTeacherLoadBreakdown(teacherId, date);
    const baseWidth = (load.base / MAX_TOTAL_WEEKLY_LOAD) * 100;
    const proxyWidth = (load.proxy / MAX_TOTAL_WEEKLY_LOAD) * 100;
    const isOverloaded = load.total >= MAX_TOTAL_WEEKLY_LOAD;
    const statusInfo = isOverloaded ? { label: 'MAX', color: 'text-rose-500', bar: 'bg-rose-500' } : load.total > 30 ? { label: 'BUSY', color: 'text-amber-500', bar: 'bg-amber-500' } : { label: 'OK', color: 'text-emerald-500', bar: 'bg-[#001f3f]' };
    
    if (compact) return (
      <div className="w-full flex flex-col gap-1">
        <div className="flex justify-between items-center px-1">
          <span className="text-[7px] font-black text-slate-400 uppercase truncate max-w-[60px]">{(teacher.name || 'Staff').split(' ')[0]}</span>
          <span className={`text-[8px] font-black ${statusInfo.color}`}>{load.total}/35</span>
        </div>
        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
          <div style={{ width: `${baseWidth}%` }} className="h-full bg-slate-400 opacity-60"></div>
          <div style={{ width: `${proxyWidth}%` }} className={`h-full ${statusInfo.bar}`}></div>
        </div>
      </div>
    );

    return (
      <div className="flex flex-col gap-2 w-full max-w-[180px]">
        <div className="flex items-center justify-between">
          <span className={`text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${isOverloaded ? 'bg-rose-50 text-rose-500' : 'bg-slate-50 text-slate-400'}`}>{statusInfo.label}</span>
          <span className="text-[9px] font-black text-[#001f3f] dark:text-white">{load.total} <span className="text-slate-300">/ 35P</span></span>
        </div>
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner border border-slate-100 dark:border-slate-800">
          <div style={{ width: `${baseWidth}%` }} className="h-full bg-[#001f3f] transition-all duration-700"></div>
          <div style={{ width: `${proxyWidth}%` }} className={`h-full ${statusInfo.bar} transition-all duration-700 delay-100`}></div>
        </div>
        <div className="flex justify-between text-[6px] font-black text-slate-400 uppercase tracking-widest">
           <span>Base: {load.base}</span>
           <span>Proxy: {load.proxy}</span>
        </div>
      </div>
    );
  };

  const sectionStaff = useMemo(() => users.filter(u => u.role !== UserRole.ADMIN && isTeacherEligibleForSection(u, activeSection)), [users, activeSection, isTeacherEligibleForSection]);

  const handleCreateEntry = async (newEntryData: any) => {
    if (!newEntryData.absentTeacherId || !newEntryData.className || !newEntryData.subject) {
      setStatus({ type: 'error', message: 'Registry Error: All fields mandatory.' });
      return;
    }
    const teacher = users.find(u => u.id === newEntryData.absentTeacherId);
    if (!teacher) return;
    const record: SubstitutionRecord = { id: `manual-${generateUUID()}`, date: selectedDate, slotId: newEntryData.slotId, className: newEntryData.className, subject: newEntryData.subject, absentTeacherId: teacher.id, absentTeacherName: teacher.name, substituteTeacherId: '', substituteTeacherName: 'PENDING ASSIGNMENT', section: newEntryData.section };
    setIsProcessing(true);
    try {
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
      if (isCloudActive) {
        await supabase.from('substitution_ledger').insert({ id: record.id, date: record.date, slot_id: record.slotId, class_name: record.className, subject: record.subject, absent_teacher_id: record.absentTeacherId, absent_teacher_name: record.absentTeacherName, substitute_teacher_id: '', substitute_teacher_name: 'PENDING ASSIGNMENT', section: record.section });
      }
      setSubstitutions(prev => [record, ...prev]);
      setIsNewEntryModalOpen(false);
      setNewEntry({
        absentTeacherId: '',
        className: '',
        subject: '',
        slotId: 1,
        section: activeSection
      });
      setStatus({ type: 'success', message: 'Manual absence registry created.' });
    } catch (e) { setStatus({ type: 'error', message: 'Cloud link failed.' }); }
    finally { setIsProcessing(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Substitution Ledger</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Faculty Deployment Matrix</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManagement && (
            <>
              <button onClick={handlePurgeWeeklyMatrix} className="bg-rose-600 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-rose-700 transition-all active:scale-95">Archive Matrix</button>
              <button onClick={() => setIsNewEntryModalOpen(true)} className="bg-[#001f3f] text-[#d4af37] px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/10">Log Absence</button>
              <button onClick={handleAutoAssignProxies} disabled={isProcessing} className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-xl transition-all flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                {isProcessing ? 'Optimizing...' : 'Smart Auto-Proxy'}
              </button>
            </>
          )}
        </div>
      </div>

      {isManagement && showWorkloadInsight && (
        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 md:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-slate-800 shadow-inner space-y-6 animate-in slide-in-from-top-4 duration-500">
           <div className="flex items-center justify-between">
             <div>
               <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase tracking-widest italic">Workload Distribution Overview</h3>
               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Real-time Faculty Capacity Map — {activeSection.replace('_', ' ')}</p>
             </div>
             <button onClick={() => setShowWorkloadInsight(false)} className="text-slate-300 hover:text-rose-400 transition-colors">
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
             </button>
           </div>
           <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {sectionStaff.map(u => (
                <div key={u.id} className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                  <WorkloadMatrixChart teacherId={u.id} date={selectedDate} compact />
                </div>
              ))}
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-6 md:p-8 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between no-print bg-slate-50/50 gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide">
              {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{s.replace('_', ' ')}</button>
              ))}
           </div>
           <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-2xl border border-slate-100 dark:border-slate-800">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Date:</span>
             <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white" />
           </div>
        </div>

        <div className="overflow-x-auto flex-1">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50">
                  <th className="px-10 py-6">Slot</th>
                  <th className="px-10 py-6">Division</th>
                  <th className="px-10 py-6">Absence</th>
                  <th className="px-10 py-6">Proxy Authorization</th>
                  <th className="px-10 py-6">Workload Matrix</th>
                  {isManagement && <th className="px-10 py-6 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredSubs.map(s => (
                  <tr key={s.id} className="hover:bg-amber-50/5 transition-colors group stagger-row">
                    <td className="px-10 py-8"><p className="font-black text-lg text-[#001f3f] dark:text-white italic leading-none tracking-tight">P{s.slotId}</p></td>
                    <td className="px-10 py-8"><p className="font-black text-sm text-[#001f3f] dark:text-white leading-none">{s.className}</p><p className="text-[10px] font-bold text-sky-600 uppercase mt-1.5 italic">{s.subject}</p></td>
                    <td className="px-10 py-8"><div className="flex items-center gap-3"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div><span className="font-black text-xs text-red-500 uppercase italic">{s.absentTeacherName}</span></div></td>
                    <td className="px-10 py-8"><div className={`flex flex-col ${s.substituteTeacherId && s.substituteTeacherId !== '' ? 'text-emerald-600' : 'text-amber-500'}`}><span className="text-sm font-black uppercase leading-tight italic">{s.substituteTeacherName}</span></div></td>
                    <td className="px-10 py-8">{(s.substituteTeacherId && s.substituteTeacherId !== '' && s.substituteTeacherId !== 'PENDING ASSIGNMENT') ? (<WorkloadMatrixChart teacherId={s.substituteTeacherId} date={selectedDate} />) : (<span className="text-[8px] font-black text-slate-300 uppercase italic tracking-widest">Awaiting deployment</span>)}</td>
                    {isManagement && (<td className="px-10 py-8 text-right"><button onClick={() => setManualAssignTarget(s)} className="text-[10px] font-black uppercase text-sky-600 hover:text-sky-700 bg-sky-50 dark:bg-sky-950/30 px-4 py-2 rounded-xl border border-sky-100 transition-all hover:scale-105 active:scale-95">Deploy Proxy</button></td>)}
                  </tr>
                ))}
              </tbody>
           </table>
           {filteredSubs.length === 0 && (
             <div className="py-32 text-center">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.6em]">No absence registries for selected parameters</p>
             </div>
           )}
        </div>
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
                      <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b"><th className="px-8 py-5">Personnel</th><th className="px-8 py-5 text-center">Conflict Status</th><th className="px-8 py-5 text-right">Action</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {users.filter(u => u.id !== manualAssignTarget.absentTeacherId && isTeacherEligibleForSection(u, manualAssignTarget.section) && u.role !== UserRole.ADMIN).map(teacher => {
                         const load = getTeacherLoadBreakdown(teacher.id, selectedDate);
                         const available = isTeacherAvailable(teacher.id, selectedDate, manualAssignTarget.slotId);
                         const atLimit = load.total >= MAX_TOTAL_WEEKLY_LOAD;
                         return (
                           <tr key={teacher.id} className="transition-all hover:bg-slate-50/50">
                              <td className="px-8 py-6"><p className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">{teacher.name}</p></td>
                              <td className="px-8 py-6 text-center">
                                 {!available ? (
                                   <div className="flex flex-col items-center">
                                      <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-2 py-1 rounded border border-rose-100 uppercase">Conflict</span>
                                      <p className="text-[6px] font-bold text-slate-400 mt-1 uppercase">Active duty detected</p>
                                   </div>
                                 ) : (
                                   <WorkloadMatrixChart teacherId={teacher.id} date={selectedDate} compact />
                                 )}
                              </td>
                              <td className="px-8 py-6 text-right">
                                 <button 
                                   disabled={!available || atLimit || isProcessing}
                                   onClick={() => commitSubstitution(manualAssignTarget.id, teacher)}
                                   className={`text-[9px] font-black uppercase px-5 py-2.5 rounded-xl shadow-md transition-all ${
                                     !available ? 'bg-slate-100 text-slate-300 cursor-not-allowed' :
                                     atLimit ? 'bg-rose-50 text-rose-400 border border-rose-100' :
                                     'bg-[#001f3f] text-[#d4af37] hover:scale-105 active:scale-95'
                                   }`}
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
             <button onClick={() => setManualAssignTarget(null)} className="w-full text-slate-400 font-black text-[11px] uppercase py-4 rounded-3xl border-2 border-transparent hover:border-slate-100">Close Matrix</button>
          </div>
        </div>
      )}

      {isNewEntryModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl space-y-8 border border-white/10 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Record Absence</h4></div>
             <div className="space-y-4">
                <div className="space-y-1.5">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Faculty Member</label>
                   <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm" value={newEntry.absentTeacherId} onChange={e => setNewEntry({...newEntry, absentTeacherId: e.target.value})}>
                      <option value="">Select...</option>
                      {users.filter(u => u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Wing</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-black text-xs uppercase" value={newEntry.section} onChange={e => setNewEntry({...newEntry, section: e.target.value as SectionType})}>
                         <option value="PRIMARY">Primary</option>
                         <option value="SECONDARY_BOYS">Secondary Boys</option>
                         <option value="SECONDARY_GIRLS">Secondary Girls</option>
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Slot</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-black text-xs" value={newEntry.slotId} onChange={e => setNewEntry({...newEntry, slotId: parseInt(e.target.value)})}>
                         {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>Period {n}</option>)}
                      </select>
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Class</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-xs" value={newEntry.className} onChange={e => setNewEntry({...newEntry, className: e.target.value})}>
                         <option value="">Select...</option>
                         {config.classes.filter(c => c.section === newEntry.section).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label>
                      <select className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-xs" value={newEntry.subject} onChange={e => setNewEntry({...newEntry, subject: e.target.value})}>
                         <option value="">Select...</option>
                         {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                   </div>
                </div>
                <button onClick={() => handleCreateEntry(newEntry)} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all hover:bg-slate-900 active:scale-95 border border-[#d4af37]/20 mt-4">Initialize Registry</button>
                <button onClick={() => setIsNewEntryModalOpen(false)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest">Abort Process</button>
             </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;

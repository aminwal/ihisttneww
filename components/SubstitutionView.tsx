
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SectionType, TeacherAssignment, SchoolConfig } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase } from '../supabaseClient.ts';

// Declare html2pdf for TypeScript
declare var html2pdf: any;

interface SubstitutionViewProps {
  user: User;
  users: User[];
  attendance: AttendanceRecord[];
  timetable: TimeTableEntry[];
  substitutions: SubstitutionRecord[];
  setSubstitutions: React.Dispatch<React.SetStateAction<SubstitutionRecord[]>>;
  assignments: TeacherAssignment[];
  config: SchoolConfig;
  onAssignment?: (record: SubstitutionRecord) => void;
}

interface SubFormData {
  id?: string;
  slotId: number;
  className: string;
  subject: string;
  absentTeacherId: string;
  substituteTeacherId: string;
  section: SectionType;
}

type ExportPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const SubstitutionView: React.FC<SubstitutionViewProps> = ({ user, users, attendance, timetable, substitutions, setSubstitutions, assignments, config, onAssignment }) => {
  const [activeSection, setActiveSection] = useState<SectionType>('PRIMARY');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>('DAILY');
  const [isProcessing, setIsProcessing] = useState(false);

  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  const MAX_WEEKLY_PERIODS = 35;

  // Clear status after delay
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getWeekDatesForDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);
    return [0, 1, 2, 3, 4].map(offset => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + offset);
      return date.toISOString().split('T')[0];
    });
  };

  const currentWeekDates = useMemo(() => getWeekDatesForDate(selectedDate), [selectedDate]);

  const getTeacherLoadBreakdown = useCallback((teacherId: string) => {
    const baseLoad = assignments
      .filter(a => a.teacherId === teacherId)
      .reduce((sum, a) => sum + a.loads.reduce((s, l) => s + l.periods, 0), 0);
    const proxyLoad = substitutions.filter(s => 
      s.substituteTeacherId === teacherId && 
      currentWeekDates.includes(s.date) &&
      !s.isArchived 
    ).length;
    return { base: baseLoad, proxy: proxyLoad, total: baseLoad + proxyLoad };
  }, [assignments, substitutions, currentWeekDates]);

  const isTeacherAvailable = useCallback((teacherId: string, dateStr: string, slotId: number) => {
    // 1. Must be physically present (Attendance check)
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;

    // 2. Must not have a scheduled class in the master timetable
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => 
      t.teacherId === teacherId && 
      t.day === dayName && 
      t.slotId === slotId
    );
    if (isBusyInTimetable) return false;

    // 3. Must not already be assigned a proxy in this slot
    const isBusyInSubs = substitutions.some(s => 
      s.substituteTeacherId === teacherId && 
      s.date === dateStr && 
      s.slotId === slotId && 
      !s.isArchived
    );
    if (isBusyInSubs) return false;

    return true;
  }, [timetable, substitutions, attendance]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    if (section === 'PRIMARY') return u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY;
    return u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.TEACHER_SENIOR_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY;
  }, []);

  const activeSubs = useMemo(() => substitutions.filter(s => !s.isArchived), [substitutions]);
  const dateFilteredSubs = useMemo(() => activeSubs.filter(s => s.date === selectedDate), [activeSubs, selectedDate]);

  const filteredSubs = useMemo(() => {
    if (isManagement) {
      return dateFilteredSubs.filter(s => {
        if (activeSection === 'PRIMARY') return s.section === 'PRIMARY';
        return s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS';
      });
    }
    return dateFilteredSubs.filter(s => s.substituteTeacherId === user.id);
  }, [dateFilteredSubs, isManagement, activeSection, user]);

  const handleAutoDetect = async () => {
    setIsProcessing(true);
    // Simulate processing for better UX
    await new Promise(r => setTimeout(r, 600));

    const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
    const sectionTimetable = timetable.filter(t => t.section === activeSection && t.day === dayName);
    
    if (sectionTimetable.length === 0) {
      setStatus({ type: 'warning', message: `Sweep Complete: No timetable found for ${activeSection} on ${dayName}.` });
      setIsProcessing(false);
      return;
    }

    let newSubs: SubstitutionRecord[] = [];
    sectionTimetable.forEach(entry => {
      // Logic: Teacher is absent if no attendance or marked medical
      const attRecord = attendance.find(a => a.userId === entry.teacherId && a.date === selectedDate);
      const isAbsent = !attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL';
      
      // Prevent duplication in the ledger
      const alreadyListed = substitutions.some(s => 
        s.date === selectedDate && 
        s.slotId === entry.slotId && 
        s.className === entry.className && 
        !s.isArchived
      );

      if (isAbsent && !alreadyListed) {
        newSubs.push({
          id: `auto-${entry.className}-${entry.slotId}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          date: selectedDate,
          slotId: entry.slotId,
          className: entry.className,
          subject: entry.subject,
          absentTeacherId: entry.teacherId,
          absentTeacherName: entry.teacherName,
          substituteTeacherId: '',
          substituteTeacherName: 'PENDING ASSIGNMENT',
          section: entry.section,
          isArchived: false
        });
      }
    });

    if (newSubs.length > 0) {
      setSubstitutions(prev => [...prev, ...newSubs]);
      setStatus({ type: 'success', message: `Absence Sweep: Found ${newSubs.length} vacancies requiring proxy coverage.` });
    } else {
      setStatus({ type: 'warning', message: "No new vacancies identified. All staff present or already substituted." });
    }
    setIsProcessing(false);
  };

  const handleAutoAssignProxies = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 800));

    let updatedSubs = [...substitutions];
    let assignCount = 0;
    let failCount = 0;

    // Identify pending items for current context
    const pendingIndices = substitutions
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => 
        s.date === selectedDate && 
        s.section === activeSection && 
        !s.isArchived && 
        (!s.substituteTeacherId || s.substituteTeacherName === 'PENDING ASSIGNMENT')
      );

    if (pendingIndices.length === 0) {
      setStatus({ type: 'warning', message: "Deployment Logic: All identified vacancies already have assigned proxies." });
      setIsProcessing(false);
      return;
    }

    pendingIndices.forEach(({ s, idx }) => {
      // Match candidate: must be correct department, free slot, present, and under max workload
      const candidates = users
        .filter(u => u.id !== s.absentTeacherId && isTeacherEligibleForSection(u, s.section))
        .map(u => ({ user: u, load: getTeacherLoadBreakdown(u.id).total }))
        .filter(c => c.load < MAX_WEEKLY_PERIODS && isTeacherAvailable(c.user.id, selectedDate, s.slotId))
        .sort((a, b) => a.load - b.load); // Lowest load balancing

      if (candidates.length > 0) {
        const bestChoice = candidates[0].user;
        const newRecord = { ...updatedSubs[idx], substituteTeacherId: bestChoice.id, substituteTeacherName: bestChoice.name };
        updatedSubs[idx] = newRecord;
        assignCount++;
        if (onAssignment) onAssignment(newRecord);
      } else {
        failCount++;
      }
    });

    if (assignCount > 0) {
      setSubstitutions(updatedSubs);
      if (failCount === 0) {
        setStatus({ type: 'success', message: `Deployment Success: Assigned ${assignCount} departmental proxies.` });
      } else {
        setStatus({ type: 'warning', message: `Partial Success: Deployed ${assignCount} proxies. ${failCount} slots remain vacant due to resource shortage.` });
      }
    } else {
      setStatus({ type: 'error', message: "Critical Shortage: No eligible faculty available for deployment in identified slots." });
    }
    setIsProcessing(false);
  };

  const handleClearActiveView = async () => {
    if (filteredSubs.length === 0) return;
    if (!window.confirm("Archive these records? They will move to the reporting historical database.")) return;
    
    const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
    const idsToArchive = filteredSubs.map(s => s.id);
    
    try {
      if (isCloudActive) {
        const { error } = await supabase.from('substitution_ledger').update({ is_archived: true }).in('id', idsToArchive);
        if (error) throw error;
      }
      setSubstitutions(prev => prev.map(s => idsToArchive.includes(s.id) ? { ...s, isArchived: true } : s));
      setStatus({ type: 'success', message: "Records archived successfully." });
    } catch (e) {
      setStatus({ type: 'error', message: "Sync Error: Database archive operation failed." });
    }
  };

  const handleExportCSV = () => {
    const records = substitutions.filter(s => s.date === selectedDate);
    if (records.length === 0) {
      setStatus({ type: 'error', message: "Export Failed: No data available for this date." });
      return;
    }
    const headers = ["Date", "Slot", "Class", "Subject", "Absentee", "Substitute", "Section"];
    const csv = [headers.join(','), ...records.map(s => [s.date, s.slotId, s.className, s.subject, s.absentTeacherName, s.substituteTeacherName, s.section].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IHIS_Subs_${selectedDate}.csv`;
    a.click();
    setStatus({ type: 'success', message: "CSV manifest exported." });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase">Substitution Ledger</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Institutional Proxy Hub</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManagement && (
            <>
              <button 
                onClick={() => setShowLoadPanel(!showLoadPanel)} 
                className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all shadow-lg ${showLoadPanel ? 'bg-amber-400 text-[#001f3f]' : 'bg-slate-700 text-white hover:bg-slate-800'}`}
              >
                Load Matrix
              </button>
              <button 
                onClick={handleAutoDetect} 
                disabled={isProcessing}
                className="bg-amber-500 hover:bg-amber-600 text-[#001f3f] px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all"
              >
                {isProcessing ? 'Sweeping...' : 'Detect Absences'}
              </button>
              <button 
                onClick={handleAutoAssignProxies} 
                disabled={isProcessing}
                className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all"
              >
                {isProcessing ? 'Deploying...' : 'Auto-Proxy'}
              </button>
              <button 
                onClick={handleClearActiveView} 
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all"
              >
                Archive Active
              </button>
            </>
          )}
          <button onClick={handleExportCSV} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg">Export CSV</button>
        </div>
      </div>

      {status && (
        <div className={`p-4 rounded-2xl border flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
          status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
          status.type === 'warning' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
          'bg-red-50 text-red-600 border-red-100'
        }`}>
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-[10px] font-black uppercase tracking-widest">{status.message}</p>
        </div>
      )}

      {showLoadPanel && (
        <div className="bg-[#00122b] rounded-[2.5rem] p-8 border border-white/10 shadow-2xl animate-in slide-in-from-top duration-500">
           <div className="flex justify-between items-start mb-8">
              <h3 className="text-xl font-black text-white italic uppercase tracking-tight">Departmental Workload Intelligence</h3>
              <div className="flex gap-4">
                 <div className="text-center"><p className="text-[7px] font-black text-slate-400 uppercase">Target</p><p className="text-sm font-black text-white">28</p></div>
                 <div className="text-center"><p className="text-[7px] font-black text-slate-400 uppercase">Ceiling</p><p className="text-sm font-black text-amber-400">35</p></div>
              </div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {users.filter(u => u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF).filter(u => {
                if (activeSection === 'PRIMARY') return u.role.includes('PRIMARY');
                return u.role.includes('SECONDARY');
              }).map(u => {
                const { base, proxy, total } = getTeacherLoadBreakdown(u.id);
                const isOverloaded = total > 28;
                const isCritical = total >= 35;
                const loadPercentage = Math.min(100, (total / 35) * 100);
                return (
                  <div key={u.id} className="bg-white/5 rounded-2xl p-5 border border-white/5">
                     <div className="flex justify-between items-start mb-3">
                        <p className="text-xs font-black text-white truncate pr-2">{u.name}</p>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${isCritical ? 'bg-red-500 text-white animate-pulse' : isOverloaded ? 'bg-amber-400 text-brand-navy' : 'bg-emerald-500 text-white'}`}>{total}</span>
                     </div>
                     <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-2">
                        <div className={`h-full transition-all duration-1000 ${isCritical ? 'bg-red-500' : isOverloaded ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${loadPercentage}%` }}></div>
                     </div>
                     <p className="text-[7px] font-black text-slate-500 uppercase">Week: {base}B + {proxy}P</p>
                  </div>
                );
              })}
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-4 md:p-8 border-b border-gray-100 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between no-print bg-slate-50/50 dark:bg-slate-800/20 gap-4">
           {isManagement ? (
             <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm w-full md:w-auto overflow-x-auto scrollbar-hide">
                {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
                  <button key={s} onClick={() => setActiveSection(s)} className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{s.replace('_', ' ')}</button>
                ))}
             </div>
           ) : <span className="text-[10px] font-black text-amber-600 uppercase italic">Your Assigned Proxies</span>}
           <div className="flex items-center gap-2 bg-white dark:bg-slate-950 px-3 py-2 rounded-xl border border-slate-100 shadow-sm">
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black text-[#001f3f] dark:text-white outline-none" />
           </div>
        </div>

        <div className="flex-1 overflow-x-auto scrollbar-hide">
           <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50">
                  <th className="px-10 py-5">Slot</th>
                  <th className="px-10 py-5">Class Details</th>
                  <th className="px-10 py-5">Absentee</th>
                  <th className="px-10 py-5">Proxy Assigned</th>
                  {isManagement && <th className="px-10 py-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredSubs.map(s => {
                  const isPending = !s.substituteTeacherId || s.substituteTeacherName === 'PENDING ASSIGNMENT';
                  return (
                    <tr key={s.id} className="hover:bg-amber-50/10 transition-colors">
                      <td className="px-10 py-6 font-black text-sm text-[#001f3f] dark:text-white italic">Period {s.slotId}</td>
                      <td className="px-10 py-6">
                         <p className="font-black text-sm text-[#001f3f] dark:text-white">{s.className}</p>
                         <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.subject}</p>
                      </td>
                      <td className="px-10 py-6 font-black text-xs text-red-500 uppercase">{s.absentTeacherName}</td>
                      <td className="px-10 py-6">
                        <span className={`text-xs font-black uppercase ${isPending ? 'text-amber-500 italic' : 'text-emerald-600'}`}>
                          {s.substituteTeacherName}
                        </span>
                      </td>
                      {isManagement && (
                        <td className="px-10 py-6 text-right">
                          <button onClick={() => setSubstitutions(prev => prev.filter(x => x.id !== s.id))} className="text-[10px] font-black uppercase text-red-500 hover:underline transition-all">Remove</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
           </table>
           {filteredSubs.length === 0 && (
             <div className="py-24 text-center">
                <p className="text-[10px] font-black uppercase text-slate-300 tracking-[0.5em]">No active vacancies in current view</p>
             </div>
           )}
        </div>
      </div>
      
      <div className="text-center pb-12">
         <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em] italic">{SCHOOL_NAME} • Institutional Ledger System</p>
      </div>
    </div>
  );
};

export default SubstitutionView;

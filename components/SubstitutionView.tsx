import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SectionType, TeacherAssignment, SchoolConfig } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>('DAILY');
  const [formData, setFormData] = useState<SubFormData>({
    slotId: 1,
    className: '',
    subject: '',
    absentTeacherId: '',
    substituteTeacherId: '',
    section: 'PRIMARY'
  });
  
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.INCHARGE_ALL;
  const MAX_WEEKLY_PERIODS = 35;

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
      currentWeekDates.includes(s.date)
    ).length;
    return { base: baseLoad, proxy: proxyLoad, total: baseLoad + proxyLoad };
  }, [assignments, substitutions, currentWeekDates]);

  const isTeacherAvailable = useCallback((teacherId: string, dateStr: string, slotId: number) => {
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => t.teacherId === teacherId && t.day === dayName && t.slotId === slotId);
    if (isBusyInTimetable) return false;
    const isBusyInSubs = substitutions.some(s => s.substituteTeacherId === teacherId && s.date === dateStr && s.slotId === slotId);
    if (isBusyInSubs) return false;
    return true;
  }, [timetable, substitutions]);

  // Departmental eligibility helper
  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    if (section === 'PRIMARY') {
      return u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY;
    } else {
      // Secondary Boys or Girls sections both use Secondary/Senior Secondary faculty
      return u.role === UserRole.TEACHER_SECONDARY || 
             u.role === UserRole.TEACHER_SENIOR_SECONDARY || 
             u.role === UserRole.INCHARGE_SECONDARY;
    }
  }, []);

  const dateFilteredSubs = useMemo(() => {
    return substitutions.filter(s => s.date === selectedDate);
  }, [substitutions, selectedDate]);

  const filteredSubs = useMemo(() => {
    if (isManagement) {
      return dateFilteredSubs.filter(s => {
        if (activeSection === 'PRIMARY') return s.section === 'PRIMARY';
        return s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS';
      });
    }
    return dateFilteredSubs.filter(s => s.substituteTeacherId === user.id);
  }, [dateFilteredSubs, isManagement, activeSection, user]);

  const handleAutoAssignProxies = () => {
    let updatedSubs = [...substitutions];
    let assignCount = 0;
    let skippedCount = 0;

    const pendingIndices = substitutions
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.date === selectedDate && s.substituteTeacherId === '' && s.section === activeSection);

    pendingIndices.forEach(({ s, idx }) => {
      // Strictly filter candidates by department/section
      const candidates = users
        .filter(u => u.id !== s.absentTeacherId && isTeacherEligibleForSection(u, s.section))
        .map(u => ({ user: u, load: getTeacherLoadBreakdown(u.id).total }))
        .filter(c => c.load < MAX_WEEKLY_PERIODS && isTeacherAvailable(c.user.id, selectedDate, s.slotId))
        .sort((a, b) => a.load - b.load);

      if (candidates.length > 0) {
        const bestChoice = candidates[0].user;
        const newRecord = {
          ...updatedSubs[idx],
          substituteTeacherId: bestChoice.id,
          substituteTeacherName: bestChoice.name
        };
        updatedSubs[idx] = newRecord;
        assignCount++;
        if (onAssignment) onAssignment(newRecord);
      } else {
        skippedCount++;
      }
    });

    if (assignCount > 0) {
      setSubstitutions(updatedSubs);
      setStatus({ type: 'success', message: `Intelligence Engine: ${assignCount} departmental proxies deployed.` });
    } else if (skippedCount > 0) {
      setStatus({ type: 'error', message: `Allocation Fail: No available faculty within the ${activeSection.replace('_', ' ')} department.` });
    }
  };

  const handleAutoDetect = () => {
    const dayName = new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
    const sectionTimetable = timetable.filter(t => t.section === activeSection && t.day === dayName);
    
    let newSubs: SubstitutionRecord[] = [];
    let detectCount = 0;

    sectionTimetable.forEach(entry => {
      const isPresent = attendance.some(a => a.userId === entry.teacherId && a.date === selectedDate && !!a.checkIn);
      const alreadySubstituted = substitutions.some(s => s.date === selectedDate && s.slotId === entry.slotId && s.className === entry.className);

      if (!isPresent && !alreadySubstituted) {
        newSubs.push({
          id: `auto-detect-${entry.className}-${entry.slotId}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          date: selectedDate,
          slotId: entry.slotId,
          className: entry.className,
          subject: entry.subject,
          absentTeacherId: entry.teacherId,
          absentTeacherName: entry.teacherName,
          substituteTeacherId: '',
          substituteTeacherName: 'PENDING ASSIGNMENT',
          section: entry.section
        });
        detectCount++;
      }
    });

    if (newSubs.length > 0) {
      setSubstitutions(prev => [...prev, ...newSubs]);
      setStatus({ type: 'success', message: `Absence Detection: Identified ${detectCount} missing faculty slots.` });
    } else {
      setStatus({ type: 'warning', message: 'Detection Sweep: No unhandled absences identified in this section.' });
    }
  };

  const handleExportCSV = () => {
    const d = new Date(selectedDate);
    let recordsToExport = [...substitutions];

    // 1. Filter by Date Range
    if (exportPeriod === 'DAILY') {
      recordsToExport = recordsToExport.filter(s => s.date === selectedDate);
    } else if (exportPeriod === 'WEEKLY') {
      const week = getWeekDatesForDate(selectedDate);
      recordsToExport = recordsToExport.filter(s => week.includes(s.date));
    } else if (exportPeriod === 'MONTHLY') {
      const month = d.getMonth();
      const year = d.getFullYear();
      recordsToExport = recordsToExport.filter(s => {
        const recordDate = new Date(s.date);
        return recordDate.getMonth() === month && recordDate.getFullYear() === year;
      });
    }

    // 2. Filter by User Role Permission
    if (!isAdmin) {
      if (user.role === UserRole.INCHARGE_PRIMARY) {
        recordsToExport = recordsToExport.filter(s => s.section === 'PRIMARY');
      } else if (user.role === UserRole.INCHARGE_SECONDARY) {
        recordsToExport = recordsToExport.filter(s => s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS');
      } else {
        // Teachers only see their own substitutions
        recordsToExport = recordsToExport.filter(s => s.substituteTeacherId === user.id);
      }
    }

    if (recordsToExport.length === 0) {
      setStatus({ type: 'warning', message: 'No records found for the selected export range.' });
      return;
    }

    // 3. Generate CSV
    const headers = ["Date", "Period", "Class", "Subject", "Absent Teacher", "Substitute Teacher", "Department"];
    const csvContent = [
      headers.join(','),
      ...recordsToExport.sort((a, b) => a.date.localeCompare(b.date) || a.slotId - b.slotId).map(s => [
        s.date,
        `Period ${s.slotId}`,
        s.className,
        s.subject,
        `"${s.absentTeacherName}"`,
        `"${s.substituteTeacherName}"`,
        s.section
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `IHIS_Substitutions_${exportPeriod}_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus({ type: 'success', message: `${exportPeriod} CSV Export Completed.` });
  };

  const handleAddManual = () => {
    setFormData({
      slotId: 1,
      className: '',
      subject: '',
      absentTeacherId: '',
      substituteTeacherId: '',
      section: activeSection
    });
    setIsModalOpen(true);
  };

  const saveSubstitution = () => {
    const absentT = users.find(u => u.id === formData.absentTeacherId);
    const subT = users.find(u => u.id === formData.substituteTeacherId);
    
    if (!absentT || !formData.className || !formData.subject) {
      setStatus({ type: 'error', message: 'Data Incomplete.' });
      return;
    }

    if (subT) {
      // Final departmental check for manual entry security
      if (!isTeacherEligibleForSection(subT, formData.section)) {
        setStatus({ type: 'error', message: `Compliance Error: Cross-department substitution is strictly prohibited.` });
        return;
      }

      const { total } = getTeacherLoadBreakdown(subT.id);
      if (!isTeacherAvailable(subT.id, selectedDate, formData.slotId)) {
        const isOriginalSub = filteredSubs.find(s => s.id === formData.id)?.substituteTeacherId === subT.id;
        if (!isOriginalSub) {
          setStatus({ type: 'error', message: `Conflict: ${subT.name} already assigned to another duty/class.` });
          return;
        }
      }
      const isOriginalSub = filteredSubs.find(s => s.id === formData.id)?.substituteTeacherId === subT.id;
      if (!isOriginalSub && total >= MAX_WEEKLY_PERIODS) {
        setStatus({ type: 'error', message: `Limit Reached: ${subT.name} is at maximum institutional load (35/35).` });
        return;
      }
    }

    const subRecord: SubstitutionRecord = {
      id: formData.id || `manual-${Date.now()}`,
      date: selectedDate, slotId: formData.slotId, className: formData.className,
      subject: formData.subject, absentTeacherId: absentT.id,
      absentTeacherName: absentT.name, substituteTeacherId: subT?.id || '',
      substituteTeacherName: subT?.name || 'PENDING ASSIGNMENT', section: formData.section
    };
    
    if (formData.id) {
      setSubstitutions(prev => prev.map(s => s.id === formData.id ? subRecord : s));
    } else {
      setSubstitutions(prev => [...prev, subRecord]);
    }
    
    if (subRecord.substituteTeacherId && onAssignment) onAssignment(subRecord);
    
    setIsModalOpen(false);
    setStatus({ type: 'success', message: 'Registry updated with departmental check.' });
  };

  const modalSlots = formData.section === 'PRIMARY' ? PRIMARY_SLOTS : formData.section === 'SECONDARY_GIRLS' ? SECONDARY_GIRLS_SLOTS : SECONDARY_BOYS_SLOTS;

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic">Substitution Ledger</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Strict Departmental Compliance Enabled</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Export Controls - Available to all but role-filtered */}
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm mr-2">
            {(['DAILY', 'WEEKLY', 'MONTHLY'] as ExportPeriod[]).map(p => (
              <button key={p} onClick={() => setExportPeriod(p)} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${exportPeriod === p ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{p}</button>
            ))}
          </div>
          <button onClick={handleExportCSV} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all flex items-center space-x-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span>Export CSV</span>
          </button>

          {isManagement && (
            <>
              <button onClick={() => setShowLoadPanel(!showLoadPanel)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg transition-all ${showLoadPanel ? 'bg-amber-400 text-navy' : 'bg-slate-700 text-white'}`}>
                {showLoadPanel ? 'Hide Load Matrix' : 'Load Analytics'}
              </button>
              <button onClick={handleAutoDetect} className="bg-amber-500 text-[#001f3f] px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">Detect Absences</button>
              <button onClick={handleAutoAssignProxies} className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">Auto-Proxy</button>
              <button onClick={handleAddManual} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">+ Manual</button>
            </>
          )}
        </div>
      </div>

      {showLoadPanel && (
        <div className="bg-[#001f3f] rounded-[2rem] p-6 md:p-8 shadow-2xl border border-white/10 animate-in slide-in-from-top duration-500">
           <div className="flex items-center justify-between mb-6">
              <h3 className="text-[#d4af37] text-sm font-black uppercase italic tracking-widest">Faculty Weekly Load Matrix</h3>
              <p className="text-[8px] text-white/40 font-bold uppercase">Week: {currentWeekDates[0]} - {currentWeekDates[4]}</p>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {users.filter(u => u.role.startsWith('TEACHER_')).map(u => {
                const { base, proxy, total } = getTeacherLoadBreakdown(u.id);
                const percentage = Math.min((total / MAX_WEEKLY_PERIODS) * 100, 100);
                const isHeavy = total >= 30;
                const isFull = total >= 35;
                const deptLabel = (u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY) ? 'PRM' : 'SEC';
                return (
                  <div key={u.id} className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col justify-between hover:bg-white/10 transition-colors">
                     <div className="flex justify-between items-start mb-2">
                        <div>
                           <p className="text-white text-[11px] font-black">{u.name} <span className="text-[8px] opacity-40 ml-1">({deptLabel})</span></p>
                           <p className="text-[7px] text-white/40 font-bold uppercase tracking-widest">{u.employeeId}</p>
                        </div>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-lg ${isFull ? 'bg-red-500 text-white' : isHeavy ? 'bg-amber-500 text-navy' : 'bg-emerald-500 text-white'}`}>
                          {total}/35
                        </span>
                     </div>
                     <div className="space-y-2">
                        <div className="flex justify-between text-[7px] font-bold text-white/60 uppercase">
                           <span>Base: {base}</span>
                           <span>Proxy: {proxy}</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                           <div className={`h-full transition-all duration-1000 ${isFull ? 'bg-red-500' : isHeavy ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${percentage}%` }}></div>
                        </div>
                     </div>
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
           ) : (
             <div className="bg-amber-100 dark:bg-amber-900/20 px-4 py-2 rounded-xl border border-amber-200">
                <span className="text-[10px] font-black text-amber-600 uppercase">Your Assignments</span>
             </div>
           )}
           <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
             {status && (
               <div className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600' : status.type === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>{status.message}</div>
             )}
             <div className="flex items-center gap-2 bg-white dark:bg-slate-950 px-3 py-2 rounded-xl border border-slate-100 shadow-sm w-full sm:w-auto">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Date:</span>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black text-[#001f3f] dark:text-white outline-none flex-1" />
             </div>
           </div>
        </div>

        <div className="flex-1 overflow-x-auto print:block">
           <table id="substitution-ledger-printable" className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/50">
                  <th className="px-8 py-5">Slot</th>
                  <th className="px-8 py-5">Room</th>
                  <th className="px-8 py-5">Absent Faculty</th>
                  <th className="px-8 py-5">Proxy Faculty Status</th>
                  <th className="px-8 py-5 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredSubs.map(s => {
                  const { base, proxy, total } = s.substituteTeacherId ? getTeacherLoadBreakdown(s.substituteTeacherId) : { base:0, proxy:0, total:0 };
                  return (
                    <tr key={s.id} className="hover:bg-amber-50/10 transition-all group">
                      <td className="px-8 py-6 font-black text-xs text-[#001f3f] dark:text-slate-400">P{s.slotId}</td>
                      <td className="px-8 py-6">
                         <p className="font-black text-sm text-[#001f3f] dark:text-white">{s.className}</p>
                         <p className="text-[8px] font-bold text-slate-400 uppercase">{s.subject}</p>
                      </td>
                      <td className="px-8 py-6">
                         <p className="font-bold text-xs text-red-500">{s.absentTeacherName}</p>
                         <p className="text-[7px] font-black text-red-300 uppercase">OFF-DUTY</p>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                          <span className={`text-xs font-black ${s.substituteTeacherId ? 'text-emerald-600' : 'text-amber-500 italic'}`}>{s.substituteTeacherName}</span>
                          {s.substituteTeacherId && (
                            <div className="flex items-center space-x-2 mt-1">
                               <span className={`text-[7px] font-bold uppercase tracking-widest ${total >= 30 ? 'text-red-500' : 'text-slate-400'}`}>Total: {total}/35</span>
                               <span className="text-[6px] text-slate-300 font-bold uppercase">(B: {base} | P: {proxy})</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right no-print">
                        <div className="flex items-center justify-end space-x-4">
                          {isManagement ? (
                            <>
                              <button onClick={() => {
                                setFormData({ id: s.id, slotId: s.slotId, className: s.className, subject: s.subject, absentTeacherId: s.absentTeacherId, substituteTeacherId: s.substituteTeacherId, section: s.section });
                                setIsModalOpen(true);
                              }} className="text-[10px] font-black uppercase text-sky-600 hover:underline">Reassign</button>
                              <button onClick={() => setSubstitutions(prev => prev.filter(x => x.id !== s.id))} className="text-[10px] font-black uppercase text-red-500 hover:underline">Clear</button>
                            </>
                          ) : (
                            <span className="text-[8px] font-black text-slate-400 uppercase">ReadOnly</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
           </table>
           {filteredSubs.length === 0 && (
             <div className="py-20 text-center opacity-30"><p className="text-[10px] font-black uppercase tracking-[0.4em]">Grid Clean for {selectedDate}</p></div>
           )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Manual Proxy Entry</h4>
                <p className="text-[10px] font-black text-sky-600 uppercase tracking-widest mt-1">Section: {formData.section.replace('_', ' ')}</p>
             </div>
             <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Slot</label>
                     <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={formData.slotId} onChange={e => setFormData({...formData, slotId: parseInt(e.target.value)})}>
                       {modalSlots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                     </select>
                  </div>
                  <div className="space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Room</label>
                     <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={formData.className} onChange={e => setFormData({...formData, className: e.target.value})}>
                       <option value="">Room...</option>
                       {config.classes.filter(c => c.section === activeSection).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                     </select>
                  </div>
                </div>
                <div className="space-y-1">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Departmental Proxy (Weekly Load)</label>
                   <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={formData.substituteTeacherId} onChange={e => setFormData({...formData, substituteTeacherId: e.target.value})}>
                     <option value="">Select Candidate...</option>
                     {users
                       .filter(u => isTeacherEligibleForSection(u, formData.section))
                       .map(u => {
                         const { base, proxy, total } = getTeacherLoadBreakdown(u.id);
                         const isFree = isTeacherAvailable(u.id, selectedDate, formData.slotId);
                         return (
                           <option key={u.id} value={u.id} disabled={!isFree || total >= MAX_WEEKLY_PERIODS}>
                             {u.name} (T: {total}/35 | B: {base} | P: {proxy}) {!isFree ? '- BUSY' : total >= MAX_WEEKLY_PERIODS ? '- LOAD EXCEEDED' : ''}
                           </option>
                         );
                       })}
                   </select>
                </div>
                <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject</label><select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})}><option value="">Subject...</option>{config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Absentee</label>
                  <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={formData.absentTeacherId} onChange={e => setFormData({...formData, absentTeacherId: e.target.value})}>
                    <option value="">Absentee...</option>
                    {users
                      .filter(u => isTeacherEligibleForSection(u, formData.section))
                      .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
             </div>
             <div className="flex flex-col space-y-3 pt-4"><button onClick={saveSubstitution} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[11px] uppercase tracking-[0.3em] shadow-xl hover:bg-slate-900 active:scale-95 transition-all">Authorize Assignment</button><button onClick={() => setIsModalOpen(false)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest text-center">Abort</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;
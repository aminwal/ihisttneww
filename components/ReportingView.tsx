
import React, { useState, useMemo } from 'react';
import { User, AttendanceRecord, SchoolConfig, UserRole, SubstitutionRecord } from '../types.ts';
import { SCHOOL_NAME } from '../constants.ts';

// Declare html2pdf for TypeScript
declare var html2pdf: any;

interface ReportingViewProps {
  user: User;
  users: User[];
  attendance: AttendanceRecord[];
  config: SchoolConfig;
  substitutions: SubstitutionRecord[];
}

const ReportingView: React.FC<ReportingViewProps> = ({ user, users, attendance, config, substitutions }) => {
  const [reportType, setReportType] = useState<'ATTENDANCE' | 'SUBSTITUTION'>('ATTENDANCE');
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [departmentFilter, setDepartmentFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY'>('ALL');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<'ALL' | 'LATE' | 'MEDICAL'>('ALL');
  const [absentTeacherFilter, setAbsentTeacherFilter] = useState<string>('ALL');
  const [substituteTeacherFilter, setSubstituteTeacherFilter] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  const isAdminOrPrincipal = user.role === UserRole.ADMIN || user.role === UserRole.INCHARGE_ALL;
  const isPrimaryIncharge = user.role === UserRole.INCHARGE_PRIMARY;
  const isSecondaryIncharge = user.role === UserRole.INCHARGE_SECONDARY;
  const isTeacher = user.role.startsWith('TEACHER_');

  const facultyList = useMemo(() => {
    return users.filter(u => u.role !== UserRole.ADMIN).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const handleDownloadPDF = async () => {
    setIsExporting(true);
    const element = document.getElementById('reporting-content');
    if (!element) return;
    const opt = {
      margin: [10, 5, 10, 5],
      filename: `IHIS_${reportType}_Audit_${dateRange.start}_to_${dateRange.end}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    try {
      if (typeof html2pdf !== 'undefined') await html2pdf().set(opt).from(element).save();
    } finally {
      setIsExporting(false);
    }
  };

  const filteredSubs = useMemo(() => {
    return substitutions.filter(s => {
      // 1. Date Range Filter
      const isWithinDate = s.date >= dateRange.start && s.date <= dateRange.end;
      if (!isWithinDate) return false;

      // 2. Personnel Filters
      if (absentTeacherFilter !== 'ALL' && s.absentTeacherId !== absentTeacherFilter) return false;
      if (substituteTeacherFilter !== 'ALL' && s.substituteTeacherId !== substituteTeacherFilter) return false;

      // 3. Role-Based Visibility & Department Logic
      if (isAdminOrPrincipal) {
         if (departmentFilter === 'PRIMARY') return s.section === 'PRIMARY';
         if (departmentFilter === 'SECONDARY') return s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS';
         return true;
      }

      if (isPrimaryIncharge) return s.section === 'PRIMARY';
      if (isSecondaryIncharge) return s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS';
      if (isTeacher) return s.substituteTeacherId === user.id || s.absentTeacherId === user.id;

      return false;
    });
  }, [substitutions, dateRange, departmentFilter, user, isAdminOrPrincipal, isPrimaryIncharge, isSecondaryIncharge, isTeacher, absentTeacherFilter, substituteTeacherFilter]);

  const filteredAttendance = useMemo(() => {
    return attendance.filter(r => {
      const isWithinDate = r.date >= dateRange.start && r.date <= dateRange.end;
      if (!isWithinDate) return false;
      
      // Status filtering logic
      if (attendanceStatusFilter === 'LATE' && !r.isLate) return false;
      if (attendanceStatusFilter === 'MEDICAL' && r.checkIn !== 'MEDICAL') return false;

      const targetUser = users.find(u => u.id === r.userId);
      if (!targetUser) return false;

      if (isAdminOrPrincipal) {
        if (departmentFilter === 'PRIMARY') return targetUser.role.includes('PRIMARY');
        if (departmentFilter === 'SECONDARY') return targetUser.role.includes('SECONDARY');
        return true;
      }
      
      if (isPrimaryIncharge) return targetUser.role.includes('PRIMARY');
      if (isSecondaryIncharge) return targetUser.role.includes('SECONDARY');
      if (isTeacher) return targetUser.id === user.id;
      
      return false;
    });
  }, [attendance, users, dateRange, departmentFilter, user, isAdminOrPrincipal, isPrimaryIncharge, isSecondaryIncharge, isTeacher, attendanceStatusFilter]);

  const schoolDaysInRange = useMemo(() => {
    const days: string[] = [];
    let curr = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    let safety = 0;
    while (curr <= end && safety < 400) {
      const dayOfWeek = curr.getDay(); 
      if (dayOfWeek >= 0 && dayOfWeek <= 4) days.push(curr.toISOString().split('T')[0]);
      curr.setDate(curr.getDate() + 1);
      safety++;
    }
    return days;
  }, [dateRange]);

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-700 pb-24 px-2">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Institutional Analytics</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Analytical Intelligence Hub</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
             <button onClick={() => setReportType('ATTENDANCE')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${reportType === 'ATTENDANCE' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Attendance</button>
             <button onClick={() => setReportType('SUBSTITUTION')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${reportType === 'SUBSTITUTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Substitutions</button>
          </div>

          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
             <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
             <span className="text-slate-300 font-bold">to</span>
             <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
          </div>

          <button onClick={handleDownloadPDF} disabled={isExporting} className="px-5 py-3 bg-[#001f3f] text-[#d4af37] border border-[#d4af37]/30 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-slate-900 transition-all flex items-center gap-3">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
             {isExporting ? 'Generating...' : 'Export Audit'}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-lg no-print flex flex-wrap gap-4 items-center">
        <div className="flex flex-col gap-1.5 min-w-[140px]">
          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Department</label>
          <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700">
            {(['ALL', 'PRIMARY', 'SECONDARY'] as const).map(dept => (
              <button key={dept} onClick={() => setDepartmentFilter(dept)} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${departmentFilter === dept ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-[#d4af37] shadow-sm' : 'text-slate-400'}`}>{dept}</button>
            ))}
          </div>
        </div>

        {reportType === 'ATTENDANCE' && (
          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Engagement Filter</label>
            <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700">
              {(['ALL', 'LATE', 'MEDICAL'] as const).map(status => (
                <button key={status} onClick={() => setAttendanceStatusFilter(status)} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all ${attendanceStatusFilter === status ? 'bg-white dark:bg-slate-700 text-[#001f3f] dark:text-[#d4af37] shadow-sm' : 'text-slate-400'}`}>{status}</button>
              ))}
            </div>
          </div>
        )}

        {reportType === 'SUBSTITUTION' && (
          <>
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Absentee Faculty</label>
              <select value={absentTeacherFilter} onChange={e => setAbsentTeacherFilter(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl px-4 py-2 text-[10px] font-bold dark:text-white outline-none">
                <option value="ALL">All Absentees</option>
                {facultyList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Substitute Faculty</label>
              <select value={substituteTeacherFilter} onChange={e => setSubstituteTeacherFilter(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl px-4 py-2 text-[10px] font-bold dark:text-white outline-none">
                <option value="ALL">All Proxies</option>
                {facultyList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      <div id="reporting-content" className="space-y-8 bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[500px]">
        <div className="flex justify-between items-start border-b-2 border-slate-100 dark:border-slate-800 pb-8 mb-8">
           <div>
              <h2 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
                {reportType === 'ATTENDANCE' ? 'Engagement Registry Audit' : 'Detailed Substitution Ledger'}
              </h2>
              <div className="flex gap-4 mt-2">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Period: {dateRange.start} — {dateRange.end}</p>
                 {reportType === 'ATTENDANCE' && attendanceStatusFilter !== 'ALL' && (
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest italic">Filter: {attendanceStatusFilter} Only</p>
                 )}
              </div>
           </div>
           <div className="text-right">
              <p className="text-[12px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] mb-1">{SCHOOL_NAME}</p>
              <p className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Confidential Audit Log</p>
           </div>
        </div>

        {reportType === 'ATTENDANCE' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50">
                  <th className="px-6 py-4 rounded-l-xl">Faculty Personnel</th>
                  <th className="px-6 py-4 text-center">Engagement (P/A/M)</th>
                  <th className="px-6 py-4 text-center">Late Stamps</th>
                  <th className="px-6 py-4 text-right rounded-r-xl">Engagement Index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {users.filter(u => {
                   if (isAdminOrPrincipal) return u.role !== UserRole.ADMIN;
                   if (isPrimaryIncharge) return u.role.includes('PRIMARY');
                   if (isSecondaryIncharge) return u.role.includes('SECONDARY');
                   return u.id === user.id;
                }).filter(u => {
                   // Only show people with relevant records when filtered
                   const uRecs = filteredAttendance.filter(r => r.userId === u.id);
                   if (attendanceStatusFilter !== 'ALL' && uRecs.length === 0) return false;
                   return true;
                }).map(u => {
                  const uRecords = filteredAttendance.filter(r => r.userId === u.id);
                  const totalPossible = schoolDaysInRange.length || 1;
                  const p = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
                  const m = uRecords.filter(r => r.checkIn === 'MEDICAL').length;
                  const a = Math.max(0, totalPossible - (p + m));
                  const lates = uRecords.filter(r => r.isLate).length;
                  const engagement = (((p - lates) / totalPossible) * 100).toFixed(1);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-8">
                        <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{u.name}</p>
                        <p className="text-[8px] font-black text-slate-400 uppercase mt-1 tracking-widest">{u.employeeId} | {u.role.replace(/_/g, ' ')}</p>
                      </td>
                      <td className="px-6 py-8 text-center">
                         <div className="flex justify-center gap-2">
                            <span className="text-[9px] font-black px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">P: {p}</span>
                            <span className="text-[9px] font-black px-3 py-1 rounded-full bg-red-50 text-red-500 border border-red-100">A: {a}</span>
                            <span className="text-[9px] font-black px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">M: {m}</span>
                         </div>
                      </td>
                      <td className="px-6 py-8 text-center font-black text-amber-500 text-sm">{lates}</td>
                      <td className="px-6 py-8 text-right font-black text-[#001f3f] dark:text-white tabular-nums text-sm">{engagement}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAttendance.length === 0 && (
              <div className="py-24 text-center">
                 <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">No attendance data identified for selected parameters</p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50">
                  <th className="px-6 py-4 rounded-l-xl">Date & Slot</th>
                  <th className="px-6 py-4">Class & Subject</th>
                  <th className="px-6 py-4">Personnel Breakdown</th>
                  <th className="px-6 py-4 text-center">Section</th>
                  <th className="px-6 py-4 text-right rounded-r-xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredSubs.sort((a,b) => b.date.localeCompare(a.date)).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-8">
                       <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{s.date}</p>
                       <p className="text-[9px] font-black text-amber-500 uppercase tracking-[0.3em] mt-1">Period: {s.slotId}</p>
                    </td>
                    <td className="px-6 py-8">
                       <p className="font-black text-sm text-[#001f3f] dark:text-white">{s.className}</p>
                       <p className="text-[9px] font-black text-sky-600 uppercase tracking-widest mt-1 italic">{s.subject}</p>
                    </td>
                    <td className="px-6 py-8">
                       <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                             <span className="text-[7px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded">ABS</span>
                             <p className="text-[10px] font-black text-slate-500 uppercase">{s.absentTeacherName}</p>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="text-[7px] font-black bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">PRX</span>
                             <p className="text-[10px] font-black text-emerald-600 uppercase italic">{s.substituteTeacherName}</p>
                          </div>
                       </div>
                    </td>
                    <td className="px-6 py-8 text-center">
                       <span className="text-[8px] font-black px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 uppercase text-slate-400 tracking-tighter">
                         {s.section.replace(/_/g, ' ')}
                       </span>
                    </td>
                    <td className="px-6 py-8 text-right">
                       <span className={`text-[8px] font-black px-4 py-1.5 rounded-full border uppercase tracking-widest ${
                         s.isArchived 
                           ? 'bg-slate-100 text-slate-400 border-slate-200' 
                           : 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-sm animate-pulse'
                       }`}>
                         {s.isArchived ? 'Archive' : 'Active Duty'}
                       </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredSubs.length === 0 && (
              <div className="py-24 text-center">
                 <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">No substitution logs identified for selected parameters</p>
              </div>
            )}
          </div>
        )}

        <div className="p-10 bg-slate-50 dark:bg-slate-800/20 text-center rounded-[2.5rem] border border-slate-100 dark:border-slate-800 mt-12">
           <p className="text-[11px] font-black text-[#001f3f]/30 dark:text-white/20 uppercase tracking-[0.6em]">System Audit Integrity Verified</p>
           <div className="flex items-center justify-center gap-8 mt-6">
              <div className="text-left">
                 <p className="text-[8px] font-black text-slate-400 uppercase">Officer in Charge</p>
                 <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{user.name}</p>
              </div>
              <div className="w-px h-8 bg-slate-200 dark:bg-slate-700"></div>
              <div className="text-left">
                 <p className="text-[8px] font-black text-slate-400 uppercase">Audit Timestamp</p>
                 <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{new Date().toLocaleString()}</p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default ReportingView;

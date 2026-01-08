
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
  const [showArchived, setShowArchived] = useState(true);
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

      // 2. Archive Filter
      if (!showArchived && s.isArchived) return false;

      // 3. Personnel Filters
      if (absentTeacherFilter !== 'ALL' && s.absentTeacherId !== absentTeacherFilter) return false;
      if (substituteTeacherFilter !== 'ALL' && s.substituteTeacherId !== substituteTeacherFilter) return false;

      // 4. Department Logic
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
  }, [substitutions, dateRange, departmentFilter, user, isAdminOrPrincipal, isPrimaryIncharge, isSecondaryIncharge, isTeacher, absentTeacherFilter, substituteTeacherFilter, showArchived]);

  const filteredAttendance = useMemo(() => {
    return attendance.filter(r => {
      const isWithinDate = r.date >= dateRange.start && r.date <= dateRange.end;
      if (!isWithinDate) return false;
      
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
          <button onClick={handleDownloadPDF} disabled={isExporting} className="px-5 py-3 bg-[#001f3f] text-[#d4af37] border border-[#d4af37]/30 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-slate-900 transition-all flex items-center gap-3">
             {isExporting ? 'Generating...' : 'Export Audit'}
          </button>
        </div>
      </div>

      <div id="reporting-content" className="space-y-8 bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[600px]">
        {reportType === 'ATTENDANCE' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-6">Faculty Personnel</th>
                  <th className="px-6 py-6 text-center">Engagement Index</th>
                  <th className="px-6 py-6 text-right">Reliability Index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {users.filter(u => {
                   if (isAdminOrPrincipal) return u.role !== UserRole.ADMIN;
                   if (isPrimaryIncharge) return u.role.includes('PRIMARY');
                   if (isSecondaryIncharge) return u.role.includes('SECONDARY');
                   return u.id === user.id;
                }).map(u => {
                  const uRecords = filteredAttendance.filter(r => r.userId === u.id);
                  const totalPossible = schoolDaysInRange.length || 1;
                  const p = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
                  const engagement = ((p / totalPossible) * 100).toFixed(1);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors stagger-row">
                      <td className="px-6 py-8">
                        <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{u.name}</p>
                        <p className="text-[8px] font-black text-slate-400 uppercase mt-1.5 tracking-widest">{u.employeeId}</p>
                      </td>
                      <td className="px-6 py-8 text-center font-black text-amber-500 text-sm">{p} Days Checked</td>
                      <td className="px-6 py-8 text-right font-black text-[#001f3f] dark:text-white tabular-nums text-sm">{engagement}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-6">Date & Period</th>
                  <th className="px-6 py-6">Division</th>
                  <th className="px-6 py-6">Personnel deployment</th>
                  <th className="px-6 py-6 text-right">Audit status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredSubs.sort((a,b) => b.date.localeCompare(a.date)).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors stagger-row">
                    <td className="px-6 py-8">
                       <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{s.date}</p>
                       <p className="text-[9px] font-black text-amber-500 uppercase tracking-[0.3em] mt-1.5">Slot: P{s.slotId}</p>
                    </td>
                    <td className="px-6 py-8">
                       <p className="font-black text-sm text-[#001f3f] dark:text-white leading-none">{s.className}</p>
                       <p className="text-[9px] font-black text-sky-600 uppercase tracking-widest mt-1.5 italic leading-none">{s.subject}</p>
                    </td>
                    <td className="px-6 py-8">
                       <div className="space-y-1">
                          <p className="text-[10px] font-black text-rose-500 uppercase italic">From: {s.absentTeacherName}</p>
                          <p className="text-[10px] font-black text-emerald-600 uppercase italic">To: {s.substituteTeacherName}</p>
                       </div>
                    </td>
                    <td className="px-6 py-8 text-right">
                       <span className={`text-[8px] font-black px-4 py-2 rounded-full border uppercase tracking-widest ${s.isArchived ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-600'}`}>
                         {s.isArchived ? 'Archive' : 'Active'}
                       </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportingView;

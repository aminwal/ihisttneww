
import React, { useState, useMemo } from 'react';
import { User, AttendanceRecord, SchoolConfig, UserRole } from '../types.ts';
// Add missing import for SCHOOL_NAME
import { SCHOOL_NAME } from '../constants.ts';

// Declare html2pdf for TypeScript
declare var html2pdf: any;

interface ReportingViewProps {
  users: User[];
  attendance: AttendanceRecord[];
  config: SchoolConfig;
}

const ReportingView: React.FC<ReportingViewProps> = ({ users, attendance, config }) => {
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [departmentFilter, setDepartmentFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY'>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  const applyPreset = (days: number) => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setDateRange({ start, end });
  };

  const applyMonthPreset = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    setDateRange({ start, end });
  };

  const handleDownloadPDF = async () => {
    setIsExporting(true);
    // Select the element containing the full report
    const element = document.getElementById('reporting-content');
    if (!element) return;

    const opt = {
      margin: [10, 5, 10, 5],
      filename: `IHIS_Institutional_Report_${dateRange.start}_to_${dateRange.end}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
      if (typeof html2pdf !== 'undefined') {
        await html2pdf().set(opt).from(element).save();
      }
    } catch (err) {
      console.error("PDF Export failed", err);
    } finally {
      setIsExporting(false);
    }
  };

  const schoolDaysInRange = useMemo(() => {
    const days: string[] = [];
    let curr = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    let safety = 0;
    while (curr <= end && safety < 400) {
      const dayOfWeek = curr.getDay(); // 0=Sun ... 4=Thu are working days
      if (dayOfWeek >= 0 && dayOfWeek <= 4) {
        days.push(curr.toISOString().split('T')[0]);
      }
      curr.setDate(curr.getDate() + 1);
      safety++;
    }
    return days;
  }, [dateRange]);

  const filteredAttendance = useMemo(() => {
    return attendance.filter(r => {
      const isWithinDate = r.date >= dateRange.start && r.date <= dateRange.end;
      if (!isWithinDate) return false;

      const user = users.find(u => u.id === r.userId);
      if (!user) return false;

      if (departmentFilter === 'PRIMARY') {
        return user.role === UserRole.TEACHER_PRIMARY || user.role === UserRole.INCHARGE_PRIMARY;
      }
      if (departmentFilter === 'SECONDARY') {
        return user.role === UserRole.TEACHER_SECONDARY || 
               user.role === UserRole.TEACHER_SENIOR_SECONDARY || 
               user.role === UserRole.INCHARGE_SECONDARY;
      }
      return true;
    });
  }, [attendance, users, dateRange, departmentFilter]);

  const stats = useMemo(() => {
    const totalWorkingDays = schoolDaysInRange.length || 1;
    const totalEntries = filteredAttendance.length;
    const lateEntries = filteredAttendance.filter(r => r.isLate).length;
    const manualEntries = filteredAttendance.filter(r => r.isManual).length;

    const avgAttendance = ((totalEntries / (users.length * totalWorkingDays)) * 100).toFixed(1);
    const punctualityRate = (((totalEntries - lateEntries) / (totalEntries || 1)) * 100).toFixed(1);

    return { avgAttendance, punctualityRate, totalEntries, lateEntries, manualEntries };
  }, [filteredAttendance, users, schoolDaysInRange]);

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-700 pb-24 px-2">
      {/* Control Header - Hidden in Print */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Institutional Analytics</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em] mt-2">Institutional Oversight Board</p>
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <button 
            onClick={handleDownloadPDF}
            disabled={isExporting}
            className="px-5 py-3 bg-[#001f3f] text-[#d4af37] border border-[#d4af37]/30 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-slate-900 transition-all flex items-center gap-3 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            {isExporting ? 'Generating Report...' : 'Download Full PDF Report'}
          </button>

          <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-inner">
             <button onClick={() => applyPreset(7)} className="px-4 py-2 text-[9px] font-black uppercase text-slate-500 hover:text-sky-600 transition-colors">7 Days</button>
             <button onClick={() => applyPreset(30)} className="px-4 py-2 text-[9px] font-black uppercase text-slate-500 hover:text-sky-600 transition-colors">30 Days</button>
             <button onClick={applyMonthPreset} className="px-4 py-2 text-[9px] font-black uppercase text-slate-500 hover:text-sky-600 transition-colors">Monthly</button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
              {(['ALL', 'PRIMARY', 'SECONDARY'] as const).map(dept => (
                <button key={dept} onClick={() => setDepartmentFilter(dept)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${departmentFilter === dept ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>
                  {dept}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center bg-slate-50 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800/50">
                 <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="bg-transparent text-[10px] font-black text-[#001f3f] dark:text-white outline-none" />
              </div>
              <span className="text-slate-300 font-bold">to</span>
              <div className="flex items-center bg-slate-50 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800/50">
                 <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="bg-transparent text-[10px] font-black text-[#001f3f] dark:text-white outline-none" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Printable Content Wrapper */}
      <div id="reporting-content" className="space-y-8 bg-white dark:bg-slate-900 p-4 rounded-[2.5rem]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {[
            { label: 'Avg Presence Rate', value: `${stats.avgAttendance}%`, color: 'text-sky-600', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
            { label: 'Punctuality Index', value: `${stats.punctualityRate}%`, color: 'text-emerald-600', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
            { label: 'Late Arrivals', value: stats.lateEntries, color: 'text-rose-500', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
            { label: 'Manual Overrides', value: stats.manualEntries, color: 'text-amber-600', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' }
          ].map((card, idx) => (
            <div key={idx} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl flex items-center gap-4 transition-all duration-300">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-slate-50 dark:bg-slate-800 ${card.color}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={card.icon} /></svg>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{card.label}</p>
                <h3 className={`text-2xl font-black ${card.color} leading-none`}>{card.value}</h3>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="p-8 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
             <h3 className="text-[12px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-[0.3em]">FACULTY PERFORMANCE REGISTRY</h3>
             <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Period: {dateRange.start} — {dateRange.end}</p>
          </div>
          <div className="overflow-x-auto">
             <table className="w-full text-left">
                <thead>
                  <tr className="text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] italic bg-slate-50/30 border-b border-slate-50">
                     <th className="px-10 py-6">PERSONNEL PROFILE</th>
                     <th className="px-10 py-6 text-center">ATTENDANCE (P/A/M)</th>
                     <th className="px-10 py-6 text-center">LATE FACTOR</th>
                     <th className="px-10 py-6 text-right">RELIABILITY INDEX</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                    const uRecords = filteredAttendance.filter(r => r.userId === u.id);
                    const totalPossible = schoolDaysInRange.length || 1;
                    
                    const medicalDays = uRecords.filter(r => r.checkIn === 'MEDICAL').length;
                    const presentDays = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
                    const absentDays = Math.max(0, totalPossible - (presentDays + medicalDays));
                    
                    const lates = uRecords.filter(r => r.isLate).length;
                    const reliability = (((presentDays - lates) / (totalPossible || 1)) * 100).toFixed(0);
                    
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-10 py-8">
                          <div className="flex items-center space-x-5">
                             <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 text-[#001f3f] dark:text-white rounded-full flex items-center justify-center font-black text-xs border border-slate-200 group-hover:bg-[#001f3f] group-hover:text-[#d4af37] transition-all">
                               {u.name.substring(0,2)}
                             </div>
                             <div>
                               <p className="font-black text-sm text-[#001f3f] dark:text-white mb-1 leading-none">{u.name}</p>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] leading-none">{u.employeeId}</p>
                             </div>
                          </div>
                        </td>
                        <td className="px-10 py-8 text-center">
                           <div className="flex flex-col items-center gap-2">
                              <span className="text-[12px] font-black text-slate-800 dark:text-slate-200">
                                 {presentDays} / {totalPossible}
                              </span>
                              <div className="flex gap-1">
                                 <span className="text-[7px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase">P: {presentDays}</span>
                                 <span className="text-[7px] font-black px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100 uppercase">A: {absentDays}</span>
                                 <span className="text-[7px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-black border border-slate-200 uppercase dark:bg-slate-800 dark:text-white">M: {medicalDays}</span>
                              </div>
                           </div>
                        </td>
                        <td className="px-10 py-8 text-center">
                           <span className="text-[10px] font-black px-4 py-1.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-100 italic">
                             {lates} Instances
                           </span>
                        </td>
                        <td className="px-10 py-8 text-right">
                           <div className="flex items-center justify-end gap-4">
                              <div className="w-32 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800">
                                 <div className={`h-full transition-all duration-1000 ${parseInt(reliability) > 85 ? 'bg-emerald-400' : 'bg-amber-400'} rounded-full`} style={{ width: `${reliability}%` }}></div>
                              </div>
                              <span className="text-sm font-black text-[#001f3f] dark:text-white tabular-nums">{reliability}%</span>
                           </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
             </table>
          </div>
          <div className="p-8 bg-slate-50 dark:bg-slate-800/50 text-center">
            <p className="text-[9px] font-black text-[#001f3f]/30 dark:text-white/20 uppercase tracking-[0.5em]">{SCHOOL_NAME} — Institutional Integrity Control</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportingView;

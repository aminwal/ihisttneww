import React, { useState, useMemo } from 'react';
import { User, AttendanceRecord, SchoolConfig, UserRole, SubstitutionRecord } from '../types.ts';
import { SCHOOL_NAME } from '../constants.ts';

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
  const [departmentFilter, setDepartmentFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY' | 'SENIOR_SECONDARY'>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  const isAdminOrPrincipal = user.role === UserRole.ADMIN || user.role === UserRole.INCHARGE_ALL;

  const schoolDaysInRange = useMemo(() => {
    const days: string[] = [];
    let curr = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    let safety = 0;
    while (curr <= end && safety < 400) {
      const dayOfWeek = curr.getDay(); 
      // Sunday (0) to Thursday (4) are school days
      if (dayOfWeek >= 0 && dayOfWeek <= 4) days.push(curr.toISOString().split('T')[0]);
      curr.setDate(curr.getDate() + 1);
      safety++;
    }
    return days;
  }, [dateRange]);

  const targetFaculty = useMemo(() => {
    return users.filter(u => {
      if (u.isResigned) return false;
      if (isAdminOrPrincipal) {
        if (departmentFilter === 'ALL') return u.role !== UserRole.ADMIN;
        if (departmentFilter === 'PRIMARY') return u.role.includes('PRIMARY');
        if (departmentFilter === 'SECONDARY') return u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY;
        if (departmentFilter === 'SENIOR_SECONDARY') return u.role === UserRole.TEACHER_SENIOR_SECONDARY;
        return u.role !== UserRole.ADMIN;
      }
      return u.id === user.id;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [users, departmentFilter, isAdminOrPrincipal, user.id]);

  const statsSummary = useMemo(() => {
    let totalPresent = 0, totalMedical = 0, totalAbsent = 0;
    const daysCount = schoolDaysInRange.length;

    targetFaculty.forEach(u => {
      const uRecords = attendance.filter(r => r.userId === u.id && r.date >= dateRange.start && r.date <= dateRange.end);
      const p = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
      const m = uRecords.filter(r => r.checkIn === 'MEDICAL').length;
      const a = Math.max(0, daysCount - (p + m));
      totalPresent += p; totalMedical += m; totalAbsent += a;
    });
    return { totalPresent, totalMedical, totalAbsent, facultyCount: targetFaculty.length };
  }, [targetFaculty, attendance, schoolDaysInRange, dateRange]);

  const handleExportExcel = () => {
    let xmlRows = '';
    const filename = `IHIS_${reportType}_Audit_${dateRange.start}_to_${dateRange.end}.xml`;

    if (reportType === 'ATTENDANCE') {
      // Build Attendance Headers
      xmlRows += `<Row ss:StyleID="sHeader">
        <Cell><Data ss:Type="String">Employee Code</Data></Cell>
        <Cell><Data ss:Type="String">Faculty Name</Data></Cell>
        <Cell><Data ss:Type="String">Days Present</Data></Cell>
        <Cell><Data ss:Type="String">Days Absent</Data></Cell>
        <Cell><Data ss:Type="String">Medical Leave Count</Data></Cell>
      </Row>`;

      targetFaculty.forEach(u => {
        const uRecords = attendance.filter(r => r.userId === u.id && r.date >= dateRange.start && r.date <= dateRange.end);
        const totalPossible = schoolDaysInRange.length;
        const p = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
        const m = uRecords.filter(r => r.checkIn === 'MEDICAL').length;
        const a = Math.max(0, totalPossible - (p + m));

        xmlRows += `<Row>
          <Cell><Data ss:Type="String">${u.employeeId}</Data></Cell>
          <Cell><Data ss:Type="String">${u.name}</Data></Cell>
          <Cell><Data ss:Type="Number">${p}</Data></Cell>
          <Cell><Data ss:Type="Number">${a}</Data></Cell>
          <Cell><Data ss:Type="Number">${m}</Data></Cell>
        </Row>`;
      });
    } else {
      // Build Substitution Headers
      xmlRows += `<Row ss:StyleID="sHeader">
        <Cell><Data ss:Type="String">Absent Employee</Data></Cell>
        <Cell><Data ss:Type="String">Substitute Assigned</Data></Cell>
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Day</Data></Cell>
        <Cell><Data ss:Type="String">Period Number</Data></Cell>
      </Row>`;

      const filteredSubs = substitutions.filter(s => {
        const isWithinDate = s.date >= dateRange.start && s.date <= dateRange.end;
        if (!isWithinDate) return false;
        if (departmentFilter === 'ALL') return true;
        return s.section.includes(departmentFilter);
      }).sort((a,b) => a.date.localeCompare(b.date));

      filteredSubs.forEach(s => {
        const dayLabel = new Date(s.date).toLocaleDateString('en-US', { weekday: 'long' });
        xmlRows += `<Row>
          <Cell><Data ss:Type="String">${s.absentTeacherName}</Data></Cell>
          <Cell><Data ss:Type="String">${s.substituteTeacherName}</Data></Cell>
          <Cell><Data ss:Type="String">${s.date}</Data></Cell>
          <Cell><Data ss:Type="String">${dayLabel}</Data></Cell>
          <Cell><Data ss:Type="String">Period ${s.slotId}</Data></Cell>
        </Row>`;
      });
    }

    const xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="sHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#001F3F" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="IHIS Audit Data">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPDF = async () => {
    setIsExporting(true);
    const element = document.getElementById('reporting-content');
    if (!element) {
      setIsExporting(false);
      return;
    }

    const originalStyle = element.style.cssText;
    element.classList.add('pdf-export-mode');
    element.style.height = 'auto';
    element.style.overflow = 'visible';
    element.style.maxWidth = 'none';

    const opt = {
      margin: [10, 5, 10, 5],
      filename: `IHIS_Audit_${dateRange.start}_to_${dateRange.end}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff',
        logging: false,
        letterRendering: true,
        scrollY: 0,
        scrollX: 0
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'] }
    };

    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (typeof html2pdf !== 'undefined') {
        await html2pdf().set(opt).from(element).save();
      }
    } catch (err) {
      console.error("Institutional Audit Export Error:", err);
    } finally {
      element.classList.remove('pdf-export-mode');
      element.style.cssText = originalStyle;
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-700 pb-24 px-2">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Institutional Analytics</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Analytical Intelligence Hub</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
             <div className="flex items-center gap-2 px-3 py-2">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Range:</span>
               <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
               <span className="text-slate-300">/</span>
               <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
             </div>
          </div>

          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide max-w-full">
             <button onClick={() => setReportType('ATTENDANCE')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${reportType === 'ATTENDANCE' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Attendance</button>
             <button onClick={() => setReportType('SUBSTITUTION')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${reportType === 'SUBSTITUTION' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Substitutions</button>
          </div>

          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
             {(['ALL', 'PRIMARY', 'SECONDARY', 'SENIOR_SECONDARY'] as const).map(dept => (
               <button key={dept} onClick={() => setDepartmentFilter(dept)} className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase transition-all whitespace-nowrap ${departmentFilter === dept ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{dept.replace('_', ' ')}</button>
             ))}
          </div>

          <div className="flex gap-2">
            <button onClick={handleDownloadPDF} disabled={isExporting} className="px-5 py-3 bg-white text-[#001f3f] border border-slate-200 rounded-2xl text-[10px] font-black uppercase shadow-lg hover:bg-slate-50 transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50">
               <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
               {isExporting ? 'PDF...' : 'PDF Audit'}
            </button>
            <button onClick={handleExportExcel} className="px-5 py-3 bg-emerald-600 text-white border border-emerald-400/30 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-emerald-700 transition-all flex items-center gap-3 active:scale-95">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
               Excel Data
            </button>
          </div>
        </div>
      </div>

      <div id="reporting-content" className="space-y-8 bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[600px] overflow-visible">
        {/* PDF Header Section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b border-slate-100 dark:border-slate-800 pb-8">
           <div>
              <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{SCHOOL_NAME}</h2>
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em] mt-1">Academic Year 2026-2027</p>
              <div className="flex flex-col gap-1 mt-4">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">Interval: {dateRange.start} to {dateRange.end}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">Department: {departmentFilter.replace('_', ' ')}</p>
                <p className="text-[9px] font-bold text-[#001f3f] dark:text-white uppercase tracking-widest italic">Faculty Count: {statsSummary.facultyCount}</p>
              </div>
           </div>
           
           <div className="grid grid-cols-3 gap-4 min-w-[300px]">
              <div className="bg-emerald-50 dark:bg-emerald-950/20 p-4 rounded-3xl border border-emerald-100 dark:border-emerald-900 flex flex-col items-center">
                 <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Global P</span>
                 <span className="text-xl font-black text-emerald-600">{statsSummary.totalPresent}</span>
              </div>
              <div className="bg-rose-50 dark:bg-rose-950/20 p-4 rounded-3xl border border-rose-100 dark:border-rose-900 flex flex-col items-center">
                 <span className="text-[8px] font-black text-rose-600 uppercase tracking-widest">Global A</span>
                 <span className="text-xl font-black text-rose-600">{statsSummary.totalAbsent}</span>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-3xl border border-amber-100 dark:border-amber-900 flex flex-col items-center">
                 <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Global M</span>
                 <span className="text-xl font-black text-amber-600">{statsSummary.totalMedical}</span>
              </div>
           </div>
        </div>

        {reportType === 'ATTENDANCE' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-6">Faculty Personnel</th>
                  <th className="px-6 py-6 text-center">Status Matrix (P / A / M)</th>
                  <th className="px-6 py-6 text-right">Reliability Index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {targetFaculty.map(u => {
                  const uRecords = attendance.filter(r => r.userId === u.id && r.date >= dateRange.start && r.date <= dateRange.end);
                  const totalPossible = schoolDaysInRange.length || 1;
                  const pCount = uRecords.filter(r => r.checkIn !== 'MEDICAL').length;
                  const mCount = uRecords.filter(r => r.checkIn === 'MEDICAL').length;
                  const aCount = Math.max(0, totalPossible - (pCount + mCount));
                  const engagement = ((pCount / totalPossible) * 100).toFixed(1);
                  
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors stagger-row" style={{ pageBreakInside: 'avoid' }}>
                      <td className="px-6 py-8">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs shadow-sm">{u.name.substring(0,2)}</div>
                          <div>
                            <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{u.name}</p>
                            <p className="text-[8px] font-black text-slate-400 uppercase mt-1.5 tracking-widest">{u.employeeId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-8">
                        <div className="flex items-center justify-center gap-2">
                           <div className="flex flex-col items-center min-w-[55px] px-2 py-1 bg-emerald-50 border border-emerald-100 rounded-xl">
                              <span className="text-[7px] font-black text-emerald-600 uppercase">Present</span>
                              <span className="text-xs font-black text-emerald-600">{pCount}</span>
                           </div>
                           <div className="flex flex-col items-center min-w-[55px] px-2 py-1 bg-rose-50 border border-rose-100 rounded-xl">
                              <span className="text-[7px] font-black text-rose-600 uppercase">Absent</span>
                              <span className="text-xs font-black text-rose-600">{aCount}</span>
                           </div>
                           <div className="flex flex-col items-center min-w-[55px] px-2 py-1 bg-amber-50 border border-amber-100 rounded-xl">
                              <span className="text-[7px] font-black text-amber-600 uppercase">Medical</span>
                              <span className="text-xs font-black text-amber-600">{mCount}</span>
                           </div>
                        </div>
                      </td>
                      <td className="px-6 py-8 text-right">
                        <p className="font-black text-[#001f3f] dark:text-white tabular-nums text-lg italic leading-none">{engagement}%</p>
                        <div className={`h-1.5 w-24 ml-auto mt-2 rounded-full bg-slate-100 overflow-hidden`}>
                           <div style={{ width: `${engagement}%` }} className={`h-full ${parseFloat(engagement) > 85 ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {targetFaculty.length === 0 && (
              <div className="py-20 text-center text-slate-300 font-black uppercase text-[10px] tracking-widest">
                No faculty records detected for current criteria
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50 border-y border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-6">Date & Period</th>
                  <th className="px-6 py-6">Division</th>
                  <th className="px-6 py-6">Personnel Deployment</th>
                  <th className="px-6 py-6 text-right">Audit Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {substitutions.filter(s => {
                  const isWithinDate = s.date >= dateRange.start && s.date <= dateRange.end;
                  if (!isWithinDate) return false;
                  if (departmentFilter === 'ALL') return true;
                  return s.section.includes(departmentFilter);
                }).sort((a,b) => b.date.localeCompare(a.date)).map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors stagger-row" style={{ pageBreakInside: 'avoid' }}>
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
        
        {/* PDF Footer */}
        <div className="mt-12 pt-8 border-t border-slate-100 dark:border-slate-800 flex justify-between items-end opacity-40">
           <div className="text-[8px] font-black uppercase tracking-widest">
              Generated by IHIS Intelligence Portal<br/>
              {/* FIX: Force footer timestamp to Bahrain Time */}
              Timestamp: {new Date().toLocaleString('en-US', {timeZone: 'Asia/Bahrain'})}<br/>
              Security Token: {Math.random().toString(36).substring(7).toUpperCase()}
           </div>
           <div className="text-right">
              <div className="w-32 h-[1px] bg-slate-400 mb-2"></div>
              <span className="text-[8px] font-black uppercase tracking-widest">Principal's Signature</span>
           </div>
        </div>
      </div>
    </div>
  );
};

export default ReportingView;
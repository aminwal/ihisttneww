
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

const SubstitutionView: React.FC<SubstitutionViewProps> = ({ user, users, attendance, timetable, substitutions, setSubstitutions, assignments, config, onAssignment }) => {
  const [activeSection, setActiveSection] = useState<SectionType>('PRIMARY');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  const MAX_WEEKLY_PERIODS = 35;

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const getTeacherLoadBreakdown = useCallback((teacherId: string) => {
    const baseLoad = assignments
      .filter(a => a.teacherId === teacherId)
      .reduce((sum, a) => sum + a.loads.reduce((s, l) => s + l.periods, 0), 0);
    const proxyLoad = substitutions.filter(s => 
      s.substituteTeacherId === teacherId && 
      !s.isArchived 
    ).length;
    return { base: baseLoad, proxy: proxyLoad, total: baseLoad + proxyLoad };
  }, [assignments, substitutions]);

  const isTeacherAvailable = useCallback((teacherId: string, dateStr: string, slotId: number) => {
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => t.teacherId === teacherId && t.day === dayName && t.slotId === slotId);
    if (isBusyInTimetable) return false;
    const isBusyInSubs = substitutions.some(s => s.substituteTeacherId === teacherId && s.date === dateStr && s.slotId === slotId && !s.isArchived);
    if (isBusyInSubs) return false;
    return true;
  }, [timetable, substitutions, attendance]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    const allRoles = [u.role, ...(u.secondaryRoles || [])];
    const isPrimary = allRoles.some(r => r === UserRole.TEACHER_PRIMARY || r === UserRole.INCHARGE_PRIMARY || r === UserRole.INCHARGE_ALL);
    const isSecondary = allRoles.some(r => r === UserRole.TEACHER_SECONDARY || r === UserRole.TEACHER_SENIOR_SECONDARY || r === UserRole.INCHARGE_SECONDARY || r === UserRole.INCHARGE_ALL);
    
    if (section === 'PRIMARY') return isPrimary;
    return isSecondary;
  }, []);

  const filteredSubs = useMemo(() => {
    const dateFiltered = substitutions.filter(s => s.date === selectedDate && !s.isArchived);
    if (isManagement) {
      return dateFiltered.filter(s => {
        if (activeSection === 'PRIMARY') return s.section === 'PRIMARY';
        return s.section === 'SECONDARY_BOYS' || s.section === 'SECONDARY_GIRLS';
      });
    }
    return dateFiltered.filter(s => s.substituteTeacherId === user.id);
  }, [substitutions, selectedDate, isManagement, activeSection, user]);

  const handleAutoAssignProxies = async () => {
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 800));

    let updatedSubs = [...substitutions];
    let assignCount = 0;

    const pending = substitutions.filter(s => 
      s.date === selectedDate && s.section === activeSection && !s.isArchived && (!s.substituteTeacherId || s.substituteTeacherName === 'PENDING ASSIGNMENT')
    );

    pending.forEach(s => {
      const candidates = users
        .filter(u => u.id !== s.absentTeacherId && isTeacherEligibleForSection(u, s.section))
        .map(u => ({ user: u, load: getTeacherLoadBreakdown(u.id).total }))
        .filter(c => c.load < MAX_WEEKLY_PERIODS && isTeacherAvailable(c.user.id, selectedDate, s.slotId))
        .sort((a, b) => a.load - b.load);

      if (candidates.length > 0) {
        const best = candidates[0].user;
        updatedSubs = updatedSubs.map(item => item.id === s.id ? { ...item, substituteTeacherId: best.id, substituteTeacherName: best.name } : item);
        assignCount++;
      }
    });

    setSubstitutions(updatedSubs);
    setStatus({ type: 'success', message: `Deployed ${assignCount} proxies across departments.` });
    setIsProcessing(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase">Substitution Ledger</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Multi-Departmental Resource Matrix</p>
        </div>
        <div className="flex gap-2">
          {isManagement && (
            <button onClick={handleAutoAssignProxies} disabled={isProcessing} className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg">
              {isProcessing ? 'Deploying...' : 'Auto-Proxy'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-4 md:p-8 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between no-print bg-slate-50/50 gap-4">
           {isManagement && (
             <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
                {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
                  <button key={s} onClick={() => setActiveSection(s)} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{s.replace('_', ' ')}</button>
                ))}
             </div>
           )}
           <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-3 py-2 rounded-xl border text-[11px] font-black" />
        </div>

        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50">
                  <th className="px-10 py-5">Slot</th>
                  <th className="px-10 py-5">Class</th>
                  <th className="px-10 py-5">Absentee</th>
                  <th className="px-10 py-5">Proxy Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredSubs.map(s => (
                  <tr key={s.id} className="hover:bg-amber-50/10">
                    <td className="px-10 py-6 font-black text-sm text-[#001f3f] dark:text-white italic">Period {s.slotId}</td>
                    <td className="px-10 py-6">
                       <p className="font-black text-sm text-[#001f3f] dark:text-white">{s.className}</p>
                       <p className="text-[9px] font-black text-slate-400 uppercase">{s.subject}</p>
                    </td>
                    <td className="px-10 py-6 font-black text-xs text-red-500 uppercase">{s.absentTeacherName}</td>
                    <td className="px-10 py-6">
                      <span className={`text-xs font-black uppercase ${!s.substituteTeacherId ? 'text-amber-500 italic' : 'text-emerald-600'}`}>
                        {s.substituteTeacherName}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>
      </div>
    </div>
  );
};

export default SubstitutionView;

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SectionType, TeacherAssignment, SchoolConfig, SchoolNotification, SubstitutionRecord, SubjectCategory, TimeSlot } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { NotificationService } from '../services/notificationService.ts';
import { TelegramService } from '../services/telegramService.ts';

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
  const [manualAssignTarget, setManualAssignTarget] = useState<SubstitutionRecord | null>(null);
  
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);
  const [newProxyData, setNewProxyData] = useState({ wingId: '', gradeId: '', sectionId: '', absentTeacherId: '', slotId: 1, subject: '' });

  const isAdmin = user.role === UserRole.ADMIN;
  const isGlobalManager = isAdmin || user.role === UserRole.INCHARGE_ALL;
  const isManagement = isGlobalManager || user.role.startsWith('INCHARGE_');
  const isCloudActive = IS_CLOUD_ENABLED;

  const getAvailableSlotsForSection = useCallback((section: SectionType): TimeSlot[] => {
    if (config.slotDefinitions?.[section]) return [...config.slotDefinitions[section]].sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, [config.slotDefinitions]);

  const getSlotLabel = useCallback((slotId: number | undefined, section: SectionType) => {
    const wingSlots = getAvailableSlotsForSection(section);
    const slot = wingSlots.find(s => s.id === slotId);
    return slot ? slot.label.replace('Period ', 'P') : `P${slotId}`;
  }, [getAvailableSlotsForSection]);

  const currentWingSlots = useMemo(() => getAvailableSlotsForSection(activeSection).filter(s => !s.isBreak), [activeSection, getAvailableSlotsForSection]);

  useEffect(() => { if (status) setTimeout(() => setStatus(null), 5000); }, [status]);

  const getTeacherLoadBreakdown = useCallback((teacherId: string, currentSubs: SubstitutionRecord[] = substitutions) => {
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    const baseLoad = teacherAssignments.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0);
    const groupLoad = teacherAssignments.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
    const proxyLoad = currentSubs.filter(s => s.substituteTeacherId === teacherId && !s.isArchived).length;
    const total = baseLoad + groupLoad + proxyLoad;
    return { baseLoad, groupLoad, proxyLoad, total, remaining: Math.max(0, MAX_TOTAL_WEEKLY_LOAD - total) };
  }, [assignments, substitutions]);

  const workloadUsers = useMemo(() => {
    if (isGlobalManager) return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN);
    if (user.role === UserRole.INCHARGE_PRIMARY) return users.filter(u => u.role.includes('PRIMARY') && !u.isResigned);
    if (user.role === UserRole.INCHARGE_SECONDARY) return users.filter(u => (u.role.includes('SECONDARY')) && !u.isResigned);
    return [user];
  }, [users, user, isGlobalManager]);

  const getBlockAffinity = useCallback((absentTeacherId: string, slotId: number, dayName: string) => {
    const duty = timetable.find(t => t.day === dayName && t.slotId === slotId && t.blockId);
    if (!duty) return null;
    const block = config.combinedBlocks.find(b => b.id === duty.blockId);
    return block ? { id: block.id, title: block.title, colleagues: block.allocations.map(a => a.teacherId).filter(id => id !== absentTeacherId) } : null;
  }, [timetable, config.combinedBlocks]);

  const isTeacherAvailable = useCallback((teacherId: string, slotId: number, dateStr: string) => {
    const attRecord = attendance.find(a => a.userId === teacherId && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    const [year, month, day] = dateStr.split('-').map(Number);
    const dayName = new Date(year, month-1, day).toLocaleDateString('en-US', { weekday: 'long' });
    const isBusyInTimetable = timetable.some(t => t.day === dayName && t.slotId === slotId && !t.date && (t.teacherId === teacherId || config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === teacherId)));
    const isBusyInSubs = substitutions.some(s => s.date === dateStr && s.slotId === slotId && s.substituteTeacherId === teacherId && !s.isArchived);
    return !isBusyInTimetable && !isBusyInSubs;
  }, [attendance, timetable, substitutions, config.combinedBlocks]);

  const commitSubstitution = async (subId: string, teacher: User) => {
    setIsProcessing(true);
    const sub = substitutions.find(s => s.id === subId)!;
    const updated = { ...sub, substituteTeacherId: teacher.id, substituteTeacherName: teacher.name };
    try {
      if (isCloudActive) {
        await supabase.from('substitution_ledger').update({ substitute_teacher_id: teacher.id, substitute_teacher_name: teacher.name }).eq('id', subId);
      }
      if (config.telegramBotToken && teacher.telegram_chat_id) {
        await TelegramService.sendProxyAlert(config.telegramBotToken, teacher, updated);
      }
      setSubstitutions(prev => prev.map(s => s.id === subId ? updated : s));
      setStatus({ type: 'success', message: `Deployed ${teacher.name}. Alert Dispatched.` });
      setManualAssignTarget(null);
    } catch (err: any) {
      setStatus({ type: 'error', message: "Deployment Failed: " + err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetWeeklyMatrix = async () => {
    if (!confirm("This will archive ALL active substitutions and clear them from the live timetable for the new week. Historical data will be preserved. Proceed?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive) {
        const { error } = await supabase
          .from('substitution_ledger')
          .update({ is_archived: true })
          .eq('is_archived', false);
        if (error) throw error;
      }
      setSubstitutions(prev => prev.map(s => ({ ...s, isArchived: true })));
      setStatus({ type: 'success', message: "Weekly Matrix Reset. Active substitutions archived." });
    } catch (err: any) {
      setStatus({ type: 'error', message: "Reset Failed: " + err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSmartProxyMatch = async () => {
    setIsProcessing(true);
    let matchedCount = 0;
    const sessionSubs = [...substitutions];
    const pending = sessionSubs.filter(s => s.date === selectedDate && !s.substituteTeacherId);
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dayName = new Date(year, month-1, day).toLocaleDateString('en-US', { weekday: 'long' });
    for (const sub of pending) {
      const affinity = getBlockAffinity(sub.absentTeacherId, sub.slotId, dayName);
      const candidates = users
        .filter(u => u.id !== sub.absentTeacherId && !u.isResigned && u.role !== UserRole.ADMIN)
        .map(teacher => ({ 
          teacher, 
          load: getTeacherLoadBreakdown(teacher.id, sessionSubs), 
          available: isTeacherAvailable(teacher.id, sub.slotId, selectedDate),
          isBlockColleague: affinity?.colleagues.includes(teacher.id) || false
        }))
        .filter(c => c.available)
        .sort((a, b) => (b.isBlockColleague ? 1 : 0) - (a.isBlockColleague ? 1 : 0) || a.load.total - b.load.total);
      if (candidates.length > 0) {
        const best = candidates[0].teacher;
        const subIdx = sessionSubs.findIndex(s => s.id === sub.id);
        sessionSubs[subIdx] = { ...sessionSubs[subIdx], substituteTeacherId: best.id, substituteTeacherName: best.name };
        matchedCount++;
        if (isCloudActive) {
          await supabase.from('substitution_ledger').update({ substitute_teacher_id: best.id, substitute_teacher_name: best.name }).eq('id', sub.id);
        }
      }
    }
    setSubstitutions(sessionSubs);
    setStatus({ type: 'success', message: `Smart Proxy complete: ${matchedCount} duties auto-assigned.` });
    setIsProcessing(false);
  };

  const handleManualProxyCommit = async () => {
    if (!newProxyData.sectionId || !newProxyData.absentTeacherId) return;
    setIsProcessing(true);
    const targetSection = config.sections.find(s => s.id === newProxyData.sectionId)!;
    const absentTeacher = users.find(u => u.id === newProxyData.absentTeacherId)!;
    const sub: SubstitutionRecord = {
      id: generateUUID(), date: selectedDate, slotId: newProxyData.slotId, wingId: newProxyData.wingId,
      gradeId: newProxyData.gradeId, sectionId: newProxyData.sectionId, className: targetSection.fullName,
      subject: newProxyData.subject.toUpperCase() || 'PROXY', absentTeacherId: absentTeacher.id, absentTeacherName: absentTeacher.name,
      substituteTeacherId: '', substituteTeacherName: 'PENDING', section: activeSection
    };
    if (isCloudActive) {
      await supabase.from('substitution_ledger').insert({ 
        id: sub.id, date: sub.date, slot_id: sub.slotId, wing_id: sub.wingId, grade_id: sub.gradeId,
        section_id: sub.sectionId, class_name: sub.className, subject: sub.subject,
        absent_teacher_id: sub.absentTeacherId, absent_teacher_name: sub.absentTeacherName,
        substitute_teacher_id: '', substitute_teacher_name: 'PENDING', section: sub.section, is_archived: false 
      });
    }
    setSubstitutions(prev => [sub, ...prev]);
    setIsNewEntryModalOpen(false);
    setIsProcessing(false);
  };

  const handleScanForAbsentees = async () => {
    setIsProcessing(true);
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dayName = new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' });
    const absentees = users.filter(u => {
      if (u.isResigned || u.role === UserRole.ADMIN) return false;
      const att = attendance.find(a => a.userId === u.id && a.date === selectedDate);
      return !att || att.checkIn === 'MEDICAL';
    });
    let newRegistries: SubstitutionRecord[] = [];
    absentees.forEach(teacher => {
      timetable.filter(t => t.day === dayName && !t.date && (t.teacherId === teacher.id || config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === teacher.id))).forEach(duty => {
        const exists = substitutions.some(s => s.date === selectedDate && s.absentTeacherId === teacher.id && s.slotId === duty.slotId && s.className === duty.className);
        if (!exists) {
           newRegistries.push({ 
             id: generateUUID(), date: selectedDate, slotId: duty.slotId, sectionId: duty.sectionId, 
             wingId: duty.wingId, gradeId: duty.gradeId, className: duty.className, 
             subject: duty.subject, absentTeacherId: teacher.id, absentTeacherName: teacher.name, 
             substituteTeacherId: '', substituteTeacherName: 'PENDING', section: duty.section 
           });
        }
      });
    });
    if (newRegistries.length > 0) {
      if (isCloudActive) {
        await supabase.from('substitution_ledger').insert(newRegistries.map(r => ({ 
          id: r.id, date: r.date, slot_id: r.slotId, wing_id: r.wingId, grade_id: r.gradeId,
          section_id: r.sectionId, class_name: r.className, subject: r.subject,
          absent_teacher_id: r.absentTeacherId, absent_teacher_name: r.absentTeacherName,
          substitute_teacher_id: '', substitute_teacher_name: 'PENDING', section: r.section, is_archived: false 
        })));
      }
      setSubstitutions(prev => [...newRegistries, ...prev]);
      setStatus({ type: 'success', message: `${newRegistries.length} duties identified.` });
    }
    setIsProcessing(false);
  };

  const exportForPrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print px-2">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Substitution Matrix</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Resource Optimization Hub</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManagement && (
            <>
              <button onClick={() => setIsNewEntryModalOpen(true)} className="bg-amber-400 text-[#001f3f] px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md flex items-center gap-2">+ Manual Proxy</button>
              <button onClick={handleSmartProxyMatch} disabled={isProcessing} className="bg-[#001f3f] text-[#d4af37] px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md border border-white/10">Run Smart Proxy</button>
              <button onClick={handleScanForAbsentees} disabled={isProcessing} className="bg-white dark:bg-slate-800 text-[#001f3f] dark:text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md border border-slate-200">Scan Absentees</button>
              <button onClick={handleResetWeeklyMatrix} disabled={isProcessing} className="bg-rose-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md hover:bg-rose-700">Reset Weekly Matrix</button>
              <button onClick={exportForPrint} className="bg-sky-500 text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md flex items-center gap-2">Print Ledger</button>
            </>
          )}
        </div>
      </div>

      <div className="no-print space-y-4">
        <div className="flex items-center gap-4 px-2">
           <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Workload Intelligence</h3>
           <div className="flex-1 h-[1px] bg-slate-100 dark:bg-slate-800"></div>
        </div>
        <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 px-2">
          {workloadUsers.map(u => {
            const load = getTeacherLoadBreakdown(u.id);
            const severityColor = load.total > 30 ? 'bg-rose-500' : load.total > 25 ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <div key={u.id} className="min-w-[200px] bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col gap-3 group transition-all hover:scale-105">
                 <div className="flex justify-between items-start">
                    <div className="max-w-[120px]">
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase truncate italic">{u.name}</p>
                       <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{u.employeeId}</p>
                    </div>
                    <div className={`w-8 h-8 rounded-xl ${severityColor} text-white flex items-center justify-center font-black text-[10px] shadow-lg`}>
                       {load.total}
                    </div>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[8px] font-bold uppercase">
                       <span className="text-slate-400">Base</span>
                       <span className="text-slate-600 dark:text-slate-300">{load.baseLoad}P</span>
                    </div>
                    <div className="flex justify-between items-center text-[8px] font-bold uppercase">
                       <span className="text-slate-400">Group</span>
                       <span className="text-sky-600">{load.groupLoad}P</span>
                    </div>
                    <div className="flex justify-between items-center text-[8px] font-bold uppercase">
                       <span className="text-slate-400">Proxies</span>
                       <span className="text-amber-600">{load.proxyLoad}P</span>
                    </div>
                 </div>
                 <div className="h-1 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                    <div style={{ width: `${(load.total / MAX_TOTAL_WEEKLY_LOAD) * 100}%` }} className={`h-full ${severityColor}`}></div>
                 </div>
              </div>
            );
          })}
        </div>
      </div>

      {status && (
        <div className={`p-4 rounded-2xl text-[10px] font-black uppercase border ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
          {status.message}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden min-h-[500px]">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col lg:flex-row items-center justify-between no-print bg-slate-50/50 gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 shadow-sm overflow-x-auto scrollbar-hide">
              {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{s.replace(/_/g, ' ')}</button>
              ))}
           </div>
           <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-slate-100">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Date:</span>
             <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none" />
           </div>
        </div>

        <div className="overflow-x-auto proxy-table-container">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30">
                <th className="px-8 py-6">Period</th>
                <th className="px-8 py-6">Class Context</th>
                <th className="px-8 py-6">Personnel Deployment</th>
                <th className="px-8 py-6 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived).map(sub => (
                <tr key={sub.id} className="hover:bg-amber-50/5 transition-colors">
                  <td className="px-8 py-6">
                    <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black italic shadow-lg">{getSlotLabel(sub.slotId, sub.section)}</div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-sm font-black text-[#001f3f] dark:text-white italic">{sub.className}</p>
                    <p className="text-[9px] font-black text-sky-600 uppercase mt-1.5">{sub.subject}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-6">
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Absentee</p>
                          <p className="text-xs font-black text-rose-500 italic">{sub.absentTeacherName}</p>
                       </div>
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Substitute</p>
                          <p className={`text-xs font-black italic ${sub.substituteTeacherId ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`}>{sub.substituteTeacherName}</p>
                       </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right no-print">
                    <button onClick={() => setManualAssignTarget(sub)} className="px-5 py-2.5 bg-sky-50 text-sky-600 text-[9px] font-black uppercase rounded-xl border border-sky-100 hover:bg-sky-600 hover:text-white transition-all">Assign Staff</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isNewEntryModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in">
              <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Proxy Entry</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.wingId} onChange={e => setNewProxyData({...newProxyData, wingId: e.target.value, gradeId: '', sectionId: ''})}>
                    <option value="">Select Wing...</option>
                    {config.wings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                 </select>
                 <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.gradeId} onChange={e => setNewProxyData({...newProxyData, gradeId: e.target.value, sectionId: ''})}>
                    <option value="">Select Grade...</option>
                    {config.grades.filter(g => g.wingId === newProxyData.wingId).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                 </select>
                 <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.sectionId} onChange={e => setNewProxyData({...newProxyData, sectionId: e.target.value})}>
                    <option value="">Select Section...</option>
                    {config.sections.filter(s => s.gradeId === newProxyData.gradeId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                 </select>
                 <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.absentTeacherId} onChange={e => setNewProxyData({...newProxyData, absentTeacherId: e.target.value})}>
                    <option value="">Absent Personnel...</option>
                    {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                 </select>
                 <input placeholder="Subject" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.subject} onChange={e => setNewProxyData({...newProxyData, subject: e.target.value})} />
                 <input type="number" placeholder="Period" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase" value={newProxyData.slotId} onChange={e => setNewProxyData({...newProxyData, slotId: parseInt(e.target.value)})} />
              </div>
              <div className="flex gap-4">
                 <button onClick={handleManualProxyCommit} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase shadow-xl">Commit Duty</button>
                 <button onClick={() => setIsNewEntryModalOpen(false)} className="px-8 py-5 bg-slate-100 text-slate-400 rounded-2xl font-black text-[10px] uppercase">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {manualAssignTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in max-h-[85vh] flex flex-col">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">Proxy Deployment</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Selection for {manualAssignTarget.className} (Period {manualAssignTarget.slotId})</p>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide space-y-3">
                 {users
                   .filter(u => u.id !== manualAssignTarget.absentTeacherId && !u.isResigned && u.role !== UserRole.ADMIN)
                   .map(teacher => {
                     const load = getTeacherLoadBreakdown(teacher.id);
                     const available = isTeacherAvailable(teacher.id, manualAssignTarget.slotId, selectedDate);
                     const isBlockColleague = getBlockAffinity(manualAssignTarget.absentTeacherId, manualAssignTarget.slotId, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long' }))?.colleagues.includes(teacher.id);
                     return (
                       <button key={teacher.id} disabled={!available || isProcessing} onClick={() => commitSubstitution(manualAssignTarget.id, teacher)} className={`w-full p-5 rounded-3xl border-2 flex items-center justify-between transition-all text-left ${available ? 'border-slate-100 hover:border-amber-400 bg-white dark:bg-slate-800 shadow-sm' : 'opacity-40 bg-slate-50 cursor-not-allowed border-transparent'} ${isBlockColleague ? 'border-emerald-400 bg-emerald-50/20' : ''}`}>
                          <div className="flex-1 pr-4">
                             <div className="flex items-center gap-2">
                                <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{teacher.name}</p>
                                {isBlockColleague && <span className="px-2 py-0.5 bg-emerald-500 text-white text-[7px] font-black rounded uppercase">Block Match</span>}
                             </div>
                             <p className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Load: {load.total}P • Rem: {load.remaining}P</p>
                          </div>
                          {available && <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg></div>}
                       </button>
                     );
                   })}
              </div>
              <button onClick={() => setManualAssignTarget(null)} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Cancel</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;
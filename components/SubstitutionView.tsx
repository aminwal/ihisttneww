
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SectionType, TeacherAssignment, SchoolConfig, SchoolNotification, SubstitutionRecord, SubjectCategory, TimeSlot } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { NotificationService } from '../services/notificationService.ts';
import { TelegramService } from '../services/telegramService.ts';

const MAX_TOTAL_WEEKLY_LOAD = 35;
const STANDARD_LOAD_GUIDELINE = 28;

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
  const [showWorkloadHub, setShowWorkloadHub] = useState(false);
  
  const [manualAssignTarget, setManualAssignTarget] = useState<SubstitutionRecord | null>(null);
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);

  const isAdmin = user.role === UserRole.ADMIN;
  const isGlobalManager = isAdmin || user.role === UserRole.INCHARGE_ALL;
  const isManagement = isAdmin || user.role.startsWith('INCHARGE_');
  const isCloudActive = IS_CLOUD_ENABLED;

  const getAvailableSlotsForSection = useCallback((section: SectionType) => {
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section.includes('GIRLS')) return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, []);

  const getSlotLabel = useCallback((slotId: number | undefined, section: SectionType) => {
    if (slotId === undefined || slotId === null) return "N/A";
    const wingSlots = getAvailableSlotsForSection(section);
    const slot = wingSlots.find(s => s.id === slotId);
    if (!slot) return `P${slotId}`;
    return slot.label.replace('Period ', 'P');
  }, [getAvailableSlotsForSection]);

  const [newEntry, setNewEntry] = useState({
    absentTeacherId: '',
    className: '',
    subject: '',
    slotId: 1,
    section: activeSection
  });

  useEffect(() => {
    localStorage.setItem('ihis_cached_section', activeSection);
    const validSlots = getAvailableSlotsForSection(activeSection).filter(s => !s.isBreak);
    setNewEntry(prev => ({ 
      ...prev, 
      section: activeSection,
      slotId: validSlots[0]?.id || 1
    }));
  }, [activeSection, getAvailableSlotsForSection]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

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
    const teacherAssignments = assignments.filter(a => a.teacherId.toLowerCase() === teacherId.toLowerCase());
    
    const baseLoad = teacherAssignments.reduce((sum, a) => 
      sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0
    );
    const groupLoad = teacherAssignments.reduce((sum, a) => sum + (a.groupPeriods || 0), 0);
    
    const proxyLoad = currentSubs.reduce((count, s) => {
      if (s.substituteTeacherId.toLowerCase() === teacherId.toLowerCase() && s.date >= start && s.date <= end && !s.isArchived) {
        return count + 1;
      }
      return count;
    }, 0);

    const total = baseLoad + groupLoad + proxyLoad;
    return { base: baseLoad, groups: groupLoad, proxy: proxyLoad, total: total, remaining: Math.max(0, MAX_TOTAL_WEEKLY_LOAD - total) };
  }, [assignments, substitutions, getWeekRange]);

  const busyTeacherRegistry = useCallback((slotId: number, dateStr: string, sessionSubs: SubstitutionRecord[] = []) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const busySet = new Set<string>();

    for (const t of timetable) {
      if (t.day === dayName && t.slotId === slotId && (!t.date || t.date === dateStr)) {
        if (t.teacherId && t.teacherId !== 'BLOCK_RESOURCE') busySet.add(t.teacherId.toLowerCase());
        if (t.blockId) config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.forEach(a => busySet.add(a.teacherId.toLowerCase()));
      }
    }
    const allSubs = [...substitutions, ...sessionSubs];
    for (const s of allSubs) {
      if (s.date === dateStr && s.slotId === slotId && !s.isArchived && s.substituteTeacherId) {
        busySet.add(s.substituteTeacherId.toLowerCase());
      }
    }
    return busySet;
  }, [timetable, substitutions, config.combinedBlocks]);

  const isTeacherAvailable = useCallback((teacherId: string, slotId: number, dateStr: string, sessionSubs: SubstitutionRecord[] = []) => {
    const attRecord = attendance.find(a => a.userId.toLowerCase() === teacherId.toLowerCase() && a.date === dateStr);
    if (!attRecord || !attRecord.checkIn || attRecord.checkIn === 'MEDICAL') return false;
    const busy = busyTeacherRegistry(slotId, dateStr, sessionSubs);
    return !busy.has(teacherId.toLowerCase());
  }, [attendance, busyTeacherRegistry]);

  const isTeacherEligibleForSection = useCallback((u: User, section: SectionType) => {
    const allRoles = [u.role, ...(u.secondaryRoles || [])];
    const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN);
    const isSecondary = allRoles.some(r => r === UserRole.TEACHER_SECONDARY || r === UserRole.INCHARGE_SECONDARY || r === UserRole.INCHARGE_ALL);
    if (section === 'PRIMARY') return isPrimary;
    return isSecondary;
  }, []);

  const deploymentCandidates = useMemo(() => {
    if (!manualAssignTarget) return [];
    return users
      .filter(u => u.id !== manualAssignTarget.absentTeacherId && !u.isResigned && isTeacherEligibleForSection(u, manualAssignTarget.section) && u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF)
      .map(teacher => ({ 
        teacher, 
        load: getTeacherLoadBreakdown(teacher.id, selectedDate), 
        available: isTeacherAvailable(teacher.id, manualAssignTarget.slotId, selectedDate) 
      }))
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.load.total - b.load.total;
      });
  }, [manualAssignTarget, users, isTeacherEligibleForSection, getTeacherLoadBreakdown, selectedDate, isTeacherAvailable]);

  const handleScanForAbsentees = async () => {
    setIsProcessing(true);
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const absentees = users.filter(u => {
      if (u.isResigned || u.role === UserRole.ADMIN || u.role === UserRole.ADMIN_STAFF) return false;
      const att = attendance.find(a => a.userId.toLowerCase() === u.id.toLowerCase() && a.date === selectedDate);
      return !att || att.checkIn === 'MEDICAL';
    });
    
    let newRegistries: SubstitutionRecord[] = [];
    absentees.forEach(teacher => {
      const duties = timetable.filter(t => {
        if (t.day !== dayName || !!t.date) return false;
        if (t.teacherId.toLowerCase() === teacher.id.toLowerCase()) return true;
        if (t.blockId) return config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId.toLowerCase() === teacher.id.toLowerCase());
        return false;
      });
      
      duties.forEach(duty => {
        const exists = substitutions.some(s => s.date === selectedDate && s.absentTeacherId === teacher.id && s.slotId === duty.slotId && s.className === duty.className);
        if (!exists) {
           newRegistries.push({ 
             id: generateUUID(), date: selectedDate, slotId: duty.slotId, className: duty.className, 
             subject: duty.subject, absentTeacherId: teacher.id, absentTeacherName: teacher.name, 
             substituteTeacherId: '', substituteTeacherName: 'PENDING ASSIGNMENT', section: duty.section 
           });
        }
      });
    });

    if (newRegistries.length > 0) {
      if (isCloudActive) {
        const payload = newRegistries.map(r => ({
          id: r.id, date: r.date, slot_id: r.slotId, class_name: r.className, subject: r.subject,
          absent_teacher_id: r.absentTeacherId, absent_teacher_name: r.absentTeacherName,
          substitute_teacher_id: '', substitute_teacher_name: 'PENDING ASSIGNMENT', section: r.section, is_archived: false
        }));
        await supabase.from('substitution_ledger').insert(payload);
      }
      setSubstitutions(prev => [...newRegistries, ...prev]);
      setStatus({ type: 'success', message: `${newRegistries.length} proxy duties identified.` });
    } else {
      setStatus({ type: 'info', message: "No new absentees with duties identified." });
    }
    setIsProcessing(false);
  };

  const handleSmartProxy = async () => {
    setIsProcessing(true);
    const pending = substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived && !s.substituteTeacherId);
    if (pending.length === 0) {
      setStatus({ type: 'info', message: "No pending duties for this wing." });
      setIsProcessing(false);
      return;
    }

    const updatedSubs: SubstitutionRecord[] = [];
    const newEntries: TimeTableEntry[] = [];
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dayName = new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' });

    for (const sub of pending) {
      const candidates = users
        .filter(u => u.id !== sub.absentTeacherId && !u.isResigned && isTeacherEligibleForSection(u, sub.section) && u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF)
        .map(teacher => ({ 
          teacher, 
          load: getTeacherLoadBreakdown(teacher.id, selectedDate, [...substitutions, ...updatedSubs]), 
          available: isTeacherAvailable(teacher.id, sub.slotId, selectedDate, updatedSubs) 
        }))
        .filter(c => c.available && c.load.total < MAX_TOTAL_WEEKLY_LOAD)
        .sort((a, b) => a.load.total - b.load.total);

      if (candidates.length > 0) {
        const best = candidates[0].teacher;
        const updated = { ...sub, substituteTeacherId: best.id, substituteTeacherName: best.name };
        updatedSubs.push(updated);
        newEntries.push({
          id: `sub-entry-${sub.id}`, section: sub.section, className: sub.className, day: dayName,
          slotId: sub.slotId, subject: sub.subject, subjectCategory: SubjectCategory.CORE,
          teacherId: best.id, teacherName: best.name, date: selectedDate, isSubstitution: true
        });

        // Trigger Automated Private Alert
        if (best.telegram_chat_id && config.telegramBotToken) {
           TelegramService.sendProxyAlert(config.telegramBotToken, best, updated);
        }
      }
    }

    if (updatedSubs.length > 0) {
      if (isCloudActive) {
        for (const s of updatedSubs) {
          await supabase.from('substitution_ledger').update({ substitute_teacher_id: s.substituteTeacherId, substitute_teacher_name: s.substituteTeacherName }).eq('id', s.id);
        }
        const cloudT = newEntries.map(e => ({
          id: e.id, section: e.section, class_name: e.className, day: e.day, slot_id: e.slotId, 
          subject: e.subject, subject_category: e.subjectCategory, teacher_id: e.teacherId, 
          teacher_name: e.teacherName, date: e.date, is_substitution: true
        }));
        await supabase.from('timetable_entries').upsert(cloudT);
      }
      setSubstitutions(prev => {
        const ids = new Set(updatedSubs.map(u => u.id));
        return [...prev.filter(s => !ids.has(s.id)), ...updatedSubs];
      });
      setTimetable(prev => {
        const ids = new Set(newEntries.map(e => e.id));
        return [...prev.filter(t => !ids.has(t.id)), ...newEntries];
      });
      setStatus({ type: 'success', message: `Smart Proxy: Assigned ${updatedSubs.length} duties.` });
    }
    setIsProcessing(false);
  };

  const handleDeleteSubstitution = async (sub: SubstitutionRecord) => {
    if (!confirm("Are you sure you want to remove this proxy duty?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive) {
        await supabase.from('substitution_ledger').delete().eq('id', sub.id);
        await supabase.from('timetable_entries').delete().eq('id', `sub-entry-${sub.id}`);
      }
      setSubstitutions(prev => prev.filter(s => s.id !== sub.id));
      setTimetable(prev => prev.filter(t => t.id !== `sub-entry-${sub.id}`));
      setStatus({ type: 'success', message: 'Registry purged.' });
    } catch (err: any) { setStatus({ type: 'error', message: err.message }); }
    finally { setIsProcessing(false); }
  };

  const handleArchive = async () => {
    if (!confirm("Archive active proxies for this wing?")) return;
    setIsProcessing(true);
    const targets = substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived);
    if (isCloudActive) await supabase.from('substitution_ledger').update({ is_archived: true }).in('id', targets.map(t => t.id));
    setSubstitutions(prev => prev.map(s => (s.date === selectedDate && s.section === activeSection) ? { ...s, isArchived: true } : s));
    setStatus({ type: 'success', message: 'Archival complete.' });
    setIsProcessing(false);
  };

  const commitSubstitution = async (subId: string, teacher: User) => {
    setIsProcessing(true);
    const sub = substitutions.find(s => s.id === subId)!;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dayName = new Date(year, month-1, day).toLocaleDateString('en-US', { weekday: 'long' });
    const updated = { ...sub, substituteTeacherId: teacher.id, substituteTeacherName: teacher.name };
    const newEntry = {
      id: `sub-entry-${subId}`, section: sub.section, className: sub.className, day: dayName,
      slotId: sub.slotId, subject: sub.subject, subjectCategory: SubjectCategory.CORE,
      teacherId: teacher.id, teacherName: teacher.name, date: selectedDate, isSubstitution: true
    };

    if (isCloudActive) {
      await supabase.from('substitution_ledger').update({ substitute_teacher_id: teacher.id, substitute_teacher_name: teacher.name }).eq('id', subId);
      await supabase.from('timetable_entries').upsert({
        id: newEntry.id, section: newEntry.section, class_name: newEntry.className, day: newEntry.day,
        slot_id: newEntry.slotId, subject: newEntry.subject, subject_category: newEntry.subjectCategory,
        teacher_id: newEntry.teacherId, teacher_name: newEntry.teacherName, date: newEntry.date, is_substitution: true
      });
    }

    // Isolated Telegram Alert
    if (teacher.telegram_chat_id && config.telegramBotToken) {
       await TelegramService.sendProxyAlert(config.telegramBotToken, teacher, updated);
    }

    setSubstitutions(prev => prev.map(s => s.id === subId ? updated : s));
    setTimetable(prev => [...prev.filter(t => t.id !== newEntry.id), newEntry]);
    setManualAssignTarget(null);
    setStatus({ type: 'success', message: `Deployed ${teacher.name}. Alert Dispatched.` });
    setIsProcessing(false);
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
              <button onClick={() => setShowWorkloadHub(!showWorkloadHub)} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md flex items-center gap-2 ${showWorkloadHub ? 'bg-amber-400 text-[#001f3f]' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>Workload</button>
              <button onClick={handleScanForAbsentees} disabled={isProcessing} className="bg-white dark:bg-slate-800 text-[#001f3f] dark:text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase shadow-md border border-slate-200 dark:border-slate-700">Scan</button>
              <button onClick={handleSmartProxy} disabled={isProcessing} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2">Smart Proxy</button>
              <button onClick={handleArchive} className="bg-slate-100 dark:bg-slate-700 text-slate-500 px-5 py-3 rounded-2xl text-[10px] font-black uppercase">Archive</button>
            </>
          )}
        </div>
      </div>

      {status && (
        <div className={`p-4 rounded-2xl text-[10px] font-black uppercase border animate-in slide-in-from-top ${
          status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'
        }`}>
          {status.message}
        </div>
      )}

      {showWorkloadHub && (
        <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/5 animate-in slide-in-from-top-4 duration-500">
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-h-[300px] overflow-y-auto scrollbar-hide">
              {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF).map(person => {
                 const stats = getTeacherLoadBreakdown(person.id, selectedDate);
                 return (
                    <div key={person.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                       <p className="text-[10px] font-black text-white uppercase italic truncate">{person.name}</p>
                       <div className="flex justify-between items-baseline mt-2">
                          <span className="text-xl font-black text-[#d4af37] italic">{stats.total}P</span>
                          <span className="text-[8px] font-black text-white/30 uppercase">Bal: {stats.remaining}P</span>
                       </div>
                    </div>
                 );
              })}
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-4 md:p-8 border-b border-slate-50 dark:border-slate-800 flex flex-col lg:flex-row items-center justify-between no-print bg-slate-50/50 gap-4">
           <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide w-full lg:w-auto">
              {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS', 'SENIOR_SECONDARY_BOYS', 'SENIOR_SECONDARY_GIRLS'] as SectionType[]).map(s => (
                <button key={s} onClick={() => setActiveSection(s)} className={`px-4 md:px-5 py-2.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{s.replace(/_/g, ' ')}</button>
              ))}
           </div>
           <div className="flex items-center gap-3 bg-white dark:bg-slate-900 px-4 py-2 rounded-2xl border border-slate-100 dark:border-slate-800">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Date:</span>
             <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black outline-none dark:text-white" />
           </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30">
                <th className="px-8 py-6">Period</th>
                <th className="px-8 py-6">Class Info</th>
                <th className="px-8 py-6">Personnel Deployment</th>
                <th className="px-8 py-6 text-right">Matrix Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived).sort((a,b) => a.slotId - b.slotId).map(sub => (
                <tr key={sub.id} className="hover:bg-amber-50/5 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black italic shadow-lg">
                      {getSlotLabel(sub.slotId, sub.section)}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-sm font-black text-[#001f3f] dark:text-white italic leading-none">{sub.className}</p>
                    <p className="text-[9px] font-black text-sky-600 uppercase mt-1.5 italic">{sub.subject}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-6">
                       <div className="min-w-[120px]">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Absentee</p>
                          <p className="text-xs font-black text-rose-500 italic truncate">{sub.absentTeacherName}</p>
                       </div>
                       <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
                       <div className="min-w-[120px]">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Assigned Substitute</p>
                          <p className={`text-xs font-black italic truncate ${sub.substituteTeacherId ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`}>{sub.substituteTeacherName}</p>
                       </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                       <button onClick={() => setManualAssignTarget(sub)} className="px-5 py-2.5 bg-sky-50 text-sky-600 text-[9px] font-black uppercase tracking-widest rounded-xl border border-sky-100 hover:bg-sky-600 hover:text-white transition-all">Manual Deploy</button>
                       <button onClick={() => handleDeleteSubstitution(sub)} className="p-2.5 text-rose-300 hover:text-rose-500 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {substitutions.filter(s => s.date === selectedDate && s.section === activeSection && !s.isArchived).length === 0 && (
            <div className="py-32 text-center opacity-30 italic font-black uppercase tracking-widest text-[10px]">No active proxies in ledger</div>
          )}
        </div>
      </div>

      {manualAssignTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300 flex flex-col max-h-[85vh]">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">Manual Deployment</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Class: {manualAssignTarget.className} • Period {manualAssignTarget.slotId}</p>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide space-y-3">
                 {deploymentCandidates.map(({ teacher, load, available }) => (
                    <button key={teacher.id} disabled={!available || isProcessing} onClick={() => commitSubstitution(manualAssignTarget.id, teacher)} className={`w-full p-5 rounded-3xl border-2 flex items-center justify-between transition-all text-left ${available ? 'border-slate-100 hover:border-amber-400 bg-white dark:bg-slate-800' : 'opacity-40 border-transparent bg-slate-50 cursor-not-allowed'}`}>
                       <div>
                          <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{teacher.name}</p>
                          <p className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 tracking-widest">{teacher.employeeId} • Load: {load.total}P</p>
                       </div>
                       {available ? (
                          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500 shadow-sm"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg></div>
                       ) : <span className="text-[8px] font-black text-rose-400 uppercase tracking-widest">Unavailable</span>}
                    </button>
                 ))}
              </div>
              <button onClick={() => setManualAssignTarget(null)} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Abort Deployment</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;

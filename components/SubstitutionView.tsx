
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SectionType, TeacherAssignment, SchoolConfig, SchoolNotification, SubstitutionRecord, SubjectCategory, TimeSlot } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { NotificationService } from '../services/notificationService.ts';
import { TelegramService } from '../services/telegramService.ts';

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
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

interface DutyGap {
  id: string;
  className: string;
  subject: string;
  slotId: number;
  absentTeacherId: string;
  absentTeacherName: string;
  wingId: string;
  gradeId: string;
  sectionId: string;
  section: SectionType;
  suggestedReplacementId?: string;
  suggestedReplacementName?: string;
}

const SubstitutionView: React.FC<SubstitutionViewProps> = ({ user, users, attendance, timetable, setTimetable, substitutions, setSubstitutions, assignments, config, setNotifications, isSandbox, addSandboxLog }) => {
  const getBahrainToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const [activeSection, setActiveSection] = useState<SectionType>(() => {
    const saved = localStorage.getItem('ihis_cached_section');
    return (saved as SectionType) || 'PRIMARY';
  });

  const [selectedDate, setSelectedDate] = useState<string>(getBahrainToday());
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info', message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [detectedGaps, setDetectedGaps] = useState<DutyGap[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);
  const [newProxyData, setNewProxyData] = useState({ 
    sectionId: '', 
    absentTeacherId: '', 
    substituteTeacherId: '',
    slotId: 1, 
    subject: '' 
  });

  const isAdmin = user.role === UserRole.ADMIN;
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  const isGlobalManager = isAdmin || user.role === UserRole.INCHARGE_ALL;
  const isCloudActive = IS_CLOUD_ENABLED;

  const getWeekBounds = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDay(); 
    const sun = new Date(d);
    sun.setDate(d.getDate() - day);
    const thu = new Date(sun);
    thu.setDate(sun.getDate() + 4);
    return { start: sun.toISOString().split('T')[0], end: thu.toISOString().split('T')[0] };
  };

  const getTeacherLoadBreakdown = useCallback((teacherId: string, targetDate: string, currentSubs: SubstitutionRecord[] = substitutions) => {
    const teacher = users.find(u => u.id === teacherId);
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    const policy = config.loadPolicies?.[teacher?.role || ''] || { baseTarget: 28, substitutionCap: 5 };
    
    const baseLoad = teacherAssignments.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0);
    const groupLoad = teacherAssignments.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
    const bounds = getWeekBounds(targetDate);
    const weeklyProxies = currentSubs.filter(s => s.substituteTeacherId === teacherId && !s.isArchived && s.date >= bounds.start && s.date <= bounds.end);
    const proxyLoad = weeklyProxies.length;
    
    return { 
      baseLoad, groupLoad, proxyLoad, total: baseLoad + groupLoad + proxyLoad, 
      proxyCap: policy.substitutionCap,
      isCapReached: proxyLoad >= policy.substitutionCap,
      remainingProxy: Math.max(0, policy.substitutionCap - proxyLoad)
    };
  }, [assignments, substitutions, config.loadPolicies, users]);

  const teacherLoadMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTeacherLoadBreakdown>>();
    users.forEach(u => {
      map.set(u.id, getTeacherLoadBreakdown(u.id, selectedDate));
    });
    return map;
  }, [users, selectedDate, substitutions, assignments, config.loadPolicies, getTeacherLoadBreakdown]);

  const manualClashStatus = useMemo(() => {
    const { substituteTeacherId, slotId } = newProxyData;
    if (!substituteTeacherId || !slotId) return null;

    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date(selectedDate));
    
    const permanentClash = timetable.find(t => 
      t.teacherId === substituteTeacherId && 
      t.day === weekday && 
      t.slotId === Number(slotId) && 
      !t.date
    );

    const proxyClash = substitutions.find(s => 
      s.substituteTeacherId === substituteTeacherId && 
      s.date === selectedDate && 
      s.slotId === Number(slotId) && 
      !s.isArchived
    );

    if (permanentClash) return `Busy: Regular class with ${permanentClash.className}`;
    if (proxyClash) return `Busy: Already doing proxy for ${proxyClash.absentTeacherName}`;
    
    return null;
  }, [newProxyData.substituteTeacherId, newProxyData.slotId, selectedDate, timetable, substitutions]);

  const handleScanForGaps = useCallback(() => {
    setIsScanning(true);
    setHasScanned(true);
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date(selectedDate));
    
    const nowBahrain = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
    const isEarlyMorning = selectedDate === getBahrainToday() && (nowBahrain.getHours() < 7 || (nowBahrain.getHours() === 7 && nowBahrain.getMinutes() < 30));

    const absentTeacherIds = users
      .filter(u => {
        const record = attendance.find(r => r.userId === u.id && r.date === selectedDate);
        if (isEarlyMorning) return record?.checkIn === 'MEDICAL';
        return !record || record.checkIn === 'MEDICAL';
      }).map(u => u.id);

    const gaps: DutyGap[] = [];
    timetable
      .filter(t => t.day === weekday && absentTeacherIds.includes(t.teacherId) && !t.date && t.section === activeSection)
      .forEach(t => {
        const alreadyProxied = substitutions.some(s => s.date === selectedDate && s.slotId === t.slotId && s.sectionId === t.sectionId);
        if (!alreadyProxied) {
          gaps.push({ id: generateUUID(), className: t.className, subject: t.subject, slotId: t.slotId, absentTeacherId: t.teacherId, absentTeacherName: t.teacherName, wingId: t.wingId, gradeId: t.gradeId, sectionId: t.sectionId, section: t.section });
        }
      });

    const gapsWithSuggestions = gaps.map(gap => {
      const candidates = users.filter(u => {
        if (u.isResigned || u.role === UserRole.ADMIN) return false;
        const isPresent = attendance.some(r => r.userId === u.id && r.date === selectedDate && r.checkIn !== 'MEDICAL');
        if (!isPresent) return false;
        const isFree = !timetable.some(t => t.day === weekday && t.slotId === gap.slotId && t.teacherId === u.id && !t.date) &&
                       !substitutions.some(s => s.date === selectedDate && s.slotId === gap.slotId && s.substituteTeacherId === u.id && !s.isArchived);
        if (!isFree) return false;
        const metrics = teacherLoadMap.get(u.id);
        return metrics && !metrics.isCapReached;
      });

      const sorted = candidates.sort((a, b) => (teacherLoadMap.get(a.id)?.proxyLoad || 0) - (teacherLoadMap.get(b.id)?.proxyLoad || 0));
      if (sorted.length > 0) return { ...gap, suggestedReplacementId: sorted[0].id, suggestedReplacementName: sorted[0].name };
      return gap;
    });

    setDetectedGaps(gapsWithSuggestions);
    setIsScanning(false);
  }, [selectedDate, timetable, attendance, substitutions, users, teacherLoadMap, activeSection]);

  const activeProxies = useMemo(() => {
    const list = substitutions.filter(s => s.date === selectedDate && s.section === activeSection);
    if (!isManagement) return list.filter(s => s.substituteTeacherId === user.id);
    return list;
  }, [substitutions, selectedDate, activeSection, isManagement, user.id]);

  const workloadUsers = useMemo(() => {
    const filtered = users.filter(u => {
      if (isGlobalManager) return !u.isResigned && u.role !== UserRole.ADMIN;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY') && !u.isResigned;
      if (user.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY') && !u.isResigned;
      return false;
    });
    return filtered.sort((a, b) => {
      const ma = teacherLoadMap.get(a.id);
      const mb = teacherLoadMap.get(b.id);
      if (ma && mb && ma.proxyLoad !== mb.proxyLoad) return ma.proxyLoad - mb.proxyLoad;
      return a.name.localeCompare(b.name);
    });
  }, [users, isGlobalManager, user.role, teacherLoadMap]);

  const handleResendAlert = async (sub: SubstitutionRecord) => {
    if (isSandbox) {
       showToast("Simulation: Signal Resent via Telegram", "info");
       return;
    }
    const subStaff = users.find(u => u.id === sub.substituteTeacherId);
    if (!subStaff?.telegram_chat_id || !config.telegramBotToken) {
       showToast("Missing Matrix Connectivity for this staff", "warning");
       return;
    }
    
    setIsProcessing(true);
    try {
      const ok = await TelegramService.sendProxyAlert(config.telegramBotToken, subStaff, sub);
      if (ok) {
        const nowStr = new Date().toISOString();
        if (isCloudActive) {
          await supabase.from('substitution_ledger').update({ last_notified_at: nowStr }).eq('id', sub.id);
        }
        setSubstitutions(prev => prev.map(s => s.id === sub.id ? { ...s, lastNotifiedAt: nowStr } : s));
        showToast("Signal Dispatched Successfully", "success");
      } else {
        showToast("Signal Dispatch Failed: Provider Error", "error");
      }
    } catch (err) {
      showToast("Dispatch Exception", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateProxy = async (sub: SubstitutionRecord) => {
    setIsProcessing(true);
    try {
      const payload = { 
        id: sub.id,
        date: sub.date,
        slot_id: sub.slotId, 
        wing_id: sub.wingId, 
        grade_id: sub.gradeId, 
        section_id: sub.sectionId, 
        class_name: sub.className, 
        subject: sub.subject,
        absent_teacher_id: sub.absentTeacherId, 
        absent_teacher_name: sub.absentTeacherName, 
        substitute_teacher_id: sub.substituteTeacherId, 
        substitute_teacher_name: sub.substituteTeacherName, 
        section: sub.section,
        is_archived: false,
        last_notified_at: null as string | null
      };

      if (isCloudActive && !isSandbox) {
        const { error } = await supabase.from('substitution_ledger').insert(payload);
        if (error) throw error;
        
        const subStaff = users.find(u => u.id === sub.substituteTeacherId);
        if (subStaff?.telegram_chat_id && config.telegramBotToken) {
          const notified = await TelegramService.sendProxyAlert(config.telegramBotToken, subStaff, sub);
          if (notified) {
            const nowStr = new Date().toISOString();
            payload.last_notified_at = nowStr;
            await supabase.from('substitution_ledger').update({ last_notified_at: nowStr }).eq('id', sub.id);
            sub.lastNotifiedAt = nowStr;
          }
        }
      } else if (isSandbox) {
        addSandboxLog?.('PROXY_CREATE', payload);
      }

      setSubstitutions(prev => [sub, ...prev]);
      setDetectedGaps(prev => prev.filter(g => !(g.sectionId === sub.sectionId && g.slotId === sub.slotId)));
      showToast("Proxy Deployment Synchronized", "success");
    } catch (err: any) { 
      showToast(err.message || "Matrix Error", "error"); 
    } finally { 
      setIsProcessing(false); 
      setIsNewEntryModalOpen(false);
    }
  };

  const handleDeleteProxy = async (id: string) => {
    if (!confirm("Are you sure you want to PERMANENTLY DELETE this proxy?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive && !isSandbox) {
        const { error } = await supabase.from('substitution_ledger').delete().eq('id', id);
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('PROXY_DELETE', { id });
      }
      setSubstitutions(prev => prev.filter(s => s.id !== id));
      showToast("Proxy Record Removed", "info");
    } catch (err: any) { showToast(err.message, "error"); }
    finally { setIsProcessing(false); }
  };

  const handleManualProxySubmit = () => {
    const { sectionId, absentTeacherId, substituteTeacherId, slotId, subject } = newProxyData;
    if (!sectionId || !absentTeacherId || !substituteTeacherId || !subject) {
      showToast("All fields are mandatory for manual entry.", "warning");
      return;
    }
    if (manualClashStatus) {
      showToast("Matrix Conflict: Selected staff is already deployed elsewhere.", "error");
      return;
    }
    
    const section = config.sections.find(s => s.id === sectionId)!;
    const absent = users.find(u => u.id === absentTeacherId)!;
    const sub = users.find(u => u.id === substituteTeacherId)!;
    const wing = config.wings.find(w => w.id === section.wingId)!;

    const subRecord: SubstitutionRecord = {
      id: generateUUID(),
      date: selectedDate,
      slotId: Number(slotId),
      wingId: section.wingId,
      gradeId: section.gradeId,
      sectionId: section.id,
      className: section.fullName,
      subject: subject.toUpperCase(),
      absentTeacherId: absent.id,
      absentTeacherName: absent.name,
      substituteTeacherId: sub.id,
      substituteTeacherName: sub.name,
      section: wing.sectionType,
      isArchived: false
    };
    handleCreateProxy(subRecord);
  };

  const showToast = (msg: string, type: any = 'success') => setStatus({ message: msg, type });

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Proxy <span className="text-amber-500">Matrix</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Policy Enforcement Protocol</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 shadow-sm">
             {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
               <button key={s} onClick={() => { setActiveSection(s); localStorage.setItem('ihis_cached_section', s); }} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeSection === s ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>
                 {s.split('_')[0]}
               </button>
             ))}
          </div>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="px-6 py-3.5 bg-white dark:bg-slate-900 border-2 border-slate-100 rounded-2xl text-[11px] font-black uppercase outline-none dark:text-white" />
          {isManagement && (
            <>
              <button onClick={handleScanForGaps} disabled={isScanning} className="bg-amber-400 text-[#001f3f] px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 disabled:opacity-50">
                {isScanning ? 'Scanning...' : 'Scan Gaps'}
              </button>
              <button onClick={() => setIsNewEntryModalOpen(true)} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[11px] uppercase shadow-lg active:scale-95">Manual Entry</button>
            </>
          )}
        </div>
      </div>

      {status && (
        <div className={`mx-2 p-4 rounded-2xl border-2 animate-in slide-in-from-top-4 flex items-center gap-3 ${status.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-600' : status.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-emerald-50 border-emerald-100 text-emerald-600'}`}>
           <p className="text-[10px] font-black uppercase tracking-widest">{status.message}</p>
        </div>
      )}

      {isManagement && detectedGaps.length > 0 && (
        <div className="mx-2 bg-rose-50 dark:bg-rose-900/10 border-2 border-dashed border-rose-200 p-6 rounded-[2.5rem]">
           <h3 className="text-xl font-black text-rose-600 uppercase italic tracking-tighter mb-4 flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
             Policy Gaps Detected ({activeSection})
           </h3>
           <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
              {detectedGaps.map(gap => (
                <div key={gap.id} className="flex-shrink-0 w-[280px] bg-white dark:bg-slate-900 p-5 rounded-3xl border border-rose-100 shadow-lg space-y-4">
                   <div className="flex justify-between items-start">
                      <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/50 text-rose-600 rounded-xl flex items-center justify-center font-black text-xs">P{gap.slotId}</div>
                      <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase truncate text-right">{gap.className}<br/><span className="text-slate-400 font-bold tracking-normal">{gap.subject}</span></p>
                   </div>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">Absence: <span className="text-rose-500 italic">{gap.absentTeacherName}</span></p>
                   {gap.suggestedReplacementId ? (
                     <div className="space-y-3 pt-2 border-t border-slate-50 dark:border-slate-800">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-tight">Rec: {gap.suggestedReplacementName}</p>
                        <button onClick={() => {
                          const sub: SubstitutionRecord = { id: generateUUID(), date: selectedDate, slotId: gap.slotId, wingId: gap.wingId, gradeId: gap.gradeId, sectionId: gap.sectionId, className: gap.className, subject: gap.subject, absentTeacherId: gap.absentTeacherId, absentTeacherName: gap.absentTeacherName, substituteTeacherId: gap.suggestedReplacementId!, substituteTeacherName: gap.suggestedReplacementName!, section: gap.section, isArchived: false };
                          handleCreateProxy(sub);
                        }} className="w-full bg-[#001f3f] text-white py-3 rounded-xl font-black text-[9px] uppercase shadow-md hover:bg-slate-950 transition-all">Deploy Policy</button>
                     </div>
                   ) : <p className="text-[9px] font-black text-slate-400 italic">No available policy-compliant staff</p>}
                </div>
              ))}
           </div>
        </div>
      )}

      {isManagement && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="flex justify-between items-center mb-6 px-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Dynamic Proxy Utilization Pulse</p>
            <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest italic">Sorted by Availability</span>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 px-4">
            {workloadUsers.map(u => {
                const metrics = teacherLoadMap.get(u.id);
                if (!metrics) return null;
                const colorClass = metrics.isCapReached ? 'border-rose-500' : metrics.proxyLoad > 0 ? 'border-amber-400' : 'border-slate-100 dark:border-slate-800';
                return (
                  <div key={u.id} className={`flex-shrink-0 min-w-[160px] p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border-2 transition-all group hover:scale-105 ${colorClass}`}>
                    <p className="text-[10px] font-black text-[#001f3f] dark:text-white truncate uppercase">{u.name.split(' ')[0]}</p>
                    <div className="flex items-baseline gap-1 mt-2">
                        <span className={`text-2xl font-black italic ${metrics.isCapReached ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>{metrics.proxyLoad}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase">/ {metrics.proxyCap} Cap</span>
                    </div>
                    <div className="h-1.5 w-full bg-white dark:bg-slate-900 rounded-full mt-3 overflow-hidden">
                        <div style={{ width: `${Math.min(100, (metrics.proxyLoad / metrics.proxyCap) * 100)}%` }} className={`h-full transition-all duration-1000 ${metrics.isCapReached ? 'bg-rose-500' : 'bg-sky-500'}`}></div>
                    </div>
                  </div>
                );
            })}
          </div>
        </div>
      )}
      
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/30 border-y border-slate-100 dark:border-slate-800">
                <th className="px-10 py-6">Identity & Temporal</th>
                <th className="px-10 py-6">Deployment Matrix</th>
                <th className="px-10 py-6 text-right">Audit Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {activeProxies.length > 0 ? activeProxies.map(p => (
                <tr key={p.id} className={`hover:bg-amber-50/5 transition-colors group ${p.isArchived ? 'opacity-40 grayscale' : ''}`}>
                  <td className="px-10 py-8">
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-sky-50 dark:bg-sky-900/20 text-sky-600 rounded-xl flex items-center justify-center font-black text-xs italic">P{p.slotId}</div>
                        <div>
                           <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{p.date}</p>
                           <p className="text-[10px] font-bold text-sky-600 uppercase mt-1.5">{p.className} • {p.subject}</p>
                           {p.lastNotifiedAt && (
                             <p className="text-[7px] font-black text-emerald-500 uppercase tracking-widest mt-2 flex items-center gap-1.5">
                               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                               Notified: {new Date(p.lastNotifiedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                             </p>
                           )}
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8">
                     <div className="flex items-center gap-6">
                        <div className="space-y-1">
                           <span className="text-[7px] font-black text-slate-400 uppercase block">OUT</span>
                           <span className="text-[11px] font-black text-rose-500 uppercase italic tracking-tight">{p.absentTeacherName}</span>
                        </div>
                        <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-full"><svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></div>
                        <div className="space-y-1 text-right">
                           <span className="text-[7px] font-black text-slate-400 uppercase block">IN</span>
                           <span className="text-[11px] font-black text-emerald-600 uppercase italic tracking-tight">{p.substituteTeacherName}</span>
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8 text-right">
                    <div className="flex justify-end gap-2">
                       {isManagement && !p.isArchived && (
                        <button 
                           onClick={() => handleResendAlert(p)}
                           title="Dispatch Telegram Nudge"
                           className="p-3 text-sky-400 hover:text-sky-600 bg-sky-50 dark:bg-sky-900/20 rounded-xl transition-all"
                        >
                           <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                        </button>
                       )}
                       {isManagement && !p.isArchived && (
                        <button 
                          onClick={async () => {
                            if (isCloudActive && !isSandbox) await supabase.from('substitution_ledger').update({ is_archived: true }).eq('id', p.id);
                            else if (isSandbox) addSandboxLog?.('PROXY_ARCHIVE', { id: p.id });

                            setSubstitutions(prev => prev.map(s => s.id === p.id ? { ...s, isArchived: true } : s));
                            showToast("Record Archived", "info");
                          }} 
                          title="Archive Record"
                          className="p-3 text-slate-400 hover:text-emerald-500 bg-slate-50 dark:bg-slate-800 rounded-xl transition-all"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>
                        </button>
                      )}
                      {isManagement && (
                        <button 
                          onClick={() => handleDeleteProxy(p.id)}
                          title="Delete Record"
                          className="p-3 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-slate-800 rounded-xl transition-all"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                      {!isManagement && <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest italic">Immutable Record</span>}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                   <td colSpan={3} className="py-24 text-center">
                      <div className="opacity-20 flex flex-col items-center gap-4">
                         <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                         <p className="text-sm font-black uppercase tracking-[0.4em]">No matching active proxies for {selectedDate}</p>
                      </div>
                   </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      {isManagement && isNewEntryModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-y-auto max-h-[90vh]">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Override</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Explicit Deployment Matrix Entry</p>
              </div>

              {manualClashStatus && (
                <div className="bg-rose-50 dark:bg-rose-900/20 border-2 border-rose-200 p-4 rounded-2xl flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-rose-500 text-white rounded-lg flex items-center justify-center shrink-0 shadow-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
                  <p className="text-[10px] font-black text-rose-600 uppercase tracking-tighter">{manualClashStatus}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Class</label>
                    <select 
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                      value={newProxyData.sectionId}
                      onChange={e => setNewProxyData({...newProxyData, sectionId: e.target.value})}
                    >
                       <option value="">Select Section...</option>
                       {config.sections.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Time Slot</label>
                    <select 
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                      value={newProxyData.slotId}
                      onChange={e => setNewProxyData({...newProxyData, slotId: Number(e.target.value)})}
                    >
                       {Array.from({length: 10}).map((_, i) => <option key={i+1} value={i+1}>Period {i+1}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Absent Teacher</label>
                    <select 
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                      value={newProxyData.absentTeacherId}
                      onChange={e => setNewProxyData({...newProxyData, absentTeacherId: e.target.value})}
                    >
                       <option value="">Select Faculty...</option>
                       {users.filter(u => !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Substitute</label>
                    <select 
                      className={`w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 transition-all ${manualClashStatus ? 'ring-4 ring-rose-500/20 border-rose-400' : 'focus:ring-amber-400/20'}`}
                      value={newProxyData.substituteTeacherId}
                      onChange={e => setNewProxyData({...newProxyData, substituteTeacherId: e.target.value})}
                    >
                       <option value="">Select Faculty...</option>
                       {users.filter(u => !u.isResigned).map(u => {
                         const m = teacherLoadMap.get(u.id);
                         return <option key={u.id} value={u.id}>{u.name} {m?.isCapReached ? '(CAP REACHED)' : ''}</option>;
                       })}
                    </select>
                 </div>
                 <div className="md:col-span-2 space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Course Subject</label>
                    <select 
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                      value={newProxyData.subject}
                      onChange={e => setNewProxyData({...newProxyData, subject: e.target.value})}
                    >
                      <option value="">Select Subject Category...</option>
                      {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                 </div>
              </div>

              <div className="pt-6 space-y-4">
                 <button 
                    onClick={handleManualProxySubmit} 
                    disabled={isProcessing || !!manualClashStatus}
                    className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
                 >
                    {isProcessing ? 'Deploying Matrix...' : 'Authorize Manual Proxy'}
                 </button>
                 <button onClick={() => setIsNewEntryModalOpen(false)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest">Abort Process</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;

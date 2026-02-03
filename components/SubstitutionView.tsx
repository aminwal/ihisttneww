import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SectionType, TeacherAssignment, SchoolConfig, SchoolNotification, SubstitutionRecord, SubjectCategory, TimeSlot, LessonPlan, SavedPlanRecord } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
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
  isSurplusAsset?: boolean;
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

  // Substitution Bridge State
  const [linkedPlan, setLinkedPlan] = useState<SavedPlanRecord | null>(null);
  const [isFetchingPlan, setIsFetchingPlan] = useState(false);

  // BATCH DEPLOYMENT STATE
  const [isDeployingAll, setIsDeployingAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number, total: number } | null>(null);

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

  const surplusAssets = useMemo(() => {
    const suspendedGradeIds = (config.gradeSuspensions || [])
      .filter(s => s.date === selectedDate)
      .map(s => s.gradeId);
    
    if (suspendedGradeIds.length === 0) return new Set<string>();

    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date(selectedDate));
    
    const assets = new Set<string>();
    timetable.forEach(t => {
      if (t.day === weekday && suspendedGradeIds.includes(t.gradeId) && !t.date) {
        assets.add(t.teacherId);
      }
    });
    return assets;
  }, [selectedDate, config.gradeSuspensions, timetable]);

  const handleScanForGaps = useCallback(() => {
    setIsScanning(true);
    setHasScanned(true);
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date(selectedDate));
    
    const nowBahrain = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
    const isEarlyMorning = selectedDate === getBahrainToday() && (nowBahrain.getHours() < 7 || (nowBahrain.getHours() === 7 && nowBahrain.getMinutes() < 30));

    const suspendedGradeIds = (config.gradeSuspensions || [])
      .filter(s => s.date === selectedDate)
      .map(s => s.gradeId);

    const absentTeacherIds = users
      .filter(u => {
        const record = attendance.find(r => r.userId === u.id && r.date === selectedDate);
        if (isEarlyMorning) return record?.checkIn === 'MEDICAL';
        return !record || record.checkIn === 'MEDICAL';
      }).map(u => u.id);

    const gaps: DutyGap[] = [];
    timetable
      .filter(t => 
        t.day === weekday && 
        absentTeacherIds.includes(t.teacherId) && 
        !t.date && 
        t.section === activeSection &&
        !suspendedGradeIds.includes(t.gradeId) 
      )
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
        
        const isNaturallyFree = !timetable.some(t => t.day === weekday && t.slotId === gap.slotId && t.teacherId === u.id && !t.date);
        const isSurplusInThisPeriod = !isNaturallyFree && timetable.some(t => t.day === weekday && t.slotId === gap.slotId && t.teacherId === u.id && !t.date && suspendedGradeIds.includes(t.gradeId));
        
        const isBusyWithAnotherProxy = substitutions.some(s => s.date === selectedDate && s.slotId === gap.slotId && s.substituteTeacherId === u.id && !s.isArchived);
        
        if (!isNaturallyFree && !isSurplusInThisPeriod) return false;
        if (isBusyWithAnotherProxy) return false;

        const metrics = teacherLoadMap.get(u.id);
        return metrics && !metrics.isCapReached;
      });

      const sorted = candidates.sort((a, b) => {
        const aIsSurplus = surplusAssets.has(a.id);
        const bIsSurplus = surplusAssets.has(b.id);
        if (aIsSurplus && !bIsSurplus) return -1;
        if (!aIsSurplus && bIsSurplus) return 1;

        const ma = teacherLoadMap.get(a.id);
        const mb = teacherLoadMap.get(b.id);
        if (ma && mb) {
          if (ma.proxyLoad !== mb.proxyLoad) return ma.proxyLoad - mb.proxyLoad;
          return ma.total - mb.total;
        }
        return 0;
      });
      
      if (sorted.length > 0) return { 
        ...gap, 
        suggestedReplacementId: sorted[0].id, 
        suggestedReplacementName: sorted[0].name,
        isSurplusAsset: surplusAssets.has(sorted[0].id)
      };
      return gap;
    });

    setDetectedGaps(gapsWithSuggestions);
    setIsScanning(false);
  }, [selectedDate, timetable, attendance, substitutions, users, teacherLoadMap, activeSection, config.gradeSuspensions, surplusAssets]);

  const activeProxies = useMemo(() => {
    const list = substitutions.filter(s => s.date === selectedDate && s.section === activeSection);
    if (!isManagement) return list.filter(s => s.substituteTeacherId === user.id);
    return list;
  }, [substitutions, selectedDate, activeSection, isManagement, user.id]);

  const workloadUsers = useMemo(() => {
    const filtered = users.filter(u => {
      // Rule Protocol: Only roles categorized as TEACHERS are required for substitution load tracking.
      // Management, In-charges, and Admins are excluded from the Pulse widget.
      const isTeacher = u.role.includes('TEACHER');
      if (!isTeacher || u.isResigned) return false;

      if (isGlobalManager) return true;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY');
      if (user.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY');
      return false;
    });
    return filtered.sort((a, b) => {
      const aIsSurplus = surplusAssets.has(a.id);
      const bIsSurplus = surplusAssets.has(b.id);
      if (aIsSurplus && !bIsSurplus) return -1;
      if (!aIsSurplus && bIsSurplus) return 1;

      const ma = teacherLoadMap.get(a.id);
      const mb = teacherLoadMap.get(b.id);
      if (ma && mb) {
        if (ma.proxyLoad !== mb.proxyLoad) return ma.proxyLoad - mb.proxyLoad;
        return ma.total - mb.total;
      }
      return a.name.localeCompare(b.name);
    });
  }, [users, isGlobalManager, user.role, teacherLoadMap, surplusAssets]);

  const handleResendAlert = async (sub: SubstitutionRecord) => {
    if (isSandbox) {
       showToast("Simulation: Proxy notification sent via Telegram.", "info");
       return;
    }
    const subStaff = users.find(u => u.id === sub.substituteTeacherId);
    if (!subStaff?.telegram_chat_id || !config.telegramBotToken) {
       showToast("Teacher has not linked their Telegram account.", "warning");
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
        showToast("Notification sent successfully.", "success");
      } else {
        showToast("Failed to send message.", "error");
      }
    } catch (err) {
      showToast("Error sending notification.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFetchLinkedPlan = async (absentTeacherId: string, date: string, sectionId: string) => {
    if (!IS_CLOUD_ENABLED) return;
    setIsFetchingPlan(true);
    try {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .eq('teacher_id', absentTeacherId)
        .eq('date', date)
        .eq('section_id', sectionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (error) throw error;
      setLinkedPlan(data);
    } catch (err) {
      showToast("No lesson plan found for this class.", "info");
    } finally {
      setIsFetchingPlan(false);
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
      showToast("Proxy assigned and teacher notified.", "success");
    } catch (err: any) { 
      showToast(err.message || "Something went wrong.", "error"); 
    } finally { 
      setIsProcessing(false); 
      setIsNewEntryModalOpen(false);
    }
  };

  const handleDeployAll = async () => {
    const gapsToDeploy = detectedGaps.filter(g => !!g.suggestedReplacementId);
    if (gapsToDeploy.length === 0) {
      showToast("No suggested teachers found for these classes.", "warning");
      return;
    }

    setIsDeployingAll(true);
    setBatchProgress({ current: 0, total: gapsToDeploy.length });
    
    try {
      for (let i = 0; i < gapsToDeploy.length; i++) {
        const gap = gapsToDeploy[i];
        setBatchProgress({ current: i + 1, total: gapsToDeploy.length });
        
        const sub: SubstitutionRecord = {
          id: generateUUID(),
          date: selectedDate,
          slotId: gap.slotId,
          wingId: gap.wingId,
          gradeId: gap.gradeId,
          sectionId: gap.sectionId,
          className: gap.className,
          subject: gap.subject,
          absentTeacherId: gap.absentTeacherId,
          absentTeacherName: gap.absentTeacherName,
          substituteTeacherId: gap.suggestedReplacementId!,
          substituteTeacherName: gap.suggestedReplacementName!,
          section: gap.section,
          isArchived: false
        };

        // Recursive internal call to standard logic
        await handleCreateProxy(sub);
      }
      showToast(`Assigned ${gapsToDeploy.length} proxies successfully.`, "success");
    } catch (err) {
      showToast("Could not assign all proxies.", "error");
    } finally {
      setIsDeployingAll(false);
      setBatchProgress(null);
    }
  };

  const handleDeleteProxy = async (id: string) => {
    if (!confirm("Are you sure you want to remove this proxy assignment?")) return;
    setIsProcessing(true);
    try {
      if (isCloudActive && !isSandbox) {
        const { error } = await supabase.from('substitution_ledger').delete().eq('id', id);
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('PROXY_DELETE', { id });
      }
      setSubstitutions(prev => prev.filter(s => s.id !== id));
      showToast("Proxy assignment removed.", "info");
    } catch (err: any) { showToast(err.message, "error"); }
    finally { setIsProcessing(false); }
  };

  const showToast = (msg: string, type: any = 'success') => setStatus({ message: msg, type });

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const hasDeployableGaps = detectedGaps.some(g => !!g.suggestedReplacementId);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Proxy Management</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Manage substitute classes for absent staff</p>
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
                {isScanning ? 'Checking...' : 'Find Empty Classes'}
              </button>
              
              <button 
                onClick={handleDeployAll} 
                disabled={isDeployingAll || !hasDeployableGaps}
                className={`px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all ${
                  isDeployingAll || !hasDeployableGaps 
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none' 
                    : 'bg-emerald-600 text-white shadow-xl hover:bg-slate-900 animate-pulse'
                }`}
              >
                {isDeployingAll ? 'Assigning...' : 'Assign All Recommended'}
              </button>
              
              <button onClick={() => setIsNewEntryModalOpen(true)} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[11px] uppercase shadow-lg active:scale-95">Manual Assign</button>
            </>
          )}
        </div>
      </div>

      {/* DYNAMIC PROXY UTILIZATION PULSE WIDGET */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Teacher Proxy Counts</h3>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Free Period Priority</span>
             </div>
             <span className="text-[8px] font-bold text-slate-300 uppercase italic">Sorted by availability</span>
          </div>
        </div>
        
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
          {workloadUsers.map(u => {
            const metrics = teacherLoadMap.get(u.id);
            if (!metrics) return null;
            const isSurplus = surplusAssets.has(u.id);
            
            return (
              <div key={u.id} className={`flex-shrink-0 w-48 p-6 rounded-[2rem] border-2 transition-all group hover:scale-105 ${isSurplus ? 'bg-amber-50/30 border-amber-200' : 'bg-slate-50/50 border-slate-100 dark:border-slate-800 shadow-sm'}`}>
                <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase truncate mb-3 italic tracking-tight">{u.name.split(' ')[0]}</p>
                <div className="flex items-baseline gap-1 mb-4">
                   <span className={`text-2xl font-black italic ${metrics.isCapReached ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>{metrics.proxyLoad}</span>
                   <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">/ {metrics.proxyCap} LIMIT</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3 shadow-inner">
                   <div 
                     style={{ width: `${Math.min(100, (metrics.proxyLoad / metrics.proxyCap) * 100)}%` }}
                     className={`h-full transition-all duration-700 ${metrics.isCapReached ? 'bg-rose-500' : 'bg-[#001f3f] dark:bg-amber-400'}`}
                   ></div>
                </div>
                <div className="flex justify-between items-center">
                   <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Weekly Load</span>
                   <span className="text-[9px] font-black text-[#001f3f] dark:text-white italic uppercase">{metrics.total}P</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Monitor for Batch Operations */}
      {batchProgress && (
        <div className="mx-2 bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-xl border-2 border-emerald-400/20 animate-in slide-in-from-top-4">
           <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest">Assigning proxy classes...</span>
              <span className="text-xs font-black text-emerald-600">{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
           </div>
           <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                className="h-full bg-emerald-500 transition-all duration-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
              ></div>
           </div>
           <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.4em] mt-3 text-center italic">Processing {batchProgress.current} of {batchProgress.total}</p>
        </div>
      )}

      {/* Gaps Section */}
      {isManagement && hasScanned && detectedGaps.length > 0 && (
        <div className="mx-2 space-y-6 animate-in slide-in-from-bottom-4">
           <div className="flex items-center gap-4 px-4">
              <h2 className="text-lg font-black text-rose-500 uppercase italic tracking-widest">Classes Needing a Proxy</h2>
              <div className="flex-1 h-[2px] bg-rose-100 dark:bg-rose-900/20"></div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {detectedGaps.map(gap => (
                <div key={gap.id} className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border-2 border-slate-50 dark:border-slate-800 relative group overflow-hidden">
                   <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-20 transition-opacity">
                      <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                   </div>
                   <div className="flex justify-between items-start mb-4">
                      <div>
                         <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Period {gap.slotId}</p>
                         <h4 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{gap.className}</h4>
                      </div>
                      <span className="px-3 py-1 bg-slate-50 dark:bg-slate-800 rounded-lg text-[8px] font-black text-slate-400 uppercase">{gap.subject}</span>
                   </div>
                   <p className="text-[9px] font-bold text-slate-400 uppercase">Teacher Absent: <span className="text-rose-400 italic">{gap.absentTeacherName}</span></p>
                   
                   <div className="mt-6 pt-4 border-t border-slate-50 dark:border-slate-800 space-y-4">
                      <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Recommended Teacher:</p>
                      {gap.suggestedReplacementId ? (
                        <div className="space-y-3">
                           <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-black text-[10px]">{gap.suggestedReplacementName?.substring(0,2)}</div>
                              <div>
                                 <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{gap.suggestedReplacementName}</p>
                                 <p className="text-[7px] font-bold text-slate-400 uppercase italic">Free during this period</p>
                              </div>
                           </div>
                           <button 
                              onClick={() => handleCreateProxy({
                                id: generateUUID(), date: selectedDate, slotId: gap.slotId, wingId: gap.wingId, gradeId: gap.gradeId,
                                sectionId: gap.sectionId, className: gap.className, subject: gap.subject,
                                absentTeacherId: gap.absentTeacherId, absentTeacherName: gap.absentTeacherName,
                                substituteTeacherId: gap.suggestedReplacementId!, substituteTeacherName: gap.suggestedReplacementName!,
                                section: gap.section, isArchived: false
                              })}
                              className="w-full py-3 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-md"
                           >
                              Assign Teacher
                           </button>
                        </div>
                      ) : (
                        <p className="text-[9px] font-bold text-slate-300 italic uppercase">Searching for a free teacher...</p>
                      )}
                   </div>
                </div>
              ))}
           </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/30 border-y border-slate-100 dark:border-slate-800">
                <th className="px-10 py-6">Date & Period</th>
                <th className="px-10 py-6">Proxy Assignment</th>
                <th className="px-10 py-6 text-right">Actions</th>
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
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8">
                     <div className="flex items-center gap-6">
                        <div className="space-y-1">
                           <span className="text-[7px] font-black text-slate-400 uppercase block">OUT</span>
                           <span className="text-11px font-black text-rose-500 uppercase italic tracking-tight">{p.absentTeacherName}</span>
                        </div>
                        <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-full"><svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></div>
                        <div className="space-y-1 text-right">
                           <span className="text-[7px] font-black text-slate-400 uppercase block">IN</span>
                           <span className="text-11px font-black text-emerald-600 uppercase italic tracking-tight">{p.substituteTeacherName}</span>
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8 text-right">
                    <div className="flex justify-end gap-2">
                       <button 
                          onClick={() => handleFetchLinkedPlan(p.absentTeacherId, p.date, p.sectionId)}
                          disabled={isFetchingPlan}
                          className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[8px] font-black uppercase rounded-lg border border-indigo-100 dark:border-indigo-800 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                       >
                          {isFetchingPlan ? 'Syncing...' : 'View Lesson Plan'}
                       </button>
                       {isManagement && !p.isArchived && (
                        <button onClick={() => handleResendAlert(p)} className="p-3 text-sky-400 hover:text-sky-600 bg-sky-50 dark:bg-sky-900/20 rounded-xl transition-all" title="Resend Telegram Notification">
                           <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                        </button>
                       )}
                      {isManagement && (
                        <button onClick={() => handleDeleteProxy(p.id)} className="p-3 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-slate-800 rounded-xl transition-all">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={3} className="py-24 text-center text-slate-300 font-black uppercase text-[10px] tracking-widest">No proxy classes found for today</td></tr>
              )}
            </tbody>
          </table>
      </div>

      {linkedPlan && (
        <div className="fixed inset-0 z-[1200] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-y-auto max-h-[90vh] relative">
              <button onClick={() => setLinkedPlan(null)} className="absolute top-8 right-8 p-3 text-slate-400 hover:text-rose-500 transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
              
              <div className="flex flex-col items-center text-center border-b dark:border-slate-800 pb-8">
                 <div className="w-20 h-20 mb-6"><img src={SCHOOL_LOGO_BASE64} className="w-full h-full object-contain" /></div>
                 <h3 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{linkedPlan.plan_data.title}</h3>
                 <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.4em] mt-2">Lesson details for this class</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700">
                    <h4 className="text-[10px] font-black text-[#001f3f] dark:text-amber-400 uppercase tracking-widest mb-4">Lesson Objectives</h4>
                    <ul className="space-y-3">
                       {linkedPlan.plan_data.objectives.map((o, i) => <li key={i} className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-start gap-3"><span>»</span>{o}</li>)}
                    </ul>
                 </div>
                 <div className="bg-emerald-50 dark:bg-emerald-950/20 p-6 rounded-3xl border border-emerald-100 dark:border-emerald-900">
                    <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4">Support for Students</h4>
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300 italic">{linkedPlan.plan_data.differentiation?.sen}</p>
                 </div>
              </div>

              <div className="space-y-6">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Class Steps</h4>
                 <div className="space-y-4">
                    {linkedPlan.plan_data.procedure.map((p, i) => (
                       <div key={i} className="p-6 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-slate-800 rounded-2xl flex gap-6">
                          <span className="text-xl font-black text-amber-500 italic">0{i+1}</span>
                          <div>
                             <h5 className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{p.step} ({p.duration})</h5>
                             <p className="text-xs text-slate-500 mt-1">{p.description}</p>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>

              <div className="pt-8 flex justify-center">
                 <button onClick={() => setLinkedPlan(null)} className="px-12 py-5 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl">Close View</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SubstitutionView;
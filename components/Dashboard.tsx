
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig, TimeSlot, TimeTableEntry } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { NotificationService } from '../services/notificationService.ts';
import { SyncService } from '../services/syncService.ts';
import { HapticService } from '../services/hapticService.ts';
import { GoogleGenAI } from "@google/genai";

interface DashboardProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  substitutions?: SubstitutionRecord[];
  currentOTP: string;
  setOTP: (otp: string) => void;
  notifications: SchoolNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  config: SchoolConfig;
  timetable?: TimeTableEntry[];
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications, showToast, config, timetable = [], isSandbox, addSandboxLog }) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [dailyQuote, setDailyQuote] = useState<{ text: string; author: string } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const lastBriefingKey = useRef<string>("");

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  // Clock Formats
  const liveTimeStr = useMemo(() => currentTime.toLocaleTimeString('en-US', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }), [currentTime]);
  const liveDateStr = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bahrain', weekday: 'long', month: 'long', day: 'numeric' }).format(currentTime), [currentTime]);

  const userProxiesThisWeek = useMemo(() => {
    const d = new Date();
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const thu = new Date(sun); thu.setDate(sun.getDate() + 4);
    const s = sun.toISOString().split('T')[0];
    const t = thu.toISOString().split('T')[0];
    return substitutions.filter(sub => sub.substituteTeacherId === user.id && sub.date >= s && sub.date <= t && !sub.isArchived);
  }, [substitutions, user.id]);

  const workloadMetrics = useMemo(() => {
    const policy = config.loadPolicies?.[user.role] || { baseTarget: 28, substitutionCap: 5 };
    const basePeriods = timetable.filter(t => t.teacherId === user.id && !t.date).length;
    const proxyCount = userProxiesThisWeek.length;

    return {
      base: basePeriods,
      baseTarget: policy.baseTarget,
      proxy: proxyCount,
      proxyCap: policy.substitutionCap,
      baseOver: basePeriods > policy.baseTarget,
      proxyOver: proxyCount >= policy.substitutionCap
    };
  }, [config.loadPolicies, user.role, timetable, user.id, userProxiesThisWeek]);

  const temporalDutyStatus = useMemo(() => {
    const teacherSect = config.sections.find(s => s.id === user.classTeacherOf);
    const activeWing = config.wings.find(w => w.id === (teacherSect?.wingId || config.wings[0]?.id));
    const slots = config.slotDefinitions?.[activeWing?.sectionType || 'PRIMARY'] || [];
    
    const nowTime = currentTime.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit' });

    const currentSlot = slots.find(s => nowTime >= s.startTime && nowTime <= s.endTime);
    const nextSlot = slots.filter(s => s.startTime > nowTime).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

    const getDutyAtSlot = (slotId?: number) => {
      if (!slotId) return null;
      const sub = substitutions.find(s => s.date === today && s.slotId === slotId && s.substituteTeacherId === user.id && !s.isArchived);
      if (sub) return { type: 'PROXY', subject: sub.subject, className: sub.className };
      const regular = timetable.find(t => t.day === todayDayName && t.slotId === slotId && t.teacherId === user.id && !t.date);
      if (regular) return { type: 'REGULAR', subject: regular.subject, className: regular.className };
      return null;
    };

    return {
      current: { slot: currentSlot, duty: getDutyAtSlot(currentSlot?.id) },
      next: { slot: nextSlot, duty: getDutyAtSlot(nextSlot?.id) }
    };
  }, [config, user, timetable, substitutions, today, todayDayName, currentTime]);

  const geoCenter = { lat: config?.latitude ?? TARGET_LAT, lng: config?.longitude ?? TARGET_LNG, radius: config?.radiusMeters ?? RADIUS_METERS };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000); 
    return () => clearInterval(timer);
  }, []);

  const fetchDailyQuote = useCallback(async () => {
    const cachedQuote = localStorage.getItem('ihis_daily_quote');
    const cachedDate = localStorage.getItem('ihis_quote_date');
    if (cachedQuote && cachedDate === today) {
      try { setDailyQuote(JSON.parse(cachedQuote)); return; } catch (e) { console.warn("Failed to parse cached quote"); }
    }
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Provide one unique, short, powerful teaching quote. JSON: { \"text\": \"...\", \"author\": \"...\" }",
        config: { responseMimeType: "application/json" }
      });
      const quoteData = JSON.parse(response.text);
      setDailyQuote(quoteData);
      localStorage.setItem('ihis_daily_quote', JSON.stringify(quoteData));
      localStorage.setItem('ihis_quote_date', today);
    } catch (err) { setDailyQuote({ text: "Teaching is the greatest act of optimism.", author: "Colleen Wilcox" }); }
  }, [today]);

  const fetchBriefing = useCallback(async (force: boolean = false) => {
    const briefingKey = `${user.id}-${today}-${workloadMetrics.proxy}-${todayRecord ? 'checked' : 'pending'}`;
    if (!force && aiBriefing && briefingKey === lastBriefingKey.current) return;
    if (isBriefingLoading) return;
    setIsBriefingLoading(true); lastBriefingKey.current = briefingKey;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Assistant for ${SCHOOL_NAME}. Teacher: ${user.name}. Status: ${todayRecord ? 'Clocked In' : 'Pending'}. Metrics: ${workloadMetrics.base}/${workloadMetrics.baseTarget} Base, ${workloadMetrics.proxy}/${workloadMetrics.proxyCap} Proxy. Generate encouraging 30-word brief.`;
      const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
      setAiBriefing(response.text || "Portal synchronized. Schedule active.");
    } catch (err) { setAiBriefing(`Matrix verified for ${user.name.split(' ')[0]}. Geotag linked.`); } finally { setIsBriefingLoading(false); }
  }, [user.id, user.name, today, todayRecord, workloadMetrics, aiBriefing, isBriefingLoading]);

  useEffect(() => { fetchBriefing(); fetchDailyQuote(); }, [fetchBriefing, fetchDailyQuote]);

  const refreshGeolocation = useCallback(async () => {
    setIsRefreshingGps(true);
    try {
      const pos = await getCurrentPosition();
      setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (err) { console.warn("Geolocation Failed"); } finally { setIsRefreshingGps(false); }
  }, []);

  useEffect(() => { refreshGeolocation(); const interval = setInterval(refreshGeolocation, 30000); return () => clearInterval(interval); }, [refreshGeolocation]);

  const currentDistance = useMemo(() => userCoords ? calculateDistance(userCoords.lat, userCoords.lng, geoCenter.lat, geoCenter.lng) : null, [userCoords, geoCenter]);
  
  // SECURITY OPTIMIZATION: Accuracy Capped at 15m to prevent "GPS cheaters" with poor signals.
  const isOutOfRange = useMemo(() => {
    if (currentDistance === null || !userCoords) return true;
    const effectiveAccuracy = Math.min(userCoords.accuracy, 15);
    return (currentDistance - effectiveAccuracy) > geoCenter.radius;
  }, [currentDistance, userCoords, geoCenter.radius]);

  const handleAction = async (isManual: boolean = false, isMedical: boolean = false) => {
    if ((isManual || isMedical)) { if (otpInput.trim() !== String(currentOTP || "").trim()) { showToast("Invalid Security Key", "error"); return; } }
    setLoading(true);
    HapticService.light();
    
    try {
      let location = undefined;
      if (!isManual && !isMedical) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, geoCenter.lat, geoCenter.lng);
        const effectiveAccuracy = Math.min(pos.coords.accuracy || 0, 15);
        if (dist - effectiveAccuracy > geoCenter.radius) throw new Error("Gateway Proximity Mismatch.");
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      const bahrainNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
      const timeString = isMedical ? 'MEDICAL' : bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      
      if (!todayRecord) {
        const isLate = !isMedical && (bahrainNow.getHours() > LATE_THRESHOLD_HOUR || (bahrainNow.getHours() === LATE_THRESHOLD_HOUR && bahrainNow.getMinutes() > LATE_THRESHOLD_MINUTE));
        const payload = { user_id: user.id, date: today, check_in: timeString, is_manual: isManual || isMedical, is_late: isLate, location: location || null, reason: isMedical ? 'Medical Leave' : (isManual ? 'Manual Override' : 'Standard Check-In') };
        
        let dbId = `loc-${Date.now()}`;
        if (IS_CLOUD_ENABLED && !isSandbox) {
          try {
            const { data, error } = await supabase.from('attendance').insert(payload).select().single();
            if (error) throw error;
            dbId = data.id;
          } catch (syncErr) {
            console.warn("Background Sync Hook: Saving to local queue.");
            SyncService.addToQueue('CHECK_IN', payload, user.name);
            showToast("Matrix Unstable: Saved to Offline Queue", "warning");
          }
        } else if (isSandbox) {
          addSandboxLog?.('ATTENDANCE_REGISTRY_IN', payload);
        }
        
        setAttendance(prev => [{ id: dbId, userId: user.id, userName: user.name, date: today, checkIn: timeString, checkOut: isMedical ? 'ABSENT' : undefined, isManual: isManual || isMedical, isLate, location, reason: payload.reason }, ...prev]);
        showToast(isMedical ? "Medical Record Logged" : "Registry Successful", "success");
        HapticService.success();
      } else {
        const timeOut = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        const payload = { user_id: user.id, date: today, check_out: timeOut };
        
        if (IS_CLOUD_ENABLED && !isSandbox) {
          try {
            const { error } = await supabase.from('attendance').update({ check_out: timeOut }).match({ user_id: user.id, date: today });
            if (error) throw error;
          } catch (syncErr) {
            console.warn("Background Sync Hook: Saving checkout to local queue.");
            SyncService.addToQueue('CHECK_OUT', payload, user.name);
            showToast("Departure Registered Offline", "warning");
          }
        } else if (isSandbox) {
          addSandboxLog?.('ATTENDANCE_REGISTRY_OUT', payload);
        }

        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: timeOut } : r));
        showToast("Departure Registered", "success");
        HapticService.success();
      }
      setIsManualModalOpen(false); setPendingAction(null); setOtpInput('');
    } catch (err: any) { 
      showToast(err.message || "Gateway Failure", "error"); 
      HapticService.error();
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32">
      {/* Header Dashboard Grid: AI Briefing & Live Clock */}
      <div className="mx-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Briefing Card */}
        <div className="lg:col-span-2 bg-gradient-to-br from-[#001f3f] to-[#003366] rounded-[3rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
          <div className="relative z-10 flex items-start gap-6">
            <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10"><svg className={`w-6 h-6 ${isBriefingLoading ? 'animate-spin text-amber-400' : 'text-[#d4af37]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
            <div className="space-y-2 flex-1">
              <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">Institutional Pulse</h3>
              {isBriefingLoading ? <div className="space-y-2 py-2"><div className="h-3 w-48 bg-white/5 animate-pulse rounded-full"></div></div> : <p className="text-sm text-white/90 font-medium italic">{aiBriefing}</p>}
            </div>
          </div>
        </div>

        {/* Temporal Sentinel (Live Clock Widget) */}
        <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-[#d4af37]/20 flex flex-col items-center justify-center text-center group">
          <p className="text-[9px] font-black text-amber-500 uppercase tracking-var(--widest) mb-1">Local Matrix Time</p>
          <div className="text-3xl font-black text-white italic tracking-tighter tabular-nums flex items-baseline gap-1">
            {liveTimeStr}
          </div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">{liveDateStr}</p>
        </div>
      </div>

      {/* Duty Awareness Sentinel (Ongoing & Next Duty Widgets) */}
      <div className="mx-4 grid grid-cols-1 md:grid-cols-2 gap-6">
         {/* Ongoing Duty Widget */}
         <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-6 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
               <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${temporalDutyStatus.current.duty ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ongoing Duty</p>
               </div>
               {temporalDutyStatus.current.slot && (
                 <span className="text-[9px] font-black text-amber-500 uppercase">{temporalDutyStatus.current.slot.label}</span>
               )}
            </div>

            <div className="relative z-10">
               {temporalDutyStatus.current.duty ? (
                 <div className="space-y-2">
                    <div className="flex items-center gap-3">
                       <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{temporalDutyStatus.current.duty.subject}</h4>
                       <span className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase ${temporalDutyStatus.current.duty.type === 'PROXY' ? 'bg-amber-100 text-amber-600 border border-amber-200' : 'bg-sky-50 text-sky-600 border border-sky-100'}`}>
                          {temporalDutyStatus.current.duty.type}
                       </span>
                    </div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                       {temporalDutyStatus.current.duty.className}
                    </p>
                 </div>
               ) : (
                 <div className="py-2">
                    <p className="text-xl font-black text-slate-200 dark:text-slate-800 uppercase italic tracking-tighter">No Active Duty</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-1 tracking-widest italic opacity-50">Portal Syncing...</p>
                 </div>
               )}
            </div>
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform"><svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.35 14.85L11 13V7h1.5v5.25l4.15 2.5-.8 1.1z"/></svg></div>
         </div>

         {/* Upcoming Duty Widget */}
         <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-6 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Upcoming Transition</p>
               {temporalDutyStatus.next.slot && (
                 <span className="text-[9px] font-black text-sky-500 uppercase">{temporalDutyStatus.next.slot.label}</span>
               )}
            </div>

            <div className="relative z-10">
               {temporalDutyStatus.next.duty ? (
                 <div className="space-y-2">
                    <p className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tight">{temporalDutyStatus.next.duty.subject}</p>
                    <div className="flex items-center justify-between">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{temporalDutyStatus.next.duty.className}</p>
                       <p className="text-[10px] font-black text-sky-600 uppercase italic">Starts {temporalDutyStatus.next.slot?.startTime}</p>
                    </div>
                 </div>
               ) : (
                 <div className="py-2">
                    <p className="text-lg font-black text-slate-200 dark:text-slate-800 uppercase italic">Clear Trajectory</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-1 tracking-widest opacity-50">Monitoring Temporal Shifts</p>
                 </div>
               )}
            </div>
         </div>
      </div>

      {/* Dynamic Workload Policy Insight */}
      <div className="mx-4 grid grid-cols-1 md:grid-cols-2 gap-6">
         <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instructional Load</p>
               <span className={`text-[10px] font-black uppercase ${workloadMetrics.baseOver ? 'text-rose-500' : 'text-emerald-500'}`}>{workloadMetrics.baseOver ? 'Overload' : 'Optimal'}</span>
            </div>
            <div className="flex items-baseline gap-2">
               <span className="text-4xl font-black italic text-[#001f3f] dark:text-white tracking-tighter">{workloadMetrics.base}</span>
               <span className="text-xs font-bold text-slate-400 uppercase">/ {workloadMetrics.baseTarget} Periods</span>
            </div>
            <div className="h-1.5 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden">
               <div style={{ width: `${Math.min(100, (workloadMetrics.base / (workloadMetrics.baseTarget || 1)) * 100)}%` }} className={`h-full transition-all duration-1000 ${workloadMetrics.baseOver ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Proxy Duty Pulse</p>
               <span className={`text-[10px] font-black uppercase ${workloadMetrics.proxyOver ? 'text-rose-500' : 'text-sky-500'}`}>{workloadMetrics.proxyOver ? 'Capacity Reached' : 'Available'}</span>
            </div>
            <div className="flex items-baseline gap-2">
               <span className="text-4xl font-black italic text-[#001f3f] dark:text-white tracking-tighter">{workloadMetrics.proxy}</span>
               <span className="text-xs font-bold text-slate-400 uppercase">/ {workloadMetrics.proxyCap} Proxies</span>
            </div>
            <div className="h-1.5 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden">
               <div style={{ width: `${Math.min(100, (workloadMetrics.proxy / (workloadMetrics.proxyCap || 1)) * 100)}%` }} className={`h-full transition-all duration-1000 ${workloadMetrics.proxyOver ? 'bg-rose-500' : 'bg-sky-500'}`}></div>
            </div>
         </div>
      </div>

      {/* Administrative Actions Grid */}
      {isManagement && (
        <div className="mx-4 grid grid-cols-2 gap-4">
           <button onClick={() => { HapticService.light(); setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl flex flex-col items-center gap-2 group hover:border-amber-400 transition-all">
              <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manual Override</span>
           </button>
           <button onClick={() => { HapticService.light(); setPendingAction('MEDICAL'); setIsManualModalOpen(true); }} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl flex flex-col items-center gap-2 group hover:border-rose-400 transition-all">
              <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg></div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Medical Lock</span>
           </button>
        </div>
      )}

      {/* Geolocation Verification Area - Optimized with Capped Buffer and Visual Ring */}
      <div className="bg-[#001f3f] mx-4 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden">
         <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-amber-400 opacity-[0.03] rounded-full"></div>
         <div className="relative z-10 space-y-8">
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${isRefreshingGps ? 'bg-amber-400 animate-pulse' : isOutOfRange ? 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]' : 'bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]'}`}></div>
                  <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.4em]">Campus Verification</h3>
               </div>
               {isOutOfRange && !isRefreshingGps && (
                 <span className="px-3 py-1 bg-rose-500/20 text-rose-400 text-[8px] font-black uppercase rounded-lg border border-rose-500/30 animate-bounce">Registry Locked</span>
               )}
            </div>
            
            <div className="flex flex-col items-center justify-center py-6">
               <div className={`relative w-40 h-40 rounded-full border-4 flex flex-col items-center justify-center transition-all duration-700 ${isOutOfRange ? 'border-rose-500/20 bg-rose-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                  {/* Visual Ring Indicator */}
                  <div className={`absolute inset-0 rounded-full border-2 animate-[ping_3s_infinite] ${isOutOfRange ? 'border-rose-500/40' : 'border-emerald-500/40'}`}></div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Center Offset</p>
                  <p className={`text-4xl font-black italic tabular-nums ${isOutOfRange ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {currentDistance !== null ? Math.round(currentDistance) : '--'}m
                  </p>
                  <div className="mt-2 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md">
                     <p className={`text-[7px] font-black uppercase tracking-widest ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {isOutOfRange ? 'Out of Range' : 'Authorized Zone'}
                     </p>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">GPS Accuracy</p>
                  <p className="text-sm font-black text-white italic">{userCoords?.accuracy ? Math.round(userCoords.accuracy) : '--'}m</p>
               </div>
               <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Capped Buffer</p>
                  <p className="text-sm font-black text-amber-400 italic">15m Max</p>
               </div>
            </div>

            <button 
               disabled={loading || isOutOfRange || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'} 
               onClick={() => handleAction()} 
               className={`w-full py-6 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all relative overflow-hidden group ${
                 isOutOfRange ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5' : 
                 todayRecord ? 'bg-amber-500 text-[#001f3f]' : 'bg-[#d4af37] text-[#001f3f]'
               }`}
            >
               <div className="relative z-10 flex items-center justify-center gap-3">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      <span>Synchronizing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      <span>{todayRecord ? 'Registry Out (Strict)' : 'Registry In (Strict)'}</span>
                    </>
                  )}
               </div>
               {!isOutOfRange && !loading && (
                 <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
               )}
            </button>
            
            {isOutOfRange && !todayRecord && (
              <p className="text-[9px] text-center font-bold text-rose-500/70 uppercase italic tracking-widest px-4">
                Institutional protocol requires physical campus proximity for registry authorization. 
              </p>
            )}
            {isOutOfRange && todayRecord && !todayRecord.checkOut && (
              <p className="text-[9px] text-center font-bold text-rose-500/70 uppercase italic tracking-widest px-4">
                Strict Logout Active: You must return to campus boundary to sign out.
              </p>
            )}
         </div>
      </div>

      {/* Daily Inspirational Ledger */}
      <div className="bg-white dark:bg-slate-900 mx-4 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform"><svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21L14.017 18C14.017 16.8954 14.9124 16 16.017 16H19.017C19.5693 16 20.017 15.5523 20.017 15V9C20.017 8.44772 19.5693 8 19.017 8H16.017C14.9124 8 14.017 7.10457 14.017 6V3L14.017 3C14.017 2.44772 14.4647 2 15.017 2H21.017C21.5693 2 22.017 2.44772 22.017 3V15C22.017 18.3137 19.3307 21 16.017 21H14.017ZM3.017 21L3.017 18C3.017 16.8954 3.91243 16 5.017 16H8.017C8.56928 16 9.017 15.5523 9.017 15V9C9.017 8.44772 8.56928 8 8.017 8H5.017C3.91243 8 3.017 7.10457 3.017 6V3L3.017 3C3.017 2.44772 3.46472 2 4.017 2H10.017C10.5693 2 11.017 2.44772 11.017 3V15C11.017 18.3137 8.33072 21 5.017 21H3.017Z"/></svg></div>
        <div className="relative z-10 space-y-4">
          <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Daily Inspiration</p>
          {dailyQuote ? (
            <div className="space-y-2">
              <p className="text-base font-bold text-[#001f3f] dark:text-white leading-relaxed italic">"{dailyQuote.text}"</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">— {dailyQuote.author}</p>
            </div>
          ) : (
            <div className="space-y-2 animate-pulse"><div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-full w-full"></div><div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full w-24"></div></div>
          )}
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{pendingAction === 'MEDICAL' ? 'Medical Lock' : 'Override Hook'}</h4></div>
             <input type="text" placeholder="Access Key" maxLength={10} value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-8 py-5 text-center text-3xl font-black dark:text-white outline-none" />
             <button onClick={() => handleAction(pendingAction === 'OVERRIDE', pendingAction === 'MEDICAL')} disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase shadow-xl">Confirm Registry</button>
             <button onClick={() => { HapticService.light(); setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Discard</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

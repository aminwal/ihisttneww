
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig, TimeSlot, TimeTableEntry, SectionType } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS, PRIMARY_SLOTS } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { SyncService } from '../services/syncService.ts';
import { HapticService } from '../services/hapticService.ts';
import { GoogleGenAI } from "@google/genai";

// Removed local declare global for window.aistudio to resolve identical modifiers conflict with environment-provided AIStudio type

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

const Dashboard: React.FC<DashboardProps> = ({ 
  user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, 
  notifications, setNotifications, showToast, config, timetable = [], isSandbox, addSandboxLog 
}) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | 'MANUAL_OUT' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [dailyQuote, setDailyQuote] = useState<{ text: string; author: string } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const lastBriefingKey = useRef<string>("");

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  // Clock Formats
  const liveTimeStr = useMemo(() => currentTime.toLocaleTimeString('en-US', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit', hour12: true }), [currentTime]);
  const liveDateStr = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bahrain', weekday: 'long', month: 'long', day: 'numeric' }).format(currentTime), [currentTime]);

  const geoCenter = { 
    lat: config?.latitude ?? TARGET_LAT, 
    lng: config?.longitude ?? TARGET_LNG, 
    radius: config?.radiusMeters ?? RADIUS_METERS 
  };

  const myLoadMetrics = useMemo(() => {
    const policy = config.loadPolicies?.[user.role] || { baseTarget: 28, substitutionCap: 5 };
    const individualScheduled = timetable.filter(t => t.teacherId === user.id && !t.isSubstitution && !t.date && !t.blockId).length;
    const poolCommitment = (config.combinedBlocks || []).filter(b => b.allocations.some(a => a.teacherId === user.id)).reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);
    const total = individualScheduled + poolCommitment;
    return { total, target: policy.baseTarget, percent: Math.min(100, (total / policy.baseTarget) * 100) };
  }, [config, timetable, user.id, user.role]);

  const myScheduleToday = useMemo(() => {
    return timetable
      .filter(t => t.teacherId === user.id && t.day === todayDayName && !t.date)
      .sort((a, b) => a.slotId - b.slotId);
  }, [timetable, user.id, todayDayName]);

  const myProxiesToday = useMemo(() => {
    return substitutions.filter(s => s.substituteTeacherId === user.id && s.date === today && !s.isArchived);
  }, [substitutions, user.id, today]);

  const globalStats = useMemo(() => {
    const presentCount = attendance.filter(r => r.date === today && r.checkIn !== 'MEDICAL').length;
    const activeProxies = substitutions.filter(s => s.date === today && !s.isArchived).length;
    return { presentCount, activeProxies };
  }, [attendance, substitutions, today]);

  const activeSessionData = useMemo(() => {
    const nowStr = currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Bahrain' }).substring(0, 5);
    const roleKey = user.role as string;
    const wingType: SectionType = roleKey.includes('PRIMARY') ? 'PRIMARY' : 
                                 roleKey.includes('SENIOR') ? 'SENIOR_SECONDARY_BOYS' : 'SECONDARY_BOYS';
    const slots = config.slotDefinitions?.[wingType] || PRIMARY_SLOTS;

    const currentSlot = slots.find(s => nowStr >= s.startTime && nowStr <= s.endTime);
    let nextSlot = null;
    if (currentSlot) {
      nextSlot = slots.find(s => s.startTime > currentSlot.endTime);
    } else {
      nextSlot = slots.find(s => s.startTime > nowStr);
    }

    const findEntry = (sid: number) => {
      const reg = myScheduleToday.find(t => t.slotId === sid);
      if (reg) return { subject: reg.subject, className: reg.className, room: reg.room };
      const prox = myProxiesToday.find(p => p.slotId === sid);
      if (prox) return { subject: `${prox.subject} (Proxy)`, className: prox.className, room: 'Refer Timetable' };
      return null;
    };

    return {
      current: currentSlot ? { slot: currentSlot, entry: findEntry(currentSlot.id) } : null,
      upcoming: nextSlot ? { slot: nextSlot, entry: findEntry(nextSlot.id) } : null
    };
  }, [currentTime, myScheduleToday, myProxiesToday, config.slotDefinitions, user.role]);

  const matrixDutyStatus = useMemo(() => {
    const allDuty = [...myScheduleToday, ...myProxiesToday];
    const total = allDuty.length;
    const nowStr = currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Bahrain' }).substring(0, 5);
    
    const roleKey = user.role as string;
    const wingType: SectionType = roleKey.includes('PRIMARY') ? 'PRIMARY' : 
                                 roleKey.includes('SENIOR') ? 'SENIOR_SECONDARY_BOYS' : 'SECONDARY_BOYS';
    const slots = config.slotDefinitions?.[wingType] || PRIMARY_SLOTS;

    const completed = allDuty.filter(e => {
        const slot = slots.find(s => s.id === e.slotId);
        return slot && nowStr > slot.endTime;
    }).length;

    const isCurrentActive = !!activeSessionData.current?.entry;
    const isDayFinished = completed === total && total > 0 && !isCurrentActive;

    return { total, completed, isCurrentActive, isDayFinished };
  }, [myScheduleToday, myProxiesToday, currentTime, config.slotDefinitions, user.role, activeSessionData.current]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000); 
    return () => clearInterval(timer);
  }, []);

  const checkApiKeyPresence = async () => {
    const key = process.env.API_KEY;
    if (!key || key === 'undefined' || key === '') {
      const hasSelected = await window.aistudio.hasSelectedApiKey();
      setHasKey(hasSelected);
      return hasSelected;
    }
    setHasKey(true);
    return true;
  };

  const handleLinkKey = async () => {
    HapticService.light();
    await window.aistudio.openSelectKey();
    setHasKey(true);
    fetchBriefing(true);
    fetchDailyQuote();
  };

  const fetchDailyQuote = useCallback(async () => {
    const isReady = await checkApiKeyPresence();
    if (!isReady) return;

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
    const isReady = await checkApiKeyPresence();
    if (!isReady) {
      setAiBriefing("Matrix Link Required for Daily Intelligence.");
      return;
    }

    const briefingKey = `${user.id}-${today}-${todayRecord ? 'checked' : 'pending'}`;
    if (!force && aiBriefing && briefingKey === lastBriefingKey.current) return;
    if (isBriefingLoading) return;
    setIsBriefingLoading(true); lastBriefingKey.current = briefingKey;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Assistant for ${SCHOOL_NAME}. Teacher: ${user.name}. Status: ${todayRecord ? 'Clocked In' : 'Pending'}. Generate a professional greeting in 25 words.`;
      const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
      setAiBriefing(response.text || "Portal synced. Welcome back!");
    } catch (err) { setAiBriefing(`Welcome, ${user.name.split(' ')[0]}. Location verified.`); } finally { setIsBriefingLoading(false); }
  }, [user.id, user.name, today, todayRecord, isBriefingLoading]);

  useEffect(() => { 
    fetchBriefing(); 
    fetchDailyQuote(); 
  }, [fetchBriefing, fetchDailyQuote]);

  const refreshGeolocation = useCallback(async () => {
    setIsRefreshingGps(true);
    try {
      const pos = await getCurrentPosition();
      setUserCoords({ 
        lat: pos.coords.latitude, 
        lng: pos.coords.longitude, 
        accuracy: pos.coords.accuracy 
      });
    } catch (err) { 
      console.warn("Geolocation Failed"); 
    } finally { 
      setIsRefreshingGps(false); 
    }
  }, []);

  useEffect(() => { 
    refreshGeolocation(); 
    const interval = setInterval(refreshGeolocation, 30000); 
    return () => clearInterval(interval); 
  }, [refreshGeolocation]);

  const currentDistance = useMemo(() => 
    userCoords ? calculateDistance(userCoords.lat, userCoords.lng, geoCenter.lat, geoCenter.lng) : null
  , [userCoords, geoCenter]);
  
  const isOutOfRange = useMemo(() => {
    if (currentDistance === null || !userCoords) return true;
    const effectiveAccuracy = Math.min(userCoords.accuracy, 15);
    return (currentDistance - effectiveAccuracy) > geoCenter.radius;
  }, [currentDistance, userCoords, geoCenter.radius]);

  const handleAction = async (isManual: boolean = false, isMedical: boolean = false) => {
    if ((isManual || isMedical)) { 
      if (otpInput.trim() !== String(currentOTP || "").trim()) { 
        showToast("Invalid Security PIN", "error"); 
        return; 
      } 
    }
    setLoading(true);
    HapticService.light();
    
    try {
      let location = undefined;
      if (!isManual && !isMedical) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, geoCenter.lat, geoCenter.lng);
        const effectiveAccuracy = Math.min(pos.coords.accuracy || 0, 15);
        if (dist - effectiveAccuracy > geoCenter.radius) throw new Error("Please move closer to the school building.");
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      
      const bahrainNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
      const timeString = isMedical ? 'MEDICAL' : bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      
      if (!todayRecord) {
        const isLate = !isMedical && (bahrainNow.getHours() > LATE_THRESHOLD_HOUR || (bahrainNow.getHours() === LATE_THRESHOLD_HOUR && bahrainNow.getMinutes() > LATE_THRESHOLD_MINUTE));
        const payload = { 
          user_id: user.id, 
          date: today, 
          check_in: timeString, 
          is_manual: isManual || isMedical, 
          is_late: isLate, 
          location: location || null, 
          reason: isMedical ? 'Medical Leave' : (isManual ? 'Admin Override' : 'Daily Check-In') 
        };
        
        let dbId = `loc-${Date.now()}`;
        if (IS_CLOUD_ENABLED && !isSandbox) {
          const { data, error } = await supabase.from('attendance').insert(payload).select().single();
          if (error) throw error;
          dbId = data.id;
        }
        
        setAttendance(prev => [{ 
          id: dbId, 
          userId: user.id, 
          userName: user.name, 
          date: today, 
          checkIn: timeString, 
          checkOut: isMedical ? 'ABSENT' : undefined, 
          isManual: isManual || isMedical, 
          isLate, 
          location, 
          reason: payload.reason 
        }, ...prev]);
        showToast(isMedical ? "Leave recorded." : "Attendance successfully marked.", "success");
        HapticService.success();
      } else {
        const timeOut = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        const updatedReason = isManual ? (todayRecord.reason + ' + Manual Out') : todayRecord.reason;
        
        if (IS_CLOUD_ENABLED && !isSandbox) {
          const { error } = await supabase.from('attendance')
            .update({ check_out: timeOut, is_manual: todayRecord.isManual || isManual, reason: updatedReason })
            .match({ user_id: user.id, date: today });
          if (error) throw error;
        }

        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: timeOut, isManual: r.isManual || isManual, reason: updatedReason } : r));
        showToast("Departure marked. Have a safe journey!", "success");
        HapticService.success();
      }
      setIsManualModalOpen(false); setPendingAction(null); setOtpInput('');
    } catch (err: any) { 
      showToast(err.message || "Failed to mark attendance.", "error"); 
      HapticService.error();
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32">
      {/* Header Intelligence Banner */}
      <div className="mx-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-gradient-to-br from-[#001f3f] to-[#002b55] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          </div>
          <div className="relative z-10 flex items-start gap-6">
            <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
              <svg className={`w-6 h-6 ${isBriefingLoading ? 'animate-spin text-amber-400' : 'text-[#d4af37]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">Daily Briefing</h3>
                {!hasKey && (
                  <button onClick={handleLinkKey} className="text-[8px] font-black text-[#001f3f] bg-amber-400 px-2 py-1 rounded-lg uppercase tracking-widest animate-pulse">Connect Matrix Link</button>
                )}
              </div>
              <p className="text-sm text-white font-medium italic leading-relaxed">{aiBriefing || 'Checking your schedule...'}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-[#d4af37]/20 flex flex-col items-center justify-center text-center group">
          <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Current Time</p>
          <div className="text-3xl font-black text-white italic tracking-tighter tabular-nums leading-none">{liveTimeStr.split(' ')[0]}<span className="text-xs text-amber-400 ml-1">{liveTimeStr.split(' ')[1]}</span></div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">{liveDateStr}</p>
        </div>
      </div>

      {/* Active Session Sentinel Widget */}
      <div className="mx-4">
        <div className="bg-gradient-to-r from-[#001f3f] via-[#002b55] to-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-amber-400/20 relative overflow-hidden flex flex-col md:flex-row gap-8 items-center justify-between group">
           <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-125 transition-transform duration-1000 pointer-events-none">
             <svg className="w-24 h-24 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
           </div>
           
           <div className="flex-1 w-full space-y-4">
              <div className="flex items-center gap-3">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                 <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.4em]">Current Class</h3>
              </div>
              {activeSessionData.current?.entry ? (
                <div className="animate-in slide-in-from-left duration-700">
                  <p className="text-2xl font-black text-white italic tracking-tighter uppercase leading-none">
                    {activeSessionData.current.entry.subject}
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="px-3 py-1 bg-white/10 text-sky-300 text-[9px] font-black uppercase rounded-lg border border-white/10">{activeSessionData.current.entry.className}</span>
                    <span className="px-3 py-1 bg-amber-400/10 text-amber-400 text-[9px] font-black uppercase rounded-lg border border-amber-400/20">Room: {activeSessionData.current.entry.room}</span>
                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">{activeSessionData.current.slot.startTime} — {activeSessionData.current.slot.endTime}</span>
                  </div>
                </div>
              ) : (
                <div className="opacity-40 italic">
                  <p className="text-lg font-black text-white uppercase tracking-widest">No Active Class Now</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Break or transition time</p>
                </div>
              )}
           </div>

           <div className="hidden md:block w-px h-16 bg-white/10"></div>

           <div className="flex-1 w-full space-y-4">
              <div className="flex items-center gap-3">
                 <div className="w-2 h-2 rounded-full bg-sky-500"></div>
                 <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Upcoming Class</h3>
              </div>
              {activeSessionData.upcoming?.entry ? (
                <div className="animate-in slide-in-from-right duration-700">
                  <p className="text-xl font-black text-white/80 italic tracking-tighter uppercase leading-none">
                    {activeSessionData.upcoming.entry.subject}
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="px-3 py-1 bg-white/5 text-slate-300 text-[9px] font-black uppercase rounded-lg border border-white/5">{activeSessionData.upcoming.entry.className}</span>
                    <span className="px-3 py-1 bg-white/5 text-slate-300 text-[9px] font-black uppercase rounded-lg border border-white/5">{activeSessionData.upcoming.entry.room}</span>
                    <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Starts @ {activeSessionData.upcoming.slot.startTime}</span>
                  </div>
                </div>
              ) : (
                <div className="opacity-30">
                  <p className="text-lg font-black text-white uppercase tracking-widest leading-none">Day Concluded</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">No more classes today</p>
                </div>
              )}
           </div>
        </div>
      </div>

      <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
         <div className="lg:col-span-8 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-10 shadow-2xl relative overflow-hidden border border-slate-100 dark:border-slate-800">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div className="flex flex-col items-center justify-center">
                     <div className="relative w-48 h-48 flex items-center justify-center">
                        <div className="absolute inset-0 rounded-full border border-slate-100 dark:border-slate-800 scale-100"></div>
                        <div className="absolute inset-0 rounded-full border border-slate-100 dark:border-slate-800 scale-[0.66]"></div>
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-400/40 animate-[spin_4s_linear_infinite]"></div>
                        <div className={`absolute inset-3 rounded-full border-4 transition-all duration-1000 ${isOutOfRange ? 'border-rose-500/20' : 'border-emerald-500/20'}`}></div>
                        <div className="relative z-10 flex flex-col items-center">
                           <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Distance</p>
                           <p className={`text-4xl font-black italic tracking-tighter ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>{currentDistance !== null ? Math.round(currentDistance) : '--'}m</p>
                        </div>
                     </div>
                  </div>

                  <div className="space-y-6">
                     <div className="space-y-1">
                        <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-tight">
                          {todayRecord ? (todayRecord.checkOut ? 'Day Finished' : 'At School') : 'Mark Attendance'}
                        </h2>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed italic">{todayRecord ? (todayRecord.checkOut ? 'Your work for today is logged.' : 'Login verified. Please stay at your location.') : 'You must be at school to mark attendance.'}</p>
                     </div>

                     <div className="space-y-3">
                        {todayRecord && !todayRecord.checkOut && todayRecord.checkIn !== 'MEDICAL' && (
                          <div className="flex justify-center mb-2 animate-in fade-in slide-in-from-bottom-2 duration-700">
                             <div className="px-4 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-full flex items-center gap-2 shadow-sm">
                                <div className={`w-1.5 h-1.5 rounded-full ${matrixDutyStatus.isDayFinished ? 'bg-emerald-500' : 'bg-amber-400'}`}></div>
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Class Progress: {matrixDutyStatus.completed}/{matrixDutyStatus.total} Completed</span>
                             </div>
                          </div>
                        )}

                        <button 
                           disabled={loading || isOutOfRange || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'} 
                           onClick={() => handleAction()} 
                           className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all relative overflow-hidden group ${
                             isOutOfRange ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 
                             todayRecord ? 'bg-amber-400 text-[#001f3f]' : 'bg-[#001f3f] text-[#d4af37]'
                           }`}
                        >
                           <div className="relative z-10 flex items-center justify-center gap-3">
                              {loading ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : (
                                matrixDutyStatus.isDayFinished && todayRecord ? (
                                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                                ) : (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z" /></svg>
                                )
                              )}
                              <span>
                                {todayRecord 
                                  ? (matrixDutyStatus.isCurrentActive 
                                      ? `Finish Period ${activeSessionData.current?.slot.id}` 
                                      : matrixDutyStatus.isDayFinished 
                                        ? 'Mark Day End' 
                                        : 'Mark Departure') 
                                  : 'Mark Arrival'}
                              </span>
                           </div>
                        </button>

                        {todayRecord && !todayRecord.checkOut && todayRecord.checkIn !== 'MEDICAL' && (
                           <div className="animate-in slide-in-from-bottom-2 duration-500">
                              <button 
                                 onClick={() => { setPendingAction('MANUAL_OUT'); setIsManualModalOpen(true); }}
                                 className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 border border-amber-100 dark:border-amber-800 text-[9px] font-black uppercase tracking-widest hover:bg-amber-600 hover:text-white transition-all shadow-sm"
                              >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                 Manual Mark Out (with PIN)
                              </button>
                           </div>
                        )}

                        {!todayRecord && (
                          <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-bottom-2 duration-500">
                             <button 
                                onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }}
                                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 border border-sky-100 dark:border-sky-800 text-[9px] font-black uppercase tracking-widest hover:bg-sky-600 hover:text-white transition-all shadow-sm"
                             >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                                Admin Mark Arrival
                             </button>
                             <button 
                                onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }}
                                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 border border-rose-100 dark:border-rose-800 text-[9px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                             >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                Mark Sick Leave
                             </button>
                          </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>

            {/* Personal Matrix Overview (Bento Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-4">
                  <div className="flex justify-between items-center"><p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Weekly Workload</p><span className="text-[10px] font-black text-[#001f3f] dark:text-white italic">{myLoadMetrics.total}P / {myLoadMetrics.target}P</span></div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner"><div style={{ width: `${myLoadMetrics.percent}%` }} className={`h-full transition-all duration-1000 ${myLoadMetrics.percent > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}></div></div>
                  <p className="text-[8px] font-bold text-slate-400 uppercase italic">Schedule updated</p>
               </div>

               {isManagement && (
                 <div className="md:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="space-y-4 flex-1">
                       <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest">School Overview</p>
                       <div className="flex gap-8">
                          <div><span className="text-2xl font-black text-[#001f3f] dark:text-white tabular-nums italic">{globalStats.presentCount}</span><p className="text-[8px] font-bold text-slate-400 uppercase">Staff Present</p></div>
                          <div className="w-px h-10 bg-slate-100 dark:bg-slate-800"></div>
                          <div><span className="text-2xl font-black text-rose-500 tabular-nums italic">{globalStats.activeProxies}</span><p className="text-[8px] font-bold text-slate-400 uppercase">Active Proxies</p></div>
                       </div>
                    </div>
                    <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-[spin_3s_linear_infinite] flex items-center justify-center"><svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12l2 2 4-4"/></svg></div>
                 </div>
               )}
            </div>

            {/* Recent Registry Ledger */}
            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800">
               <h4 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] mb-6 flex items-center gap-3"><svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>Recent Attendance Logs</h4>
               <div className="space-y-3">
                  {attendance.filter(r => r.userId === user.id).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3).map(r => (
                    <div key={r.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 transition-all hover:border-amber-400">
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-950 flex flex-col items-center justify-center shadow-sm">
                             <span className="text-[7px] font-black text-slate-400 uppercase">{new Date(r.date).toLocaleDateString('en-US', { month: 'short' })}</span>
                             <span className="text-xs font-black text-[#001f3f] dark:text-white">{new Date(r.date).getDate()}</span>
                          </div>
                          <div><p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' })}</p><p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-widest">{r.reason || 'Normal Entry'}</p></div>
                       </div>
                       <div className="flex gap-4">
                          <div className="text-right"><p className="text-[7px] font-black text-slate-400 uppercase mb-0.5">In</p><p className="text-[10px] font-black text-emerald-600 italic">{r.checkIn}</p></div>
                          <div className="text-right"><p className="text-[7px] font-black text-slate-400 uppercase mb-0.5">Out</p><p className="text-[10px] font-black text-amber-600 italic">{r.checkOut || '--:--'}</p></div>
                       </div>
                    </div>
                  ))}
               </div>
            </div>
         </div>

         {/* RIGHT COLUMN: TIMELINE & QUOTE */}
         <div className="lg:col-span-4 space-y-8">
            {/* Instructional Pulse (Navy Theme) */}
            <div className="bg-gradient-to-br from-[#001f3f] to-[#002b55] rounded-[3rem] p-8 shadow-2xl border border-white/10 h-fit">
               <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Today's Schedule</h3>
                  <span className="text-[8px] font-black bg-amber-400 text-[#001f3f] px-2 py-1 rounded-lg">LIVE</span>
               </div>
               
               <div className="space-y-8 relative">
                  <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-white/10"></div>
                  
                  {myScheduleToday.length > 0 ? myScheduleToday.map(t => (
                    <div key={t.id} className="relative pl-10 group">
                       <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-white/5 border-4 border-white/10 flex items-center justify-center transition-all group-hover:border-amber-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/20 group-hover:bg-amber-400"></div>
                       </div>
                       <div className="space-y-1">
                          <p className="text-[8px] font-black text-white/40 uppercase tracking-widest leading-none">Period {t.slotId}</p>
                          <p className="text-[11px] font-black text-white uppercase leading-none mt-1">{t.subject}</p>
                          <div className="flex items-center gap-2 pt-0.5">
                             <span className="text-[9px] font-bold text-sky-300 uppercase italic">{t.className}</span>
                             <span className="w-1 h-1 rounded-full bg-white/10"></span>
                             <span className="text-[9px] font-bold text-white/50 uppercase">{t.room}</span>
                          </div>
                       </div>
                    </div>
                  )) : (
                    <div className="py-12 text-center opacity-20 italic text-white">
                       <p className="text-[10px] font-black uppercase tracking-widest">No classes today ({todayDayName})</p>
                    </div>
                  )}

                  {myProxiesToday.map(p => (
                    <div key={p.id} className="relative pl-10 group">
                       <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-rose-500/10 border-4 border-rose-500/30 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></div>
                       </div>
                       <div className="space-y-1">
                          <p className="text-[8px] font-black text-rose-400 uppercase tracking-widest leading-none">Proxy Period {p.slotId}</p>
                          <p className="text-[11px] font-black text-rose-300 uppercase leading-none mt-1">{p.subject}</p>
                          <p className="text-[9px] font-bold text-white/40 uppercase italic">Instead of: {p.absentTeacherName}</p>
                       </div>
                    </div>
                  ))}
               </div>
            </div>

            {/* Daily Inspiration */}
            <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative overflow-hidden group">
               <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-[#d4af37] opacity-[0.03] rounded-full group-hover:scale-110 transition-transform"></div>
               <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Daily Motivation</p>
               {dailyQuote ? (
                 <div className="space-y-3 relative z-10">
                   <p className="text-base font-bold text-white leading-relaxed italic">"{dailyQuote.text}"</p>
                   <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">— {dailyQuote.author}</p>
                 </div>
               ) : (
                 <div className="space-y-4 animate-pulse">
                   <div className="h-4 bg-white/5 rounded-full w-full"></div>
                   <div className="h-4 bg-white/5 rounded-full w-2/3"></div>
                 </div>
               )}
            </div>
         </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
               <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                 {pendingAction === 'MEDICAL' ? 'Mark Sick Leave' : (pendingAction === 'MANUAL_OUT' ? 'Bypass Marking Out' : 'Admin Login')}
               </h4>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 italic">Enter security PIN to continue</p>
             </div>
             <input 
                type="text" 
                placeholder="PIN Code" 
                maxLength={6} 
                value={otpInput} 
                onChange={e => setOtpInput(e.target.value)} 
                className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-8 py-5 text-center text-3xl font-black dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all" 
             />
             <button 
                onClick={() => handleAction(pendingAction === 'OVERRIDE' || pendingAction === 'MANUAL_OUT', pendingAction === 'MEDICAL')} 
                disabled={loading} 
                className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all"
             >
                Confirm PIN
             </button>
             <button onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full hover:text-rose-500 transition-colors">Go Back</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

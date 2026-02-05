
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig, TimeSlot, TimeTableEntry, SectionType } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS, PRIMARY_SLOTS } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { SyncService } from '../services/syncService.ts';
import { HapticService } from '../services/hapticService.ts';
import { GeoValidationService } from '../services/geoValidationService.ts';
import { MatrixService } from '../services/matrixService.ts';
import { BiometricService } from '../services/biometricService.ts';

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

  // AI Matrix Content State
  const [dailyBriefing, setDailyBriefing] = useState<string>('Syncing Matrix Briefing...');
  const [dailyQuote, setDailyQuote] = useState<string>('Educational excellence is our standard.');
  const [isMatrixLoading, setIsMatrixLoading] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  
  // Phase 6 Activity Pulse State
  const [activityPulse, setActivityPulse] = useState<{ id: string; user: string; action: string; time: string }[]>([]);

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  const liveTimeStr = useMemo(() => currentTime.toLocaleTimeString('en-US', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit', hour12: true }), [currentTime]);
  const liveDateStr = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bahrain', weekday: 'long', month: 'long', day: 'numeric' }).format(currentTime), [currentTime]);

  // Phase 6: Realtime Listener Setup
  useEffect(() => {
    if (!isManagement || !IS_CLOUD_ENABLED || isSandbox) return;

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
        const newCheckIn = payload.new;
        setActivityPulse(prev => [
          { id: newCheckIn.id, user: 'Faculty Member', action: 'Captured Check-In', time: new Date().toLocaleTimeString() },
          ...prev
        ].slice(0, 5));
        HapticService.notification();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isManagement, isSandbox]);

  const isSentinelWindow = useMemo(() => {
    const hours = currentTime.getHours();
    const mins = currentTime.getMinutes();
    return hours === 7 && mins >= 0 && mins <= 20;
  }, [currentTime]);

  const sentinelCountdown = useMemo(() => {
    if (!isSentinelWindow) return null;
    const remainingMins = 20 - currentTime.getMinutes();
    const remainingSecs = 59 - currentTime.getSeconds();
    return `${remainingMins}:${remainingSecs.toString().padStart(2, '0')}`;
  }, [currentTime, isSentinelWindow]);

  const geoCenter = { 
    lat: config?.latitude ?? TARGET_LAT, 
    lng: config?.longitude ?? TARGET_LNG, 
    radius: config?.radiusMeters ?? RADIUS_METERS 
  };

  const myScheduleToday = useMemo(() => {
    return timetable
      .filter(t => t.teacherId === user.id && t.day === todayDayName && !t.date)
      .sort((a, b) => a.slotId - b.slotId);
  }, [timetable, user.id, todayDayName]);

  const myProxiesToday = useMemo(() => {
    return substitutions.filter(s => s.substituteTeacherId === user.id && s.date === today && !s.isArchived);
  }, [substitutions, user.id, today]);

  const myRecentLogs = useMemo(() => {
    return attendance
      .filter(r => r.userId === user.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
  }, [attendance, user.id]);

  const reliabilityIndex = useMemo(() => {
    if (myRecentLogs.length === 0) return 100;
    const onTimeCount = myRecentLogs.filter(l => !l.isLate && l.checkIn !== 'MEDICAL').length;
    return Math.round((onTimeCount / myRecentLogs.length) * 100);
  }, [myRecentLogs]);

  const myLoadMetrics = useMemo(() => {
    const policy = config.loadPolicies?.[user.role] || { baseTarget: 28, substitutionCap: 5 };
    const individualScheduled = timetable.filter(t => t.teacherId === user.id && !t.isSubstitution && !t.date && !t.blockId).length;
    const poolCommitment = (config.combinedBlocks || []).filter(b => b.allocations.some(a => a.teacherId === user.id)).reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);
    const total = individualScheduled + poolCommitment;
    return { total, target: policy.baseTarget, percent: Math.min(100, (total / policy.baseTarget) * 100) };
  }, [config, timetable, user.id, user.role]);

  const institutionalPulse = useMemo(() => {
    if (!isManagement) return null;
    const todayRegistry = attendance.filter(r => r.date === today);
    const checkedInCount = todayRegistry.filter(r => r.checkIn !== 'MEDICAL').length;
    const proxyCount = substitutions.filter(s => s.date === today && !s.isArchived).length;
    const totalSlotsToday = timetable.filter(t => t.day === todayDayName && !t.date).length;
    
    return {
      presence: Math.round((checkedInCount / 30) * 100), 
      coverage: Math.round(((totalSlotsToday - (0)) / totalSlotsToday) * 100) || 100,
      activeProxies: proxyCount
    };
  }, [isManagement, attendance, substitutions, today, todayDayName, timetable]);

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

  const fetchMatrixAI = useCallback(async () => {
    if (isMatrixLoading) return;
    const isAiReady = await MatrixService.isReady();
    if (!isAiReady) {
      setDailyBriefing(`Salams, ${user.name}. Focus on Period 1 registration.`);
      return;
    }

    setIsMatrixLoading(true);
    try {
      const briefingPrompt = `
        Institutional Analyst Persona for ${SCHOOL_NAME}.
        Teacher: ${user.name}. Day: ${todayDayName}.
        Stats: ${myScheduleToday.length} regular, ${myProxiesToday.length} proxies.
        Current Load: ${myLoadMetrics.percent}% of weekly cap.
        
        TASK:
        1. Greet professionally.
        2. Give "Actionable Intel": identify the biggest gap between classes and suggest a specific task.
        Be authoritative and under 3 sentences.
      `;

      const quotePrompt = "One short educational motivation quote for an Islamic school teacher.";

      const [briefingRes, quoteRes] = await Promise.all([
        MatrixService.architectRequest(briefingPrompt),
        MatrixService.architectRequest(quotePrompt)
      ]);

      setDailyBriefing(briefingRes.text?.trim() || `Matrix operational for ${user.name}.`);
      setDailyQuote(quoteRes.text?.trim() || "Excellence is not an act, but a habit.");
    } catch (e) {
      console.warn("Matrix Handshake Interrupted.");
    } finally {
      setIsMatrixLoading(false);
    }
  }, [user.name, todayDayName, myScheduleToday.length, myProxiesToday.length, myLoadMetrics.percent]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000); 
    fetchMatrixAI();
    setBiometricActive(BiometricService.isEnrolled(user.id));
    return () => clearInterval(timer);
  }, [fetchMatrixAI, user.id]);

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
      console.warn("Geolocation Sentinel Offline"); 
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
        const validation = await GeoValidationService.validate(
          pos.coords.latitude, 
          pos.coords.longitude, 
          geoCenter.lat, 
          geoCenter.lng, 
          geoCenter.radius
        );

        if (!validation.valid) {
          HapticService.error();
          throw new Error(`Location Handshake Failed: Move closer to campus (${Math.round(validation.distance)}m away).`);
        }
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
        } else if (isSandbox) {
           addSandboxLog?.('ATTENDANCE_INITIALIZE', payload);
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
        showToast(isMedical ? "Leave recorded." : "Attendance marked.", "success");
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
        showToast("Departure marked.", "success");
        HapticService.success();
      }
      setIsManualModalOpen(false); setPendingAction(null); setOtpInput('');
    } catch (err: any) { 
      showToast(err.message || "Failed to mark attendance.", "error"); 
    } finally { 
      setLoading(false); 
    }
  };

  const radarProjection = useMemo(() => {
    if (!userCoords) return { x: 50, y: 50 };
    const scale = 50 / (RADIUS_METERS * 1.5);
    const dLat = (userCoords.lat - geoCenter.lat) * 111111 * scale;
    const dLng = (userCoords.lng - geoCenter.lng) * 100000 * scale;
    const x = Math.max(5, Math.min(95, 50 + dLng));
    const y = Math.max(5, Math.min(95, 50 - dLat));
    return { x, y };
  }, [userCoords, geoCenter]);

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32">
      
      {/* 1. INSTITUTIONAL STATUS SENTINEL */}
      <div className="mx-4 grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-4 duration-1000">
         <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${biometricActive ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></div>
            <div className="flex-1">
               <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Passkey Status</p>
               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase truncate">{biometricActive ? 'Identity Secured' : 'Identity Vulnerable'}</p>
            </div>
         </div>
         <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${userCoords && userCoords.accuracy < 30 ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
            <div className="flex-1">
               <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Signal integrity</p>
               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{userCoords ? `Accurate to ${Math.round(userCoords.accuracy)}m` : 'Scanning...'}</p>
            </div>
         </div>
         <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            <div className="flex-1">
               <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Temporal Sync</p>
               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">Bahrain Time Active</p>
            </div>
         </div>
         <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${isOutOfRange ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
            <div className="flex-1">
               <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Matrix boundary</p>
               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">{isOutOfRange ? 'Outside Campus' : 'Authorized Zone'}</p>
            </div>
         </div>
      </div>

      {isManagement && institutionalPulse && (
        <div className="mx-4 grid grid-cols-1 md:grid-cols-12 gap-6 animate-in slide-in-from-top-4 duration-1000">
           <div className="md:col-span-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 rounded-[2.5rem] border border-emerald-500/20 shadow-xl flex items-center justify-between group overflow-hidden">
              <div className="relative z-10">
                 <p className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1">Faculty Presence</p>
                 <p className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tighter">{institutionalPulse.presence}%</p>
              </div>
           </div>
           <div className="md:col-span-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 rounded-[2.5rem] border border-sky-500/20 shadow-xl flex items-center justify-between group overflow-hidden">
              <div className="relative z-10">
                 <p className="text-[9px] font-black text-sky-600 dark:text-sky-400 uppercase tracking-widest mb-1">Instruction Coverage</p>
                 <p className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tighter">{institutionalPulse.coverage}%</p>
              </div>
           </div>
           {/* Phase 6 addition: Activity Pulse for Management */}
           <div className="md:col-span-6 bg-[#001f3f] p-6 rounded-[2.5rem] border border-amber-400/30 shadow-2xl overflow-hidden relative">
              <div className="flex items-center gap-3 mb-4">
                 <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></div>
                 <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Matrix Pulse (Real-time Feed)</p>
              </div>
              <div className="space-y-2 h-16 overflow-y-auto scrollbar-hide">
                 {activityPulse.length > 0 ? activityPulse.map(act => (
                   <div key={act.id} className="flex justify-between items-center bg-white/5 px-3 py-1 rounded-lg animate-in slide-in-from-right duration-300">
                      <span className="text-[10px] font-bold text-white uppercase">{act.user}</span>
                      <span className="text-[10px] text-amber-200/60 font-medium italic">{act.action}</span>
                      <span className="text-[8px] text-slate-500 font-black tabular-nums">{act.time}</span>
                   </div>
                 )) : (
                   <p className="text-[10px] text-slate-500 italic uppercase text-center mt-2">Awaiting network pulses...</p>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* 2. INTELLIGENCE LAYER */}
      <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-gradient-to-br from-[#001f3f] to-[#002b55] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
             <img src={SCHOOL_LOGO_BASE64} className="w-48 h-48 object-contain grayscale" alt="" />
          </div>
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
               <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">Matrix Daily Briefing</h3>
            </div>
            <p className={`text-lg font-medium text-white italic leading-relaxed ${isMatrixLoading ? 'animate-pulse opacity-50' : ''}`}>
              “{dailyBriefing}”
            </p>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col justify-center relative group">
          <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-3">Daily Motivation</p>
          <p className={`text-xs font-bold text-[#001f3f] dark:text-slate-300 italic leading-relaxed ${isMatrixLoading ? 'animate-pulse opacity-50' : ''}`}>
            {dailyQuote}
          </p>
        </div>
      </div>

      {/* 3. OPERATIONAL LAYER */}
      <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
         <div className="lg:col-span-3 bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-[#d4af37]/20 flex flex-col items-center justify-center text-center group relative overflow-hidden">
            {isSentinelWindow && <div className="absolute inset-0 bg-amber-400/10 animate-pulse"></div>}
            <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1 relative z-10">Current Time</p>
            <div className="text-3xl font-black text-white italic tracking-tighter tabular-nums leading-none relative z-10">{liveTimeStr.split(' ')[0]}<span className="text-xs text-amber-400 ml-1">{liveTimeStr.split(' ')[1]}</span></div>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2 relative z-10">{liveDateStr}</p>
            
            {isSentinelWindow && (
               <div className="mt-4 p-3 bg-amber-400 rounded-2xl shadow-lg animate-bounce relative z-10">
                  <p className="text-[8px] font-black text-[#001f3f] uppercase tracking-tighter leading-none">Registry Lock In:</p>
                  <p className="text-xl font-black text-[#001f3f] leading-none mt-1">{sentinelCountdown}</p>
               </div>
            )}
         </div>

         <div className="lg:col-span-9">
            <div className="bg-gradient-to-r from-[#001f3f] via-[#002b55] to-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-amber-400/20 relative overflow-hidden flex flex-col md:flex-row gap-8 items-center justify-between group">
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
                    </div>
                  )}
               </div>
            </div>
         </div>
      </div>

      <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
         <div className="lg:col-span-8 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-10 shadow-2xl relative overflow-hidden border border-slate-100 dark:border-slate-800">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div className="flex flex-col items-center justify-center">
                     <div className="relative w-56 h-56 flex items-center justify-center bg-slate-50 dark:bg-slate-950 rounded-full border border-slate-100 dark:border-slate-800 shadow-inner group/map overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05)_0%,transparent_70%)]"></div>
                        <div className="absolute w-full h-full border border-slate-200 dark:border-slate-800 rounded-full scale-[0.3]"></div>
                        <div className="absolute w-full h-full border border-slate-200 dark:border-slate-800 rounded-full scale-[0.6]"></div>
                        <div className="absolute w-full h-full border-2 border-emerald-500/20 rounded-full animate-pulse scale-[1.0]"></div>
                        <div className="absolute w-full h-full bg-gradient-to-r from-emerald-500/10 to-transparent origin-center animate-[spin_4s_linear_infinite]"></div>
                        <div className="absolute w-4 h-4 bg-[#001f3f] dark:bg-white rounded-full z-20 shadow-lg flex items-center justify-center border-2 border-amber-400"><div className="w-1 h-1 bg-amber-400 rounded-full"></div></div>
                        {userCoords && (
                          <div 
                             style={{ left: `${radarProjection.x}%`, top: `${radarProjection.y}%` }}
                             className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-1000"
                          >
                             <div className="absolute inset-0 bg-sky-500 rounded-full animate-ping opacity-20"></div>
                             <div className="relative w-full h-full bg-sky-500 rounded-full border-2 border-white shadow-xl flex items-center justify-center"><div className="w-1.5 h-1.5 bg-white rounded-full"></div></div>
                          </div>
                        )}
                        <div className="relative z-10 flex flex-col items-center mt-32">
                           <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-1.5 rounded-2xl shadow-xl border border-white/20">
                              <p className={`text-2xl font-black italic tracking-tighter ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>
                                {currentDistance !== null ? Math.round(currentDistance) : '--'}m
                              </p>
                           </div>
                        </div>
                     </div>
                  </div>

                  <div className="space-y-6">
                     <div className="space-y-2">
                        <div className="flex items-center gap-3">
                           <div className={`w-2 h-2 rounded-full ${biometricActive ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`}></div>
                           <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{biometricActive ? 'Identity Synced' : 'Action Required: Enroll Passkey'}</p>
                        </div>
                        <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-tight">
                          {todayRecord ? (todayRecord.checkOut ? 'Registry Closed' : 'Duty Logged') : 'Mark Registry'}
                        </h2>
                     </div>

                     <div className="space-y-3">
                        <button 
                           disabled={loading || isOutOfRange || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'} 
                           onClick={() => handleAction()} 
                           className={`w-full py-6 rounded-[2.5rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all relative overflow-hidden group ${
                             isOutOfRange ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 
                             isSentinelWindow && !todayRecord ? 'bg-amber-400 text-[#001f3f] ring-4 ring-amber-400/30' :
                             todayRecord ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-[#001f3f] text-[#d4af37]'
                           }`}
                        >
                           <span>
                             {todayRecord 
                               ? (matrixDutyStatus.isCurrentActive 
                                   ? `Sync Period ${activeSessionData.current?.slot.id}` 
                                   : matrixDutyStatus.isDayFinished 
                                     ? 'End Work Day' 
                                     : 'Log Departure') 
                               : 'Initialize Arrival'}
                           </span>
                        </button>

                        {!todayRecord && (
                          <div className="grid grid-cols-2 gap-3">
                             <button onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }} className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 border border-sky-100 text-[9px] font-black uppercase tracking-widest">PIN Entry</button>
                             <button onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }} className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 border border-rose-100 text-[9px] font-black uppercase tracking-widest">Sick Leave</button>
                          </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8">
               <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.4em] italic leading-none">Reliability Scoreboard</h3>
                  <span className="text-[11px] font-black text-[#001f3f] dark:text-white italic">{reliabilityIndex}% Reliable</span>
               </div>

               <div className="overflow-x-auto scrollbar-hide">
                  <table className="w-full text-left border-collapse">
                     <thead>
                        <tr className="text-[8px] font-black text-slate-400 uppercase tracking-widest border-b dark:border-slate-800">
                           <th className="pb-4">Registry Date</th>
                           <th className="pb-4">Arrived</th>
                           <th className="pb-4">Departed</th>
                           <th className="pb-4 text-right">Status</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                        {myRecentLogs.map(log => (
                          <tr key={log.id} className="group">
                             <td className="py-4 text-[11px] font-black text-[#001f3f] dark:text-white italic">{log.date}</td>
                             <td className={`py-4 text-[10px] font-bold ${log.isLate ? 'text-rose-500' : 'text-emerald-500'}`}>{log.checkIn}</td>
                             <td className="py-4 text-[10px] font-bold text-slate-400">{log.checkOut || '--:--'}</td>
                             <td className="py-4 text-right">
                                <span className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase ${log.isLate ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                   {log.isLate ? 'Late' : 'Standard'}
                                </span>
                             </td>
                          </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </div>
         </div>

         <div className="lg:col-span-4 space-y-8">
            <div className="bg-gradient-to-br from-[#001f3f] to-[#002b55] rounded-[3rem] p-8 shadow-2xl border border-white/10 h-fit">
               <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic mb-8">Instructional Roster</h3>
               <div className="space-y-8 relative">
                  {myScheduleToday.length > 0 ? myScheduleToday.map(t => (
                    <div key={t.id} className="relative pl-10 group">
                       <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-white/5 border-4 border-white/10 flex items-center justify-center group-hover:border-amber-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/20 group-hover:bg-amber-400"></div>
                       </div>
                       <div className="space-y-1">
                          <p className="text-[8px] font-black text-white/40 uppercase tracking-widest leading-none">Period {t.slotId}</p>
                          <p className="text-[11px] font-black text-white uppercase leading-none mt-1">{t.subject}</p>
                          <p className="text-[8px] font-bold text-sky-400 uppercase italic">With {t.className}</p>
                       </div>
                    </div>
                  )) : (
                    <div className="py-12 text-center opacity-20 italic text-white">
                       <p className="text-[10px] font-black uppercase tracking-widest">No assigned classes</p>
                    </div>
                  )}
               </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-4">
               <div className="flex justify-between items-center">
                  <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Load Matrix</p>
                  <span className="text-[10px] font-black text-[#001f3f] dark:text-white italic">{myLoadMetrics.total}P / {myLoadMetrics.target}P</span>
               </div>
               <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
                  <div style={{ width: `${myLoadMetrics.percent}%` }} className={`h-full transition-all duration-1000 ${myLoadMetrics.percent > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
               </div>
            </div>
         </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
               <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Institutional Bypass</h4>
             </div>
             <input type="text" maxLength={6} value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-8 py-5 text-center text-3xl font-black dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all" />
             <button onClick={() => handleAction(pendingAction === 'OVERRIDE' || pendingAction === 'MANUAL_OUT', pendingAction === 'MEDICAL')} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl">Confirm PIN</button>
             <button onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Go Back</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig, TimeSlot, TimeTableEntry } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { NotificationService } from '../services/notificationService.ts';
import { GoogleGenAI } from "@google/genai";

interface DashboardProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  substitutions?: SubstitutionRecord[];
  currentOTP: string;
  setOTP: (otp) => void;
  notifications: SchoolNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  config: SchoolConfig;
  timetable?: TimeTableEntry[];
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications, showToast, config, timetable = [] }) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isStandalone, setIsStandalone] = useState(true);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
  
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [dailyQuote, setDailyQuote] = useState<{ text: string; author: string } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const lastBriefingKey = useRef<string>("");

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const userProxiesToday = useMemo(() => 
    substitutions.filter(s => s.substituteTeacherId.toLowerCase() === user.id.toLowerCase() && s.date === today && !s.isArchived),
    [substitutions, user.id, today]
  );

  const geoCenter = {
    lat: config?.latitude ?? TARGET_LAT,
    lng: config?.longitude ?? TARGET_LNG,
    radius: config?.radiusMeters ?? RADIUS_METERS
  };

  // Profile completeness check for badge
  const isProfileIncomplete = useMemo(() => {
    const biometricEnrolled = localStorage.getItem(`ihis_biometric_active_${user.id}`) === 'true';
    return !user.telegram_chat_id || !biometricEnrolled;
  }, [user]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    setIsStandalone(NotificationService.isStandalone());
    if ('Notification' in window) setNotifPermission(Notification.permission);
    return () => clearInterval(timer);
  }, []);

  const fetchDailyQuote = useCallback(async () => {
    const cachedQuote = localStorage.getItem('ihis_daily_quote');
    const cachedDate = localStorage.getItem('ihis_quote_date');

    if (cachedQuote && cachedDate === today) {
      try {
        setDailyQuote(JSON.parse(cachedQuote));
        return;
      } catch (e) {
        console.warn("Failed to parse cached quote");
      }
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Provide one unique, short, and powerful inspiring quote about teaching or the impact of education. Avoid cliches. Format as JSON: { \"text\": \"quote here\", \"author\": \"author name\" }. Keep it under 20 words.",
        config: { responseMimeType: "application/json" }
      });
      
      const quoteData = JSON.parse(response.text);
      setDailyQuote(quoteData);
      localStorage.setItem('ihis_daily_quote', JSON.stringify(quoteData));
      localStorage.setItem('ihis_quote_date', today);
    } catch (err) {
      setDailyQuote({ text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" });
    }
  }, [today]);

  const fetchBriefing = useCallback(async (force: boolean = false) => {
    const proxyHash = userProxiesToday.map(p => `${p.id}`).join('|');
    const briefingKey = `${user.id}-${today}-${proxyHash}-${todayRecord ? 'checked' : 'pending'}`;
    
    if (!force && aiBriefing && briefingKey === lastBriefingKey.current) return;
    if (isBriefingLoading) return;

    setIsBriefingLoading(true);
    lastBriefingKey.current = briefingKey;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const proxyList = userProxiesToday.length > 0 
        ? userProxiesToday.map(p => `- Period ${p.slotId} for Class ${p.className} (Subject: ${p.subject})`).join('\n')
        : 'No proxy duties assigned currently.';

      const prompt = `Act as an encouraging AI school assistant for ${SCHOOL_NAME}. 
      Teacher: ${user.name}
      Role: ${user.role}
      Date: ${today}
      Status: ${todayRecord ? (todayRecord.checkIn === 'MEDICAL' ? 'On Medical Leave' : `Logged in at ${todayRecord.checkIn}`) : 'Attendance Pending'}

      CURRENT PROXY SCHEDULE (IMPORTANT):
      ${proxyList}
      
      INSTRUCTION: Generate a concise, professional briefing (max 50 words). 
      If there are proxy duties, highlight them clearly first. Use a tone of "Institutional Readiness." 
      If not checked in, remind them of the ${geoCenter.radius}m campus geotag requirement.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      
      setAiBriefing(response.text || "Institutional intelligence synchronized. Duty schedule active.");
    } catch (err) {
      setAiBriefing(`Portal active for ${user.name.split(' ')[0]}. Geotag verification linked. ${userProxiesToday.length > 0 ? 'Review assigned proxy duties below.' : ''}`);
    } finally {
      setIsBriefingLoading(false);
    }
  }, [user.id, user.name, user.role, today, todayRecord, userProxiesToday, aiBriefing, isBriefingLoading, geoCenter.radius]);

  useEffect(() => {
    fetchBriefing();
    fetchDailyQuote();
  }, [fetchBriefing, fetchDailyQuote, userProxiesToday]);

  const refreshGeolocation = useCallback(async () => {
    setIsRefreshingGps(true);
    try {
      const pos = await getCurrentPosition();
      setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (err) { 
      console.warn("Geolocation Failed:", err);
    } finally {
      setIsRefreshingGps(false);
    }
  }, []);

  useEffect(() => {
    refreshGeolocation();
    const interval = setInterval(refreshGeolocation, 30000);
    return () => clearInterval(interval);
  }, [refreshGeolocation]);

  const currentDistance = useMemo(() => {
    if (!userCoords) return null;
    return calculateDistance(userCoords.lat, userCoords.lng, geoCenter.lat, geoCenter.lng);
  }, [userCoords, geoCenter]);

  const isOutOfRange = useMemo(() => {
    if (currentDistance === null || !userCoords) return true;
    return (currentDistance - userCoords.accuracy) > geoCenter.radius;
  }, [currentDistance, userCoords, geoCenter.radius]);

  // LIVE DUTY PULSE LOGIC
  const livePulse = useMemo(() => {
    const allRoles = [user.role, ...(user.secondaryRoles || [])];
    const section = allRoles.some(r => r.includes('PRIMARY')) ? 'PRIMARY' : 'SECONDARY_BOYS';
    const slots = (config.slotDefinitions?.[section as any] || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    const nowStr = currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bahrain' });
    
    let currentSlot: TimeSlot | null = null;
    let nextSlot: TimeSlot | null = null;

    for (let i = 0; i < slots.length; i++) {
      if (nowStr >= slots[i].startTime && nowStr <= slots[i].endTime) {
        currentSlot = slots[i];
        nextSlot = slots[i + 1] || null;
        break;
      }
      if (nowStr < slots[i].startTime) {
        nextSlot = slots[i];
        break;
      }
    }

    const getDutyForSlot = (sid: number) => {
      // Check for proxies first as they override base
      const proxy = userProxiesToday.find(p => p.slotId === sid);
      if (proxy) return { subject: proxy.subject, className: proxy.className, room: 'Assigned Room', isProxy: true };

      // Check base timetable
      const base = timetable.find(t => t.day === todayDayName && t.slotId === sid && !t.date && (t.teacherId === user.id || config.combinedBlocks.find(b => b.id === t.blockId)?.allocations.some(a => a.teacherId === user.id)));
      if (base) {
        let room = base.room || 'Unassigned';
        if (base.blockId) {
          room = config.combinedBlocks.find(b => b.id === base.blockId)?.allocations.find(a => a.teacherId === user.id)?.room || room;
        }
        return { subject: base.subject, className: base.className, room, isProxy: false };
      }
      return null;
    };

    const currentDuty = currentSlot ? getDutyForSlot(currentSlot.id) : null;
    const nextDuty = nextSlot ? getDutyForSlot(nextSlot.id) : null;

    // Progress bar calc
    let progress = 0;
    if (currentSlot) {
      const [sh, sm] = currentSlot.startTime.split(':').map(Number);
      const [eh, em] = currentSlot.endTime.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      const now = currentTime.getHours() * 60 + currentTime.getMinutes();
      progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    }

    return { currentSlot, nextSlot, currentDuty, nextDuty, progress };
  }, [currentTime, config.slotDefinitions, user.role, user.secondaryRoles, user.id, todayDayName, userProxiesToday, timetable, config.combinedBlocks]);

  const handleAction = async (isManual: boolean = false, isMedical: boolean = false) => {
    if ((isManual || isMedical)) {
      const sanitizedInput = otpInput.trim();
      if (sanitizedInput !== String(currentOTP || "").trim()) { 
        showToast("Invalid Security Key", "error"); 
        return; 
      }
    }

    setLoading(true);
    try {
      let location = undefined;
      if (!isManual && !isMedical) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, geoCenter.lat, geoCenter.lng);
        const accuracy = pos.coords.accuracy || 0;
        if (dist - accuracy > geoCenter.radius) {
          throw new Error(`Gateway Proximity Mismatch (Dist: ${Math.round(dist)}m, Acc: ±${Math.round(accuracy)}m). Please be on campus.`);
        }
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      
      const bahrainNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
      const timeString = isMedical ? 'MEDICAL' : bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      
      if (!todayRecord) {
        const isLate = !isMedical && (bahrainNow.getHours() > LATE_THRESHOLD_HOUR || (bahrainNow.getHours() === LATE_THRESHOLD_HOUR && bahrainNow.getMinutes() > LATE_THRESHOLD_MINUTE));
        const payload = { user_id: user.id, date: today, check_in: timeString, is_manual: true, is_late: isLate, location: location || null, reason: isMedical ? 'Medical Leave' : (isManual ? 'Manual Override' : 'Standard Check-In') };

        if (IS_CLOUD_ENABLED) {
          const { data, error } = await supabase.from('attendance').insert(payload).select().single();
          if (error) throw error;
          setAttendance(prev => [{ id: data.id, userId: user.id, userName: user.name, date: today, checkIn: timeString, checkOut: isMedical ? 'ABSENT' : undefined, isManual: isManual || isMedical, isLate, location, reason: payload.reason }, ...prev]);
        } else {
           setAttendance(prev => [{ id: `loc-${Date.now()}`, userId: user.id, userName: user.name, date: today, checkIn: timeString, checkOut: isMedical ? 'ABSENT' : undefined, isManual: isManual || isMedical, isLate, location, reason: payload.reason }, ...prev]);
        }
        showToast(isMedical ? "Medical Record Logged" : "Registry Successful", "success");
      } else {
        if (isMedical || todayRecord.checkIn === 'MEDICAL') { showToast("Status locked for today.", "warning"); setLoading(false); return; }
        const timeOut = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        if (IS_CLOUD_ENABLED) await supabase.from('attendance').update({ check_out: timeOut }).match({ user_id: user.id, date: today });
        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: timeOut } : r));
        showToast("Departure Registered", "success");
      }
      setIsManualModalOpen(false);
      setPendingAction(null);
      setOtpInput('');
    } catch (err: any) {
      showToast(err.message || "Gateway Failure", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32">
      {/* Dynamic Operational Duty Pulse */}
      {(livePulse.currentSlot || livePulse.nextSlot) && (
        <div className="mx-4 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border-2 border-[#001f3f]/5 dark:border-white/5 overflow-hidden group">
           <div className="flex flex-col md:flex-row">
              <div className="flex-1 p-8 space-y-6">
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                       <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
                       <span className="text-[10px] font-black text-[#001f3f] dark:text-emerald-400 uppercase tracking-[0.3em]">Operational Pulse</span>
                    </div>
                    {livePulse.currentSlot && (
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{livePulse.currentSlot.startTime} — {livePulse.currentSlot.endTime}</span>
                    )}
                 </div>

                 {livePulse.currentDuty ? (
                   <div className="space-y-4">
                      <div className="flex items-end justify-between">
                         <div>
                            <h3 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">{livePulse.currentDuty.subject}</h3>
                            <p className="text-xs font-bold text-slate-500 uppercase mt-1">Section: {livePulse.currentDuty.className} • {livePulse.currentDuty.room}</p>
                         </div>
                         {livePulse.currentDuty.isProxy && (
                           <span className="px-3 py-1 bg-amber-400 text-[#001f3f] text-[9px] font-black rounded-lg uppercase shadow-lg">Proxy Active</span>
                         )}
                      </div>
                      <div className="space-y-2">
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                           <div style={{ width: `${livePulse.progress}%` }} className="h-full bg-emerald-500 transition-all duration-1000"></div>
                        </div>
                        <p className="text-[8px] font-black text-slate-400 uppercase text-right tracking-[0.2em]">{Math.round(livePulse.progress)}% Period Elapsed</p>
                      </div>
                   </div>
                 ) : (
                   <div className="py-2">
                      <h3 className="text-xl font-black text-slate-300 dark:text-slate-700 uppercase italic">Institutional Break / Idle</h3>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">No Assigned Instruction Currently</p>
                   </div>
                 )}
              </div>

              {livePulse.nextSlot && (
                <div className="w-full md:w-64 bg-slate-50 dark:bg-slate-800/50 p-8 border-t md:border-t-0 md:border-l border-slate-100 dark:border-white/5 flex flex-col justify-center">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Coming Up Next</p>
                   {livePulse.nextDuty ? (
                     <div className="space-y-2">
                        <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase truncate">{livePulse.nextDuty.subject}</p>
                        <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase italic">{livePulse.nextDuty.className}</p>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Starts at {livePulse.nextSlot.startTime}</p>
                     </div>
                   ) : (
                     <p className="text-[10px] font-bold text-slate-400 uppercase italic">Unassigned Slot</p>
                   )}
                </div>
              )}
           </div>
        </div>
      )}

      {/* Profile Incomplete Badge */}
      {isProfileIncomplete && (
        <div className="mx-4 bg-rose-50 dark:bg-rose-900/20 border-2 border-dashed border-rose-200 dark:border-rose-800/50 p-4 rounded-2xl flex items-center justify-between animate-in slide-in-from-top-4">
           <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-rose-500/30">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <div>
                 <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Portal Synchronization Incomplete</p>
                 <p className="text-[11px] font-medium text-rose-800/70 dark:text-rose-300/70">Critical security steps pending in your profile.</p>
              </div>
           </div>
           <span className="text-[9px] font-black text-rose-500 uppercase underline cursor-pointer">Resolve Now</span>
        </div>
      )}

      {dailyQuote && (
        <div className="mx-4 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 p-4 rounded-2xl flex items-center gap-4 animate-in slide-in-from-top-4 duration-1000">
           <div className="shrink-0 text-amber-500">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21L14.017 18C14.017 16.8954 14.9124 16 16.017 16H19.017C19.5693 16 20.017 15.5523 20.017 15V9C20.017 8.44772 19.5693 8 19.017 8H16.017C14.9124 8 14.017 7.10457 14.017 6V5C14.017 3.89543 14.9124 3 16.017 3H19.017C21.2261 3 23.017 4.79086 23.017 7V15C23.017 18.3137 20.3307 21 17.017 21H14.017ZM1.017 21L1.017 18C1.017 16.8954 1.91243 16 3.017 16H6.017C6.56928 16 7.017 15.5523 7.017 15V9C7.017 8.44772 6.56928 8 6.017 8H3.017C1.91243 8 1.017 7.10457 1.017 6V5C1.017 3.89543 1.91243 3 3.017 3H6.017C8.22614 3 10.017 4.79086 10.017 7V15C10.017 18.3137 7.3307 21 4.017 21H1.017Z"/></svg>
           </div>
           <p className="text-[11px] font-medium italic text-amber-800 dark:text-amber-300 leading-relaxed">"{dailyQuote.text}" <span className="not-italic font-black text-[9px] ml-1 opacity-60">— {dailyQuote.author}</span></p>
        </div>
      )}

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-4">
        <div className="text-center md:text-left space-y-2">
          <h2 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Staff <span className="text-[#d4af37]">Terminal</span>
          </h2>
          <p className="text-xs font-black text-slate-400 uppercase tracking-[0.4em]">{currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 px-8 py-5 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 text-center min-w-[200px]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Institutional Time</p>
          <p className="text-3xl font-black text-[#001f3f] dark:text-white tracking-tighter italic">{currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bahrain' })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <div className="bg-gradient-to-br from-[#001f3f] to-[#003366] rounded-[3rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#d4af37]/10 blur-[80px] rounded-full"></div>
            <div className="relative z-10 flex items-start gap-6">
              <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <svg className={`w-6 h-6 ${isBriefingLoading ? 'animate-spin text-amber-400' : 'text-[#d4af37]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">AI Morning Briefing</h3>
                  <button onClick={() => fetchBriefing(true)} disabled={isBriefingLoading} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group"><svg className={`w-4 h-4 text-white/30 group-hover:text-amber-400 ${isBriefingLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                </div>
                {isBriefingLoading ? (
                  <div className="space-y-2 py-2"><div className="h-3 w-48 bg-white/5 animate-pulse rounded-full"></div><div className="h-3 w-64 bg-white/5 animate-pulse rounded-full"></div></div>
                ) : (
                  <p className="text-sm md:text-base text-white/90 font-medium leading-relaxed italic pr-4">{aiBriefing || `Syncing institutional context...`}</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700"><img src={SCHOOL_LOGO_BASE64} alt="" className="w-48 h-48 object-contain grayscale invert" /></div>
             <div className="relative z-10 space-y-8">
                <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full animate-pulse ${isRefreshingGps ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                  <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.4em]">Geotag Status Hub</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-2">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Distance from Center</p>
                     <div className="flex items-baseline gap-2"><span className="text-4xl font-black text-white italic tracking-tighter">{currentDistance !== null ? Math.round(currentDistance) : '--'}</span><span className="text-xs font-black text-slate-500 uppercase tracking-widest">Meters</span></div>
                  </div>
                  <div className="space-y-2">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Access Authorization</p>
                     <div className={`text-sm font-black uppercase tracking-[0.2em] px-4 py-2 rounded-xl border flex items-center gap-3 ${isOutOfRange ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}><div className={`w-2 h-2 rounded-full ${isOutOfRange ? 'bg-rose-500' : 'bg-emerald-50'}`}></div>{isOutOfRange ? 'OUTSIDE PERIMETER' : 'AUTHORIZED'}</div>
                  </div>
                </div>
                <div className="pt-10 flex flex-col sm:flex-row gap-4">
                  <button disabled={loading || (isOutOfRange && !todayRecord) || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'} onClick={() => handleAction()} className={`flex-1 py-6 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${todayRecord ? 'bg-amber-500 text-[#001f3f] hover:bg-amber-400' : 'bg-[#d4af37] text-[#001f3f] hover:bg-white disabled:bg-slate-700 disabled:text-slate-500'}`}>{loading ? 'Processing...' : (todayRecord ? 'Clock-Out System' : 'Clock-In System')}</button>
                  <button onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }} className="px-8 py-6 rounded-3xl bg-white/5 text-white/60 hover:bg-white/10 border border-white/10 font-black text-[10px] uppercase tracking-widest transition-all">Key Override</button>
                </div>
             </div>
          </div>
        </div>

        <div className="space-y-8">
           <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-4">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Registry</h4>
                 <div className={`w-2 h-2 rounded-full shadow-lg ${todayRecord ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-slate-200'}`}></div>
              </div>
              <div className="space-y-4">
                 <div className="flex justify-between items-center"><span className="text-[9px] font-bold text-slate-500 uppercase">In-Timestamp</span><span className={`text-xs font-black italic ${todayRecord?.checkIn === 'MEDICAL' ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>{todayRecord?.checkIn || '--:--'}</span></div>
                 <div className="flex justify-between items-center"><span className="text-[9px] font-bold text-slate-500 uppercase">Out-Timestamp</span><span className="text-xs font-black text-amber-600 italic">{todayRecord?.checkIn === 'MEDICAL' ? 'EXCUSED' : (todayRecord?.checkOut || 'ACTIVE')}</span></div>
              </div>
           </div>

           <div className="bg-rose-50 dark:bg-rose-950/20 rounded-[2.5rem] p-8 border-2 border-dashed border-rose-100 dark:border-rose-900/40 text-center space-y-4">
              <p className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em]">Absence Protocol</p>
              <button onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }} disabled={loading || !!todayRecord} className="w-full py-4 rounded-2xl bg-white dark:bg-slate-900 text-rose-500 font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-rose-500 hover:text-white transition-all disabled:opacity-30">Register Absence</button>
           </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{pendingAction === 'MEDICAL' ? 'Absence Link' : 'Matrix Override'}</h4><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Enter Access Credential</p></div>
             <input type="text" placeholder="Access Key" maxLength={10} value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-8 py-5 text-center text-3xl font-black tracking-[0.2em] dark:text-white outline-none" />
             <button onClick={() => handleAction(pendingAction === 'OVERRIDE', pendingAction === 'MEDICAL')} disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/10 active:scale-95">Confirm Protocol</button>
             <button onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Discard Attempt</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
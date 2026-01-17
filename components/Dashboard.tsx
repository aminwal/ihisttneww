import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { GoogleGenAI } from "@google/genai";
import { NotificationService } from '../services/notificationService.ts';

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
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications, showToast }) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isMedicalModalOpen, setIsMedicalModalOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Consolidate permission status into one source of truth for the UI
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(() => {
    return NotificationService.isSupported() ? Notification.permission : 'denied';
  });
  
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  // Force sync state when window gains focus (useful if user changed settings in another tab)
  useEffect(() => {
    const handleFocus = () => {
      if (NotificationService.isSupported()) {
        const current = Notification.permission;
        if (current !== notifPermission) {
          setNotifPermission(current);
        }
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [notifPermission]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const requestNotifPermission = async () => {
    if (!NotificationService.isSupported()) {
      showToast("Notifications not supported in this browser.", "error");
      return;
    }

    // If permission is already granted, just sync the state and hide the banner
    if (Notification.permission === 'granted') {
      setNotifPermission('granted');
      showToast("Alerts already enabled.", "success");
      return;
    }

    // If permission is denied, the browser won't show the prompt again
    if (Notification.permission === 'denied') {
      setNotifPermission('denied');
      showToast("Blocked: Please enable notifications in the Browser Address Bar (lock icon).", "warning");
      return;
    }

    try {
      const status = await NotificationService.requestPermission();
      setNotifPermission(status);
      
      if (status === 'granted') {
        showToast("Duty Matrix Alerts Authorized", "success");
      } else if (status === 'denied') {
        showToast("Access Restricted by User.", "warning");
      } else {
        // 'default' state: user closed prompt without choosing
        showToast("Permission dismissed. Please click Grant Access again.", "info");
      }
    } catch (err) {
      console.error("Notification Request Failure:", err);
      showToast("System handshake failed. Try refreshing the page.", "error");
    }
  };

  const refreshGeolocation = useCallback(async () => {
    setIsRefreshingGps(true);
    try {
      const pos = await getCurrentPosition();
      setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (err) { 
      console.debug("GPS Restriction"); 
      showToast("Location Restricted. Verify GPS permissions.", "info");
    } finally {
      setIsRefreshingGps(false);
    }
  }, [showToast]);

  useEffect(() => {
    refreshGeolocation();
    const interval = setInterval(refreshGeolocation, 15000);
    return () => clearInterval(interval);
  }, [refreshGeolocation]);

  useEffect(() => {
    const generateBriefing = async () => {
      setBriefingLoading(true);
      try {
        const todayAttendance = attendance.filter(a => a.date === today).length;
        const activeSubstitutions = substitutions.filter(s => s.date === today && !s.isArchived).length;
        
        const myTodaySubs = substitutions.filter(s => s.date === today && s.substituteTeacherId === user.id && !s.isArchived);
        const subDetails = myTodaySubs.length > 0 
          ? myTodaySubs.map(s => `${s.className} (Period ${s.slotId})`).join(', ') 
          : "no proxy duties";

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Morning update for ${user.name} at Ibn Al Hytham Islamic School. 
          Today's Global Stats: ${todayAttendance} staff present, ${activeSubstitutions} total proxy slots requested.
          User Specifics: You have ${myTodaySubs.length} substitutions today: ${subDetails}.
          Instruction: Greet the teacher professionally, mention their specific proxy duties for the day if any, and provide an encouraging academic closing. Keep it under 45 words.`,
        });

        setBriefing(response.text || "Protocols active. System readiness at 100%.");
      } catch (err) {
        const myTodaySubsCount = substitutions.filter(s => s.date === today && s.substituteTeacherId === user.id && !s.isArchived).length;
        const subStatus = myTodaySubsCount > 0 ? `You have ${myTodaySubsCount} substitution(s) scheduled.` : "No proxy duties assigned today.";
        setBriefing(`Assalamu Alaikum, ${user.name.split(' ')[0]}. ${subStatus} Focus on academic excellence today. Campus systems operational.`);
      } finally {
        setBriefingLoading(false);
      }
    };
    generateBriefing();
  }, [user.name, attendance.length, substitutions, user.id, today]);

  const todayRecord = useMemo(() => 
    attendance.find(r => r.userId === user.id && r.date === today),
    [attendance, user.id, today]
  );

  const isMedicalAbsence = todayRecord?.checkIn === 'MEDICAL';

  const currentDistance = useMemo(() => {
    if (!userCoords) return null;
    return calculateDistance(userCoords.lat, userCoords.lng, TARGET_LAT, TARGET_LNG);
  }, [userCoords]);

  const isOutOfRange = currentDistance !== null && currentDistance > RADIUS_METERS;
  
  const signalQuality = useMemo(() => {
    if (!userCoords) return 'CALIBRATING';
    if (userCoords.accuracy < 12) return 'PRECISION';
    if (userCoords.accuracy < 35) return 'GOOD';
    return 'WEAK';
  }, [userCoords]);

  const rotateInstitutionalOTP = () => {
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setOTP(newOtp);
    showToast("Security Key Rotated", "success");
  };

  const handleMedicalAbsence = async () => {
    if (otpInput !== currentOTP) {
      showToast("Invalid Authorization OTP", "error");
      return;
    }

    setLoading(true);
    try {
      const isCloudActive = IS_CLOUD_ENABLED;
      if (isCloudActive) {
        const { data, error } = await supabase.from('attendance').insert({ 
          user_id: user.id, date: today, check_in: 'MEDICAL', check_out: 'MEDICAL', is_manual: true, is_late: false, reason: 'Medical Registry'
        }).select().single();
        if (error) throw error;
        setAttendance(prev => [{ id: data.id, userId: user.id, userName: user.name, date: today, checkIn: 'MEDICAL', checkOut: 'MEDICAL', isManual: true, isLate: false, reason: 'Medical Registry' }, ...prev]);
      } else {
         const localId = `local-${Date.now()}`;
         setAttendance(prev => [{ id: localId, userId: user.id, userName: user.name, date: today, checkIn: 'MEDICAL', checkOut: 'MEDICAL', isManual: true, isLate: false, reason: 'Medical Registry' }, ...prev]);
      }
      showToast("Medical Absence Authorized", "success");
      setIsMedicalModalOpen(false);
      setOtpInput('');
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (isManual: boolean = false) => {
    if (isManual && otpInput !== currentOTP) {
      showToast("Invalid Institutional OTP", "error");
      return;
    }

    setLoading(true);
    try {
      let location = undefined;
      if (!isManual) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, TARGET_LAT, TARGET_LNG);
        if (dist > RADIUS_METERS) throw new Error(`Gateway Restricted: ${Math.round(dist)}m from School Core`);
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }

      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      const isCloudActive = IS_CLOUD_ENABLED;

      if (!todayRecord) {
        const isLate = now.getHours() > LATE_THRESHOLD_HOUR || (now.getHours() === LATE_THRESHOLD_HOUR && now.getMinutes() > LATE_THRESHOLD_MINUTE);
        if (isCloudActive) {
          const { data, error } = await supabase.from('attendance').insert({ 
            user_id: user.id, date: today, check_in: time, is_manual: isManual, is_late: isLate, location 
          }).select().single();
          if (error) throw error;
          setAttendance(prev => [{ id: data.id, userId: user.id, userName: user.name, date: today, checkIn: time, isManual, isLate, location }, ...prev]);
        } else {
           const localId = `local-att-${Date.now()}`;
           setAttendance(prev => [{ id: localId, userId: user.id, userName: user.name, date: today, checkIn: time, isManual, isLate, location }, ...prev]);
        }
        showToast("Check-In Authorized", "success");
      } else {
        if (isCloudActive) {
          const { error } = await supabase.from('attendance').update({ check_out: time }).match({ user_id: user.id, date: today });
          if (error) throw error;
        }
        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: time } : r));
        showToast("Check-Out Successful", "success");
      }
      setIsManualModalOpen(false);
      setOtpInput('');
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 pb-20">
      {/* Notification Access Hub - Banner hides only when permission is granted */}
      {notifPermission !== 'granted' && (
        <div className="bg-[#001f3f] p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between border border-amber-400/20 gap-4 animate-in slide-in-from-top-4 duration-500">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-400 text-[#001f3f] rounded-full flex items-center justify-center font-black">!</div>
              <div className="text-center sm:text-left">
                 <p className="text-[10px] font-black text-white uppercase tracking-widest leading-none">Enable Duty Matrix Alerts</p>
                 <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Receive system notifications when assigned a substitution duty.</p>
              </div>
           </div>
           <button 
             onClick={requestNotifPermission} 
             className="bg-amber-400 text-[#001f3f] px-6 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg hover:scale-105 active:scale-95 transition-all"
           >
             {notifPermission === 'denied' ? 'Settings Blocked' : 'Grant Access'}
           </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">Terminal Dashboard</h1>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none">Gateway Status Tracker</p>
        </div>
        <div className="bg-white/80 dark:bg-slate-900/80 px-6 py-3 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm text-right">
          <p className="text-xl font-black text-[#001f3f] dark:text-white font-mono tabular-nums leading-none">
            {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {/* ACTION HUB */}
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/5 relative overflow-hidden flex flex-col items-center text-center">
             <div className="w-56 h-56 relative mb-10">
                <div className={`absolute inset-0 rounded-full border-2 transition-all duration-1000 ${
                  signalQuality === 'PRECISION' ? 'border-emerald-400 opacity-40' : 
                  signalQuality === 'GOOD' ? 'border-amber-400 opacity-40' : 'border-red-400 opacity-20'
                } animate-pulse scale-110`}></div>
                <div className={`absolute inset-0 rounded-full border-4 transition-all duration-700 ${
                  isMedicalAbsence ? 'border-rose-400' : 
                  todayRecord?.checkOut ? 'border-emerald-400' : 
                  isOutOfRange ? 'border-amber-500' : 'border-sky-500'
                }`}></div>
                <div className={`w-40 h-40 mx-auto mt-8 rounded-[2.5rem] flex items-center justify-center transition-all transform shadow-2xl ${
                  isMedicalAbsence ? 'bg-rose-500' : todayRecord?.checkOut ? 'bg-emerald-500' : isOutOfRange ? 'bg-slate-100 dark:bg-slate-800' : 'bg-[#001f3f]'
                } text-white`}>
                   <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d={todayRecord?.checkOut ? "M5 13l4 4L19 7" : todayRecord ? "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" : "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013-3v1"}/></svg>
                </div>
             </div>
             <div className="space-y-4 w-full max-w-md relative z-10">
                <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                   {isMedicalAbsence ? 'Medical Leave Active' : todayRecord?.checkOut ? 'Duty Concluded' : todayRecord ? 'Campus Registry Active' : 'Registry Pending'}
                </h2>
                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-3xl border border-slate-100 dark:border-white/10">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gate entry</p>
                      <p className="text-lg font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkIn || '--:--'}</p>
                   </div>
                   <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-3xl border border-slate-100 dark:border-white/10">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gate exit</p>
                      <p className="text-lg font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkOut || '--:--'}</p>
                   </div>
                </div>
                {!todayRecord?.checkOut && !isMedicalAbsence && (
                  <button 
                    disabled={loading || (isOutOfRange && !isRefreshingGps)}
                    onClick={() => handleAction(false)}
                    className={`w-full py-7 rounded-3xl font-black text-xl shadow-xl transition-all transform active:scale-95 ${isOutOfRange ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-900'} uppercase tracking-widest border border-white/10`}
                  >
                    {loading ? 'Authorizing...' : todayRecord ? 'Mark Check-Out' : 'Mark Check-In'}
                  </button>
                )}
                <div className="flex gap-4 pt-4">
                  <button onClick={() => setIsManualModalOpen(true)} className="flex-1 text-[9px] font-black text-slate-400 uppercase py-3 border-2 border-slate-100 rounded-2xl hover:bg-slate-50">Admin Bypass</button>
                  {!todayRecord && <button onClick={() => setIsMedicalModalOpen(true)} className="flex-1 text-[9px] font-black text-rose-400 uppercase py-3 border-2 border-rose-50 rounded-2xl hover:bg-rose-50">Medical registry</button>}
                </div>
             </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-8">
           {isManagement && (
             <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border-2 border-[#d4af37]/30 dark:border-[#d4af37]/10 shadow-2xl space-y-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                  <svg className="w-20 h-20 text-[#d4af37]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13h-1v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#d4af37] uppercase tracking-[0.4em]">Institutional Auth</p>
                  <button onClick={rotateInstitutionalOTP} className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-[#d4af37] hover:rotate-180 transition-all duration-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
                <div className="text-center py-2">
                   <p className="text-4xl font-black text-[#001f3f] dark:text-white font-mono tracking-[0.3em]">{currentOTP}</p>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-4">Manual Stamping Protocol Key</p>
                </div>
             </div>
           )}

           <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-white/5 shadow-xl space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Geo-Telemetry</p>
                <button onClick={refreshGeolocation} disabled={isRefreshingGps} className={`p-2 rounded-xl bg-slate-50 transition-all ${isRefreshingGps ? 'animate-spin opacity-50' : 'hover:scale-110 active:rotate-180'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
              </div>
              <p className={`text-2xl font-black ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'} italic`}>{currentDistance ? `${Math.round(currentDistance)}m` : '--'}</p>
              <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                 <div className={`h-full transition-all duration-1000 ${signalQuality === 'PRECISION' ? 'bg-emerald-50 w-full' : signalQuality === 'GOOD' ? 'bg-amber-400 w-[60%]' : 'bg-red-50 w-[30%]'}`}></div>
              </div>
           </div>

           <div className="bg-gradient-to-br from-[#001f3f] to-slate-900 rounded-[3rem] p-8 text-white shadow-2xl relative overflow-hidden group">
              <div className="flex items-center gap-3 mb-6"><div className="w-2 h-2 rounded-full bg-[#d4af37] animate-ping"></div><h3 className="text-[#d4af37] text-xs font-black uppercase tracking-[0.3em]">Institutional Briefing</h3></div>
              {briefingLoading ? (
                 <div className="space-y-3"><div className="h-3 bg-white/10 rounded-full w-full"></div><div className="h-3 bg-white/10 rounded-full w-3/4"></div></div>
              ) : (
                 <p className="text-sm font-bold italic leading-relaxed text-slate-100">"{briefing}"</p>
              )}
           </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Registry Override</h4></div>
             <input type="text" inputMode="numeric" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl py-6 text-center text-4xl font-black tracking-[0.5em] outline-none dark:text-white focus:ring-4 ring-[#d4af37]/20" />
             <button onClick={() => handleAction(true)} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/10">Authorize Stamping</button>
             <button onClick={() => { setIsManualModalOpen(false); setOtpInput(''); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest">Discard Process</button>
          </div>
        </div>
      )}

      {isMedicalModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-xl font-black text-rose-500 dark:text-rose-400 uppercase italic tracking-tighter">Medical Authorization</h4></div>
             <p className="text-[10px] font-black text-slate-400 uppercase text-center tracking-widest leading-relaxed">Required: Enter institutional security code provided by Management.</p>
             <input type="text" inputMode="numeric" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl py-6 text-center text-4xl font-black tracking-[0.5em] outline-none dark:text-white focus:ring-4 ring-rose-500/20" />
             <button onClick={handleMedicalAbsence} className="w-full bg-rose-500 text-white py-6 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-rose-600 transition-all">Mark Medical Absence</button>
             <button onClick={() => { setIsMedicalModalOpen(false); setOtpInput(''); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest">Discard Process</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
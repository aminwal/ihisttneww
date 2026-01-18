import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_LOGO_BASE64 } from '../constants.ts';
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
  config: SchoolConfig;
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications, showToast, config }) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  const todayRecord = useMemo(() => attendance.find(r => r.userId === user.id && r.date === today), [attendance, user.id, today]);
  const userProxiesToday = useMemo(() => 
    substitutions.filter(s => s.substituteTeacherId === user.id && s.date === today && !s.isArchived),
    [substitutions, user.id, today]
  );

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const status = todayRecord ? (todayRecord.checkOut ? "Shift Completed" : "Currently On-Duty") : "Awaiting Check-In";
      const proxyMsg = userProxiesToday.length > 0 ? `You have ${userProxiesToday.length} substitution duties today.` : "No proxy duties assigned for today.";
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a summary for ${user.name}. Date: ${today}. Status: ${status}. Proxies: ${proxyMsg}.`,
        config: {
          systemInstruction: "You are a professional AI assistant for Ibn Al Hytham Islamic School (IHIS). Provide a concise, warm daily briefing under 45 words. Focus on productivity and excellence.",
          temperature: 1,
        }
      });

      setBriefing(response.text || "Welcome to your institutional dashboard. Have a productive day ahead!");
    } catch (err) {
      console.error("Briefing Error:", err);
      setBriefing("Intelligence module offline. Welcome back to the IHIS Matrix.");
    } finally {
      setBriefingLoading(false);
    }
  }, [user.name, today, todayRecord, userProxiesToday.length]);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  // Dynamic Geofence Logic
  const geoCenter = {
    lat: config?.latitude ?? TARGET_LAT,
    lng: config?.longitude ?? TARGET_LNG,
    radius: config?.radiusMeters ?? RADIUS_METERS
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshGeolocation = useCallback(async () => {
    setIsRefreshingGps(true);
    try {
      const pos = await getCurrentPosition();
      setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (err) { 
      showToast("GPS Access Restricted.", "warning");
    } finally {
      setIsRefreshingGps(false);
    }
  }, [showToast]);

  useEffect(() => {
    refreshGeolocation();
    const interval = setInterval(refreshGeolocation, 20000);
    return () => clearInterval(interval);
  }, [refreshGeolocation]);

  const currentDistance = useMemo(() => {
    if (!userCoords) return null;
    return calculateDistance(userCoords.lat, userCoords.lng, geoCenter.lat, geoCenter.lng);
  }, [userCoords, geoCenter]);

  const isOutOfRange = currentDistance !== null && currentDistance > geoCenter.radius;

  const handleAction = async (isManual: boolean = false) => {
    if (isManual && otpInput !== currentOTP) { showToast("Invalid OTP", "error"); return; }
    setLoading(true);
    try {
      let location = undefined;
      if (!isManual) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, geoCenter.lat, geoCenter.lng);
        if (dist > geoCenter.radius) throw new Error(`Gateway Blocked: You are ${Math.round(dist)}m from campus core.`);
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      const bahrainNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bahrain"}));
      const time = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      if (!todayRecord) {
        const isLate = bahrainNow.getHours() > LATE_THRESHOLD_HOUR || (bahrainNow.getHours() === LATE_THRESHOLD_HOUR && bahrainNow.getMinutes() > LATE_THRESHOLD_MINUTE);
        if (IS_CLOUD_ENABLED) {
          const { data, error } = await supabase.from('attendance').insert({ user_id: user.id, date: today, check_in: time, is_manual: isManual, is_late: isLate, location }).select().single();
          if (error) throw error;
          setAttendance(prev => [{ id: data.id, userId: user.id, userName: user.name, date: today, checkIn: time, isManual, isLate, location }, ...prev]);
        } else {
           setAttendance(prev => [{ id: `l-${Date.now()}`, userId: user.id, userName: user.name, date: today, checkIn: time, isManual, isLate, location }, ...prev]);
        }
        showToast("Check-In Authorized", "success");
      } else {
        if (IS_CLOUD_ENABLED) await supabase.from('attendance').update({ check_out: time }).match({ user_id: user.id, date: today });
        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: time } : r));
        showToast("Check-Out Authorized", "success");
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
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">Staff Gateway</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] ml-1">Institutional Deployment Status</p>
        </div>
        <div className="bg-white/80 dark:bg-slate-900/80 px-8 py-4 rounded-[2rem] border border-slate-100 dark:border-white/5 shadow-2xl">
          <p className="text-3xl font-black text-[#001f3f] dark:text-white font-mono tabular-nums leading-none tracking-tighter">
            {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bahrain' })}
          </p>
        </div>
      </div>

      {/* AI Briefing Box */}
      <div className="bg-gradient-to-r from-[#001f3f] to-[#002d5c] rounded-[2.5rem] p-8 md:p-10 shadow-2xl relative overflow-hidden border border-white/5">
         <div className="absolute top-0 right-0 p-8 opacity-10">
            <svg className="w-24 h-24 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
         </div>
         <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
            <div className="w-14 h-14 bg-amber-400 rounded-2xl flex items-center justify-center shadow-lg shrink-0 animate-pulse">
               <svg className="w-8 h-8 text-[#001f3f]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="flex-1 space-y-2 text-center md:text-left">
               <div className="flex items-center justify-center md:justify-start gap-2">
                  <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Intelligence Briefing</span>
                  <div className="w-1 h-1 rounded-full bg-white/30"></div>
                  <span className="text-[10px] font-bold text-white/50 uppercase">{today}</span>
               </div>
               {briefingLoading ? (
                 <div className="flex flex-col gap-2">
                    <div className="h-4 bg-white/10 rounded-full w-3/4 animate-pulse"></div>
                    <div className="h-4 bg-white/10 rounded-full w-1/2 animate-pulse"></div>
                 </div>
               ) : (
                 <p className="text-white text-lg md:text-xl font-medium leading-relaxed italic tracking-tight">{briefing}</p>
               )}
            </div>
            <button onClick={fetchBriefing} className="p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-all">
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8 space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className={`p-10 rounded-[3rem] shadow-2xl transition-all duration-500 border-4 flex flex-col items-center text-center space-y-6 relative overflow-hidden group ${todayRecord ? 'bg-slate-100/50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800' : 'bg-white dark:bg-slate-900 border-transparent shadow-sky-200/20'}`}>
              <div className={`w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-2xl transition-transform duration-700 group-hover:scale-110 ${todayRecord ? 'bg-slate-200 text-slate-400' : 'bg-[#001f3f] text-[#d4af37]'}`}>
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Check-In Gateway</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">Identity validation required for<br/>institutional access.</p>
              </div>
              <button 
                disabled={loading || !!todayRecord} 
                onClick={() => handleAction(false)}
                className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all transform active:scale-95 shadow-xl border-2 ${todayRecord ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] border-white/10 hover:bg-slate-950'}`}
              >
                {todayRecord ? 'GATEWAY SECURED' : loading ? 'AUTHORIZING...' : 'AUTHORIZE ENTRY'}
              </button>
            </div>

            <div className={`p-10 rounded-[3rem] shadow-2xl transition-all duration-500 border-4 flex flex-col items-center text-center space-y-6 relative overflow-hidden group ${(!todayRecord || todayRecord.checkOut) ? 'bg-slate-100/50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800' : 'bg-white dark:bg-slate-900 border-transparent shadow-sky-200/20'}`}>
              <div className={`w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-2xl transition-transform duration-700 group-hover:scale-110 ${(!todayRecord || todayRecord.checkOut) ? 'bg-slate-200 text-slate-400' : 'bg-[#d4af37] text-[#001f3f]'}`}>
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Exit Protocol</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">Conclude active session and<br/>de-authorize terminal access.</p>
              </div>
              <button 
                disabled={loading || !todayRecord || !!todayRecord.checkOut} 
                onClick={() => handleAction(false)}
                className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all transform active:scale-95 shadow-xl border-2 ${(!todayRecord || todayRecord.checkOut) ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' : 'bg-[#d4af37] text-[#001f3f] border-[#001f3f]/10 hover:bg-[#001f3f] hover:text-white'}`}
              >
                {todayRecord?.checkOut ? 'SESSION TERMINATED' : loading ? 'TERMINATING...' : 'TERMINATE SESSION'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-50 dark:border-white/5 relative overflow-hidden">
             <div className="flex items-center justify-between mb-10">
                <div className="space-y-1">
                   <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Security Matrix</h3>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Real-time Perimeter Integrity</p>
                </div>
                <button onClick={refreshGeolocation} disabled={isRefreshingGps} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-[#d4af37] transition-all">
                  <svg className={`w-5 h-5 ${isRefreshingGps ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="p-6 rounded-3xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 space-y-4">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Geotag</p>
                   {userCoords ? (
                     <div className="space-y-1">
                       <p className="text-sm font-black text-[#001f3f] dark:text-white font-mono">{userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}</p>
                       <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Accuracy: ±{Math.round(userCoords.accuracy)}m</p>
                     </div>
                   ) : <p className="text-xs font-bold text-rose-500 italic">Awaiting Satellite Lock...</p>}
                </div>

                <div className="p-6 rounded-3xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 space-y-4">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Vector Distance</p>
                   {currentDistance !== null ? (
                     <div className="space-y-1">
                       <p className={`text-xl font-black italic tracking-tighter ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>{Math.round(currentDistance)} Meters</p>
                       <p className="text-[8px] font-bold text-slate-400 uppercase">From Campus Central Hub</p>
                     </div>
                   ) : <p className="text-xs font-bold text-slate-300 italic">Calculating Vector...</p>}
                </div>

                <div className="p-6 rounded-3xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 space-y-4">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gateway Status</p>
                   <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full animate-pulse ${isOutOfRange ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`}></div>
                      <p className={`text-xs font-black uppercase tracking-widest ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {isOutOfRange ? 'Perimeter Breach' : 'Sector Secure'}
                      </p>
                   </div>
                </div>
             </div>
             
             {isOutOfRange && (
               <div className="mt-8 p-6 rounded-3xl bg-rose-500/10 border-2 border-rose-500/20 flex items-center gap-4 animate-bounce-subtle">
                  <svg className="w-6 h-6 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest leading-relaxed">Terminal lock engaged: You are outside the authorized institutional perimeter ({geoCenter.radius}m). Return to campus to proceed.</p>
               </div>
             )}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-10">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-50 dark:border-white/5 relative overflow-hidden">
            <div className="space-y-1 mb-10 text-center">
              <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Matrix Summary</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Registry Index</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-6 rounded-[2rem] bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-white/5">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registration Status</span>
                <span className={`text-[10px] font-black px-4 py-1.5 rounded-full border tracking-widest ${todayRecord ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                  {todayRecord ? (todayRecord.checkOut ? 'ARCHIVED' : 'ACTIVE') : 'PENDING'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-6 rounded-[2rem] bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-white/5 space-y-2 text-center">
                  <p className="text-[8px] font-black text-slate-400 uppercase">Gateway Entry</p>
                  <p className="text-lg font-black text-[#001f3f] dark:text-white">{todayRecord?.checkIn || '--:--'}</p>
                </div>
                <div className="p-6 rounded-[2rem] bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-white/5 space-y-2 text-center">
                  <p className="text-[8px] font-black text-slate-400 uppercase">Gateway Exit</p>
                  <p className="text-lg font-black text-[#001f3f] dark:text-white">{todayRecord?.checkOut || '--:--'}</p>
                </div>
              </div>
              {todayRecord?.isLate && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest italic">Variance Detected: Late Entry Registry</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700">
                <svg className="w-20 h-20 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
             </div>
             <div className="relative z-10 space-y-6">
                <div className="space-y-1">
                   <h3 className="text-xl font-black text-[#d4af37] uppercase italic tracking-tighter">Emergency Protocol</h3>
                   <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Manual Infrastructure Override</p>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed font-medium">Internal biometric or geolocation synchronization failure? Initiate manual gateway protocol using the authorized institutional override key.</p>
                <button 
                  onClick={() => setIsManualModalOpen(true)}
                  className="w-full bg-[#d4af37] hover:bg-white text-[#001f3f] py-5 rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 border-2 border-white/10"
                >
                  Initiate Override
                </button>
             </div>
          </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Override</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Institutional Authentication Hub</p>
              </div>
              <div className="space-y-6 text-center">
                 <p className="text-[11px] text-slate-500 leading-relaxed font-medium">Contact administration to receive the daily <span className="text-[#d4af37] font-black">Institutional Access Key</span> to bypass geolocation filters.</p>
                 <div className="space-y-2">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Access Key (OTP)</label>
                   <input 
                    type="text" 
                    placeholder="••••••" 
                    maxLength={6}
                    value={otpInput}
                    onChange={e => setOtpInput(e.target.value)}
                    className="w-full text-center text-3xl font-black tracking-[0.5em] py-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border-2 border-transparent focus:border-[#d4af37] transition-all outline-none dark:text-white"
                   />
                 </div>
              </div>
              <div className="flex flex-col gap-4">
                <button 
                  onClick={() => handleAction(true)}
                  disabled={loading || otpInput.length < 4}
                  className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all disabled:opacity-30 active:scale-95"
                >
                  {loading ? 'SYNCING...' : 'AUTHORIZE OVERRIDE'}
                </button>
                <button onClick={() => setIsManualModalOpen(false)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors">Abort Protocol</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
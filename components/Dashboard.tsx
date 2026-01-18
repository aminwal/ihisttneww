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

  // Dynamic Geofence Logic - Fixed with safety fallback
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

  const todayRecord = useMemo(() => attendance.find(r => r.userId === user.id && r.date === today), [attendance, user.id, today]);
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-slate-900 rounded-[4rem] p-12 shadow-[0_40px_100px_-20px_rgba(0,31,63,0.15)] border border-slate-100 dark:border-white/5 relative overflow-hidden flex flex-col items-center">
             {/* Dynamic Radar Visualization */}
             <div className="relative w-64 h-64 mb-12">
                <div className={`absolute inset-0 rounded-full border-4 border-dashed animate-[spin_15s_linear_infinite] opacity-10 ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}></div>
                <div className={`absolute inset-0 rounded-full border-2 animate-ping opacity-20 ${isOutOfRange ? 'bg-rose-400' : 'bg-emerald-400'}`}></div>
                <div className={`absolute inset-4 rounded-full border-4 transition-all duration-1000 ${isOutOfRange ? 'border-rose-100 dark:border-rose-900/30' : 'border-emerald-100 dark:border-emerald-900/30'}`}></div>
                <div className={`absolute inset-8 rounded-[3rem] flex items-center justify-center transition-all duration-700 shadow-2xl ${
                  todayRecord?.checkOut ? 'bg-sky-600' : todayRecord ? 'bg-emerald-500' : isOutOfRange ? 'bg-[#001f3f]' : 'bg-[#001f3f]'
                } text-white`}>
                   <img src={SCHOOL_LOGO_BASE64} alt="IHIS" className="w-24 h-24 object-contain opacity-90 drop-shadow-lg" />
                </div>
             </div>

             <div className="text-center space-y-6 w-full max-w-sm">
                <div className="space-y-1">
                   <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                      {todayRecord?.checkOut ? 'Duty Concluded' : todayRecord ? 'Deployment Active' : 'Pending Registry'}
                   </h2>
                   <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500 animate-pulse'}`}>
                      {isOutOfRange ? 'Perimeter Restricted' : 'Institutional Safe Zone Locked'}
                   </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-white/10">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gate Entry</p>
                      <p className="text-xl font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkIn || '--:--'}</p>
                   </div>
                   <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-white/10">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gate Exit</p>
                      <p className="text-xl font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkOut || '--:--'}</p>
                   </div>
                </div>

                {!todayRecord?.checkOut && (
                  <button 
                    disabled={loading || (isOutOfRange && !isRefreshingGps)}
                    onClick={() => handleAction(false)}
                    className={`w-full py-8 rounded-[2.5rem] font-black text-xl shadow-2xl transition-all active:scale-95 border-4 ${
                      isOutOfRange ? 'bg-slate-100 text-slate-300 border-transparent cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] border-[#d4af37]/20 hover:bg-slate-950'
                    } uppercase tracking-[0.2em]`}
                  >
                    {loading ? 'Authorizing...' : todayRecord ? 'Confirm Check-Out' : 'Confirm Check-In'}
                  </button>
                )}
                
                <button onClick={() => setIsManualModalOpen(true)} className="text-[10px] font-black text-slate-400 uppercase hover:text-[#d4af37] transition-colors tracking-widest">
                   Institutional Registry Bypass
                </button>
             </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-10">
           {isManagement && (
             <div className="bg-[#d4af37] p-8 rounded-[3rem] shadow-2xl space-y-6 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                <div className="flex items-center justify-between relative z-10">
                  <p className="text-[10px] font-black text-[#001f3f] uppercase tracking-[0.4em]">Auth Protocol</p>
                  <div className="w-2 h-2 rounded-full bg-[#001f3f] animate-ping"></div>
                </div>
                <div className="text-center py-2 relative z-10">
                   <p className="text-5xl font-black text-[#001f3f] font-mono tracking-[0.2em]">{currentOTP}</p>
                   <p className="text-[9px] font-black text-[#001f3f]/60 uppercase tracking-widest mt-4">Active Manual Gateway Key</p>
                </div>
             </div>
           )}

           <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-white/5 shadow-xl space-y-8">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Geo-Telemetry</p>
                <div className={`w-3 h-3 rounded-full ${isRefreshingGps ? 'bg-[#d4af37] animate-pulse' : isOutOfRange ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
              </div>
              <div className="flex items-baseline gap-2">
                 <p className={`text-4xl font-black italic ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>{currentDistance ? `${Math.round(currentDistance)}m` : 'Scanning...'}</p>
                 <span className="text-[10px] font-black text-slate-300 uppercase">to core</span>
              </div>
              <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
                 <div 
                   style={{ width: `${Math.max(10, Math.min(100, 100 - (currentDistance || 0) / 2))}%` }} 
                   className={`h-full transition-all duration-1000 ${isOutOfRange ? 'bg-rose-400' : 'bg-emerald-50'}`}
                 ></div>
              </div>
           </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-12 shadow-2xl space-y-10 animate-in zoom-in duration-300">
             <div className="text-center"><h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Registry Override</h4></div>
             <input type="text" inputMode="numeric" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-3xl py-8 text-center text-5xl font-black tracking-[0.3em] outline-none dark:text-white focus:ring-4 ring-[#d4af37]/20" />
             <button onClick={() => handleAction(true)} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/10">Stamp Registry</button>
             <button onClick={() => { setIsManualModalOpen(false); setOtpInput(''); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
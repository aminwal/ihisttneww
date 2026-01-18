import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

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
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId === user.id && r.date === today), [attendance, user.id, today]);
  
  // Detailed list of proxies for the logged-in user today
  const userProxiesToday = useMemo(() => 
    substitutions.filter(s => s.substituteTeacherId === user.id && s.date === today && !s.isArchived),
    [substitutions, user.id, today]
  );

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
      console.warn("Geolocation Access Failed:", err);
      showToast("GPS Access Denied. Check browser permissions.", "warning");
    } finally {
      setIsRefreshingGps(false);
    }
  }, [showToast]);

  useEffect(() => {
    refreshGeolocation();
    const interval = setInterval(refreshGeolocation, 30000);
    return () => clearInterval(interval);
  }, [refreshGeolocation]);

  const currentDistance = useMemo(() => {
    if (!userCoords) return null;
    return calculateDistance(userCoords.lat, userCoords.lng, geoCenter.lat, geoCenter.lng);
  }, [userCoords, geoCenter]);

  const isOutOfRange = currentDistance !== null && currentDistance > geoCenter.radius;

  const handleAction = async (isManual: boolean = false, isMedical: boolean = false) => {
    if ((isManual || isMedical) && otpInput !== currentOTP) { 
      showToast("Invalid Security Key", "error"); 
      return; 
    }
    setLoading(true);
    try {
      let location = undefined;
      if (!isManual && !isMedical) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, geoCenter.lat, geoCenter.lng);
        if (dist > geoCenter.radius) {
          throw new Error(`Gateway Error: Proximity mismatch (${Math.round(dist)}m). Please be on campus.`);
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
          reason: isMedical ? 'Medical Leave' : (isManual ? 'Manual Registry' : 'Standard Geotag')
        };

        if (IS_CLOUD_ENABLED) {
          const { data, error } = await supabase.from('attendance').insert(payload).select().single();
          if (error) throw error;
          setAttendance(prev => [{ 
            id: data.id, 
            userId: user.id, 
            userName: user.name, 
            date: today, 
            checkIn: timeString, 
            checkOut: isMedical ? 'ABSENT' : undefined,
            // Fix: Corrected typo 'iManual' to 'isManual'
            isManual: isManual || isMedical, 
            isLate, 
            location,
            reason: payload.reason
          }, ...prev]);
        } else {
           setAttendance(prev => [{ 
             id: `loc-${Date.now()}`, 
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
        }
        showToast(isMedical ? "Medical Absence Registered" : "Check-In Success", "success");
      } else {
        if (isMedical || todayRecord.checkIn === 'MEDICAL') { 
          showToast("Status already locked for today.", "warning"); 
          setLoading(false); 
          return; 
        }
        const timeOut = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        
        if (IS_CLOUD_ENABLED) {
          await supabase.from('attendance').update({ check_out: timeOut }).match({ user_id: user.id, date: today });
        }
        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: timeOut } : r));
        showToast("Check-Out Successful", "success");
      }
      setIsManualModalOpen(false);
      setPendingAction(null);
      setOtpInput('');
    } catch (err: any) {
      showToast(err.message || "Registry Failure", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700">
      {/* Header System */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-4">
        <div className="text-center md:text-left space-y-2">
          <h2 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Registry <span className="text-[#d4af37]">Terminal</span>
          </h2>
          <p className="text-xs font-black text-slate-400 uppercase tracking-[0.4em]">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 px-8 py-5 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 text-center min-w-[200px]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Standard Time (GMT+3)</p>
          <p className="text-3xl font-black text-[#001f3f] dark:text-white tracking-tighter italic">
            {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Verification Status Card */}
        <div className="md:col-span-2 bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700">
             <img src={SCHOOL_LOGO_BASE64} alt="" className="w-48 h-48 object-contain grayscale invert" />
           </div>
           
           <div className="relative z-10 space-y-8">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full animate-pulse ${isRefreshingGps ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.4em]">Geotag Verification System</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
                <div className="space-y-2">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Campus Proximity</p>
                   <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black text-white italic tracking-tighter">
                        {currentDistance !== null ? Math.round(currentDistance) : '--'}
                      </span>
                      <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Meters</span>
                   </div>
                </div>

                <div className="space-y-2">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status Matrix</p>
                   <div className={`text-sm font-black uppercase tracking-[0.2em] px-4 py-2 rounded-xl border flex items-center gap-3 ${isOutOfRange ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                      <div className={`w-2 h-2 rounded-full ${isOutOfRange ? 'bg-rose-500' : 'bg-emerald-50'}`}></div>
                      {isOutOfRange ? 'Gateway Restricted' : 'Access Authorized'}
                   </div>
                </div>
              </div>

              <div className="pt-10 flex flex-col sm:flex-row gap-4">
                <button 
                  disabled={loading || isOutOfRange || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'}
                  onClick={() => handleAction()}
                  className={`flex-1 py-6 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${
                    todayRecord 
                    ? 'bg-amber-500 text-[#001f3f] hover:bg-amber-400' 
                    : 'bg-[#d4af37] text-[#001f3f] hover:bg-white disabled:bg-slate-700 disabled:text-slate-500'
                  }`}
                >
                  {loading ? 'Processing...' : (todayRecord ? 'Authorize Check-Out' : 'Authorize Check-In')}
                </button>
                
                <button 
                  onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }}
                  className="px-8 py-6 rounded-3xl bg-white/5 text-white/60 hover:bg-white/10 border border-white/10 font-black text-[10px] uppercase tracking-widest transition-all"
                >
                  Override
                </button>
              </div>

              {/* Guiding Message for Teachers */}
              <div className="pt-4 border-t border-white/5 text-center sm:text-left">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] italic">
                  Visit Head Teacher's office for correct geo-location mapping.
                </p>
              </div>
           </div>
        </div>

        {/* Secondary Info Stack */}
        <div className="space-y-8">
           {/* Current Record Summary */}
           <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-4">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Session</h4>
                 <div className={`w-2 h-2 rounded-full shadow-lg ${todayRecord ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-slate-200'}`}></div>
              </div>
              
              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Entry Timestamp</span>
                    <span className={`text-xs font-black italic ${todayRecord?.checkIn === 'MEDICAL' ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>
                      {todayRecord?.checkIn || '--:--'}
                    </span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Exit Timestamp</span>
                    <span className="text-xs font-black text-amber-600 italic">
                      {todayRecord?.checkIn === 'MEDICAL' ? 'N/A (EXCUSED)' : (todayRecord?.checkOut || 'Active')}
                    </span>
                 </div>
              </div>
           </div>

           {/* PROXY DUTY ALERT BOX - New Feature */}
           {userProxiesToday.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-[2.5rem] p-8 border-2 border-amber-200 dark:border-amber-900/40 space-y-5 animate-in slide-in-from-right duration-500">
                <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-900 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
                    <h4 className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-[0.2em]">Proxy Duty Alert</h4>
                  </div>
                  <span className="bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-[8px] font-black px-2 py-0.5 rounded-full">{userProxiesToday.length} Assignments</span>
                </div>
                
                <div className="space-y-3">
                  {userProxiesToday.map(proxy => (
                    <div key={proxy.id} className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-100 dark:border-amber-800 shadow-sm group hover:scale-[1.02] transition-transform">
                       <div className="flex justify-between items-start">
                          <div className="space-y-0.5">
                             <p className="text-[12px] font-black text-[#001f3f] dark:text-white uppercase leading-none">Period {proxy.slotId}</p>
                             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Division: {proxy.className}</p>
                          </div>
                          <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30">
                            <svg className="w-3 h-3 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          </div>
                       </div>
                       <div className="mt-3 pt-2 border-t border-slate-50 dark:border-slate-800">
                          <p className="text-[9px] font-black text-amber-600 dark:text-amber-500 uppercase italic">Subject: {proxy.subject}</p>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
           )}

           {/* Health and Safety / Medical Option */}
           <div className="bg-rose-50 dark:bg-rose-950/20 rounded-[2.5rem] p-8 border-2 border-dashed border-rose-100 dark:border-rose-900/40 text-center space-y-4">
              <p className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em]">Medical Registry</p>
              <p className="text-[11px] text-rose-400 font-medium leading-relaxed italic">Facing health difficulties today? Register an official absence for the administration ledger.</p>
              <button 
                onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }}
                disabled={loading || !!todayRecord}
                className="w-full py-4 rounded-2xl bg-white dark:bg-slate-900 text-rose-500 font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-rose-500 hover:text-white transition-all disabled:opacity-30"
              >
                {todayRecord?.checkIn === 'MEDICAL' ? 'Leave Registered' : 'File Medical Absence'}
              </button>
           </div>
        </div>
      </div>

      {/* Manual Override Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                  {pendingAction === 'MEDICAL' ? 'Medical Authorization' : 'Security Bypass'}
                </h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Enter Institutional Key</p>
             </div>
             
             <input 
               type="text" 
               placeholder="6-Digit Auth Code"
               maxLength={6}
               value={otpInput}
               onChange={e => setOtpInput(e.target.value)}
               className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-8 py-5 text-center text-3xl font-black tracking-[0.5em] dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
             />

             <button 
               onClick={() => handleAction(pendingAction === 'OVERRIDE', pendingAction === 'MEDICAL')}
               disabled={loading}
               className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/10 active:scale-95"
             >
               {pendingAction === 'MEDICAL' ? 'Confirm Medical Leave' : 'Confirm Manual Registry'}
             </button>
             
             <button 
               onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }}
               className="text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-slate-600 transition-colors w-full"
             >
               Discard Attempt
             </button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

import React, { useState, useMemo, useEffect } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, EDUCATIONAL_QUOTES } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface DashboardProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  substitutions?: SubstitutionRecord[];
  currentOTP: string;
  setOTP: (otp: string) => void;
  notifications: SchoolNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());
  
  // State for "today" to handle midnight transitions without manual refresh
  const [today, setToday] = useState(new Date().toISOString().split('T')[0]);

  // Update "today" string every minute to handle date change at midnight
  useEffect(() => {
    const timer = setInterval(() => {
      const current = new Date().toISOString().split('T')[0];
      if (current !== today) {
        setToday(current);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [today]);

  const todayRecord = useMemo(() => 
    attendance.find(r => r.userId === user.id && r.date === today),
    [attendance, user.id, today]
  );

  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  const currentDistance = useMemo(() => {
    if (!userCoords) return null;
    return calculateDistance(userCoords.lat, userCoords.lng, TARGET_LAT, TARGET_LNG);
  }, [userCoords]);

  const isOutOfRange = currentDistance !== null && currentDistance > RADIUS_METERS;

  useEffect(() => {
    const fetchLocation = async () => {
      try {
        const pos = await getCurrentPosition();
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (err) {
        console.debug("Location fetch restricted.");
      }
    };
    fetchLocation();
    const interval = setInterval(fetchLocation, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (isManual: boolean = false) => {
    if (isManual && otpInput !== currentOTP) {
      setError("Authorization Failed: Invalid OTP code.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let location = undefined;
      
      if (!isManual) {
        const pos = await getCurrentPosition();
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, TARGET_LAT, TARGET_LNG);
        if (dist > RADIUS_METERS) {
          throw new Error(`Location Restricted: You are ${Math.round(dist)}m away from campus.`);
        }
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }

      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

      if (!todayRecord) {
        const isLate = now.getHours() > LATE_THRESHOLD_HOUR || (now.getHours() === LATE_THRESHOLD_HOUR && now.getMinutes() > LATE_THRESHOLD_MINUTE);
        
        if (isCloudActive) {
          const { data, error: insertError } = await supabase.from('attendance').insert({ 
            user_id: user.id, 
            date: today, 
            check_in: time, 
            is_manual: isManual, 
            is_late: isLate, 
            location: location 
          }).select().single();
          
          if (insertError) throw new Error(`Cloud Persistence Failed: ${insertError.message}`);
          
          const newRecord: AttendanceRecord = { 
            id: data.id, 
            userId: user.id, 
            userName: user.name, 
            date: today, 
            checkIn: time, 
            isManual, 
            isLate, 
            location 
          };
          setAttendance(prev => [newRecord, ...prev]);
        } else {
          const newRecord: AttendanceRecord = { id: generateUUID(), userId: user.id, userName: user.name, date: today, checkIn: time, isManual, isLate, location };
          setAttendance(prev => [newRecord, ...prev]);
        }
        setLastSyncTime(new Date().toLocaleTimeString());
        setIsManualModalOpen(false);
        setOtpInput('');
      } else if (!todayRecord.checkOut) {
        if (isCloudActive) {
          const { error: updateError } = await supabase.from('attendance').update({ 
            check_out: time, 
            is_manual: todayRecord.isManual || isManual 
          }).match({ user_id: user.id, date: today });
          
          if (updateError) throw new Error(`Cloud Update Failed: ${updateError.message}`);
        }
        setAttendance(prev => prev.map(r => r.id === todayRecord.id ? { ...r, checkOut: time, isManual: r.isManual || isManual } : r));
        setLastSyncTime(new Date().toLocaleTimeString());
        setIsManualModalOpen(false);
        setOtpInput('');
      }
    } catch (err: any) {
      setError(err.message || "Institutional Framework Error: Failed to mark attendance.");
    } finally {
      setLoading(false);
    }
  };

  const regenerateOTP = () => setOTP(Math.floor(100000 + Math.random() * 900000).toString());

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase">Dashboard, {user.name}</h1>
          <p className="text-[8px] md:text-[10px] font-black text-[#001f3f]/60 dark:text-white/60 uppercase tracking-[0.3em]">
            Institutional Verification Center • {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <div className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-10 rounded-[1.5rem] md:rounded-[2rem] border border-slate-200 dark:border-white/10 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-xl">
            {isOutOfRange && !todayRecord?.checkOut && (
              <div className="absolute top-0 left-0 right-0 bg-red-500 text-white py-3 px-4 flex items-center justify-center space-x-3 z-20">
                <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">Out of Campus Range ({Math.round(currentDistance || 0)}m)</span>
              </div>
            )}
            
            <div className="z-10 w-full max-w-sm space-y-6">
              <div className={`mx-auto w-16 h-16 rounded-3xl flex items-center justify-center shadow-lg transition-all transform ${todayRecord?.checkOut ? 'bg-emerald-100 dark:bg-emerald-900/20' : todayRecord ? 'bg-sky-100 dark:bg-sky-100/10' : 'bg-slate-100 dark:bg-white/5'}`}>
                 <svg className={`w-8 h-8 ${todayRecord?.checkOut ? 'text-emerald-600' : 'text-[#001f3f] dark:text-white'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={todayRecord?.checkOut ? "M5 13l4 4L19 7" : "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"} />
                 </svg>
              </div>

              {todayRecord?.checkOut ? (
                <div className="py-4 animate-in zoom-in duration-500">
                  <h3 className="text-2xl font-black text-emerald-600 uppercase italic">Duty Completed</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Shift Logged for {today}</p>
                  <div className="mt-6 flex items-center justify-center space-x-2 text-[9px] font-black text-slate-300 uppercase tracking-widest">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                    <span>Cloud Persistence Verified</span>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <h2 className="text-slate-500 dark:text-slate-300 font-black text-[10px] uppercase tracking-[0.4em] mb-2">Shift Status</h2>
                  <p className="text-2xl font-black text-[#001f3f] dark:text-white uppercase">
                    {todayRecord ? 'Currently On Duty' : 'Ready to Start'}
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-sky-600/5 p-4 rounded-2xl border border-sky-600/10">
                  <p className="text-[7px] text-sky-600 font-black uppercase">ENTRY</p>
                  <p className="text-xl font-black">{todayRecord?.checkIn || '--:--'}</p>
                </div>
                <div className="bg-amber-600/5 p-4 rounded-2xl border border-amber-600/10">
                  <p className="text-[7px] text-amber-600 font-black uppercase">EXIT</p>
                  <p className="text-xl font-black">{todayRecord?.checkOut || '--:--'}</p>
                </div>
              </div>

              {!todayRecord?.checkOut && (
                <div className="space-y-3">
                  <button 
                    disabled={loading || isOutOfRange} 
                    onClick={() => handleAction(false)} 
                    className={`w-full py-5 rounded-2xl text-white font-black text-lg shadow-xl transition-all transform active:scale-95 flex items-center justify-center space-x-3 ${loading ? 'opacity-50' : ''} ${isOutOfRange ? 'bg-slate-300' : todayRecord ? 'bg-amber-600' : 'bg-sky-600'}`}
                  >
                    {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                    <span>{todayRecord ? 'GEO CHECK-OUT' : 'GEO CHECK-IN'}</span>
                  </button>
                  <button 
                    onClick={() => setIsManualModalOpen(true)} 
                    className="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-slate-200 dark:border-white/10 dark:text-white"
                  >
                    Manual Override
                  </button>
                </div>
              )}
              
              <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">
                  Last Database Sync: {lastSyncTime}
                </p>
              </div>

              {error && <p className="text-red-500 text-[10px] font-black uppercase bg-red-50 p-2 rounded-lg">{error}</p>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {isManagement && (
            <div className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl p-6 rounded-[2rem] border-2 border-amber-400">
              <h4 className="text-lg font-black text-[#001f3f] dark:text-white italic mb-4 uppercase">Security OTP</h4>
              <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-4 rounded-xl shadow-inner">
                <span className="text-2xl font-black text-amber-600 tracking-widest">{currentOTP}</span>
                <button onClick={regenerateOTP} className="p-2 text-amber-600 hover:rotate-180 transition-all duration-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
              </div>
              <p className="text-[7px] font-bold text-amber-600/50 uppercase tracking-widest mt-4 text-center">Share with faculty for manual overrides</p>
            </div>
          )}
          
          <div className="bg-white/40 dark:bg-white/5 backdrop-blur-md p-6 rounded-[2rem] border border-slate-200 dark:border-white/10">
            <h4 className="font-black text-[8px] uppercase tracking-[0.3em] mb-4 text-sky-600">Geo-Verification</h4>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-[8px] font-bold text-slate-400 uppercase">Latitude</span><span className="font-mono text-xs font-bold">{userCoords ? userCoords.lat.toFixed(6) : 'Locating...'}</span></div>
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-[8px] font-bold text-slate-400 uppercase">Longitude</span><span className="font-mono text-xs font-bold">{userCoords ? userCoords.lng.toFixed(6) : 'Locating...'}</span></div>
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-[8px] font-bold text-slate-400 uppercase">Distance</span><span className="font-mono text-xs font-bold">{currentDistance ? `${Math.round(currentDistance)}m` : 'Calculating...'}</span></div>
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-[8px] font-bold text-slate-400 uppercase">Status</span><span className={`text-[10px] font-black uppercase ${isOutOfRange ? 'text-red-500' : 'text-emerald-500'}`}>{isOutOfRange ? 'Out of Radius' : 'Within Range'}</span></div>
            </div>
          </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2rem] p-10 shadow-2xl space-y-8">
             <div className="text-center"><h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Manual Authorization</h4></div>
             <div className="space-y-4">
                <input type="text" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-100 border-2 rounded-2xl py-5 text-center text-2xl font-black tracking-[0.5em] outline-none focus:border-amber-400 transition-all" />
                <button onClick={() => handleAction(true)} disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl">Validate & Commit</button>
                <button onClick={() => setIsManualModalOpen(false)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

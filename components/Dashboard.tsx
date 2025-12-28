
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
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // State for "today" to handle midnight transitions
  const [today, setToday] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      const current = now.toISOString().split('T')[0];
      if (current !== today) setToday(current);
    }, 1000);
    return () => clearInterval(timer);
  }, [today]);

  const todayRecord = useMemo(() => 
    attendance.find(r => r.userId === user.id && r.date === today),
    [attendance, user.id, today]
  );

  const last7Days = useMemo(() => {
    const records = [];
    for(let i=6; i>=0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().split('T')[0];
      const rec = attendance.find(r => r.userId === user.id && r.date === dStr);
      records.push({ date: dStr, present: !!rec });
    }
    return records;
  }, [attendance, user.id]);

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
        setUserCoords({ 
          lat: pos.coords.latitude, 
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      } catch (err) {
        console.debug("Location fetch restricted.");
      }
    };
    fetchLocation();
    const interval = setInterval(fetchLocation, 5000);
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
      {/* Dynamic Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase">Institutional Portal</h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] leading-none">Security Clearance: {user.role.replace(/_/g, ' ')}</p>
        </div>
        <div className="text-right hidden md:block">
          <p className="text-2xl font-black text-[#001f3f] dark:text-white font-mono tabular-nums leading-none">
            {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mt-1">Institutional Time (GMT+3)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Attendance Hub */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 via-amber-500 to-sky-500"></div>
            
            <div className="p-8 md:p-12 flex flex-col items-center">
              {/* Proximity Radar UI */}
              <div className="relative mb-10 w-48 h-48 flex items-center justify-center">
                {/* Radar Rings */}
                <div className="absolute inset-0 rounded-full border border-slate-100 dark:border-white/5 animate-ping opacity-20"></div>
                <div className="absolute inset-4 rounded-full border border-slate-100 dark:border-white/5 opacity-40"></div>
                <div className="absolute inset-10 rounded-full border border-slate-100 dark:border-white/5 opacity-60"></div>
                
                {/* Signal Pulser */}
                <div className={`absolute w-full h-full rounded-full border-4 transition-all duration-1000 ${isOutOfRange ? 'border-amber-400/20' : 'border-emerald-400/20'}`}></div>
                
                <div className={`z-10 w-32 h-32 rounded-[2.5rem] flex flex-col items-center justify-center shadow-2xl transition-all transform hover:rotate-3 ${
                  todayRecord?.checkOut 
                    ? 'bg-emerald-500 text-white' 
                    : isOutOfRange 
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' 
                      : 'bg-sky-600 text-white'
                }`}>
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={todayRecord?.checkOut ? "M5 13l4 4L19 7" : "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"} />
                  </svg>
                  {todayRecord && !todayRecord.checkOut && <div className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white"></div>}
                </div>
              </div>

              {/* Status & Feedback Area */}
              <div className="text-center w-full max-w-md space-y-6">
                <div>
                  <h2 className={`text-3xl font-black italic uppercase tracking-tighter ${todayRecord?.checkOut ? 'text-emerald-600' : 'text-[#001f3f] dark:text-white'}`}>
                    {todayRecord?.checkOut ? 'Shift Completed' : todayRecord ? 'Active Duty' : 'Ready for Sign-In'}
                  </h2>
                  <div className="flex items-center justify-center space-x-4 mt-2">
                    <div className="flex items-center space-x-1.5">
                      <div className={`w-2 h-2 rounded-full ${userCoords ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Geo-Precision: {userCoords ? `±${Math.round(userCoords.accuracy)}m` : 'Detecting...'}</span>
                    </div>
                  </div>
                </div>

                {/* Telemetry Display */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Campus Distance</p>
                    <p className={`text-xl font-black font-mono ${isOutOfRange ? 'text-amber-500' : 'text-emerald-600'}`}>
                      {currentDistance ? `${Math.round(currentDistance)}m` : '---'}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Authorization Range</p>
                    <p className="text-xl font-black text-[#001f3f] dark:text-white font-mono">{RADIUS_METERS}m</p>
                  </div>
                </div>

                {/* Institutional Guidance Bar */}
                <div className="py-3 px-5 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-center space-x-3 shadow-inner">
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[9px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-widest leading-tight">
                    Visit Head Teacher's Office for correct Check In and Check Out.
                  </p>
                </div>

                {/* Main Action Area */}
                {!todayRecord?.checkOut && (
                  <div className="space-y-4">
                    <button 
                      disabled={loading || isOutOfRange}
                      onClick={() => handleAction(false)}
                      className={`w-full py-6 rounded-3xl text-white font-black text-xl shadow-2xl transition-all transform active:scale-95 flex flex-col items-center justify-center group ${
                        loading ? 'opacity-50' : ''
                      } ${
                        isOutOfRange 
                          ? 'bg-slate-300 cursor-not-allowed' 
                          : todayRecord ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#001f3f] hover:bg-slate-900'
                      }`}
                    >
                      <span className="tracking-tighter italic">
                        {loading ? 'SYNCHRONIZING...' : todayRecord ? 'GEOTAG: CHECK-OUT' : 'GEOTAG: CHECK-IN'}
                      </span>
                      {isOutOfRange && <span className="text-[8px] font-black uppercase tracking-[0.3em] mt-1 opacity-60">Move within 20m of Gateway</span>}
                    </button>
                    
                    <button 
                      onClick={() => setIsManualModalOpen(true)}
                      className="w-full text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] hover:text-[#001f3f] dark:hover:text-white transition-colors"
                    >
                      Institutional Over-Ride Request
                    </button>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 dark:bg-red-950/20 p-4 rounded-2xl border border-red-100 dark:border-red-900/30 flex items-center space-x-3">
                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <p className="text-[10px] font-black text-red-600 dark:text-red-400 text-left leading-tight uppercase">{error}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Info Bar */}
            <div className="bg-slate-50 dark:bg-slate-950/50 p-6 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
               <div className="flex items-center space-x-6">
                 <div>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Entry Stamp</p>
                   <p className="text-xs font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkIn || '---'}</p>
                 </div>
                 <div className="w-px h-6 bg-slate-200 dark:bg-slate-800"></div>
                 <div>
                   <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Exit Stamp</p>
                   <p className="text-xs font-black text-[#001f3f] dark:text-white italic">{todayRecord?.checkOut || '---'}</p>
                 </div>
               </div>
               <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Infrastructure Status: Cloud-Sync {lastSyncTime}</p>
            </div>
          </div>
        </div>

        {/* Side Panels */}
        <div className="lg:col-span-4 space-y-6">
          {/* Reliability Score */}
          <div className="bg-[#001f3f] rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-10">
                <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>
             <h3 className="text-[#d4af37] text-sm font-black uppercase italic tracking-widest mb-6">7-Day Engagement</h3>
             <div className="flex items-end justify-between gap-1 h-12">
               {last7Days.map((d, i) => (
                 <div key={i} className="flex-1 flex flex-col items-center group">
                   <div className={`w-full rounded-t-lg transition-all duration-500 ${d.present ? 'bg-amber-400 h-10' : 'bg-white/10 h-2'}`}></div>
                   <span className="text-[7px] font-bold mt-2 opacity-40 uppercase group-hover:opacity-100">{d.date.split('-').pop()}</span>
                 </div>
               ))}
             </div>
             <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center">
                <div>
                  <p className="text-2xl font-black italic">{(last7Days.filter(d => d.present).length / 7 * 100).toFixed(0)}%</p>
                  <p className="text-[8px] font-black text-amber-200 uppercase tracking-widest">Reliability Index</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black uppercase">Active</p>
                  <p className="text-[7px] text-white/40 font-bold uppercase mt-1">Status: Verified</p>
                </div>
             </div>
          </div>

          {/* Precision Telemetry */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-md rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-xl">
             <h3 className="text-[9px] font-black text-sky-600 uppercase tracking-[0.3em] mb-6">Device Telemetry</h3>
             <div className="space-y-5">
               {[
                 { label: 'Latitude', value: userCoords ? userCoords.lat.toFixed(6) : 'Locating...' },
                 { label: 'Longitude', value: userCoords ? userCoords.lng.toFixed(6) : 'Locating...' },
                 { label: 'Map Status', value: isOutOfRange ? 'Out of Radius' : 'Target Locked', color: isOutOfRange ? 'text-amber-500' : 'text-emerald-500' }
               ].map((item, i) => (
                 <div key={i} className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                   <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</span>
                   <span className={`text-[11px] font-black font-mono ${item.color || 'text-[#001f3f] dark:text-white'}`}>{item.value}</span>
                 </div>
               ))}
             </div>
             <div className="mt-8 flex justify-center">
               <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                 <div className="w-1/3 h-full bg-sky-500 animate-[shimmer_2s_infinite]"></div>
               </div>
             </div>
          </div>

          {isManagement && (
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-[2rem] p-6 border-2 border-amber-400/30">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Institutional OTP</h4>
                  <button onClick={regenerateOTP} className="text-amber-600 hover:rotate-180 transition-transform duration-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
               </div>
               <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 text-center border border-amber-200">
                  <span className="text-3xl font-black text-amber-600 tracking-[0.3em] font-mono">{currentOTP}</span>
               </div>
            </div>
          )}
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl space-y-8 border border-amber-400/20">
             <div className="text-center"><h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Manual Verification</h4></div>
             <div className="space-y-4">
                <input type="text" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-800 border-2 border-transparent focus:border-amber-400 rounded-2xl py-6 text-center text-3xl font-black tracking-[0.5em] outline-none transition-all dark:text-white" />
                <button onClick={() => handleAction(true)} disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 transition-all">Authenticate Entry</button>
                <button onClick={() => setIsManualModalOpen(false)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors">Discard Request</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

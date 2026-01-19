import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification, SchoolConfig } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
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
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications, showToast, config }) => {
  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const lastBriefingKey = useRef<string>("");

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bahrain', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const userProxiesToday = useMemo(() => 
    substitutions.filter(s => s.substituteTeacherId.toLowerCase() === user.id.toLowerCase() && s.date === today && !s.isArchived),
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
  }, [fetchBriefing, userProxiesToday]); // Re-brief when duties change

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

  const isOutOfRange = currentDistance !== null && currentDistance > geoCenter.radius;

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
        if (dist > geoCenter.radius) {
          throw new Error(`Gateway Proximity Mismatch (${Math.round(dist)}m). Please be on campus.`);
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
          reason: isMedical ? 'Medical Leave' : (isManual ? 'Manual Override' : 'Standard Check-In')
        };

        if (IS_CLOUD_ENABLED) {
          const { data, error } = await supabase.from('attendance').insert(payload).select().single();
          if (error) throw error;
          setAttendance(prev => [{ 
            id: data.id, userId: user.id, userName: user.name, date: today, checkIn: timeString, 
            checkOut: isMedical ? 'ABSENT' : undefined, isManual: isManual || isMedical, isLate, location, reason: payload.reason
          }, ...prev]);
        } else {
           setAttendance(prev => [{ 
             id: `loc-${Date.now()}`, userId: user.id, userName: user.name, date: today, checkIn: timeString, 
             checkOut: isMedical ? 'ABSENT' : undefined, isManual: isManual || isMedical, isLate, location, reason: payload.reason
           }, ...prev]);
        }
        showToast(isMedical ? "Medical Record Logged" : "Registry Successful", "success");
      } else {
        if (isMedical || todayRecord.checkIn === 'MEDICAL') { 
          showToast("Status locked for today.", "warning"); 
          setLoading(false); 
          return; 
        }
        const timeOut = bahrainNow.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
        if (IS_CLOUD_ENABLED) {
          await supabase.from('attendance').update({ check_out: timeOut }).match({ user_id: user.id, date: today });
        }
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-4">
        <div className="text-center md:text-left space-y-2">
          <h2 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Staff <span className="text-[#d4af37]">Terminal</span>
          </h2>
          <p className="text-xs font-black text-slate-400 uppercase tracking-[0.4em]">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 px-8 py-5 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 text-center min-w-[200px]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Institutional Time</p>
          <p className="text-3xl font-black text-[#001f3f] dark:text-white tracking-tighter italic">
            {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bahrain' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <div className="bg-gradient-to-br from-[#001f3f] to-[#003366] rounded-[3rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#d4af37]/10 blur-[80px] rounded-full"></div>
            <div className="relative z-10 flex items-start gap-6">
              <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <svg className={`w-6 h-6 ${isBriefingLoading ? 'animate-spin text-amber-400' : 'text-[#d4af37]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">AI Morning Briefing</h3>
                  <button onClick={() => fetchBriefing(true)} disabled={isBriefingLoading} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group">
                    <svg className={`w-4 h-4 text-white/30 group-hover:text-amber-400 ${isBriefingLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
                {isBriefingLoading ? (
                  <div className="space-y-2 py-2">
                    <div className="h-3 w-48 bg-white/5 animate-pulse rounded-full"></div>
                    <div className="h-3 w-64 bg-white/5 animate-pulse rounded-full"></div>
                  </div>
                ) : (
                  <p className="text-sm md:text-base text-white/90 font-medium leading-relaxed italic pr-4">
                    {aiBriefing || `Syncing institutional context...`}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700">
               <img src={SCHOOL_LOGO_BASE64} alt="" className="w-48 h-48 object-contain grayscale invert" />
             </div>
             <div className="relative z-10 space-y-8">
                <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full animate-pulse ${isRefreshingGps ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                  <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.4em]">Geotag Status Hub</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-2">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Distance from Center</p>
                     <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-white italic tracking-tighter">
                          {currentDistance !== null ? Math.round(currentDistance) : '--'}
                        </span>
                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Meters</span>
                     </div>
                  </div>
                  <div className="space-y-2">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Access Authorization</p>
                     <div className={`text-sm font-black uppercase tracking-[0.2em] px-4 py-2 rounded-xl border flex items-center gap-3 ${isOutOfRange ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                        <div className={`w-2 h-2 rounded-full ${isOutOfRange ? 'bg-rose-500' : 'bg-emerald-50'}`}></div>
                        {isOutOfRange ? 'OUTSIDE PERIMETER' : 'AUTHORIZED'}
                     </div>
                  </div>
                </div>
                <div className="pt-10 flex flex-col sm:flex-row gap-4">
                  <button 
                    disabled={loading || (isOutOfRange && !todayRecord) || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'}
                    onClick={() => handleAction()}
                    className={`flex-1 py-6 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${
                      todayRecord 
                      ? 'bg-amber-500 text-[#001f3f] hover:bg-amber-400' 
                      : 'bg-[#d4af37] text-[#001f3f] hover:bg-white disabled:bg-slate-700 disabled:text-slate-500'
                    }`}
                  >
                    {loading ? 'Processing...' : (todayRecord ? 'Clock-Out System' : 'Clock-In System')}
                  </button>
                  <button 
                    onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }}
                    className="px-8 py-6 rounded-3xl bg-white/5 text-white/60 hover:bg-white/10 border border-white/10 font-black text-[10px] uppercase tracking-widest transition-all"
                  >
                    Key Override
                  </button>
                </div>
             </div>
          </div>

          {userProxiesToday.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 animate-in slide-in-from-bottom duration-700">
              <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800 pb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-2xl flex items-center justify-center font-black shadow-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Proxy Duty Ledger</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                 {userProxiesToday.map(proxy => (
                   <div key={proxy.id} className="bg-slate-50/50 dark:bg-slate-800/40 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 flex justify-between items-center group hover:-translate-y-1 transition-all">
                      <div className="space-y-1">
                         <div className="flex items-center gap-2">
                           <p className="text-lg font-black text-[#001f3f] dark:text-white italic">Period {proxy.slotId}</p>
                           <span className="text-[8px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase">Active</span>
                         </div>
                         <p className="text-xs font-bold text-slate-500 uppercase">Division: <span className="text-[#001f3f] dark:text-white">{proxy.className}</span></p>
                      </div>
                      <div className="text-right">
                         <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">{proxy.subject}</p>
                         <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase">Sub: {proxy.absentTeacherName.split(' ')[0]}</p>
                      </div>
                   </div>
                 ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-8">
           <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-4">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Registry</h4>
                 <div className={`w-2 h-2 rounded-full shadow-lg ${todayRecord ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-slate-200'}`}></div>
              </div>
              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">In-Timestamp</span>
                    <span className={`text-xs font-black italic ${todayRecord?.checkIn === 'MEDICAL' ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>
                      {todayRecord?.checkIn || '--:--'}
                    </span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-slate-500 uppercase">Out-Timestamp</span>
                    <span className="text-xs font-black text-amber-600 italic">
                      {todayRecord?.checkIn === 'MEDICAL' ? 'EXCUSED' : (todayRecord?.checkOut || 'ACTIVE')}
                    </span>
                 </div>
              </div>
           </div>

           <div className="bg-rose-50 dark:bg-rose-950/20 rounded-[2.5rem] p-8 border-2 border-dashed border-rose-100 dark:border-rose-900/40 text-center space-y-4">
              <p className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em]">Absence Protocol</p>
              <button 
                onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }}
                disabled={loading || !!todayRecord}
                className="w-full py-4 rounded-2xl bg-white dark:bg-slate-900 text-rose-500 font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-rose-500 hover:text-white transition-all disabled:opacity-30"
              >
                Register Absence
              </button>
           </div>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
                  {pendingAction === 'MEDICAL' ? 'Absence Link' : 'Matrix Override'}
                </h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Enter Access Credential</p>
             </div>
             <input 
               type="text" placeholder="Access Key" maxLength={10} value={otpInput}
               onChange={e => setOtpInput(e.target.value)}
               className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-8 py-5 text-center text-3xl font-black tracking-[0.2em] dark:text-white outline-none"
             />
             <button 
               onClick={() => handleAction(pendingAction === 'OVERRIDE', pendingAction === 'MEDICAL')}
               disabled={loading}
               className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/10 active:scale-95"
             >
               Confirm Protocol
             </button>
             <button onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Discard Attempt</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
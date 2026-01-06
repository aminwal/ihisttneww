
import React, { useState, useMemo, useEffect } from 'react';
import { User, AttendanceRecord, SubstitutionRecord, UserRole, SchoolNotification } from '../types.ts';
import { TARGET_LAT, TARGET_LNG, RADIUS_METERS, LATE_THRESHOLD_HOUR, LATE_THRESHOLD_MINUTE, EDUCATIONAL_QUOTES } from '../constants.ts';
import { calculateDistance, getCurrentPosition } from '../utils/geoUtils.ts';
import { supabase } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
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
}

const Dashboard: React.FC<DashboardProps> = ({ user, attendance, setAttendance, substitutions = [], currentOTP, setOTP, notifications, setNotifications }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isMedicalModalOpen, setIsMedicalModalOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // AI Quote State
  const [aiQuote, setAiQuote] = useState<{ text: string; author: string; sources: { uri: string; title: string }[] } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);

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

  // Fetch AI Quote using Google Search Grounding
  useEffect(() => {
    const fetchInspiration = async () => {
      setQuoteLoading(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: "Find a powerful, relevant educational quote of the day for teachers at a school. Return only the quote and the author in a clear format. Be inspiring.",
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const text = response.text || "";
        const lines = text.split('\n').filter(l => l.trim());
        const quoteText = lines[0]?.replace(/^["']|["']$/g, '') || "Education is not preparation for life; education is life itself.";
        const authorText = lines[1]?.replace(/^- /, '') || "John Dewey";
        
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sourceLinks = chunks
          .filter(chunk => chunk.web)
          .map(chunk => ({
            uri: chunk.web?.uri || "",
            title: chunk.web?.title || "Source"
          }))
          .slice(0, 2);

        setAiQuote({
          text: quoteText,
          author: authorText,
          sources: sourceLinks
        });
      } catch (err) {
        console.warn("AI Inspiration Terminal Offline. Using internal registry.");
        const fallback = EDUCATIONAL_QUOTES[Math.floor(Math.random() * EDUCATIONAL_QUOTES.length)];
        setAiQuote({ text: fallback.text, author: fallback.author, sources: [] });
      } finally {
        setQuoteLoading(false);
      }
    };
    fetchInspiration();
  }, []);

  const todayRecord = useMemo(() => 
    attendance.find(r => r.userId === user.id && r.date === today),
    [attendance, user.id, today]
  );

  const isMedicalAbsence = todayRecord?.checkIn === 'MEDICAL';

  const last7Days = useMemo(() => {
    const records = [];
    for(let i=6; i>=0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().split('T')[0];
      const rec = attendance.find(r => r.userId === user.id && r.date === dStr);
      records.push({ date: dStr, present: !!rec, isMedical: rec?.checkIn === 'MEDICAL' });
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

  const handleMedicalAbsence = async () => {
    if (otpInput !== currentOTP) {
      setError("Authorization Failed: Invalid OTP code.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
      const recordData = {
        userId: user.id,
        userName: user.name,
        date: today,
        checkIn: 'MEDICAL',
        checkOut: 'MEDICAL',
        isManual: true,
        isLate: false,
        reason: 'Medical Reason',
      };

      if (isCloudActive) {
        const { data, error: insertError } = await supabase.from('attendance').insert({ 
          user_id: user.id, 
          date: today, 
          check_in: 'MEDICAL', 
          check_out: 'MEDICAL',
          is_manual: true, 
          is_late: false, 
          reason: 'Medical Reason'
        }).select().single();
        
        if (insertError) throw new Error(`Cloud Persistence Failed: ${insertError.message}`);
        setAttendance(prev => [{ ...recordData, id: data.id }, ...prev]);
      } else {
        setAttendance(prev => [{ ...recordData, id: generateUUID() }, ...prev]);
      }

      setLastSyncTime(new Date().toLocaleTimeString());
      setIsMedicalModalOpen(false);
      setOtpInput('');
    } catch (err: any) {
      setError(err.message || "Failed to mark medical absence.");
    } finally {
      setLoading(false);
    }
  };

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
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${isMedicalAbsence ? 'from-rose-500 via-rose-300 to-rose-500' : 'from-sky-500 via-amber-500 to-sky-500'}`}></div>
            
            <div className="p-8 md:p-12 flex flex-col items-center">
              {/* Proximity Radar UI */}
              <div className="relative mb-10 w-48 h-48 flex items-center justify-center">
                <div className={`absolute inset-0 rounded-full border border-slate-100 dark:border-white/5 ${isMedicalAbsence ? 'animate-none' : 'animate-ping'} opacity-20`}></div>
                <div className="absolute inset-4 rounded-full border border-slate-100 dark:border-white/5 opacity-40"></div>
                <div className="absolute inset-10 rounded-full border border-slate-100 dark:border-white/5 opacity-60"></div>
                
                <div className={`absolute w-full h-full rounded-full border-4 transition-all duration-1000 ${isMedicalAbsence ? 'border-rose-400/30' : isOutOfRange ? 'border-amber-400/20' : 'border-emerald-400/20'}`}></div>
                
                <div className={`z-10 w-32 h-32 rounded-[2.5rem] flex flex-col items-center justify-center shadow-2xl transition-all transform hover:rotate-3 ${
                  isMedicalAbsence 
                    ? 'bg-rose-500 text-white' 
                    : todayRecord?.checkOut 
                      ? 'bg-emerald-500 text-white' 
                      : isOutOfRange 
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' 
                        : 'bg-sky-600 text-white'
                }`}>
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {isMedicalAbsence ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={todayRecord?.checkOut ? "M5 13l4 4L19 7" : "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"} />
                    )}
                  </svg>
                  {todayRecord && !todayRecord.checkOut && !isMedicalAbsence && <div className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white"></div>}
                </div>
              </div>

              {/* Status & Feedback Area */}
              <div className="text-center w-full max-w-2xl space-y-6">
                <div>
                  <h2 className={`text-3xl font-black italic uppercase tracking-tighter ${
                    isMedicalAbsence 
                      ? 'text-rose-600' 
                      : todayRecord?.checkOut 
                        ? 'text-emerald-600' 
                        : 'text-[#001f3f] dark:text-white'
                  }`}>
                    {isMedicalAbsence 
                      ? 'Medical Leave Active' 
                      : todayRecord?.checkOut 
                        ? 'Shift Completed' 
                        : todayRecord 
                          ? 'Active Duty' 
                          : 'Ready for Sign-In'}
                  </h2>
                  <div className="flex items-center justify-center space-x-4 mt-2">
                    <div className="flex items-center space-x-1.5">
                      <div className={`w-2 h-2 rounded-full ${userCoords ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Geo-Precision: {userCoords ? `±${Math.round(userCoords.accuracy)}m` : 'Detecting...'}</span>
                    </div>
                  </div>
                </div>

                {/* Telemetry Display - Coordinates and Proximity */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Campus Distance</p>
                    <p className={`text-xl font-black font-mono ${isOutOfRange ? 'text-amber-500' : 'text-emerald-600'}`}>
                      {currentDistance !== null ? `${Math.round(currentDistance)}m` : '---'}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Current Coordinates</p>
                    <div className="flex flex-col items-center">
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white font-mono leading-none">
                         {userCoords ? userCoords.lat.toFixed(6) : '---'}
                       </p>
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white font-mono leading-none mt-1">
                         {userCoords ? userCoords.lng.toFixed(6) : '---'}
                       </p>
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Auth Radius</p>
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
                {!todayRecord?.checkOut && !isMedicalAbsence && (
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
                    
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => setIsManualModalOpen(true)}
                        className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-3 bg-slate-100/50 dark:bg-slate-800/50 rounded-2xl hover:text-[#001f3f] dark:hover:text-white transition-colors"
                      >
                        Institutional Over-Ride
                      </button>
                      {!todayRecord && (
                        <button 
                          onClick={() => setIsMedicalModalOpen(true)}
                          className="text-[10px] font-black text-rose-500/70 uppercase tracking-widest py-3 bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl hover:text-rose-600 transition-colors border border-rose-100/50 flex items-center justify-center gap-2"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
                          Medical Absence
                        </button>
                      )}
                    </div>
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
          {/* AI Inspiration Panel */}
          <div className="bg-gradient-to-br from-brand-gold/10 to-amber-500/5 dark:from-amber-900/20 dark:to-slate-900 rounded-[2.5rem] p-8 border border-amber-400/20 shadow-xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
             </div>
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-[0.3em]">AI Daily Inspiration</h3>
                <div className="flex gap-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50"></div>
                </div>
             </div>
             
             {quoteLoading ? (
               <div className="space-y-4 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-full w-3/4"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-full w-full"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-full w-1/2"></div>
               </div>
             ) : (
               <div className="space-y-4">
                  <p className="text-sm md:text-base font-black text-[#001f3f] dark:text-white italic leading-relaxed">
                    "{aiQuote?.text}"
                  </p>
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">
                    — {aiQuote?.author}
                  </p>
                  
                  {aiQuote?.sources && aiQuote.sources.length > 0 && (
                    <div className="pt-4 mt-4 border-t border-amber-400/10 space-y-2">
                       <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Grounding Citations:</p>
                       <div className="flex flex-wrap gap-2">
                          {aiQuote.sources.map((src, i) => (
                            <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="text-[7px] font-black text-sky-500 hover:text-sky-600 transition-colors uppercase border border-sky-500/20 px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/10">
                              {src.title}
                            </a>
                          ))}
                       </div>
                    </div>
                  )}
               </div>
             )}
          </div>

          {/* Reliability Score */}
          <div className="bg-[#001f3f] rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-10">
                <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>
             <h3 className="text-[#d4af37] text-sm font-black uppercase italic tracking-widest mb-6">7-Day Engagement</h3>
             <div className="flex items-end justify-between gap-1 h-12">
               {last7Days.map((d, i) => (
                 <div key={i} className="flex-1 flex flex-col items-center group">
                   <div className={`w-full rounded-t-lg transition-all duration-500 ${d.isMedical ? 'bg-rose-400 h-10' : d.present ? 'bg-amber-400 h-10' : 'bg-white/10 h-2'}`}></div>
                   <span className="text-[7px] font-bold mt-2 opacity-40 uppercase group-hover:opacity-100">{d.date.split('-').pop()}</span>
                 </div>
               ))}
             </div>
             <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center">
                <div>
                  <p className="text-2xl font-black italic">{(last7Days.filter(d => d.present || d.isMedical).length / 7 * 100).toFixed(0)}%</p>
                  <p className="text-[8px] font-black text-amber-200 uppercase tracking-widest">Reliability Index</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black uppercase">Active</p>
                  <p className="text-[7px] text-white/40 font-bold uppercase mt-1">Status: Verified</p>
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

      {/* Manual Verification Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[2.5rem] p-10 shadow-2xl space-y-8 border border-amber-400/20">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Manual Verification</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Institutional Over-Ride Required</p>
             </div>
             <div className="space-y-4">
                <input type="text" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-800 border-2 border-transparent focus:border-amber-400 rounded-2xl py-6 text-center text-3xl font-black tracking-[0.5em] outline-none transition-all dark:text-white" />
                <button onClick={() => handleAction(true)} disabled={loading} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 transition-all">Authenticate Entry</button>
                <button onClick={() => { setIsManualModalOpen(false); setOtpInput(''); setError(null); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors">Discard Request</button>
             </div>
          </div>
        </div>
      )}

      {/* Medical Absence Modal */}
      {isMedicalModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-rose-950/90 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-sm rounded-[2.5rem] p-10 shadow-2xl space-y-8 border border-rose-400/20">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Medical Absence</h4>
                <p className="text-[9px] font-bold text-rose-500 uppercase mt-1">Institutional Auth Required</p>
             </div>
             <div className="space-y-4">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center uppercase font-bold leading-relaxed px-4">
                  Please provide the OTP received from the Admin/Incharge to authorize your medical leave.
                </p>
                <input type="text" maxLength={6} placeholder="------" value={otpInput} onChange={e => setOtpInput(e.target.value)} className="w-full bg-rose-50 dark:bg-slate-800 border-2 border-transparent focus:border-rose-400 rounded-2xl py-6 text-center text-3xl font-black tracking-[0.5em] outline-none transition-all dark:text-white" />
                <button onClick={handleMedicalAbsence} disabled={loading} className="w-full bg-rose-600 text-white py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-rose-700 transition-all flex items-center justify-center gap-2">
                  {loading ? 'Processing...' : 'Authorize Medical Leave'}
                </button>
                <button onClick={() => { setIsMedicalModalOpen(false); setOtpInput(''); setError(null); }} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors">Abort</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

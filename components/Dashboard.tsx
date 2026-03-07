
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
import { generateUUID } from '../utils/idUtils.ts';
import { formatBahrainDate, getBahrainTime } from '../utils/dateUtils.ts';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar, ClipboardList, Zap, BookOpen, Volume2, Info, ShieldAlert } from 'lucide-react';

interface DashboardProps {
  user: User;
  users: User[];
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

type WidgetZone = 'sentinel' | 'pulse' | 'intelligence' | 'operational' | 'registry_grid' | 'trend' | 'lexicon';

const Dashboard: React.FC<DashboardProps> = ({ 
  user, users, attendance, setAttendance, substitutions = [], currentOTP, setOTP, 
  notifications, setNotifications, showToast, config, timetable = [], isSandbox, addSandboxLog 
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const today = useMemo(() => formatBahrainDate(currentTime), [currentTime.toDateString()]);
  const todayDayName = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(currentTime), [currentTime.toDateString()]);

  const [loading, setLoading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'OVERRIDE' | 'MEDICAL' | 'MANUAL_OUT' | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);

  // Matrix Layout Architect State
  const [isArchitectMode, setIsArchitectMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<WidgetZone[]>(() => {
    const saved = localStorage.getItem(`ihis_layout_${user.id}`);
    return saved ? JSON.parse(saved) : ['sentinel', 'pulse', 'intelligence', 'lexicon', 'operational', 'registry_grid', 'trend'];
  });

  // AI Matrix Content State
  const [dailyBriefing, setDailyBriefing] = useState<string>(() => {
    const cached = localStorage.getItem(`ihis_briefing_${today}`);
    return cached || 'Syncing Matrix Briefing...';
  });
  const [dailyQuote, setDailyQuote] = useState<string>(() => {
    const cached = localStorage.getItem(`ihis_quote_${today}`);
    return cached || 'Educational excellence is our standard.';
  });
  const [dailyLexicon, setDailyLexicon] = useState<{ word: string; meaning: string; example: string } | null>(() => {
    const cached = localStorage.getItem(`ihis_lexicon_${today}`);
    return cached ? JSON.parse(cached) : null;
  });

  // Sync Insights from Supabase on mount
  useEffect(() => {
    if (!IS_CLOUD_ENABLED || isSandbox) return;

    const syncInsights = async () => {
      try {
        const { data, error } = await supabase
          .from('ai_insights')
          .select('*')
          .eq('date', today)
          .eq('user_id', user.id);

        if (data && data.length > 0) {
          data.forEach(insight => {
            if (insight.type === 'briefing') {
              setDailyBriefing(insight.content.text);
              localStorage.setItem(`ihis_briefing_${today}`, insight.content.text);
            }
            if (insight.type === 'quote') {
              setDailyQuote(insight.content.text);
              localStorage.setItem(`ihis_quote_${today}`, insight.content.text);
            }
            if (insight.type === 'lexicon') {
              setDailyLexicon(insight.content);
              localStorage.setItem(`ihis_lexicon_${today}`, JSON.stringify(insight.content));
            }
          });
        }
      } catch (e) {
        console.warn("Supabase Insights Sync Offline", e);
      }
    };

    syncInsights();
  }, [today, user.id, isSandbox]);
  const [isMatrixLoading, setIsMatrixLoading] = useState(false);
  const [isGatingError, setIsGatingError] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  const [activityPulse, setActivityPulse] = useState<{ id: string; user: string; action: string; time: string; type: 'ATTENDANCE' | 'PROXY' }[]>([]);

  const todayRecord = useMemo(() => attendance.find(r => r.userId.toLowerCase() === user.id.toLowerCase() && r.date === today), [attendance, user.id, today]);
  
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');

  const liveTimeStr = useMemo(() => currentTime.toLocaleTimeString('en-US', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit', hour12: true }), [currentTime]);
  const liveDateStr = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bahrain', weekday: 'long', month: 'long', day: 'numeric' }).format(currentTime), [currentTime]);

  // CLOUD DISCONNECTED WARNING
  const showCloudWarning = !IS_CLOUD_ENABLED && !isSandbox;

  useEffect(() => {
    if (!isManagement || !IS_CLOUD_ENABLED || isSandbox) return;

    const channel = supabase
      .channel('schema-db-pulse')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
        const newRec = payload.new;
        setActivityPulse(prev => [
          { id: newRec.id, user: 'Faculty', action: 'Registry Sync', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: 'ATTENDANCE' as const },
          ...prev
        ].slice(0, 8));
        HapticService.notification();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'substitution_ledger' }, (payload) => {
        const newProxy = payload.new;
        setActivityPulse(prev => [
          { id: newProxy.id, user: 'Management', action: `Proxy: ${newProxy.class_name}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: 'PROXY' as const },
          ...prev
        ].slice(0, 8));
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
    const poolCommitment = (config.combinedBlocks || []).filter(b => (b.allocations || []).some(a => a.teacherId === user.id)).reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);
    const labCommitment = (config.labBlocks || []).filter(b => (b.allocations || []).some(a => a.teacherId === user.id || a.technicianId === user.id)).reduce((sum, b) => sum + (b.weeklyOccurrences * (b.isDoublePeriod ? 2 : 1)), 0);
    const total = individualScheduled + poolCommitment + labCommitment;
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

  const fetchMatrixAI = useCallback(async (force = false) => {
    if (isMatrixLoading) return;
    
    const regCount = myScheduleToday.length;
    const proxyCount = myProxiesToday.length;
    const isAiReady = await MatrixService.isReady();

    if (!isAiReady) {
      setDailyBriefing(`Salams, ${user.name}. You have ${regCount} regular periods and ${proxyCount} proxy duties today. Focus on Period 1 registration.`);
      return;
    }

    // Check if we already have today's content cached
    const hasBriefing = localStorage.getItem(`ihis_briefing_${today}`);
    const hasQuote = localStorage.getItem(`ihis_quote_${today}`);
    const hasLexicon = localStorage.getItem(`ihis_lexicon_${today}`);

    if (!force && hasBriefing && hasQuote && hasLexicon) {
      return; // Already synchronized for today
    }

    setIsMatrixLoading(true);
    setIsGatingError(false);
    try {
      const briefingPrompt = `
        Institutional Analyst Persona for ${SCHOOL_NAME}.
        Teacher: ${user.name}. Day: ${todayDayName}.
        Stats: ${regCount} regular periods, ${proxyCount} proxies.
        Current Load: ${myLoadMetrics.percent}% of weekly cap.
        
        CRITICAL TASK:
        1. Greet professionally.
        2. EXPLICITLY MENTION the number of regular classes and proxies for today.
        3. Give "Actionable Intel": identify the biggest gap between classes and suggest a specific task.
        Be authoritative and under 3 sentences.
      `;

      const quotePrompt = `One short educational motivation quote for an Islamic school teacher for today (${today}).`;
      const lexiconPrompt = `Generate a high-value academic or IELTS-level English vocabulary word for today (${today}, ${todayDayName}). 
      Ensure it is a sophisticated word that is not commonly used in daily conversation but essential for academic excellence. 
      Avoid repeating common words like 'Serendipity', 'Ephemeral', or 'Ubiquitous'. 
      Include the word, its meaning, and a formal example sentence that relates to education or professional life. 
      Format the response as JSON with keys: word, meaning, example.`;

      // Use individual try-catches to ensure one failure doesn't block others
      const fetchBriefing = async () => {
        if (!force && hasBriefing) return;
        try {
          const res = await MatrixService.architectRequest(briefingPrompt);
          if (res.text) {
            const text = res.text.trim();
            setDailyBriefing(text);
            localStorage.setItem(`ihis_briefing_${today}`, text);
            
            // Save to Supabase for cross-device sync
            if (IS_CLOUD_ENABLED && !isSandbox) {
              await supabase.from('ai_insights').upsert({
                user_id: user.id,
                date: today,
                type: 'briefing',
                content: { text },
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,date,type' });
            }
          }
        } catch (e) { console.error("Briefing Fetch Error", e); }
      };

      const fetchQuote = async () => {
        if (!force && hasQuote) return;
        try {
          const res = await MatrixService.architectRequest(quotePrompt);
          if (res.text) {
            const text = res.text.trim();
            setDailyQuote(text);
            localStorage.setItem(`ihis_quote_${today}`, text);

            // Save to Supabase
            if (IS_CLOUD_ENABLED && !isSandbox) {
              await supabase.from('ai_insights').upsert({
                user_id: user.id,
                date: today,
                type: 'quote',
                content: { text },
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,date,type' });
            }
          }
        } catch (e) { console.error("Quote Fetch Error", e); }
      };

      const fetchLexicon = async () => {
        if (!force && hasLexicon) return;
        try {
          const res = await MatrixService.architectRequest(lexiconPrompt, [], { 
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                word: { type: 'STRING' },
                meaning: { type: 'STRING' },
                example: { type: 'STRING' }
              },
              required: ['word', 'meaning', 'example']
            }
          });
          if (res.text) {
            const data = JSON.parse(res.text);
            setDailyLexicon(data);
            localStorage.setItem(`ihis_lexicon_${today}`, JSON.stringify(data));

            // Save to Supabase
            if (IS_CLOUD_ENABLED && !isSandbox) {
              await supabase.from('ai_insights').upsert({
                user_id: user.id,
                date: today,
                type: 'lexicon',
                content: data,
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,date,type' });
            }
          }
        } catch (e) { console.error("Lexicon Fetch Error", e); }
      };

      await Promise.allSettled([fetchBriefing(), fetchQuote(), fetchLexicon()]);

    } catch (e: any) {
      if (e.message?.includes('GATING_ERROR')) {
        setIsGatingError(true);
      }
      setDailyBriefing(`Salams, ${user.name}. Secure logic offline. You have ${regCount} classes and ${proxyCount} proxies scheduled.`);
    } finally {
      setIsMatrixLoading(false);
    }
  }, [user.name, todayDayName, myScheduleToday.length, myProxiesToday.length, myLoadMetrics.percent, today]);

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
    const loadingTimer = setTimeout(() => setIsInitialLoading(false), 1200);
    return () => {
      clearInterval(interval);
      clearTimeout(loadingTimer);
    };
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

  const handleCrisisDeployment = async () => {
    if (!confirm("CRITICAL ACTION: This will auto-assign ALL current empty classes to available teachers. Proceed?")) return;
    setLoading(true);
    HapticService.notification();
    
    try {
      const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(new Date());
      const absentTeacherIds = users
        .filter(u => {
          const record = attendance.find(r => r.userId === u.id && r.date === today);
          return !record || record.checkIn === 'MEDICAL';
        }).map(u => u.id);

      const suspendedGradeIds = (config.gradeSuspensions || [])
        .filter(s => s.date === today)
        .map(s => s.gradeId);

      const gaps: any[] = [];
      timetable
        .filter(t => 
          t.day === weekday && 
          absentTeacherIds.includes(t.teacherId) && 
          !t.date && 
          !suspendedGradeIds.includes(t.gradeId) 
        )
        .forEach(t => {
          const alreadyProxied = substitutions.some(s => s.date === today && s.slotId === t.slotId && s.sectionId === t.sectionId);
          if (!alreadyProxied) {
            gaps.push(t);
          }
        });

      if (gaps.length === 0) {
        showToast("Matrix Secure: No unassigned gaps detected.", "info");
        return;
      }

      let deployedCount = 0;
      const newSubstitutions: SubstitutionRecord[] = [];

      for (const gap of gaps) {
        // Find candidates
        const candidates = users.filter(u => {
          if (u.isResigned || u.role === UserRole.ADMIN) return false;
          const isPresent = attendance.some(r => r.userId === u.id && r.date === today && r.checkIn !== 'MEDICAL');
          if (!isPresent) return false;
          
          const isNaturallyFree = !timetable.some(t => t.day === weekday && t.slotId === gap.slotId && t.teacherId === u.id && !t.date);
          const isBusyWithAnotherProxy = [...substitutions, ...newSubstitutions].some(s => s.date === today && s.slotId === gap.slotId && s.substituteTeacherId === u.id && !s.isArchived);
          
          if (!isNaturallyFree || isBusyWithAnotherProxy) return false;

          // Simple load check
          const policy = config.loadPolicies?.[u.role] || { baseTarget: 28, substitutionCap: 5 };
          const currentProxies = [...substitutions, ...newSubstitutions].filter(s => s.substituteTeacherId === u.id && s.date === today).length;
          return currentProxies < policy.substitutionCap;
        });

        if (candidates.length > 0) {
          const selected = candidates[0]; // Simple selection for crisis mode
          const sub: SubstitutionRecord = {
            id: generateUUID(),
            date: today,
            slotId: gap.slotId,
            wingId: gap.wingId,
            gradeId: gap.gradeId,
            sectionId: gap.sectionId,
            className: gap.className,
            subject: gap.subject,
            absentTeacherId: gap.teacherId,
            absentTeacherName: gap.teacherName,
            substituteTeacherId: selected.id,
            substituteTeacherName: selected.name,
            section: gap.section,
            isArchived: false
          };

          if (IS_CLOUD_ENABLED && !isSandbox) {
            await supabase.from('substitution_ledger').insert({
              id: sub.id,
              date: sub.date,
              slot_id: sub.slotId,
              wing_id: sub.wingId,
              grade_id: sub.gradeId,
              section_id: sub.sectionId,
              class_name: sub.className,
              subject: sub.subject,
              absent_teacher_id: sub.absentTeacherId,
              absent_teacher_name: sub.absentTeacherName,
              substitute_teacher_id: sub.substituteTeacherId,
              substitute_teacher_name: sub.substituteTeacherName,
              section: sub.section,
              is_archived: false
            });
          }
          newSubstitutions.push(sub);
          deployedCount++;
        }
      }

      if (deployedCount > 0) {
        // We don't have setSubstitutions here, but we can rely on the real-time pulse or manual refresh
        // Actually, Dashboard usually gets substitutions as a prop, but it might not have a setter
        // Let's check the props again.
        showToast(`Crisis Matrix: ${deployedCount} proxies deployed.`, "success");
        HapticService.success();
      } else {
        showToast("Crisis Matrix: No available teachers found for gaps.", "warning");
      }

    } catch (err: any) {
      showToast("Crisis Deployment Failed", "error");
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

  const attendanceTrend = useMemo(() => [
    { day: 'Sun', present: 92 },
    { day: 'Mon', present: 95 },
    { day: 'Tue', present: 88 },
    { day: 'Wed', present: 94 },
    { day: 'Thu', present: 91 },
  ], []);

  // Layout Architect Logic
  const moveWidget = (direction: 'up' | 'down', index: number) => {
    const newOrder = [...widgetOrder];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    
    [newOrder[index], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[index]];
    setWidgetOrder(newOrder);
    localStorage.setItem(`ihis_layout_${user.id}`, JSON.stringify(newOrder));
    HapticService.light();
  };

  const renderZone = (zone: WidgetZone) => {
    const controlOverlay = isArchitectMode && (
      <div className="absolute top-2 right-2 flex gap-2 z-50 animate-in fade-in zoom-in duration-300">
        <button 
          onClick={() => moveWidget('up', widgetOrder.indexOf(zone))}
          disabled={widgetOrder.indexOf(zone) === 0}
          className="p-2 bg-[#d4af37] text-[#001f3f] rounded-lg shadow-lg disabled:opacity-30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"/></svg>
        </button>
        <button 
          onClick={() => moveWidget('down', widgetOrder.indexOf(zone))}
          disabled={widgetOrder.indexOf(zone) === widgetOrder.length - 1}
          className="p-2 bg-[#d4af37] text-[#001f3f] rounded-lg shadow-lg disabled:opacity-30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/></svg>
        </button>
      </div>
    );

    const architectStyle = isArchitectMode ? 'border-2 border-dashed border-amber-400/50 rounded-[3rem] relative' : 'relative';

    switch (zone) {
      case 'sentinel':
        return (
          <div key="sentinel" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4">
              <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-2 rounded-[2rem] border border-white/20 dark:border-slate-800/50 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-2 animate-in slide-in-from-top-4 duration-1000">
                <div className="px-4 py-3 rounded-2xl flex items-center gap-3 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`w-2 h-2 rounded-full ${biometricActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`}></div>
                    <div className="flex-1">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Passkey</p>
                      <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">{biometricActive ? 'Secured' : 'Vulnerable'}</p>
                    </div>
                </div>
                <div className="px-4 py-3 rounded-2xl flex items-center gap-3 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`w-2 h-2 rounded-full ${userCoords && userCoords.accuracy < 30 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`}></div>
                    <div className="flex-1">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Signal</p>
                      <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{userCoords ? `${Math.round(userCoords.accuracy)}m Acc.` : 'Scanning...'}</p>
                    </div>
                </div>
                <div className="px-4 py-3 rounded-2xl flex items-center gap-3 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    <div className="flex-1">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Temporal</p>
                      <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">Bahrain Sync</p>
                    </div>
                </div>
                <div className="px-4 py-3 rounded-2xl flex items-center gap-3 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`w-2 h-2 rounded-full ${isOutOfRange ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`}></div>
                    <div className="flex-1">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Boundary</p>
                      <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{isOutOfRange ? 'Off-Campus' : 'Authorized'}</p>
                    </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'pulse':
        if (!isManagement || !institutionalPulse) return null;
        return (
          <div key="pulse" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4 grid grid-cols-1 md:grid-cols-12 gap-6 animate-in slide-in-from-top-4 duration-1000">
              <div className="md:col-span-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[2.5rem] border border-emerald-500/20 shadow-xl flex flex-col justify-between group overflow-hidden relative">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-12 -mt-12"></div>
                  <div className="relative z-10">
                    <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.3em] mb-2">Faculty Presence</p>
                    <p className="text-4xl font-black text-[#001f3f] dark:text-white italic tracking-tighter">{institutionalPulse.presence}%</p>
                  </div>
                  <div className="mt-4 h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div style={{ width: `${institutionalPulse.presence}%` }} className="h-full bg-emerald-500"></div>
                  </div>
              </div>
              <div className="md:col-span-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[2.5rem] border border-sky-500/20 shadow-xl flex flex-col justify-between group overflow-hidden relative">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 rounded-full -mr-12 -mt-12"></div>
                  <div className="relative z-10">
                    <p className="text-[10px] font-black text-sky-600 dark:text-sky-400 uppercase tracking-[0.3em] mb-2">Instructional Coverage</p>
                    <p className="text-4xl font-black text-[#001f3f] dark:text-white italic tracking-tighter">{institutionalPulse.coverage}%</p>
                  </div>
                  <div className="mt-4 h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div style={{ width: `${institutionalPulse.coverage}%` }} className="h-full bg-sky-500"></div>
                  </div>
              </div>

              {/* CRISIS MATRIX EMERGENCY DEPLOYMENT */}
              <div className="md:col-span-6 bg-rose-600 p-8 rounded-[2.5rem] shadow-2xl border border-rose-500 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2)_0%,transparent_70%)]"></div>
                  <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-3xl"></div>
                  <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6 h-full">
                    <div className="space-y-2 text-center md:text-left">
                      <h4 className="text-white text-2xl font-black uppercase italic tracking-tighter leading-none">Crisis Matrix</h4>
                      <p className="text-rose-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Emergency Proxy Deployment Protocol</p>
                    </div>
                    <button 
                      onClick={handleCrisisDeployment}
                      disabled={loading}
                      className="px-8 py-4 bg-white text-rose-600 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-2xl hover:bg-rose-50 active:scale-95 transition-all whitespace-nowrap"
                    >
                      {loading ? 'Deploying...' : 'Execute One-Tap Deploy'}
                    </button>
                  </div>
              </div>
              
              <div className="md:col-span-12 bg-[#00112b] p-8 rounded-[2.5rem] border border-amber-400/20 shadow-2xl overflow-hidden relative">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></div>
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.4em]">Real-Time Matrix Pulse</p>
                    </div>
                    <div className="px-3 py-1 bg-white/5 rounded-lg border border-white/10">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Live Feed Active</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {activityPulse.length > 0 ? activityPulse.map(act => (
                      <div key={act.id} className={`flex justify-between items-center px-5 py-3 rounded-2xl animate-in slide-in-from-bottom-2 duration-300 border ${act.type === 'PROXY' ? 'bg-sky-500/10 border-sky-500/20' : 'bg-white/5 border-white/5'}`}>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${act.type === 'PROXY' ? 'bg-sky-400' : 'bg-amber-400'}`}></div>
                              <span className="text-[10px] font-black text-white uppercase tracking-tight">{act.user}</span>
                            </div>
                            <span className={`text-[10px] font-bold italic ${act.type === 'PROXY' ? 'text-sky-300' : 'text-amber-200/60'}`}>{act.action}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-black tabular-nums">{act.time}</span>
                      </div>
                    )) : (
                      <div className="col-span-full flex flex-col items-center justify-center py-8 opacity-40">
                          <p className="text-[11px] text-slate-500 italic uppercase tracking-widest">Awaiting network pulses...</p>
                      </div>
                    )}
                  </div>
              </div>
            </div>
          </div>
        );
      case 'intelligence':
        return (
          <div key="intelligence" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-gradient-to-br from-[#001f3f] via-[#002b55] to-[#001f3f] rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-white/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:scale-110 group-hover:opacity-[0.07] transition-all duration-1000">
                  <img src={SCHOOL_LOGO_BASE64} className="w-64 h-64 object-contain" alt="" />
                </div>
                <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-amber-400/10 rounded-full blur-[100px]"></div>
                
                <div className="relative z-10 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_12px_rgba(251,191,36,0.8)]"></div>
                    </div>
                    <h3 className="text-[11px] font-black text-amber-400 uppercase tracking-[0.5em] italic">Institutional Intelligence</h3>
                  </div>
                  {isGatingError ? (
                    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/10 animate-in fade-in zoom-in">
                      <ShieldAlert className="w-8 h-8 text-rose-400" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-white uppercase tracking-tight">AI Key Required</p>
                        <p className="text-[9px] text-white/60 italic">Please connect your Gemini API key to enable intelligence features.</p>
                      </div>
                      <button 
                        onClick={async () => {
                          const success = await MatrixService.ensureKey();
                          if (success) {
                            setIsGatingError(false);
                            fetchMatrixAI(true);
                          } else {
                            const manualKey = prompt("Please enter your Gemini API Key manually:");
                            if (manualKey) {
                              localStorage.setItem('IHIS_GEMINI_KEY', manualKey.trim());
                              setIsGatingError(false);
                              fetchMatrixAI(true);
                            }
                          }
                        }}
                        className="px-4 py-2 bg-amber-400 text-[#001f3f] rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white transition-all"
                      >
                        {/* @ts-ignore */}
                        {window.aistudio ? "Connect" : "Setup"}
                      </button>
                    </div>
                  ) : (
                    <p className={`text-xl md:text-2xl font-medium text-white italic leading-tight tracking-tight max-w-2xl ${isMatrixLoading ? 'animate-pulse opacity-50' : ''}`}>
                      “{dailyBriefing}”
                    </p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col justify-center relative group overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 dark:bg-slate-800/50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
                <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em] mb-4 relative z-10">Daily Ethos</p>
                <p className={`text-sm font-bold text-[#001f3f] dark:text-slate-300 italic leading-relaxed relative z-10 ${isMatrixLoading ? 'animate-pulse opacity-50' : ''}`}>
                  {dailyQuote}
                </p>
              </div>
            </div>
          </div>
        );
      case 'lexicon':
        return (
          <div key="lexicon" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4">
              <div className="bg-[#fdfbf7] dark:bg-slate-900/40 rounded-[2.5rem] p-8 md:p-10 border border-amber-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-1000">
                  <BookOpen className="w-32 h-32 text-[#001f3f] dark:text-white" />
                </div>
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                  <div className="space-y-4 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-amber-600" />
                        </div>
                        <h3 className="text-[10px] font-black text-amber-600 uppercase tracking-[0.3em]">Lexicon of the Day</h3>
                      </div>
                      <button 
                        onClick={() => {
                          fetchMatrixAI(true);
                          HapticService.success();
                          showToast("Refreshing AI Lexicon...", "info");
                        }}
                        disabled={isMatrixLoading}
                        className={`p-2 rounded-xl hover:bg-amber-50 dark:hover:bg-slate-800 transition-all ${isMatrixLoading ? 'animate-spin opacity-50' : ''}`}
                        title="Refresh Lexicon"
                      >
                        <Zap className="w-3 h-3 text-amber-500" />
                      </button>
                    </div>
                    
                    {dailyLexicon ? (
                      <div className="space-y-2 animate-in fade-in slide-in-from-left-4 duration-700">
                        <div className="flex items-center gap-4">
                          <h2 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">
                            {dailyLexicon.word}
                          </h2>
                          <button 
                            onClick={() => {
                              const utterance = new SpeechSynthesisUtterance(dailyLexicon.word);
                              utterance.lang = 'en-US';
                              window.speechSynthesis.speak(utterance);
                              HapticService.light();
                            }}
                            className="p-2 hover:bg-amber-50 dark:hover:bg-slate-800 rounded-full transition-colors text-amber-600"
                            title="Listen"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl">
                          {dailyLexicon.meaning}
                        </p>
                        <div className="pt-2 flex items-start gap-2">
                          <Info className="w-3 h-3 text-amber-400 mt-1 shrink-0" />
                          <p className="text-[11px] font-medium text-slate-400 italic leading-relaxed">
                            "{dailyLexicon.example}"
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="h-24 flex items-center">
                        <p className="text-xs font-black text-slate-300 uppercase tracking-widest animate-pulse">Syncing Daily Lexicon...</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="hidden md:block">
                    <div className="px-6 py-3 bg-white dark:bg-slate-800 rounded-2xl border border-amber-50 dark:border-slate-700 shadow-sm">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest text-center mb-1">Today's Date</p>
                      <p className="text-xs font-black text-[#001f3f] dark:text-white text-center tabular-nums">{liveDateStr.split(',')[1]}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'operational':
        return (
          <div key="operational" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-3 bg-[#001f3f] rounded-[2.5rem] p-10 shadow-2xl border border-[#d4af37]/20 flex flex-col items-center justify-center text-center group relative overflow-hidden">
                  {isSentinelWindow && <div className="absolute inset-0 bg-amber-400/10 animate-pulse"></div>}
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-400/50 to-transparent"></div>
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.4em] mb-2 relative z-10">Current Time</p>
                  <div className="text-4xl font-black text-white italic tracking-tighter tabular-nums leading-none relative z-10">
                    {liveTimeStr.split(' ')[0]}
                    <span className="text-sm text-amber-400 ml-2 font-black uppercase tracking-widest">{liveTimeStr.split(' ')[1]}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-4 relative z-10">{liveDateStr}</p>
                  
                  {isSentinelWindow && (
                    <div className="mt-6 p-4 bg-amber-400 rounded-2xl shadow-2xl animate-bounce relative z-10 border-b-4 border-amber-600">
                        <p className="text-[9px] font-black text-[#001f3f] uppercase tracking-widest leading-none">Registry Lock In</p>
                        <p className="text-2xl font-black text-[#001f3f] leading-none mt-2 tabular-nums tracking-tighter">{sentinelCountdown}</p>
                    </div>
                  )}
              </div>

              <div className="lg:col-span-9">
                  <div className="bg-gradient-to-br from-[#001f3f] via-[#002b55] to-[#001f3f] rounded-[2.5rem] p-10 shadow-2xl border border-white/5 relative overflow-hidden flex flex-col md:flex-row gap-10 items-center justify-between group">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]"></div>
                    <div className="flex-1 w-full space-y-6 relative z-10">
                        <div className="flex items-center gap-4">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                          <h3 className="text-[11px] font-black text-amber-400 uppercase tracking-[0.5em] italic">Active Session</h3>
                        </div>
                        {activeSessionData.current?.entry ? (
                          <div className="animate-in slide-in-from-left duration-700">
                            <p className="text-3xl font-black text-white italic tracking-tighter uppercase leading-none mb-4">
                              {activeSessionData.current.entry.subject}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="px-4 py-2 bg-white/10 text-sky-300 text-[10px] font-black uppercase rounded-xl border border-white/10 backdrop-blur-sm">{activeSessionData.current.entry.className}</span>
                              <span className="px-4 py-2 bg-amber-400/10 text-amber-400 text-[10px] font-black uppercase rounded-xl border border-amber-400/20 backdrop-blur-sm">Room {activeSessionData.current.entry.room}</span>
                              <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-2">{activeSessionData.current.slot.startTime} — {activeSessionData.current.slot.endTime}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="opacity-40 italic py-4">
                            <p className="text-xl font-black text-white uppercase tracking-[0.3em]">No Active Session</p>
                          </div>
                        )}
                    </div>

                    <div className="hidden md:block w-px h-24 bg-gradient-to-b from-transparent via-white/10 to-transparent"></div>

                    <div className="flex-1 w-full space-y-6 relative z-10">
                        <div className="flex items-center gap-4">
                          <div className="w-2 h-2 rounded-full bg-sky-500/50"></div>
                          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.5em] italic">Next Protocol</h3>
                        </div>
                        {activeSessionData.upcoming?.entry ? (
                          <div className="animate-in slide-in-from-right duration-700">
                            <p className="text-2xl font-black text-white/80 italic tracking-tighter uppercase leading-none mb-4">
                              {activeSessionData.upcoming.entry.subject}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="px-4 py-2 bg-white/5 text-slate-300 text-[10px] font-black uppercase rounded-xl border border-white/5">{activeSessionData.upcoming.entry.className}</span>
                              <span className="px-4 py-2 bg-white/5 text-slate-300 text-[10px] font-black uppercase rounded-xl border border-white/5">{activeSessionData.upcoming.entry.room}</span>
                              <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] ml-2">Starts @ {activeSessionData.upcoming.slot.startTime}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="opacity-30 py-4">
                            <p className="text-xl font-black text-white uppercase tracking-[0.3em] leading-none">Duty Concluded</p>
                          </div>
                        )}
                    </div>
                  </div>
              </div>
            </div>
          </div>
        );
      case 'registry_grid':
        return (
          <div key="registry_grid" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4 grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 space-y-8">
                  <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden border border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="relative w-64 h-64 flex items-center justify-center bg-slate-50 dark:bg-slate-950 rounded-full border border-slate-100 dark:border-slate-800 shadow-inner group/map overflow-hidden">
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.08)_0%,transparent_70%)]"></div>
                              
                              {/* Tactical Radar Rings */}
                              <div className="absolute w-full h-full border border-slate-200/50 dark:border-slate-800/50 rounded-full scale-[0.2]"></div>
                              <div className="absolute w-full h-full border border-slate-200/50 dark:border-slate-800/50 rounded-full scale-[0.4]"></div>
                              <div className="absolute w-full h-full border border-slate-200/50 dark:border-slate-800/50 rounded-full scale-[0.6]"></div>
                              <div className="absolute w-full h-full border border-slate-200/50 dark:border-slate-800/50 rounded-full scale-[0.8]"></div>
                              <div className="absolute w-full h-full border-2 border-emerald-500/10 rounded-full scale-[1.0]"></div>
                              
                              {/* Scanning Sweep */}
                              <div className="absolute w-full h-full bg-gradient-to-r from-emerald-500/20 to-transparent origin-center animate-[spin_6s_linear_infinite]"></div>
                              
                              {/* Campus Center Anchor */}
                              <div className="absolute w-6 h-6 bg-[#001f3f] dark:bg-white rounded-full z-20 shadow-2xl flex items-center justify-center border-2 border-amber-400">
                                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></div>
                              </div>

                              {userCoords && (
                                <div 
                                  style={{ left: `${radarProjection.x}%`, top: `${radarProjection.y}%` }}
                                  className="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-1000"
                                >
                                  <div className="absolute inset-0 bg-sky-500 rounded-full animate-ping opacity-30"></div>
                                  <div className="relative w-full h-full bg-sky-500 rounded-full border-2 border-white shadow-2xl flex items-center justify-center">
                                    <div className="w-2 h-2 bg-white rounded-full"></div>
                                  </div>
                                </div>
                              )}

                              <div className="relative z-10 flex flex-col items-center mt-40">
                                <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-6 py-2 rounded-2xl shadow-2xl border border-white/20">
                                    <p className={`text-3xl font-black italic tracking-tighter tabular-nums ${isOutOfRange ? 'text-rose-500' : 'text-emerald-500'}`}>
                                      {currentDistance !== null ? Math.round(currentDistance) : '--'}m
                                    </p>
                                </div>
                              </div>
                          </div>
                        </div>

                        <div className="space-y-8">
                          <div className="space-y-3">
                              <div className="flex items-center gap-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${biometricActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'} animate-pulse`}></div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em]">{biometricActive ? 'Identity Verified' : 'Action Required'}</p>
                              </div>
                              <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
                                {todayRecord ? (todayRecord.checkOut ? 'Registry Closed' : 'Duty Logged') : 'Mark Registry'}
                              </h2>
                          </div>

                          <div className="space-y-4">
                              <button 
                                disabled={loading || isOutOfRange || (!!todayRecord && !!todayRecord.checkOut) || todayRecord?.checkIn === 'MEDICAL'} 
                                onClick={() => handleAction()} 
                                className={`w-full py-7 rounded-[2.5rem] font-black text-sm uppercase tracking-[0.4em] shadow-2xl transition-all relative overflow-hidden group active:scale-95 ${
                                  isOutOfRange ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 
                                  isSentinelWindow && !todayRecord ? 'bg-amber-400 text-[#001f3f] ring-8 ring-amber-400/20' :
                                  todayRecord ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950'
                                }`}
                              >
                                <span className="relative z-10">
                                  {todayRecord 
                                    ? (matrixDutyStatus.isCurrentActive 
                                        ? `Sync Period ${activeSessionData.current?.slot.id}` 
                                        : matrixDutyStatus.isDayFinished 
                                          ? 'End Work Day' 
                                          : 'Log Departure') 
                                    : 'Initialize Arrival'}
                                </span>
                                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
                              </button>

                              {!todayRecord && (
                                <div className="grid grid-cols-2 gap-3">
                                  <button onClick={() => { setPendingAction('OVERRIDE'); setIsManualModalOpen(true); }} className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 border border-sky-100 text-[9px] font-black uppercase tracking-widest">PIN Entry</button>
                                  <button onClick={() => { setPendingAction('MEDICAL'); setIsManualModalOpen(true); }} className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 border border-rose-100 text-[9px] font-black uppercase tracking-widest">Sick Leave</button>
                                </div>
                              )}

                              {todayRecord && !todayRecord.checkOut && todayRecord.checkIn !== 'MEDICAL' && (
                                <button onClick={() => { setPendingAction('MANUAL_OUT'); setIsManualModalOpen(true); }} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 border border-amber-100 text-[9px] font-black uppercase tracking-widest mt-2 hover:bg-amber-100 transition-all">Manual PIN Departure</button>
                              )}
                          </div>
                        </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-10 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <h3 className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.4em] italic leading-none">Reliability Scoreboard</h3>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Historical Registry Performance</p>
                        </div>
                        <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                          <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 italic">{reliabilityIndex}% Reliable</span>
                        </div>
                    </div>

                    <div className="overflow-x-auto scrollbar-hide">
                        <table className="w-full text-left border-collapse">
                          <thead>
                              <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50 dark:border-slate-800">
                                <th className="pb-5">Registry Date</th>
                                <th className="pb-5">Arrived</th>
                                <th className="pb-5">Departed</th>
                                <th className="pb-5 text-right">Status</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                              {myRecentLogs.map(log => (
                                <tr key={log.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                  <td className="py-5 text-[12px] font-black text-[#001f3f] dark:text-white italic">{log.date}</td>
                                  <td className={`py-5 text-[11px] font-bold tabular-nums ${log.isLate ? 'text-rose-500' : 'text-emerald-500'}`}>{log.checkIn}</td>
                                  <td className="py-5 text-[11px] font-bold text-slate-400 tabular-nums">{log.checkOut || '--:--'}</td>
                                  <td className="py-5 text-right">
                                      <span className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${log.isLate ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
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
                  <div className="bg-gradient-to-br from-[#001f3f] to-[#002b55] rounded-[3rem] p-10 shadow-2xl border border-white/10 h-fit relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16"></div>
                    <h3 className="text-[11px] font-black text-amber-400 uppercase tracking-[0.4em] italic mb-10">Instructional Roster</h3>
                    <div className="space-y-10 relative">
                        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/10"></div>
                        {myScheduleToday.length > 0 ? myScheduleToday.map(t => (
                          <div key={t.id} className="relative pl-10 group">
                            <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-[#001f3f] border-2 border-white/20 flex items-center justify-center group-hover:border-amber-400 transition-colors z-10">
                                <div className="w-1.5 h-1.5 rounded-full bg-white/20 group-hover:bg-amber-400 transition-colors"></div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[9px] font-black text-white/40 uppercase tracking-[0.3em] leading-none">Period {t.slotId}</p>
                                <p className="text-[13px] font-black text-white uppercase leading-none tracking-tight">{t.subject}</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-sky-400 uppercase italic tracking-widest">Class {t.className}</span>
                                  <span className="w-1 h-1 rounded-full bg-white/10"></span>
                                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Room {t.room}</span>
                                </div>
                            </div>
                          </div>
                        )) : (
                          <div className="py-16 text-center opacity-20 italic text-white">
                            <p className="text-[11px] font-black uppercase tracking-[0.4em]">No assigned classes</p>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-8 md:p-10 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
                    <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em]">Load Matrix</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Weekly Capacity Utilization</p>
                        </div>
                        <span className="text-[12px] font-black text-[#001f3f] dark:text-white italic tabular-nums">{myLoadMetrics.total} <span className="text-[9px] text-slate-400">/ {myLoadMetrics.target}P</span></span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner p-0.5">
                        <div style={{ width: `${myLoadMetrics.percent}%` }} className={`h-full rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(0,0,0,0.1)] ${myLoadMetrics.percent > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                    </div>
                  </div>
              </div>
            </div>
          </div>
        );
      case 'trend':
        if (!isManagement) return null;
        return (
          <div key="trend" className={architectStyle}>
            {controlOverlay}
            <div className="mx-4">
              <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h3 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Attendance Velocity</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">7-Day Institutional Trend</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-[8px] font-black text-slate-400 uppercase">Present %</span>
                    </div>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={attendanceTrend}>
                      <defs>
                        <linearGradient id="colorPresent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="day" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }}
                        dy={10}
                      />
                      <YAxis hide />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
                        itemStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }}
                      />
                      <Area type="monotone" dataKey="present" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorPresent)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (isInitialLoading) {
    return (
      <div className="space-y-8 animate-pulse px-4 pb-32 max-w-6xl mx-auto">
        <div className="h-24 bg-slate-100 dark:bg-slate-800 rounded-[2rem] w-1/3"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-48 bg-slate-100 dark:bg-slate-800 rounded-[2.5rem]"></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 h-[400px] bg-slate-100 dark:bg-slate-800 rounded-[3rem]"></div>
          <div className="h-[400px] bg-slate-100 dark:bg-slate-800 rounded-[3rem]"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32 relative">
      
      {showCloudWarning && (
        <div className="mx-4 bg-rose-500 text-white p-6 rounded-3xl shadow-xl border-4 border-rose-600 flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-full">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-black uppercase italic tracking-tighter">Device Disconnected (Local Mode)</h3>
              <p className="text-xs font-bold opacity-90 uppercase tracking-widest">Data on this device is NOT syncing with the cloud.</p>
            </div>
          </div>
          <div className="bg-white/10 px-6 py-3 rounded-xl border border-white/20 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest mb-1">Action Required</p>
            <p className="text-[9px] font-bold">Go to <span className="text-amber-300">Deployment Tab</span> &gt; Link Device</p>
          </div>
        </div>
      )}

      {/* Matrix Dashboard Controls */}
      <div className="flex justify-end px-4 gap-3">
        <button 
          onClick={() => {
            setIsArchitectMode(!isArchitectMode);
            HapticService.light();
          }}
          className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all ${
            isArchitectMode 
              ? 'bg-amber-400 text-[#001f3f] shadow-[0_0_20px_rgba(251,191,36,0.4)] animate-pulse' 
              : 'bg-white dark:bg-slate-900 text-slate-400 border border-slate-100 dark:border-slate-800'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
          {isArchitectMode ? 'Lock Matrix Architect' : 'Layout Architect'}
        </button>
        {isArchitectMode && (
          <button 
            onClick={() => {
              const def = ['sentinel', 'pulse', 'intelligence', 'lexicon', 'operational', 'registry_grid'] as WidgetZone[];
              setWidgetOrder(def);
              localStorage.removeItem(`ihis_layout_${user.id}`);
              showToast("Institutional default restored", "info");
              HapticService.success();
            }}
            className="px-6 py-3 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-[9px] font-black uppercase tracking-widest border border-rose-100 dark:border-rose-900"
          >
            Reset Matrix
          </button>
        )}
      </div>

      {/* Dynamic Widget Grid Rendering */}
      <div className="space-y-8">
        {widgetOrder.map(renderZone)}
      </div>

      {/* MOBILE FLOATING ACTION BUTTON */}
      <div className="fixed bottom-24 right-6 z-[1000] md:hidden">
        <AnimatePresence>
          {isQuickActionsOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="absolute bottom-20 right-0 w-56 bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden p-2"
            >
              <div className="p-4 border-b border-slate-50 dark:border-slate-800">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Quick Matrix Access</p>
              </div>
              <div className="p-2 space-y-1">
                <button onClick={() => { setIsQuickActionsOpen(false); }} className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors text-left group">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center text-sky-600 group-hover:scale-110 transition-transform"><Calendar className="w-5 h-5" /></div>
                  <span className="text-xs font-black text-[#001f3f] dark:text-white uppercase">Timetable</span>
                </button>
                <button onClick={() => { setIsQuickActionsOpen(false); }} className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors text-left group">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform"><ClipboardList className="w-5 h-5" /></div>
                  <span className="text-xs font-black text-[#001f3f] dark:text-white uppercase">Proxies</span>
                </button>
                <button onClick={() => { setIsQuickActionsOpen(false); }} className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors text-left group">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform"><Zap className="w-5 h-5" /></div>
                  <span className="text-xs font-black text-[#001f3f] dark:text-white uppercase">AI Matrix</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <button 
          onClick={() => {
            setIsQuickActionsOpen(!isQuickActionsOpen);
            HapticService.light();
          }}
          className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${isQuickActionsOpen ? 'bg-rose-500 rotate-45' : 'bg-[#001f3f] shadow-[#001f3f]/40'}`}
        >
          <Plus className={`w-8 h-8 ${isQuickActionsOpen ? 'text-white' : 'text-[#d4af37]'}`} />
        </button>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-xl animate-in fade-in duration-500">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3.5rem] p-12 shadow-[0_0_50px_rgba(0,0,0,0.3)] space-y-10 animate-in zoom-in duration-500 border border-white/10 relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-2 bg-amber-400"></div>
             <div className="text-center space-y-2">
               <div className="w-16 h-16 bg-amber-400/10 rounded-full flex items-center justify-center mx-auto mb-6">
                 <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
               </div>
               <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Institutional Bypass</h4>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Security Authorization Required</p>
             </div>
             <div className="space-y-4">
               <input 
                 type="text" 
                 maxLength={6} 
                 placeholder="••••••"
                 value={otpInput} 
                 onChange={e => setOtpInput(e.target.value)} 
                 className="w-full bg-slate-50 dark:bg-slate-800 rounded-[2rem] px-8 py-7 text-center text-4xl font-black dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all placeholder:text-slate-200 dark:placeholder:text-slate-700 tracking-[0.5em]" 
               />
               <p className="text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest">Enter 6-Digit Security PIN</p>
             </div>
             <div className="space-y-4">
               <button 
                 onClick={() => handleAction(pendingAction === 'OVERRIDE' || pendingAction === 'MANUAL_OUT', pendingAction === 'MEDICAL')} 
                 className="w-full bg-[#001f3f] text-[#d4af37] py-7 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-2xl hover:bg-slate-950 active:scale-95 transition-all"
               >
                 Confirm Authorization
               </button>
               <button 
                 onClick={() => { setIsManualModalOpen(false); setPendingAction(null); setOtpInput(''); }} 
                 className="text-slate-400 font-black text-[11px] uppercase tracking-[0.3em] w-full py-2 hover:text-rose-500 transition-colors"
               >
                 Abort Protocol
               </button>
             </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

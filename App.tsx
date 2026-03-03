
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, AppTab, SchoolNotification, SectionType, SandboxLog, FeaturePower, InstitutionalResponsibility } from './types.ts';
import { INITIAL_USERS, INITIAL_CONFIG, DAYS, SCHOOL_NAME, DEFAULT_PERMISSIONS, DUMMY_ATTENDANCE, DUMMY_TIMETABLE, DUMMY_SUBSTITUTIONS } from './constants.ts';
import { Search, Command, Keyboard, Download, BarChart3, Settings, LogOut, User as UserIcon, Calendar, ClipboardList, ShieldAlert, Cpu } from 'lucide-react';
import Login from './components/Login.tsx';
import Dashboard from './components/Dashboard.tsx';
import Sidebar from './components/Sidebar.tsx';
import MobileNav from './components/MobileNav.tsx';
import Navbar from './components/Navbar.tsx';
import AttendanceView from './components/AttendanceView.tsx';
import UserManagement from './components/UserManagement.tsx';
import TimeTableView from './components/TimeTableView.tsx';
import BatchTimetableView from './components/BatchTimetableView.tsx';
import SubstitutionView from './components/SubstitutionView.tsx';
import AdminConfigView from './components/AdminConfigView.tsx';
import FacultyAssignmentView from './components/FacultyAssignmentView.tsx';
import CombinedBlockView from './components/CombinedBlockView.tsx';
import LabPeriodsView from './components/LabPeriodsView.tsx';
import ExtraCurricularView from './components/ExtraCurricularView.tsx';
import DeploymentView from './components/DeploymentView.tsx';
import ReportingView from './components/ReportingView.tsx';
import ProfileView from './components/ProfileView.tsx';
import OtpManagementView from './components/OtpManagementView.tsx';
import HandbookView from './components/HandbookView.tsx';
import AdminControlCenter from './components/AdminControlCenter.tsx';
import SandboxControl from './components/SandboxControl.tsx';
import CampusOccupancyView from './components/CampusOccupancyView.tsx';
import AIAnalyticsView from './components/AIAnalyticsView.tsx';
import LessonArchitectView from './components/LessonArchitectView.tsx';
import ExamPreparer from './components/ExamPreparer.tsx';
import { supabase, IS_CLOUD_ENABLED } from './supabaseClient.ts';
import { NotificationService } from './services/notificationService.ts';
import { SyncService } from './services/syncService.ts';
import { HapticService } from './services/hapticService.ts';
import { generateUUID } from './utils/idUtils.ts';
import { formatBahrainDate, getBahrainTime } from './utils/dateUtils.ts';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [dbLoading, setDbLoading] = useState(false);
  const [cloudSyncLoaded, setCloudSyncLoaded] = useState(false); 
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');

  // SANDBOX INFRASTRUCTURE
  const [isSandbox, setIsSandbox] = useState(false);
  const [sandboxLogs, setSandboxLogs] = useState<SandboxLog[]>([]);

  const syncStatus = useRef<'IDLE' | 'SYNCING' | 'READY'>('IDLE');
  const currentUserRef = useRef<User | null>(null);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('ihis_dark_mode');
    return saved === 'true';
  });

  // DATA REPOSITORY (LIVE)
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('ihis_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });
  
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(DUMMY_ATTENDANCE);
  const [timetable, setTimetable] = useState<TimeTableEntry[]>(DUMMY_TIMETABLE);
  const [timetableDraft, setTimetableDraft] = useState<TimeTableEntry[]>(() => {
    const saved = localStorage.getItem('ihis_timetable_draft');
    return saved ? JSON.parse(saved) : [];
  });
  const [substitutions, setSubstitutions] = useState<SubstitutionRecord[]>(DUMMY_SUBSTITUTIONS);
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>(INITIAL_CONFIG);
  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignment[]>([]);
  const [notifications, setNotifications] = useState<SchoolNotification[]>([]);

  // DATA REPOSITORY (SANDBOX)
  const [sUsers, setSUsers] = useState<User[]>([]);
  const [sAttendance, setSAttendance] = useState<AttendanceRecord[]>([]);
  const [sTimetable, setSTimetable] = useState<TimeTableEntry[]>([]);
  const [sTimetableDraft, setSTimetableDraft] = useState<TimeTableEntry[]>([]);
  const [sSubstitutions, setSSubstitutions] = useState<SubstitutionRecord[]>([]);
  const [sSchoolConfig, setSSchoolConfig] = useState<SchoolConfig>(INITIAL_CONFIG);
  const [sTeacherAssignments, setSTeacherAssignments] = useState<TeacherAssignment[]>([]);

  // DYNAMIC REPOSITORY SELECTOR
  const dUsers = isSandbox ? sUsers : users;
  const dAttendance = isSandbox ? sAttendance : attendance;
  const dTimetable = isSandbox ? sTimetable : timetable;
  const dTimetableDraft = isSandbox ? sTimetableDraft : timetableDraft;
  const dSubstitutions = isSandbox ? sSubstitutions : substitutions;
  const dSchoolConfig = isSandbox ? sSchoolConfig : schoolConfig;
  const dTeacherAssignments = isSandbox ? sTeacherAssignments : teacherAssignments;

  // WRAPPED SETTERS
  const setDUsers: React.Dispatch<React.SetStateAction<User[]>> = isSandbox ? setSUsers : setUsers;
  const setDAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>> = isSandbox ? setSAttendance : setAttendance;
  const setDTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>> = isSandbox ? setSTimetable : setTimetable;
  const setDTimetableDraft: React.Dispatch<React.SetStateAction<TimeTableEntry[]>> = isSandbox ? setSTimetableDraft : setTimetableDraft;
  const setDSubstitutions: React.Dispatch<React.SetStateAction<SubstitutionRecord[]>> = isSandbox ? setSSubstitutions : setSubstitutions;
  const setDSchoolConfig: React.Dispatch<React.SetStateAction<SchoolConfig>> = isSandbox ? setSSchoolConfig : setSchoolConfig;
  const setDTeacherAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>> = isSandbox ? setSTeacherAssignments : setTeacherAssignments;

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
    if (type === 'success') HapticService.light();
    else if (type === 'error') HapticService.error();
    setTimeout(() => setToast(null), 4000);
  }, []);

  const addSandboxLog = useCallback((action: string, payload: any) => {
    if (!isSandbox) return;
    const newLog: SandboxLog = {
      id: generateUUID(),
      timestamp: new Date().toLocaleTimeString(),
      action,
      payload
    };
    setSandboxLogs(prev => [newLog, ...prev].slice(0, 50));
  }, [isSandbox]);

  const simGenerateRandomAbsences = useCallback(() => {
    if (!isSandbox) return;
    const todayStr = formatBahrainDate();
    const count = 15;
    const pool = dUsers.filter(u => u.role !== UserRole.ADMIN && !u.isResigned);
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);

    const newRecords: AttendanceRecord[] = selected.map(u => ({
      id: generateUUID(),
      userId: u.id,
      userName: u.name,
      date: todayStr,
      checkIn: 'MEDICAL',
      checkOut: 'ABSENT',
      isManual: true,
      reason: 'Simulated Medical Leave'
    }));

    setDAttendance(prev => {
      const filtered = prev.filter(r => r.date !== todayStr || !selected.some(s => s.id === r.userId));
      return [...newRecords, ...filtered];
    });
    addSandboxLog('SIM_CRISIS_GENERATED', { count: selected.length });
    showToast("Simulation: Staff Crisis Matrix Generated", "warning");
  }, [isSandbox, dUsers, addSandboxLog, showToast, setDAttendance]);

  const simClearAllProxies = useCallback(() => {
    if (!isSandbox) return;
    const todayStr = formatBahrainDate();
    setDSubstitutions(prev => prev.filter(s => s.date !== todayStr));
    addSandboxLog('SIM_PROXIES_PURGED', { date: todayStr });
    showToast("Simulation: Daily Proxies Purged", "info");
  }, [isSandbox, addSandboxLog, showToast, setDSubstitutions]);

  const simForceLateArrivals = useCallback(() => {
    if (!isSandbox) return;
    const todayStr = formatBahrainDate();
    const pool = dUsers.filter(u => u.role !== UserRole.ADMIN && !u.isResigned);
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selectedCount = 10;
    const finalSelected = shuffled.slice(0, selectedCount);

    const newRecords: AttendanceRecord[] = finalSelected.map(u => ({
      id: generateUUID(),
      userId: u.id,
      userName: u.name,
      date: todayStr,
      checkIn: '07:45 AM',
      isManual: false,
      isLate: true,
      reason: 'Simulated Tardiness'
    }));

    setDAttendance(prev => {
      const filtered = prev.filter(r => r.date !== todayStr || !finalSelected.some(s => s.id === r.userId));
      return [...newRecords, ...filtered];
    });
    addSandboxLog('SIM_TARDINESS_GENERATED', { count: finalSelected.length });
    showToast("Simulation: Late Arrival Logs Generated", "warning");
  }, [isSandbox, dUsers, addSandboxLog, showToast, setDAttendance]);

  const enterSandbox = () => {
    setSUsers([...users]);
    setSAttendance([...attendance]);
    setSTimetable([...timetable]);
    setSTimetableDraft([...timetableDraft]);
    setSSubstitutions([...substitutions]);
    setSSchoolConfig({ ...schoolConfig });
    setSTeacherAssignments([...teacherAssignments]);
    setIsSandbox(true);
    showToast("Sandbox Mode Activated", "warning");
  };

  const exitSandbox = () => {
    setIsSandbox(false);
    showToast("Sandbox Purged. Reverting to Live Registry.", "info");
  };

  useEffect(() => {
    const handleOnline = async () => {
      if (isSandbox) return;
      const synced = await SyncService.processQueue();
      if (synced) showToast("Background Sync Completed", "success");
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [showToast, isSandbox]);

  useEffect(() => {
    localStorage.setItem('ihis_dark_mode', String(isDarkMode));
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const hasAccess = useCallback((tab: AppTab) => {
    if (!currentUser) return false;
    const cloudPermissions = dSchoolConfig.permissions || {};
    const defaultPermissions = DEFAULT_PERMISSIONS[currentUser.role] || [];
    const roleCloudPermissions = cloudPermissions[currentUser.role] || [];
    const allowedTabs = Array.from(new Set([...defaultPermissions, ...roleCloudPermissions]));
    return allowedTabs.includes(tab);
  }, [currentUser, dSchoolConfig]);

  const loadMatrixData = useCallback(async () => {
    if (!IS_CLOUD_ENABLED || syncStatus.current !== 'IDLE') {
      const boot = document.querySelector('.boot-screen');
      if (boot) boot.remove();
      return;
    }
    syncStatus.current = 'SYNCING';
    setDbLoading(true);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateLimit = thirtyDaysAgo.toISOString().split('T')[0];
    try {
      const [pRes, aRes, tRes, tdRes, sRes, cRes, taRes] = await Promise.all([
        supabase.from('profiles').select('id, employee_id, password, name, email, role, secondary_roles, feature_overrides, responsibilities, expertise, class_teacher_of, phone_number, telegram_chat_id, is_resigned, ai_authorized, biometric_public_key'),
        supabase.from('attendance').select('*').gte('date', dateLimit).order('date', { ascending: false }),
        supabase.from('timetable_entries').select('*'),
        supabase.from('timetable_drafts').select('*'),
        supabase.from('substitution_ledger').select('*').gte('date', dateLimit).order('date', { ascending: false }),
        supabase.from('school_config').select('config_data').eq('id', 'primary_config').single(),
        supabase.from('teacher_assignments').select('*')
      ]);
      if (pRes.data) {
        const mappedUsers = pRes.data.map((u: any) => ({
          id: u.id, employee_id: u.employee_id, password: u.password, name: u.name, email: u.email,
          role: u.role, secondaryRoles: u.secondary_roles || [], featureOverrides: u.feature_overrides || [],
          responsibilities: u.responsibilities || [],
          classTeacherOf: u.class_teacher_of || undefined,
          phone_number: u.phone_number || undefined, telegram_chat_id: u.telegram_chat_id || undefined, 
          isResigned: u.is_resigned, expertise: u.expertise || [],
          ai_authorized: u.ai_authorized,
          biometric_public_key: u.biometric_public_key
        }));
        setUsers(mappedUsers);
        localStorage.setItem('ihis_users', JSON.stringify(mappedUsers));
        if (mappedUsers.length > 0) {
          console.log(`[IHIS] Registry Sync: ${mappedUsers.length} profiles loaded. First ID: ${mappedUsers[0].employee_id}`);
        }
      }
      if (aRes.data) setAttendance(aRes.data.map((r: any) => ({
        id: r.id, userId: r.user_id, userName: pRes.data?.find((u: any) => u.id === r.user_id)?.name || 'Unknown',
        date: r.date, checkIn: r.check_in, check_out: r.check_out || undefined, isManual: r.is_manual, isLate: r.is_late,
        location: r.location ? { lat: r.location.lat, lng: r.location.lng } : undefined, reason: r.reason || undefined
      })));
      const mapEntry = (e: any) => ({
        id: e.id, section: e.section, wingId: e.wing_id, gradeId: e.grade_id, sectionId: e.section_id, className: e.class_name, day: e.day, slotId: e.slot_id,
        subject: e.subject, subjectCategory: e.subject_category, teacherId: e.teacher_id, teacherName: e.teacher_name,
        room: e.room || undefined, date: e.date || undefined, isSubstitution: e.is_substitution, blockId: e.block_id || undefined, blockName: e.block_name || undefined,
        isDouble: e.is_double || false, isSplitLab: e.is_split_lab || false, secondaryTeacherId: e.secondary_teacher_id || undefined, secondaryTeacherName: e.secondary_teacher_name || undefined,
        isManual: e.is_manual || false
      });
      if (tRes.data) setTimetable(tRes.data.map(mapEntry));
      if (tdRes.data) setTimetableDraft(tdRes.data.map(mapEntry));
      if (sRes.data) setSubstitutions(sRes.data.map((s: any) => ({
        id: s.id, date: s.date, slotId: s.slot_id, wingId: s.wing_id, gradeId: s.grade_id, sectionId: s.section_id,
        className: s.class_name, subject: s.subject,
        absentTeacherId: s.absent_teacher_id, absentTeacherName: s.absent_teacher_name,
        substituteTeacherId: s.substitute_teacher_id, substituteTeacherName: s.substitute_teacher_name,
        section: s.section, isArchived: s.is_archived, lastNotifiedAt: s.last_notified_at || undefined
      })));
      if (cRes.data) {
        setSchoolConfig(prev => ({ ...INITIAL_CONFIG, ...prev, ...(cRes.data.config_data || {}) }));
      }
      if (taRes.data) setTeacherAssignments(taRes.data.map((ta: any) => ({
        id: ta.id, teacherId: ta.teacher_id, gradeId: ta.grade_id, loads: ta.loads, 
        targetSectionIds: ta.target_section_ids, groupPeriods: ta.group_periods, 
        anchorSubject: ta.anchor_subject, anchorPeriods: ta.anchor_periods,
        forceAnchorSlot1: ta.force_anchor_slot1
      })));

      // Check for partial failures (RLS issues)
      const errors = [pRes, aRes, tRes, tdRes, sRes, cRes, taRes].filter(r => r.error);
      if (errors.length > 0) {
        const firstError = errors[0].error;
        if (firstError?.code === '42501') {
          showToast("Database Connected but Access Denied (Check RLS Policies)", "warning");
        } else {
          showToast(`Partial Data Load: ${firstError?.message}`, "warning");
        }
      }

      // Global diagnostic update
      (window as any).IHIS_DATA_DIAG = {
        profiles: pRes.data?.length || 0,
        attendance: aRes.data?.length || 0,
        timetable: tRes.data?.length || 0,
        substitutions: sRes.data?.length || 0,
        config: !!cRes.data ? 'LOADED' : 'MISSING'
      };

      setCloudSyncLoaded(true);
      syncStatus.current = 'READY';
    } catch (e: any) {
      console.error("[IHIS] Cloud Sync Failed:", e);
      const errorMsg = e.message || "Unknown Network Error";
      showToast(`Database Error: ${errorMsg}`, "error");
      syncStatus.current = 'IDLE';
    } finally {
      setDbLoading(false);
      const boot = document.querySelector('.boot-screen');
      if (boot) boot.remove();
    }
  }, []);

  useEffect(() => {
    if (!isSandbox) {
      localStorage.setItem('ihis_users', JSON.stringify(users));
    }
  }, [users, isSandbox]);

  useEffect(() => {
    if (!isSandbox) {
      localStorage.setItem('ihis_timetable_draft', JSON.stringify(timetableDraft));
    }
  }, [timetableDraft, isSandbox]);

  useEffect(() => { 
    console.log(`[IHIS] Matrix Initialization: ${IS_CLOUD_ENABLED ? 'CLOUD' : 'LOCAL'} mode active.`);
    loadMatrixData(); 
  }, [loadMatrixData]);

  // REALTIME SUBSCRIPTIONS: PROFILES & ASSIGNMENTS
  useEffect(() => {
    if (!IS_CLOUD_ENABLED || isSandbox) return;

    const channel = supabase.channel('realtime_matrix')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
           const u = payload.new;
           const mapped: User = {
             id: u.id, employee_id: u.employee_id, password: u.password, name: u.name, email: u.email,
             role: u.role, secondaryRoles: u.secondary_roles || [], featureOverrides: u.feature_overrides || [],
             responsibilities: u.responsibilities || [],
             classTeacherOf: u.class_teacher_of || undefined,
             phone_number: u.phone_number || undefined, telegram_chat_id: u.telegram_chat_id || undefined, 
             isResigned: u.is_resigned, expertise: u.expertise || [],
             ai_authorized: u.ai_authorized,
             biometric_public_key: u.biometric_public_key
           };
           
           setUsers(prev => {
             const exists = prev.find(p => p.id === mapped.id);
             if (exists) return prev.map(p => p.id === mapped.id ? mapped : p);
             return [...prev, mapped];
           });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teacher_assignments' }, payload => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
           const ta = payload.new;
           const mapped: TeacherAssignment = {
             id: ta.id, teacherId: ta.teacher_id, gradeId: ta.grade_id, loads: ta.loads, 
             targetSectionIds: ta.target_section_ids, groupPeriods: ta.group_periods, 
             anchorSubject: ta.anchor_subject, anchorPeriods: ta.anchor_periods,
             forceAnchorSlot1: ta.force_anchor_slot1
           };
           
           setTeacherAssignments(prev => {
             const exists = prev.find(a => a.id === mapped.id);
             if (exists) return prev.map(a => a.id === mapped.id ? mapped : a);
             return [...prev, mapped];
           });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isSandbox]);

  // BACKGROUND WORKER: AUTO-ROTATE PIN EVERY 1 HOUR
  useEffect(() => {
    if (!currentUser || currentUser.role !== UserRole.ADMIN || !dSchoolConfig.autoRotateOtp || isSandbox) return;

    const rotationCheck = setInterval(async () => {
      const lastRotation = new Date(dSchoolConfig.lastOtpRotation || Date.now()).getTime();
      const nextRotation = lastRotation + (60 * 60 * 1000); // 1 hour threshold
      const now = Date.now();

      if (now >= nextRotation) {
        const newKey = Math.floor(100000 + Math.random() * 900000).toString();
        const updatedConfig = { 
          ...dSchoolConfig, 
          attendanceOTP: newKey, 
          lastOtpRotation: new Date().toISOString() 
        };
        
        setDSchoolConfig(updatedConfig);
        
        if (IS_CLOUD_ENABLED) {
          try {
            await supabase.from('school_config').upsert({ 
              id: 'primary_config', 
              config_data: updatedConfig, 
              updated_at: new Date().toISOString() 
            });
            console.log("IHIS Sentinel: Automatic Matrix Key Rotation Successful.");
          } catch (e) {
            console.warn("IHIS Sentinel: Auto-rotation cloud sync failed.", e);
          }
        }
      }
    }, 10000); // Polls every 10 seconds silently

    return () => clearInterval(rotationCheck);
  }, [currentUser, dSchoolConfig, isSandbox, setDSchoolConfig]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command Palette: Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
      
      // Shortcuts only if logged in
      if (!currentUser) return;

      // Navigation Shortcuts: Alt + [Key]
      if (e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'd': setActiveTab('dashboard'); break;
          case 't': setActiveTab('timetable'); break;
          case 's': setActiveTab('substitutions'); break;
          case 'a': setActiveTab('ai_analytics'); break;
          case 'r': setActiveTab('reports'); break;
          case 'p': setActiveTab('profile'); break;
        }
      }

      // Escape to close palette
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUser]);

  const commandResults = useMemo(() => {
    if (!commandSearch.trim()) return [];
    const search = commandSearch.toLowerCase();
    const results: { id: string; title: string; subtitle: string; icon: any; action: () => void }[] = [];

    // Navigation results
    const navItems = [
      { id: 'nav-dash', title: 'Dashboard', subtitle: 'Institutional Pulse', icon: BarChart3, tab: 'dashboard' },
      { id: 'nav-time', title: 'Timetable', subtitle: 'Matrix Registry', icon: Calendar, tab: 'timetable' },
      { id: 'nav-sub', title: 'Substitutions', subtitle: 'Proxy Ledger', icon: ClipboardList, tab: 'substitutions' },
      { id: 'nav-ai', title: 'AI Analytics', subtitle: 'Intelligence Matrix', icon: Cpu, tab: 'ai_analytics' },
      { id: 'nav-rep', title: 'Reports', subtitle: 'Data Exports', icon: Download, tab: 'reports' },
    ];

    navItems.forEach(item => {
      if (item.title.toLowerCase().includes(search) && hasAccess(item.tab as AppTab)) {
        results.push({ ...item, action: () => { setActiveTab(item.tab as AppTab); setIsCommandPaletteOpen(false); } });
      }
    });

    // Staff results
    dUsers.forEach(u => {
      if (u.name.toLowerCase().includes(search) || u.employee_id.toLowerCase().includes(search)) {
        results.push({
          id: `user-${u.id}`,
          title: u.name,
          subtitle: `${u.employee_id} • ${u.role.replace(/_/g, ' ')}`,
          icon: UserIcon,
          action: () => { 
            // In a real app we'd navigate to user profile or search in user management
            setActiveTab('users');
            setIsCommandPaletteOpen(false);
          }
        });
      }
    });

    return results.slice(0, 8);
  }, [commandSearch, dUsers, hasAccess]);

  if (dbLoading) return null;

  return (
    <div className={`h-full w-full flex flex-col bg-transparent overflow-hidden ${isSandbox ? 'border-[8px] border-amber-500' : ''}`}>
      {!currentUser ? (
        <Login users={dUsers} isDarkMode={isDarkMode} onLogin={setCurrentUser} onRefreshRegistry={loadMatrixData} />
      ) : (
        <div className="h-full w-full flex overflow-hidden">
          <Sidebar role={currentUser.role as UserRole} activeTab={activeTab} setActiveTab={setActiveTab} config={dSchoolConfig} isSidebarOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} hasAccess={hasAccess} />
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
            <Navbar user={currentUser} onLogout={() => setCurrentUser(null)} isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} notifications={notifications} setNotifications={setNotifications} />
            <main className="flex-1 overflow-y-auto scrollbar-hide px-4 md:px-8 py-6 relative">
              {activeTab === 'dashboard' && hasAccess('dashboard') && <Dashboard user={currentUser} users={dUsers} attendance={dAttendance} setAttendance={setDAttendance} substitutions={dSubstitutions} currentOTP={dSchoolConfig.attendanceOTP || '123456'} setOTP={(otp) => setDSchoolConfig({...dSchoolConfig, attendanceOTP: otp})} notifications={notifications} setNotifications={setNotifications} showToast={showToast} config={dSchoolConfig} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'timetable' && hasAccess('timetable') && <TimeTableView user={currentUser} users={dUsers} timetable={dTimetable} setTimetable={setDTimetable} timetableDraft={dTimetableDraft} setTimetableDraft={setDTimetableDraft} isDraftMode={isDraftMode} setIsDraftMode={setIsDraftMode} substitutions={dSubstitutions} config={dSchoolConfig} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} onManualSync={loadMatrixData} triggerConfirm={(m, c) => { if(confirm(m)) c(); }} isSandbox={isSandbox} addSandboxLog={addSandboxLog} showToast={showToast} />}
              {activeTab === 'batch_timetable' && hasAccess('batch_timetable') && <BatchTimetableView users={dUsers} timetable={dTimetable} timetableDraft={dTimetableDraft} isDraftMode={isDraftMode} config={dSchoolConfig} currentUser={currentUser} assignments={dTeacherAssignments} substitutions={dSubstitutions} />}
              {activeTab === 'history' && hasAccess('history') && <AttendanceView user={currentUser} attendance={dAttendance} setAttendance={setDAttendance} users={dUsers} showToast={showToast} substitutions={dSubstitutions} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'substitutions' && hasAccess('substitutions') && <SubstitutionView user={currentUser} users={dUsers} attendance={dAttendance} timetable={dTimetable} setTimetable={setDTimetable} substitutions={dSubstitutions} setSubstitutions={setDSubstitutions} assignments={dTeacherAssignments} config={dSchoolConfig} setNotifications={setNotifications} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'users' && hasAccess('users') && <UserManagement users={dUsers} setUsers={setDUsers} config={dSchoolConfig} currentUser={currentUser} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} setTimetable={setDTimetable} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} showToast={showToast} setNotifications={setNotifications} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'config' && hasAccess('config') && <AdminConfigView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'assignments' && hasAccess('assignments') && (
                <FacultyAssignmentView 
                  users={dUsers} 
                  setUsers={setDUsers} 
                  config={dSchoolConfig} 
                  assignments={dTeacherAssignments} 
                  setAssignments={setDTeacherAssignments} 
                  timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} 
                  currentUser={currentUser} 
                  showToast={showToast}
                  isSandbox={isSandbox} 
                  addSandboxLog={addSandboxLog} 
                />
              )}
              {activeTab === 'groups' && hasAccess('groups') && <CombinedBlockView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} setTimetable={setDTimetable} currentUser={currentUser} showToast={showToast} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'lab_periods' && hasAccess('lab_periods') && <LabPeriodsView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} setTimetable={setDTimetable} currentUser={currentUser} showToast={showToast} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'extra_curricular' && hasAccess('extra_curricular') && <ExtraCurricularView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'deployment' && hasAccess('deployment') && <DeploymentView showToast={showToast} />}
              {activeTab === 'reports' && hasAccess('reports') && <ReportingView user={currentUser} users={dUsers} attendance={dAttendance} config={dSchoolConfig} substitutions={dSubstitutions} />}
              {activeTab === 'profile' && hasAccess('profile') && <ProfileView user={currentUser} setUsers={setDUsers} setCurrentUser={setCurrentUser} config={dSchoolConfig} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'otp' && hasAccess('otp') && <OtpManagementView config={dSchoolConfig} setConfig={setDSchoolConfig} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'handbook' && hasAccess('handbook') && <HandbookView />}
              {activeTab === 'control_center' && hasAccess('control_center') && <AdminControlCenter config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'occupancy' && hasAccess('occupancy') && <CampusOccupancyView config={dSchoolConfig} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} substitutions={dSubstitutions} users={dUsers} />}
              {activeTab === 'sandbox_control' && hasAccess('sandbox_control') && (
                <SandboxControl 
                  isSandbox={isSandbox} 
                  setIsSandbox={setIsSandbox} 
                  enterSandbox={enterSandbox} 
                  exitSandbox={exitSandbox} 
                  sandboxLogs={sandboxLogs} 
                  clearSandboxLogs={() => setSandboxLogs([])}
                  simulationTools={{ generateRandomAbsences: simGenerateRandomAbsences, clearAllProxies: simClearAllProxies, forceLateArrivals: simForceLateArrivals }}
                />
              )}
              {activeTab === 'ai_analytics' && hasAccess('ai_analytics') && <AIAnalyticsView users={dUsers} attendance={dAttendance} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} substitutions={dSubstitutions} config={dSchoolConfig} />}
              {activeTab === 'lesson_architect' && hasAccess('lesson_architect') && <LessonArchitectView user={currentUser} config={dSchoolConfig} assignments={dTeacherAssignments} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} isAuthorizedForRecord={() => true} isSandbox={isSandbox} addSandboxLog={addSandboxLog} onTabRequest={setActiveTab} />}
              {activeTab === 'exam_preparer' && hasAccess('exam_preparer') && <ExamPreparer user={currentUser} config={dSchoolConfig} timetable={isDraftMode ? (dTimetableDraft.length > 0 ? dTimetableDraft : dTimetable) : dTimetable} isAuthorizedForRecord={() => true} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
            </main>
            <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} role={currentUser.role as UserRole} hasAccess={hasAccess} />
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[2000] px-8 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border flex items-center gap-4 animate-in slide-in-from-top-4 transition-all duration-300 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white border-emerald-500' : 
          toast.type === 'error' ? 'bg-rose-600 text-white border-rose-500' : 
          toast.type === 'warning' ? 'bg-amber-500 text-[#001f3f] border-amber-400' : 
          'bg-[#001f3f] text-[#d4af37] border-white/10'
        }`}>
          <div className="flex items-center gap-3">
             {toast.type === 'success' && <svg className="w-5 h-5 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
             {toast.type === 'error' && <svg className="w-5 h-5 text-rose-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
             <p className="text-[11px] font-black uppercase tracking-[0.1em] whitespace-nowrap">{toast.message}</p>
          </div>
        </div>
      )}

      {/* GLOBAL COMMAND PALETTE */}
      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-[3000] flex items-start justify-center pt-[15vh] px-4 bg-[#001f3f]/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
              <Search className="w-6 h-6 text-slate-400" />
              <input 
                autoFocus
                type="text" 
                placeholder="Search matrix, staff, or commands (Ctrl+K)..."
                value={commandSearch}
                onChange={e => setCommandSearch(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-lg font-medium text-[#001f3f] dark:text-white placeholder:text-slate-400"
              />
              <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-500 uppercase">ESC</span>
              </div>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {commandResults.length > 0 ? (
                <div className="space-y-1">
                  {commandResults.map(res => (
                    <button 
                      key={res.id}
                      onClick={res.action}
                      className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors text-left group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 group-hover:bg-[#001f3f] group-hover:text-[#d4af37] transition-colors">
                        <res.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-[#001f3f] dark:text-white">{res.title}</p>
                        <p className="text-xs text-slate-400 font-medium">{res.subtitle}</p>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg>
                      </div>
                    </button>
                  ))}
                </div>
              ) : commandSearch ? (
                <div className="py-12 text-center opacity-40">
                  <p className="text-sm font-black uppercase tracking-widest">No results found in matrix</p>
                </div>
              ) : (
                <div className="p-4 space-y-6">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 ml-2">Quick Navigation</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => { setActiveTab('dashboard'); setIsCommandPaletteOpen(false); }} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border border-slate-100 dark:border-slate-800">
                        <BarChart3 className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-bold text-[#001f3f] dark:text-white">Dashboard</span>
                      </button>
                      <button onClick={() => { setActiveTab('timetable'); setIsCommandPaletteOpen(false); }} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left border border-slate-100 dark:border-slate-800">
                        <Calendar className="w-4 h-4 text-sky-500" />
                        <span className="text-xs font-bold text-[#001f3f] dark:text-white">Timetable</span>
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 ml-2">Shortcuts</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-xs font-medium text-slate-500">Go to Dashboard</span>
                        <div className="flex gap-1">
                          <kbd className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold">ALT</kbd>
                          <kbd className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold">D</kbd>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-xs font-medium text-slate-500">Go to Timetable</span>
                        <div className="flex gap-1">
                          <kbd className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold">ALT</kbd>
                          <kbd className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold">T</kbd>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Keyboard className="w-3 h-3 text-slate-400" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Shortcuts Active</span>
                </div>
              </div>
              <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-widest italic">Ibn Al Hytham Islamic School</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

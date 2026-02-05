
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, AppTab, SchoolNotification, SectionType, SandboxLog, FeaturePower, InstitutionalResponsibility } from './types.ts';
import { INITIAL_USERS, INITIAL_CONFIG, DAYS, SCHOOL_NAME, DEFAULT_PERMISSIONS, DUMMY_ATTENDANCE, DUMMY_TIMETABLE, DUMMY_SUBSTITUTIONS } from './constants.ts';
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
import ExtraCurricularView from './components/ExtraCurricularView.tsx';
import DeploymentView from './components/DeploymentView.tsx';
import ReportingView from './components/ReportingView.tsx';
import ProfileView from './components/ProfileView.tsx';
import OtpManagementView from './components/OtpManagementView.tsx';
import HandbookView from './components/HandbookView.tsx';
import AdminControlCenter from './components/AdminControlCenter.tsx';
import SandboxControl from './components/SandboxControl.tsx';
import CampusOccupancyView from './components/CampusOccupancyView.tsx';
import LessonArchitectView from './components/LessonArchitectView.tsx';
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
  const [timetableDraft, setTimetableDraft] = useState<TimeTableEntry[]>([]);
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
    // COMMENT: Removed broken duplicate line that used an undefined 'count' variable
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
    if (!IS_CLOUD_ENABLED || syncStatus.current !== 'IDLE') return;
    syncStatus.current = 'SYNCING';
    setDbLoading(true);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateLimit = thirtyDaysAgo.toISOString().split('T')[0];
    try {
      const [pRes, aRes, tRes, tdRes, sRes, cRes, taRes] = await Promise.all([
        supabase.from('profiles').select('id, employee_id, password, name, email, role, secondary_roles, feature_overrides, responsibilities, expertise, class_teacher_of, phone_number, telegram_chat_id, is_resigned, ai_authorized'),
        supabase.from('attendance').select('*').gte('date', dateLimit).order('date', { ascending: false }),
        supabase.from('timetable_entries').select('*'),
        supabase.from('timetable_drafts').select('*'),
        supabase.from('substitution_ledger').select('*').gte('date', dateLimit).order('date', { ascending: false }),
        supabase.from('school_config').select('config_data').eq('id', 'primary_config').single(),
        supabase.from('teacher_assignments').select('*')
      ]);
      if (pRes.data) setUsers(pRes.data.map((u: any) => ({
        id: u.id, employeeId: u.employee_id, password: u.password, name: u.name, email: u.email,
        role: u.role, secondaryRoles: u.secondary_roles || [], featureOverrides: u.feature_overrides || [],
        responsibilities: u.responsibilities || [],
        classTeacherOf: u.class_teacher_of || undefined,
        phone_number: u.phone_number || undefined, telegram_chat_id: u.telegram_chat_id || undefined, 
        isResigned: u.is_resigned, expertise: u.expertise || [],
        ai_authorized: u.ai_authorized
      })));
      if (aRes.data) setAttendance(aRes.data.map((r: any) => ({
        id: r.id, userId: r.user_id, userName: pRes.data?.find((u: any) => u.id === r.user_id)?.name || 'Unknown',
        date: r.date, checkIn: r.check_in, check_out: r.check_out || undefined, isManual: r.is_manual, isLate: r.is_late,
        location: r.location ? { lat: r.location.lat, lng: r.location.lng } : undefined, reason: r.reason || undefined
      })));
      const mapEntry = (e: any) => ({
        id: e.id, section: e.section, wingId: e.wing_id, gradeId: e.grade_id, sectionId: e.section_id, className: e.class_name, day: e.day, slotId: e.slot_id,
        subject: e.subject, subjectCategory: e.subject_category, teacherId: e.teacher_id, teacherName: e.teacher_name,
        room: e.room || undefined, date: e.date || undefined, isSubstitution: e.is_substitution, blockId: e.block_id || undefined, blockName: e.block_name || undefined
      });
      if (tRes.data) setTimetable(tRes.data.map(mapEntry));
      if (tdRes.data) setTimetableDraft(tdRes.data.map(mapEntry));
      if (sRes.data) setSubstitutions(sRes.data.map((s: any) => ({
        id: s.id, date: s.date, slotId: s.slot_id, wingId: s.wing_id, gradeId: s.grade_id, sectionId: s.section_id,
        className: s.class_name, subject: s.subject,
        absentTeacherId: s.absent_teacher_id, absentTeacherName: s.absent_teacher_name,
        substituteTeacherId: s.substitute_teacher_id, substituteTeacherName: s.substitute_teacher_name,
        section: s.section, isArchived: s.is_archived, last_notified_at: s.last_notified_at || undefined
      })));
      if (cRes.data) {
        setSchoolConfig(prev => ({ ...INITIAL_CONFIG, ...prev, ...(cRes.data.config_data || {}) }));
      }
      if (taRes.data) setTeacherAssignments(taRes.data.map((ta: any) => ({
        id: ta.id, teacherId: ta.teacher_id, gradeId: ta.grade_id, loads: ta.loads, 
        targetSectionIds: ta.target_section_ids, group_periods: ta.group_periods, anchor_subject: ta.anchor_subject
      })));
      setCloudSyncLoaded(true);
      syncStatus.current = 'READY';
    } catch (e) {
      console.warn("Cloud Sync Unavailable.");
      syncStatus.current = 'IDLE';
    } finally {
      setDbLoading(false);
      const boot = document.querySelector('.boot-screen');
      if (boot) boot.remove();
    }
  }, []);

  useEffect(() => { loadMatrixData(); }, [loadMatrixData]);

  if (dbLoading) return null;

  return (
    <div className={`h-full w-full flex flex-col bg-transparent overflow-hidden ${isSandbox ? 'border-[8px] border-amber-500' : ''}`}>
      {!currentUser ? (
        <Login users={dUsers} isDarkMode={isDarkMode} onLogin={setCurrentUser} />
      ) : (
        <div className="h-full w-full flex overflow-hidden">
          <Sidebar role={currentUser.role as UserRole} activeTab={activeTab} setActiveTab={setActiveTab} config={dSchoolConfig} isSidebarOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} hasAccess={hasAccess} />
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
            <Navbar user={currentUser} onLogout={() => setCurrentUser(null)} isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} notifications={notifications} setNotifications={setNotifications} />
            <main className="flex-1 overflow-y-auto scrollbar-hide px-4 md:px-8 py-6 relative">
              {activeTab === 'dashboard' && hasAccess('dashboard') && <Dashboard user={currentUser} attendance={dAttendance} setAttendance={setDAttendance} substitutions={dSubstitutions} currentOTP={dSchoolConfig.attendanceOTP || '123456'} setOTP={(otp) => setDSchoolConfig({...dSchoolConfig, attendanceOTP: otp})} notifications={notifications} setNotifications={setNotifications} showToast={showToast} config={dSchoolConfig} timetable={dTimetable} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'timetable' && hasAccess('timetable') && <TimeTableView user={currentUser} users={dUsers} timetable={dTimetable} setTimetable={setDTimetable} timetableDraft={dTimetableDraft} setTimetableDraft={setDTimetableDraft} isDraftMode={isDraftMode} setIsDraftMode={setIsDraftMode} substitutions={dSubstitutions} config={dSchoolConfig} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} onManualSync={loadMatrixData} triggerConfirm={(m, c) => { if(confirm(m)) c(); }} isSandbox={isSandbox} addSandboxLog={addSandboxLog} showToast={showToast} />}
              {activeTab === 'batch_timetable' && hasAccess('batch_timetable') && <BatchTimetableView users={dUsers} timetable={dTimetable} timetableDraft={dTimetableDraft} isDraftMode={isDraftMode} config={dSchoolConfig} currentUser={currentUser} assignments={dTeacherAssignments} substitutions={dSubstitutions} />}
              {activeTab === 'history' && hasAccess('history') && <AttendanceView user={currentUser} attendance={dAttendance} setAttendance={setDAttendance} users={dUsers} showToast={showToast} substitutions={dSubstitutions} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'substitutions' && hasAccess('substitutions') && <SubstitutionView user={currentUser} users={dUsers} attendance={dAttendance} timetable={dTimetable} setTimetable={setDTimetable} substitutions={dSubstitutions} setSubstitutions={setDSubstitutions} assignments={dTeacherAssignments} config={dSchoolConfig} setNotifications={setNotifications} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'users' && hasAccess('users') && <UserManagement users={dUsers} setUsers={setDUsers} config={dSchoolConfig} currentUser={currentUser} timetable={dTimetable} setTimetable={setDTimetable} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} showToast={showToast} setNotifications={setNotifications} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'config' && hasAccess('config') && <AdminConfigView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'assignments' && hasAccess('assignments') && <FacultyAssignmentView users={dUsers} setUsers={setDUsers} config={dSchoolConfig} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} timetable={dTimetable} currentUser={currentUser} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'groups' && hasAccess('groups') && <CombinedBlockView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} timetable={dTimetable} setTimetable={setDTimetable} currentUser={currentUser} showToast={showToast} assignments={dTeacherAssignments} setAssignments={setDTeacherAssignments} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'extra_curricular' && hasAccess('extra_curricular') && <ExtraCurricularView config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'deployment' && hasAccess('deployment') && <DeploymentView />}
              {activeTab === 'reports' && hasAccess('reports') && <ReportingView user={currentUser} users={dUsers} attendance={dAttendance} config={dSchoolConfig} substitutions={dSubstitutions} />}
              {activeTab === 'profile' && hasAccess('profile') && <ProfileView user={currentUser} setUsers={setDUsers} setCurrentUser={setCurrentUser} config={dSchoolConfig} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'otp' && hasAccess('otp') && <OtpManagementView config={dSchoolConfig} setConfig={setDSchoolConfig} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'handbook' && hasAccess('handbook') && <HandbookView />}
              {activeTab === 'control_center' && hasAccess('control_center') && <AdminControlCenter config={dSchoolConfig} setConfig={setDSchoolConfig} users={dUsers} showToast={showToast} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
              {activeTab === 'occupancy' && hasAccess('occupancy') && <CampusOccupancyView config={dSchoolConfig} timetable={dTimetable} substitutions={dSubstitutions} users={dUsers} />}
              {activeTab === 'lesson_architect' && hasAccess('lesson_architect') && <LessonArchitectView user={currentUser} config={dSchoolConfig} assignments={dTeacherAssignments} timetable={dTimetable} isAuthorizedForRecord={(t, r) => true} isSandbox={isSandbox} addSandboxLog={addSandboxLog} />}
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
            </main>
            <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} role={currentUser.role as UserRole} hasAccess={hasAccess} />
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[2000] px-8 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-top-4 transition-all ${toast.type === 'success' ? 'bg-emerald-50 text-white' : toast.type === 'error' ? 'bg-rose-50 text-white' : toast.type === 'warning' ? 'bg-amber-50 text-black' : 'bg-[#001f3f] text-[#d4af37]'}`}>
          <p className="text-xs font-black uppercase tracking-widest">{toast.message}</p>
        </div>
      )}
    </div>
  );
};

export default App;

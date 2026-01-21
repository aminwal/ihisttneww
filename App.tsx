
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, AppTab, SchoolNotification, SectionType } from './types.ts';
import { INITIAL_USERS, INITIAL_CONFIG, DAYS, SCHOOL_NAME } from './constants.ts';
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
import DeploymentView from './components/DeploymentView.tsx';
import ReportingView from './components/ReportingView.tsx';
import ProfileView from './components/ProfileView.tsx';
import OtpManagementView from './components/OtpManagementView.tsx';
import { supabase, IS_CLOUD_ENABLED } from './supabaseClient.ts';
import { NotificationService } from './services/notificationService.ts';
import { generateUUID } from './utils/idUtils.ts';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [dbLoading, setDbLoading] = useState(false);
  const [cloudSyncLoaded, setCloudSyncLoaded] = useState(false); 
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const syncStatus = useRef<'IDLE' | 'SYNCING' | 'READY'>('IDLE');
  const currentUserRef = useRef<User | null>(null);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('ihis_dark_mode');
    return saved === 'true';
  });

  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('ihis_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [attendance, setAttendance] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem('ihis_attendance');
    if (saved) return JSON.parse(saved);
    return [];
  });

  const [timetable, setTimetable] = useState<TimeTableEntry[]>(() => {
    const saved = localStorage.getItem('ihis_timetable');
    return saved ? JSON.parse(saved) : [];
  });

  const [substitutions, setSubstitutions] = useState<SubstitutionRecord[]>(() => {
    const saved = localStorage.getItem('ihis_substitutions');
    return saved ? JSON.parse(saved) : [];
  });

  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>(() => {
    const saved = localStorage.getItem('ihis_school_config');
    if (!saved) return INITIAL_CONFIG;
    try {
      const parsed = JSON.parse(saved);
      return { ...INITIAL_CONFIG, ...parsed };
    } catch {
      return INITIAL_CONFIG;
    }
  });

  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignment[]>(() => {
    const saved = localStorage.getItem('ihis_teacher_assignments');
    return saved ? JSON.parse(saved) : [];
  });

  const [notifications, setNotifications] = useState<SchoolNotification[]>(() => {
    const saved = localStorage.getItem('ihis_notifications');
    return saved ? JSON.parse(saved) : [
      { id: 'notif-1', title: 'System Notice', message: 'Welcome to the updated IHIS Staff Portal. Geofencing is active.', timestamp: new Date().toISOString(), type: 'ANNOUNCEMENT', read: false }
    ];
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    localStorage.setItem('ihis_dark_mode', String(isDarkMode));
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  useEffect(() => {
    if (cloudSyncLoaded || !IS_CLOUD_ENABLED) {
      localStorage.setItem('ihis_users', JSON.stringify(users));
      localStorage.setItem('ihis_attendance', JSON.stringify(attendance));
      localStorage.setItem('ihis_timetable', JSON.stringify(timetable));
      localStorage.setItem('ihis_substitutions', JSON.stringify(substitutions));
      localStorage.setItem('ihis_school_config', JSON.stringify(schoolConfig));
      localStorage.setItem('ihis_teacher_assignments', JSON.stringify(teacherAssignments));
      localStorage.setItem('ihis_notifications', JSON.stringify(notifications));
    }
  }, [users, attendance, timetable, substitutions, schoolConfig, teacherAssignments, notifications, cloudSyncLoaded]);

  // ANNOUNCEMENT REALTIME HANDLER
  useEffect(() => {
    if (!IS_CLOUD_ENABLED) return;
    
    const channel = supabase
      .channel('announcements-broadcast')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (payload) => {
        const newAnn = payload.new;
        // Trigger OS notification
        NotificationService.sendNotification(newAnn.title, { body: newAnn.message });
        // Trigger In-App Toast
        showToast(`Broadcasting: ${newAnn.message}`, 'info');
        // Add to notification list
        setNotifications(prev => [{
          id: newAnn.id,
          title: newAnn.title,
          message: newAnn.message,
          timestamp: newAnn.created_at,
          type: 'ANNOUNCEMENT',
          read: false
        }, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showToast]);

  const loadMatrixData = useCallback(async () => {
    if (!IS_CLOUD_ENABLED || syncStatus.current !== 'IDLE') return;
    syncStatus.current = 'SYNCING';
    setDbLoading(true);
    try {
      const [pRes, aRes, tRes, sRes, cRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('attendance').select('*').order('date', { ascending: false }).limit(300),
        supabase.from('timetable_entries').select('*'),
        supabase.from('substitution_ledger').select('*').order('date', { ascending: false }).limit(200),
        supabase.from('school_config').select('config_data').eq('id', 'primary_config').single()
      ]);

      if (pRes.data) setUsers(pRes.data.map((u: any) => ({
        id: u.id, employeeId: u.employee_id, name: u.name, email: u.email, password: u.password,
        role: u.role, secondaryRoles: u.secondary_roles || [], classTeacherOf: u.class_teacher_of || undefined,
        phone_number: u.phone_number || undefined, telegram_chat_id: u.telegram_chat_id || undefined, isResigned: u.is_resigned
      })));
      if (aRes.data) setAttendance(aRes.data.map((r: any) => ({
        id: r.id, userId: r.user_id, userName: pRes.data?.find((u: any) => u.id === r.user_id)?.name || 'Unknown',
        date: r.date, checkIn: r.check_in, checkOut: r.check_out || undefined, isManual: r.is_manual, isLate: r.is_late,
        location: r.location ? { lat: r.location.lat, lng: r.location.lng } : undefined, reason: r.reason || undefined
      })));
      if (tRes.data) setTimetable(tRes.data.map((e: any) => ({
        id: e.id, section: e.section, className: e.class_name, day: e.day, slotId: e.slot_id,
        subject: e.subject, subjectCategory: e.subject_category, teacherId: e.teacher_id, teacherName: e.teacher_name,
        room: e.room || undefined, date: e.date || undefined, isSubstitution: e.is_substitution, blockId: e.block_id || undefined, blockName: e.block_name || undefined
      })));
      if (sRes.data) setSubstitutions(sRes.data.map((s: any) => ({
        id: s.id, date: s.date, slotId: s.slot_id, className: s.class_name, subject: s.subject,
        absentTeacherId: s.absent_teacher_id, absentTeacherName: s.absent_teacher_name,
        substituteTeacherId: s.substitute_teacher_id, substituteTeacherName: s.substitute_teacher_name,
        section: s.section, isArchived: s.is_archived
      })));
      if (cRes.data) setSchoolConfig(prev => ({ ...prev, ...cRes.data.config_data }));

      setCloudSyncLoaded(true);
      syncStatus.current = 'READY';
    } catch (e) {
      console.warn("IHIS Cloud Link Unavailable. Defaulting to Local Registry.");
      syncStatus.current = 'IDLE';
    } finally {
      setDbLoading(false);
      const boot = document.querySelector('.boot-screen');
      if (boot) boot.classList.add('fade-out');
      setTimeout(() => boot?.remove(), 600);
    }
  }, []);

  useEffect(() => { loadMatrixData(); }, [loadMatrixData]);

  if (dbLoading) return null;

  return (
    <div className="h-full w-full flex flex-col bg-transparent overflow-hidden">
      {!currentUser ? (
        <Login users={users} isDarkMode={isDarkMode} onLogin={(u) => { setCurrentUser(u); currentUserRef.current = u; }} />
      ) : (
        <div className="h-full w-full flex overflow-hidden">
          <Sidebar role={currentUser.role} activeTab={activeTab} setActiveTab={setActiveTab} config={schoolConfig} isSidebarOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
            <Navbar 
              user={currentUser} 
              onLogout={() => setCurrentUser(null)} 
              isDarkMode={isDarkMode} 
              toggleDarkMode={() => setIsDarkMode(!isDarkMode)} 
              toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              notifications={notifications}
              setNotifications={setNotifications}
            />
            <main className="flex-1 overflow-y-auto scrollbar-hide px-4 md:px-8 py-6 relative">
              {activeTab === 'dashboard' && <Dashboard user={currentUser} attendance={attendance} setAttendance={setAttendance} substitutions={substitutions} currentOTP={schoolConfig.attendanceOTP || '123456'} setOTP={(otp) => setSchoolConfig({...schoolConfig, attendanceOTP: otp})} notifications={notifications} setNotifications={setNotifications} showToast={showToast} config={schoolConfig} />}
              {activeTab === 'timetable' && <TimeTableView user={currentUser} users={users} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} onManualSync={loadMatrixData} triggerConfirm={(m, c) => { if(confirm(m)) c(); }} />}
              {activeTab === 'batch_timetable' && <BatchTimetableView users={users} timetable={timetable} config={schoolConfig} currentUser={currentUser} assignments={teacherAssignments} />}
              {activeTab === 'history' && <AttendanceView user={currentUser} attendance={attendance} setAttendance={setAttendance} users={users} showToast={showToast} substitutions={substitutions} />}
              {activeTab === 'substitutions' && <SubstitutionView user={currentUser} users={users} attendance={attendance} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} setSubstitutions={setSubstitutions} assignments={teacherAssignments} config={schoolConfig} setNotifications={setNotifications} />}
              {activeTab === 'users' && <UserManagement users={users} setUsers={setUsers} config={schoolConfig} currentUser={currentUser} timetable={timetable} setTimetable={setTimetable} assignments={teacherAssignments} setAssignments={setTeacherAssignments} showToast={showToast} />}
              {activeTab === 'config' && <AdminConfigView config={schoolConfig} setConfig={setSchoolConfig} users={users} />}
              {activeTab === 'assignments' && <FacultyAssignmentView users={users} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} substitutions={substitutions} timetable={timetable} triggerConfirm={(m, c) => { if(confirm(m)) c(); }} currentUser={currentUser} />}
              {activeTab === 'groups' && <CombinedBlockView config={schoolConfig} setConfig={setSchoolConfig} users={users} timetable={timetable} setTimetable={setTimetable} currentUser={currentUser} showToast={showToast} />}
              {activeTab === 'deployment' && <DeploymentView />}
              {activeTab === 'reports' && <ReportingView user={currentUser} users={users} attendance={attendance} config={schoolConfig} substitutions={substitutions} />}
              {activeTab === 'profile' && <ProfileView user={currentUser} setUsers={setUsers} setCurrentUser={setCurrentUser} config={schoolConfig} />}
              {activeTab === 'otp' && <OtpManagementView config={schoolConfig} setConfig={setSchoolConfig} showToast={showToast} />}
            </main>
            <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} role={currentUser.role} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[1000] px-8 py-4 rounded-2xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-top-4 transition-all ${
          toast.type === 'success' ? 'bg-emerald-500 text-white' : 
          toast.type === 'error' ? 'bg-rose-500 text-white' : 
          toast.type === 'warning' ? 'bg-amber-500 text-white' : 
          'bg-[#001f3f] text-[#d4af37]'
        }`}>
          <p className="text-xs font-black uppercase tracking-widest">{toast.message}</p>
        </div>
      )}
    </div>
  );
};

export default App;


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, AppTab, SchoolNotification } from './types.ts';
import { INITIAL_USERS, INITIAL_CONFIG, DAYS, SCHOOL_NAME } from './constants.ts';
import Login from './components/Login.tsx';
import Dashboard from './components/Dashboard.tsx';
import Sidebar from './components/Sidebar.tsx';
import Navbar from './components/Navbar.tsx';
import AttendanceView from './components/AttendanceView.tsx';
import UserManagement from './components/UserManagement.tsx';
import TimeTableView from './components/TimeTableView.tsx';
import SubstitutionView from './components/SubstitutionView.tsx';
import AdminConfigView from './components/AdminConfigView.tsx';
import FacultyAssignmentView from './components/FacultyAssignmentView.tsx';
import DeploymentView from './components/DeploymentView.tsx';
import ReportingView from './components/ReportingView.tsx';
import ProfileView from './components/ProfileView.tsx';
import { supabase } from './supabaseClient.ts';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [dbLoading, setDbLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
  
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
    return saved ? JSON.parse(saved) : [];
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
    return saved ? JSON.parse(saved) : INITIAL_CONFIG;
  });

  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignment[]>(() => {
    const saved = localStorage.getItem('ihis_teacher_assignments');
    return saved ? JSON.parse(saved) : [];
  });

  const [attendanceOTP, setAttendanceOTP] = useState<string>(() => {
    const saved = localStorage.getItem('ihis_attendance_otp');
    return saved || '123456';
  });

  const [notifications, setNotifications] = useState<SchoolNotification[]>(() => {
    const saved = localStorage.getItem('ihis_notifications');
    return saved ? JSON.parse(saved) : [];
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // AUTOMATIC RESET LOGIC: FRIDAY 11:00 PM
  useEffect(() => {
    const checkAndPerformWeeklyReset = () => {
      const now = new Date();
      const lastResetDate = localStorage.getItem('ihis_last_reset_date');
      
      const mostRecentFriday = new Date(now);
      const day = now.getDay(); 
      const diff = (day + 2) % 7; 
      mostRecentFriday.setDate(now.getDate() - diff);
      mostRecentFriday.setHours(23, 0, 0, 0);

      const resetThresholdString = mostRecentFriday.toISOString();

      if (now > mostRecentFriday && lastResetDate !== resetThresholdString) {
        console.info("IHIS: Automatic Weekly Reset Triggered");
        setSubstitutions(prev => prev.map(s => {
          if (new Date(s.date) < mostRecentFriday) return { ...s, isArchived: true };
          return s;
        }));
        setTimetable(prev => prev.filter(t => {
          if (!t.isSubstitution || !t.date) return true;
          return new Date(t.date) >= mostRecentFriday;
        }));
        localStorage.setItem('ihis_last_reset_date', resetThresholdString);
        showToast("Weekly Duty Matrix Reset Complete", "info");
      }
    };

    checkAndPerformWeeklyReset();
    const interval = setInterval(checkAndPerformWeeklyReset, 60000 * 30); 
    return () => clearInterval(interval);
  }, [showToast]);

  const syncFromCloud = useCallback(async () => {
    if (!isCloudActive) return;
    setDbLoading(true);
    try {
      const { data: cloudUsers } = await supabase.from('profiles').select('*');
      if (cloudUsers) setUsers(cloudUsers.map(u => ({ id: u.id, employeeId: u.employee_id, name: u.name, email: u.email, password: u.password, role: u.role as UserRole, secondaryRoles: u.secondary_roles as UserRole[], classTeacherOf: u.class_teacher_of, isResigned: u.is_resigned })));

      const { data: cloudAttendance } = await supabase.from('attendance').select('*');
      if (cloudAttendance) setAttendance(cloudAttendance.map(a => ({ id: a.id, userId: a.user_id, userName: users.find(u => u.id === a.user_id)?.name || '...', date: a.date, check_in: a.check_in, check_out: a.check_out, is_manual: a.is_manual, is_late: a.is_late, reason: a.reason, location: a.location })));

      const { data: cloudConfig, error: configError } = await supabase.from('school_config').select('config_data').eq('id', 'primary_config').maybeSingle();
      if (cloudConfig) setSchoolConfig(cloudConfig.config_data as SchoolConfig);

      const { data: cloudTimetable } = await supabase.from('timetable_entries').select('*');
      if (cloudTimetable) setTimetable(cloudTimetable.map(t => ({ id: t.id, section: t.section, className: t.class_name, day: t.day, slotId: t.slot_id, subject: t.subject, subjectCategory: t.subject_category as SubjectCategory, teacherId: t.teacher_id, teacherName: t.teacher_name, date: t.date, isSubstitution: t.is_substitution })));

      const { data: cloudSubs } = await supabase.from('substitution_ledger').select('*');
      if (cloudSubs) setSubstitutions(cloudSubs.map(s => ({ id: s.id, date: s.date, slotId: s.slot_id, className: s.class_name, subject: s.subject, absent_teacher_id: s.absent_teacher_id, absent_teacher_name: s.absent_teacher_name, substitute_teacher_id: s.substitute_teacher_id, substitute_teacher_name: s.substitute_teacher_name, section: s.section, is_archived: s.is_archived })));

      const { data: cloudAssignments } = await supabase.from('faculty_assignments').select('*');
      if (cloudAssignments) setTeacherAssignments(cloudAssignments.map(a => ({ id: a.id, teacherId: a.teacher_id, grade: a.grade, loads: a.loads, targetSections: a.target_sections })));

      showToast("Institutional Matrix Synchronized", "info");
    } catch (e) {
      console.warn("Cloud Handshake Issue:", e);
    } finally {
      setDbLoading(false);
    }
  }, [isCloudActive, users.length, showToast]);

  useEffect(() => { if (isCloudActive) syncFromCloud(); }, [isCloudActive, syncFromCloud]);

  useEffect(() => { localStorage.setItem('ihis_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('ihis_attendance', JSON.stringify(attendance)); }, [attendance]);
  
  // Timetable Persistence
  useEffect(() => { 
    localStorage.setItem('ihis_timetable', JSON.stringify(timetable)); 
    if (isCloudActive && timetable.length > 0) {
      supabase.from('timetable_entries').upsert(timetable.map(t => ({ 
        id: t.id, 
        section: t.section, 
        class_name: t.className, 
        day: t.day, 
        slot_id: t.slotId, 
        subject: t.subject, 
        subject_category: t.subjectCategory, 
        teacher_id: t.teacherId, 
        teacher_name: t.teacherName, 
        date: t.date, 
        is_substitution: !!t.isSubstitution 
      }))).then(({ error }) => error && console.error("Cloud Sync Error (Timetable):", error));
    }
  }, [timetable, isCloudActive]);

  // Substitution Ledger Persistence
  useEffect(() => { 
    localStorage.setItem('ihis_substitutions', JSON.stringify(substitutions)); 
    if (isCloudActive && substitutions.length > 0) {
      supabase.from('substitution_ledger').upsert(substitutions.map(s => ({ 
        id: s.id, 
        date: s.date, 
        slot_id: s.slotId, 
        class_name: s.className, 
        subject: s.subject, 
        absent_teacher_id: s.absentTeacherId, 
        absent_teacher_name: s.absentTeacherName, 
        substitute_teacher_id: s.substituteTeacherId, 
        substitute_teacher_name: s.substituteTeacherName, 
        section: s.section, 
        is_archived: !!s.isArchived 
      }))).then(({ error }) => error && console.error("Cloud Sync Error (Substitutions):", error));
    }
  }, [substitutions, isCloudActive]);

  // Teacher Load Persistence
  useEffect(() => { 
    localStorage.setItem('ihis_teacher_assignments', JSON.stringify(teacherAssignments)); 
    if (isCloudActive && teacherAssignments.length > 0) {
      supabase.from('faculty_assignments').upsert(teacherAssignments.map(a => ({
        id: a.id,
        teacher_id: a.teacherId,
        grade: a.grade,
        loads: a.loads,
        target_sections: a.targetSections || []
      }))).then(({ error }) => error && console.error("Cloud Sync Error (Assignments):", error));
    }
  }, [teacherAssignments, isCloudActive]);

  // CRITICAL: School Config Persistence (Includes Classes and Subjects)
  useEffect(() => { 
    localStorage.setItem('ihis_school_config', JSON.stringify(schoolConfig));
    if (isCloudActive) {
      supabase.from('school_config').upsert({ 
        id: 'primary_config', 
        config_data: schoolConfig 
      }).then(({ error }) => {
        if (error) {
          console.error("Cloud Sync Error (School Config):", error);
          showToast("Sync Failure: Institutional settings not updated to cloud.", "error");
        } else {
          console.info("Institutional Registry synchronized successfully.");
        }
      });
    }
  }, [schoolConfig, isCloudActive, showToast]);

  useEffect(() => { localStorage.setItem('ihis_dark_mode', String(isDarkMode)); if (isDarkMode) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark'); }, [isDarkMode]);

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} isDarkMode={isDarkMode} />;

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isManagement = isAdmin || currentUser.role.startsWith('INCHARGE_');

  const mobileNavItems: { id: AppTab; label: string; icon: string }[] = isAdmin ? [
    { id: 'dashboard', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: 'timetable', label: 'Schedule', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'substitutions', label: 'Proxy', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2z' },
    { id: 'users', label: 'Staff', icon: 'M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
    { id: 'reports', label: 'Stats', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2' },
    { id: 'profile', label: 'Me', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }
  ] : [
    { id: 'dashboard', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    ...((!schoolConfig.hideTimetableFromTeachers || isManagement) ? [{ id: 'timetable' as AppTab, label: 'Table', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' }] : []),
    { id: 'substitutions', label: 'Proxy', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2z' },
    { id: 'history', label: 'Logs', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'profile', label: 'Me', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' }
  ];

  return (
    <div className={isDarkMode ? 'dark h-screen overflow-hidden' : 'h-screen overflow-hidden'}>
      <div className="flex h-full bg-transparent overflow-hidden">
        <Sidebar role={currentUser.role} activeTab={activeTab} setActiveTab={setActiveTab} config={schoolConfig} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <Navbar user={currentUser} onLogout={() => setCurrentUser(null)} isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} />
          
          {toast && (
            <div className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-[10000] animate-in slide-in-from-bottom-6 fade-in duration-500">
               <div className={`px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-3 border backdrop-blur-xl ${
                 toast.type === 'error' ? 'bg-red-500 text-white border-red-400' : 
                 toast.type === 'info' ? 'bg-[#001f3f] text-white border-white/20' : 
                 'bg-emerald-500 text-white border-emerald-400'
               }`}>
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                  <span className="text-xs font-black uppercase tracking-widest">{toast.message}</span>
               </div>
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-3 md:p-8 scrollbar-hide pb-28 md:pb-8">
            <div className="max-w-7xl mx-auto w-full">
              {activeTab === 'dashboard' && <Dashboard user={currentUser} attendance={attendance} setAttendance={setAttendance} substitutions={substitutions} currentOTP={attendanceOTP} setOTP={setAttendanceOTP} notifications={notifications} setNotifications={setNotifications} showToast={showToast} />}
              {activeTab === 'history' && <AttendanceView user={currentUser} attendance={attendance} setAttendance={setAttendance} users={users} showToast={showToast} />}
              {activeTab === 'users' && (
                <UserManagement 
                  users={users} 
                  setUsers={setUsers} 
                  config={schoolConfig} 
                  currentUser={currentUser} 
                  timetable={timetable} 
                  setTimetable={setTimetable}
                  assignments={teacherAssignments}
                  setAssignments={setTeacherAssignments}
                  showToast={showToast}
                />
              )}
              {activeTab === 'timetable' && <TimeTableView user={currentUser} users={users} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} onManualSync={syncFromCloud} triggerConfirm={(msg, cb) => window.confirm(msg) && cb()} />}
              {activeTab === 'substitutions' && <SubstitutionView user={currentUser} users={users} attendance={attendance} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} setSubstitutions={setSubstitutions} assignments={teacherAssignments} config={schoolConfig} />}
              {activeTab === 'config' && <AdminConfigView config={schoolConfig} setConfig={setSchoolConfig} />}
              {activeTab === 'assignments' && <FacultyAssignmentView users={users} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} substitutions={substitutions} triggerConfirm={(msg, cb) => window.confirm(msg) && cb()} currentUser={currentUser} />}
              {activeTab === 'deployment' && <DeploymentView />}
              {activeTab === 'reports' && <ReportingView user={currentUser} users={users} attendance={attendance} config={schoolConfig} substitutions={substitutions} />}
              {activeTab === 'profile' && <ProfileView user={currentUser} setUsers={setUsers} setCurrentUser={setCurrentUser} />}
              
              <footer className="mt-12 pb-12 text-center border-t border-slate-200 dark:border-white/5 pt-8 no-print">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.4em] mb-2">Institutional Portal Infrastructure</p>
                <p className="text-[11px] font-black text-brand-gold uppercase tracking-[0.2em]">Developed by Ahmed Minwal</p>
              </footer>
            </div>
          </main>

          <nav className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-sm bg-[#001f3f]/90 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex items-center justify-around p-2 z-[9999] overflow-x-auto scrollbar-hide">
             {mobileNavItems.map(item => (
               <button 
                 key={item.id} 
                 onClick={() => setActiveTab(item.id)}
                 className={`flex flex-col items-center justify-center p-3 rounded-[2rem] transition-all duration-300 min-w-[60px] ${
                   activeTab === item.id 
                     ? 'bg-[#d4af37] text-[#001f3f] shadow-lg scale-110' 
                     : 'text-white/40'
                 }`}
               >
                 <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={activeTab === item.id ? "3" : "2"} d={item.icon} />
                 </svg>
                 <span className="text-[7px] font-black uppercase tracking-tighter">{item.label}</span>
               </button>
             ))}
          </nav>
        </div>
      </div>
    </div>
  );
};

export default App;

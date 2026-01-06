
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory, AppTab, SchoolNotification } from './types.ts';
import { INITIAL_USERS, INITIAL_CONFIG, DAYS, SCHOOL_NAME, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS } from './constants.ts';
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
import { NotificationService } from './services/notificationService.ts';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [dbLoading, setDbLoading] = useState(false);
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

  const syncFromCloud = useCallback(async () => {
    if (!isCloudActive) return;
    setDbLoading(true);
    try {
      // Profiles
      const { data: cloudUsers } = await supabase.from('profiles').select('*');
      if (cloudUsers) setUsers(cloudUsers.map(u => ({ id: u.id, employeeId: u.employee_id, name: u.name, email: u.email, password: u.password, role: u.role as UserRole, classTeacherOf: u.class_teacher_of })));

      // Attendance
      const { data: cloudAttendance } = await supabase.from('attendance').select('*');
      if (cloudAttendance) setAttendance(cloudAttendance.map(a => ({ id: a.id, userId: a.user_id, userName: users.find(u => u.id === a.user_id)?.name || '...', date: a.date, checkIn: a.check_in, checkOut: a.check_out, isManual: a.is_manual, isLate: a.is_late, reason: a.reason, location: a.location })));

      // Config
      const { data: cloudConfig } = await supabase.from('school_config').select('config_data').eq('id', 'primary_config').single();
      if (cloudConfig) setSchoolConfig(cloudConfig.config_data as SchoolConfig);

      // Timetable
      const { data: cloudTimetable } = await supabase.from('timetable_entries').select('*');
      if (cloudTimetable) setTimetable(cloudTimetable.map(t => ({ id: t.id, section: t.section, className: t.class_name, day: t.day, slot_id: t.slot_id, subject: t.subject, subject_category: t.subject_category, teacher_id: t.teacher_id, teacher_name: t.teacher_name })));

      // Substitutions
      const { data: cloudSubs } = await supabase.from('substitution_ledger').select('*');
      if (cloudSubs) setSubstitutions(cloudSubs.map(s => ({ id: s.id, date: s.date, slot_id: s.slot_id, class_name: s.class_name, subject: s.subject, absent_teacher_id: s.absent_teacher_id, absent_teacher_name: s.absent_teacher_name, substitute_teacher_id: s.substitute_teacher_id, substitute_teacher_name: s.substitute_teacher_name, section: s.section, is_archived: s.is_archived })));

    } catch (e) {
      console.warn("Cloud Handshake Issue:", e);
    } finally {
      setDbLoading(false);
    }
  }, [isCloudActive, users.length]);

  useEffect(() => { if (isCloudActive) syncFromCloud(); }, [isCloudActive, syncFromCloud]);

  // Persistent Handlers
  useEffect(() => { localStorage.setItem('ihis_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('ihis_attendance', JSON.stringify(attendance)); }, [attendance]);
  useEffect(() => { 
    localStorage.setItem('ihis_timetable', JSON.stringify(timetable)); 
    if (isCloudActive && timetable.length > 0) supabase.from('timetable_entries').upsert(timetable.map(t => ({ id: t.id, section: t.section, class_name: t.className, day: t.day, slot_id: t.slotId, subject: t.subject, subject_category: t.subjectCategory, teacher_id: t.teacherId, teacher_name: t.teacherName }))).then();
  }, [timetable, isCloudActive]);

  useEffect(() => { 
    localStorage.setItem('ihis_substitutions', JSON.stringify(substitutions)); 
    if (isCloudActive && substitutions.length > 0) supabase.from('substitution_ledger').upsert(substitutions.map(s => ({ id: s.id, date: s.date, slot_id: s.slotId, class_name: s.className, subject: s.subject, absent_teacher_id: s.absentTeacherId, absent_teacher_name: s.absentTeacherName, substitute_teacher_id: s.substituteTeacherId, substitute_teacher_name: s.substituteTeacherName, section: s.section, is_archived: !!s.isArchived }))).then();
  }, [substitutions, isCloudActive]);

  useEffect(() => { 
    localStorage.setItem('ihis_school_config', JSON.stringify(schoolConfig));
    if (isCloudActive) supabase.from('school_config').upsert({ id: 'primary_config', config_data: schoolConfig }).then();
  }, [schoolConfig, isCloudActive]);

  useEffect(() => { localStorage.setItem('ihis_dark_mode', String(isDarkMode)); if (isDarkMode) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark'); }, [isDarkMode]);

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} isDarkMode={isDarkMode} />;

  return (
    <div className={isDarkMode ? 'dark h-screen overflow-hidden' : 'h-screen overflow-hidden'}>
      <div className="flex h-full bg-transparent overflow-hidden">
        <Sidebar role={currentUser.role} activeTab={activeTab} setActiveTab={setActiveTab} config={schoolConfig} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Navbar user={currentUser} onLogout={() => setCurrentUser(null)} isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} />
          <main className="flex-1 overflow-y-auto p-3 md:p-8 scrollbar-hide">
            <div className="max-w-7xl mx-auto w-full">
              {activeTab === 'dashboard' && <Dashboard user={currentUser} attendance={attendance} setAttendance={setAttendance} substitutions={substitutions} currentOTP={attendanceOTP} setOTP={setAttendanceOTP} notifications={notifications} setNotifications={setNotifications} />}
              {activeTab === 'history' && <AttendanceView user={currentUser} attendance={attendance} setAttendance={setAttendance} users={users} />}
              {activeTab === 'users' && <UserManagement users={users} setUsers={setUsers} config={schoolConfig} currentUser={currentUser} />}
              {activeTab === 'timetable' && <TimeTableView user={currentUser} users={users} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} onManualSync={syncFromCloud} triggerConfirm={(msg, cb) => window.confirm(msg) && cb()} />}
              {activeTab === 'substitutions' && <SubstitutionView user={currentUser} users={users} attendance={attendance} timetable={timetable} substitutions={substitutions} setSubstitutions={setSubstitutions} assignments={teacherAssignments} config={schoolConfig} />}
              {activeTab === 'config' && <AdminConfigView config={schoolConfig} setConfig={setSchoolConfig} />}
              {activeTab === 'assignments' && <FacultyAssignmentView users={users} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} triggerConfirm={(msg, cb) => window.confirm(msg) && cb()} currentUser={currentUser} />}
              {activeTab === 'deployment' && <DeploymentView />}
              {activeTab === 'reports' && <ReportingView user={currentUser} users={users} attendance={attendance} config={schoolConfig} substitutions={substitutions} />}
              {activeTab === 'profile' && <ProfileView user={currentUser} setUsers={setUsers} setCurrentUser={setCurrentUser} />}
              
              <footer className="mt-12 pb-12 text-center border-t border-slate-200 dark:border-white/5 pt-8 no-print">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.4em] mb-2">
                  Institutional Portal Infrastructure
                </p>
                <p className="text-[11px] font-black text-brand-gold uppercase tracking-[0.2em] animate-pulse">
                  Developed by Ahmed Minwal
                </p>
              </footer>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;

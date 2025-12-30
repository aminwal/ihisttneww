
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
      // 1. Sync Profiles
      const { data: cloudUsers, error: userError } = await supabase.from('profiles').select('*');
      if (userError) throw userError;
      
      if (cloudUsers && cloudUsers.length > 0) {
        const mappedUsers: User[] = cloudUsers.map(u => ({
          id: u.id,
          employeeId: u.employee_id,
          name: u.name,
          email: u.email,
          password: u.password,
          role: u.role as UserRole,
          classTeacherOf: u.class_teacher_of 
        }));
        setUsers(mappedUsers);
      }

      // 2. Sync Attendance
      const { data: cloudAttendance, error: attError } = await supabase.from('attendance').select('*').order('date', { ascending: false });
      if (attError) throw attError;
      
      if (cloudAttendance) {
        const mappedAttendance: AttendanceRecord[] = cloudAttendance.map(a => {
          const u = users.find(user => user.id === a.user_id);
          return {
            id: a.id,
            userId: a.user_id,
            userName: u ? u.name : 'Resolving...',
            date: a.date,
            checkIn: a.check_in,
            checkOut: a.check_out,
            isManual: a.is_manual,
            isLate: a.is_late,
            reason: a.reason,
            location: a.location
          };
        });
        setAttendance(mappedAttendance);
      }

      // 3. Sync School Config
      const { data: cloudConfig, error: configError } = await supabase
        .from('school_config')
        .select('config_data')
        .eq('id', 'primary_config')
        .single();
      
      if (!configError && cloudConfig) {
        setSchoolConfig(cloudConfig.config_data as SchoolConfig);
      }

      // 4. Sync Timetable
      const { data: cloudTimetable, error: ttError } = await supabase.from('timetable_entries').select('*');
      if (!ttError && cloudTimetable) {
        setTimetable(cloudTimetable.map(t => ({
          id: t.id,
          section: t.section,
          className: t.class_name,
          day: t.day,
          slotId: t.slot_id,
          subject: t.subject,
          subjectCategory: t.subject_category,
          teacherId: t.teacher_id,
          teacherName: t.teacher_name
        })));
      }

      // 5. Sync Substitutions
      const { data: cloudSubs, error: subsError } = await supabase.from('substitution_ledger').select('*');
      if (!subsError && cloudSubs) {
        setSubstitutions(cloudSubs.map(s => ({
          id: s.id,
          date: s.date,
          slotId: s.slot_id,
          className: s.class_name,
          subject: s.subject,
          absentTeacherId: s.absent_teacher_id,
          absentTeacherName: s.absent_teacher_name,
          substituteTeacherId: s.substitute_teacher_id,
          substituteTeacherName: s.substitute_teacher_name,
          section: s.section
        })));
      }

    } catch (e) {
      console.warn("IHIS Cloud Handshake Issue:", e);
    } finally {
      setDbLoading(false);
    }
  }, [isCloudActive, users.length]);

  useEffect(() => {
    if (isCloudActive) syncFromCloud();
  }, [isCloudActive, syncFromCloud]);

  // Persistence Effects
  useEffect(() => { localStorage.setItem('ihis_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('ihis_attendance', JSON.stringify(attendance)); }, [attendance]);
  
  useEffect(() => { 
    localStorage.setItem('ihis_timetable', JSON.stringify(timetable)); 
    if (isCloudActive && timetable.length > 0) {
      const dbEntries = timetable.map(t => ({
        id: t.id,
        section: t.section,
        class_name: t.className,
        day: t.day,
        slot_id: t.slotId,
        subject: t.subject,
        subject_category: t.subjectCategory,
        teacher_id: t.teacherId,
        teacher_name: t.teacherName
      }));
      supabase.from('timetable_entries').upsert(dbEntries).then();
    }
  }, [timetable, isCloudActive]);

  useEffect(() => { 
    localStorage.setItem('ihis_substitutions', JSON.stringify(substitutions)); 
    if (isCloudActive && substitutions.length > 0) {
      const dbEntries = substitutions.map(s => ({
        id: s.id,
        date: s.date,
        slot_id: s.slotId,
        class_name: s.className,
        subject: s.subject,
        absent_teacher_id: s.absentTeacherId,
        absent_teacher_name: s.absentTeacherName,
        substitute_teacher_id: s.substituteTeacherId,
        substitute_teacher_name: s.substituteTeacherName,
        section: s.section
      }));
      supabase.from('substitution_ledger').upsert(dbEntries).then();
    }
  }, [substitutions, isCloudActive]);

  useEffect(() => { 
    localStorage.setItem('ihis_school_config', JSON.stringify(schoolConfig));
    if (isCloudActive) {
      supabase.from('school_config').upsert({ id: 'primary_config', config_data: schoolConfig }).then();
    }
  }, [schoolConfig, isCloudActive]);
  
  useEffect(() => { localStorage.setItem('ihis_teacher_assignments', JSON.stringify(teacherAssignments)); }, [teacherAssignments]);
  useEffect(() => { localStorage.setItem('ihis_attendance_otp', attendanceOTP); }, [attendanceOTP]);
  useEffect(() => { localStorage.setItem('ihis_notifications', JSON.stringify(notifications)); }, [notifications]);
  
  useEffect(() => {
    localStorage.setItem('ihis_dark_mode', String(isDarkMode));
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

  if (!currentUser) {
    return (
      <div className={isDarkMode ? 'dark h-screen flex flex-col' : 'h-screen flex flex-col'}>
        <div className="flex-1 overflow-hidden">
          <Login users={users} onLogin={setCurrentUser} isDarkMode={isDarkMode} />
        </div>
        <footer className="bg-[#001f3f]/90 py-3 text-center border-t border-white/5 no-print shrink-0">
          <p className="text-[7px] font-black text-amber-500 uppercase tracking-[0.3em]">Developed by Ahmed Minwal</p>
        </footer>
      </div>
    );
  }

  return (
    <div className={isDarkMode ? 'dark h-screen overflow-hidden' : 'h-screen overflow-hidden'}>
      <div className="flex h-full bg-transparent transition-colors duration-500 overflow-hidden">
        <Sidebar role={currentUser.role} activeTab={activeTab} setActiveTab={setActiveTab} config={schoolConfig} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-transparent">
          <Navbar user={currentUser} onLogout={() => setCurrentUser(null)} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
          {dbLoading && (
            <div className="absolute top-20 right-8 z-50 flex items-center space-x-2 bg-brand-navy/80 text-brand-gold px-4 py-2 rounded-full border border-brand-gold/20 animate-pulse">
               <div className="w-2 h-2 bg-brand-gold rounded-full animate-ping"></div>
               <span className="text-[8px] font-black uppercase tracking-widest">Cloud Syncing...</span>
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-3 md:p-8 scrollbar-hide bg-transparent flex flex-col">
            <div className="max-w-7xl mx-auto w-full flex-1">
              {activeTab === 'dashboard' && (
                <Dashboard 
                  user={currentUser} 
                  attendance={attendance} 
                  setAttendance={setAttendance} 
                  substitutions={substitutions}
                  currentOTP={attendanceOTP}
                  setOTP={setAttendanceOTP}
                  notifications={notifications}
                  setNotifications={setNotifications}
                />
              )}
              {activeTab === 'history' && <AttendanceView user={currentUser} attendance={attendance} setAttendance={setAttendance} users={users} />}
              {activeTab === 'users' && <UserManagement users={users} setUsers={setUsers} config={schoolConfig} currentUser={currentUser} />}
              {activeTab === 'timetable' && (
                <TimeTableView 
                  user={currentUser} users={users} timetable={timetable} setTimetable={setTimetable} 
                  substitutions={substitutions} config={schoolConfig} assignments={teacherAssignments}
                  setAssignments={setTeacherAssignments} onManualSync={syncFromCloud} triggerConfirm={() => {}} 
                />
              )}
              {activeTab === 'substitutions' && (
                <SubstitutionView 
                  user={currentUser} users={users} attendance={attendance} timetable={timetable} 
                  substitutions={substitutions} setSubstitutions={setSubstitutions}
                  assignments={teacherAssignments} config={schoolConfig} 
                />
              )}
              {activeTab === 'config' && <AdminConfigView config={schoolConfig} setConfig={setSchoolConfig} />}
              {activeTab === 'assignments' && <FacultyAssignmentView users={users} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} triggerConfirm={() => {}} currentUser={currentUser} />}
              {activeTab === 'deployment' && <DeploymentView />}
              {activeTab === 'reports' && <ReportingView users={users} attendance={attendance} config={schoolConfig} />}
              {activeTab === 'profile' && <ProfileView user={currentUser} setUsers={setUsers} setCurrentUser={setCurrentUser} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;

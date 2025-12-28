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
    } catch (e) {
      console.warn("IHIS Cloud Handshake Issue:", e);
    } finally {
      setDbLoading(false);
    }
  }, [isCloudActive, users.length]);

  useEffect(() => {
    if (isCloudActive) syncFromCloud();
  }, [isCloudActive, syncFromCloud]);

  useEffect(() => { localStorage.setItem('ihis_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('ihis_attendance', JSON.stringify(attendance)); }, [attendance]);
  useEffect(() => { localStorage.setItem('ihis_timetable', JSON.stringify(timetable)); }, [timetable]);
  useEffect(() => { localStorage.setItem('ihis_substitutions', JSON.stringify(substitutions)); }, [substitutions]);
  useEffect(() => { localStorage.setItem('ihis_school_config', JSON.stringify(schoolConfig)); }, [schoolConfig]);
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
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;
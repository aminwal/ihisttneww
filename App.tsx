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
    if (!saved) return INITIAL_CONFIG;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_CONFIG,
        ...parsed,
        combinedBlocks: parsed.combinedBlocks || [],
        rooms: parsed.rooms || [],
        classes: parsed.classes || [],
        subjects: parsed.subjects || []
      };
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
    return saved ? JSON.parse(saved) : [];
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

  useEffect(() => {
    if (!IS_CLOUD_ENABLED || !currentUser) return;

    const channel = supabase
      .channel('ihis-realtime-matrix')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'substitution_ledger' },
        (payload: any) => {
          const newRec = payload.new;
          const oldRec = payload.old;
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const record: SubstitutionRecord = {
              id: newRec.id,
              date: newRec.date,
              slotId: newRec.slot_id,
              className: newRec.class_name,
              subject: newRec.subject,
              absentTeacherId: newRec.absent_teacher_id, 
              absentTeacherName: newRec.absent_teacher_name, 
              substituteTeacherId: newRec.substitute_teacher_id,
              substituteTeacherName: newRec.substitute_teacher_name,
              section: newRec.section as SectionType,
              isArchived: newRec.is_archived
            };

            setSubstitutions(prev => {
              const filtered = prev.filter(s => s.id !== record.id);
              return [record, ...filtered];
            });

            // Reliable Notification Logic
            const myId = currentUser.id.toLowerCase().trim();
            const subId = (record.substituteTeacherId || "").toLowerCase().trim();
            const oldSubId = (oldRec?.substitute_teacher_id || "").toLowerCase().trim();

            const isNowAssignedToMe = subId === myId;
            const wasPreviouslyAssignedToMe = oldSubId === myId;
            
            if (isNowAssignedToMe && !wasPreviouslyAssignedToMe && !record.isArchived) {
              const newNotif: SchoolNotification = {
                id: `notif-${record.id}-${Date.now()}`,
                title: "Proxy Duty Assigned",
                message: `Class ${record.className}, Period ${record.slotId}. Check Dashboard.`,
                timestamp: new Date().toISOString(),
                type: 'SUBSTITUTION',
                read: false
              };

              setNotifications(n => [newNotif, ...n]);
              NotificationService.notifySubstitution(record.className, record.slotId);
              showToast("New Proxy Assigned!", "info");
            }
          } else if (payload.eventType === 'DELETE') {
            setSubstitutions(prev => prev.filter(s => s.id !== oldRec.id));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'timetable_entries' },
        (payload: any) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const t = payload.new;
            const entry: TimeTableEntry = {
              id: t.id, section: t.section, className: t.class_name, day: t.day, slotId: t.slot_id,
              subject: t.subject, subjectCategory: t.subject_category as SubjectCategory,
              teacherId: t.teacher_id, teacherName: t.teacher_name, room: t.room,
              date: t.date, isSubstitution: t.is_substitution, blockId: t.block_id, blockName: t.block_name
            };
            setTimetable(prev => {
              const filtered = prev.filter(item => item.id !== entry.id);
              return [...filtered, entry];
            });
          } else if (payload.eventType === 'DELETE') {
            setTimetable(prev => prev.filter(item => item.id !== (payload.old?.id || payload.new?.id)));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'school_config' },
        (payload: any) => {
           if (payload.new?.config_data) {
             setSchoolConfig(prev => ({
               ...prev,
               ...payload.new.config_data,
               attendanceOTP: String(payload.new.config_data.attendanceOTP || prev.attendanceOTP || '123456')
             }));
           }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, showToast]);

  const syncFromCloud = useCallback(async () => {
    if (!IS_CLOUD_ENABLED || syncStatus.current !== 'IDLE') return;
    syncStatus.current = 'SYNCING';
    setDbLoading(true);
    try {
      const { data: cloudUsers } = await supabase.from('profiles').select('*');
      let currentUsers = users;
      if (cloudUsers && cloudUsers.length > 0) {
        currentUsers = cloudUsers.map(u => ({ 
          id: u.id, employeeId: u.employee_id, name: u.name, email: u.email, password: u.password, 
          phone_number: u.phone_number, role: u.role as UserRole, secondaryRoles: u.secondary_roles as UserRole[], 
          class_teacher_of: u.class_teacher_of, isResigned: u.is_resigned 
        }));
        setUsers(currentUsers);
      }
      
      const { data: cloudConfig } = await supabase.from('school_config').select('config_data').eq('id', 'primary_config').maybeSingle();
      if (cloudConfig?.config_data) {
        const rawConfig = cloudConfig.config_data as any;
        setSchoolConfig({
          ...INITIAL_CONFIG,
          ...rawConfig,
          combinedBlocks: rawConfig.combinedBlocks || [],
          rooms: rawConfig.rooms || [],
          classes: rawConfig.classes || [],
          subjects: rawConfig.subjects || []
        });
      }

      const { data: cloudAttendance } = await supabase.from('attendance').select('*');
      if (cloudAttendance) {
        setAttendance(cloudAttendance.map(a => ({ 
          id: a.id, userId: a.user_id, userName: currentUsers.find(u => u.id === a.user_id)?.name || 'Unknown',
          date: a.date, checkIn: a.check_in, checkOut: a.check_out, isManual: a.is_manual,
          isLate: a.is_late, reason: a.reason, location: a.location
        })));
      }

      const { data: cloudTimetable } = await supabase.from('timetable_entries').select('*');
      if (cloudTimetable) {
        setTimetable(cloudTimetable.map(t => ({
          id: t.id, section: t.section, className: t.class_name, day: t.day, slot_id: t.slot_id,
          subject: t.subject, subjectCategory: t.subject_category as SubjectCategory, teacherId: t.teacher_id,
          teacherName: t.teacher_name, room: t.room, date: t.date, isSubstitution: t.is_substitution,
          blockId: t.block_id, blockName: t.block_name
        })));
      }

      const { data: cloudSubs } = await supabase.from('substitution_ledger').select('*');
      if (cloudSubs) {
        setSubstitutions(cloudSubs.map(s => ({
          id: s.id, date: s.date, slotId: s.slot_id, className: s.class_name, subject: s.subject,
          absentTeacherId: s.absent_teacher_id, absentTeacherName: s.absent_teacher_name,
          substituteTeacherId: s.substitute_teacher_id, substituteTeacherName: s.substitute_teacher_name,
          section: s.section as SectionType, isArchived: s.is_archived
        })));
      }

      syncStatus.current = 'READY';
      setCloudSyncLoaded(true);
      showToast("Cloud Environment Synced", "success");
    } catch (err: any) {
      showToast("Handshake Failed: " + err.message, "error");
    } finally {
      setDbLoading(false);
    }
  }, [users, showToast]);

  useEffect(() => { if (IS_CLOUD_ENABLED) syncFromCloud(); }, [syncFromCloud]);

  const handleLogin = async (user: User) => {
    setCurrentUser(user);
    await NotificationService.requestPermission();
    showToast(`Session Authorized: ${user.name}`, "success");
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('dashboard');
    setIsSidebarOpen(false);
  };

  if (!currentUser) {
    return <Login users={users} onLogin={handleLogin} isDarkMode={isDarkMode} />;
  }

  const renderActiveTab = () => {
    if (IS_CLOUD_ENABLED && !cloudSyncLoaded && (activeTab === 'config' || activeTab === 'groups')) {
      return (
        <div className="h-full flex items-center justify-center p-10 text-center">
           <div className="space-y-4">
              <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Awaiting Cloud Synchronization...</p>
           </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'dashboard': return <Dashboard user={currentUser} attendance={attendance} setAttendance={setAttendance} substitutions={substitutions} currentOTP={schoolConfig.attendanceOTP || '123456'} setOTP={() => {}} notifications={notifications} setNotifications={setNotifications} showToast={showToast} config={schoolConfig} />;
      case 'history': return <AttendanceView user={currentUser} attendance={attendance} setAttendance={setAttendance} users={users} showToast={showToast} substitutions={substitutions} />;
      case 'users': return <UserManagement users={users} setUsers={setUsers} config={schoolConfig} currentUser={currentUser} timetable={timetable} setTimetable={setTimetable} assignments={teacherAssignments} setAssignments={setTeacherAssignments} showToast={showToast} />;
      case 'timetable': return <TimeTableView user={currentUser} users={users} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} onManualSync={syncFromCloud} triggerConfirm={(m, c) => { if (window.confirm(m)) c(); }} />;
      case 'batch_timetable': return <BatchTimetableView users={users} timetable={timetable} config={schoolConfig} currentUser={currentUser} />;
      case 'substitutions': return <SubstitutionView user={currentUser} users={users} attendance={attendance} timetable={timetable} setTimetable={setTimetable} substitutions={substitutions} setSubstitutions={setSubstitutions} assignments={teacherAssignments} config={schoolConfig} setNotifications={setNotifications} />;
      case 'config': return <AdminConfigView config={schoolConfig} setConfig={setSchoolConfig} />;
      case 'otp': return <OtpManagementView config={schoolConfig} setConfig={setSchoolConfig} showToast={showToast} />;
      case 'assignments': return <FacultyAssignmentView users={users} config={schoolConfig} assignments={teacherAssignments} setAssignments={setTeacherAssignments} substitutions={substitutions} timetable={timetable} triggerConfirm={(m, c) => { if (window.confirm(m)) c(); }} currentUser={currentUser} />;
      case 'groups': return <CombinedBlockView config={schoolConfig} setConfig={setSchoolConfig} users={users} timetable={timetable} setTimetable={setTimetable} currentUser={currentUser} showToast={showToast} />;
      case 'deployment': return <DeploymentView />;
      case 'reports': return <ReportingView user={currentUser} users={users} attendance={attendance} config={schoolConfig} substitutions={substitutions} />;
      case 'profile': return <ProfileView user={currentUser} setUsers={setUsers} setCurrentUser={setCurrentUser} />;
      default: return <Dashboard user={currentUser} attendance={attendance} setAttendance={setAttendance} substitutions={substitutions} currentOTP={schoolConfig.attendanceOTP || '123456'} setOTP={() => {}} notifications={notifications} setNotifications={setNotifications} showToast={showToast} config={schoolConfig} />;
    }
  };

  return (
    <div className="flex h-screen bg-transparent transition-colors duration-500 font-sans overflow-hidden">
      <Sidebar role={currentUser.role} activeTab={activeTab} setActiveTab={(tab) => { setActiveTab(tab); if (window.innerWidth < 768) setIsSidebarOpen(false); }} config={schoolConfig} isSidebarOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      {isSidebarOpen && <div className="fixed inset-0 z-[150] bg-[#001f3f]/40 backdrop-blur-sm md:hidden animate-in fade-in duration-300" onClick={() => setIsSidebarOpen(false)} />}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-500 ${isSidebarOpen ? 'md:pl-64' : 'pl-0'}`}>
        <Navbar user={currentUser} onLogout={handleLogout} isDarkMode={isDarkMode} toggleDarkMode={() => setIsDarkMode(!isDarkMode)} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} notifications={notifications} setNotifications={setNotifications} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth scrollbar-hide bg-transparent">{renderActiveTab()}</main>
        <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} role={currentUser.role} />
      </div>
      {toast && (
        <div className={`fixed bottom-20 md:bottom-8 right-4 md:right-8 z-[2000] px-8 py-5 rounded-3xl shadow-2xl border flex items-center gap-4 animate-in slide-in-from-right duration-500 ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-400' : toast.type === 'error' ? 'bg-rose-500 text-white border-rose-400' : 'bg-[#001f3f] text-[#d4af37] border-white/10'
        }`}>
          <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
          <span className="text-xs font-black uppercase tracking-widest">{toast.message}</span>
        </div>
      )}
      {dbLoading && (
        <div className="fixed inset-0 z-[3000] bg-[#001f3f]/40 backdrop-blur-md flex items-center justify-center">
          <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] shadow-2xl flex flex-col items-center space-y-6">
            <div className="w-16 h-16 border-4 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.4em]">Linking Infrastructure...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
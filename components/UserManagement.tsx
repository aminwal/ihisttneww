
import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { TelegramService } from '../services/telegramService.ts';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  currentUser: User;
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, config, currentUser, timetable, setTimetable, assignments, setAssignments, showToast }) => {
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    employeeId: '', 
    password: '', 
    phone_number: '',
    role: UserRole.TEACHER_PRIMARY, 
    secondaryRoles: [] as UserRole[],
    classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isLogisticsProcessing, setIsLogisticsProcessing] = useState(false);
  
  // DM States
  const [dmTarget, setDmTarget] = useState<User | null>(null);
  const [dmMessage, setDmMessage] = useState('');
  const [isSendingDm, setIsSendingDm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isPrincipal = currentUser.role === UserRole.INCHARGE_ALL;
  const canDeletePersonnel = isAdmin || isPrincipal;
  
  const isCloudActive = IS_CLOUD_ENABLED;

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Secondary Faculty',
    [UserRole.INCHARGE_PRIMARY]: 'Primary Incharge',
    [UserRole.INCHARGE_SECONDARY]: 'Secondary Incharge',
    [UserRole.INCHARGE_ALL]: 'Principal',
    ...(isAdmin ? { [UserRole.ADMIN]: 'Administrator' } : {}),
    [UserRole.ADMIN_STAFF]: 'Admin Staff',
  };

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      const allRoles = [u.role, ...(u.secondaryRoles || [])];
      if (roleFilter !== 'ALL' && !allRoles.includes(roleFilter as UserRole)) return false;
      const searchLower = teacherSearch.toLowerCase().trim();
      if (searchLower) {
        const matchesName = u.name.toLowerCase().includes(searchLower);
        const matchesId = u.employeeId.toLowerCase().includes(searchLower);
        const matchesEmail = u.email.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesId && !matchesEmail) return false;
      }
      return true;
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const isFilterActive = roleFilter !== 'ALL' || teacherSearch.trim() !== '';

  const handleSendDm = async () => {
    if (!dmTarget || !dmMessage.trim() || !config.telegramBotToken) return;
    setIsSendingDm(true);
    try {
      const escapedMsg = TelegramService.escape(dmMessage);
      const header = `*${TelegramService.escape(`📩 PRIVATE INSTITUTIONAL NOTICE`)}*\n\n`;
      const footer = `\n\n_Sent by ${TelegramService.escape(currentUser.name)}_`;
      
      const success = await TelegramService.sendMessage(
        config.telegramBotToken,
        dmTarget.telegram_chat_id!,
        header + escapedMsg + footer
      );
      
      if (success) {
        showToast(`Isolated message delivered to ${dmTarget.name}.`, "success");
        setDmTarget(null);
        setDmMessage('');
      } else {
        throw new Error("Message rejected by Telegram API.");
      }
    } catch (err: any) {
      showToast("Communication Failure: " + err.message, "error");
    } finally {
      setIsSendingDm(false);
    }
  };

  const handleExportXML = () => {
    try {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<FacultyRegistry>\n';
      users.forEach(u => {
        xml += `  <Faculty>\n`;
        xml += `    <Name>${u.name}</Name>\n`;
        xml += `    <Email>${u.email}</Email>\n`;
        xml += `    <EmployeeID>${u.employeeId}</EmployeeID>\n`;
        xml += `    <Password>${u.password || 'password123'}</Password>\n`;
        xml += `    <PhoneNumber>${u.phone_number || ''}</PhoneNumber>\n`;
        xml += `    <PrimaryRole>${u.role}</PrimaryRole>\n`;
        xml += `    <SecondaryRoles>${(u.secondaryRoles || []).join(',')}</SecondaryRoles>\n`;
        xml += `    <ClassTeacherOf>${u.classTeacherOf || ''}</ClassTeacherOf>\n`;
        xml += `  </Faculty>\n`;
      });
      xml += '</FacultyRegistry>';
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `IHIS_Faculty_Registry_${new Date().toISOString().split('T')[0]}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Registry XML template generated.", "success");
    } catch (err) {
      showToast("Export Failed", "error");
    }
  };

  const handleImportXML = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLogisticsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(event.target?.result as string, "application/xml");
        const facultyNodes = xmlDoc.getElementsByTagName("Faculty");
        const newPersonnel: User[] = [];
        const cloudPayload: any[] = [];
        for (let i = 0; i < facultyNodes.length; i++) {
          const node = facultyNodes[i];
          const employeeId = node.getElementsByTagName("EmployeeID")[0]?.textContent?.trim() || '';
          if (!employeeId || users.some(u => u.employeeId.toLowerCase() === employeeId.toLowerCase())) continue;
          const id = generateUUID();
          const role = (node.getElementsByTagName("PrimaryRole")[0]?.textContent?.trim() || UserRole.TEACHER_PRIMARY) as UserRole;
          const secondaryStr = node.getElementsByTagName("SecondaryRoles")[0]?.textContent?.trim() || '';
          const secondaryRoles = secondaryStr ? secondaryStr.split(',').map(r => r.trim() as UserRole) : [];
          const user: User = {
            id,
            name: node.getElementsByTagName("Name")[0]?.textContent?.trim() || 'Imported User',
            email: node.getElementsByTagName("Email")[0]?.textContent?.trim() || `${employeeId}@school.com`,
            employeeId,
            password: node.getElementsByTagName("Password")[0]?.textContent?.trim() || 'password123',
            phone_number: node.getElementsByTagName("PhoneNumber")[0]?.textContent?.trim() || undefined,
            role,
            secondaryRoles,
            classTeacherOf: node.getElementsByTagName("ClassTeacherOf")[0]?.textContent?.trim() || undefined,
          };
          newPersonnel.push(user);
          if (isCloudActive) {
            cloudPayload.push({
              id, name: user.name, email: user.email, employee_id: user.employeeId, password: user.password,
              phone_number: user.phone_number || null, role: user.role, secondary_roles: user.secondaryRoles,
              class_teacher_of: user.classTeacherOf || null
            });
          }
        }
        if (newPersonnel.length > 0) {
          if (isCloudActive && cloudPayload.length > 0) {
            const { error } = await supabase.from('profiles').insert(cloudPayload);
            if (error) throw error;
          }
          setUsers(prev => [...newPersonnel, ...prev]);
          showToast(`Ingested ${newPersonnel.length} personnel records.`, "success");
        } else {
          showToast("No new unique records identified.", "info");
        }
      } catch (err: any) {
        showToast(`Import Failed: ${err.message}`, "error");
      } finally {
        setIsLogisticsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').update({
            name: formData.name, email: formData.email, employee_id: formData.employeeId, password: formData.password,
            phone_number: formData.phone_number || null, role: formData.role, secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          }).eq('id', editingId);
          if (error) throw error;
        }
        const updated = users.map(u => u.id === editingId ? { ...u, ...formData } : u);
        setUsers(updated);
        setEditingId(null);
        showToast('Staff profile updated successfully.', 'success');
      } else {
        const id = generateUUID();
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').insert({
            id, name: formData.name, email: formData.email, employee_id: formData.employeeId, password: formData.password,
            phone_number: formData.phone_number || null, role: formData.role, secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          });
          if (error) throw error;
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        showToast('New faculty authorized.', 'success');
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', phone_number: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' });
    } catch (err: any) {
      showToast(err.message || 'Operation failed.', 'error');
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.id === currentUser.id) {
      showToast("Violation: You cannot delete your own account.", "error");
      return;
    }
    if (!confirm(`Institutional Authorization Check:\n\nAre you sure you want to PERMANENTLY remove "${user.name}" from the school roster?\n\nIf this personnel has historical attendance data, the database will preserve integrity and block hard deletion.`)) {
      return;
    }
    try {
      if (isCloudActive) {
        const { error } = await supabase.from('profiles').delete().eq('id', user.id);
        if (error) {
          if (error.code === '23503') {
            const resign = confirm("Constraint Violation: This personnel has historical attendance records.\n\nWould you like to mark them as 'RESIGNED' instead to preserve audit history while removing them from the active roster?");
            if (resign) {
              const { error: updErr } = await supabase.from('profiles').update({ is_resigned: true }).eq('id', user.id);
              if (updErr) throw updErr;
              setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isResigned: true } : u));
              showToast(`${user.name} marked as Resigned.`, "success");
              return;
            } else {
              return;
            }
          }
          throw error;
        }
      }
      setUsers(prev => prev.filter(u => u.id !== user.id));
      showToast(`Personnel ${user.name} purged from registry.`, "success");
    } catch (err: any) {
      showToast(`Matrix Error: ${err.message}`, "error");
    }
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({ 
      name: user.name, email: user.email, employeeId: user.employeeId, password: user.password || '', 
      phone_number: user.phone_number || '', role: user.role, secondaryRoles: user.secondaryRoles || [],
      classTeacherOf: user.classTeacherOf || '' 
    });
    const formElement = document.getElementById('faculty-form');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const clearFilters = () => {
    setTeacherSearch('');
    setRoleFilter('ALL');
  };

  const toggleSecondaryRole = (role: UserRole) => {
    setFormData(prev => {
      const isPresent = prev.secondaryRoles.includes(role);
      const next = isPresent ? prev.secondaryRoles.filter(r => r !== role) : [...prev.secondaryRoles, role];
      return { ...prev, secondaryRoles: next };
    });
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Institutional <span className="text-[#d4af37]">Roster</span></h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em] mt-3">Personnel Deployment Control Matrix</p>
        </div>
        <div className="flex gap-2">
           <button onClick={handleExportXML} className="px-5 py-3 bg-white dark:bg-slate-900 text-[#001f3f] dark:text-[#d4af37] border border-slate-200 dark:border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-50 transition-all flex items-center gap-3 active:scale-95">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              Export XML
           </button>
           <button onClick={() => fileInputRef.current?.click()} disabled={isLogisticsProcessing} className="px-5 py-3 bg-[#001f3f] text-[#d4af37] border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-950 transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50">
              <svg className={`w-4 h-4 ${isLogisticsProcessing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              {isLogisticsProcessing ? 'Processing...' : 'Bulk Import'}
           </button>
           <input type="file" ref={fileInputRef} accept=".xml" className="hidden" onChange={handleImportXML} />
        </div>
      </div>
      
      <div id="faculty-form" className={`bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[3rem] shadow-2xl border transition-all duration-500 ${editingId ? 'ring-8 ring-[#d4af37]/10 border-[#d4af37]/30' : 'border-slate-100 dark:border-slate-800'}`}>
        <div className="flex items-center gap-4 mb-10">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-[#d4af37] shadow-lg ${editingId ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-[#001f3f]'}`}>
            {editingId ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
            )}
          </div>
          <div>
            <h3 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{editingId ? 'Modify Personnel' : 'Register New Faculty'}</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Credentials Stamping Hub</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel Name</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Portal Key (Password)</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Role</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-4 focus:ring-[#d4af37]/20 transition-all cursor-pointer" value={formData.role} onChange={e => {
                const newRole = e.target.value as UserRole;
                setFormData({ ...formData, role: newRole, secondaryRoles: formData.secondaryRoles.filter(r => r !== newRole) });
              }}>
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Of</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-4 focus:ring-[#d4af37]/20 transition-all cursor-pointer" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                <option value="">No Section</option>
                {(config?.classes || []).map(cls => <option key={cls.id} value={cls.name}>{cls.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">WhatsApp</label>
              <input placeholder="97333000000" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-emerald-400/20 border-2 border-transparent focus:border-emerald-400 transition-all" value={formData.phone_number} onChange={e => setFormData({...formData, phone_number: e.target.value})} />
            </div>
            <div className="space-y-4 lg:col-span-3 pt-6 border-t border-slate-50 dark:border-slate-800">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Secondary Roles</label>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => {
                  if (val === formData.role) return null;
                  const isSelected = formData.secondaryRoles.includes(val as UserRole);
                  return (
                    <button key={val} type="button" onClick={() => toggleSecondaryRole(val as UserRole)} className={`px-4 py-3 rounded-2xl text-[9px] font-black uppercase border-2 transition-all text-left truncate ${isSelected ? 'bg-[#d4af37] text-[#001f3f] border-transparent shadow-lg scale-[1.02]' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-transparent hover:border-amber-200'}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2 lg:col-span-3">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Institutional Email</label>
              <input required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center gap-4 pt-4">
             <button type="submit" className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.4em] shadow-2xl hover:bg-slate-950 transition-all transform active:scale-[0.98]">
               {editingId ? 'COMMIT ADJUSTMENTS' : 'AUTHORIZE DEPLOYMENT'}
             </button>
             {editingId && (
               <button type="button" onClick={() => { setEditingId(null); setFormData({ name: '', email: '', employeeId: '', password: '', phone_number: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' }); }} className="px-10 py-6 rounded-3xl bg-slate-100 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
             )}
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-50 dark:border-white/5 overflow-hidden">
        <div className="p-8 md:p-10 border-b border-slate-50 dark:border-white/5 flex flex-col xl:flex-row items-center justify-between gap-8 bg-slate-50/40 dark:bg-slate-800/20">
           <div className="space-y-1 text-center xl:text-left">
              <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Personnel Ledger</h3>
              <div className="flex items-center gap-2 justify-center xl:justify-start">
                 <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                   Messaging Protocol: Blue icon = Ready, Grey icon = Not Linked
                 </p>
              </div>
           </div>
           <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
              <div className="relative group w-full md:w-64">
                <select className="w-full pl-6 pr-10 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase text-[#001f3f] dark:text-white outline-none focus:ring-4 ring-amber-400/20 appearance-none cursor-pointer" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                  <option value="ALL">All Departments</option>
                  {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/></svg>
                </div>
              </div>
              <div className="relative w-full md:w-80">
                <input placeholder="Search..." className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-4 ring-[#d4af37]/20 shadow-sm" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>
              </div>
              {isFilterActive && (
                <button onClick={clearFilters} className="px-4 py-4 rounded-2xl bg-rose-50 text-rose-500 font-black text-[9px] uppercase tracking-widest border border-rose-100 hover:bg-rose-500 hover:text-white transition-all whitespace-nowrap active:scale-95">Clear</button>
              )}
           </div>
        </div>

        <div className="overflow-x-auto scrollbar-hide">
           <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30">
                   <th className="px-10 py-6">Faculty Personnel</th>
                   <th className="px-10 py-6">Status Matrix</th>
                   <th className="px-10 py-6">Class Assignment</th>
                   <th className="px-10 py-6 text-right">Registry Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-white/5">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className={`hover:bg-amber-50/5 transition-all group stagger-row ${u.isResigned ? 'opacity-50 grayscale' : ''}`}>
                    <td className="px-10 py-8">
                      <div className="flex items-center space-x-6">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-sm shadow-xl bg-[#001f3f] text-[#d4af37] border border-white/10">{u.name.substring(0,2)}</div>
                        <div>
                          <p className="font-black text-base italic text-[#001f3f] dark:text-white tracking-tight leading-none">
                            {u.name} {u.isResigned && <span className="ml-2 text-[8px] bg-rose-500 text-white px-2 py-0.5 rounded uppercase not-italic">Resigned</span>}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{u.employeeId} • {u.email}</p>
                             {u.telegram_chat_id && (
                               <div className="flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                                 <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></div>
                                 <span className="text-[8px] font-black text-emerald-600 uppercase">Telegram Linked</span>
                               </div>
                             )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-8">
                       <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-1.5 bg-[#001f3f] text-[#d4af37] text-[8px] font-black uppercase rounded-lg border border-white/10">{ROLE_DISPLAY_MAP[u.role] || u.role}</span>
                          {(u.secondaryRoles || []).map(r => (
                             <span key={r} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[8px] font-black uppercase rounded-lg border border-slate-200">{ROLE_DISPLAY_MAP[r] || r}</span>
                          ))}
                       </div>
                    </td>
                    <td className="px-10 py-8">
                       {u.classTeacherOf ? (
                         <span className="px-4 py-2 bg-amber-50 text-amber-600 text-[10px] font-black uppercase rounded-xl border border-amber-100 italic">Section {u.classTeacherOf}</span>
                       ) : (
                         <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic opacity-40">General</span>
                       )}
                    </td>
                    <td className="px-10 py-8 text-right">
                       <div className="flex items-center justify-end gap-2">
                          {u.telegram_chat_id ? (
                             <button onClick={() => setDmTarget(u)} className="p-3 bg-sky-600 text-white rounded-2xl shadow-lg hover:scale-110 active:scale-95 transition-all" title="Send Isolated Notice (Synced)">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                             </button>
                          ) : (
                             <button disabled className="p-3 bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600 rounded-2xl cursor-not-allowed border border-dashed border-slate-200 dark:border-slate-700" title="Account Not Linked - Teacher must sync in Profile tab">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                             </button>
                          )}
                          <button onClick={() => startEdit(u)} className="px-6 py-3 bg-sky-50 text-sky-600 text-[10px] font-black uppercase tracking-widest rounded-2xl border-2 border-sky-100 shadow-sm transition-all hover:bg-sky-600 hover:text-white active:scale-95">Modify</button>
                          {canDeletePersonnel && u.id !== currentUser.id && (
                            <button onClick={() => handleDeleteUser(u)} className="px-6 py-3 bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest rounded-2xl border-2 border-rose-100 shadow-sm transition-all hover:bg-rose-600 hover:text-white active:scale-95" title="Purge Roster Entry">
                              Delete Faculty
                            </button>
                          )}
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>
      </div>

      {/* DM Modal */}
      {dmTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Isolated Notice</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Private matrix message to {dmTarget.name}</p>
             </div>
             <textarea 
               rows={5}
               placeholder="Compose message for isolated broadcast..." 
               value={dmMessage}
               onChange={e => setDmMessage(e.target.value)}
               className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-8 py-6 text-sm font-bold dark:text-white outline-none focus:ring-4 ring-amber-400/20"
             />
             <button 
               onClick={handleSendDm}
               disabled={isSendingDm || !dmMessage.trim()}
               className="w-full bg-[#0088cc] text-white py-6 rounded-3xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-[#0077b5] transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
             >
               {isSendingDm ? 'Transmitting...' : 'Dispatch isolated alert'}
             </button>
             <button onClick={() => { setDmTarget(null); setDmMessage(''); }} className="text-slate-400 font-black text-[11px] uppercase tracking-widest w-full">Abort dispatch</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;

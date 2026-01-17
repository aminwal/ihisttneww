import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

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
  
  const isAdmin = currentUser.role === UserRole.ADMIN;
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
      
      // Filter by role
      if (roleFilter !== 'ALL' && !allRoles.includes(roleFilter as UserRole)) return false;
      
      // Filter by search term
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').update({
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            phone_number: formData.phone_number || null,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
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
            id,
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            phone_number: formData.phone_number || null,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          });
          if (error) throw error;
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        showToast('New faculty credential authorized.', 'success');
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', phone_number: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' });
    } catch (err: any) {
      showToast(err.message || 'Operation failed.', 'error');
    }
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({ 
      name: user.name, 
      email: user.email, 
      employeeId: user.employeeId, 
      password: user.password || '', 
      phone_number: user.phone_number || '',
      role: user.role, 
      secondaryRoles: user.secondaryRoles || [],
      classTeacherOf: user.classTeacherOf || '' 
    });
    // Scroll to the form area
    const formElement = document.getElementById('faculty-form');
    if (formElement) formElement.scrollIntoView({ behavior: 'smooth' });
  };

  const clearFilters = () => {
    setTeacherSearch('');
    setRoleFilter('ALL');
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Institutional <span className="text-[#d4af37]">Roster</span></h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em] mt-3">Personnel Deployment Control Matrix</p>
        </div>
      </div>
      
      {/* Faculty Add/Edit Form */}
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
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel Full Name</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID (Emp No)</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Portal Access Key (Password)</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Functional Designation</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-4 focus:ring-[#d4af37]/20 transition-all cursor-pointer" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Assignment</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-4 focus:ring-[#d4af37]/20 transition-all cursor-pointer" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                <option value="">No Class Assigned</option>
                {(config?.classes || []).map(cls => <option key={cls.id} value={cls.name}>{cls.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">WhatsApp Link</label>
                <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-tighter">Verified Contact</span>
              </div>
              <input placeholder="97333000000" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-emerald-400/20 border-2 border-transparent focus:border-emerald-400 transition-all" value={formData.phone_number} onChange={e => setFormData({...formData, phone_number: e.target.value})} />
            </div>
            <div className="space-y-2 lg:col-span-3">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Institutional Email</label>
              <input required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-4 focus:ring-[#d4af37]/20 border-2 border-transparent focus:border-[#d4af37] transition-all" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
             <button type="submit" className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.4em] shadow-[0_20px_50px_-12px_rgba(0,31,63,0.3)] hover:bg-slate-950 transition-all transform active:scale-[0.98]">
               {editingId ? 'COMMIT STAFF ADJUSTMENTS' : 'DEPLOY PERSONNEL ASSETS'}
             </button>
             {editingId && (
               <button type="button" onClick={() => { setEditingId(null); setFormData({ name: '', email: '', employeeId: '', password: '', phone_number: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' }); }} className="px-10 py-6 rounded-3xl bg-slate-100 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button>
             )}
          </div>
        </form>
      </div>

      {/* Roster Ledger */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-50 dark:border-white/5 overflow-hidden">
        <div className="p-8 md:p-10 border-b border-slate-50 dark:border-white/5 flex flex-col xl:flex-row items-center justify-between gap-8 bg-slate-50/40 dark:bg-slate-800/20">
           <div className="space-y-1 text-center xl:text-left">
              <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Personnel Roster</h3>
              <div className="flex items-center gap-2 justify-center xl:justify-start">
                 <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                   {filteredTeachers.length} Staff Members {isFilterActive ? 'Identified' : 'Active'}
                 </p>
              </div>
           </div>

           <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
              {/* Role Filter */}
              <div className="relative group w-full md:w-64">
                <select 
                  className="w-full pl-6 pr-10 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#001f3f] dark:text-white outline-none focus:ring-4 ring-amber-400/20 focus:border-amber-400 transition-all appearance-none cursor-pointer shadow-sm"
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                >
                  <option value="ALL">All Departments</option>
                  {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/></svg>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative w-full md:w-80">
                <input 
                  placeholder="Search by name, ID or email..."
                  className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#001f3f] dark:text-white outline-none focus:ring-4 ring-[#d4af37]/20 focus:border-[#d4af37] transition-all shadow-sm"
                  value={teacherSearch}
                  onChange={e => setTeacherSearch(e.target.value)}
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>
              </div>

              {isFilterActive && (
                <button 
                  onClick={clearFilters}
                  className="px-4 py-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 text-rose-500 font-black text-[9px] uppercase tracking-widest border border-rose-100 dark:border-rose-900 hover:bg-rose-500 hover:text-white transition-all whitespace-nowrap active:scale-95"
                >
                  Clear Filters
                </button>
              )}
           </div>
        </div>

        <div className="overflow-x-auto scrollbar-hide">
           <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/30">
                   <th className="px-10 py-6 border-b border-slate-100 dark:border-white/5">Faculty Personnel</th>
                   <th className="px-10 py-6 border-b border-slate-100 dark:border-white/5">Departmental Role</th>
                   <th className="px-10 py-6 border-b border-slate-100 dark:border-white/5">Classroom Unit</th>
                   <th className="px-10 py-6 border-b border-slate-100 dark:border-white/5">Verified Contact</th>
                   <th className="px-10 py-6 border-b border-slate-100 dark:border-white/5 text-right">Registry Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-white/5">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-amber-50/5 transition-all group stagger-row">
                    <td className="px-10 py-8">
                      <div className="flex items-center space-x-6">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-sm shadow-xl bg-[#001f3f] text-[#d4af37] transform group-hover:scale-110 transition-transform duration-500 border border-white/10">{u.name.substring(0,2)}</div>
                        <div>
                          <p className="font-black text-base italic text-[#001f3f] dark:text-white tracking-tight leading-none">{u.name}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
                             <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                             {u.employeeId}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-8">
                       <span className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                         {u.role.replace(/_/g, ' ')}
                       </span>
                    </td>
                    <td className="px-10 py-8">
                       {u.classTeacherOf ? (
                         <div className="flex items-center gap-3">
                           <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(212,175,55,0.5)]"></div>
                           <span className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase rounded-xl border border-amber-100 dark:border-amber-900 shadow-sm italic">
                             Section {u.classTeacherOf}
                           </span>
                         </div>
                       ) : (
                         <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic opacity-40">General Faculty</span>
                       )}
                    </td>
                    <td className="px-10 py-8">
                      {u.phone_number ? (
                         <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-black italic text-xs">
                            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.222-4.032c1.53.939 3.274 1.443 5.066 1.444 5.439 0 9.865-4.427 9.867-9.867.001-2.63-1.023-5.102-2.884-6.964a9.774 9.774 0 00-6.977-2.881c-5.438 0-9.866 4.426-9.867 9.866 0 1.902.538 3.758 1.554 5.36l-.1.173-1.012 3.691 3.782-.992.174.103zm10.274-6.487c-.19-.094-1.128-.558-1.303-.622-.175-.064-.301-.097-.428.094-.127.19-.49.622-.601.748-.11.127-.222.143-.413.048-.19-.094-.8-.294-1.522-.94-.562-.5-1.026-1.119-1.137-1.309-.11-.19-.012-.294.083-.388.086-.085.19-.223.285-.335.095-.11.127-.19.19-.317.064-.127.032-.238-.016-.333-.048-.094-.428-1.03-.587-1.413-.155-.373-.31-.322-.428-.328-.11-.006-.238-.007-.365-.007-.127 0-.333.048-.508.238-.174.19-.667.651-.667 1.588 0 .937.683 1.842.778 1.968.095.127 1.343 2.051 3.255 2.877.455.197.81.314 1.086.402.458.145.874.124 1.205.075.369-.054 1.128-.461 1.286-.905.158-.444.158-.825.11-.905-.048-.08-.175-.127-.365-.221z"/></svg>
                            +{u.phone_number}
                         </div>
                      ) : (
                         <span className="text-[10px] font-black text-rose-300 dark:text-rose-900 uppercase tracking-widest italic">Not Linked</span>
                      )}
                    </td>
                    <td className="px-10 py-8 text-right">
                       <button 
                         onClick={() => startEdit(u)} 
                         className="px-6 py-3 bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 text-[10px] font-black uppercase tracking-widest rounded-2xl border-2 border-sky-100 dark:border-sky-900 shadow-sm transition-all hover:bg-sky-600 hover:text-white active:scale-95"
                       >
                         Modify Profile
                       </button>
                    </td>
                  </tr>
                ))}
                {filteredTeachers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-10 py-32 text-center">
                       <div className="max-w-xs mx-auto space-y-4 opacity-30">
                          <svg className="w-16 h-16 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 9.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.4em] italic">No Personnel Registry Match</p>
                          <button onClick={clearFilters} className="text-[9px] font-black text-sky-500 uppercase underline decoration-2 underline-offset-4">Reset Query Matrix</button>
                       </div>
                    </td>
                  </tr>
                )}
              </tbody>
           </table>
        </div>
        
        <div className="p-8 bg-slate-50/40 dark:bg-slate-800/30 border-t border-slate-50 dark:border-white/5 text-center">
           <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">End of Multi-Departmental Ledger</p>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
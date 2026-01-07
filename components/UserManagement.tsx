
import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase } from '../supabaseClient.ts';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  currentUser: User;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, config, currentUser }) => {
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    employeeId: '', 
    password: '', 
    role: UserRole.TEACHER_PRIMARY, 
    secondaryRoles: [] as UserRole[],
    classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const isAdmin = currentUser.role === UserRole.ADMIN;

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Faculty',
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
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const toggleSecondaryRole = (role: UserRole) => {
    if (formData.role === role) return;
    setFormData(prev => ({
      ...prev,
      secondaryRoles: prev.secondaryRoles.includes(role)
        ? prev.secondaryRoles.filter(r => r !== role)
        : [...prev.secondaryRoles, role]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

    try {
      if (editingId) {
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').update({
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          }).eq('id', editingId);
          if (error) throw error;
        }
        const updated = users.map(u => u.id === editingId ? { ...u, ...formData } : u);
        setUsers(updated);
        setEditingId(null);
        setStatus({ type: 'success', message: 'Staff profile synchronized with database.' });
      } else {
        const id = generateUUID();
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').insert({
            id,
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          });
          if (error) throw error;
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        setStatus({ type: 'success', message: 'New faculty credential authorized.' });
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Institutional Handshake Failed.' });
    }
    setTimeout(() => setStatus(null), 3000);
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({ 
      name: user.name, 
      email: user.email, 
      employeeId: user.employeeId, 
      password: user.password || '', 
      role: user.role, 
      secondaryRoles: user.secondaryRoles || [],
      classTeacherOf: user.classTeacherOf || '' 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase leading-none">Faculty Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Multi-Departmental Deployment Control Center</p>
        </div>
      </div>
      
      <div className={`bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl border transition-all ${editingId ? 'ring-4 ring-[#d4af37] border-transparent' : 'border-slate-100 dark:border-slate-800'}`}>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-8">Personnel Deployment Form</h3>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel Full Name</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID (Emp No)</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Security Access Key</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Department Wing</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole, secondaryRoles: formData.secondaryRoles.filter(r => r !== e.target.value)})}>
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Engagement</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                <option value="">No Active Class Assignment</option>
                {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Secondary Functional Roles (Multi-Wing Duties)</label>
            <div className="flex flex-wrap gap-2.5 bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-inner">
               {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => {
                 if (val === formData.role) return null;
                 const isSelected = formData.secondaryRoles.includes(val as UserRole);
                 return (
                   <button 
                     type="button" 
                     key={val} 
                     onClick={() => toggleSecondaryRole(val as UserRole)}
                     className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all border shadow-sm ${isSelected ? 'bg-[#d4af37] text-[#001f3f] border-transparent scale-105' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'}`}
                   >
                     {label}
                   </button>
                 );
               })}
            </div>
          </div>

          {status && (
            <div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase border tracking-widest animate-in zoom-in duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
               {status.message}
            </div>
          )}

          <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-900 transition-all transform active:scale-95">
            {editingId ? 'COMMIT STAFF UPDATES' : 'DEPLOY PERSONNEL CREDENTIALS'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-8 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
           <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">Active Institutional Roster</h3>
           <div className="flex gap-4">
              <input type="text" placeholder="Filter roster..." value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} className="px-5 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-[10px] font-black uppercase" />
           </div>
        </div>
        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-6">Faculty Member</th>
                   <th className="px-10 py-6">Departmental Assignments</th>
                   <th className="px-10 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => {
                  const allRoles = [u.role, ...(u.secondaryRoles || [])];
                  return (
                    <tr key={u.id} className="hover:bg-amber-50/5 transition-colors">
                      <td className="px-10 py-8">
                        <div className="flex items-center space-x-5">
                          <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-2xl flex items-center justify-center font-black text-xs shadow-md">{u.name.substring(0,2)}</div>
                          <div>
                            <p className="font-black text-sm text-[#001f3f] dark:text-white leading-tight italic">{u.name}</p>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{u.employeeId} | {u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-10 py-8">
                        <div className="flex flex-wrap gap-2">
                          {allRoles.map(r => (
                            <span key={r} className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase border whitespace-nowrap ${r === u.role ? 'bg-sky-50 text-sky-600 border-sky-100 shadow-sm' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                              {ROLE_DISPLAY_MAP[r]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-10 py-8 text-right">
                         <div className="flex items-center justify-end space-x-6">
                            <button onClick={() => startEdit(u)} className="text-[11px] font-black uppercase text-sky-600 hover:underline">Revise Profile</button>
                            <button onClick={() => setUsers(prev => prev.filter(x => x.id !== u.id))} className="text-[11px] font-black uppercase text-red-500 hover:underline">Purge Access</button>
                         </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
           </table>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;

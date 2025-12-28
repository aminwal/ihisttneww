
import React, { useState, useMemo } from 'react';
import { User, UserRole, SchoolConfig } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase } from '../supabaseClient.ts';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  currentUser: User;
  onCloudRefresh?: () => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, config, currentUser, onCloudRefresh }) => {
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    employeeId: '', 
    password: '', 
    role: UserRole.TEACHER_PRIMARY, 
    classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isCloudActive = !supabase.supabaseUrl.includes('placeholder');

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Faculty',
    [UserRole.INCHARGE_PRIMARY]: 'Primary Incharge',
    [UserRole.INCHARGE_SECONDARY]: 'Secondary Incharge',
    [UserRole.INCHARGE_ALL]: 'General Incharge',
    ...(isAdmin ? { [UserRole.ADMIN]: 'Administrator' } : {}),
    [UserRole.ADMIN_STAFF]: 'Admin Staff',
  };

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccessMsg(null);

    try {
      const targetId = editingId || generateUUID();
      const userData = {
        id: targetId,
        employee_id: formData.employeeId.trim(),
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        role: formData.role,
        class_teacher_of: formData.classTeacherOf || null
      };

      // 1. Push to Supabase if active
      if (isCloudActive) {
        const { error } = await supabase
          .from('profiles')
          .upsert(userData, { onConflict: 'employee_id' });

        if (error) {
          throw new Error(`Cloud Infrastructure Error: ${error.message}`);
        }
      }

      // 2. Prepare Local Update
      const frontendUser: User = {
        id: targetId,
        employeeId: formData.employeeId.trim(),
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        role: formData.role,
        classTeacherOf: formData.classTeacherOf || undefined
      };

      // 3. Update Local State (Snap Response)
      if (editingId) {
        setUsers(prev => prev.map(u => u.id === editingId ? frontendUser : u));
        setEditingId(null);
        setSuccessMsg("Faculty record updated successfully.");
      } else {
        setUsers(prev => [frontendUser, ...prev]);
        setSuccessMsg("New faculty registered successfully.");
      }

      // 4. Reset Form
      setFormData({ name: '', email: '', employeeId: '', password: '', role: UserRole.TEACHER_PRIMARY, classTeacherOf: '' });
      
      // 5. Trigger cloud refresh if callback provided
      if (onCloudRefresh) onCloudRefresh();

      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error("IHIS Registration Exception:", err);
      alert(err.message || "System Error: Critical failure during faculty registration.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({ 
      name: user.name, 
      email: user.email, 
      employeeId: user.employeeId, 
      password: user.password || '', 
      role: user.role, 
      classTeacherOf: user.classTeacherOf || '' 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, empId: string) => {
    if (!window.confirm(`Permanently decommission faculty record for ${empId}?`)) return;
    
    setLoading(true);
    try {
      if (isCloudActive) {
        const { error } = await supabase.from('profiles').delete().eq('id', id);
        if (error) throw error;
      }
      setUsers(prev => prev.filter(x => x.id !== id));
      setSuccessMsg(`Faculty ${empId} removed.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(`Delete Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic">Faculty Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            {isCloudActive ? 'Status: Cloud Integrated (Active)' : 'Status: Local Standalone Mode'}
          </p>
        </div>
        {successMsg && (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 px-6 py-2 rounded-full border border-emerald-100 text-[10px] font-black uppercase tracking-widest animate-bounce">
            {successMsg}
          </div>
        )}
      </div>
      
      {/* Dynamic Form Area */}
      <div className={`bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-xl border transition-all ${editingId ? 'ring-4 ring-amber-400 border-transparent' : 'border-gray-100 dark:border-slate-800'}`}>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-6">Identity Registry</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
             <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. Ahmed Minwal" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Employee ID (Unique)</label>
             <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. emp001" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
             <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="email@school.com" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Portal Password</label>
             <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-amber-400" placeholder="Secret Key" type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
           </div>
           
           <div className="flex flex-col space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Privilege</label>
             <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-amber-400" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
               {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
             </select>
           </div>

           <div className="flex flex-col space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Assignment</label>
             <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-amber-400" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
               <option value="">None / Not a Class Teacher</option>
               {config.classes.map(c => (
                 <option key={c.id} value={c.name}>{c.name} ({c.section.replace('_', ' ')})</option>
               ))}
             </select>
           </div>

           <div className="flex items-end lg:col-span-3">
             <button 
              type="submit" 
              disabled={loading}
              className={`w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 active:scale-95 transition-all flex items-center justify-center gap-3 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
             >
               {loading && <div className="w-3 h-3 border-2 border-brand-gold border-t-transparent rounded-full animate-spin"></div>}
               {editingId ? (loading ? 'Synchronizing...' : 'Update Faculty Record') : (loading ? 'Registering...' : 'Register New Faculty')}
             </button>
           </div>
        </form>
      </div>

      {/* Faculty List Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-4 md:p-8 bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 items-center justify-between">
           <div className="flex items-center gap-3 w-full md:w-auto">
             <input type="text" placeholder="Search faculty..." className="w-full md:w-64 px-5 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase outline-none" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} />
             <button onClick={() => onCloudRefresh?.()} className="p-3 bg-white dark:bg-slate-800 border border-slate-200 rounded-xl text-sky-600 hover:bg-sky-50 transition-colors" title="Sync from Cloud">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
             </button>
           </div>
           <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="w-full md:w-auto px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white">
             <option value="ALL">All Roles</option>
             {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
           </select>
        </div>

        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-5">Identity</th>
                   <th className="px-10 py-5">Privilege</th>
                   <th className="px-10 py-5">Class Charge</th>
                   <th className="px-10 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-10 py-6">
                       <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs">{u.name.substring(0,2)}</div>
                          <div>
                            <p className="font-black text-sm text-[#001f3f] dark:text-white">{u.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{u.employeeId}</p>
                          </div>
                       </div>
                    </td>
                    <td className="px-10 py-6">
                       <span className="px-3 py-1 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-lg text-[8px] font-black uppercase border border-sky-100">{ROLE_DISPLAY_MAP[u.role]}</span>
                    </td>
                    <td className="px-10 py-6">
                       {u.classTeacherOf ? (
                         <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-lg text-[8px] font-black uppercase border border-amber-100">Class: {u.classTeacherOf}</span>
                       ) : (
                         <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">N/A</span>
                       )}
                    </td>
                    <td className="px-10 py-6 text-right">
                       <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600 mr-4 hover:underline">Edit</button>
                       <button onClick={() => handleDelete(u.id, u.employeeId)} className="text-[10px] font-black uppercase text-red-500 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>

        {/* Mobile Card Feed */}
        <div className="md:hidden p-4 space-y-3 bg-slate-50/30 dark:bg-slate-900/50">
           {filteredTeachers.map(u => (
             <div key={u.id} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                   <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs">{u.name.substring(0,2)}</div>
                      <div>
                        <p className="font-black text-sm text-[#001f3f] dark:text-white">{u.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{u.employeeId}</p>
                      </div>
                   </div>
                   <div className="flex flex-col items-end space-y-1">
                      <span className="text-[7px] font-black px-2 py-1 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-lg border border-sky-100 uppercase">{ROLE_DISPLAY_MAP[u.role]}</span>
                      {u.classTeacherOf && (
                        <span className="text-[7px] font-black px-2 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-lg border border-amber-100 uppercase">{u.classTeacherOf}</span>
                      )}
                   </div>
                </div>
                <div className="flex items-center justify-end gap-6 pt-2 border-t border-slate-50 dark:border-slate-800">
                   <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600">Update Profile</button>
                   <button onClick={() => handleDelete(u.id, u.employeeId)} className="text-[10px] font-black uppercase text-red-500">Purge</button>
                </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
};

export default UserManagement;

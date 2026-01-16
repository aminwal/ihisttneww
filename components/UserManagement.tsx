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
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      if (roleFilter !== 'ALL' && !allRoles.includes(roleFilter as UserRole)) return false;
      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Faculty Registry</h1>
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
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Responsibility</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                <option value="">No Class Assigned</option>
                {(config?.classes || []).map(cls => <option key={cls.id} value={cls.name}>{cls.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center px-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">WhatsApp Number</label>
                <span className="text-[7px] font-bold text-[#d4af37] uppercase">With Code (e.g. 973)</span>
              </div>
              <input placeholder="97333000000" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-emerald-400" value={formData.phone_number} onChange={e => setFormData({...formData, phone_number: e.target.value})} />
            </div>
            <div className="space-y-1.5 lg:col-span-3">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
          </div>

          <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-900 transition-all transform active:scale-95">
            {editingId ? 'COMMIT STAFF UPDATES' : 'DEPLOY PERSONNEL CREDENTIALS'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-8 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
           <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">Active Institutional Roster</h3>
        </div>
        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-6">Faculty Member</th>
                   <th className="px-10 py-6">Responsibility</th>
                   <th className="px-10 py-6">WhatsApp</th>
                   <th className="px-10 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-amber-50/5 transition-colors">
                    <td className="px-10 py-8">
                      <div className="flex items-center space-x-5">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs shadow-md bg-[#001f3f] text-[#d4af37]">{u.name.substring(0,2)}</div>
                        <div>
                          <p className="font-black text-sm italic text-[#001f3f] dark:text-white">{u.name}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{u.employeeId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-8">
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-tighter">
                         {u.classTeacherOf ? `CT: ${u.classTeacherOf}` : 'General Faculty'}
                       </p>
                       <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">
                         {u.role.replace(/_/g, ' ')}
                       </p>
                    </td>
                    <td className="px-10 py-8">
                      <p className={`text-[11px] font-black italic ${u.phone_number ? 'text-emerald-600' : 'text-rose-300'}`}>
                        {u.phone_number ? `+${u.phone_number}` : 'NOT LINKED'}
                      </p>
                    </td>
                    <td className="px-10 py-8 text-right">
                       <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600 hover:underline">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
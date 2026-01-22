
import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment, SchoolSection } from '../types.ts';
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
    name: '', email: '', employeeId: '', password: '', phone_number: '', 
    role: UserRole.TEACHER_PRIMARY, secondaryRoles: [] as UserRole[], classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isCloudActive = IS_CLOUD_ENABLED;

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      const allRoles = [u.role, ...(u.secondaryRoles || [])];
      if (roleFilter !== 'ALL' && !allRoles.includes(roleFilter as UserRole)) return false;
      const s = teacherSearch.toLowerCase();
      return !s || u.name.toLowerCase().includes(s) || u.employeeId.toLowerCase().includes(s);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name, email: formData.email, employee_id: formData.employeeId, password: formData.password,
        phone_number: formData.phone_number || null, role: formData.role, secondary_roles: formData.secondaryRoles,
        class_teacher_of: formData.classTeacherOf || null
      };

      if (editingId) {
        if (isCloudActive) await supabase.from('profiles').update(payload).eq('id', editingId);
        setUsers(users.map(u => u.id === editingId ? { ...u, ...formData } : u));
        setEditingId(null);
        showToast('Staff updated.', 'success');
      } else {
        const id = generateUUID();
        if (isCloudActive) await supabase.from('profiles').insert({ id, ...payload });
        setUsers([{ id, ...formData }, ...users]);
        showToast('Faculty authorized.', 'success');
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', phone_number: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' });
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const getSectionLabel = (id: string) => config.sections.find(s => s.id === id)?.fullName || 'N/A';

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[3rem] shadow-2xl border border-slate-100">
        <h3 className="text-lg font-black text-[#001f3f] uppercase italic tracking-tighter mb-8">Personnel Registration</h3>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <input placeholder="Full Name" required className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold text-sm" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            <input placeholder="Staff ID" required className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold text-sm" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
            <select className="w-full px-6 py-4 bg-slate-50 rounded-2xl text-[11px] font-black uppercase" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
              {Object.values(UserRole).map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
            {/* Hierarchical Section Picker */}
            <div className="space-y-1">
               <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Assignment</label>
               <select className="w-full px-6 py-4 bg-slate-50 rounded-2xl text-[11px] font-black uppercase border-2 border-transparent focus:border-amber-400 outline-none" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                 <option value="">No Active Section</option>
                 {(config.wings || []).map(w => (
                   <optgroup key={w.id} label={w.name}>
                     {(config.grades || []).filter(g => g.wingId === w.id).map(g => (
                       <optgroup key={g.id} label={`  — ${g.name}`}>
                         {(config.sections || []).filter(s => s.gradeId === g.id).map(s => (
                           <option key={s.id} value={s.id}>    {s.fullName}</option>
                         ))}
                       </optgroup>
                     ))}
                   </optgroup>
                 ))}
               </select>
            </div>
            <input placeholder="Password" required className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold text-sm" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            <input placeholder="Institutional Email" required type="email" className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold text-sm" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
          </div>
          <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl">Authorize Protocol</button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-xl overflow-hidden border border-slate-50">
         <table className="w-full text-left">
            <thead>
               <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50">
                  <th className="px-8 py-5">Personnel</th>
                  <th className="px-8 py-5">Role Matrix</th>
                  <th className="px-8 py-5">Assignment</th>
                  <th className="px-8 py-5 text-right">Registry Controls</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
               {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-all">
                     <td className="px-8 py-6">
                        <p className="font-black text-sm text-[#001f3f]">{u.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{u.employeeId}</p>
                     </td>
                     <td className="px-8 py-6">
                        <span className="px-3 py-1 bg-[#001f3f] text-[#d4af37] text-[8px] font-black uppercase rounded-lg">{u.role}</span>
                     </td>
                     <td className="px-8 py-6">
                        <span className="text-[10px] font-bold text-slate-500 italic uppercase">{getSectionLabel(u.classTeacherOf || '')}</span>
                     </td>
                     <td className="px-8 py-6 text-right">
                        <button onClick={() => { setEditingId(u.id); setFormData({ name: u.name, email: u.email, employeeId: u.employeeId, password: u.password || '', phone_number: u.phone_number || '', role: u.role, secondaryRoles: u.secondaryRoles || [], classTeacherOf: u.classTeacherOf || '' }); }} className="text-sky-600 font-black text-[10px] uppercase">Modify</button>
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};

export default UserManagement;

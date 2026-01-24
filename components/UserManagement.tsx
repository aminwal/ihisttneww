
import React, { useState, useMemo } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment, SubjectCategory, SchoolNotification, RoleLoadPolicy } from '../types.ts';
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
  setNotifications: React.Dispatch<React.SetStateAction<SchoolNotification[]>>;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ 
  users, setUsers, config, currentUser, timetable, setTimetable, assignments, setAssignments, showToast, setNotifications, isSandbox, addSandboxLog
}) => {
  const [formData, setFormData] = useState({ 
    name: '', email: '', employeeId: '', password: '', phone_number: '', 
    role: UserRole.TEACHER_PRIMARY as string, secondaryRoles: [] as string[], 
    classTeacherOf: '', expertise: [] as string[], isResigned: false 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isFormVisible, setIsFormVisible] = useState(false);

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const availableRoles = useMemo(() => Array.from(new Set([...Object.values(UserRole), ...(config.customRoles || [])])), [config.customRoles]);

  const getTeacherLoadMetrics = (teacherId: string, role: string) => {
    const asgns = assignments.filter(a => a.teacherId === teacherId);
    const policy = config.loadPolicies?.[role] || { baseTarget: 28, substitutionCap: 5 };
    const base = asgns.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0);
    const group = asgns.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
    const currentBase = base + group;
    const proxy = timetable.filter(t => t.teacherId === teacherId && t.isSubstitution).length;

    return {
      currentBase,
      baseTarget: policy.baseTarget,
      proxyCount: proxy,
      proxyCap: policy.substitutionCap,
      isBaseOverloaded: currentBase > policy.baseTarget,
      isProxyOverloaded: proxy > policy.substitutionCap
    };
  };

  const filteredStaff = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      const matchesSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.employeeId.toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      return matchesSearch && matchesRole;
    }).sort((a, b) => {
      if (a.isResigned && !b.isResigned) return 1;
      if (!a.isResigned && b.isResigned) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [users, search, roleFilter, isAdmin]);

  const toggleSecondaryRole = (role: string) => {
    setFormData(prev => ({
      ...prev,
      secondaryRoles: prev.secondaryRoles.includes(role) 
        ? prev.secondaryRoles.filter(r => r !== role) 
        : [...prev.secondaryRoles, role]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        employee_id: formData.employeeId,
        email: formData.email || `${formData.employeeId}@school.com`,
        password: formData.password,
        role: formData.role,
        secondary_roles: formData.secondaryRoles,
        phone_number: formData.phone_number,
        class_teacher_of: formData.classTeacherOf,
        expertise: formData.expertise,
        is_resigned: formData.isResigned
      };

      if (editingId) {
        if (IS_CLOUD_ENABLED && !isSandbox) {
          const { error } = await supabase.from('profiles').update(payload).eq('id', editingId);
          if (error) throw error;
        } else if (isSandbox) {
          addSandboxLog?.('USER_EDIT', { id: editingId, data: formData });
        }

        setUsers(users.map(u => u.id === editingId ? { ...u, ...formData } : u));
        setEditingId(null);
      } else {
        const id = generateUUID();
        if (IS_CLOUD_ENABLED && !isSandbox) {
          const { error } = await supabase.from('profiles').insert({ id, ...payload });
          if (error) throw error;
        } else if (isSandbox) {
          addSandboxLog?.('USER_ENROLL', { id, data: formData });
        }

        setUsers([{ id, ...formData }, ...users]);
      }
      
      setFormData({ 
        name: '', email: '', employeeId: '', password: '', phone_number: '', 
        role: UserRole.TEACHER_PRIMARY as string, secondaryRoles: [] as string[], 
        classTeacherOf: '', expertise: [] as string[], isResigned: false 
      });
      setIsFormVisible(false);
      showToast("Personnel Registry Updated", "success");
    } catch (err: any) { 
      showToast(err.message, "error"); 
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="flex flex-1 gap-3 max-w-2xl">
           <input type="text" placeholder="Search Faculty..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 px-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 rounded-2xl font-bold text-xs outline-none dark:text-white" />
           <select className="px-4 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase outline-none dark:text-white" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
             <option value="ALL">All Departments</option>
             {availableRoles.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
           </select>
        </div>
        <button onClick={() => { setIsFormVisible(!isFormVisible); setEditingId(null); }} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">{isFormVisible ? 'Discard Form' : '+ Enroll Staff'}</button>
      </div>

      {isFormVisible && (
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[3rem] shadow-2xl border-2 border-[#d4af37]/20 animate-in zoom-in duration-300">
          <form onSubmit={handleSubmit} className="space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Legal Name</label>
                <input placeholder="Enter Name" required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 ring-[#d4af37]/50 transition-all" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID (empXXX)</label>
                <input placeholder="Enter ID" required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 ring-[#d4af37]/50 transition-all" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Security Access Key</label>
                <input placeholder="Registry Password" required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 ring-[#d4af37]/50 transition-all" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Department</label>
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                  {availableRoles.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em]">Secondary Institutional Access</p>
              <div className="flex flex-wrap gap-3 p-6 bg-slate-50 dark:bg-slate-950/50 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                {availableRoles.filter(r => r !== formData.role && r !== UserRole.ADMIN).map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleSecondaryRole(role)}
                    className={`px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                      formData.secondaryRoles.includes(role)
                        ? 'bg-amber-400 text-[#001f3f] shadow-lg scale-105'
                        : 'bg-white dark:bg-slate-800 text-slate-400 hover:text-amber-500'
                    }`}
                  >
                    {role.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button type="submit" className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95">
                {editingId ? 'Confirm Identity Update' : 'Authorize New Personnel'}
              </button>
              <button type="button" onClick={() => { setIsFormVisible(false); setEditingId(null); }} className="px-12 py-6 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
         {filteredStaff.map(u => {
            const m = getTeacherLoadMetrics(u.id, u.role);
            const baseColor = m.isBaseOverloaded ? 'bg-rose-500' : 'bg-emerald-500';
            const proxyColor = m.isProxyOverloaded ? 'bg-rose-500' : 'bg-sky-500';

            return (
              <div key={u.id} className={`group bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border-2 transition-all p-8 flex flex-col space-y-6 ${u.isResigned ? 'opacity-40 grayscale' : 'hover:scale-105'} border-slate-50 dark:border-slate-800`}>
                 <div className="flex justify-between items-start">
                    <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-lg shadow-lg">{u.name.substring(0, 2).toUpperCase()}</div>
                    <button onClick={() => { 
                      setEditingId(u.id); 
                      setFormData({ 
                        ...u, 
                        password: u.password || '', 
                        phone_number: u.phone_number || '', 
                        secondaryRoles: u.secondaryRoles || [],
                        classTeacherOf: u.classTeacherOf || '', 
                        expertise: u.expertise || [], 
                        isResigned: !!u.isResigned 
                      }); 
                      setIsFormVisible(true); 
                    }} className="text-slate-300 hover:text-sky-500 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
                 </div>

                 <div>
                    <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter line-clamp-1">{u.name}</h4>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{u.role.replace(/_/g, ' ')}</p>
                    {u.secondaryRoles && u.secondaryRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {u.secondaryRoles.map(r => (
                          <span key={r} className="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[6px] font-black uppercase rounded border border-amber-100 dark:border-amber-800">
                            {r.split('_')[0]}
                          </span>
                        ))}
                      </div>
                    )}
                 </div>

                 <div className="space-y-5 pt-2 border-t border-slate-50 dark:border-slate-800">
                    <div className="space-y-1.5">
                       <div className="flex justify-between items-baseline"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Base Load</span><span className={`text-[10px] font-black italic ${m.isBaseOverloaded ? 'text-rose-500' : 'text-emerald-600'}`}>{m.currentBase} / {m.baseTarget} P</span></div>
                       <div className="h-1 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden"><div style={{ width: `${Math.min(100, (m.currentBase / m.baseTarget) * 100)}%` }} className={`h-full ${baseColor}`}></div></div>
                    </div>
                    <div className="space-y-1.5">
                       <div className="flex justify-between items-baseline"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Proxy Usage</span><span className={`text-[10px] font-black italic ${m.isProxyOverloaded ? 'text-rose-500' : 'text-sky-600'}`}>{m.proxyCount} / {m.proxyCap} P</span></div>
                       <div className="h-1 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden"><div style={{ width: `${Math.min(100, (m.proxyCount / m.proxyCap) * 100)}%` }} className={`h-full ${proxyColor}`}></div></div>
                    </div>
                 </div>
              </div>
            );
         })}
      </div>
    </div>
  );
};

export default UserManagement;

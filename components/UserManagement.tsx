
import React, { useState, useMemo } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment, SubjectCategory } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

const MAX_PERIODS = 35;

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

const UserManagement: React.FC<UserManagementProps> = ({ 
  users, setUsers, config, currentUser, timetable, assignments, showToast 
}) => {
  const [formData, setFormData] = useState({ 
    name: '', email: '', employeeId: '', password: '', phone_number: '', 
    role: UserRole.TEACHER_PRIMARY, secondaryRoles: [] as UserRole[], 
    classTeacherOf: '', expertise: [] as string[], isResigned: false 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [expertiseFilter, setExpertiseFilter] = useState<string>('ALL');
  const [isFormVisible, setIsFormVisible] = useState(false);

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isCloudActive = IS_CLOUD_ENABLED;

  // METRICS: Institutional Onboarding Health
  const healthStats = useMemo(() => {
    const total = users.filter(u => !u.isResigned).length;
    if (total === 0) return { bio: 0, telegram: 0, identity: 0 };
    
    const bioCount = users.filter(u => !u.isResigned && localStorage.getItem(`ihis_biometric_active_${u.id}`) === 'true').length;
    const telegramCount = users.filter(u => !u.isResigned && !!u.telegram_chat_id).length;
    const identityCount = users.filter(u => !u.isResigned && !!u.email && !!u.password).length;

    return {
      bio: Math.round((bioCount / total) * 100),
      telegram: Math.round((telegramCount / total) * 100),
      identity: Math.round((identityCount / total) * 100)
    };
  }, [users]);

  // All expertise tags available in the system
  const allExpertiseTags = useMemo(() => {
    const tags = new Set<string>();
    users.forEach(u => (u.expertise || []).forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [users]);

  const filteredStaff = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      
      const matchesSearch = !search || 
        u.name.toLowerCase().includes(search.toLowerCase()) || 
        u.employeeId.toLowerCase().includes(search.toLowerCase());
        
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesExpertise = expertiseFilter === 'ALL' || (u.expertise || []).includes(expertiseFilter);

      return matchesSearch && matchesRole && matchesExpertise;
    }).sort((a, b) => {
      // Sort resigned to the bottom
      if (a.isResigned && !b.isResigned) return 1;
      if (!a.isResigned && b.isResigned) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [users, search, roleFilter, expertiseFilter, isAdmin]);

  const getTeacherLoad = (teacherId: string) => {
    const asgns = assignments.filter(a => a.teacherId === teacherId);
    const base = asgns.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0);
    const group = asgns.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
    return base + group;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name, email: formData.email, employee_id: formData.employeeId, 
        password: formData.password, phone_number: formData.phone_number || null, 
        role: formData.role, secondary_roles: formData.secondaryRoles,
        class_teacher_of: formData.classTeacherOf || null,
        expertise: formData.expertise, is_resigned: formData.isResigned
      };

      if (editingId) {
        if (isCloudActive) await supabase.from('profiles').update(payload).eq('id', editingId);
        setUsers(users.map(u => u.id === editingId ? { ...u, ...formData, id: editingId } : u));
        setEditingId(null);
        showToast('Personnel Record Updated.', 'success');
      } else {
        const id = generateUUID();
        if (isCloudActive) await supabase.from('profiles').insert({ id, ...payload });
        setUsers([{ id, ...formData }, ...users]);
        showToast('Faculty Authorized & Enrolled.', 'success');
      }
      setFormData({ 
        name: '', email: '', employeeId: '', password: '', phone_number: '', 
        role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '', 
        expertise: [], isResigned: false 
      });
      setIsFormVisible(false);
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const getSectionLabel = (id: string) => config.sections.find(s => s.id === id)?.fullName || 'N/A';

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-32">
      {/* 1. HEALTH DASHBOARD */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {[
           { label: 'Biometric Readiness', value: healthStats.bio, color: 'text-emerald-500', bg: 'bg-emerald-50' },
           { label: 'Telegram Linkage', value: healthStats.telegram, color: 'text-sky-500', bg: 'bg-sky-50' },
           { label: 'Identity Sync', value: healthStats.identity, color: 'text-amber-500', bg: 'bg-amber-50' }
         ].map((stat, i) => (
           <div key={i} className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-amber-400 transition-all">
              <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                 <p className={`text-3xl font-black italic tracking-tighter ${stat.color}`}>{stat.value}%</p>
              </div>
              <div className={`w-12 h-12 rounded-2xl ${stat.bg} dark:bg-slate-800 flex items-center justify-center`}>
                 <div className={`w-2 h-2 rounded-full animate-ping ${stat.color.replace('text', 'bg')}`}></div>
              </div>
           </div>
         ))}
      </div>

      {/* 2. ACTIONS & FILTERS */}
      <div className="flex flex-col xl:flex-row gap-6 items-center justify-between px-2">
         <div className="flex flex-wrap gap-3 w-full xl:w-auto">
            <div className="relative flex-1 min-w-[280px]">
               <input 
                  type="text" 
                  placeholder="Search Personnel..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl text-xs font-bold outline-none focus:border-amber-400 transition-all shadow-sm dark:text-white"
               />
               <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>
            <select className="px-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none shadow-sm dark:text-white" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
               <option value="ALL">All Roles</option>
               {Object.values(UserRole).map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <select className="px-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none shadow-sm dark:text-white" value={expertiseFilter} onChange={e => setExpertiseFilter(e.target.value)}>
               <option value="ALL">All Expertise</option>
               {allExpertiseTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
         </div>
         <button onClick={() => setIsFormVisible(!isFormVisible)} className="w-full xl:w-auto bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all flex items-center justify-center gap-3">
            {isFormVisible ? 'Discard Form' : '+ Enroll Personnel'}
         </button>
      </div>

      {/* 3. REGISTRATION FORM */}
      {isFormVisible && (
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[3rem] shadow-2xl border-2 border-[#d4af37]/20 animate-in zoom-in duration-300">
          <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter mb-8">Personnel Authorization Protocol</h3>
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                 <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                 <input placeholder="e.g. John Doe" required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                 <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID</label>
                 <input placeholder="emp001" required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
              </div>
              <div className="space-y-2">
                 <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Role</label>
                 <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                   {Object.values(UserRole).map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                 </select>
              </div>
              <div className="space-y-2">
                 <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher (Anchor)</label>
                 <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white border-2 border-transparent focus:border-amber-400" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                   <option value="">No Anchor Assignment</option>
                   {config.sections.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                 </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Access Credential</label>
                  <input placeholder="Password" required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
               </div>
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registry Email</label>
                  <input placeholder="email@ihis.com" required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
               </div>
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Expertise (Comma separated)</label>
                  <input placeholder="Physics, Math" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={formData.expertise.join(', ')} onChange={e => setFormData({...formData, expertise: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} />
               </div>
            </div>
            <div className="flex items-center gap-3">
               <input type="checkbox" id="resigned" checked={formData.isResigned} onChange={e => setFormData({...formData, isResigned: e.target.checked})} className="w-5 h-5 accent-rose-500" />
               <label htmlFor="resigned" className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mark as Resigned (Preserve History)</label>
            </div>
            <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all border-2 border-white/5">Authorize Personnel Protocol</button>
          </form>
        </div>
      )}

      {/* 4. DOSSIER GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
         {filteredStaff.map(u => {
            const load = getTeacherLoad(u.id);
            const bioActive = localStorage.getItem(`ihis_biometric_active_${u.id}`) === 'true';
            const loadColor = load > 30 ? 'text-rose-500' : load > 25 ? 'text-amber-500' : 'text-emerald-500';
            const loadBg = load > 30 ? 'bg-rose-500' : load > 25 ? 'bg-amber-500' : 'bg-emerald-500';
            const isAnchor = !!u.classTeacherOf;

            return (
              <div key={u.id} className={`group bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border-2 transition-all relative overflow-hidden flex flex-col ${u.isResigned ? 'opacity-40 grayscale' : 'hover:scale-105 hover:shadow-2xl'} ${isAnchor ? 'border-amber-400/40 shadow-amber-400/10' : 'border-slate-50 dark:border-slate-800'}`}>
                 {/* Dossier Header */}
                 <div className="p-8 pb-4 flex justify-between items-start">
                    <div className="w-14 h-14 bg-[#001f3f] text-[#d4af37] rounded-2xl flex items-center justify-center font-black text-xl shadow-lg border-2 border-amber-400/10 shrink-0">
                       {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex gap-2">
                       {isAnchor && (
                         <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-[#001f3f] shadow-lg animate-pulse" title="Class Teacher Anchor">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V5z" clipRule="evenodd"/></svg>
                         </div>
                       )}
                       <button onClick={() => { setEditingId(u.id); setFormData({ ...u, password: u.password || '', phone_number: u.phone_number || '', classTeacherOf: u.classTeacherOf || '', expertise: u.expertise || [], isResigned: !!u.isResigned }); setIsFormVisible(true); }} className="w-8 h-8 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-sky-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                       </button>
                    </div>
                 </div>

                 {/* Personnel Info */}
                 <div className="px-8 pb-6 flex-1">
                    <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter line-clamp-1">{u.name}</h4>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{u.employeeId} • {u.role.replace(/_/g, ' ')}</p>
                    
                    {isAnchor && (
                      <div className="mt-3 px-3 py-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl inline-flex items-center gap-2">
                         <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Anchor: {getSectionLabel(u.classTeacherOf!)}</span>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-1.5">
                       {(u.expertise || []).map(tag => (
                         <span key={tag} className="px-2 py-0.5 bg-slate-50 dark:bg-slate-800 text-slate-500 text-[7px] font-black uppercase rounded-md border border-slate-100 dark:border-slate-700">{tag}</span>
                       ))}
                       {!(u.expertise || []).length && <span className="text-[8px] font-bold text-slate-300 italic uppercase">No Expertise Defined</span>}
                    </div>
                 </div>

                 {/* Load & Status Matrix */}
                 <div className="px-8 pb-8 space-y-4">
                    <div className="flex items-center justify-between">
                       <div className="space-y-1">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Weekly Load</p>
                          <div className="flex items-baseline gap-1">
                             <span className={`text-xl font-black italic ${loadColor}`}>{load}</span>
                             <span className="text-[10px] font-bold text-slate-300 uppercase">/ {MAX_PERIODS} P</span>
                          </div>
                       </div>
                       <div className="flex gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bioActive ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-50 text-slate-200'}`} title="Biometrics">
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1"/></svg>
                          </div>
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${u.telegram_chat_id ? 'bg-sky-50 text-sky-500' : 'bg-slate-50 text-slate-200'}`} title="Telegram">
                             <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59"/></svg>
                          </div>
                       </div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden">
                       <div style={{ width: `${Math.min(100, (load / MAX_PERIODS) * 100)}%` }} className={`h-full transition-all duration-1000 ${loadBg}`}></div>
                    </div>
                 </div>
                 
                 {/* Resigned Label */}
                 {u.isResigned && (
                   <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 pointer-events-none">
                      <div className="px-10 py-4 border-8 border-rose-500 rounded-2xl">
                         <span className="text-4xl font-black text-rose-500 uppercase opacity-40">RESIGNED</span>
                      </div>
                   </div>
                 )}
              </div>
            );
         })}
      </div>

      {filteredStaff.length === 0 && (
         <div className="py-40 text-center">
            <div className="opacity-20 flex flex-col items-center gap-6">
               <svg className="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
               <p className="text-sm font-black uppercase tracking-[0.5em]">Personnel Matrix Synchronized but No Results Matching Criteria</p>
            </div>
         </div>
      )}
    </div>
  );
};

export default UserManagement;

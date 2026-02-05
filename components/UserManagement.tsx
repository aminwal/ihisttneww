
import React, { useState, useMemo } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment, SubjectCategory, SchoolNotification, RoleLoadPolicy, FeaturePower, InstitutionalResponsibility, ResponsibilityBadge, ResponsibilityScope } from '../types.ts';
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

const FEATURE_POWERS_METADATA: { id: FeaturePower; label: string; description: string }[] = [
  { id: 'can_edit_attendance', label: 'Modify Records', description: 'Manually edit or add attendance entries for others' },
  { id: 'can_assign_proxies', label: 'Authorize Proxies', description: 'Deploy and dismantle substitute assignments' },
  { id: 'can_edit_timetable_live', label: 'Matrix Overwrites', description: 'Dismantle or swap Live Matrix entries' },
  { id: 'can_use_ai_architect', label: 'AI Architect Core', description: 'Unlimited access to Lesson/Exam AI engines' },
  { id: 'can_export_sensitive_reports', label: 'Data Exporter', description: 'Access to high-fidelity PDF and Excel audit data' },
  { id: 'can_export_sensitive_reports', label: 'Data Exporter', description: 'Access to high-fidelity PDF and Excel audit data' },
  { id: 'can_manage_personnel', label: 'Identity Admin', description: 'Enroll staff or update security access keys' },
  { id: 'can_override_geolocation', label: 'GPS Bypass', description: 'Mark attendance without location boundary check' }
];

const UserManagement: React.FC<UserManagementProps> = ({ 
  users, setUsers, config, currentUser, timetable, setTimetable, assignments, setAssignments, showToast, setNotifications, isSandbox, addSandboxLog
}) => {
  const [formData, setFormData] = useState({ 
    name: '', email: '', employeeId: '', password: '', phone_number: '', 
    role: UserRole.TEACHER_PRIMARY as string, secondaryRoles: [] as string[], 
    featureOverrides: [] as string[],
    responsibilities: [] as InstitutionalResponsibility[],
    expertise: [] as string[], isResigned: false, classTeacherOf: undefined as string | undefined
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [linkedOnly, setLinkedOnly] = useState(false);

  // Responsibility Builder state
  const [newResp, setNewResp] = useState<Partial<InstitutionalResponsibility>>({
    badge: 'HOD',
    target: '',
    scope: 'PRIMARY'
  });

  // CUSTOM SIGNAL STATE
  const [isSignalModalOpen, setIsSignalModalOpen] = useState(false);
  const [signalTarget, setSignalTarget] = useState<User | null>(null);
  const [customSignalMsg, setCustomSignalMsg] = useState('');
  const [isSendingSignal, setIsSendingSignal] = useState(false);

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const availableRoles = useMemo(() => Array.from(new Set([...Object.values(UserRole), ...(config.customRoles || [])])), [config.customRoles]);

  const getTeacherLoadMetrics = (teacherId: string, role: string) => {
    const policy = config.loadPolicies?.[role] || { baseTarget: 28, substitutionCap: 5 };
    
    const individualScheduledCount = timetable.filter(t => 
      t.teacherId === teacherId && 
      !t.isSubstitution && 
      !t.date && 
      !t.blockId
    ).length;

    const poolCommitmentCount = (config.combinedBlocks || [])
      .filter(b => b.allocations.some(a => a.teacherId === teacherId))
      .reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);

    const extraCurricularCount = (config.extraCurricularRules || [])
      .filter(r => r.teacherId === teacherId)
      .reduce((sum, r) => sum + (r.sectionIds.length * r.periodsPerWeek), 0);

    const totalCommittedLoad = individualScheduledCount + poolCommitmentCount + extraCurricularCount;
    const proxyCount = timetable.filter(t => t.teacherId === teacherId && t.isSubstitution).length;

    return {
      currentBase: totalCommittedLoad,
      baseTarget: policy.baseTarget,
      proxyCount: proxyCount,
      proxyCap: policy.substitutionCap,
      isBaseOverloaded: totalCommittedLoad > policy.baseTarget,
      isProxyOverloaded: proxyCount > policy.substitutionCap
    };
  };

  const handleMatrixPing = async (user: User) => {
    if (!user.telegram_chat_id || !config.telegramBotToken) {
      showToast("Telegram configuration missing for this user.", "warning");
      return;
    }
    try {
      if (isSandbox) {
        addSandboxLog?.('MATRIX_PING_TEST', { userId: user.id, userName: user.name });
        showToast(`Simulation: Matrix Ping sent to ${user.name}`, "info");
        return;
      }
      const ok = await TelegramService.sendTestSignal(config.telegramBotToken, user.telegram_chat_id, user.name);
      if (ok) showToast(`Institutional Ping dispatched to ${user.name}`, "success");
      else showToast("Failed to dispatch signal. Bot might be blocked.", "error");
    } catch (err) {
      showToast("Signal Dispatch Error", "error");
    }
  };

  const handleSendCustomSignal = async () => {
    if (!signalTarget?.telegram_chat_id || !config.telegramBotToken || !customSignalMsg.trim()) return;
    
    setIsSendingSignal(true);
    try {
      if (isSandbox) {
        addSandboxLog?.('PRIVATE_SIGNAL_TEST', { userId: signalTarget.id, message: customSignalMsg });
        showToast(`Simulation: Private Signal dispatched to ${signalTarget.name}`, "info");
      } else {
        const ok = await TelegramService.sendCustomSignal(config.telegramBotToken, signalTarget.telegram_chat_id, customSignalMsg);
        if (ok) showToast(`Private Signal successfully linked to ${signalTarget.name}`, "success");
        else showToast("Matrix provider failed to deliver signal.", "error");
      }
      setIsSignalModalOpen(false);
      setCustomSignalMsg('');
      setSignalTarget(null);
    } catch (err) {
      showToast("Signal Dispatch Failure", "error");
    } finally {
      setIsSendingSignal(false);
    }
  };

  const filteredStaff = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      const matchesSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.employeeId.toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesLink = !linkedOnly || !!u.telegram_chat_id;
      return matchesSearch && matchesRole && matchesLink;
    }).sort((a, b) => {
      if (a.isResigned && !b.isResigned) return 1;
      if (!a.isResigned && b.isResigned) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [users, search, roleFilter, isAdmin, linkedOnly]);

  const toggleSecondaryRole = (role: string) => {
    setFormData(prev => ({
      ...prev,
      secondaryRoles: prev.secondaryRoles.includes(role) 
        ? prev.secondaryRoles.filter(r => r !== role) 
        : [...prev.secondaryRoles, role]
    }));
  };

  const toggleFeatureOverride = (power: string) => {
    setFormData(prev => ({
      ...prev,
      featureOverrides: prev.featureOverrides.includes(power)
        ? prev.featureOverrides.filter(p => p !== power)
        : [...prev.featureOverrides, power]
    }));
  };

  const addResponsibility = () => {
    if (!newResp.target) {
        showToast("Responsibility Target (Subject or ASSESSMENT) is required.", "warning");
        return;
    }
    const id = generateUUID();
    const resp: InstitutionalResponsibility = {
      id,
      badge: newResp.badge as ResponsibilityBadge,
      target: newResp.target,
      scope: newResp.scope as ResponsibilityScope
    };
    setFormData(prev => ({ ...prev, responsibilities: [...prev.responsibilities, resp] }));
    setNewResp({ badge: 'HOD', target: '', scope: 'PRIMARY' });
  };

  const removeResponsibility = (id: string) => {
    setFormData(prev => ({ ...prev, responsibilities: prev.responsibilities.filter(r => r.id !== id) }));
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
        feature_overrides: formData.featureOverrides,
        responsibilities: formData.responsibilities,
        phone_number: formData.phone_number,
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

        setUsers([{ id, ...formData, classTeacherOf: undefined }, ...users]);
      }
      
      setFormData({ 
        name: '', email: '', employeeId: '', password: '', phone_number: '', 
        role: UserRole.TEACHER_PRIMARY as string, secondaryRoles: [] as string[], 
        featureOverrides: [] as string[],
        responsibilities: [],
        expertise: [] as string[], isResigned: false, classTeacherOf: undefined
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
        <div className="flex flex-wrap flex-1 gap-3 max-w-4xl">
           <div className="relative flex-1 min-w-[200px]">
              <input type="text" placeholder="Search Faculty..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 rounded-2xl font-bold text-xs outline-none dark:text-white shadow-sm focus:border-amber-400 transition-all" />
           </div>
           <select className="px-4 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase outline-none dark:text-white shadow-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
             <option value="ALL">All Departments</option>
             {availableRoles.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
           </select>
           <button 
              onClick={() => setLinkedOnly(!linkedOnly)}
              className={`px-4 py-4 border-2 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${linkedOnly ? 'bg-[#0088cc] border-transparent text-white shadow-lg' : 'bg-white dark:bg-slate-900 border-slate-100 text-slate-400'}`}
           >
              <svg className={`w-4 h-4 ${linkedOnly ? 'text-white' : 'text-slate-300'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
              {linkedOnly ? 'Matrix Linked Only' : 'Show Linked Only'}
           </button>
        </div>
        <button onClick={() => { setIsFormVisible(!isFormVisible); setEditingId(null); }} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">{isFormVisible ? 'Discard Form' : '+ Enroll Staff'}</button>
      </div>

      {isFormVisible && (
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-[3rem] shadow-2xl border-2 border-[#d4af37]/20 animate-in zoom-in duration-300 overflow-y-auto max-h-[85vh] scrollbar-hide">
          <form onSubmit={handleSubmit} className="space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
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
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Department (Role)</label>
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-[#d4af37]" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                  {availableRoles.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp Liaison</label>
                <input placeholder="973..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none border-2 border-transparent focus:border-[#d4af37]" value={formData.phone_number} onChange={e => setFormData({...formData, phone_number: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Employment Status</label>
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-[#d4af37]" value={formData.isResigned ? 'true' : 'false'} onChange={e => setFormData({...formData, isResigned: e.target.value === 'true'})}>
                  <option value="false">Active Service</option>
                  <option value="true">Resigned/Terminated</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
               <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em]">Authority Matrix (Responsibilities)</p>
                  </div>
                  <div className="p-6 bg-slate-50 dark:bg-slate-950/50 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <select className="p-3 bg-white dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase" value={newResp.badge} onChange={e => {
                            const badge = e.target.value as ResponsibilityBadge;
                            setNewResp({...newResp, badge, target: badge === 'EXAM_COORDINATOR' ? 'ASSESSMENT' : ''});
                        }}>
                            <option value="HOD">HOD (Pedagogical)</option>
                            <option value="EXAM_COORDINATOR">Exam Coordinator (Security)</option>
                        </select>
                        <div className="relative">
                            {newResp.badge === 'HOD' ? (
                              <select 
                                className="w-full p-3 bg-white dark:bg-slate-800 rounded-xl text-[9px] font-bold uppercase outline-none"
                                value={newResp.target}
                                onChange={e => setNewResp({...newResp, target: e.target.value})}
                              >
                                <option value="">Select Subject...</option>
                                {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                              </select>
                            ) : (
                              <input 
                                  readOnly
                                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 rounded-xl text-[9px] font-black uppercase opacity-50 cursor-not-allowed" 
                                  value="ASSESSMENT" 
                              />
                            )}
                        </div>
                        <select className="p-3 bg-white dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase" value={newResp.scope} onChange={e => setNewResp({...newResp, scope: e.target.value as ResponsibilityScope})}>
                            <option value="GLOBAL">Global (Overall)</option>
                            <option value="PRIMARY">Primary Wing</option>
                            <option value="SECONDARY">Secondary Wing</option>
                            <option value="SENIOR_SECONDARY">Senior Secondary</option>
                        </select>
                    </div>
                    <button type="button" onClick={addResponsibility} className="w-full py-3 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase">+ Authorize Responsibility Badge</button>
                    
                    <div className="flex flex-wrap gap-2 pt-2">
                        {formData.responsibilities.map(r => (
                            <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-amber-200 rounded-xl shadow-sm">
                                <span className={`text-[8px] font-black uppercase ${r.badge === 'EXAM_COORDINATOR' ? 'text-rose-500' : 'text-amber-600'}`}>
                                    {r.badge}: {r.target} ({r.scope})
                                </span>
                                <button type="button" onClick={() => removeResponsibility(r.id)} className="text-rose-400 hover:text-rose-600 font-black">×</button>
                            </div>
                        ))}
                    </div>
                  </div>

                  <div className="space-y-4 pt-4">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em]">Secondary Roles (Multi-Wing Teaching)</p>
                    <p className="text-[8px] font-medium text-slate-400 uppercase italic">Select additional roles for teachers operating across multiple wings.</p>
                    <div className="flex flex-wrap gap-2 p-6 bg-slate-50 dark:bg-slate-950/50 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
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
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-sky-500 uppercase tracking-[0.3em]">Special Capabilities (Individual Overrides)</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-6 bg-slate-50 dark:bg-slate-950/50 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                    {FEATURE_POWERS_METADATA.map(power => (
                      <button
                        key={power.id}
                        type="button"
                        onClick={() => toggleFeatureOverride(power.id)}
                        className={`p-3 rounded-xl text-[8px] font-black uppercase tracking-tighter transition-all flex flex-col items-center text-center gap-1.5 ${
                          formData.featureOverrides.includes(power.id)
                            ? 'bg-[#001f3f] text-sky-400 shadow-xl ring-2 ring-sky-500/50'
                            : 'bg-white dark:bg-slate-800 text-slate-400'
                        }`}
                        title={power.description}
                      >
                        <span>{power.label}</span>
                        {formData.featureOverrides.includes(power.id) && <div className="w-1 h-1 rounded-full bg-sky-400 animate-pulse"></div>}
                      </button>
                    ))}
                  </div>
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
            const classObj = u.classTeacherOf ? config.sections.find(s => s.id === u.classTeacherOf) : null;

            return (
              <div key={u.id} className={`group bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border-2 transition-all p-8 flex flex-col space-y-6 ${u.isResigned ? 'opacity-40 grayscale' : 'hover:scale-105'} border-slate-50 dark:border-slate-800 shadow-sm`}>
                 <div className="flex justify-between items-start">
                    <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-lg shadow-lg">{u.name.substring(0, 2).toUpperCase()}</div>
                    <div className="flex gap-2">
                       <button onClick={() => { 
                        setEditingId(u.id); 
                        // COMMENT: Ensure classTeacherOf is explicitly provided in setFormData to satisfy TypeScript requirements
                        setFormData({ 
                           ...u, 
                           classTeacherOf: u.classTeacherOf || undefined,
                           password: u.password || '', 
                           phone_number: u.phone_number || '', 
                           secondaryRoles: u.secondaryRoles || [],
                           featureOverrides: u.featureOverrides || [],
                           responsibilities: u.responsibilities || [],
                           expertise: u.expertise || [], 
                           isResigned: !!u.isResigned 
                        }); 
                        setIsFormVisible(true); 
                       }} className="text-slate-300 hover:text-sky-500 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
                    </div>
                 </div>

                 <div>
                    <div className="flex items-center gap-2">
                       <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter line-clamp-1">{u.name}</h4>
                       {u.telegram_chat_id ? (
                          <div className="flex items-center gap-1.5">
                             <button 
                                onClick={(e) => { e.stopPropagation(); handleMatrixPing(u); }}
                                title="Matrix Link Active: Click to dispatch Test Ping"
                                className="w-5 h-5 flex items-center justify-center text-[#0088cc] hover:scale-125 transition-transform animate-pulse-subtle"
                             >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                             </button>
                             <button 
                                onClick={(e) => { e.stopPropagation(); setSignalTarget(u); setIsSignalModalOpen(true); }}
                                title="Compose Private Signal"
                                className="w-5 h-5 flex items-center justify-center text-emerald-500 hover:scale-125 transition-transform"
                             >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                             </button>
                          </div>
                       ) : (
                          <div 
                             title="Matrix Inactive: Account not linked"
                             className="w-5 h-5 flex items-center justify-center text-slate-200 dark:text-slate-700"
                          >
                             <svg className="w-4 h-4 opacity-40" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
                          </div>
                       )}
                    </div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{u.role.replace(/_/g, ' ')}</p>
                    <div className="flex flex-wrap gap-1 mt-3">
                       {u.secondaryRoles?.map(r => (
                          <span key={r} className="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[6px] font-black uppercase rounded border border-amber-100 dark:border-amber-800">
                            {String(r).split('_')[0]}
                          </span>
                       ))}
                       {u.responsibilities?.map(r => (
                          <span key={r.id} className={`px-2 py-0.5 ${r.badge === 'EXAM_COORDINATOR' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-amber-50 text-amber-600 border-amber-100'} text-[6px] font-black uppercase rounded border`}>
                             👑 {r.badge === 'HOD' ? `${r.target} HOD` : 'COORD'} ({r.scope.split('_')[0]})
                          </span>
                       ))}
                    </div>
                 </div>

                 <div className="space-y-5 pt-2 border-t border-slate-50 dark:border-slate-800">
                    <div className="space-y-1.5">
                       <div className="flex justify-between items-baseline"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Committed Load</span><span className={`text-[10px] font-black italic ${m.isBaseOverloaded ? 'text-rose-500' : 'text-emerald-600'}`}>{m.currentBase} / {m.baseTarget} P</span></div>
                       <div className="h-1.5 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner"><div style={{ width: `${Math.min(100, (m.currentBase / m.baseTarget) * 100)}%` }} className={`h-full ${baseColor} transition-all duration-700`}></div></div>
                    </div>
                    <div className="space-y-1.5">
                       <div className="flex justify-between items-baseline"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Proxy Usage</span><span className={`text-[10px] font-black italic ${m.isProxyOverloaded ? 'text-rose-500' : 'text-sky-600'}`}>{m.proxyCount} / {m.proxyCap} P</span></div>
                       <div className="h-1.5 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner"><div style={{ width: `${Math.min(100, (m.proxyCount / m.proxyCap) * 100)}%` }} className={`h-full ${proxyColor} transition-all duration-700`}></div></div>
                    </div>
                 </div>

                 <div className="pt-4 border-t border-slate-50 dark:border-slate-800 space-y-2">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Registry Status</p>
                    {u.classTeacherOf ? (
                      <div className="flex items-center gap-3 p-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900 rounded-2xl group/status">
                         <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></div>
                         <p className="text-[10px] font-black text-sky-700 dark:text-sky-400 uppercase">Class Teacher: <span className="italic">{classObj?.fullName || 'Matrix Link Active'}</span></p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm">
                         <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                         <p className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Instructional Only</p>
                      </div>
                    )}
                 </div>
              </div>
            );
         })}
      </div>

      {isSignalModalOpen && signalTarget && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
              <div className="text-center">
                 <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Compose Signal</h4>
                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 leading-relaxed">Direct Secure Line to <span className="text-emerald-500">{signalTarget.name}</span></p>
              </div>

              <div className="space-y-4">
                 <div className="flex justify-between px-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Message Payload</label><span className={`text-[8px] font-bold ${customSignalMsg.length > 300 ? 'text-rose-500' : 'text-slate-300'}`}>{customSignalMsg.length} / 400</span></div>
                 <textarea 
                    value={customSignalMsg}
                    onChange={e => setCustomSignalMsg(e.target.value.substring(0, 400))}
                    placeholder="Type urgent institutional notice..."
                    className="w-full h-40 p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl font-bold text-sm dark:text-white outline-none border-4 border-transparent focus:border-emerald-400 transition-all resize-none shadow-inner"
                 />
                 <p className="text-[8px] font-medium text-slate-400 italic px-2">Matrix signals are dispatched via the institutional Telegram gateway.</p>
              </div>

              <div className="pt-4 space-y-4">
                 <button 
                    onClick={handleSendCustomSignal}
                    disabled={isSendingSignal || !customSignalMsg.trim()}
                    className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                 >
                    {isSendingSignal ? (
                       <>
                          <div className="w-4 h-4 border-4 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
                          <span>Dispatching...</span>
                       </>
                    ) : 'Transmit Private Signal'}
                 </button>
                 <button 
                    onClick={() => { setIsSignalModalOpen(false); setCustomSignalMsg(''); setSignalTarget(null); }}
                    className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-rose-500 transition-colors"
                 >
                    Abort Transmission
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
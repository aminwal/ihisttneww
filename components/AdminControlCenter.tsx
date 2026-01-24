
import React, { useState, useMemo } from 'react';
import { User, UserRole, SchoolConfig, AppTab, PermissionsConfig, RoleLoadPolicy } from '../types.ts';
import { DEFAULT_PERMISSIONS, DEFAULT_LOAD_POLICIES } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface AdminControlCenterProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (msg: string, type?: any) => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const TABS_METADATA: { id: AppTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Attendance Hub', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'timetable', label: 'Matrix Control', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'batch_timetable', label: 'Batch Dispatcher', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { id: 'substitutions', label: 'Proxy Matrix', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2z' },
  { id: 'history', label: 'Faculty Ledger', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'reports', label: 'Analytics Hub', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2' },
  { id: 'assignments', label: 'Load Intelligence', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { id: 'groups', label: 'Subject Pools', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'otp', label: 'Registry Key', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'users', label: 'Faculty Roster', icon: 'M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'handbook', label: 'Ops Handbook', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { id: 'profile', label: 'Profile Hub', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { id: 'deployment', label: 'Infrastructure', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'config', label: 'Global Setup', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { id: 'control_center', label: 'Control Center', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' }
];

const AdminControlCenter: React.FC<AdminControlCenterProps> = ({ config, setConfig, showToast, isSandbox, addSandboxLog }) => {
  const [permissions, setPermissions] = useState<PermissionsConfig>(config.permissions || DEFAULT_PERMISSIONS);
  const [loadPolicies, setLoadPolicies] = useState<Record<string, RoleLoadPolicy>>(config.loadPolicies || DEFAULT_LOAD_POLICIES);
  const [newRoleName, setNewRoleName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const allRoles = useMemo(() => {
    const systemRoles = Object.values(UserRole);
    const customRoles = config.customRoles || [];
    return Array.from(new Set([...systemRoles, ...customRoles]));
  }, [config.customRoles]);

  const togglePermission = (role: string, tab: AppTab) => {
    if (role === UserRole.ADMIN && tab === 'control_center') return;
    setPermissions(prev => {
      const currentTabs = prev[role] || [];
      const updatedTabs = currentTabs.includes(tab) ? currentTabs.filter(t => t !== tab) : [...currentTabs, tab];
      return { ...prev, [role]: updatedTabs };
    });
  };

  const handleUpdatePolicy = (role: string, field: keyof RoleLoadPolicy, value: number) => {
    setLoadPolicies(prev => ({
      ...prev,
      [role]: {
        ...(prev[role] || { baseTarget: 28, substitutionCap: 5 }),
        [field]: value
      }
    }));
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim().toUpperCase().replace(/\s+/g, '_');
    if (!name || allRoles.includes(name)) {
      showToast("Role Identifier invalid or already exists.", "warning");
      return;
    }

    const updatedCustomRoles = [...(config.customRoles || []), name];
    const updatedPermissions = { ...permissions, [name]: ['dashboard', 'profile'] };
    const updatedPolicies = { ...loadPolicies, [name]: { baseTarget: 28, substitutionCap: 5 } };
    
    setIsProcessing(true);
    try {
      const updatedConfig = { ...config, customRoles: updatedCustomRoles, permissions: updatedPermissions, loadPolicies: updatedPolicies };
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      } else if (isSandbox) {
        addSandboxLog?.('ROLE_AUTHORIZATION', { name, updatedConfig });
      }
      setConfig(updatedConfig);
      setPermissions(updatedPermissions);
      setLoadPolicies(updatedPolicies);
      setNewRoleName('');
      showToast(`Role "${name}" successfully authorized.`, "success");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
  };

  const handleDismantleRole = async (roleName: string) => {
    if (Object.values(UserRole).includes(roleName as UserRole)) {
      showToast("System-Critical Roles cannot be dismantled.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to dismantle the role "${roleName}"?`)) return;

    const updatedCustomRoles = (config.customRoles || []).filter(r => r !== roleName);
    const updatedPermissions = { ...permissions };
    delete updatedPermissions[roleName];
    const updatedPolicies = { ...loadPolicies };
    delete updatedPolicies[roleName];

    setIsProcessing(true);
    try {
      const updatedConfig = { ...config, customRoles: updatedCustomRoles, permissions: updatedPermissions, loadPolicies: updatedPolicies };
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig });
      } else if (isSandbox) {
        addSandboxLog?.('ROLE_DISMANTLE', { roleName, updatedConfig });
      }
      setConfig(updatedConfig);
      setPermissions(updatedPermissions);
      setLoadPolicies(updatedPolicies);
      showToast(`Role "${roleName}" dismantled.`, "info");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
  };

  const handleApplyMatrix = async () => {
    setIsProcessing(true);
    const updatedConfig = { ...config, permissions, loadPolicies };
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      } else if (isSandbox) {
        addSandboxLog?.('POLICY_MATRIX_SYNC', { updatedConfig });
      }
      setConfig(updatedConfig);
      showToast("Matrix & Load Policies Synchronized Globally", "success");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Global <span className="text-[#d4af37]">Policies</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Access & Load Matrix</p>
        </div>
        <button onClick={handleApplyMatrix} disabled={isProcessing} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">
           {isProcessing ? 'Syncing...' : 'Apply Global Matrix'}
        </button>
      </div>

      <div className="bg-[#001f3f] rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden group">
         <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1 space-y-2 text-center md:text-left">
               <h3 className="text-xl font-black text-amber-400 uppercase italic tracking-widest">Faculty Role Factory</h3>
               <p className="text-[10px] font-medium text-white/50 uppercase tracking-[0.3em]">Define new institutional access and policy levels</p>
            </div>
            <div className="flex flex-1 w-full gap-3 bg-white/5 p-3 rounded-[2rem] border border-white/10 backdrop-blur-sm">
               <input type="text" placeholder="ROLE IDENTIFIER" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} className="flex-1 bg-transparent px-6 py-4 text-white font-black text-xs uppercase outline-none placeholder:text-white/20" />
               <button onClick={handleCreateRole} disabled={!newRoleName.trim() || isProcessing} className="bg-[#d4af37] text-[#001f3f] px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all">Authorize</button>
            </div>
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
         <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-left border-collapse min-w-[1200px]">
               <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                     <th className="px-8 py-6 sticky left-0 bg-slate-50/90 dark:bg-slate-800/90 backdrop-blur-md z-20 w-64 border-r border-slate-100 dark:border-slate-800">
                        <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">Institutional Role</p>
                     </th>
                     <th className="px-6 py-6 text-center bg-amber-50/30 dark:bg-amber-900/20 border-r border-amber-100">
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Base Target (P)</p>
                     </th>
                     <th className="px-6 py-6 text-center bg-sky-50/30 dark:bg-sky-900/20 border-r border-sky-100">
                        <p className="text-[10px] font-black text-sky-600 uppercase tracking-widest">Proxy Cap (P)</p>
                     </th>
                     {TABS_METADATA.map(tab => (
                       <th key={tab.id} className="px-4 py-6 text-center min-w-[80px]">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter leading-tight">{tab.label}</p>
                       </th>
                     ))}
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {allRoles.map(role => {
                    const isCustom = (config.customRoles || []).includes(role);
                    return (
                      <tr key={role} className="hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors group">
                         <td className="px-8 py-6 sticky left-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md z-20 border-r border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                               <div>
                                  <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase italic tracking-tight">{role.replace(/_/g, ' ')}</p>
                                  {isCustom && <span className="text-[6px] font-black text-amber-500 uppercase tracking-widest">Custom Entry</span>}
                               </div>
                               {isCustom && (
                                 <button onClick={() => handleDismantleRole(role)} className="opacity-0 group-hover:opacity-100 p-2 text-rose-400 hover:text-rose-600 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                               )}
                            </div>
                         </td>
                         <td className="px-4 py-6 text-center bg-amber-50/10 border-r border-amber-50">
                            <input type="number" min="0" max="45" value={loadPolicies[role]?.baseTarget ?? 28} onChange={e => handleUpdatePolicy(role, 'baseTarget', parseInt(e.target.value) || 0)} className="w-16 p-2 bg-white dark:bg-slate-800 rounded-xl text-center font-black text-xs border border-amber-200 outline-none focus:ring-2 ring-amber-400" />
                         </td>
                         <td className="px-4 py-6 text-center bg-sky-50/10 border-r border-sky-50">
                            <input type="number" min="0" max="15" value={loadPolicies[role]?.substitutionCap ?? 5} onChange={e => handleUpdatePolicy(role, 'substitutionCap', parseInt(e.target.value) || 0)} className="w-16 p-2 bg-white dark:bg-slate-800 rounded-xl text-center font-black text-xs border border-sky-200 outline-none focus:ring-2 ring-sky-400" />
                         </td>
                         {TABS_METADATA.map(tab => (
                           <td key={tab.id} className="px-2 py-6 text-center">
                              <button onClick={() => togglePermission(role, tab.id)} disabled={role === UserRole.ADMIN && tab.id === 'control_center'} className={`w-10 h-5 rounded-full relative transition-all ${(permissions[role] || []).includes(tab.id) ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'}`}>
                                 <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(permissions[role] || []).includes(tab.id) ? 'translate-x-5' : ''}`}></div>
                              </button>
                           </td>
                         ))}
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

export default AdminControlCenter;

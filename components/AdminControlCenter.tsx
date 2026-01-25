
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, UserRole, SchoolConfig, AppTab, PermissionsConfig, RoleLoadPolicy, PrintConfig, PrintMode, PrintTemplate, PrintElement } from '../types.ts';
import { DEFAULT_PERMISSIONS, DEFAULT_LOAD_POLICIES, DEFAULT_PRINT_CONFIG, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

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
  { id: 'batch_timetable', label: 'Batch Dispatcher', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2M7 7h10' },
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

const TAG_CATALOG: Record<string, { tag: string; label: string; sample: string }[]> = {
  GLOBAL: [
    { tag: '[SCHOOL_NAME]', label: 'School Identity', sample: SCHOOL_NAME },
    { tag: '[DATE]', label: 'Current Date', sample: 'Oct 24, 2026' },
    { tag: '[ACADEMIC_YEAR]', label: 'Academic Cycle', sample: '2026-2027' },
  ],
  CLASS: [
    { tag: '[CLASS_TEACHER]', label: 'Class Teacher', sample: 'Sarah Ahmed (Sample)' },
    { tag: '[SECTION_NAME]', label: 'Full Section', sample: 'IX A' },
    { tag: '[WING_NAME]', label: 'Wing Identifier', sample: 'Secondary Boys' },
    { tag: '[GRADE_NAME]', label: 'Grade Level', sample: 'Grade IX' },
    { tag: '[ENTITY_NAME]', label: 'Legacy Entity', sample: 'IX A' },
  ],
  STAFF: [
    { tag: '[STAFF_NAME]', label: 'Teacher Name', sample: 'John Doe (Sample)' },
    { tag: '[STAFF_ID]', label: 'Employee Code', sample: 'emp101' },
    { tag: '[PRIMARY_ROLE]', label: 'Official Role', sample: 'Primary Teacher' },
    { tag: '[STAFF_EXPERTISE]', label: 'Subject Domain', sample: 'Mathematics, Science' },
    { tag: '[ENTITY_NAME]', label: 'Legacy Entity', sample: 'John Doe' },
  ],
  ROOM: [
    { tag: '[ROOM_NAME]', label: 'Room Number', sample: 'ROOM 101' },
    { tag: '[WING_NAME]', label: 'Wing Context', sample: 'Primary Wing' },
    { tag: '[ENTITY_NAME]', label: 'Legacy Entity', sample: 'ROOM 101' },
  ],
  MASTER: [
     { tag: '[DATE]', label: 'Matrix Date', sample: 'Sunday, Oct 24' },
     { tag: '[ENTITY_NAME]', label: 'Legacy Context', sample: 'Institutional Overview' },
  ]
};

const AdminControlCenter: React.FC<AdminControlCenterProps> = ({ config, setConfig, showToast, isSandbox, addSandboxLog }) => {
  const [permissions, setPermissions] = useState<PermissionsConfig>(config.permissions || DEFAULT_PERMISSIONS);
  const [loadPolicies, setLoadPolicies] = useState<Record<string, RoleLoadPolicy>>(config.loadPolicies || DEFAULT_LOAD_POLICIES);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(config.printConfig || DEFAULT_PRINT_CONFIG);
  const [newRoleName, setNewRoleName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeArchitectTab, setActiveArchitectTab] = useState<'ACCESS' | 'LOAD' | 'PRINT'>('ACCESS');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // ARCHITECT STATE
  const [selectedPrintMode, setSelectedPrintMode] = useState<PrintMode>('CLASS');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  const activeTemplate = useMemo(() => printConfig.templates[selectedPrintMode], [printConfig, selectedPrintMode]);
  const selectedElement = useMemo(() => {
    if (!selectedElementId) return null;
    return [...activeTemplate.header, ...activeTemplate.footer].find(e => e.id === selectedElementId);
  }, [selectedElementId, activeTemplate]);

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

  const updateTemplate = (updated: PrintTemplate) => {
    setPrintConfig(prev => ({
      ...prev,
      templates: { ...prev.templates, [selectedPrintMode]: updated }
    }));
  };

  const handleRestoreDefault = () => {
    if(!confirm("Restore system default layout for this mode? Any unsaved custom work will be lost.")) return;
    const def = DEFAULT_PRINT_CONFIG.templates[selectedPrintMode];
    updateTemplate({ ...def });
    setSelectedElementId(null);
    showToast("Default Layout Restored (Unsaved)", "info");
  };

  const moveElement = (direction: 'up' | 'down' | 'front' | 'back') => {
    if (!selectedElementId) return;
    const isHeader = activeTemplate.header.some(e => e.id === selectedElementId);
    const list = isHeader ? [...activeTemplate.header] : [...activeTemplate.footer];
    const idx = list.findIndex(e => e.id === selectedElementId);
    const item = list[idx];
    
    if (direction === 'up' && idx > 0) {
      list[idx] = list[idx - 1]; list[idx - 1] = item;
    } else if (direction === 'down' && idx < list.length - 1) {
      list[idx] = list[idx + 1]; list[idx + 1] = item;
    } else if (direction === 'front') {
      list.splice(idx, 1); list.push(item);
    } else if (direction === 'back') {
      list.splice(idx, 1); list.unshift(item);
    } else return;
    
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: list });
  };

  const updateElementStyle = (field: keyof PrintElement['style'], value: any) => {
    if (!selectedElementId) return;
    const isHeader = activeTemplate.header.some(e => e.id === selectedElementId);
    const list = isHeader ? [...activeTemplate.header] : [...activeTemplate.footer];
    const idx = list.findIndex(e => e.id === selectedElementId);
    list[idx] = { ...list[idx], style: { ...list[idx].style, [field]: value } };
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: list });
  };

  const updateElementContent = (value: string) => {
    if (!selectedElementId) return;
    const isHeader = activeTemplate.header.some(e => e.id === selectedElementId);
    const list = isHeader ? [...activeTemplate.header] : [...activeTemplate.footer];
    const idx = list.findIndex(e => e.id === selectedElementId);
    if (list[idx].type === 'DYNAMIC_BRICK' && list[idx].content === '[SCHOOL_NAME]') return;
    list[idx] = { ...list[idx], content: value };
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: list });
  };

  const insertTag = (tag: string) => {
    if (!selectedElementId || !textAreaRef.current) return;
    const isHeader = activeTemplate.header.some(e => e.id === selectedElementId);
    const list = isHeader ? [...activeTemplate.header] : [...activeTemplate.footer];
    const idx = list.findIndex(e => e.id === selectedElementId);
    
    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const oldVal = list[idx].content;
    const newVal = oldVal.substring(0, start) + tag + oldVal.substring(end);
    
    list[idx] = { ...list[idx], content: newVal, type: 'DYNAMIC_BRICK' };
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: list });
    
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(start + tag.length, start + tag.length);
      }
    }, 0);
  };

  const addStaticText = (location: 'header' | 'footer') => {
    const newEl: PrintElement = {
      id: generateUUID(),
      type: 'STATIC_TEXT',
      content: 'NEW TEXT BLOCK',
      style: { fontSize: 10, fontWeight: 'normal', textAlign: 'center', color: '#64748b', italic: false, uppercase: false, tracking: 'normal', marginTop: 0, marginBottom: 0 }
    };
    updateTemplate({ ...activeTemplate, [location]: [...activeTemplate[location], newEl] });
    setSelectedElementId(newEl.id);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const newEl: PrintElement = {
        id: generateUUID(),
        type: 'IMAGE',
        content: base64,
        style: { fontSize: 0, fontWeight: 'normal', textAlign: 'center', color: '', italic: false, uppercase: false, tracking: 'normal', width: 100, height: 100, marginTop: 5, marginBottom: 5, opacity: 1, grayscale: false }
      };
      updateTemplate({ ...activeTemplate, header: [...activeTemplate.header, newEl] });
      setSelectedElementId(newEl.id);
    };
    reader.readAsDataURL(file);
  };

  const removeElement = (id: string) => {
    const isHeader = activeTemplate.header.some(e => e.id === id);
    const el = isHeader ? activeTemplate.header.find(e => e.id === id) : activeTemplate.footer.find(e => e.id === id);
    if (el?.type === 'DYNAMIC_BRICK' && el.content === '[SCHOOL_NAME]') {
      showToast("Institutional Identity Brick is protected.", "warning");
      return;
    }
    const filtered = activeTemplate[isHeader ? 'header' : 'footer'].filter(e => e.id !== id);
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: filtered });
    setSelectedElementId(null);
  };

  const handleApplyMatrix = async () => {
    setIsProcessing(true);
    const updatedConfig = { ...config, permissions, loadPolicies, printConfig };
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      } else if (isSandbox) {
        addSandboxLog?.('POLICY_MATRIX_SYNC', { updatedConfig });
      }
      setConfig(updatedConfig);
      showToast("Global Matrix & Print Blueprints Synchronized", "success");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
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
      }
      setConfig(updatedConfig);
      setPermissions(updatedPermissions);
      setLoadPolicies(updatedPolicies);
      setNewRoleName('');
      showToast(`Role "${name}" successfully authorized.`, "success");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
  };

  const injectPreviewContent = (content: string) => {
    let result = content;
    const tags = [...TAG_CATALOG.GLOBAL, ...TAG_CATALOG[selectedPrintMode]];
    tags.forEach(t => {
      result = result.split(t.tag).join(t.sample);
    });
    return result;
  };

  const canvasAspectRatio = useMemo(() => {
    const pageSize = activeTemplate.tableStyles.pageSize || 'a4';
    const map: Record<string, string> = {
      'a4': '297 / 210',
      'a3': '420 / 297',
      'letter': '279.4 / 215.9',
      'legal': '355.6 / 215.9'
    };
    return map[pageSize] || '297 / 210';
  }, [activeTemplate.tableStyles.pageSize]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Global <span className="text-[#d4af37]">Policies</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Access & Load Matrix</p>
        </div>
        <button onClick={handleApplyMatrix} disabled={isProcessing} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">
           {isProcessing ? 'Syncing Matrix...' : 'Apply Global Matrix'}
        </button>
      </div>

      <div className="bg-[#001f3f] rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden group border border-white/5">
         <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1 space-y-2 text-center md:text-left">
               <h3 className="text-xl font-black text-amber-400 uppercase italic tracking-widest">Faculty Role Factory</h3>
               <p className="text-[10px] font-medium text-white/50 uppercase tracking-[0.3em]">Define new institutional access levels</p>
            </div>
            <div className="flex flex-1 w-full gap-3 bg-white/5 p-3 rounded-[2rem] border border-white/10 backdrop-blur-sm">
               <input type="text" placeholder="ROLE IDENTIFIER" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} className="flex-1 bg-transparent px-6 py-4 text-white font-black text-xs uppercase outline-none placeholder:text-white/20" />
               <button onClick={handleCreateRole} disabled={!newRoleName.trim() || isProcessing} className="bg-[#d4af37] text-[#001f3f] px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all">Authorize</button>
            </div>
         </div>
      </div>

      <div className="flex bg-white dark:bg-slate-900 p-2 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl max-w-2xl mx-auto overflow-x-auto scrollbar-hide">
         {(['ACCESS', 'LOAD', 'PRINT'] as const).map(tab => (
           <button 
             key={tab} 
             onClick={() => setActiveArchitectTab(tab)}
             className={`flex-1 py-4 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeArchitectTab === tab ? 'bg-[#001f3f] text-[#d4af37] shadow-lg scale-105' : 'text-slate-400 hover:text-[#001f3f]'}`}
           >
             {tab === 'ACCESS' ? 'Access Ledger' : tab === 'LOAD' ? 'Load Policies' : 'Document Architect'}
           </button>
         ))}
      </div>

      {activeArchitectTab === 'ACCESS' && (
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 overflow-x-auto animate-in slide-in-from-bottom-4 duration-500">
           <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                 <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest rounded-tl-3xl">Institutional Role</th>
                    {TABS_METADATA.map(tab => (
                      <th key={tab.id} className="px-4 py-5 text-center" title={tab.label}>
                         <div className="flex flex-col items-center gap-1">
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon}/></svg>
                            <span className="text-[7px] font-black text-slate-300 uppercase tracking-tighter">{tab.label.split(' ')[0]}</span>
                         </div>
                      </th>
                    ))}
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                 {allRoles.map(role => (
                   <tr key={role} className="hover:bg-amber-50/10 transition-colors">
                      <td className="px-6 py-6">
                         <span className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-tight">{role.replace(/_/g, ' ')}</span>
                      </td>
                      {TABS_METADATA.map(tab => {
                        const hasTab = (permissions[role] || []).includes(tab.id);
                        return (
                          <td key={tab.id} className="px-4 py-6 text-center">
                             <button 
                               onClick={() => togglePermission(role, tab.id)}
                               className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${hasTab ? 'bg-emerald-500 text-white shadow-lg scale-110' : 'bg-slate-50 dark:bg-slate-800 text-slate-200'}`}
                             >
                               {hasTab ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"/></svg> : <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>}
                             </button>
                          </td>
                        );
                      })}
                   </tr>
                 ))}
              </tbody>
           </table>
        </div>
      )}

      {activeArchitectTab === 'LOAD' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
           {allRoles.map(role => (
             <div key={role} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 group hover:border-amber-400 transition-all">
                <h4 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest mb-8">{role.replace(/_/g, ' ')}</h4>
                <div className="space-y-10">
                   <div className="space-y-4">
                      <div className="flex justify-between items-center">
                         <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Instructional Target</label>
                         <span className="text-xl font-black text-[#001f3f] dark:text-amber-400 italic">{(loadPolicies[role]?.baseTarget ?? 28)}P</span>
                      </div>
                      <input 
                        type="range" min="0" max="40" 
                        value={loadPolicies[role]?.baseTarget ?? 28} 
                        onChange={e => handleUpdatePolicy(role, 'baseTarget', parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none accent-amber-500" 
                      />
                   </div>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center">
                         <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Substitution Cap</label>
                         <span className="text-xl font-black text-sky-500 italic">{(loadPolicies[role]?.substitutionCap ?? 5)}P</span>
                      </div>
                      <input 
                        type="range" min="0" max="15" 
                        value={loadPolicies[role]?.substitutionCap ?? 5} 
                        onChange={e => handleUpdatePolicy(role, 'substitutionCap', parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none accent-sky-500" 
                      />
                   </div>
                </div>
             </div>
           ))}
        </div>
      )}

      {activeArchitectTab === 'PRINT' && (
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-10 animate-in slide-in-from-bottom-4 duration-500">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 dark:border-slate-800 pb-8">
              <div className="space-y-1">
                 <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Institutional Branding Engine</h2>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic leading-relaxed">Design templates for high-fidelity matrix output.</p>
              </div>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
                {(['CLASS', 'STAFF', 'ROOM', 'MASTER'] as PrintMode[]).map(mode => (
                  <button key={mode} onClick={() => { setSelectedPrintMode(mode); setSelectedElementId(null); }} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${selectedPrintMode === mode ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{mode}</button>
                ))}
              </div>
           </div>

           <div className="grid grid-cols-1 xl:grid-cols-12 gap-12">
              <div className="xl:col-span-4 space-y-8 h-full">
                 <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Brick Palette</p>
                      <button onClick={handleRestoreDefault} className="text-[8px] font-black text-rose-400 uppercase border-b border-rose-400 hover:text-rose-600">Restore Default</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <button onClick={() => addStaticText('header')} className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-left hover:border-amber-400 transition-all flex flex-col gap-2">
                          <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">Add Text</span>
                       </button>
                       <button onClick={() => fileInputRef.current?.click()} className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-left hover:border-amber-400 transition-all flex flex-col gap-2">
                          <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                          <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">Add Image</span>
                       </button>
                       <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </div>
                 </div>

                 {selectedElement ? (
                   <div className="bg-[#001f3f] p-6 rounded-[2rem] space-y-6 animate-in slide-in-from-left duration-300 shadow-2xl sticky top-4">
                      <div className="flex items-center justify-between">
                         <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Style Inspector</p>
                         <div className="flex gap-2">
                           <button onClick={() => moveElement('front')} title="Bring to Front" className="text-white/40 hover:text-white"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M5 2c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2V4c0-1.103-.897-2-2-2H5zm12 14H5V4h12v12zM21 8v12c0 1.103-.897 2-2 2H7v-2h12V8h2z"/></svg></button>
                           <button onClick={() => moveElement('back')} title="Send to Back" className="text-white/40 hover:text-white"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 2c1.103 0 2 .897 2 2v12c0 1.103-.897 2-2 2H7c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h12zm-12 14h12V4H7v12zM3 8v12c0 1.103.897 2 2 2h12v-2H5V8H3z"/></svg></button>
                           <button onClick={() => removeElement(selectedElementId!)} className="text-rose-400 hover:text-rose-500 ml-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                         </div>
                      </div>
                      
                      <div className="space-y-4">
                         {selectedElement.type !== 'IMAGE' && (
                           <div className="space-y-3">
                              <div className="flex justify-between items-center">
                                 <label className="text-[8px] font-black text-white/40 uppercase">Content / Mapping</label>
                                 <div className="relative group/tags">
                                    <button className="text-[8px] font-black text-amber-400 uppercase hover:bg-white/10 px-2 py-1 rounded">Insert Data Tag</button>
                                    <div className="absolute right-0 bottom-full mb-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-2 hidden group-hover/tags:block z-[200] border border-slate-100 shadow-emerald-500/20">
                                       <p className="text-[7px] font-black text-slate-400 uppercase px-2 py-1 mb-1">Global Bricks</p>
                                       {TAG_CATALOG.GLOBAL.map(t => (
                                         <button key={t.tag} onClick={() => insertTag(t.tag)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-[9px] font-bold text-[#001f3f] dark:text-white flex justify-between">
                                            <span>{t.label}</span>
                                            <span className="opacity-40 italic">{t.tag}</span>
                                         </button>
                                       ))}
                                       <div className="h-[1px] bg-slate-100 my-1"></div>
                                       <p className="text-[7px] font-black text-amber-500 uppercase px-2 py-1 mb-1">{selectedPrintMode} Context</p>
                                       {TAG_CATALOG[selectedPrintMode].map(t => (
                                         <button key={t.tag} onClick={() => insertTag(t.tag)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-[9px] font-bold text-[#001f3f] dark:text-white flex justify-between">
                                            <span>{t.label}</span>
                                            <span className="opacity-40 italic">{t.tag}</span>
                                         </button>
                                       ))}
                                    </div>
                                 </div>
                              </div>
                              <textarea 
                                ref={textAreaRef}
                                disabled={selectedElement.type === 'DYNAMIC_BRICK' && selectedElement.content === '[SCHOOL_NAME]'}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-amber-400 transition-all resize-none font-medium h-20" 
                                value={selectedElement.content}
                                onChange={e => updateElementContent(e.target.value)}
                              />
                           </div>
                         )}

                         {selectedElement.type === 'IMAGE' && (
                           <div className="space-y-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                              <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Image Filters</p>
                              <div className="flex items-center justify-between">
                                 <span className="text-[9px] font-black text-white/40 uppercase">Decolorize (B&W)</span>
                                 <button onClick={() => updateElementStyle('grayscale', !selectedElement.style.grayscale)} className={`w-10 h-5 rounded-full relative transition-all ${selectedElement.style.grayscale ? 'bg-amber-400' : 'bg-white/10'}`}>
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${selectedElement.style.grayscale ? 'translate-x-5' : ''}`}></div>
                                 </button>
                              </div>
                              <div className="space-y-2">
                                 <div className="flex justify-between items-center"><span className="text-[9px] font-black text-white/40 uppercase">Opacity</span><span className="text-[9px] font-black text-amber-400">{Math.round((selectedElement.style.opacity || 1) * 100)}%</span></div>
                                 <input type="range" min="0" max="1" step="0.1" value={selectedElement.style.opacity || 1} onChange={e => updateElementStyle('opacity', parseFloat(e.target.value))} className="w-full h-1 bg-white/10 rounded-full appearance-none accent-amber-400" />
                              </div>
                           </div>
                         )}

                         <div className="grid grid-cols-2 gap-3">
                            {selectedElement.type === 'IMAGE' ? (
                              <>
                                <div className="space-y-2">
                                  <label className="text-[8px] font-black text-white/40 uppercase">Width (px)</label>
                                  <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white" value={selectedElement.style.width || 100} onChange={e => updateElementStyle('width', parseInt(e.target.value))} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[8px] font-black text-white/40 uppercase">Height (px)</label>
                                  <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white" value={selectedElement.style.height || 100} onChange={e => updateElementStyle('height', parseInt(e.target.value))} />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="space-y-2">
                                  <label className="text-[8px] font-black text-white/40 uppercase">Font Size</label>
                                  <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white" value={selectedElement.style.fontSize} onChange={e => updateElementStyle('fontSize', parseInt(e.target.value))} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[8px] font-black text-white/40 uppercase">Weight</label>
                                  <select className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-[10px] text-white uppercase" value={selectedElement.style.fontWeight} onChange={e => updateElementStyle('fontWeight', e.target.value)}>
                                    <option value="normal">Regular</option>
                                    <option value="bold">Bold</option>
                                    <option value="900">Black</option>
                                  </select>
                                </div>
                              </>
                            )}
                         </div>

                         <div className="space-y-2">
                            <label className="text-[8px] font-black text-white/40 uppercase">Horizontal Alignment</label>
                            <div className="flex bg-white/5 p-1 rounded-xl">
                               {(['left', 'center', 'right'] as const).map(align => (
                                 <button key={align} onClick={() => updateElementStyle('textAlign', align)} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${selectedElement.style.textAlign === align ? 'bg-amber-400 text-[#001f3f]' : 'text-white/40'}`}>{align}</button>
                               ))}
                            </div>
                         </div>

                         <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <label className="text-[8px] font-black text-white/40 uppercase">Margin Top</label>
                              <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white" value={selectedElement.style.marginTop || 0} onChange={e => updateElementStyle('marginTop', parseInt(e.target.value))} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[8px] font-black text-white/40 uppercase">Margin Bot</label>
                              <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white" value={selectedElement.style.marginBottom || 0} onChange={e => updateElementStyle('marginBottom', parseInt(e.target.value))} />
                            </div>
                         </div>
                      </div>
                   </div>
                 ) : (
                   <div className="p-8 text-center bg-slate-50 dark:bg-slate-800 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-700 opacity-50">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic leading-relaxed">Select a brick on the canvas to start styling.</p>
                   </div>
                 )}

                 <div className="space-y-6">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Matrix Architecture</p>
                    <div className="grid grid-cols-1 gap-4 bg-slate-50 dark:bg-slate-800 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700">
                       <div className="space-y-4">
                          <div className="flex justify-between items-center">
                             <label className="text-[9px] font-black text-slate-400 uppercase">Colors & Geometry</label>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1">
                                <span className="text-[7px] font-bold text-slate-400 uppercase">Header BG</span>
                                <input type="color" className="w-full h-10 rounded-xl border-0 cursor-pointer" value={activeTemplate.tableStyles.headerBg} onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, headerBg: e.target.value } })} />
                             </div>
                             <div className="space-y-1">
                                <span className="text-[7px] font-bold text-slate-400 uppercase">Header Text</span>
                                <input type="color" className="w-full h-10 rounded-xl border-0 cursor-pointer" value={activeTemplate.tableStyles.headerTextColor} onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, headerTextColor: e.target.value } })} />
                             </div>
                          </div>
                          <div className="space-y-1">
                             <span className="text-[7px] font-bold text-slate-400 uppercase">Page Geometry (Format)</span>
                             <select 
                               className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl text-[10px] font-black uppercase outline-none border-2 border-transparent focus:border-sky-500"
                               value={activeTemplate.tableStyles.pageSize || 'a4'}
                               onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, pageSize: e.target.value as any } })}
                             >
                               <option value="a4">A4 (Standard)</option>
                               <option value="a3">A3 (Oversize)</option>
                               <option value="letter">Letter (US)</option>
                               <option value="legal">Legal (US)</option>
                             </select>
                          </div>
                       </div>

                       <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
                          <div className="flex items-center justify-between">
                             <span className="text-[9px] font-black text-slate-400 uppercase">Zebra Striping</span>
                             <button onClick={() => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, stripeRows: !activeTemplate.tableStyles.stripeRows } })} className={`w-10 h-5 rounded-full relative transition-all ${activeTemplate.tableStyles.stripeRows ? 'bg-sky-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${activeTemplate.tableStyles.stripeRows ? 'translate-x-5' : ''}`}></div>
                             </button>
                          </div>
                       </div>

                       <div className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-4">
                          <div className="flex justify-between items-center"><label className="text-[9px] font-black text-slate-400 uppercase">Matrix Width</label><span className="text-[10px] font-black text-sky-500">{activeTemplate.tableStyles.tableWidthPercent}%</span></div>
                          <input type="range" min="50" max="100" step="1" value={activeTemplate.tableStyles.tableWidthPercent} onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, tableWidthPercent: parseInt(e.target.value) } })} className="w-full h-1.5 bg-slate-200 dark:bg-slate-900 rounded-full appearance-none accent-sky-500 cursor-pointer" />
                       </div>

                       <div className="space-y-2">
                          <div className="flex justify-between items-center"><label className="text-[9px] font-black text-slate-400 uppercase">Row Density</label><span className="text-[10px] font-black text-sky-500">{activeTemplate.tableStyles.rowHeight}mm</span></div>
                          <input type="range" min="10" max="40" step="1" value={activeTemplate.tableStyles.rowHeight} onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, rowHeight: parseInt(e.target.value) } })} className="w-full h-1.5 bg-slate-200 dark:bg-slate-900 rounded-full appearance-none accent-sky-500 cursor-pointer" />
                       </div>

                       <div className="space-y-2">
                          <div className="flex justify-between items-center"><label className="text-[9px] font-black text-slate-400 uppercase">Page Margins</label><span className="text-[10px] font-black text-sky-500">{activeTemplate.tableStyles.pageMargins}mm</span></div>
                          <input type="range" min="0" max="40" step="1" value={activeTemplate.tableStyles.pageMargins} onChange={e => updateTemplate({ ...activeTemplate, tableStyles: { ...activeTemplate.tableStyles, pageMargins: parseInt(e.target.value) } })} className="w-full h-1.5 bg-slate-200 dark:bg-slate-900 rounded-full appearance-none accent-sky-500 cursor-pointer" />
                       </div>
                    </div>
                    
                    {/* Additive Change: Specific Save Template button in the sidebar */}
                    <button 
                      onClick={handleApplyMatrix} 
                      disabled={isProcessing}
                      className="w-full mt-6 bg-emerald-600 text-white py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-emerald-700 active:scale-95 transition-all flex items-center justify-center gap-3"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                      {isProcessing ? 'Saving Template...' : 'Save Template'}
                    </button>
                 </div>
              </div>

              <div className="xl:col-span-8">
                 <div className="bg-slate-100 dark:bg-slate-950 p-4 md:p-10 rounded-[3.5rem] shadow-inner border border-slate-200 dark:border-slate-800 relative overflow-hidden flex flex-col items-center">
                    <div className="mb-4 flex items-center gap-4">
                       <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">Live Architect Canvas</span>
                    </div>
                    
                    <div 
                      className="bg-white shadow-2xl flex flex-col relative overflow-hidden transition-all duration-500" 
                      style={{ 
                        aspectRatio: canvasAspectRatio, 
                        width: '100%', 
                        padding: `${activeTemplate.tableStyles.pageMargins}mm`,
                        boxSizing: 'border-box',
                        boxShadow: '0 50px 100px -20px rgba(0,0,0,0.1)'
                      }}
                    >
                       <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

                       <div className="flex-1 flex flex-col">
                          <div className="mb-6 relative z-10 min-h-[40px] flex flex-col">
                             {activeTemplate.header.map(el => (
                               <div 
                                 key={el.id} 
                                 onClick={() => setSelectedElementId(el.id)}
                                 className={`cursor-pointer transition-all hover:bg-amber-50/50 p-0.5 rounded group relative ${selectedElementId === el.id ? 'ring-2 ring-amber-500 bg-amber-50' : ''}`}
                                 style={{ 
                                   fontSize: el.type === 'IMAGE' ? '0' : `${el.style.fontSize}px`, 
                                   fontWeight: el.style.fontWeight, 
                                   textAlign: el.style.textAlign,
                                   color: el.style.color,
                                   fontStyle: el.style.italic ? 'italic' : 'normal',
                                   textTransform: el.style.uppercase ? 'uppercase' : 'none',
                                   letterSpacing: el.style.tracking === 'normal' ? '0' : el.style.tracking,
                                   marginTop: `${el.style.marginTop || 0}px`,
                                   marginBottom: `${el.style.marginBottom || 0}px`,
                                   opacity: el.style.opacity ?? 1,
                                   filter: el.style.grayscale ? 'grayscale(100%)' : 'none'
                                 }}
                               >
                                 {el.type === 'IMAGE' ? (
                                    <div className={`flex ${el.style.textAlign === 'center' ? 'justify-center' : el.style.textAlign === 'right' ? 'justify-end' : 'justify-start'}`}>
                                       <img src={el.content} crossOrigin="anonymous" style={{ width: `${el.style.width || 100}px`, height: `${el.style.height || 100}px`, objectFit: 'contain' }} alt="Brick" />
                                    </div>
                                 ) : (
                                    injectPreviewContent(el.content)
                                 )}
                               </div>
                             ))}
                          </div>

                          <div className="flex-1 flex flex-col items-center justify-center">
                             <div 
                                className="border-2 rounded flex flex-col overflow-hidden transition-all duration-500 shadow-xl"
                                style={{ 
                                  width: `${activeTemplate.tableStyles.tableWidthPercent}%`,
                                  borderColor: activeTemplate.tableStyles.borderColor,
                                  borderWidth: `${activeTemplate.tableStyles.borderWidth}px`
                                }}
                             >
                                <div className="flex" style={{ backgroundColor: activeTemplate.tableStyles.headerBg, color: activeTemplate.tableStyles.headerTextColor }}>
                                   <div className="w-12 border-r h-8 flex items-center justify-center" style={{ borderColor: activeTemplate.tableStyles.borderColor }}>
                                      <span className="text-[5px] font-black uppercase italic">Day</span>
                                   </div>
                                   {Array.from({length: 8}).map((_, i) => (
                                      <div key={i} className="flex-1 border-r last:border-0 h-8 flex items-center justify-center" style={{ borderColor: activeTemplate.tableStyles.borderColor }}>
                                         <span className="text-[5px] font-black uppercase">P{i+1}</span>
                                      </div>
                                   ))}
                                </div>
                                <div className="flex-1 flex flex-col">
                                   {Array.from({length: 4}).map((_, i) => (
                                     <div key={i} className="border-b last:border-0 flex" style={{ 
                                       height: `${activeTemplate.tableStyles.rowHeight}px`, 
                                       borderColor: activeTemplate.tableStyles.borderColor,
                                       backgroundColor: activeTemplate.tableStyles.stripeRows && i % 2 !== 0 ? '#f8fafc' : 'transparent'
                                     }}>
                                        <div className="w-12 border-r h-full bg-slate-50 flex items-center justify-center" style={{ borderColor: activeTemplate.tableStyles.borderColor }}>
                                           <span className="text-[5px] font-black opacity-30 italic">DAY</span>
                                        </div>
                                        {Array.from({length: 8}).map((_, j) => (
                                          <div key={j} className="flex-1 border-r last:border-0 h-full flex items-center justify-center text-[5px] font-black uppercase text-slate-200" style={{ borderColor: activeTemplate.tableStyles.borderColor }}>
                                             ENTRY
                                          </div>
                                        ))}
                                     </div>
                                   ))}
                                </div>
                             </div>
                          </div>

                          <div className="mt-6 relative z-10 min-h-[30px] flex flex-col">
                             {activeTemplate.footer.map(el => (
                               <div 
                                 key={el.id} 
                                 onClick={() => setSelectedElementId(el.id)}
                                 className={`cursor-pointer transition-all hover:bg-amber-50/50 p-0.5 rounded group relative ${selectedElementId === el.id ? 'ring-2 ring-amber-500 bg-amber-50' : ''}`}
                                 style={{ 
                                   fontSize: el.type === 'IMAGE' ? '0' : `${el.style.fontSize}px`, 
                                   fontWeight: el.style.fontWeight, 
                                   textAlign: el.style.textAlign,
                                   color: el.style.color,
                                   fontStyle: el.style.italic ? 'italic' : 'normal',
                                   textTransform: el.style.uppercase ? 'uppercase' : 'none',
                                   letterSpacing: el.style.tracking === 'normal' ? '0' : el.style.tracking,
                                   marginTop: `${el.style.marginTop || 0}px`,
                                   marginBottom: `${el.style.marginBottom || 0}px`,
                                   opacity: el.style.opacity ?? 1,
                                   filter: el.style.grayscale ? 'grayscale(100%)' : 'none'
                                 }}
                               >
                                 {el.type === 'IMAGE' ? (
                                    <div className={`flex ${el.style.textAlign === 'center' ? 'justify-center' : el.style.textAlign === 'right' ? 'justify-end' : 'justify-start'}`}>
                                       <img src={el.content} crossOrigin="anonymous" style={{ width: `${el.style.width || 100}px`, height: `${el.style.height || 100}px`, objectFit: 'contain' }} alt="Brick" />
                                    </div>
                                 ) : (
                                    injectPreviewContent(el.content)
                                 )}
                               </div>
                             ))}
                          </div>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AdminControlCenter;

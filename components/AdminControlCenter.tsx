
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, UserRole, SchoolConfig, AppTab, PermissionsConfig, RoleLoadPolicy, PrintConfig, PrintMode, PrintTemplate, PrintElement, FeaturePower } from '../types.ts';
import { DEFAULT_PERMISSIONS, DEFAULT_LOAD_POLICIES, DEFAULT_PRINT_CONFIG, SCHOOL_NAME } from '../constants.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { HapticService } from '../services/hapticService.ts';

interface AdminControlCenterProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
  showToast: (msg: string, type?: any) => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const TABS_METADATA: { id: AppTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Attendance Hub', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'otp', label: 'Registry Key', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'substitutions', label: 'Proxy Matrix', icon: 'M16 8v8m-4-5v5M8 8v8m10 5H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 v12a2 2 0 01-2 2z' },
  { id: 'occupancy', label: 'Campus Map', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
  { id: 'timetable', label: 'Matrix Control', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'batch_timetable', label: 'Batch Dispatcher', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { id: 'history', label: 'Faculty Ledger', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'reports', label: 'Analytics Hub', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2' },
  { id: 'assignments', label: 'Load Intelligence', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { id: 'groups', label: 'Subject Pools', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'extra_curricular', label: 'Extra Curricular', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'users', label: 'Faculty Roster', icon: 'M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'handbook', label: 'Ops Handbook', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { id: 'profile', label: 'Profile Hub', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { id: 'deployment', label: 'Infrastructure', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'config', label: 'Global Setup', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { id: 'control_center', label: 'Control Center', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' }
];

const FEATURE_POWERS_METADATA: { id: FeaturePower; label: string; description: string }[] = [
  { id: 'can_edit_attendance', label: 'Modify Records', description: 'Manually edit or add attendance entries for others' },
  { id: 'can_assign_proxies', label: 'Authorize Proxies', description: 'Deploy and dismantle substitute assignments' },
  { id: 'can_edit_timetable_live', label: 'Matrix Overwrites', description: 'Dismantle or swap Live Matrix entries' },
  { id: 'can_export_sensitive_reports', label: 'Data Exporter', description: 'Access to high-fidelity PDF and Excel audit data' },
  { id: 'can_manage_personnel', label: 'Identity Admin', description: 'Enroll staff or update security access keys' },
  { id: 'can_override_geolocation', label: 'GPS Bypass', description: 'Mark attendance without location boundary check' }
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

const AdminControlCenter: React.FC<AdminControlCenterProps> = ({ config, setConfig, users, showToast, isSandbox, addSandboxLog }) => {
  const [permissions, setPermissions] = useState<PermissionsConfig>(config.permissions || DEFAULT_PERMISSIONS);
  const [featurePermissions, setFeaturePermissions] = useState<Record<string, FeaturePower[]>>(config.featurePermissions || {});
  const [loadPolicies, setLoadPolicies] = useState<Record<string, RoleLoadPolicy>>(config.loadPolicies || DEFAULT_LOAD_POLICIES);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(config.printConfig || DEFAULT_PRINT_CONFIG);
  const [examTypes, setExamTypes] = useState<string[]>(config.examTypes || ['UNIT TEST', 'MIDTERM', 'FINAL TERM', 'MOCK EXAM']);
  const [newRoleName, setNewRoleName] = useState('');
  const [newExamType, setNewExamType] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeArchitectTab, setActiveArchitectTab] = useState<'ACCESS' | 'LOAD' | 'PRINT'>('ACCESS');
  const [accessSubTab, setAccessSubTab] = useState<'PAGES' | 'POWERS'>('PAGES');
  
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
      return { ...prev, [role]: updatedTabs as AppTab[] };
    });
  };

  const toggleFeaturePower = (role: string, power: FeaturePower) => {
    if (role === UserRole.ADMIN) return;
    setFeaturePermissions(prev => {
      const currentPowers = prev[role] || [];
      const updatedPowers = currentPowers.includes(power) ? currentPowers.filter(p => p !== power) : [...currentPowers, power];
      return { ...prev, [role]: updatedPowers };
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
    if(!confirm("Restore default layout?")) return;
    const def = DEFAULT_PRINT_CONFIG.templates[selectedPrintMode];
    updateTemplate({ ...def });
    setSelectedElementId(null);
  };

  const removeElement = (id: string) => {
    if(!confirm("Remove this brick?")) return;
    const isHeader = activeTemplate.header.some(e => e.id === id);
    const list = isHeader ? activeTemplate.header : activeTemplate.footer;
    const filtered = list.filter(e => e.id !== id);
    updateTemplate({ ...activeTemplate, [isHeader ? 'header' : 'footer']: filtered });
    setSelectedElementId(null);
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

  const handleApplyMatrix = async () => {
    setIsProcessing(true);
    const updatedConfig = { ...config, permissions, featurePermissions, loadPolicies, printConfig, examTypes };
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      }
      setConfig(updatedConfig);
      showToast("Global Matrix Synchronized", "success");
    } catch (err: any) { showToast(err.message, "error"); } finally { setIsProcessing(false); }
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim().toUpperCase().replace(/\s+/g, '_');
    if (!name || allRoles.includes(name)) return;
    const updatedCustomRoles = [...(config.customRoles || []), name];
    const updatedPermissions = { ...permissions, [name]: ['dashboard', 'profile'] as AppTab[] };
    const updatedFeaturePermissions = { ...featurePermissions, [name]: [] };
    const updatedPolicies = { ...loadPolicies, [name]: { baseTarget: 28, substitutionCap: 5 } };
    setIsProcessing(true);
    try {
      const updatedConfig = { ...config, customRoles: updatedCustomRoles, permissions: updatedPermissions, featurePermissions: updatedFeaturePermissions, loadPolicies: updatedPolicies };
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      }
      setConfig(updatedConfig);
      setPermissions(updatedPermissions);
      setFeaturePermissions(updatedFeaturePermissions);
      setLoadPolicies(updatedPolicies);
      setNewRoleName('');
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

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Global <span className="text-[#d4af37]">Policies</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Access & Power Matrix</p>
        </div>
        <button onClick={handleApplyMatrix} disabled={isProcessing} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">
           {isProcessing ? 'Syncing...' : 'Apply Global Matrix'}
        </button>
      </div>

      <div className="bg-[#001f3f] rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden group border border-white/5">
         <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1 space-y-2 text-center md:text-left">
               <h3 className="text-xl font-black text-amber-400 uppercase italic tracking-widest">Faculty Role Factory</h3>
            </div>
            <div className="flex flex-1 w-full gap-3 bg-white/5 p-3 rounded-[2rem] border border-white/10 backdrop-blur-sm">
               <input type="text" placeholder="ROLE IDENTIFIER" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} className="flex-1 bg-transparent px-6 py-4 text-white font-black text-xs uppercase outline-none" />
               <button onClick={handleCreateRole} disabled={!newRoleName.trim() || isProcessing} className="bg-[#d4af37] text-[#001f3f] px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all">Authorize</button>
            </div>
         </div>
      </div>

      <div className="flex bg-white dark:bg-slate-900 p-2 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl max-w-4xl mx-auto overflow-x-auto scrollbar-hide">
         {(['ACCESS', 'LOAD', 'PRINT'] as const).map(tab => (
           <button 
             key={tab} 
             onClick={() => setActiveArchitectTab(tab)}
             className={`flex-1 py-4 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeArchitectTab === tab ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400 hover:text-[#001f3f]'}`}
           >
             {tab === 'ACCESS' ? 'Access Ledger' : tab === 'LOAD' ? 'Load Policies' : 'Document Architect'}
           </button>
         ))}
      </div>

      {activeArchitectTab === 'ACCESS' && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
           <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-lg w-fit mx-auto">
              <button onClick={() => setAccessSubTab('PAGES')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${accessSubTab === 'PAGES' ? 'bg-[#001f3f] text-white shadow-md' : 'text-slate-400'}`}>Navigation Pages</button>
              <button onClick={() => setAccessSubTab('POWERS')} className={`px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${accessSubTab === 'POWERS' ? 'bg-[#001f3f] text-white shadow-md' : 'text-slate-400'}`}>Functional Powers</button>
           </div>

           <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                 <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50">
                       <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest rounded-tl-3xl">Institutional Role</th>
                       {accessSubTab === 'PAGES' ? TABS_METADATA.map(tab => (
                         <th key={tab.id} className="px-4 py-5 text-center" title={tab.label}>
                            <svg className="w-4 h-4 text-slate-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon}/></svg>
                         </th>
                       )) : FEATURE_POWERS_METADATA.map(pwr => (
                         <th key={pwr.id} className="px-4 py-5 text-center text-[7px] font-black text-slate-400 uppercase tracking-widest" title={pwr.description}>{pwr.label}</th>
                       ))}
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {allRoles.map(role => (
                      <tr key={role} className="hover:bg-amber-50/10 transition-colors">
                         <td className="px-6 py-6">
                            <span className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-tight">{role.replace(/_/g, ' ')}</span>
                         </td>
                         {accessSubTab === 'PAGES' ? TABS_METADATA.map(tab => {
                           const hasTab = (permissions[role] || []).includes(tab.id);
                           return (
                             <td key={tab.id} className="px-4 py-6 text-center">
                                <button onClick={() => togglePermission(role, tab.id)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${hasTab ? 'bg-emerald-500 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-800 text-slate-200'}`}>
                                  {hasTab ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"/></svg> : <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>}
                                </button>
                             </td>
                           );
                         }) : FEATURE_POWERS_METADATA.map(pwr => {
                           const hasPower = role === UserRole.ADMIN || (featurePermissions[role] || []).includes(pwr.id);
                           return (
                             <td key={pwr.id} className="px-4 py-6 text-center">
                                <button onClick={() => toggleFeaturePower(role, pwr.id)} disabled={role === UserRole.ADMIN} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${hasPower ? 'bg-amber-400 text-[#001f3f]' : 'bg-slate-50 dark:bg-slate-800 text-slate-200'}`}>
                                  {hasPower ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"/></svg> : <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>}
                                </button>
                             </td>
                           );
                         })}
                      </tr>
                    ))}
                 </tbody>
              </table>
           </div>
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
                      <input type="range" min="0" max="40" value={loadPolicies[role]?.baseTarget ?? 28} onChange={e => handleUpdatePolicy(role, 'baseTarget', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none accent-amber-500" />
                   </div>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center">
                         <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Substitution Cap</label>
                         <span className="text-xl font-black text-sky-500 italic">{(loadPolicies[role]?.substitutionCap ?? 5)}P</span>
                      </div>
                      <input type="range" min="0" max="15" value={loadPolicies[role]?.substitutionCap ?? 5} onChange={e => handleUpdatePolicy(role, 'substitutionCap', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none accent-sky-500" />
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
                 <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Document Bricks</h2>
              </div>
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
                {(['CLASS', 'STAFF', 'ROOM', 'MASTER'] as PrintMode[]).map(mode => (
                  <button key={mode} onClick={() => { setSelectedPrintMode(mode); setSelectedElementId(null); }} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${selectedPrintMode === mode ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{mode}</button>
                ))}
              </div>
           </div>

           <div className="grid grid-cols-1 xl:grid-cols-12 gap-12">
              <div className="xl:col-span-4 space-y-8">
                 <div className="space-y-4">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Layout Bricks</p>
                    <button onClick={() => addStaticText('header')} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-[9px] font-black uppercase text-[#001f3f] dark:text-white hover:border-amber-400 transition-all">+ Add Text Brick</button>
                    <button onClick={handleRestoreDefault} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-[9px] font-black uppercase text-rose-500">Restore System Defaults</button>
                 </div>

                 {selectedElement && (
                   <div className="bg-[#001f3f] p-6 rounded-[2rem] space-y-6 shadow-2xl animate-in slide-in-from-left duration-300">
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Brick Stylist</p>
                      <textarea 
                        ref={textAreaRef}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-amber-400 h-20 resize-none" 
                        value={selectedElement.content}
                        onChange={e => updateElementContent(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => moveElement('up')} className="flex-1 p-2 bg-white/10 rounded text-[8px] font-black uppercase text-white">Move Up</button>
                        <button onClick={() => moveElement('down')} className="flex-1 p-2 bg-white/10 rounded text-[8px] font-black uppercase text-white">Move Down</button>
                        <button onClick={() => removeElement(selectedElementId!)} className="flex-1 p-2 bg-rose-500/20 rounded text-[8px] font-black uppercase text-rose-500">Delete</button>
                      </div>
                   </div>
                 )}
              </div>

              <div className="xl:col-span-8 bg-slate-50 dark:bg-slate-950 p-8 rounded-[3rem] shadow-inner overflow-auto min-h-[500px]">
                 <div className="bg-white p-10 shadow-2xl mx-auto" style={{ width: '100%', maxWidth: '800px', minHeight: '600px' }}>
                    {activeTemplate.header.map(el => (
                      <div key={el.id} onClick={() => setSelectedElementId(el.id)} className={`cursor-pointer p-2 border-2 ${selectedElementId === el.id ? 'border-amber-500' : 'border-transparent hover:border-slate-100'}`}>
                         {el.type === 'IMAGE' ? <img src={el.content} className="max-h-20 mx-auto" /> : <div style={{ fontSize: `${el.style.fontSize}px`, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, color: el.style.color }}>{injectPreviewContent(el.content)}</div>}
                      </div>
                    ))}
                    <div className="py-20 text-center text-slate-100 font-black uppercase tracking-[0.8em] italic">Timetable Matrix Zone</div>
                    {activeTemplate.footer.map(el => (
                      <div key={el.id} onClick={() => setSelectedElementId(el.id)} className={`cursor-pointer p-2 border-2 ${selectedElementId === el.id ? 'border-amber-500' : 'border-transparent hover:border-slate-100'}`}>
                         <div style={{ fontSize: `${el.style.fontSize}px`, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, color: el.style.color }}>{injectPreviewContent(el.content)}</div>
                      </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AdminControlCenter;

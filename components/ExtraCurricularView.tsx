
import React, { useState, useMemo } from 'react';
import { SchoolConfig, User, UserRole, ExtraCurricularRule } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { PRIMARY_SLOTS } from '../constants.ts';
import { LayoutGrid, Table, Download, AlertTriangle, CheckCircle, Clock, Calendar, Search, Filter, Save, X, Edit2, Copy, Trash2 } from 'lucide-react';

interface ExtraCurricularViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const ExtraCurricularView: React.FC<ExtraCurricularViewProps> = ({ 
  config, setConfig, users, showToast, isSandbox, addSandboxLog
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<Partial<ExtraCurricularRule>>({
    subject: '',
    teacherId: '',
    room: '',
    sectionIds: [],
    periodsPerWeek: 1,
    restrictedSlots: []
  });

  const teachingStaff = useMemo(() => {
    const nonTeachingRoles = [UserRole.ADMIN, UserRole.ADMIN_STAFF, UserRole.MANAGER, UserRole.PRINCIPAL];
    return users.filter(u => !nonTeachingRoles.includes(u.role as UserRole) && !u.isResigned).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const handleSaveRule = async () => {
    if (!ruleForm.subject || !ruleForm.teacherId || !ruleForm.room || !ruleForm.sectionIds?.length) {
      showToast("All fields are mandatory for Curricular Rules.", "error");
      return;
    }

    const newRule: ExtraCurricularRule = {
      id: editingId || `ec-${generateUUID().substring(0, 8)}`,
      subject: ruleForm.subject!,
      teacherId: ruleForm.teacherId!,
      room: ruleForm.room!,
      sectionIds: ruleForm.sectionIds!,
      periodsPerWeek: Number(ruleForm.periodsPerWeek) || 1,
      restrictedSlots: ruleForm.restrictedSlots
    };

    let updatedRules;
    if (editingId) {
      updatedRules = (config.extraCurricularRules || []).map(r => r.id === editingId ? newRule : r);
    } else {
      updatedRules = [...(config.extraCurricularRules || []), newRule];
    }
    const updatedConfig = { ...config, extraCurricularRules: updatedRules };

    setConfig(updatedConfig);

    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      } catch (err) { console.error("Cloud sync failed for EC Rule"); }
    } else if (isSandbox) {
      addSandboxLog?.('EC_RULE_SAVE', newRule);
    }

    showToast(editingId ? "Rule Updated" : "Curricular Rule Deployed & Load Matrix Synchronized", "success");
    setIsAdding(false);
    setEditingId(null);
    setRuleForm({ subject: '', teacherId: '', room: '', sectionIds: [], periodsPerWeek: 1, restrictedSlots: [] });
  };

  const copyRule = (rule: ExtraCurricularRule) => {
    const newRule: ExtraCurricularRule = {
      ...rule,
      id: `ec-${generateUUID().substring(0, 8)}`,
    };
    const updatedRules = [...(config.extraCurricularRules || []), newRule];
    const updatedConfig = { ...config, extraCurricularRules: updatedRules };
    setConfig(updatedConfig);
    if (IS_CLOUD_ENABLED && !isSandbox) {
      supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
    }
    showToast("Rule Copied", "success");
  };

  const editRule = (rule: ExtraCurricularRule) => {
    setEditingId(rule.id);
    setRuleForm({
      subject: rule.subject,
      teacherId: rule.teacherId,
      room: rule.room,
      sectionIds: [...rule.sectionIds],
      periodsPerWeek: rule.periodsPerWeek,
      restrictedSlots: rule.restrictedSlots ? [...rule.restrictedSlots] : []
    });
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeRule = async (id: string) => {
    const updatedRules = (config.extraCurricularRules || []).filter(r => r.id !== id);
    const updatedConfig = { ...config, extraCurricularRules: updatedRules };
    setConfig(updatedConfig);
    if (IS_CLOUD_ENABLED && !isSandbox) {
       await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig });
    }
    showToast("Rule Removed", "info");
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
        <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">Extra <span className="text-emerald-500">Curricular</span></h1>
        <button onClick={() => {
          if (isAdding) {
            setIsAdding(false);
            setEditingId(null);
            setRuleForm({ subject: '', teacherId: '', room: '', sectionIds: [], periodsPerWeek: 1, restrictedSlots: [] });
          } else {
            setIsAdding(true);
          }
        }} className={`px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all ${isAdding ? 'bg-rose-50 text-rose-600' : 'bg-[#001f3f] text-[#d4af37]'}`}>
          {isAdding ? "Discard Changes" : "Define New Rule"}
        </button>
      </div>

      {isAdding && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in zoom-in duration-300">
           <div className="xl:col-span-4 bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">1. Domain Definition</p>
                 <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.subject} onChange={e => setRuleForm({...ruleForm, subject: e.target.value})}>
                    <option value="">Select Subject (PHE/CEP/Art)...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                 </select>
                 <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.teacherId} onChange={e => setRuleForm({...ruleForm, teacherId: e.target.value})}>
                    <option value="">Assign Specialist Teacher...</option>
                    {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                 </select>
                 <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.room} onChange={e => setRuleForm({...ruleForm, room: e.target.value})}>
                    <option value="">Target Specialized Room...</option>
                    {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                 </select>
              </div>

              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">2. Temporal Frequency</p>
                 <div className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl">
                    <span className="text-[9px] font-black uppercase text-slate-400">Periods / Week per Class</span>
                    <input type="number" min="1" max="5" className="w-20 bg-white dark:bg-slate-900 p-3 rounded-xl text-center font-black text-sm outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.periodsPerWeek} onChange={e => setRuleForm({...ruleForm, periodsPerWeek: parseInt(e.target.value) || 1})} />
                 </div>
              </div>

              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">3. Period Restrictions</p>
                 <div className="flex flex-wrap gap-2 px-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => {
                       const slot = PRIMARY_SLOTS.find(s => s.id === period);
                       const timeLabel = slot ? `(${slot.startTime} - ${slot.endTime})` : '';
                       return (
                       <label key={`rest-${period}`} className="flex items-center gap-1 cursor-pointer">
                          <input 
                             type="checkbox" 
                             className="w-3 h-3 text-rose-500 rounded border-slate-300 focus:ring-rose-500"
                             checked={ruleForm.restrictedSlots?.includes(period) || false}
                             onChange={(e) => {
                                const current = ruleForm.restrictedSlots || [];
                                let updated;
                                if (e.target.checked) {
                                   updated = [...current, period];
                                } else {
                                   updated = current.filter(p => p !== period);
                                }
                                setRuleForm({...ruleForm, restrictedSlots: updated.length > 0 ? updated : undefined});
                             }}
                          />
                          <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{period} <span className="text-[9px] font-normal text-slate-400">{timeLabel}</span></span>
                       </label>
                    )})}
                 </div>
              </div>

              <button onClick={handleSaveRule} className="w-full bg-emerald-600 text-white py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all">
                {editingId ? "Update Rule" : "Authorize Rule"}
              </button>
           </div>

           <div className="xl:col-span-8 bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-6">4. Targeted Sections Cluster</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 scrollbar-hide">
                 {config.sections.sort((a,b) => a.fullName.localeCompare(b.fullName)).map(s => {
                    const isSelected = ruleForm.sectionIds?.includes(s.id);
                    return (
                      <button 
                        key={s.id} 
                        onClick={() => {
                          const current = ruleForm.sectionIds || [];
                          setRuleForm({...ruleForm, sectionIds: isSelected ? current.filter(id => id !== s.id) : [...current, s.id]});
                        }}
                        className={`p-4 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${isSelected ? 'bg-[#001f3f] text-white border-transparent' : 'bg-slate-50 border-transparent text-slate-400'}`}
                      >
                        {s.fullName}
                      </button>
                    );
                 })}
              </div>
           </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
         {(config.extraCurricularRules || []).map(rule => {
            const teacher = users.find(u => u.id === rule.teacherId);
            return (
              <div key={rule.id} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-6 group hover:border-emerald-400 transition-all relative overflow-hidden">
                 <div className="flex justify-between items-start">
                    <div>
                       <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">{rule.subject}</h3>
                       <p className="text-[9px] font-black text-emerald-500 uppercase mt-2">{teacher?.name || 'Faculty Vacant'}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => editRule(rule)} className="p-2 text-sky-500 hover:bg-sky-50 rounded-xl transition-all" title="Edit Rule">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => copyRule(rule)} className="p-2 text-amber-500 hover:bg-amber-50 rounded-xl transition-all" title="Copy Rule">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeRule(rule.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-all" title="Delete Rule">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                 </div>
                 
                 <div className="space-y-4">
                    <div className="flex items-center gap-3">
                       <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100">
                          <p className="text-[9px] font-black uppercase text-slate-500">Room: {rule.room}</p>
                       </div>
                       <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100">
                          <p className="text-[9px] font-black uppercase text-slate-500">{rule.periodsPerWeek}P / Week</p>
                       </div>
                    </div>
                    
                    <div>
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-2">Affected Clusters ({rule.sectionIds.length})</p>
                       <div className="flex flex-wrap gap-1.5">
                          {rule.sectionIds.map(sid => {
                             const s = config.sections.find(sec => sec.id === sid);
                             return <span key={sid} className="px-2 py-0.5 bg-slate-50 dark:bg-slate-800 text-[8px] font-bold text-slate-400 rounded-lg">{s?.fullName}</span>
                          })}
                       </div>
                    </div>
                 </div>

                 <div className="pt-4 border-t border-slate-50 dark:border-slate-800 flex justify-between items-center">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Load Sync:</p>
                    <p className="text-[9px] font-black text-emerald-600 uppercase">+{rule.sectionIds.length * rule.periodsPerWeek} Periods Integrated</p>
                 </div>
              </div>
            );
         })}
      </div>
    </div>
  );
};

export default ExtraCurricularView;

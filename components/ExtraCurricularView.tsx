
import React, { useState, useMemo } from 'react';
import { SchoolConfig, User, UserRole, ExtraCurricularRule, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { PRIMARY_SLOTS } from '../constants.ts';
import { AIService } from '../services/geminiService.ts';
import { LayoutGrid, Table, Download, AlertTriangle, CheckCircle, Clock, Calendar, Search, Filter, Save, X, Edit2, Copy, Trash2, Sparkles } from 'lucide-react';

interface ExtraCurricularViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const ExtraCurricularView: React.FC<ExtraCurricularViewProps> = ({ 
  config, setConfig, users, showToast, assignments, setAssignments, isSandbox, addSandboxLog
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const getRoomUsageStatus = (roomName: string): { status: 'FREE' | 'IN_USE', count: number } => {
    if (!roomName) return { status: 'FREE', count: 0 };
    const usageCount = (config.extraCurricularRules || []).filter(r => r.allocations.some(a => a.room === roomName)).length;
    return { status: usageCount > 0 ? 'IN_USE' : 'FREE', count: usageCount };
  };
  const [ruleForm, setRuleForm] = useState<Partial<ExtraCurricularRule>>({
    title: '',
    heading: '',
    subject: '',
    allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }],
    sectionIds: [],
    periodsPerWeek: 1,
    preferredSlots: [],
    restrictedSlots: [],
    onTrot: false
  });

  const teachingStaff = useMemo(() => {
    const nonTeachingRoles = [UserRole.ADMIN, UserRole.ADMIN_STAFF, UserRole.MANAGER, UserRole.PRINCIPAL];
    return users.filter(u => !nonTeachingRoles.includes(u.role as UserRole) && !u.isResigned).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const handleSaveRule = async () => {
    if (!ruleForm.subject || !ruleForm.allocations?.length || !ruleForm.sectionIds?.length) {
      showToast("Subject, Allocations, and Sections are mandatory.", "error");
      return;
    }

    // Multi-Wing Conflict Detection (10-11 AM)
    const wingIds = new Set<string>();
    for (const sid of ruleForm.sectionIds) {
      const sect = config.sections.find(s => s.id === sid);
      if (sect) wingIds.add(sect.wingId);
    }
    
    if (wingIds.size > 1 && ruleForm.preferredSlots && ruleForm.preferredSlots.length > 0) {
      let hasConflict = false;
      for (const sid of ruleForm.sectionIds) {
        const sect = config.sections.find(s => s.id === sid);
        if (sect) {
          const wing = config.wings.find(w => w.id === sect.wingId);
          const wingSlots = wing ? (config.slotDefinitions?.[wing.sectionType] || PRIMARY_SLOTS) : PRIMARY_SLOTS;
          for (const prefSlotId of ruleForm.preferredSlots) {
            const slotObj = wingSlots.find(s => s.id === prefSlotId);
            if (slotObj && slotObj.startTime < '11:00' && slotObj.endTime > '10:00') {
              hasConflict = true;
              break;
            }
          }
        }
        if (hasConflict) break;
      }
      
      if (hasConflict) {
        showToast("Multi-Wing Conflict: Cannot prefer slots between 10:00 and 11:00 AM for multi-wing rules.", "error");
        return;
      }
    }

    const newRule: ExtraCurricularRule = {
      id: editingId || `ec-${generateUUID().substring(0, 8)}`,
      title: ruleForm.title || '',
      heading: ruleForm.heading || '',
      subject: ruleForm.subject!,
      teacherId: ruleForm.allocations?.[0]?.teacherId || '',
      room: ruleForm.allocations?.[0]?.room || '',
      allocations: ruleForm.allocations!.map(a => ({ ...a, teacherName: users.find(u => u.id === a.teacherId)?.name || 'Unknown' })),
      sectionIds: ruleForm.sectionIds!,
      periodsPerWeek: Number(ruleForm.periodsPerWeek) || 1,
      preferredSlots: ruleForm.preferredSlots,
      restrictedSlots: ruleForm.restrictedSlots,
      onTrot: ruleForm.onTrot
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

    showToast(editingId ? "Rule Updated" : "Curricular Rule Deployed", "success");
    setIsAdding(false);
    setEditingId(null);
    setRuleForm({ subject: '', allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }], sectionIds: [], periodsPerWeek: 1, preferredSlots: [], restrictedSlots: [], onTrot: false });
  };

  const analyzeConflicts = async (rule: ExtraCurricularRule) => {
    showToast("Analyzing conflicts...", "info");
    const prompt = `Analyze conflicts for the following curricular rule: ${JSON.stringify(rule)}. The current timetable is ${JSON.stringify(config.extraCurricularRules)}. Suggest resolutions.`;
    const analysis = await AIService.executeEdge(prompt, "You are a timetable conflict analyst.");
    showToast(analysis || "Analysis complete", "success");
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
      title: rule.title || '',
      heading: rule.heading || '',
      subject: rule.subject,
      allocations: [...(rule.allocations || [])],
      sectionIds: [...(rule.sectionIds || [])],
      periodsPerWeek: rule.periodsPerWeek,
      preferredSlots: rule.preferredSlots ? [...rule.preferredSlots] : [],
      restrictedSlots: rule.restrictedSlots ? [...rule.restrictedSlots] : [],
      onTrot: rule.onTrot
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

  const rulesByGrade = useMemo(() => {
    const grouped: Record<string, ExtraCurricularRule[]> = {};
    const rules = config.extraCurricularRules || [];
    
    // Get all unique grades
    const grades = config.grades || [];
    grades.forEach(g => {
      if (g && g.name) grouped[g.name] = [];
    });
    grouped['Other'] = [];

    rules.forEach(rule => {
      let found = false;
      for (const sid of (rule.sectionIds || [])) {
        const section = (config.sections || []).find(s => s.id === sid);
        if (section) {
          const grade = (config.grades || []).find(g => g.id === section.gradeId);
          if (grade) {
            if (!grouped[grade.name]) grouped[grade.name] = [];
            if (!grouped[grade.name].find(r => r.id === rule.id)) {
              grouped[grade.name].push(rule);
            }
            found = true;
          }
        }
      }
      if (!found) grouped['Other'].push(rule);
    });
    return grouped;
  }, [config.extraCurricularRules, config.sections, config.grades]);

  const [activeGrade, setActiveGrade] = useState<string>(Object.keys(rulesByGrade)[0] || 'Other');

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
        <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">Extra <span className="text-emerald-500">Curricular</span></h1>
        <button onClick={() => {
          if (isAdding) {
            setIsAdding(false);
            setEditingId(null);
            setRuleForm({ title: '', heading: '', subject: '', allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }], sectionIds: [], periodsPerWeek: 1, preferredSlots: [], restrictedSlots: [], onTrot: false });
          } else {
            setIsAdding(true);
          }
        }} className={`px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all ${isAdding ? 'bg-rose-50 text-rose-600' : 'bg-[#001f3f] text-[#d4af37]'}`}>
          {isAdding ? "Discard Changes" : "Define New Rule"}
        </button>
      </div>

      {isAdding ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in zoom-in duration-300">
           <div className="xl:col-span-4 bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">1. Domain Definition</p>
                 <div className="space-y-3">
                    <input 
                      className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" 
                      placeholder="Admin Reference Title..." 
                      value={ruleForm.title} 
                      onChange={e => setRuleForm({...ruleForm, title: e.target.value})} 
                    />
                    <input 
                      className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" 
                      placeholder="Timetable Heading Title..." 
                      value={ruleForm.heading} 
                      onChange={e => setRuleForm({...ruleForm, heading: e.target.value})} 
                    />
                    <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.subject} onChange={e => setRuleForm({...ruleForm, subject: e.target.value})}>
                       <option value="">Select Subject (PHE/CEP/Art)...</option>
                       {(config.subjects || []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                 </div>
              </div>

              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">2. Personnel Allocation</p>
                 <div className="space-y-2">
                    {(ruleForm.allocations || []).map((alloc, idx) => (
                       <div key={idx} className="flex gap-2">
                          <select className="flex-1 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase outline-none" value={alloc.teacherId} onChange={e => {
                             const next = [...(ruleForm.allocations || [])];
                             next[idx] = { ...next[idx], teacherId: e.target.value };
                             setRuleForm({...ruleForm, allocations: next});
                          }}>
                             <option value="">Teacher...</option>
                             {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                          <select className="flex-1 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase outline-none" value={alloc.subject} onChange={e => {
                             const next = [...(ruleForm.allocations || [])];
                             next[idx] = { ...next[idx], subject: e.target.value };
                             setRuleForm({...ruleForm, allocations: next});
                          }}>
                             <option value="">Subject...</option>
                             {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                          <select className="w-24 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[9px] font-black uppercase outline-none" value={alloc.room || ''} onChange={e => {
                             const next = [...(ruleForm.allocations || [])];
                             next[idx] = { ...next[idx], room: e.target.value };
                             setRuleForm({...ruleForm, allocations: next});
                          }}>
                             <option value="">Room...</option>
                             {(config.rooms || []).filter(r => {
                               const constraint = config.resourceConstraints?.find(c => c.resourceName === r);
                               if (!constraint) return true;
                               if (constraint.allowedGradeIds.length === 0 && constraint.allowedWingIds.length === 0) return true;
                               if (!ruleForm.sectionIds || ruleForm.sectionIds.length === 0) return true;
                               return ruleForm.sectionIds.some(secId => {
                                 const targetSec = config.sections.find(s => s.id === secId);
                                 if (!targetSec) return false;
                                 return constraint.allowedGradeIds.includes(targetSec.gradeId) || 
                                        constraint.allowedWingIds.includes(targetSec.wingId);
                               });
                             }).map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button onClick={() => setRuleForm(prev => ({ ...prev, allocations: prev.allocations?.filter((_, i) => i !== idx) }))} className="text-rose-500 p-2">×</button>
                       </div>
                    ))}
                    <button onClick={() => setRuleForm(prev => ({ ...prev, allocations: [...(prev.allocations || []), { teacherId: '', teacherName: '', subject: '', room: '' }] }))} className="text-[9px] font-black text-sky-600 uppercase">+ Add Personnel</button>
                 </div>
              </div>

              <div className="space-y-4">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">3. Temporal Frequency</p>
                 <div className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl">
                    <span className="text-[9px] font-black uppercase text-slate-400">Periods / Week per Class</span>
                    <input type="number" min="1" max="5" className="w-20 bg-white dark:bg-slate-900 p-3 rounded-xl text-center font-black text-sm outline-none border-2 border-transparent focus:border-emerald-400" value={ruleForm.periodsPerWeek} onChange={e => setRuleForm({...ruleForm, periodsPerWeek: parseInt(e.target.value) || 1})} />
                 </div>
                 <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={ruleForm.onTrot || false} onChange={e => setRuleForm({...ruleForm, onTrot: e.target.checked})} />
                    <span className="text-[9px] font-black uppercase text-slate-400">On Trot</span>
                 </label>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">4. Slot Preferences</p>
                <div className="flex flex-wrap gap-3">
                   {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => {
                      const slot = PRIMARY_SLOTS.find(s => s.id === period);
                      return (
                         <label key={`pref-${period}`} className="flex items-center gap-2 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer hover:border-emerald-400 transition-all min-w-[70px]">
                            <input type="checkbox" className="w-3 h-3 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" checked={ruleForm.preferredSlots?.includes(period) || false} onChange={e => {
                               const current = ruleForm.preferredSlots || [];
                               setRuleForm({...ruleForm, preferredSlots: e.target.checked ? [...current, period] : current.filter(p => p !== period)});
                            }} />
                            <div className="flex flex-col leading-tight">
                               <span className="text-[9px] font-black text-slate-700 dark:text-slate-200 uppercase">Slot {period}</span>
                               {slot && <span className="text-[7px] font-bold text-slate-400">{slot.startTime}-{slot.endTime}</span>}
                            </div>
                         </label>
                      );
                   })}
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">5. Restricted Periods</p>
                <div className="flex flex-wrap gap-3">
                   {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => {
                      const slot = PRIMARY_SLOTS.find(s => s.id === period);
                      return (
                         <label key={`rest-${period}`} className="flex items-center gap-2 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer hover:border-rose-400 transition-all min-w-[70px]">
                            <input type="checkbox" className="w-3 h-3 rounded border-slate-300 text-rose-600 focus:ring-rose-500" checked={ruleForm.restrictedSlots?.includes(period) || false} onChange={e => {
                               const current = ruleForm.restrictedSlots || [];
                               setRuleForm({...ruleForm, restrictedSlots: e.target.checked ? [...current, period] : current.filter(p => p !== period)});
                            }} />
                            <div className="flex flex-col leading-tight">
                               <span className="text-[9px] font-black text-slate-700 dark:text-slate-200 uppercase">Slot {period}</span>
                               {slot && <span className="text-[7px] font-bold text-slate-400">{slot.startTime}-{slot.endTime}</span>}
                            </div>
                         </label>
                      );
                   })}
                </div>
              </div>

              <button onClick={handleSaveRule} className="w-full bg-emerald-600 text-white py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all">
                {editingId ? "Update Rule" : "Authorize Rule"}
              </button>
           </div>

           <div className="xl:col-span-8 bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-6">4. Targeted Sections Cluster</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 scrollbar-hide">
                 {(config.sections || []).slice().sort((a,b) => a.fullName.localeCompare(b.fullName)).map(s => {
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
      ) : (
        <div className="space-y-6">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {Object.keys(rulesByGrade).map(grade => (
              <button 
                key={grade}
                onClick={() => setActiveGrade(grade)}
                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeGrade === grade ? 'bg-[#001f3f] text-white' : 'bg-white dark:bg-slate-900 text-slate-400 hover:bg-slate-50'}`}
              >
                {grade}
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
             {(rulesByGrade[activeGrade] || []).map(rule => {
                const teacher = users.find(u => u.id === rule.teacherId);
                return (
                  <div key={rule.id} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-6 group hover:border-emerald-400 transition-all relative overflow-hidden">
                     <div className="flex justify-between items-start">
                        <div>
                           <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter">{rule.title || rule.subject}</h3>
                           <p className="text-[9px] font-black text-emerald-500 uppercase mt-2">{rule.heading || 'No Heading Set'}</p>
                           <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">{teacher?.name || 'Faculty Vacant'}</p>
                        </div>
                         <div className="flex gap-1">
                           <button onClick={() => analyzeConflicts(rule)} className="p-2 text-indigo-500 hover:bg-indigo-50 rounded-xl transition-all" title="AI Conflict Analysis">
                             <Sparkles className="w-4 h-4" />
                           </button>
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
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-2">Personnel Deployment</p>
                        <div className="flex flex-wrap gap-2">
                           {(rule.allocations || []).map((a, i) => (
                             <div key={i} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">{a.teacherName?.split(' ')[0]} • {a.subject} • {a.room}</p>
                             </div>
                           ))}
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
      )}
    </div>
  );
};

export default ExtraCurricularView;

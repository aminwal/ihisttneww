
import React, { useState, useMemo } from 'react';
import { SchoolConfig, CombinedBlock, User, UserRole, TimeTableEntry, SchoolGrade, SchoolSection, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface CombinedBlockViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const CombinedBlockView: React.FC<CombinedBlockViewProps> = ({ 
  config, setConfig, users, timetable, setTimetable, currentUser, showToast, 
  assignments, setAssignments, isSandbox, addSandboxLog
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  
  const [newBlock, setNewBlock] = useState<Partial<CombinedBlock>>({
    title: '',
    heading: '',
    gradeId: '',
    sectionIds: [],
    weeklyPeriods: 1,
    allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }]
  });

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const teachingStaff = useMemo(() => users.filter(u => u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF && !u.isResigned).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const getRoomUsageStatus = (roomName: string): { status: 'FREE' | 'IN_USE', count: number } => {
    if (!roomName) return { status: 'FREE', count: 0 };
    const usageCount = timetable.filter(t => t.room === roomName && !t.isSubstitution).length;
    return { status: usageCount > 0 ? 'IN_USE' : 'FREE', count: usageCount };
  };

  const handleSaveBlock = async () => {
    if (!newBlock.title?.trim() || !newBlock.heading?.trim() || !newBlock.gradeId || !newBlock.sectionIds?.length) {
      showToast("Admin Title, Public Heading, Grade, and Sections are mandatory.", "error");
      return;
    }

    const weeklyPeriods = Number(newBlock.weeklyPeriods) || 1;

    const block: CombinedBlock = {
      id: editingBlockId || `block-${generateUUID()}`,
      title: newBlock.title!,
      heading: newBlock.heading!,
      gradeId: newBlock.gradeId!,
      sectionIds: newBlock.sectionIds!,
      weeklyPeriods: weeklyPeriods,
      allocations: newBlock.allocations!.map(a => ({ ...a, teacherName: users.find(u => u.id === a.teacherId)?.name || 'Unknown' }))
    };

    const updatedBlocks = editingBlockId 
      ? (config.combinedBlocks || []).map(b => b.id === editingBlockId ? block : b) 
      : [...(config.combinedBlocks || []), block];

    const updatedConfig = { 
      ...config, 
      combinedBlocks: updatedBlocks
    };
    
    setConfig(updatedConfig);
    
    // WORKLOAD RECONCILIATION LOGIC
    const teacherIdsInBlock = block.allocations.map(a => a.teacherId);
    let newAssignments = [...assignments];

    for (const teacherId of teacherIdsInBlock) {
      if (!teacherId) continue;
      const totalGroupPeriods = updatedBlocks
        .filter(b => b.gradeId === block.gradeId && b.allocations.some(a => a.teacherId === teacherId))
        .reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);

      const existingAsgnIdx = newAssignments.findIndex(a => a.teacherId === teacherId && a.gradeId === block.gradeId);
      if (existingAsgnIdx !== -1) {
        newAssignments[existingAsgnIdx] = { ...newAssignments[existingAsgnIdx], groupPeriods: totalGroupPeriods };
      } else {
        newAssignments.push({ id: generateUUID(), teacherId, gradeId: block.gradeId, loads: [], targetSectionIds: block.sectionIds, groupPeriods: totalGroupPeriods });
      }
    }

    setAssignments(newAssignments);

    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
        for (const teacherId of teacherIdsInBlock) {
          const asgn = newAssignments.find(a => a.teacherId === teacherId && a.gradeId === block.gradeId);
          if (asgn) {
            await supabase.from('teacher_assignments').upsert({ 
              id: asgn.id, 
              teacher_id: asgn.teacherId, 
              grade_id: asgn.gradeId, 
              loads: asgn.loads, 
              target_section_ids: asgn.targetSectionIds, 
              group_periods: asgn.groupPeriods 
            }, { onConflict: 'teacher_id, grade_id' });
          }
        }
      } catch (err) { console.error("Cloud block sync failed"); }
    } else if (isSandbox) {
      addSandboxLog?.('BLOCK_TEMPLATE_SAVE', { block, updatedConfig });
    }

    showToast(editingBlockId ? "Template & Load Matrix Updated" : "Subject Pool & Load Matrix Deployed", "success");
    setIsAdding(false);
    setEditingBlockId(null);
    setNewBlock({ title: '', heading: '', gradeId: '', sectionIds: [], weeklyPeriods: 1, allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }] });
  };

  const startEditing = (block: CombinedBlock) => {
    setEditingBlockId(block.id);
    setNewBlock({ ...block });
    setIsAdding(true);
  };

  const blocksByGrade = useMemo(() => {
    const grouped: Record<string, CombinedBlock[]> = {};
    (config.combinedBlocks || []).forEach(b => {
      if (!grouped[b.gradeId]) grouped[b.gradeId] = [];
      grouped[b.gradeId].push(b);
    });
    return grouped;
  }, [config.combinedBlocks]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
        <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">Subject Pool <span className="text-[#d4af37]">Templates</span></h1>
        <button onClick={() => setIsAdding(!isAdding)} className={`px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all ${isAdding ? 'bg-rose-50 text-rose-600' : 'bg-[#001f3f] text-[#d4af37]'}`}>
          {isAdding ? "Discard Changes" : "Build New Pool"}
        </button>
      </div>

      {isAdding && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          <div className="xl:col-span-4 space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">1. Identity Protocols</p>
                  <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-amber-400" value={newBlock.gradeId} onChange={e => setNewBlock({...newBlock, gradeId: e.target.value, sectionIds: []})}>
                    <option value="">Target Grade...</option>
                    {(config.grades || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Admin Reference (Title)</label>
                     <input placeholder="e.g. Grade 9 Lang-2 Pool" className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-bold text-xs outline-none" value={newBlock.title} onChange={e => setNewBlock({...newBlock, title: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-amber-500 uppercase tracking-widest ml-4">Public Timetable Display (Heading)</label>
                     <input placeholder="e.g. Arabic / Urdu / French" className="w-full p-5 bg-amber-50/30 dark:bg-amber-900/10 border border-amber-100 rounded-3xl font-black text-xs uppercase outline-none" value={newBlock.heading} onChange={e => setNewBlock({...newBlock, heading: e.target.value.toUpperCase()})} />
                  </div>
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">2. Involved Sections</p>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
                    {(config.sections || []).filter(s => {
                       if (!newBlock.gradeId) return false;
                       // Core Cross-Wing logic: Match sections if their Grade Name matches the selected Grade Name
                       const selectedGradeName = config.grades?.find(g => g.id === newBlock.gradeId)?.name;
                       const targetGradeIds = config.grades?.filter(g => g.name === selectedGradeName).map(g => g.id) || [];
                       return targetGradeIds.includes(s.gradeId);
                    }).map(sect => {
                      const wingName = config.wings?.find(w => w.id === sect.wingId)?.name || '';
                      return (
                      <button key={sect.id} onClick={() => {
                        const current = newBlock.sectionIds || [];
                        setNewBlock({...newBlock, sectionIds: current.includes(sect.id) ? current.filter(id => id !== sect.id) : [...current, sect.id]});
                      }} className={`p-3 rounded-2xl text-[10px] font-black uppercase border-2 transition-all flex flex-col items-center justify-center gap-1 ${newBlock.sectionIds?.includes(sect.id) ? 'bg-[#001f3f] text-white border-transparent' : 'bg-slate-50 border-transparent text-slate-400'}`}>
                        <span>{sect.fullName}</span>
                        <span className={`text-[7px] ${newBlock.sectionIds?.includes(sect.id) ? 'text-amber-400' : 'text-slate-400'} opacity-80 leading-none text-center`}>{wingName}</span>
                      </button>
                    )})}
                  </div>
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">3. Temporal Frequency</p>
                  <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700">
                     <span className="text-[9px] font-black uppercase text-slate-400">Periods / Week</span>
                     <input 
                        type="number" 
                        min="1" 
                        max="35" 
                        className="flex-1 bg-white dark:bg-slate-900 p-3 rounded-xl text-center font-black text-sm border-2 border-transparent focus:border-amber-400 outline-none" 
                        value={newBlock.weeklyPeriods} 
                        onChange={e => setNewBlock({...newBlock, weeklyPeriods: parseInt(e.target.value) || 0})} 
                     />
                  </div>
               </div>
            </div>
            <button onClick={handleSaveBlock} className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 hover:text-white transition-all">Authorize Template</button>
          </div>

          <div className="xl:col-span-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 h-full">
               <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">Parallel Personnel Allocation</h3>
                  <button onClick={() => setNewBlock(prev => ({ ...prev, allocations: [...(prev.allocations || []), { teacherId: '', teacherName: '', subject: '', room: '' }] }))} className="bg-sky-50 text-sky-600 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase border border-sky-100">+ Add Personnel</button>
               </div>
               <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-hide">
                  {(newBlock.allocations || []).map((alloc, idx) => {
                    const usage = getRoomUsageStatus(alloc.room || '');
                    return (
                      <div key={idx} className="p-6 rounded-3xl bg-slate-50/50 dark:bg-slate-800/30 border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
                         <select className="flex-1 p-4 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none" value={alloc.teacherId} onChange={e => {
                           const next = [...(newBlock.allocations || [])];
                           next[idx] = { ...next[idx], teacherId: e.target.value };
                           setNewBlock({...newBlock, allocations: next});
                         }}>
                            <option value="">Faculty Staff...</option>
                            {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                         </select>
                         <select 
                            className="flex-1 p-4 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none border-2 border-transparent focus:border-amber-400" 
                            value={alloc.subject} 
                            onChange={e => {
                              const next = [...(newBlock.allocations || [])];
                              next[idx] = { ...next[idx], subject: e.target.value };
                              setNewBlock({...newBlock, allocations: next});
                            }}
                         >
                            <option value="">Subject...</option>
                            {(config.subjects || []).map(s => (
                              <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                         </select>
                         <div className="relative flex-1">
                            <select className={`w-full p-4 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none border-2 ${usage.status === 'IN_USE' ? 'border-amber-400' : 'border-transparent'}`} value={alloc.room} onChange={e => {
                              const next = [...(newBlock.allocations || [])];
                              next[idx] = { ...next[idx], room: e.target.value };
                              setNewBlock({...newBlock, allocations: next});
                            }}>
                               <option value="">Room...</option>
                               {(config.rooms || []).map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            {usage.status === 'IN_USE' && (
                              <div className="absolute -top-3 -right-2 px-2 py-0.5 bg-amber-500 text-white text-[7px] font-black rounded uppercase shadow-md">Used: {usage.count} Classes</div>
                            )}
                         </div>
                         <button onClick={() => setNewBlock(prev => ({ ...prev, allocations: prev.allocations?.filter((_, i) => i !== idx) }))} className="text-rose-500 p-3 hover:bg-rose-50 rounded-xl transition-all">×</button>
                      </div>
                    );
                  })}
               </div>
            </div>
          </div>
        </div>
      )}

      {!isAdding && (
        <div className="space-y-12">
          {(config.grades || []).map(grade => {
            const gradeBlocks = blocksByGrade[grade.id] || [];
            if (gradeBlocks.length === 0) return null;
            return (
              <div key={grade.id} className="space-y-6">
                <div className="flex items-center gap-4 px-4">
                   <h2 className="text-lg font-black text-[#001f3f] dark:text-amber-400 uppercase tracking-[0.4em]">{grade.name} Pools</h2>
                   <div className="flex-1 h-[1px] bg-slate-100 dark:bg-slate-800"></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
                  {gradeBlocks.map(block => (
                    <div key={block.id} className="group bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 hover:border-amber-400 transition-all relative overflow-hidden">
                       <div className="relative z-10 space-y-6">
                          <div className="flex justify-between items-start">
                             <div>
                                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{block.title}</h4>
                                <p className="text-[8px] font-black text-amber-500 uppercase tracking-[0.2em] mt-2 italic">Heading: {block.heading}</p>
                                <div className="flex items-center gap-2 mt-2">
                                   <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{block.sectionIds.length} Sections Integrated</p>
                                   <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                   <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">{block.weeklyPeriods} Periods / Week</p>
                                </div>
                             </div>
                             <div className="flex gap-2">
                                <button onClick={() => startEditing(block)} className="p-2 text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                                <button onClick={async () => {
                                   if(confirm("Dismantle this pool? Timetable entries linked to this ID will lose their block association.")) {
                                      const updated = { ...config, combinedBlocks: (config.combinedBlocks || []).filter(b => b.id !== block.id) };
                                      setConfig(updated);
                                      if (IS_CLOUD_ENABLED && !isSandbox) await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updated });
                                      else if (isSandbox) addSandboxLog?.('BLOCK_PURGE', { id: block.id });
                                      showToast("Pool Dismantled", "info");
                                   }
                                }} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                             </div>
                          </div>
                          <div className="space-y-3">
                             <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Personnel Deployment</p>
                             <div className="flex flex-wrap gap-2">
                                {block.allocations.map((a, i) => (
                                  <div key={i} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                     <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">{a.teacherName.split(' ')[0]} • {a.subject}</p>
                                  </div>
                                ))}
                             </div>
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CombinedBlockView;


import React, { useState, useMemo } from 'react';
import { SchoolConfig, CombinedBlock, User, UserRole, TimeTableEntry, SchoolGrade, SchoolSection } from '../types.ts';
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
}

const CombinedBlockView: React.FC<CombinedBlockViewProps> = ({ config, setConfig, users, timetable, setTimetable, currentUser, showToast }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  
  const [newBlock, setNewBlock] = useState<Partial<CombinedBlock>>({
    title: '',
    heading: '',
    gradeId: '',
    sectionIds: [],
    allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }]
  });

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const teachingStaff = useMemo(() => users.filter(u => u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF && !u.isResigned).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  // IDEAS 2: Room Heatmap Helper
  const getRoomUsageStatus = (roomName: string): { status: 'FREE' | 'IN_USE', count: number } => {
    if (!roomName) return { status: 'FREE', count: 0 };
    const usageCount = timetable.filter(t => t.room === roomName && !t.isSubstitution).length;
    return { status: usageCount > 0 ? 'IN_USE' : 'FREE', count: usageCount };
  };

  const handleSaveBlock = async () => {
    if (!newBlock.title?.trim() || !newBlock.gradeId || !newBlock.sectionIds?.length) {
      showToast("Grade, Identity, and Sections are mandatory.", "error");
      return;
    }

    const block: CombinedBlock = {
      id: editingBlockId || `block-${generateUUID()}`,
      title: newBlock.title!,
      heading: newBlock.heading || newBlock.title!,
      gradeId: newBlock.gradeId!,
      sectionIds: newBlock.sectionIds!,
      allocations: newBlock.allocations!.map(a => ({ ...a, teacherName: users.find(u => u.id === a.teacherId)?.name || 'Unknown' }))
    };

    const updatedConfig = { ...config, combinedBlocks: editingBlockId ? config.combinedBlocks.map(b => b.id === editingBlockId ? block : b) : [...config.combinedBlocks, block] };
    setConfig(updatedConfig);
    
    if (IS_CLOUD_ENABLED) {
      await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
    }

    showToast(editingBlockId ? "Template Updated" : "Subject Pool Deployed", "success");
    setIsAdding(false);
    setEditingBlockId(null);
    setNewBlock({ title: '', heading: '', gradeId: '', sectionIds: [], allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }] });
  };

  const startEditing = (block: CombinedBlock) => {
    setEditingBlockId(block.id);
    setNewBlock({ ...block });
    setIsAdding(true);
  };

  // IDEA 1: Group Templates by Grade
  const blocksByGrade = useMemo(() => {
    const grouped: Record<string, CombinedBlock[]> = {};
    config.combinedBlocks.forEach(b => {
      if (!grouped[b.gradeId]) grouped[b.gradeId] = [];
      grouped[b.gradeId].push(b);
    });
    return grouped;
  }, [config.combinedBlocks]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-24">
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
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">1. Pool Scope</p>
                  <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none border-2 border-transparent focus:border-amber-400" value={newBlock.gradeId} onChange={e => setNewBlock({...newBlock, gradeId: e.target.value, sectionIds: []})}>
                    <option value="">Target Grade...</option>
                    {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <input placeholder="Pool Title (e.g. Arabic Group)" className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase outline-none" value={newBlock.title} onChange={e => setNewBlock({...newBlock, title: e.target.value})} />
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">2. Involved Sections</p>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
                    {config.sections.filter(s => s.gradeId === newBlock.gradeId).map(sect => (
                      <button key={sect.id} onClick={() => {
                        const current = newBlock.sectionIds || [];
                        setNewBlock({...newBlock, sectionIds: current.includes(sect.id) ? current.filter(id => id !== sect.id) : [...current, sect.id]});
                      }} className={`p-4 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${newBlock.sectionIds?.includes(sect.id) ? 'bg-[#001f3f] text-white border-transparent' : 'bg-slate-50 border-transparent text-slate-400'}`}>
                        {sect.name}
                      </button>
                    ))}
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
                         <input placeholder="Subject" className="flex-1 p-4 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none" value={alloc.subject} onChange={e => {
                           const next = [...(newBlock.allocations || [])];
                           next[idx] = { ...next[idx], subject: e.target.value };
                           setNewBlock({...newBlock, allocations: next});
                         }} />
                         <div className="relative flex-1">
                            <select className={`w-full p-4 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none border-2 ${usage.status === 'IN_USE' ? 'border-amber-400' : 'border-transparent'}`} value={alloc.room} onChange={e => {
                              const next = [...(newBlock.allocations || [])];
                              next[idx] = { ...next[idx], room: e.target.value };
                              setNewBlock({...newBlock, allocations: next});
                            }}>
                               <option value="">Room...</option>
                               {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            {/* IDEA 2: Heatmap Visual Indicator */}
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
          {config.grades.map(grade => {
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
                    <div key={block.id} className="group bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-xl border border-slate-100 dark:border-slate-800 relative overflow-hidden transition-all hover:-translate-y-2">
                      <button onClick={() => startEditing(block)} className="absolute top-6 right-6 p-3 bg-[#001f3f] text-[#d4af37] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">Modify</button>
                      <div className="space-y-6">
                        <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{block.title}</h3>
                        <div className="flex flex-wrap gap-2">
                          {block.sectionIds.map(sid => {
                            const s = config.sections.find(sect => sect.id === sid);
                            return <span key={sid} className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 text-[9px] font-black uppercase tracking-tight">{s?.fullName || 'Unknown'}</span>;
                          })}
                        </div>
                        <div className="pt-6 border-t border-slate-50 space-y-3">
                          <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Active Matrix</p>
                          {block.allocations.map((a, i) => (
                            <div key={i} className="flex justify-between items-center text-[10px] font-bold">
                               <span className="text-slate-600 dark:text-slate-300 uppercase">{a.teacherName}</span>
                               <span className="text-emerald-600 italic uppercase">{a.room}</span>
                            </div>
                          ))}
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

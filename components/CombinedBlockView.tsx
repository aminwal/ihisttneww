import React, { useState, useMemo } from 'react';
import { SchoolConfig, CombinedBlock, User, UserRole, Subject, TimeTableEntry, SubjectCategory } from '../types.ts';
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
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [activeSlotIdx, setActiveSlotIdx] = useState<number>(0);
  
  const [newBlock, setNewBlock] = useState<Partial<CombinedBlock>>({
    name: '',
    sectionNames: [],
    allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }]
  });

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const blocks = config?.combinedBlocks || [];
  const rooms = config?.rooms || [];
  const subjects = config?.subjects || [];

  const teachingStaff = useMemo(() => 
    users.filter(u => u.role !== UserRole.ADMIN && !u.role.startsWith('ADMIN_STAFF') && !u.isResigned)
    .sort((a, b) => a.name.localeCompare(b.name)), 
  [users]);

  const availableRooms = rooms;
  const availableSubjects = [...subjects].sort((a, b) => a.name.localeCompare(b.name));

  const syncConfiguration = async (updatedConfig: SchoolConfig) => {
    if (!IS_CLOUD_ENABLED) return;
    setIsSyncing(true);
    try {
      const { error } = await supabase
        .from('school_config')
        .upsert({ 
          id: 'primary_config', 
          config_data: updatedConfig,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      
      if (error) throw error;
    } catch (err: any) {
      console.error("IHIS Config Sync Error:", err);
      showToast("Cloud Sync Failed: " + err.message, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddSlot = () => {
    const nextIdx = (newBlock.allocations?.length || 0);
    setNewBlock(prev => ({
      ...prev,
      allocations: [
        ...(prev.allocations || []),
        { teacherId: '', teacherName: '', subject: '', room: '' }
      ]
    }));
    setActiveSlotIdx(nextIdx);
  };

  const removeSlot = (index: number) => {
    setNewBlock(prev => {
      const filtered = (prev.allocations || []).filter((_, i) => i !== index);
      return { ...prev, allocations: filtered.length > 0 ? filtered : [{ teacherId: '', teacherName: '', subject: '', room: '' }] };
    });
    if (activeSlotIdx === index) setActiveSlotIdx(0);
  };

  const updateSlotField = (index: number, field: string, value: string) => {
    setNewBlock(prev => {
      const next = [...(prev.allocations || [])];
      const teacher = users.find(u => u.id === value);
      next[index] = { 
        ...next[index], 
        [field]: value,
        ...(field === 'teacherId' ? { teacherName: teacher?.name || '' } : {})
      };
      return { ...prev, allocations: next };
    });
  };

  const validateBlock = () => {
    if (!newBlock.name?.trim()) return "Group Title is required.";
    if (!newBlock.sectionNames?.length) return "Target Sections must be assigned.";
    const incomplete = newBlock.allocations?.some(a => !a.teacherId || !a.subject || !a.room);
    if (incomplete) return "All Staff Allocation fields (Teacher/Subject/Room) are mandatory.";
    return null;
  };

  const startEditing = (block: CombinedBlock) => {
    setEditingBlockId(block.id);
    setNewBlock({
      name: block.name,
      sectionNames: [...block.sectionNames],
      allocations: block.allocations.map(a => ({ ...a }))
    });
    setIsAdding(true);
    setActiveSlotIdx(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDuplicateBlock = async (block: CombinedBlock) => {
    const duplicatedBlock: CombinedBlock = {
      ...block,
      id: `block-${generateUUID()}`,
      name: `${block.name} (Copy)`
    };

    const updatedConfig = {
      ...config,
      combinedBlocks: [...blocks, duplicatedBlock]
    };

    setConfig(updatedConfig);
    await syncConfiguration(updatedConfig);
    showToast(`Matrix "${block.name}" duplicated.`, "success");
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingBlockId(null);
    setNewBlock({ name: '', sectionNames: [], allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }] });
  };

  const handleSaveBlock = async () => {
    const error = validateBlock();
    if (error) {
      showToast(error, "error");
      return;
    }

    const block: CombinedBlock = {
      id: editingBlockId || `block-${generateUUID()}`,
      name: newBlock.name!,
      sectionNames: newBlock.sectionNames!,
      allocations: newBlock.allocations!.map(a => ({
        ...a,
        teacherName: users.find(u => u.id === a.teacherId)?.name || 'Unknown'
      }))
    };

    let updatedConfig: SchoolConfig;
    if (editingBlockId) {
      updatedConfig = {
        ...config,
        combinedBlocks: blocks.map(b => b.id === editingBlockId ? block : b)
      };

      const updatedTimetable = timetable.map(t => {
        if (t.blockId === editingBlockId) {
          return {
            ...t,
            subject: block.name,
            blockName: block.name,
            room: block.allocations.map(a => a.room).filter(Boolean).join(', ')
          };
        }
        return t;
      });
      setTimetable(updatedTimetable);
    } else {
      updatedConfig = {
        ...config,
        combinedBlocks: [...blocks, block]
      };
    }

    setConfig(updatedConfig);
    await syncConfiguration(updatedConfig);
    showToast(editingBlockId ? "Matrix Registry Updated" : "Subject Group Deployed", "success");
    resetForm();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase leading-none">
            Parallel Matrix <span className="text-[#d4af37]">Builder</span>
          </h1>
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.6em] flex items-center gap-2">
            <span className="w-8 h-[1px] bg-slate-200"></span> Institutional Group Control
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => isAdding ? resetForm() : setIsAdding(true)}
            className={`flex items-center gap-3 px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all border-2 active:scale-95 group ${
              isAdding 
              ? 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100' 
              : 'bg-[#001f3f] text-[#d4af37] border-white/10 hover:bg-slate-950'
            }`}
          >
            {isAdding ? "Discard Changes" : "Construct New Block"}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in zoom-in-95 duration-500">
          <div className="xl:col-span-4 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-10">
              <div className="space-y-2">
                <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">1. Registry Identity</h3>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{editingBlockId ? 'Updating existing definition' : 'Identify the parallel period cluster'}</p>
              </div>
              <div className="space-y-6">
                <input 
                  placeholder="Matrix Title (e.g. Gr XI 2nd Language)"
                  className="w-full px-8 py-5 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent focus:border-[#d4af37] rounded-3xl font-black text-sm dark:text-white shadow-inner outline-none transition-all"
                  value={newBlock.name}
                  onChange={e => setNewBlock({...newBlock, name: e.target.value})}
                />
                <div className="space-y-3">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Section Mapping</p>
                   <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide bg-slate-50/50 dark:bg-slate-950/30 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
                     {(config?.classes || []).map(cls => (
                       <button 
                         key={cls.id}
                         onClick={() => {
                           const current = newBlock.sectionNames || [];
                           const next = current.includes(cls.name) ? current.filter(n => n !== cls.name) : [...current, cls.name];
                           setNewBlock({...newBlock, sectionNames: next});
                         }}
                         className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase border-2 transition-all text-left ${
                           newBlock.sectionNames?.includes(cls.name) 
                           ? 'bg-[#001f3f] text-white border-transparent shadow-lg' 
                           : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
                         }`}
                       >
                         {cls.name}
                       </button>
                     ))}
                   </div>
                </div>
              </div>
            </div>
            <button 
              onClick={handleSaveBlock}
              className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-[#001f3f] hover:text-white transition-all active:scale-95"
            >
              {editingBlockId ? 'Update Matrix Registry' : 'Commit Matrix Definition'}
            </button>
          </div>

          <div className="xl:col-span-8 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 h-full">
               <div className="flex items-center justify-between mb-8">
                  <div className="space-y-1">
                    <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">2. Functional Personnel</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Map staff to parallel instructional units</p>
                  </div>
                  <button onClick={handleAddSlot} className="bg-sky-50 dark:bg-sky-950 text-sky-600 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase border border-sky-100 dark:border-sky-900 transition-all active:scale-95">+ Add Personnel Slot</button>
               </div>
               <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-hide">
                  {(newBlock.allocations || []).map((alloc, idx) => (
                    <div key={idx} className={`p-6 rounded-3xl border-2 flex flex-col md:flex-row gap-4 items-center transition-all ${activeSlotIdx === idx ? 'border-[#d4af37] bg-amber-50/20 shadow-md' : 'border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:border-slate-200'}`} onClick={() => setActiveSlotIdx(idx)}>
                       <div className="flex-1 w-full space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Faculty Staff</label>
                          <select className="w-full px-4 py-3 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none shadow-sm" value={alloc.teacherId} onChange={e => updateSlotField(idx, 'teacherId', e.target.value)}>
                             <option value="">Personnel...</option>
                             {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                       </div>
                       <div className="flex-1 w-full space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Instructional Unit</label>
                          <select className="w-full px-4 py-3 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none shadow-sm" value={alloc.subject} onChange={e => updateSlotField(idx, 'subject', e.target.value)}>
                             <option value="">Subject...</option>
                             {availableSubjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                       </div>
                       <div className="flex-1 w-full space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Designated Location</label>
                          <select className="w-full px-4 py-3 bg-white dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none shadow-sm" value={alloc.room} onChange={e => updateSlotField(idx, 'room', e.target.value)}>
                             <option value="">Room...</option>
                             {availableRooms.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                       </div>
                       <button onClick={(e) => { e.stopPropagation(); removeSlot(idx); }} className="mt-4 md:mt-0 text-rose-500 p-3 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-xl transition-colors self-end md:self-center"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Registry Grid */}
      {!isAdding && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8 px-2">
          {blocks.map(block => (
            <div key={block.id} className="group relative bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-xl border border-slate-100 dark:border-slate-800 transition-all hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.1)] hover:-translate-y-2 overflow-hidden">
              <div className="absolute top-4 right-4 z-[50] opacity-0 group-hover:opacity-100 transition-all duration-300 flex gap-2">
                {isAdmin && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDuplicateBlock(block); }}
                    className="w-10 h-10 bg-sky-600 text-white rounded-xl flex items-center justify-center hover:bg-sky-700 transition-all shadow-xl hover:scale-110 active:scale-95"
                    title="Duplicate Matrix"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); startEditing(block); }}
                  className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center hover:bg-slate-950 transition-all shadow-xl hover:scale-110 active:scale-95"
                  title="Modify Group Definition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
              </div>

              <div className="relative z-10 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                     <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></div>
                     <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter truncate pr-10">{block.name}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(block.sectionNames || []).map(name => (
                      <span key={name} className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-800/60 text-[9px] font-black uppercase tracking-tight">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pt-8 border-t border-slate-50 dark:border-slate-800/50">
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-4">Functional Personnel</p>
                  {(block.allocations || []).map((alloc, idx) => (
                    <div key={idx} className="bg-slate-50/50 dark:bg-slate-800/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col gap-2 group/alloc transition-colors hover:bg-white dark:hover:bg-slate-800 shadow-sm">
                      <div className="flex justify-between items-center">
                         <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-tight truncate max-w-[140px]">{alloc.teacherName}</span>
                         <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-100 dark:border-slate-800 shadow-sm">
                            <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">{alloc.room}</span>
                         </div>
                      </div>
                      <p className="text-[9px] font-bold text-sky-600 dark:text-sky-400 uppercase italic pl-0.5">{alloc.subject}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {blocks.length === 0 && !isAdding && (
            <div className="col-span-full py-40 text-center text-slate-300 font-black uppercase tracking-widest italic opacity-40">
              No Parallel Matrices Defined
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CombinedBlockView;
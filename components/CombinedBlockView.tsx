
import React, { useState, useMemo, useEffect } from 'react';
import { SchoolConfig, CombinedBlock, User, UserRole, Subject } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface CombinedBlockViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
  assignments: any[]; 
  setAssignments: React.Dispatch<React.SetStateAction<any[]>>;
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const CombinedBlockView: React.FC<CombinedBlockViewProps> = ({ config, setConfig, users, assignments, setAssignments, currentUser, showToast }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Selection tracking for the Builder
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(0);
  
  const [newBlock, setNewBlock] = useState<Partial<CombinedBlock>>({
    name: '',
    sectionNames: [],
    allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }]
  });

  const teachingStaff = useMemo(() => 
    users.filter(u => u.role !== UserRole.ADMIN && !u.role.startsWith('ADMIN_STAFF') && !u.isResigned)
    .sort((a, b) => a.name.localeCompare(b.name)), 
  [users]);

  const availableRooms = config.rooms || [];
  const availableSubjects = config.subjects.sort((a, b) => a.name.localeCompare(b.name));

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
      showToast("Cloud Repository Updated", "success");
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
    if (!newBlock.name?.trim()) return "Group name is required.";
    if (!newBlock.sectionNames?.length) return "Select at least one section.";
    if (!newBlock.allocations?.length || newBlock.allocations.length < 1) return "Add at least one teacher-subject allocation.";
    
    const incomplete = newBlock.allocations.some(a => !a.teacherId || !a.subject || !a.room);
    if (incomplete) return "All allocation fields (Teacher, Subject, Room) are mandatory.";

    const rooms = newBlock.allocations.map(a => a.room);
    if (new Set(rooms).size !== rooms.length) return "Conflict: Duplicate room detected within the same group period.";

    const teachers = newBlock.allocations.map(a => a.teacherId);
    if (new Set(teachers).size !== teachers.length) return "Conflict: A teacher cannot have multiple roles within the same block.";

    return null;
  };

  const handleSaveBlock = async () => {
    const error = validateBlock();
    if (error) {
      showToast(error, "error");
      return;
    }

    const block: CombinedBlock = {
      id: `block-${generateUUID()}`,
      name: newBlock.name!,
      sectionNames: newBlock.sectionNames!,
      allocations: newBlock.allocations!.map(a => ({
        ...a,
        teacherName: users.find(u => u.id === a.teacherId)?.name || 'Unknown'
      }))
    };

    const updatedConfig = {
      ...config,
      combinedBlocks: [...config.combinedBlocks, block]
    };

    setConfig(updatedConfig);
    setIsAdding(false);
    setNewBlock({ name: '', sectionNames: [], allocations: [{ teacherId: '', teacherName: '', subject: '', room: '' }] });
    
    await syncConfiguration(updatedConfig);
  };

  const removeBlock = async (id: string) => {
    if (confirm("Decommission this group period registry?")) {
      const updatedConfig = {
        ...config,
        combinedBlocks: config.combinedBlocks.filter(b => b.id !== id)
      };
      setConfig(updatedConfig);
      await syncConfiguration(updatedConfig);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-24">
      {/* Header Unit */}
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
          {isSyncing && (
            <div className="hidden sm:flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 rounded-xl border border-amber-100 dark:border-amber-800">
               <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
               <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Syncing Cloud</span>
            </div>
          )}
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className={`flex items-center gap-3 px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all border-2 active:scale-95 group ${
              isAdding 
              ? 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100' 
              : 'bg-[#001f3f] text-[#d4af37] border-white/10 hover:bg-slate-950'
            }`}
          >
            {isAdding ? (
              <>
                <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                Discard Session
              </>
            ) : (
              <>
                <svg className="w-5 h-5 transition-transform group-hover:scale-125" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
                Construct Block
              </>
            )}
          </button>
        </div>
      </div>

      {/* Builder Core Workspace */}
      {isAdding && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in zoom-in-95 duration-500">
          
          {/* Left Column: Configuration & Metadata */}
          <div className="xl:col-span-4 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-10">
              <div className="space-y-2">
                <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">1. Group Definition</h3>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Identify the parallel period cluster</p>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Matrix Title</label>
                  <input 
                    placeholder="e.g. Gr XI 2nd Language Block"
                    className="w-full px-8 py-5 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent focus:border-[#d4af37] rounded-3xl font-black text-sm dark:text-white shadow-inner outline-none transition-all placeholder:text-slate-300"
                    value={newBlock.name}
                    onChange={e => setNewBlock({...newBlock, name: e.target.value})}
                  />
                </div>

                <div className="space-y-4">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Sections <span className="text-[#d4af37]">({newBlock.sectionNames?.length || 0})</span></label>
                  <div className="grid grid-cols-2 gap-2 max-h-[350px] overflow-y-auto pr-2 scrollbar-hide bg-slate-50 dark:bg-slate-950/30 p-4 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-inner">
                    {config.classes.map(cls => (
                      <button 
                        key={cls.id}
                        onClick={() => {
                          const current = newBlock.sectionNames || [];
                          const next = current.includes(cls.name) ? current.filter(n => n !== cls.name) : [...current, cls.name];
                          setNewBlock({...newBlock, sectionNames: next});
                        }}
                        className={`px-4 py-3.5 rounded-2xl text-[10px] font-black uppercase border-2 transition-all text-left flex items-center justify-between group ${
                          newBlock.sectionNames?.includes(cls.name) 
                          ? 'bg-[#001f3f] text-white border-transparent shadow-lg scale-[1.02]' 
                          : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800 hover:border-sky-200'
                        }`}
                      >
                        <span className="truncate">{cls.name}</span>
                        {newBlock.sectionNames?.includes(cls.name) && (
                          <svg className="w-3 h-3 text-[#d4af37]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Validation & Deploy Box */}
            <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 opacity-5 transform group-hover:rotate-12 transition-transform">
                 <svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
               </div>
               <div className="relative z-10 space-y-8">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black text-[#d4af37] uppercase tracking-widest italic leading-tight">3. Deployment Hub</h3>
                    <p className="text-[8px] font-bold text-white/50 uppercase tracking-widest">Verify constraints before synchronization</p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-[10px] font-black text-white uppercase tracking-widest">
                       <div className={`w-2 h-2 rounded-full ${newBlock.name?.trim() ? 'bg-emerald-500' : 'bg-white/20'}`}></div>
                       Title Defined
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-black text-white uppercase tracking-widest">
                       <div className={`w-2 h-2 rounded-full ${newBlock.sectionNames?.length ? 'bg-emerald-500' : 'bg-white/20'}`}></div>
                       Sections Mapped
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-black text-white uppercase tracking-widest">
                       <div className={`w-2 h-2 rounded-full ${newBlock.allocations?.every(a => a.teacherId && a.subject && a.room) ? 'bg-emerald-500' : 'bg-white/20'}`}></div>
                       Staffing Complete
                    </div>
                  </div>
                  <button 
                    onClick={handleSaveBlock}
                    disabled={isSyncing}
                    className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all transform active:scale-95 disabled:opacity-50"
                  >
                    Commit Registry
                  </button>
               </div>
            </div>
          </div>

          {/* Middle Column: Visual Allocation Workboard */}
          <div className="xl:col-span-5 space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col h-full min-h-[600px]">
              <div className="flex items-center justify-between mb-10">
                <div className="space-y-2">
                  <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">2. Allocation Board</h3>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Map personnel to specialized roles</p>
                </div>
                <button 
                  onClick={handleAddSlot}
                  className="w-12 h-12 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-2xl flex items-center justify-center hover:scale-110 active:rotate-90 transition-all border border-sky-100 dark:border-sky-800 shadow-sm"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg>
                </button>
              </div>

              <div className="space-y-6 flex-1 overflow-y-auto pr-2 scrollbar-hide">
                {(newBlock.allocations || []).map((alloc, idx) => {
                  const isActive = activeSlotIdx === idx;
                  const isComplete = alloc.teacherId && alloc.subject && alloc.room;
                  
                  return (
                    <div 
                      key={idx} 
                      onClick={() => setActiveSlotIdx(idx)}
                      className={`relative p-8 rounded-[2.5rem] border-2 transition-all cursor-pointer group ${
                        isActive 
                        ? 'bg-slate-50 dark:bg-slate-800/80 border-[#d4af37] shadow-xl scale-[1.02]' 
                        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-slate-200'
                      }`}
                    >
                      <div className="absolute top-4 right-4 flex gap-2">
                        {isComplete && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>}
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeSlot(idx); }}
                          className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                        <div className="space-y-2">
                           <div className="flex items-center gap-3">
                             <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-sm ${alloc.teacherId ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-slate-100 text-slate-300'}`}>
                                {alloc.teacherName ? alloc.teacherName.substring(0,2) : '?'}
                             </div>
                             <div>
                               <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-tight">
                                 {alloc.teacherName || 'Assign Personnel'}
                               </p>
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">
                                 Faculty Role
                               </p>
                             </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 border-l-2 border-slate-100 dark:border-slate-800 pl-8">
                           <div className="space-y-1">
                              <p className="text-[10px] font-black text-sky-600 uppercase tracking-tight truncate">
                                {alloc.subject || 'Subject'}
                              </p>
                              <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">CURRICULUM</p>
                           </div>
                           <div className="space-y-1">
                              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-tight truncate">
                                {alloc.room || 'Room'}
                              </p>
                              <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">LOCATION</p>
                           </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Intelligent Resource Palette */}
          <div className="xl:col-span-3 space-y-8 h-full">
            <div className="bg-slate-50 dark:bg-slate-900 rounded-[3rem] p-10 shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col h-full max-h-[800px]">
               <div className="space-y-2 mb-10">
                 <h3 className="text-xs font-black text-sky-600 uppercase tracking-[0.3em] italic">Resource Palette</h3>
                 <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Quick-assign assets to selected slot</p>
               </div>

               <div className="space-y-12 overflow-y-auto pr-2 scrollbar-hide">
                  {/* Personnel Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                       <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">Faculty Staff</span>
                       <span className="text-[8px] font-black text-sky-500">{teachingStaff.length} Available</span>
                    </div>
                    <div className="space-y-2">
                      {teachingStaff.map(u => {
                        const isSelectedInAny = newBlock.allocations?.some(a => a.teacherId === u.id);
                        return (
                          <button 
                            key={u.id}
                            disabled={isSelectedInAny && !(newBlock.allocations?.[activeSlotIdx || 0]?.teacherId === u.id)}
                            onClick={() => activeSlotIdx !== null && updateSlotField(activeSlotIdx, 'teacherId', u.id)}
                            className={`w-full p-3 rounded-2xl text-left border-2 transition-all flex items-center gap-3 ${
                              newBlock.allocations?.[activeSlotIdx || 0]?.teacherId === u.id
                              ? 'bg-sky-500 border-transparent text-white shadow-md'
                              : isSelectedInAny 
                                ? 'bg-slate-100 dark:bg-slate-800 opacity-30 grayscale cursor-not-allowed border-transparent'
                                : 'bg-white dark:bg-slate-800 border-white dark:border-transparent hover:border-sky-200 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                             <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-[9px] ${newBlock.allocations?.[activeSlotIdx || 0]?.teacherId === u.id ? 'bg-white text-sky-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                               {u.name.substring(0,2)}
                             </div>
                             <span className="text-[10px] font-black uppercase tracking-tight truncate">{u.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Curriculum Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                       <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">Subjects</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {availableSubjects.map(s => (
                        <button 
                          key={s.id}
                          onClick={() => activeSlotIdx !== null && updateSlotField(activeSlotIdx, 'subject', s.name)}
                          className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase border-2 transition-all ${
                            newBlock.allocations?.[activeSlotIdx || 0]?.subject === s.name
                            ? 'bg-[#001f3f] border-transparent text-white shadow-md'
                            : 'bg-white dark:bg-slate-800 border-white dark:border-transparent hover:border-amber-200 text-slate-500'
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Room Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                       <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">Rooms</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableRooms.map(r => {
                        const isTakenInGroup = newBlock.allocations?.some((a, i) => a.room === r && i !== activeSlotIdx);
                        return (
                          <button 
                            key={r}
                            disabled={isTakenInGroup}
                            onClick={() => activeSlotIdx !== null && updateSlotField(activeSlotIdx, 'room', r)}
                            className={`p-3 rounded-xl text-[9px] font-black uppercase border-2 transition-all text-center ${
                              newBlock.allocations?.[activeSlotIdx || 0]?.room === r
                              ? 'bg-emerald-500 border-transparent text-white shadow-md'
                              : isTakenInGroup
                                ? 'bg-rose-50 dark:bg-rose-900/10 text-rose-300 border-transparent grayscale cursor-not-allowed'
                                : 'bg-white dark:bg-slate-800 border-white dark:border-transparent hover:border-emerald-200 text-slate-500'
                            }`}
                          >
                            {r}
                          </button>
                        );
                      })}
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing Blocks Display Grid */}
      {!isAdding && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8 px-2">
          {config.combinedBlocks.map(block => (
            <div key={block.id} className="group relative bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-xl border border-slate-100 dark:border-slate-800 transition-all hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.1)] hover:-translate-y-2 overflow-hidden">
              {/* Card Decoration */}
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-slate-50 dark:bg-slate-800/50 rounded-full group-hover:scale-150 transition-transform duration-700"></div>
              
              <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-4 group-hover:translate-x-0">
                <button 
                  onClick={() => removeBlock(block.id)}
                  className="w-12 h-12 bg-rose-50 dark:bg-rose-950/30 text-rose-500 rounded-2xl flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shadow-sm border border-rose-100 dark:border-rose-900/50"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>

              <div className="relative z-10 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                     <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.5)] animate-pulse"></div>
                     <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter truncate pr-10">{block.name}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {block.sectionNames.map(name => (
                      <span key={name} className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-800/60 text-[9px] font-black uppercase tracking-tight">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pt-8 border-t border-slate-50 dark:border-slate-800/50">
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-4">Functional Personnel</p>
                  {block.allocations.map((alloc, idx) => (
                    <div key={idx} className="bg-slate-50/50 dark:bg-slate-800/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col gap-2 group/alloc transition-colors hover:bg-white dark:hover:bg-slate-800">
                      <div className="flex justify-between items-center">
                         <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-tight truncate max-w-[140px]">{alloc.teacherName}</span>
                         <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-100 dark:border-slate-800">
                            <svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
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

          {config.combinedBlocks.length === 0 && !isAdding && (
            <div className="col-span-full py-60 flex flex-col items-center justify-center bg-white dark:bg-slate-900/30 rounded-[4rem] border-4 border-dashed border-slate-100 dark:border-slate-800/50 shadow-inner">
               <div className="w-28 h-28 bg-slate-50 dark:bg-slate-800/50 rounded-[2.5rem] flex items-center justify-center mb-8 text-slate-200 dark:text-slate-700 transform rotate-6 hover:rotate-0 transition-transform duration-500 shadow-xl border-2 border-white dark:border-slate-800">
                 <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2 2v12a2 2 0 012 2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
               </div>
               <div className="text-center space-y-2">
                 <p className="text-[14px] font-black text-[#001f3f] dark:text-white uppercase tracking-[0.6em]">Registry Matrix Void</p>
                 <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.4em]">Initialize a construct session to map parallel periods</p>
               </div>
               <button 
                 onClick={() => setIsAdding(true)}
                 className="mt-12 px-12 py-5 bg-[#001f3f] text-[#d4af37] rounded-[2rem] text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl hover:bg-slate-950 transition-all active:scale-95 border-2 border-white/5"
               >
                 Begin Initial Construct
               </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CombinedBlockView;

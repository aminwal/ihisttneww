import React, { useState, useMemo } from 'react';
import { SchoolConfig, LabBlock, User, UserRole, TimeTableEntry, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface LabPeriodsViewProps {
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

const LabPeriodsView: React.FC<LabPeriodsViewProps> = ({ 
  config, setConfig, users, timetable, setTimetable, currentUser, showToast, 
  assignments, setAssignments, isSandbox, addSandboxLog
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  
  const [newBlock, setNewBlock] = useState<Partial<LabBlock>>({
    title: '',
    gradeId: '',
    sectionIds: [],
    weeklyOccurrences: 1,
    isDoublePeriod: true,
    subject: '',
    teacherId: '',
    technicianId: '',
    room: '',
    preferredSlots: [],
    restrictedSlots: []
  });

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const teachingStaff = useMemo(() => users.filter(u => u.role !== UserRole.ADMIN && u.role !== UserRole.ADMIN_STAFF && !u.isResigned).sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const getRoomUsageStatus = (roomName: string): { status: 'FREE' | 'IN_USE', count: number } => {
    if (!roomName) return { status: 'FREE', count: 0 };
    const usageCount = timetable.filter(t => t.room === roomName && !t.isSubstitution).length;
    return { status: usageCount > 0 ? 'IN_USE' : 'FREE', count: usageCount };
  };

  const handleSaveBlock = async () => {
    if (!newBlock.title?.trim() || !newBlock.gradeId || !newBlock.sectionIds?.length || !newBlock.subject || !newBlock.teacherId || !newBlock.technicianId || !newBlock.room) {
      showToast("All fields including Title, Grade, Sections, Subject, Teacher, Technician, and Room are mandatory.", "error");
      return;
    }

    if (newBlock.sectionIds.length > 2) {
      showToast("A Lab Block can only have up to 2 sections combined.", "error");
      return;
    }

    const weeklyOccurrences = Number(newBlock.weeklyOccurrences) || 1;

    const block: LabBlock = {
      id: editingBlockId || `lab-${generateUUID()}`,
      title: newBlock.title!,
      gradeId: newBlock.gradeId!,
      sectionIds: newBlock.sectionIds!,
      weeklyOccurrences: weeklyOccurrences,
      isDoublePeriod: !!newBlock.isDoublePeriod,
      subject: newBlock.subject!,
      teacherId: newBlock.teacherId!,
      technicianId: newBlock.technicianId!,
      room: newBlock.room!,
      preferredSlots: newBlock.preferredSlots,
      restrictedSlots: newBlock.restrictedSlots
    };

    const updatedBlocks = editingBlockId 
      ? (config.labBlocks || []).map(b => b.id === editingBlockId ? block : b) 
      : [...(config.labBlocks || []), block];

    const updatedConfig = { 
      ...config, 
      labBlocks: updatedBlocks
    };
    
    setConfig(updatedConfig);
    
    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() });
      } catch (err) { console.error("Cloud block sync failed"); }
    } else if (isSandbox) {
      addSandboxLog?.('LAB_BLOCK_SAVE', { block, updatedConfig });
    }

    showToast(editingBlockId ? "Lab Template Updated" : "Lab Template Deployed", "success");
    setIsAdding(false);
    setEditingBlockId(null);
    setNewBlock({ title: '', gradeId: '', sectionIds: [], weeklyOccurrences: 1, isDoublePeriod: true, subject: '', teacherId: '', technicianId: '', room: '', preferredSlots: [], restrictedSlots: [] });
  };

  const startEditing = (block: LabBlock) => {
    setEditingBlockId(block.id);
    setNewBlock({ ...block });
    setIsAdding(true);
  };

  const blocksByGrade = useMemo(() => {
    const grouped: Record<string, LabBlock[]> = {};
    (config.labBlocks || []).forEach(b => {
      if (!grouped[b.gradeId]) grouped[b.gradeId] = [];
      grouped[b.gradeId].push(b);
    });
    return grouped;
  }, [config.labBlocks]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 max-w-full mx-auto pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
        <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase">Lab Period <span className="text-[#d4af37]">Templates</span></h1>
        <button onClick={() => setIsAdding(!isAdding)} className={`px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl transition-all ${isAdding ? 'bg-rose-50 text-rose-600' : 'bg-[#001f3f] text-[#d4af37]'}`}>
          {isAdding ? "Discard Changes" : "Build New Lab Pool"}
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
                    {(config.grades || []).map(g => {
                      const wing = config.wings?.find(w => w.id === g.wingId);
                      return <option key={g.id} value={g.id}>{g.name} {wing ? `(${wing.name})` : ''}</option>;
                    })}
                  </select>
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Admin Reference (Title)</label>
                     <input placeholder="e.g. Grade 9 Physics Lab" className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-bold text-xs outline-none" value={newBlock.title} onChange={e => setNewBlock({...newBlock, title: e.target.value})} />
                  </div>
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">2. Involved Sections (Max 2)</p>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
                    {(config.sections || []).filter(s => {
                       if (!newBlock.gradeId) return false;
                       const selectedGradeName = config.grades?.find(g => g.id === newBlock.gradeId)?.name;
                       const targetGradeIds = config.grades?.filter(g => g.name === selectedGradeName).map(g => g.id) || [];
                       return targetGradeIds.includes(s.gradeId);
                    }).map(sect => {
                      const wingName = config.wings?.find(w => w.id === sect.wingId)?.name || '';
                      return (
                      <button key={sect.id} onClick={() => {
                        const current = newBlock.sectionIds || [];
                        if (current.includes(sect.id)) {
                          setNewBlock({...newBlock, sectionIds: current.filter(id => id !== sect.id)});
                        } else if (current.length < 2) {
                          setNewBlock({...newBlock, sectionIds: [...current, sect.id]});
                        } else {
                          showToast("Maximum 2 sections allowed for a Lab Block.", "warning");
                        }
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
                     <span className="text-[9px] font-black uppercase text-slate-400">Occurrences / Week</span>
                     <input 
                        type="number" 
                        min="1" 
                        max="10" 
                        className="flex-1 bg-white dark:bg-slate-900 p-3 rounded-xl text-center font-black text-sm border-2 border-transparent focus:border-amber-400 outline-none" 
                        value={newBlock.weeklyOccurrences} 
                        onChange={e => setNewBlock({...newBlock, weeklyOccurrences: parseInt(e.target.value) || 0})} 
                     />
                  </div>
                  <label className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                     <input 
                        type="checkbox" 
                        className="w-5 h-5 text-amber-500 rounded border-slate-300 focus:ring-amber-500"
                        checked={newBlock.isDoublePeriod}
                        onChange={e => setNewBlock({...newBlock, isDoublePeriod: e.target.checked})}
                     />
                     <div>
                        <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">On Trot (Double Period)</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Requires 2 consecutive slots</p>
                     </div>
                  </label>
               </div>

               <div className="space-y-4">
                  <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">4. Slot Preferences (Optional)</p>
                  <div className="space-y-3">
                     <div className="space-y-2">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Preferred Periods</label>
                        <div className="flex flex-wrap gap-2 px-2">
                           {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => (
                              <label key={`pref-${period}`} className="flex items-center gap-1 cursor-pointer">
                                 <input 
                                    type="checkbox" 
                                    className="w-3 h-3 text-amber-500 rounded border-slate-300 focus:ring-amber-500"
                                    checked={newBlock.preferredSlots?.includes(period) || false}
                                    onChange={(e) => {
                                       const current = newBlock.preferredSlots || [];
                                       let updated;
                                       if (e.target.checked) {
                                          updated = [...current, period];
                                       } else {
                                          updated = current.filter(p => p !== period);
                                       }
                                       setNewBlock({...newBlock, preferredSlots: updated.length > 0 ? updated : undefined});
                                    }}
                                 />
                                 <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{period}</span>
                              </label>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Restricted Periods</label>
                        <div className="flex flex-wrap gap-2 px-2">
                           {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(period => (
                              <label key={`rest-${period}`} className="flex items-center gap-1 cursor-pointer">
                                 <input 
                                    type="checkbox" 
                                    className="w-3 h-3 text-rose-500 rounded border-slate-300 focus:ring-rose-500"
                                    checked={newBlock.restrictedSlots?.includes(period) || false}
                                    onChange={(e) => {
                                       const current = newBlock.restrictedSlots || [];
                                       let updated;
                                       if (e.target.checked) {
                                          updated = [...current, period];
                                       } else {
                                          updated = current.filter(p => p !== period);
                                       }
                                       setNewBlock({...newBlock, restrictedSlots: updated.length > 0 ? updated : undefined});
                                    }}
                                 />
                                 <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{period}</span>
                              </label>
                           ))}
                        </div>
                     </div>
                  </div>
               </div>
            </div>
            <button onClick={handleSaveBlock} className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 hover:text-white transition-all">Authorize Template</button>
          </div>

          <div className="xl:col-span-8">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 h-full">
               <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">Lab Allocation Details</h3>
               </div>
               <div className="space-y-6">
                  <div className="space-y-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Lab Subject</label>
                     <select 
                        className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase shadow-sm outline-none border-2 border-transparent focus:border-amber-400" 
                        value={newBlock.subject} 
                        onChange={e => setNewBlock({...newBlock, subject: e.target.value})}
                     >
                        <option value="">Select Subject...</option>
                        {(config.subjects || []).filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => (
                           <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                     </select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Subject Teacher</label>
                     <select 
                        className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase shadow-sm outline-none border-2 border-transparent focus:border-amber-400" 
                        value={newBlock.teacherId} 
                        onChange={e => setNewBlock({...newBlock, teacherId: e.target.value})}
                     >
                        <option value="">Select Teacher...</option>
                        {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Lab Technician</label>
                     <select 
                        className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase shadow-sm outline-none border-2 border-transparent focus:border-amber-400" 
                        value={newBlock.technicianId} 
                        onChange={e => setNewBlock({...newBlock, technicianId: e.target.value})}
                     >
                        <option value="">Select Technician...</option>
                        {teachingStaff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Lab Room</label>
                     <div className="relative">
                        <select 
                           className={`w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-[11px] uppercase shadow-sm outline-none border-2 ${getRoomUsageStatus(newBlock.room || '').status === 'IN_USE' ? 'border-amber-400' : 'border-transparent'}`} 
                           value={newBlock.room} 
                           onChange={e => setNewBlock({...newBlock, room: e.target.value})}
                        >
                           <option value="">Select Room...</option>
                           {(config.rooms || []).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {getRoomUsageStatus(newBlock.room || '').status === 'IN_USE' && (
                           <div className="absolute -top-3 right-4 px-2 py-0.5 bg-amber-500 text-white text-[7px] font-black rounded uppercase shadow-md">Used: {getRoomUsageStatus(newBlock.room || '').count} Classes</div>
                        )}
                     </div>
                  </div>
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
                   <h2 className="text-lg font-black text-[#001f3f] dark:text-amber-400 uppercase tracking-[0.4em]">{grade.name} Lab Pools</h2>
                   <div className="flex-1 h-[1px] bg-slate-100 dark:bg-slate-800"></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
                  {gradeBlocks.map(block => {
                     const teacher = users.find(u => u.id === block.teacherId);
                     const technician = users.find(u => u.id === block.technicianId);
                     return (
                     <div key={block.id} className="group bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 hover:border-amber-400 transition-all relative overflow-hidden">
                        <div className="relative z-10 space-y-6">
                           <div className="flex justify-between items-start">
                              <div>
                                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{block.title}</h4>
                                 <p className="text-[8px] font-black text-amber-500 uppercase tracking-[0.2em] mt-2 italic">Subject: {block.subject}</p>
                                 <div className="flex items-center gap-2 mt-2">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{block.sectionIds.length} Sections</p>
                                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                    <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">{block.weeklyOccurrences} {block.isDoublePeriod ? 'Double' : 'Single'} / Week</p>
                                 </div>
                                 {(block.preferredSlots?.length || block.restrictedSlots?.length) ? (
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                       {block.preferredSlots && block.preferredSlots.length > 0 && (
                                          <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded-md">Pref: {block.preferredSlots.join(', ')}</p>
                                       )}
                                       {block.restrictedSlots && block.restrictedSlots.length > 0 && (
                                          <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest bg-rose-50 px-2 py-1 rounded-md">Restricted: {block.restrictedSlots.join(', ')}</p>
                                       )}
                                    </div>
                                 ) : null}
                              </div>
                              <div className="flex gap-2">
                                 <button onClick={() => startEditing(block)} className="p-2 text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                                 <button onClick={async () => {
                                    if(confirm("Dismantle this lab pool? Timetable entries linked to this ID will lose their block association.")) {
                                       const updated = { ...config, labBlocks: (config.labBlocks || []).filter(b => b.id !== block.id) };
                                       setConfig(updated);
                                       if (IS_CLOUD_ENABLED && !isSandbox) await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updated });
                                       else if (isSandbox) addSandboxLog?.('LAB_BLOCK_PURGE', { id: block.id });
                                       showToast("Lab Pool Dismantled", "info");
                                    }
                                 }} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                              </div>
                           </div>
                           <div className="space-y-3">
                              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Personnel Deployment</p>
                              <div className="flex flex-col gap-2">
                                 <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">Teacher: {teacher?.name || 'Unknown'}</p>
                                 </div>
                                 <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">Technician: {technician?.name || 'Unknown'}</p>
                                 </div>
                                 <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">Room: {block.room}</p>
                                 </div>
                              </div>
                           </div>
                        </div>
                     </div>
                  )})}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LabPeriodsView;

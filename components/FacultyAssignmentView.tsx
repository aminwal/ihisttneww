
import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, SubjectLoad, SchoolGrade, SchoolSection, TimeTableEntry } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

const MAX_PERIODS = 35;

interface FacultyAssignmentViewProps {
  users: User[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  timetable: TimeTableEntry[];
  currentUser: User;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const FacultyAssignmentView: React.FC<FacultyAssignmentViewProps> = ({ users, config, assignments, setAssignments, timetable, currentUser, isSandbox, addSandboxLog }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selGradeId, setSelGradeId] = useState<string>('');
  const [selSectionIds, setSelSectionIds] = useState<string[]>([]);
  const [loads, setLoads] = useState<SubjectLoad[]>([]);
  const [groupPeriods, setGroupPeriods] = useState<number>(0);
  
  const [newLoad, setNewLoad] = useState<SubjectLoad>({ subject: '', periods: 1, room: '' });

  const teachingStaff = useMemo(() => 
    users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).sort((a,b) => a.name.localeCompare(b.name)), 
    [users]
  );

  useEffect(() => {
    if (selSectionIds.length === 1 && !newLoad.room) {
      const section = config.sections.find(s => s.id === selSectionIds[0]);
      if (section) {
        const homeRoom = `ROOM ${section.fullName}`;
        if (config.rooms.includes(homeRoom)) {
          setNewLoad(prev => ({ ...prev, room: homeRoom }));
        }
      }
    }
  }, [selSectionIds, config.sections, config.rooms, newLoad.room]);

  const getTeacherMetrics = (teacherId: string) => {
    const asgns = assignments.filter(a => a.teacherId === teacherId);
    const basePeriods = asgns.reduce((sum, a) => sum + a.loads.reduce((s, l) => s + (Number(l.periods) || 0), 0), 0);
    const blockPeriods = asgns.reduce((sum, a) => sum + (Number(a.groupPeriods) || 0), 0);
    const proxyCount = timetable.filter(t => t.teacherId === teacherId && t.isSubstitution).length;
    
    return {
      base: basePeriods,
      block: blockPeriods,
      proxy: proxyCount,
      total: basePeriods + blockPeriods + proxyCount
    };
  };

  const handleSave = async () => {
    if (!editingId || !selGradeId) {
        alert("Institutional Grade assignment is mandatory for matrix construction.");
        return;
    }
    const newAsgn: TeacherAssignment = {
      id: generateUUID(),
      teacherId: editingId,
      gradeId: selGradeId,
      loads: loads,
      targetSectionIds: selSectionIds,
      groupPeriods: groupPeriods
    };

    // CRITICAL: Update local parent state immediately to prevent tab-switching latency
    setAssignments(prev => {
        const filtered = prev.filter(a => !(a.teacherId === editingId && a.gradeId === selGradeId));
        return [...filtered, newAsgn];
    });

    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await supabase.from('teacher_assignments').upsert({
          id: newAsgn.id,
          teacher_id: newAsgn.teacherId,
          grade_id: newAsgn.gradeId,
          loads: newAsgn.loads,
          target_section_ids: newAsgn.targetSectionIds,
          group_periods: newAsgn.groupPeriods
        }, { onConflict: 'teacher_id, grade_id' });
      } catch (err) {
        console.error("Cloud assignment sync failed:", err);
      }
    } else if (isSandbox) {
      addSandboxLog?.('LOAD_ASSIGNMENT_SAVE', newAsgn);
    }

    setEditingId(null);
    setLoads([]);
    setSelSectionIds([]);
    setGroupPeriods(0);
  };

  const addLoadItem = () => {
    if (!newLoad.subject) return;
    setLoads([...loads, { ...newLoad }]);
    setNewLoad({ subject: '', periods: 1, room: '' });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase leading-none">Load <span className="text-[#d4af37]">Intelligence</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Workload & Constraint Matrix</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
         {teachingStaff.map(t => {
            const metrics = getTeacherMetrics(t.id);
            const severityColor = metrics.total > 30 ? 'bg-rose-500' : metrics.total > 25 ? 'bg-amber-500' : 'bg-emerald-500';
            
            return (
              <div key={t.id} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 group hover:border-[#d4af37] transition-all relative overflow-hidden">
                 <div className={`absolute top-0 right-0 w-32 h-32 ${severityColor} opacity-5 blur-3xl rounded-full -mr-16 -mt-16`}></div>
                 
                 <div className="flex justify-between items-start mb-8 relative z-10">
                    <div>
                       <p className="font-black text-xl text-[#001f3f] dark:text-white italic uppercase tracking-tight truncate max-w-[180px]">{t.name}</p>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{t.employeeId}</p>
                    </div>
                    <div className="flex flex-col items-center shrink-0">
                       <div className={`w-14 h-14 rounded-[1.25rem] ${severityColor} text-white flex flex-col items-center justify-center shadow-xl`}>
                          <span className="text-lg font-black leading-none">{metrics.total}</span>
                          <span className="text-[7px] font-black uppercase opacity-60">Total P</span>
                       </div>
                    </div>
                 </div>
                 
                 <div className="grid grid-cols-3 gap-3 mb-8">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center">
                       <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Base</p>
                       <p className="text-xs font-black text-[#001f3f] dark:text-white">{metrics.base}P</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center border border-[#d4af37]/20">
                       <p className="text-[7px] font-black text-amber-500 uppercase mb-1">Block</p>
                       <p className="text-xs font-black text-amber-600">{metrics.block}P</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center">
                       <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Proxy</p>
                       <p className="text-xs font-black text-emerald-600">{metrics.proxy}P</p>
                    </div>
                 </div>

                 <div className="space-y-1 mb-8">
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                       <div style={{ width: `${(metrics.total / MAX_PERIODS) * 100}%` }} className={`h-full ${severityColor}`}></div>
                    </div>
                    <p className="text-[8px] font-black text-slate-400 uppercase text-right">Capacity: {Math.round((metrics.total / MAX_PERIODS) * 100)}%</p>
                 </div>

                 <button onClick={() => { 
                   setEditingId(t.id); 
                   const existing = assignments.find(a => a.teacherId === t.id);
                   if (existing) {
                     setLoads(existing.loads);
                     setSelGradeId(existing.gradeId);
                     setSelSectionIds(existing.targetSectionIds || []);
                     setGroupPeriods(existing.groupPeriods || 0);
                   } else {
                     setLoads([]); setSelGradeId(''); setSelSectionIds([]); setGroupPeriods(0);
                   }
                 }} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] shadow-lg hover:bg-slate-950 transition-all active:scale-95">Configure Load</button>
              </div>
            );
         })}
      </div>

      {editingId && (
        <div className="fixed inset-0 z-[1000] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-4 md:p-6">
           <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-[2.5rem] md:rounded-[3rem] p-6 md:p-10 space-y-8 md:space-y-10 overflow-y-auto h-full md:h-auto max-h-[95vh] scrollbar-hide shadow-[0_0_100px_rgba(212,175,55,0.2)] flex flex-col">
              <div className="text-center shrink-0">
                 <h3 className="text-2xl md:text-3xl font-black uppercase text-[#001f3f] dark:text-white italic tracking-tighter">Load Assignment Hub</h3>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Personnel: {users.find(u => u.id === editingId)?.name}</p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-10 scrollbar-hide">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                   <div className="space-y-8">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">1</span>
                            Institutional Context
                         </label>
                         <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-xs outline-none border-2 border-transparent focus:border-amber-400 transition-all dark:text-white shadow-sm" value={selGradeId} onChange={e => setSelGradeId(e.target.value)}>
                            <option value="">Select Primary Grade...</option>
                            {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                         </select>
                      </div>

                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">2</span>
                            Synchronized Block Constraint
                         </label>
                         <div className="p-6 bg-amber-50 dark:bg-amber-950/20 rounded-[2rem] border-2 border-dashed border-amber-200 shadow-inner">
                            <div className="flex items-center justify-between mb-4">
                               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">Group Periods / Week</p>
                               <input type="number" min="0" max="35" className="w-20 p-3 bg-white dark:bg-slate-800 rounded-xl text-center font-black text-sm outline-none border-2 border-transparent focus:border-amber-400 dark:text-white" value={groupPeriods} onChange={e => setGroupPeriods(parseInt(e.target.value) || 0)} />
                            </div>
                            <p className="text-[9px] font-medium text-amber-700/60 uppercase leading-relaxed italic">Specifies slots joined to Grade-wide Subject Pool.</p>
                         </div>
                      </div>

                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">3</span>
                            Section Mapping
                         </label>
                         <div className="grid grid-cols-3 gap-2">
                            {config.sections.filter(s => s.gradeId === selGradeId).map(s => (
                              <button key={s.id} onClick={() => setSelSectionIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])} className={`p-3 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${selSectionIds.includes(s.id) ? 'bg-[#001f3f] text-[#d4af37] border-transparent shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>{s.name}</button>
                            ))}
                         </div>
                      </div>
                   </div>

                   <div className="space-y-8">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-sky-500 tracking-widest flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full bg-sky-100 flex items-center justify-center text-[8px]">4</span>
                            Subject Load Logic
                         </label>
                         <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 space-y-4 shadow-inner">
                            <select className="w-full p-4 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none border-2 border-transparent focus:border-sky-400" value={newLoad.subject} onChange={e => setNewLoad({...newLoad, subject: e.target.value})}>
                               <option value="">Course Selection...</option>
                               {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </select>
                            <div className="flex gap-3">
                               <input type="number" min="1" placeholder="P/W" className="w-24 p-4 bg-white dark:bg-slate-900 rounded-xl font-black text-xs outline-none border-2 border-transparent focus:border-sky-400" value={newLoad.periods} onChange={e => setNewLoad({...newLoad, periods: parseInt(e.target.value) || 0})} />
                               <select className="flex-1 p-4 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none border-2 border-transparent focus:border-sky-400" value={newLoad.room} onChange={e => setNewLoad({...newLoad, room: e.target.value})}>
                                  <option value="">Home Room / Select...</option>
                                  {config.rooms.map(r => <option key={r} value={r}>{r}</option>)}
                               </select>
                            </div>
                            <button onClick={addLoadItem} className="w-full py-4 bg-sky-600 text-white rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-sky-700 transition-all">+ Anchor Load</button>
                         </div>
                      </div>

                      <div className="space-y-3">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Allocated Loads ({loads.length})</p>
                         <div className="space-y-2">
                            {loads.map((l, i) => (
                              <div key={i} className="flex items-center justify-between p-4 bg-white dark:bg-slate-950 rounded-2xl border border-slate-100 shadow-sm animate-in slide-in-from-right duration-300">
                                 <div>
                                    <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase leading-none">{l.subject}</p>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-widest">{l.periods} Periods • {l.room || 'Default'}</p>
                                 </div>
                                 <button onClick={() => setLoads(loads.filter((_, idx) => idx !== i))} className="text-rose-400 hover:bg-rose-50 p-2 rounded-lg transition-all">×</button>
                              </div>
                            ))}
                         </div>
                      </div>
                   </div>
                </div>
              </div>

              <div className="pt-6 flex flex-col md:flex-row gap-4 shrink-0">
                 <button onClick={handleSave} className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all">Authorize Matrix Entry</button>
                 <button onClick={() => { setEditingId(null); setLoads([]); }} className="px-10 py-6 bg-slate-50 text-slate-400 rounded-[2rem] font-black text-xs uppercase tracking-widest border border-slate-100">Abort Changes</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignmentView;

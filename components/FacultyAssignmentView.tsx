import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, SubjectLoad, SchoolGrade, SchoolSection, TimeTableEntry } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

const MAX_PERIODS = 35;

interface FacultyAssignmentViewProps {
  users: User[];
  setUsers?: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  timetable: TimeTableEntry[];
  currentUser: User;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const FacultyAssignmentView: React.FC<FacultyAssignmentViewProps> = ({ users, setUsers, config, assignments, setAssignments, timetable, currentUser, isSandbox, addSandboxLog }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selGradeId, setSelGradeId] = useState<string>('');
  const [selSectionIds, setSelSectionIds] = useState<string[]>([]);
  const [loads, setLoads] = useState<SubjectLoad[]>([]);
  const [groupPeriods, setGroupPeriods] = useState<number>(0);
  const [anchorSubject, setAnchorSubject] = useState<string>('');
  const [localClassTeacherOf, setLocalClassTeacherOf] = useState<string>('');
  const [newLoad, setNewLoad] = useState<SubjectLoad>({ subject: '', periods: 1, room: '' });
  
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'PRIMARY' | 'SECONDARY' | 'SENIOR'>('ALL');

  const editingTeacher = useMemo(() => users.find(u => u.id === editingId), [users, editingId]);

  useEffect(() => {
    if (editingId && selGradeId) {
      const existing = assignments.find(a => a.teacherId === editingId && a.gradeId === selGradeId);
      if (existing) {
        setLoads(existing.loads || []);
        setSelSectionIds(existing.targetSectionIds || []);
        setGroupPeriods(existing.groupPeriods || 0);
        setAnchorSubject(existing.anchorSubject || '');
      } else {
        setLoads([]);
        setSelSectionIds([]);
        setGroupPeriods(0);
        setAnchorSubject('');
      }
    }
  }, [selGradeId, editingId, assignments]);

  const teachingStaff = useMemo(() => {
    let filtered = users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN);
    if (activeTab !== 'ALL') {
      filtered = filtered.filter(u => {
        if (activeTab === 'PRIMARY') return u.role.includes('PRIMARY');
        if (activeTab === 'SECONDARY') return u.role.includes('SECONDARY') && !u.role.includes('SENIOR');
        if (activeTab === 'SENIOR') return u.role.includes('SENIOR');
        return true;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(u => u.name.toLowerCase().includes(q) || u.employeeId.toLowerCase().includes(q));
    }
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, activeTab, search]);

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

  /**
   * INTEGRATED CONCURRENT LOAD ENGINE
   * Reflects both individual scheduled periods and theoretical Subject Pool commitments.
   */
  const getTeacherMetrics = (teacherId: string) => {
    // 1. Individual Scheduled Load: Non-substitution entries NOT part of any block
    const baseCount = timetable.filter(t => 
      t.teacherId === teacherId && 
      !t.isSubstitution && 
      !t.date && 
      !t.blockId
    ).length;
    
    // 2. Proxy Load: Active substitutions
    const proxyCount = timetable.filter(t => t.teacherId === teacherId && t.isSubstitution).length;

    // 3. Pool Commitment: Theoretical periods from the Combined Blocks definitions
    const poolPeriods = (config.combinedBlocks || [])
      .filter(b => b.allocations.some(a => a.teacherId === teacherId))
      .reduce((sum, b) => sum + (b.weeklyPeriods || 0), 0);

    return { 
      base: baseCount, 
      pool: poolPeriods, 
      proxy: proxyCount, 
      total: baseCount + poolPeriods + proxyCount 
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
      groupPeriods: groupPeriods,
      anchorSubject: anchorSubject || undefined
    };

    setAssignments(prev => {
        const filtered = prev.filter(a => !(a.teacherId === editingId && a.gradeId === selGradeId));
        return [...filtered, newAsgn];
    });

    if (setUsers) {
      setUsers(prev => prev.map(u => u.id === editingId ? { ...u, classTeacherOf: localClassTeacherOf || undefined } : u));
    }

    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await Promise.all([
          supabase.from('teacher_assignments').upsert({
            id: newAsgn.id,
            teacher_id: newAsgn.teacherId,
            grade_id: newAsgn.gradeId,
            loads: newAsgn.loads,
            target_section_ids: newAsgn.targetSectionIds,
            group_periods: newAsgn.groupPeriods,
            anchor_subject: newAsgn.anchorSubject
          }, { onConflict: 'teacher_id, grade_id' }),
          supabase.from('profiles').update({ 
            class_teacher_of: localClassTeacherOf || null 
          }).eq('id', editingId)
        ]);
      } catch (err) {
        console.error("Cloud assignment sync failed:", err);
      }
    } else if (isSandbox) {
      addSandboxLog?.('LOAD_ASSIGNMENT_SAVE', { newAsgn, classTeacherOf: localClassTeacherOf });
    }

    setEditingId(null);
    setLoads([]);
    setSelSectionIds([]);
    setGroupPeriods(0);
    setAnchorSubject('');
    setLocalClassTeacherOf('');
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

      <div className="flex flex-col xl:flex-row items-center gap-6 px-2">
        <div className="relative w-full xl:w-96">
          <input type="text" placeholder="Search Faculty..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl font-bold text-xs outline-none dark:text-white focus:border-amber-400 transition-all shadow-sm" />
          <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide w-full xl:w-auto">
          {(['ALL', 'PRIMARY', 'SECONDARY', 'SENIOR'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeTab === tab ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{tab === 'SENIOR' ? 'Sr. Secondary' : tab.charAt(0) + tab.slice(1).toLowerCase()}</button>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
         {teachingStaff.length > 0 ? teachingStaff.map(t => {
            const metrics = getTeacherMetrics(t.id);
            const severityColor = metrics.total > 30 ? 'bg-rose-500' : metrics.total > 25 ? 'bg-amber-500' : 'bg-emerald-500';
            const ctSection = t.classTeacherOf ? config.sections.find(s => s.id === t.classTeacherOf) : null;

            return (
              <div key={t.id} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 group hover:border-[#d4af37] transition-all relative overflow-hidden shadow-sm">
                 <div className={`absolute top-0 right-0 w-32 h-32 ${severityColor} opacity-5 blur-3xl rounded-full -mr-16 -mt-16`}></div>
                 <div className="flex justify-between items-start mb-8 relative z-10">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-black text-xl text-[#001f3f] dark:text-white italic uppercase tracking-tight truncate max-w-[180px] leading-none">{t.name}</p>
                        {ctSection && <span className="px-2 py-0.5 bg-sky-50 text-sky-600 text-[6px] font-black uppercase rounded-lg border border-sky-100 shadow-sm">CT: {ctSection.fullName}</span>}
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{t.employeeId}</p>
                    </div>
                    <div className="flex flex-col items-center shrink-0"><div className={`w-14 h-14 rounded-[1.25rem] ${severityColor} text-white flex flex-col items-center justify-center shadow-xl`}><span className="text-lg font-black leading-none">{metrics.total}</span><span className="text-[7px] font-black uppercase opacity-60">Total P</span></div></div>
                 </div>
                 <div className="grid grid-cols-3 gap-3 mb-8">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center"><p className="text-[7px] font-black text-slate-400 uppercase mb-1">Scheduled</p><p className="text-xs font-black text-[#001f3f] dark:text-white">{metrics.base}P</p></div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center border border-amber-400/20"><p className="text-[7px] font-black text-amber-500 uppercase mb-1">Pool Committed</p><p className="text-xs font-black text-amber-600">{metrics.pool}P</p></div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-center"><p className="text-[7px] font-black text-slate-400 uppercase mb-1">Proxy</p><p className="text-xs font-black text-emerald-600">{metrics.proxy}P</p></div>
                 </div>
                 <div className="space-y-1 mb-8">
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner"><div style={{ width: `${Math.min(100, (metrics.total / MAX_PERIODS) * 100)}%` }} className={`h-full ${severityColor} transition-all duration-700`}></div></div>
                    <p className="text-[8px] font-black text-slate-400 uppercase text-right">Capacity: {Math.round((metrics.total / MAX_PERIODS) * 100)}%</p>
                 </div>
                 <button onClick={() => { 
                   setEditingId(t.id); 
                   const existing = assignments.find(a => a.teacherId === t.id);
                   if (existing) {
                     setLoads(existing.loads || []); 
                     setSelGradeId(existing.gradeId); 
                     setSelSectionIds(existing.targetSectionIds || []); 
                     setGroupPeriods(existing.groupPeriods || 0); 
                     setAnchorSubject(existing.anchorSubject || '');
                     setLocalClassTeacherOf(t.classTeacherOf || '');
                   } else {
                     setLoads([]); setSelGradeId(''); setSelSectionIds([]); setGroupPeriods(0); setAnchorSubject(''); setLocalClassTeacherOf(t.classTeacherOf || '');
                   }
                 }} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] shadow-lg hover:bg-slate-950 transition-all active:scale-95">Configure Load</button>
              </div>
            );
         }) : (
           <div className="col-span-full py-20 text-center"><div className="opacity-20 flex flex-col items-center gap-4"><svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg><p className="text-sm font-black uppercase tracking-[0.4em]">No faculty found in this segment</p></div></div>
         )}
      </div>

      {editingId && (
        <div className="fixed inset-0 z-[1000] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-4 md:p-6">
           <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-[2.5rem] md:rounded-[3rem] p-6 md:p-10 space-y-8 md:space-y-10 overflow-y-auto h-full md:h-auto max-h-[95vh] scrollbar-hide shadow-[0_0_100px_rgba(212,175,55,0.2)] flex flex-col">
              <div className="text-center shrink-0">
                 <h3 className="text-2xl md:text-3xl font-black uppercase text-[#001f3f] dark:text-white italic tracking-tighter">Load Assignment Hub</h3>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Personnel: {editingTeacher?.name}</p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-10 scrollbar-hide px-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                   <div className="space-y-8">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">1</span>Institutional Context</label>
                         <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-xs outline-none border-4 border-transparent focus:border-amber-400 transition-all dark:text-white shadow-sm" value={selGradeId} onChange={e => setSelGradeId(e.target.value)}>
                            <option value="">Select Primary Grade First...</option>
                            {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                         </select>
                      </div>

                      {selGradeId ? (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                          <label className="text-[10px] font-black uppercase text-sky-500 tracking-widest flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-sky-100 flex items-center justify-center text-[10px]">⌘</span>Class Teacher Designation</label>
                          <div className="p-8 bg-sky-50 dark:bg-sky-950/40 rounded-[2.5rem] border-4 border-dashed border-sky-200 shadow-xl">
                             <p className="text-[9px] font-black text-sky-700 dark:text-sky-300 uppercase tracking-widest mb-4">Is {editingTeacher?.name} the Class Teacher for a section in {config.grades.find(g => g.id === selGradeId)?.name}?</p>
                             <select 
                               className="w-full p-5 bg-white dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase shadow-lg outline-none border-2 border-transparent focus:border-sky-400 transition-all" 
                               value={localClassTeacherOf} 
                               onChange={e => setLocalClassTeacherOf(e.target.value)}
                             >
                                <option value="">--- NOT A CLASS TEACHER ---</option>
                                {config.sections.filter(s => s.gradeId === selGradeId).map(s => (
                                  <option key={s.id} value={s.id}>{s.fullName} (Class Teacher)</option>
                                ))}
                             </select>
                             <p className="text-[8px] font-bold text-sky-600/60 mt-4 leading-relaxed italic uppercase tracking-wider">Note: This will anchor the teacher to Period 1 for morning registration protocol.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 bg-slate-50 dark:bg-slate-800/50 rounded-[2.5rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center opacity-50">
                           <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Select a Grade to enable Class Teacher assignment</p>
                        </div>
                      )}

                      {localClassTeacherOf && (
                        <div className="space-y-3 animate-in slide-in-from-left duration-500">
                          <label className="text-[10px] font-black uppercase text-emerald-500 tracking-widest flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-[10px]">★</span>Period 1 Anchor Protocol</label>
                          <div className="p-8 bg-emerald-50 dark:bg-emerald-950/40 rounded-[2.5rem] border-4 border-dashed border-emerald-200 shadow-xl space-y-5">
                             <div className="flex items-center justify-between">
                                <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-tight">Active Class: {config.sections.find(s => s.id === localClassTeacherOf)?.fullName}</p>
                                <span className="px-4 py-1.5 bg-emerald-100 text-emerald-600 text-[9px] font-black uppercase rounded-xl border border-emerald-200">Protocol Active</span>
                             </div>
                             <div className="space-y-3">
                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">Assign load for Period 1 (Sunday-Thursday):</p>
                                <select 
                                  className="w-full p-5 bg-white dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase shadow-lg outline-none border-2 border-transparent focus:border-emerald-400 transition-all" 
                                  value={anchorSubject} 
                                  onChange={e => setAnchorSubject(e.target.value)}
                                >
                                   <option value="">--- CHOOSE ANCHOR SUBJECT ---</option>
                                   {loads.length > 0 ? loads.map((l, idx) => (
                                     <option key={idx} value={l.subject}>{l.subject} ({l.periods}P/W)</option>
                                   )) : (
                                     <option disabled value="">No subjects added to load list yet...</option>
                                   )}
                                </select>
                             </div>
                             <p className="text-[8px] font-medium text-emerald-700/70 leading-relaxed italic">Locks teacher to Period 1 in {config.sections.find(s => s.id === localClassTeacherOf)?.fullName}. 5 periods will be deducted from the load.</p>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">2</span>Synchronized Block Constraint</label>
                         <div className="p-6 bg-amber-50 dark:bg-amber-950/20 rounded-[2rem] border-2 border-dashed border-amber-200 shadow-inner">
                            <div className="flex items-center justify-between mb-4">
                               <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">Group Periods / Week</p>
                               <input type="number" min="0" max="35" className="w-20 p-3 bg-white dark:bg-slate-800 rounded-xl text-center font-black text-sm outline-none border-2 border-transparent focus:border-amber-400 dark:text-white shadow-sm" value={groupPeriods} onChange={e => setGroupPeriods(parseInt(e.target.value) || 0)} />
                            </div>
                            <p className="text-[9px] font-medium text-amber-700/60 uppercase leading-relaxed italic">Specifies slots joined to Grade-wide Subject Pool.</p>
                         </div>
                      </div>

                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-amber-500 tracking-widest flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[8px]">3</span>Section Mapping</label>
                         <div className="grid grid-cols-3 gap-2">
                            {config.sections.filter(s => s.gradeId === selGradeId).map(s => (
                              <button key={s.id} onClick={() => setSelSectionIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])} className={`p-3 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${selSectionIds.includes(s.id) ? 'bg-[#001f3f] text-[#d4af37] border-transparent shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>{s.name}</button>
                            ))}
                         </div>
                      </div>
                   </div>

                   <div className="space-y-8">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black uppercase text-sky-500 tracking-widest flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-sky-100 flex items-center justify-center text-[8px]">4</span>Subject Load Logic</label>
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
                            <button onClick={addLoadItem} className="w-full py-4 bg-sky-600 text-white rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-sky-700 transition-all active:scale-95">+ Add To Load List</button>
                         </div>
                      </div>

                      <div className="space-y-3">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Allocated Loads ({loads.length})</p>
                         <div className="space-y-2">
                            {loads.map((l, i) => (
                              <div key={i} className={`flex items-center justify-between p-4 bg-white dark:bg-slate-950 rounded-2xl border border-slate-100 shadow-sm animate-in slide-in-from-right duration-300 ${anchorSubject === l.subject ? 'ring-2 ring-emerald-400' : ''}`}>
                                 <div>
                                    <div className="flex items-center gap-2">
                                       <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase leading-none">{l.subject}</p>
                                       {anchorSubject === l.subject && <span className="text-[6px] font-black bg-emerald-500 text-white px-1 py-0.5 rounded">ANCHOR</span>}
                                    </div>
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

              <div className="pt-6 flex flex-col md:flex-row gap-4 shrink-0 px-2">
                 <button onClick={handleSave} className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95">Authorize Matrix Entry</button>
                 <button onClick={() => { setEditingId(null); setLoads([]); }} className="px-10 py-6 bg-slate-50 text-slate-400 rounded-[2rem] font-black text-xs uppercase tracking-widest border border-slate-100 shadow-sm">Abort Changes</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignmentView;
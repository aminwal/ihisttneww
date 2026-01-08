
import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, Subject, SubjectLoad } from '../types.ts';
import { ROMAN_TO_ARABIC } from '../constants.ts';

interface FacultyAssignmentViewProps {
  users: User[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  triggerConfirm: (message: string, onConfirm: () => void) => void;
  currentUser: User; 
}

const FacultyAssignmentView: React.FC<FacultyAssignmentViewProps> = ({ users, config, assignments, setAssignments, triggerConfirm, currentUser }) => {
  const [activeSection, setActiveSection] = useState<'PRIMARY' | 'SECONDARY'>(
    currentUser.role === UserRole.INCHARGE_SECONDARY ? 'SECONDARY' : 'PRIMARY'
  );

  const [teacherSearch, setTeacherSearch] = useState('');
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [editingLoads, setEditingLoads] = useState<SubjectLoad[]>([]);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  const isLimitedSubject = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('art') || n.includes('phe') || n.includes('library') || n.includes('physical education') || n.trim().toUpperCase() === 'CEP';
  };

  const sortedSubjects = useMemo(() => {
    return [...config.subjects].sort((a, b) => {
      if (a.category !== b.category) {
        if (a.category === SubjectCategory.CORE) return -1;
        if (b.category === SubjectCategory.CORE) return 1;
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
  }, [config.subjects]);

  const getGradeFromClassName = (name: string) => {
    const romanMatch = name.match(/[IVX]+/);
    if (romanMatch) return `Grade ${romanMatch[0]}`;
    const digitMatch = name.match(/\d+/);
    if (digitMatch) return `Grade ${digitMatch[0]}`;
    return name;
  };

  const getTeacherSpecificGrades = (teacher: User) => {
    const allRoles = [teacher.role, ...(teacher.secondaryRoles || [])];
    const isPrimaryTeacher = allRoles.some(r => r === UserRole.TEACHER_PRIMARY || r === UserRole.INCHARGE_PRIMARY);
    const isSecondaryTeacher = allRoles.some(r => r === UserRole.TEACHER_SECONDARY || r === UserRole.TEACHER_SENIOR_SECONDARY || r === UserRole.INCHARGE_SECONDARY);
    const isGlobal = allRoles.some(r => r === UserRole.ADMIN || r === UserRole.INCHARGE_ALL || r === UserRole.ADMIN_STAFF);

    const grades = config.classes
      .filter(c => {
        if (isGlobal) return true;
        if (isPrimaryTeacher && c.section === 'PRIMARY') return true;
        if (isSecondaryTeacher && (c.section === 'SECONDARY_BOYS' || c.section === 'SECONDARY_GIRLS')) return true;
        return false;
      })
      .map(c => getGradeFromClassName(c.name));
    
    return (Array.from(new Set(grades)) as string[]).sort((a: string, b: string) => {
      const getNum = (str: string) => {
        const parts = str.split(' ');
        const rPart = parts.length > 1 ? parts[1] : '';
        return ROMAN_TO_ARABIC[rPart] || 0;
      };
      return getNum(a) - getNum(b);
    });
  };

  useEffect(() => {
    if (editingTeacherId && selectedGrade) {
      const existing = assignments.find(a => a.teacherId === editingTeacherId && a.grade === selectedGrade);
      setEditingLoads(existing ? [...existing.loads] : []);
    } else {
      setEditingLoads([]);
    }
  }, [editingTeacherId, selectedGrade, assignments]);

  const calculateTeacherTotalPeriods = (teacherId: string, currentGrade?: string, currentGradeLoads: SubjectLoad[] = []) => {
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    let total = 0;
    teacherAssignments.forEach(a => {
      if (a.grade !== currentGrade) total += a.loads.reduce((sum, l) => sum + l.periods, 0);
    });
    if (currentGrade) total += currentGradeLoads.reduce((sum, l) => sum + l.periods, 0);
    return total;
  };

  const handleAutoAssign = () => {
    if (!editingTeacherId || !selectedGrade) return;

    const currentBaseLoad = calculateTeacherTotalPeriods(editingTeacherId, selectedGrade, []);
    let remainingCapacity = 28 - currentBaseLoad;

    if (remainingCapacity <= 0) {
      setStatus({ type: 'warning', message: 'Standard 28-period base capacity reached.' });
      return;
    }

    const newAutoLoads: SubjectLoad[] = [...editingLoads];
    let addedCount = 0;

    for (const sub of sortedSubjects) {
      if (remainingCapacity <= 0) break;
      if (newAutoLoads.some(l => l.subject === sub.name)) continue;

      const isSpecial = isLimitedSubject(sub.name);
      const periodsToAssign = isSpecial ? 1 : Math.min(6, remainingCapacity);

      if (periodsToAssign > 0) {
        newAutoLoads.push({ subject: sub.name, periods: periodsToAssign });
        remainingCapacity -= periodsToAssign;
        addedCount++;
      }
    }

    setEditingLoads(newAutoLoads);
    setStatus({ type: 'success', message: `Smart Fill: Added ${addedCount} subject units.` });
    setTimeout(() => setStatus(null), 3000);
  };

  const commitToAssignments = (teacherId: string, grade: string, loads: SubjectLoad[]) => {
    const newAssignment: TeacherAssignment = {
      id: `${teacherId}-${grade}`,
      teacherId: teacherId,
      grade: grade,
      loads: loads 
    };
    const baseAssignments = [
      ...assignments.filter(a => !(a.teacherId === teacherId && a.grade === grade)),
      newAssignment
    ];
    setAssignments(baseAssignments);
    setEditingTeacherId(null);
    setSelectedGrade('');
    setStatus({ type: 'success', message: 'Workload authorized successfully.' });
    setTimeout(() => setStatus(null), 3000);
  };

  const saveAssignment = () => {
    if (!editingTeacherId || !selectedGrade || editingLoads.length === 0) return;
    const totalLoad = calculateTeacherTotalPeriods(editingTeacherId, selectedGrade, editingLoads);
    if (totalLoad > 28) {
      triggerConfirm(`Load Advisory: Total periods (${totalLoad}) exceeds institutional 28P limit. Force authorize?`, () => commitToAssignments(editingTeacherId, selectedGrade, editingLoads));
      return;
    }
    commitToAssignments(editingTeacherId, selectedGrade, editingLoads);
  };

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (u.role === UserRole.ADMIN) return false;
      const allRoles = [u.role, ...(u.secondaryRoles || [])];
      const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL);
      const isSecondary = allRoles.some(r => r.includes('SECONDARY') || r === UserRole.INCHARGE_ALL);

      if (activeSection === 'PRIMARY' && !isPrimary) return false;
      if (activeSection === 'SECONDARY' && !isSecondary) return false;

      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, activeSection, teacherSearch]);

  const toggleSubject = (subjectName: string) => {
    const isSpecial = isLimitedSubject(subjectName);
    setEditingLoads(prev => {
      const exists = prev.find(l => l.subject === subjectName);
      if (exists) return prev.filter(l => l.subject !== subjectName);
      return [...prev, { subject: subjectName, periods: isSpecial ? 1 : 6 }];
    });
  };

  const updatePeriods = (subjectName: string, delta: number) => {
    const isSpecial = isLimitedSubject(subjectName);
    if (isSpecial) return; // Specialized subjects are fixed at 1P

    setEditingLoads(prev => prev.map(l => {
      if (l.subject !== subjectName) return l;
      const newValue = Math.max(1, Math.min(10, l.periods + delta));
      return { ...l, periods: newValue };
    }));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Faculty Load Registry</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Resource Allocation Matrix</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <input type="text" placeholder="Personnel search..." value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} className="pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-xs font-bold shadow-sm outline-none focus:ring-2 focus:ring-[#d4af37]" />
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <button onClick={() => setActiveSection('PRIMARY')} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${activeSection === 'PRIMARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Primary</button>
            <button onClick={() => setActiveSection('SECONDARY')} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${activeSection === 'SECONDARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Secondary</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {filteredTeachers.map(teacher => {
          const teacherAssignmentsList = assignments.filter(a => a.teacherId === teacher.id);
          const isEditing = editingTeacherId === teacher.id;
          const currentTotal = calculateTeacherTotalPeriods(teacher.id, isEditing ? selectedGrade : undefined, isEditing ? editingLoads : []);
          
          return (
            <div key={teacher.id} className={`bg-white dark:bg-slate-900 rounded-[2.5rem] border transition-all duration-500 overflow-hidden ${isEditing ? 'ring-4 ring-[#d4af37] border-transparent shadow-2xl' : 'border-slate-100 dark:border-slate-800 shadow-lg'}`}>
              <div className="p-8 md:p-10 flex flex-col md:flex-row items-center justify-between bg-slate-50/50 dark:bg-slate-800/30 gap-6">
                <div className="flex items-center space-x-6">
                  <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center font-black text-xl shadow-xl transition-colors ${currentTotal > 28 ? 'bg-rose-500 text-white' : 'bg-[#001f3f] text-[#d4af37]'}`}>
                    {teacher.name.substring(0,2)}
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">{teacher.name}</h3>
                    <div className="flex items-center gap-3 mt-3">
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{teacher.employeeId}</span>
                       <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
                       <span className={`text-[10px] font-black uppercase ${currentTotal > 28 ? 'text-rose-500' : 'text-brand-gold'}`}>Load Index: {currentTotal} / 28P</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingTeacherId(isEditing ? null : teacher.id)} 
                  className={`px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase shadow-xl transition-all active:scale-95 ${isEditing ? 'bg-rose-500 text-white' : 'bg-[#001f3f] text-[#d4af37]'}`}
                >
                  {isEditing ? 'Discard Registry' : 'Manage Workload'}
                </button>
              </div>

              {isEditing && (
                <div className="p-8 md:p-12 space-y-10 bg-white dark:bg-slate-950 animate-in slide-in-from-top-4 duration-500">
                   {/* Step 1: Destination Selection */}
                   <div className="flex flex-col lg:flex-row gap-6 items-center border-b border-slate-100 dark:border-slate-800 pb-10">
                     <div className="w-full lg:w-1/3">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 block">Target Grade Division</label>
                        <select className="w-full px-6 py-4 rounded-2xl border-2 dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-xs font-black uppercase outline-none focus:border-[#d4af37] transition-all dark:text-white" value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)}>
                          <option value="">Choose Grade Unit...</option>
                          {getTeacherSpecificGrades(teacher).map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                     </div>
                     <div className="flex-1 w-full flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1">
                           <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                              <div style={{ width: `${Math.min(100, (currentTotal/28)*100)}%` }} className={`h-full transition-all duration-700 ${currentTotal > 28 ? 'bg-rose-500' : 'bg-[#001f3f]'}`}></div>
                           </div>
                           <div className="flex justify-between mt-2">
                              <span className="text-[8px] font-black text-slate-400 uppercase">Weekly Commitment Impact</span>
                              <span className={`text-[10px] font-black ${currentTotal > 28 ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>{currentTotal} / 28P</span>
                           </div>
                        </div>
                        <button onClick={handleAutoAssign} disabled={!selectedGrade} className="bg-sky-600 hover:bg-sky-700 text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase shadow-xl transition-all active:scale-95 flex items-center gap-3 disabled:opacity-30 border border-sky-400/20">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          Smart Suggest Load
                        </button>
                     </div>
                   </div>

                   {/* Step 2: Subject Matrix Builder */}
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                      {/* Left: Palette */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                           <h4 className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest italic">Institutional Palette</h4>
                           <span className="text-[8px] font-bold text-slate-400 uppercase">Available Units</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                           {sortedSubjects.map(sub => {
                             const isAssigned = editingLoads.some(l => l.subject === sub.name);
                             const isSpecial = isLimitedSubject(sub.name);
                             return (
                               <button 
                                 key={sub.id} 
                                 onClick={() => toggleSubject(sub.name)}
                                 className={`p-4 rounded-2xl border-2 text-left transition-all relative overflow-hidden group hover:scale-[1.02] active:scale-95 ${
                                   isAssigned 
                                     ? 'bg-[#001f3f] border-transparent text-white shadow-xl' 
                                     : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-400'
                                 }`}
                               >
                                  <span className="text-[10px] font-black uppercase leading-tight line-clamp-2">{sub.name}</span>
                                  <div className={`mt-2 flex items-center justify-between`}>
                                     <span className={`text-[7px] font-black px-1.5 py-0.5 rounded ${isSpecial ? 'bg-amber-400/20 text-amber-500' : 'bg-sky-400/20 text-sky-400'}`}>
                                       {isSpecial ? 'Special' : 'Core'}
                                     </span>
                                     {isAssigned && <svg className="w-3 h-3 text-[#d4af37]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>}
                                  </div>
                               </button>
                             );
                           })}
                        </div>
                      </div>

                      {/* Right: Load Configurator */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                           <h4 className="text-[11px] font-black text-brand-gold uppercase tracking-widest italic">Assignment Stage</h4>
                           <span className="text-[8px] font-bold text-slate-400 uppercase">{editingLoads.length} Selected</span>
                        </div>
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                           {editingLoads.map(load => {
                             const isSpecial = isLimitedSubject(load.subject);
                             return (
                               <div key={load.subject} className="bg-slate-50 dark:bg-slate-900 p-5 rounded-3xl border border-slate-100 dark:border-slate-800 flex items-center justify-between group animate-in slide-in-from-right-4 duration-300">
                                  <div className="space-y-1">
                                     <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{load.subject}</p>
                                     <div className="flex gap-2">
                                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded border ${isSpecial ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                                          {isSpecial ? '1P Institutional Policy' : 'Multi-Period Track'}
                                        </span>
                                     </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-6">
                                     <div className="flex items-center bg-white dark:bg-slate-950 p-1.5 rounded-2xl border shadow-sm">
                                        <button 
                                          disabled={isSpecial}
                                          onClick={() => updatePeriods(load.subject, -1)}
                                          className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-lg transition-colors ${isSpecial ? 'text-slate-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-[#001f3f] dark:text-white'}`}
                                        >
                                          −
                                        </button>
                                        <div className="w-12 text-center">
                                           <span className="text-sm font-black text-[#001f3f] dark:text-white tabular-nums">{load.periods}</span>
                                           <p className="text-[6px] font-black text-slate-400 uppercase leading-none">Periods</p>
                                        </div>
                                        <button 
                                          disabled={isSpecial}
                                          onClick={() => updatePeriods(load.subject, 1)}
                                          className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-lg transition-colors ${isSpecial ? 'text-slate-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-[#001f3f] dark:text-white'}`}
                                        >
                                          +
                                        </button>
                                     </div>
                                     <button onClick={() => toggleSubject(load.subject)} className="text-rose-400 hover:text-rose-600 transition-colors p-2">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                     </button>
                                  </div>
                               </div>
                             );
                           })}
                           {editingLoads.length === 0 && (
                             <div className="py-20 text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem]">
                                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Awaiting Subject Selection</p>
                             </div>
                           )}
                        </div>
                      </div>
                   </div>

                   {status && (
                      <div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase border tracking-widest animate-in zoom-in duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : status.type === 'warning' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                        {status.message}
                      </div>
                   )}

                   <button 
                     onClick={saveAssignment} 
                     disabled={!selectedGrade || editingLoads.length === 0} 
                     className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.3em] shadow-2xl transition-all hover:bg-slate-900 border border-amber-400/20 active:scale-[0.98] disabled:opacity-50"
                   >
                     Authorize Deployment Matrix
                   </button>
                </div>
              )}

              {/* Collapsed/Default View of Active Assignments */}
              {!isEditing && (
                <div className="p-8 md:p-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 bg-white dark:bg-slate-900">
                   {teacherAssignmentsList.map(a => (
                     <div key={a.id} className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 relative group hover:shadow-lg transition-all">
                        <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase mb-5 italic tracking-tight">{a.grade}</p>
                        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                          {a.loads.map(l => {
                            const isSpecial = isLimitedSubject(l.subject);
                            return (
                              <div key={l.subject} className="flex justify-between items-center text-[10px] font-black uppercase">
                                 <div className="flex items-center space-x-2 truncate">
                                   <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSpecial ? 'bg-amber-400' : 'bg-sky-400'}`}></div>
                                   <span className="text-slate-500 dark:text-slate-400 truncate tracking-tight">{l.subject}</span>
                                 </div>
                                 <span className={`px-2 py-0.5 rounded border font-black text-[9px] ${isSpecial ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200'}`}>
                                   {l.periods}P
                                 </span>
                              </div>
                            );
                          })}
                        </div>
                     </div>
                   ))}
                   {teacherAssignmentsList.length === 0 && (
                      <div className="col-span-full py-16 text-center opacity-30">
                        <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        <p className="text-[10px] font-black uppercase tracking-widest">No assigned institutional periods</p>
                      </div>
                   )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FacultyAssignmentView;

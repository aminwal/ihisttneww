
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, Subject, SubjectLoad, SubstitutionRecord, TimeTableEntry } from '../types.ts';

interface FacultyAssignmentViewProps {
  users: User[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  substitutions: SubstitutionRecord[];
  timetable: TimeTableEntry[];
  triggerConfirm: (message: string, onConfirm: () => void) => void;
  currentUser: User; 
}

const FacultyAssignmentView: React.FC<FacultyAssignmentViewProps> = ({ users, config, assignments, setAssignments, substitutions, timetable, triggerConfirm, currentUser }) => {
  const [activeSection, setActiveSection] = useState<'PRIMARY' | 'SECONDARY' | 'SENIOR_SECONDARY'>(() => {
    if (currentUser.role === UserRole.TEACHER_SENIOR_SECONDARY) return 'SENIOR_SECONDARY';
    if (currentUser.role === UserRole.INCHARGE_SECONDARY) return 'SECONDARY';
    return 'PRIMARY';
  });

  const [teacherSearch, setTeacherSearch] = useState('');
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [editingLoads, setEditingLoads] = useState<SubjectLoad[]>([]);
  const [manualGroupPeriods, setManualGroupPeriods] = useState<number>(0);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  const getWeekRange = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); 
    const sunday = new Date(date);
    sunday.setDate(date.getDate() - dayOfWeek);
    const thursday = new Date(sunday);
    thursday.setDate(sunday.getDate() + 4);
    return { start: sunday.toISOString().split('T')[0], end: thursday.toISOString().split('T')[0] };
  }, []);

  const calculateTeacherWorkloadBreakdown = useCallback((teacherId: string, currentGrade?: string, currentGradeLoads: SubjectLoad[] = [], currentManualGroup: number = 0) => {
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    let authorizedRegistryTotal = 0;
    
    teacherAssignments.forEach(a => {
      if (a.grade !== currentGrade) {
        authorizedRegistryTotal += a.loads.reduce((sum, l) => sum + (Number(l.periods) || 0), 0);
        authorizedRegistryTotal += (a.groupPeriods || 0);
      }
    });

    if (currentGrade) {
      authorizedRegistryTotal += currentGradeLoads.reduce((sum, l) => sum + (Number(l.periods) || 0), 0);
      authorizedRegistryTotal += currentManualGroup;
    }

    const uniqueSlots = new Set<string>();
    timetable.forEach(t => {
      if (t.date) return;
      if (t.teacherId === teacherId) {
        uniqueSlots.add(`${t.day}-${t.slotId}`);
      } else if (t.blockId) {
        const block = config.combinedBlocks.find(b => b.id === t.blockId);
        if (block?.allocations.some(a => a.teacherId === teacherId)) {
          uniqueSlots.add(`${t.day}-${t.slotId}`);
        }
      }
    });
    const scheduledTotal = uniqueSlots.size;

    const { start, end } = getWeekRange(new Date().toISOString().split('T')[0]);
    const proxyCount = substitutions.filter(s => 
      s.substituteTeacherId === teacherId && s.date >= start && s.date <= end && !s.isArchived
    ).length;

    return {
      authorized: authorizedRegistryTotal,
      scheduled: scheduledTotal,
      proxies: proxyCount,
      totalLive: scheduledTotal + proxyCount,
      isFullyScheduled: scheduledTotal >= authorizedRegistryTotal && authorizedRegistryTotal > 0
    };
  }, [assignments, timetable, substitutions, config.combinedBlocks, getWeekRange]);

  const sortedSubjects = useMemo(() => {
    return [...config.subjects].sort((a, b) => {
      if (a.category !== b.category) {
        if (a.category === SubjectCategory.CORE) return -1;
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [config.subjects]);

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (u.role === UserRole.ADMIN || u.isResigned) return false;
      const allRoles = [u.role, ...(u.secondaryRoles || [])];
      const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === UserRole.INCHARGE_ALL);
      const isSecondary = allRoles.some(r => r === UserRole.TEACHER_SECONDARY || r === UserRole.INCHARGE_SECONDARY || r === UserRole.INCHARGE_ALL);
      const isSenior = allRoles.some(r => r === UserRole.TEACHER_SENIOR_SECONDARY || r === UserRole.INCHARGE_ALL);

      if (activeSection === 'PRIMARY' && !isPrimary) return false;
      if (activeSection === 'SECONDARY' && !isSecondary) return false;
      if (activeSection === 'SENIOR_SECONDARY' && !isSenior) return false;

      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, activeSection, teacherSearch]);

  const getTeacherSpecificGrades = (teacher: User) => {
    const allRoles = [teacher.role, ...(teacher.secondaryRoles || [])];
    const isPrimaryTeacher = allRoles.some(r => r.includes('PRIMARY'));
    const isSecondaryTeacher = allRoles.some(r => r.includes('SECONDARY'));
    const isGlobal = allRoles.some(r => r === UserRole.ADMIN || r === UserRole.INCHARGE_ALL);

    const grades = config.classes
      .filter(c => {
        if (isGlobal) return true;
        if (isPrimaryTeacher && c.section === 'PRIMARY') return true;
        if (isSecondaryTeacher && (c.section.includes('SECONDARY') || c.section.includes('SENIOR'))) return true;
        return false;
      })
      .map(c => {
        const romanMatch = c.name.match(/[IVX]+/);
        return romanMatch ? `Grade ${romanMatch[0]}` : c.name;
      });
    
    return Array.from(new Set(grades)).sort();
  };

  const getAvailableSectionsForGrade = (grade: string) => {
    return config.classes
      .filter(c => {
        const romanMatch = c.name.match(/[IVX]+/);
        const g = romanMatch ? `Grade ${romanMatch[0]}` : c.name;
        return g === grade;
      })
      .map(c => c.name)
      .sort();
  };

  const handleSaveAssignment = () => {
    if (!editingTeacherId || !selectedGrade || (editingLoads.length === 0 && manualGroupPeriods === 0)) return;
    const stats = calculateTeacherWorkloadBreakdown(editingTeacherId, selectedGrade, editingLoads, manualGroupPeriods);
    
    if (stats.authorized > 28) {
      triggerConfirm(`Intensity Alert: Authorized load (${stats.authorized}P) exceeds 28P limit. Continue?`, () => {
        commitAssignment();
      });
    } else {
      commitAssignment();
    }
  };

  const commitAssignment = () => {
    const newAssignment: TeacherAssignment = {
      id: `${editingTeacherId}-${selectedGrade}`,
      teacherId: editingTeacherId!,
      grade: selectedGrade,
      loads: editingLoads.map(l => ({ ...l, room: undefined })),
      targetSections: selectedSections.length > 0 ? selectedSections : undefined,
      groupPeriods: manualGroupPeriods
    };
    setAssignments(prev => [
      ...prev.filter(a => !(a.teacherId === editingTeacherId && a.grade === selectedGrade)),
      newAssignment
    ]);
    setEditingTeacherId(null);
    setSelectedGrade('');
    setSelectedSections([]);
    setManualGroupPeriods(0);
    setStatus({ type: 'success', message: 'Registry Matrix Authorized.' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2 pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Faculty Load Registry</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Strategic Resource Deployment</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <input 
            type="text" 
            placeholder="Search Faculty..." 
            value={teacherSearch} 
            onChange={e => setTeacherSearch(e.target.value)} 
            className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-xs font-bold shadow-sm outline-none focus:ring-2 focus:ring-[#d4af37]" 
          />
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800 shadow-sm overflow-x-auto">
            <button onClick={() => setActiveSection('PRIMARY')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap ${activeSection === 'PRIMARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Primary</button>
            <button onClick={() => setActiveSection('SECONDARY')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap ${activeSection === 'SECONDARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Secondary</button>
            <button onClick={() => setActiveSection('SENIOR_SECONDARY')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap ${activeSection === 'SENIOR_SECONDARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Senior</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {filteredTeachers.map(teacher => {
          const stats = calculateTeacherWorkloadBreakdown(teacher.id, 
            editingTeacherId === teacher.id ? selectedGrade : undefined,
            editingTeacherId === teacher.id ? editingLoads : [],
            editingTeacherId === teacher.id ? manualGroupPeriods : 0
          );
          const isEditing = editingTeacherId === teacher.id;
          const utilizationPercent = stats.authorized > 0 ? (stats.scheduled / stats.authorized) * 100 : 0;
          
          return (
            <div key={teacher.id} className={`bg-white dark:bg-slate-900 rounded-[2.5rem] border transition-all duration-500 ${isEditing ? 'ring-4 ring-amber-400 border-transparent shadow-2xl' : 'border-slate-100 dark:border-slate-800 shadow-lg'}`}>
              <div className="p-8 flex flex-col lg:flex-row items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                   <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-xl shadow-xl ${stats.authorized > 28 ? 'bg-rose-500 text-white' : 'bg-[#001f3f] text-[#d4af37]'}`}>
                     {teacher.name.substring(0,2)}
                   </div>
                   <div>
                      <h3 className="text-xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">{teacher.name}</h3>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">{teacher.employeeId} • {teacher.role.replace(/_/g, ' ')}</p>
                      
                      <div className="mt-4 flex flex-wrap gap-4">
                         <div className="space-y-1">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Registry Target (Auth)</p>
                            <p className="text-sm font-black text-[#001f3f] dark:text-white">{stats.authorized}P</p>
                         </div>
                         <div className="space-y-1">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Scheduled Basis</p>
                            <p className="text-sm font-black text-sky-600">{stats.scheduled}P</p>
                         </div>
                         <div className="space-y-1">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Proxy Load</p>
                            <p className="text-sm font-black text-amber-500">{stats.proxies}P</p>
                         </div>
                      </div>
                   </div>
                </div>

                <div className="flex flex-col items-center lg:items-end gap-4 w-full lg:w-auto">
                   <div className="w-full lg:w-48 space-y-2">
                      <div className="flex justify-between items-end">
                         <span className="text-[9px] font-black text-slate-400 uppercase">Deployment Progress</span>
                         <span className="text-[10px] font-black text-[#001f3f] dark:text-white">{Math.round(utilizationPercent)}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
                         <div 
                           style={{ width: `${Math.min(100, utilizationPercent)}%` }} 
                           className={`h-full transition-all duration-1000 ${stats.isFullyScheduled ? 'bg-emerald-500' : 'bg-[#001f3f]'}`}
                         ></div>
                      </div>
                   </div>
                   <button 
                     onClick={() => {
                        if (isEditing) {
                          setEditingTeacherId(null);
                        } else {
                          setEditingTeacherId(teacher.id);
                          const currentAsgn = assignments.find(a => a.teacherId === teacher.id);
                          if (currentAsgn) {
                            setSelectedGrade(currentAsgn.grade);
                            setEditingLoads(currentAsgn.loads);
                            setSelectedSections(currentAsgn.targetSections || []);
                            setManualGroupPeriods(currentAsgn.groupPeriods || 0);
                          } else {
                            setSelectedGrade('');
                            setEditingLoads([]);
                            setSelectedSections([]);
                            setManualGroupPeriods(0);
                          }
                        }
                     }}
                     className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase transition-all shadow-lg active:scale-95 ${isEditing ? 'bg-rose-50 text-white' : 'bg-[#001f3f] text-[#d4af37]'}`}
                   >
                     {isEditing ? 'Discard Edit' : 'Manage Workload'}
                   </button>
                </div>
              </div>

              {isEditing && (
                <div className="p-8 border-t border-slate-50 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/50 space-y-8 animate-in slide-in-from-top-4 duration-500">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                         <div className="space-y-4">
                            <label className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">1. Target Academic Grade</label>
                            <select 
                              className="w-full px-6 py-4 rounded-2xl border-2 dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-xs font-black uppercase outline-none focus:border-amber-400 transition-all dark:text-white"
                              value={selectedGrade}
                              onChange={e => {
                                setSelectedGrade(e.target.value);
                                setSelectedSections([]);
                                const matchedAsgn = assignments.find(a => a.teacherId === teacher.id && a.grade === e.target.value);
                                if (matchedAsgn) {
                                  setEditingLoads(matchedAsgn.loads);
                                  setSelectedSections(matchedAsgn.targetSections || []);
                                  setManualGroupPeriods(matchedAsgn.groupPeriods || 0);
                                }
                              }}
                            >
                              <option value="">Select Grade...</option>
                              {getTeacherSpecificGrades(teacher).map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                         </div>

                         {selectedGrade && (
                           <div className="space-y-4 animate-in fade-in duration-300">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Optional: Restrict to Sections</label>
                              <div className="flex flex-wrap gap-2">
                                 {getAvailableSectionsForGrade(selectedGrade).map(sect => (
                                   <button 
                                     key={sect}
                                     onClick={() => {
                                        setSelectedSections(prev => 
                                          prev.includes(sect) ? prev.filter(s => s !== sect) : [...prev, sect]
                                        );
                                     }}
                                     className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${
                                       selectedSections.includes(sect) 
                                       ? 'bg-sky-600 text-white border-transparent' 
                                       : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
                                     }`}
                                   >
                                      {sect}
                                   </button>
                                 ))}
                              </div>
                              <p className="text-[8px] font-bold text-slate-300 italic">* Leave blank to deploy across all sections of this grade.</p>
                           </div>
                         )}

                         <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                            <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Group Period Manual Entry</label>
                            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border-2 border-amber-100 dark:border-amber-900/30">
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-3">Parallel Periods Assigned to {teacher.name.split(' ')[0]}</p>
                               <input 
                                 type="number" 
                                 className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-black text-sm text-[#001f3f] dark:text-white"
                                 value={manualGroupPeriods}
                                 onChange={e => setManualGroupPeriods(Math.max(0, parseInt(e.target.value) || 0))}
                               />
                               <p className="text-[7px] font-bold text-slate-400 mt-3 uppercase italic leading-none">* This number adds to the authorized target load</p>
                            </div>
                         </div>
                      </div>

                      <div className="space-y-4">
                         <label className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">2. Curriculum Selection</label>
                         <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto p-4 bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-inner scrollbar-hide">
                            {sortedSubjects.map(sub => {
                              const isSelected = editingLoads.some(l => l.subject === sub.name);
                              return (
                                <button 
                                  key={sub.id} 
                                  onClick={() => {
                                     setEditingLoads(prev => 
                                       isSelected ? prev.filter(l => l.subject !== sub.name) : [...prev, { subject: sub.name, periods: 6 }]
                                     );
                                  }}
                                  className={`p-3 rounded-xl border-2 text-[9px] font-black uppercase transition-all ${isSelected ? 'bg-[#001f3f] text-white border-transparent shadow-md' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-50 dark:border-slate-800 hover:border-amber-100'}`}
                                >
                                   {sub.name}
                                </button>
                              );
                            })}
                         </div>
                      </div>
                   </div>

                   {editingLoads.length > 0 && (
                     <div className="space-y-4">
                        <label className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">3. Period Quantities</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                           {editingLoads.map(load => (
                             <div key={load.subject} className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
                                <p className="text-[10px] font-black text-sky-600 uppercase italic truncate">{load.subject}</p>
                                <div className="space-y-1">
                                   <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Authorized Weekly Periods</p>
                                   <input 
                                     type="number" 
                                     className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-3 py-3 font-black text-xs text-[#001f3f] dark:text-white"
                                     value={load.periods}
                                     onChange={e => {
                                        const val = parseInt(e.target.value) || 0;
                                        setEditingLoads(prev => prev.map(l => l.subject === load.subject ? { ...l, periods: val } : l));
                                     }}
                                   />
                                </div>
                             </div>
                           ))}
                        </div>
                     </div>
                   )}

                   <div className="flex justify-center pt-4">
                      <button 
                        onClick={handleSaveAssignment}
                        disabled={!selectedGrade || (editingLoads.length === 0 && manualGroupPeriods === 0)}
                        className="px-12 py-5 bg-[#001f3f] text-[#d4af37] rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-950 transition-all transform active:scale-95 disabled:opacity-30"
                      >
                        Authorize Matrix Update
                      </button>
                   </div>
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

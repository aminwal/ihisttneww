import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isGlobalIncharge = currentUser.role === UserRole.INCHARGE_ALL;
  
  const [activeSection, setActiveSection] = useState<'PRIMARY' | 'SECONDARY'>(
    currentUser.role === UserRole.INCHARGE_SECONDARY ? 'SECONDARY' : 'PRIMARY'
  );

  const [teacherSearch, setTeacherSearch] = useState('');
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [editingLoads, setEditingLoads] = useState<SubjectLoad[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkTargetAssignment, setBulkTargetAssignment] = useState<TeacherAssignment | null>(null);
  const [bulkSelectedSubjects, setBulkSelectedSubjects] = useState<string[]>([]);
  const [bulkPeriodCount, setBulkPeriodCount] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSinglePeriodSubject = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('art') || n.includes('phe') || n.includes('library') || n.includes('physical education');
  };

  const sortedSubjects = useMemo(() => {
    return [...config.subjects].sort((a, b) => {
      // Primary sort: Category (CORE first, then alphabetical)
      if (a.category !== b.category) {
        if (a.category === SubjectCategory.CORE) return -1;
        if (b.category === SubjectCategory.CORE) return 1;
        return a.category.localeCompare(b.category);
      }
      // Secondary sort: Subject Name alphabetical
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
    const isPrimaryTeacher = teacher.role === UserRole.TEACHER_PRIMARY || teacher.role === UserRole.INCHARGE_PRIMARY;
    const isSecondaryTeacher = teacher.role === UserRole.TEACHER_SECONDARY || 
                               teacher.role === UserRole.TEACHER_SENIOR_SECONDARY || 
                               teacher.role === UserRole.INCHARGE_SECONDARY;
    const isGlobal = teacher.role === UserRole.ADMIN || teacher.role === UserRole.INCHARGE_ALL || teacher.role === UserRole.ADMIN_STAFF;

    const grades = config.classes
      .filter(c => {
        if (isGlobal) return true;
        if (isPrimaryTeacher) return c.section === 'PRIMARY';
        if (isSecondaryTeacher) return c.section === 'SECONDARY_BOYS' || c.section === 'SECONDARY_GIRLS';
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

  const toggleSubject = (subjectName: string) => {
    const exists = editingLoads.find(l => l.subject === subjectName);
    if (exists) {
      setEditingLoads(prev => prev.filter(l => l.subject !== subjectName));
    } else {
      if (editingLoads.length >= 8) {
        alert("Maximum of 8 subjects per grade.");
        return;
      }
      const defaultPeriods = isSinglePeriodSubject(subjectName) ? 1 : 6;
      setEditingLoads(prev => [...prev, { subject: subjectName, periods: defaultPeriods }]);
    }
  };

  const calculateTeacherTotalPeriods = (teacherId: string, currentGrade?: string, currentGradeLoads: SubjectLoad[] = []) => {
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    let total = 0;
    
    teacherAssignments.forEach(a => {
      if (a.grade !== currentGrade) {
        total += a.loads.reduce((sum, l) => sum + l.periods, 0);
      }
    });

    if (currentGrade) {
      total += currentGradeLoads.reduce((sum, l) => sum + l.periods, 0);
    }
    return total;
  };

  const handleAutoAssign = () => {
    if (!editingTeacherId || !selectedGrade) return;

    const currentBaseLoad = assignments
      .filter(a => a.teacherId === editingTeacherId && a.grade !== selectedGrade)
      .reduce((sum, a) => sum + a.loads.reduce((s, l) => s + l.periods, 0), 0);
    
    const capacity = 28 - currentBaseLoad;
    if (capacity <= 0) {
      setStatus({ type: 'error', message: 'Faculty workload capacity exhausted (28/28).' });
      return;
    }

    const subjectStats = config.subjects.map(sub => {
      const globalLoadCount = assignments
        .filter(a => a.grade === selectedGrade)
        .reduce((sum, a) => sum + (a.loads.find(l => l.subject === sub.name)?.periods || 0), 0);
      return { ...sub, globalLoadCount };
    });

    const prioritySubjects = [...subjectStats].sort((a, b) => {
      if (a.category === SubjectCategory.CORE && b.category !== SubjectCategory.CORE) return -1;
      if (a.category !== SubjectCategory.CORE && b.category === SubjectCategory.CORE) return 1;
      if (a.globalLoadCount !== b.globalLoadCount) return a.globalLoadCount - b.globalLoadCount;
      return a.name.localeCompare(b.name);
    });

    let allocatedPeriods = 0;
    const newLoads: SubjectLoad[] = [];

    for (const sub of prioritySubjects) {
      if (newLoads.length >= 8) break;

      const isSpecial = isSinglePeriodSubject(sub.name);
      const periodsToAssign = isSpecial ? 1 : 6;

      if (allocatedPeriods + periodsToAssign <= capacity) {
        newLoads.push({ subject: sub.name, periods: periodsToAssign });
        allocatedPeriods += periodsToAssign;
      } else if (!isSpecial && allocatedPeriods < capacity) {
        const remaining = capacity - allocatedPeriods;
        if (remaining > 0) {
          newLoads.push({ subject: sub.name, periods: remaining });
          allocatedPeriods += remaining;
        }
        break;
      }
    }

    setEditingLoads(newLoads);
    setStatus({ type: 'success', message: `Pattern generated: ${allocatedPeriods} periods assigned.` });
  };

  const commitToAssignments = (teacherId: string, grade: string, loads: SubjectLoad[]) => {
    setIsUpdating(true);
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
    setTimeout(() => {
      setIsUpdating(false);
      setEditingTeacherId(null);
      setSelectedGrade('');
      setStatus({ type: 'success', message: 'Allocation committed to cloud.' });
    }, 400);
  };

  const saveAssignment = () => {
    if (!editingTeacherId || !selectedGrade || editingLoads.length === 0) return;
    const totalLoad = calculateTeacherTotalPeriods(editingTeacherId, selectedGrade, editingLoads);
    if (totalLoad > 28) {
      triggerConfirm(
        `Load Alert: Total workload (${totalLoad}) exceeds the 28-period limit. Proceed with override?`,
        () => commitToAssignments(editingTeacherId, selectedGrade, editingLoads)
      );
      return;
    }
    commitToAssignments(editingTeacherId, selectedGrade, editingLoads);
  };

  const handleExportCSV = () => {
    const headers = ["Employee ID", "Teacher Name", "Grade", "Subjects", "Total Periods"];
    const rows = assignments.map(a => {
      const teacher = users.find(u => u.id === a.teacherId);
      const subjectsStr = a.loads.map(l => `${l.subject}(${l.periods})`).join('; ');
      const total = a.loads.reduce((sum, l) => sum + l.periods, 0);
      return [
        teacher?.employeeId || 'N/A',
        teacher?.name || 'Unknown',
        a.grade,
        `"${subjectsStr}"`,
        total
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Faculty_Assignments_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus({ type: 'success', message: 'Assignment manifest exported.' });
  };

  const openBulkModal = (assignment: TeacherAssignment) => {
    setBulkTargetAssignment(assignment);
    setBulkSelectedSubjects(assignment.loads.map(l => l.subject));
    setBulkPeriodCount(assignment.loads[0]?.periods || 1);
    setIsBulkModalOpen(true);
  };

  const saveBulkAllocation = () => {
    if (!bulkTargetAssignment || bulkSelectedSubjects.length === 0) return;
    const newLoads: SubjectLoad[] = bulkSelectedSubjects.map(s => ({ 
      subject: s, 
      periods: isSinglePeriodSubject(s) ? 1 : bulkPeriodCount 
    }));
    const totalLoad = calculateTeacherTotalPeriods(bulkTargetAssignment.teacherId, bulkTargetAssignment.grade, newLoads);
    
    const executeBulkSave = () => {
      const targetSections = config.classes.filter(c => getGradeFromClassName(c.name) === bulkTargetAssignment.grade).map(c => c.name);
      const updatedAssignment: TeacherAssignment = { ...bulkTargetAssignment, loads: newLoads, targetSections: targetSections };
      setAssignments(assignments.map(a => a.id === updatedAssignment.id ? updatedAssignment : a));
      setIsBulkModalOpen(false);
      setBulkTargetAssignment(null);
      setStatus({ type: 'success', message: 'Bulk distribution applied.' });
    };

    if (totalLoad > 28) {
      triggerConfirm(`Bulk Load Alert: Cumulative workload (${totalLoad}) exceeds 28. Proceed?`, executeBulkSave);
      return;
    }
    executeBulkSave();
  };

  const clearAllTeacherAssignments = (teacherId: string) => {
    triggerConfirm("Purge ALL subject allocations for this faculty member?", () => {
      setAssignments(prev => prev.filter(a => a.teacherId !== teacherId));
      setStatus({ type: 'success', message: 'Faculty load purged.' });
    });
  };

  const deleteGradeAssignment = (assignmentId: string) => {
    triggerConfirm("Remove this specific grade assignment?", () => {
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
      setStatus({ type: 'success', message: 'Assignment removed.' });
    });
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newAssignments: TeacherAssignment[] = [];
      if (content.trim().startsWith('<?xml')) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const rows = xmlDoc.getElementsByTagName("Row");
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].getElementsByTagName("Cell");
          const empId = cells[0]?.getElementsByTagName("Data")[0]?.textContent?.trim()?.toLowerCase();
          const grade = cells[1]?.getElementsByTagName("Data")[0]?.textContent?.trim();
          if (!empId || empId === 'employeeid' || !grade) continue;
          const teacher = users.find(u => u.employeeId.toLowerCase() === empId);
          if (!teacher) continue;
          const loads: SubjectLoad[] = [];
          for (let pair = 0; pair < 4; pair++) {
            const subName = cells[2 + pair * 2]?.getElementsByTagName("Data")[0]?.textContent?.trim();
            const periodsRaw = parseInt(cells[3 + pair * 2]?.getElementsByTagName("Data")[0]?.textContent?.trim() || '0');
            const periods = (subName && isSinglePeriodSubject(subName)) ? 1 : periodsRaw;
            if (subName && periods > 0 && config.subjects.some(s => s.name === subName)) {
              loads.push({ subject: subName, periods });
            }
          }
          if (loads.length > 0) newAssignments.push({ id: `${teacher.id}-${grade}`, teacherId: teacher.id, grade, loads });
        }
      }
      if (newAssignments.length > 0) {
        setAssignments(prev => {
          let updated = [...prev];
          newAssignments.forEach(na => {
            updated = updated.filter(a => !(a.teacherId === na.teacherId && a.grade === na.grade));
            updated.push(na);
          });
          return updated;
        });
        setStatus({ type: 'success', message: `Synced ${newAssignments.length} records.` });
      } else setStatus({ type: 'error', message: "No compatible data identified." });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (u.role === UserRole.ADMIN) return false;
      
      if (!isAdmin && !isGlobalIncharge) {
        if (currentUser.role === UserRole.INCHARGE_PRIMARY) {
          const isPrimary = u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY;
          if (!isPrimary) return false;
        } else if (currentUser.role === UserRole.INCHARGE_SECONDARY) {
          const isSecondary = u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.TEACHER_SENIOR_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY;
          if (!isSecondary) return false;
        }
      }

      if (isAdmin || isGlobalIncharge) {
        const isPrimary = u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY || u.role === UserRole.INCHARGE_ALL;
        const isSecondary = u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.TEACHER_SENIOR_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY || u.role === UserRole.INCHARGE_ALL;
        if (activeSection === 'PRIMARY' && !isPrimary) return false;
        if (activeSection === 'SECONDARY' && !isSecondary) return false;
      }

      const searchLower = teacherSearch.toLowerCase().trim();
      if (!searchLower) return true;
      return u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, activeSection, teacherSearch, currentUser, isAdmin, isGlobalIncharge]);

  return (
    <div className="space-y-4 md:space-y-8 animate-in fade-in duration-700 w-full px-2">
      {/* Hero Section */}
      <div className="bg-[#001f3f] rounded-2xl md:rounded-[2.5rem] p-6 md:p-10 text-white shadow-xl border border-[#d4af37]/20">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="text-xl md:text-3xl font-black italic tracking-tight mb-2 uppercase">Faculty Workload Matrix</h2>
            <p className="text-amber-100/60 text-[8px] md:text-xs font-bold uppercase tracking-[0.2em]">Institutional Policy: Max 28 Periods | Art/PHE/Lib: 1 Period Only</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => triggerConfirm("Purge GLOBAL load data?", () => setAssignments([]))} className="flex-1 md:flex-none px-4 py-2 bg-red-600 text-white text-[9px] font-black uppercase rounded-xl shadow hover:bg-red-700 transition-colors">Reset</button>
            <button onClick={handleExportCSV} className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 text-white text-[9px] font-black uppercase rounded-xl shadow hover:bg-emerald-700 transition-colors">Export CSV</button>
            <div className="flex bg-white/10 p-1 rounded-xl border border-white/20 w-full md:w-auto">
               <label className="flex-1 md:flex-none px-4 py-2 bg-amber-400 text-[#001f3f] text-[9px] font-black uppercase rounded-lg cursor-pointer text-center">
                Upload XML
                <input type="file" ref={fileInputRef} accept=".xml" className="hidden" onChange={handleBulkUpload} />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] italic">Teaching Loads</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Section: {activeSection}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-3 items-center w-full xl:w-auto">
          {status && (
            <div className={`px-4 py-2 rounded-xl border text-[8px] font-black uppercase tracking-widest ${status.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {status.message}
            </div>
          )}
          <input type="text" placeholder="Search faculty..." value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)} className="w-full md:w-64 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-amber-400 shadow-sm" />
          {(isAdmin || isGlobalIncharge) && (
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-full md:w-auto">
              <button onClick={() => setActiveSection('PRIMARY')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeSection === 'PRIMARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Primary</button>
              <button onClick={() => setActiveSection('SECONDARY')} className={`flex-1 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${activeSection === 'SECONDARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Secondary</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6">
        {filteredTeachers.map(teacher => {
          const teacherAssignmentsList = assignments.filter(a => a.teacherId === teacher.id);
          const isEditing = editingTeacherId === teacher.id;
          const totalLoad = calculateTeacherTotalPeriods(teacher.id, isEditing ? selectedGrade : undefined, isEditing ? editingLoads : []);

          return (
            <div key={teacher.id} className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-lg overflow-hidden transition-all duration-300">
              <div className="p-4 md:p-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center space-x-4 w-full sm:w-auto">
                  <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-lg flex-shrink-0">{teacher.name.substring(0,2)}</div>
                  <div className="min-w-0">
                    <h3 className="text-sm md:text-lg font-black text-[#001f3f] dark:text-white italic truncate">{teacher.name}</h3>
                    <p className={`text-[8px] md:text-[10px] font-black uppercase tracking-widest mt-1 ${totalLoad > 28 ? 'text-red-500' : 'text-amber-500'}`}>
                      Assigned Load: {totalLoad}/28
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2 w-full sm:w-auto">
                  {!isEditing && teacherAssignmentsList.length > 0 && (
                    <button onClick={() => clearAllTeacherAssignments(teacher.id)} className="flex-1 sm:flex-none px-4 py-2 bg-red-50 text-red-500 rounded-xl text-[9px] font-black uppercase border border-red-100">Purge</button>
                  )}
                  <button onClick={() => setEditingTeacherId(isEditing ? null : teacher.id)} className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${isEditing ? 'bg-red-500 text-white' : 'bg-amber-400 text-white shadow-lg shadow-amber-900/10'}`}>
                    {isEditing ? 'Cancel' : 'Manage Load'}
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="p-6 md:p-10 border-t border-slate-100 dark:border-slate-800 bg-amber-50/10 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select className="flex-1 px-5 py-4 rounded-xl border-2 dark:bg-slate-900 dark:border-slate-700 text-[10px] font-black uppercase" value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)}>
                          <option value="">Choose Grade...</option>
                          {getTeacherSpecificGrades(teacher).map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <button 
                          onClick={handleAutoAssign} 
                          disabled={!selectedGrade} 
                          className="px-6 py-4 bg-[#001f3f] text-[#d4af37] rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-slate-900 transition-all disabled:opacity-50"
                        >
                          Auto-assign
                        </button>
                      </div>
                      <div className="space-y-2">
                        {editingLoads.map(load => {
                          const isSpecial = isSinglePeriodSubject(load.subject);
                          return (
                            <div key={load.subject} className={`flex items-center justify-between p-3 rounded-xl border shadow-sm transition-all ${isSpecial ? 'bg-amber-100/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
                              <span className={`text-[10px] font-black truncate pr-2 uppercase ${isSpecial ? 'text-amber-700 dark:text-amber-500' : 'text-[#001f3f] dark:text-white'}`}>
                                {load.subject}
                              </span>
                              <div className="flex items-center space-x-2">
                                <input 
                                  type="number" 
                                  className={`w-12 px-2 py-1 bg-white dark:bg-slate-800 border rounded-lg text-center text-xs font-black dark:text-white ${isSpecial ? 'opacity-50 cursor-not-allowed border-amber-300' : 'border-slate-200'}`} 
                                  value={load.periods} 
                                  readOnly={isSpecial}
                                  onChange={e => setEditingLoads(prev => prev.map(l => l.subject === load.subject ? { ...l, periods: parseInt(e.target.value) || 1 } : l))} 
                                  min="1" 
                                  max={isSpecial ? 1 : 10} 
                                />
                                {isSpecial && (
                                  <span className="flex items-center gap-1 text-[7px] font-black text-amber-600 uppercase">
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                    Fixed
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto bg-white/50 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-100 scrollbar-hide">
                        {sortedSubjects.map(s => (
                          <button key={s.id} onClick={() => toggleSubject(s.name)} className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase border transition-all ${editingLoads.some(l => l.subject === s.name) ? 'bg-amber-400 text-white border-transparent' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>{s.name}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={saveAssignment} disabled={!selectedGrade || editingLoads.length === 0} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[10px] uppercase shadow-xl disabled:opacity-50">Authorize Allocation</button>
                </div>
              )}
              
              <div className="p-4 md:p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {teacherAssignmentsList.map(a => (
                    <div key={a.id} className="bg-slate-50 dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 relative group transition-all hover:ring-2 hover:ring-amber-400/30">
                      <div className="flex justify-between items-start mb-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-tight truncate">{a.grade}</p>
                        </div>
                        <div className="flex gap-1">
                           <button onClick={() => openBulkModal(a)} className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-lg text-xs font-black flex items-center justify-center">+</button>
                           <button onClick={() => deleteGradeAssignment(a.id)} className="w-6 h-6 bg-red-100 text-red-500 rounded-lg text-xs font-black flex items-center justify-center">×</button>
                        </div>
                      </div>
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                        {a.loads.map(l => (
                          <div key={l.subject} className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase">
                            <span className={`truncate pr-2 ${isSinglePeriodSubject(l.subject) ? 'text-amber-500' : ''}`}>{l.subject}</span>
                            <span className={`px-1.5 py-0.5 rounded border ${isSinglePeriodSubject(l.subject) ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-slate-600 bg-slate-100 border-slate-200'}`}>{l.periods}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {teacherAssignmentsList.length === 0 && !isEditing && (
                     <div className="col-span-full py-10 text-center opacity-20"><p className="text-[10px] font-black uppercase tracking-widest">No allocations identified</p></div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isBulkModalOpen && bulkTargetAssignment && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#001f3f]/90 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Bulk Allocation</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{bulkTargetAssignment.grade}</p>
             </div>
             <div className="space-y-4">
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                  <span className="text-[9px] font-black text-slate-400 uppercase">Periods/Sub</span>
                  <input type="number" className="w-16 px-2 py-1 bg-white border rounded-lg text-center font-black" value={bulkPeriodCount} onChange={e => setBulkPeriodCount(parseInt(e.target.value) || 1)} min="1" max="10" />
                </div>
                <div className="max-h-40 overflow-y-auto p-1 grid grid-cols-2 gap-2">
                  {sortedSubjects.map(s => (
                    <button key={s.id} onClick={() => bulkSelectedSubjects.includes(s.name) ? setBulkSelectedSubjects(p => p.filter(x => x !== s.name)) : setBulkSelectedSubjects(p => [...p, s.name])} className={`px-2 py-2 rounded-lg text-[8px] font-black uppercase border ${bulkSelectedSubjects.includes(s.name) ? 'bg-emerald-500 text-white border-transparent' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>{s.name}</button>
                  ))}
                </div>
             </div>
             <div className="flex flex-col gap-2">
                <button onClick={saveBulkAllocation} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[10px] uppercase shadow-lg">Confirm Bulk</button>
                <button onClick={() => setIsBulkModalOpen(false)} className="w-full py-2 text-slate-400 font-black text-[9px] uppercase">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignmentView;
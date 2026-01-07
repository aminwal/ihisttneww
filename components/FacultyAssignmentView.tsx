
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
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

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
    setStatus({ type: 'success', message: 'Allocation committed to institutional database.' });
    setTimeout(() => setStatus(null), 3000);
  };

  const saveAssignment = () => {
    if (!editingTeacherId || !selectedGrade || editingLoads.length === 0) return;
    const totalLoad = calculateTeacherTotalPeriods(editingTeacherId, selectedGrade, editingLoads);
    if (totalLoad > 28) {
      triggerConfirm(`Load Alert: Total periods (${totalLoad}) exceeds recommended institutional 28-period limit. Proceed with manual override?`, () => commitToAssignments(editingTeacherId, selectedGrade, editingLoads));
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
      if (!searchLower) return true;
      return u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, activeSection, teacherSearch]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="bg-[#001f3f] rounded-2xl md:rounded-[2.5rem] p-8 text-white shadow-xl border border-[#d4af37]/20">
        <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tight mb-2">Faculty Workload Registry</h2>
        <p className="text-amber-200/60 text-[9px] font-bold uppercase tracking-[0.3em]">Multi-Departmental Duty Matrix</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-[#001f3f] italic uppercase">Teaching Allocations</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Active View: {activeSection} Wing</p>
        </div>
        <div className="flex items-center gap-4">
          <input type="text" placeholder="Search personnel..." value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-100 rounded-xl text-xs font-bold shadow-sm outline-none focus:ring-2 focus:ring-amber-400" />
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <button onClick={() => setActiveSection('PRIMARY')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${activeSection === 'PRIMARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Primary</button>
            <button onClick={() => setActiveSection('SECONDARY')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${activeSection === 'SECONDARY' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Secondary</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {filteredTeachers.map(teacher => {
          const teacherAssignmentsList = assignments.filter(a => a.teacherId === teacher.id);
          const isEditing = editingTeacherId === teacher.id;
          const totalLoad = calculateTeacherTotalPeriods(teacher.id, isEditing ? selectedGrade : undefined, isEditing ? editingLoads : []);
          return (
            <div key={teacher.id} className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-lg overflow-hidden transition-all duration-300">
              <div className="p-6 md:p-8 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center space-x-5">
                  <div className="w-14 h-14 bg-[#001f3f] text-[#d4af37] rounded-2xl flex items-center justify-center font-black text-xl">{teacher.name.substring(0,2)}</div>
                  <div>
                    <h3 className="text-lg font-black text-[#001f3f] dark:text-white italic">{teacher.name}</h3>
                    <p className={`text-[10px] font-black uppercase mt-1 ${totalLoad > 28 ? 'text-red-500' : 'text-amber-500'}`}>Load Commitment: {totalLoad}/28 Periods</p>
                  </div>
                </div>
                <button onClick={() => setEditingTeacherId(isEditing ? null : teacher.id)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg transition-all ${isEditing ? 'bg-red-500 text-white' : 'bg-amber-400 text-white'}`}>{isEditing ? 'Discard Changes' : 'Manage Workload'}</button>
              </div>
              {isEditing && (
                <div className="p-8 border-t border-slate-100 dark:border-slate-800 bg-amber-50/10 space-y-6">
                   <select className="w-full px-6 py-4 rounded-2xl border-2 dark:bg-slate-900 dark:border-slate-700 text-[11px] font-black uppercase outline-none focus:border-amber-400 transition-all" value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)}>
                     <option value="">Choose Target Grade Division...</option>
                     {getTeacherSpecificGrades(teacher).map(g => <option key={g} value={g}>{g}</option>)}
                   </select>
                   <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto scrollbar-hide bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                      {sortedSubjects.map(s => {
                        const existing = editingLoads.find(l => l.subject === s.name);
                        return (
                          <button key={s.id} onClick={() => {
                            if (existing) setEditingLoads(prev => prev.filter(l => l.subject !== s.name));
                            else setEditingLoads(prev => [...prev, { subject: s.name, periods: 6 }]);
                          }} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${existing ? 'bg-amber-400 text-white border-transparent' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200'}`}>{s.name}</button>
                        );
                      })}
                   </div>
                   {editingLoads.length > 0 && (
                     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {editingLoads.map(l => (
                          <div key={l.subject} className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm">
                            <span className="text-[10px] font-black uppercase truncate pr-2 text-slate-500">{l.subject}</span>
                            <div className="flex items-center space-x-2">
                               <span className="text-[8px] font-black text-slate-300">QTY</span>
                               <input type="number" min="1" className="w-12 text-center font-black text-sm bg-slate-50 rounded-lg p-1 dark:text-white" value={l.periods} onChange={e => setEditingLoads(prev => prev.map(x => x.subject === l.subject ? {...x, periods: Math.max(1, parseInt(e.target.value) || 1)} : x))} />
                            </div>
                          </div>
                        ))}
                     </div>
                   )}
                   <button onClick={saveAssignment} disabled={!selectedGrade || editingLoads.length === 0} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all hover:bg-slate-900">Authorize Allocation Matrix</button>
                </div>
              )}
              <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                 {teacherAssignmentsList.map(a => (
                   <div key={a.id} className="bg-slate-50 dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 relative group">
                      <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase mb-4 italic tracking-tight">{a.grade}</p>
                      <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-700">
                        {a.loads.map(l => (
                          <div key={l.subject} className="flex justify-between items-center text-[10px] font-black text-slate-400 uppercase">
                             <span className="truncate pr-2">{l.subject}</span>
                             <span className="bg-white dark:bg-slate-950 px-2 py-0.5 rounded border border-slate-200 text-slate-600">{l.periods}</span>
                          </div>
                        ))}
                      </div>
                   </div>
                 ))}
                 {teacherAssignmentsList.length === 0 && !isEditing && (
                    <div className="col-span-full py-10 text-center opacity-30"><p className="text-[10px] font-black uppercase tracking-widest">No active institutional periods assigned to faculty member</p></div>
                 )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FacultyAssignmentView;

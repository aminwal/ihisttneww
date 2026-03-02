import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, SubjectLoad, SchoolGrade, SchoolSection, TimeTableEntry } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { LayoutGrid, Table, Download, AlertTriangle, CheckCircle, Clock, Calendar, Search, Filter, Save, X } from 'lucide-react';
import * as XLSX from 'xlsx';

const MAX_PERIODS = 35;

interface FacultyAssignmentViewProps {
  users: User[];
  setUsers?: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  timetable: TimeTableEntry[];
  currentUser: User;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const FacultyAssignmentView: React.FC<FacultyAssignmentViewProps> = ({ 
  users, setUsers, config, assignments, setAssignments, timetable, currentUser, 
  showToast, isSandbox, addSandboxLog 
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingBreakdownId, setViewingBreakdownId] = useState<string | null>(null);
  const [selGradeId, setSelGradeId] = useState<string>('');
  const [selSectionIds, setSelSectionIds] = useState<string[]>([]);
  const [loads, setLoads] = useState<SubjectLoad[]>([]);
  const [groupPeriods, setGroupPeriods] = useState<number>(0);
  const [anchorSubject, setAnchorSubject] = useState<string>('');
  const [anchorPeriods, setAnchorPeriods] = useState<number>(0);
  const [localClassTeacherOf, setLocalClassTeacherOf] = useState<string>('');
  const [newLoad, setNewLoad] = useState<SubjectLoad>({ subject: '', periods: 1, sectionId: '', room: '' });
  
  const [viewMode, setViewMode] = useState<'GRID' | 'TABLE'>('GRID');
  const [activeTab, setActiveTab] = useState<'ALL' | 'PRIMARY' | 'SECONDARY' | 'SENIOR' | 'CLASS_TEACHERS'>('ALL');
  const [classTeacherAssignments, setClassTeacherAssignments] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const initialAssignments: Record<string, string> = {};
    config.sections.forEach(s => {
      const teacher = users.find(u => u.classTeacherOf === s.id);
      if (teacher) initialAssignments[s.id] = teacher.id;
    });
    setClassTeacherAssignments(initialAssignments);
  }, [config.sections, users]);

  const assignedBlocks = useMemo(() => {
    if (!editingId || !selGradeId) return [];
    return (config.combinedBlocks || []).filter(b => 
      b.gradeId === selGradeId && (b.allocations || []).some(a => a.teacherId === editingId)
    );
  }, [config.combinedBlocks, editingId, selGradeId]);

  const assignedLabs = useMemo(() => {
    if (!editingId || !selGradeId) return [];
    return (config.labBlocks || []).filter(b => 
      b.gradeId === selGradeId &&
      (b.allocations || []).some(a => a.teacherId === editingId || a.technicianId === editingId)
    );
  }, [config.labBlocks, editingId, selGradeId]);

  const assignedActivities = useMemo(() => {
    if (!editingId || !selGradeId) return [];
    const gradeSectionIds = config.sections.filter(s => s.gradeId === selGradeId).map(s => s.id);
    return (config.extraCurricularRules || []).filter(r => 
      r.teacherId === editingId && 
      r.sectionIds.some(sid => gradeSectionIds.includes(sid))
    );
  }, [config.extraCurricularRules, editingId, selGradeId, config.sections]);

  const editingTeacher = useMemo(() => users.find(u => u.id === editingId), [users, editingId]);
  const breakdownTeacher = useMemo(() => users.find(u => u.id === viewingBreakdownId), [users, viewingBreakdownId]);

  // Auto-sync group periods from assigned blocks
  useEffect(() => {
    if (assignedBlocks.length > 0) {
      const total = assignedBlocks.reduce((sum, b) => sum + b.weeklyPeriods, 0);
      setGroupPeriods(total);
    } else {
      setGroupPeriods(0);
    }
  }, [assignedBlocks]);

  useEffect(() => {
    if (editingId && selGradeId) {
      const existing = assignments.find(a => a.teacherId === editingId && a.gradeId === selGradeId);
      if (existing) {
        setLoads(existing.loads || []);
        setSelSectionIds(existing.targetSectionIds || []);
        // groupPeriods is handled by the effect above based on blocks
        setAnchorSubject(existing.anchorSubject || '');
        setAnchorPeriods(existing.anchorPeriods || 0);
      } else {
        setLoads([]);
        setSelSectionIds([]);
        // groupPeriods is handled by the effect above
        setAnchorSubject('');
        setAnchorPeriods(0);
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

  const getTeacherMetrics = (teacherId: string) => {
    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId);
    
    // 1. Standard Load from Workload Matrix (Assigned)
    const assignedBase = teacherAssignments.reduce((sum, a) => {
      const loadSum = (a.loads || []).reduce((lSum, l) => lSum + l.periods, 0);
      const anchorSum = a.anchorPeriods || 0;
      return sum + loadSum + anchorSum;
    }, 0);

    // 2. Pool Load from Workload Matrix (Assigned)
    const assignedPool = teacherAssignments.reduce((sum, a) => sum + (a.groupPeriods || 0), 0);

    // 3. Curricular Mandates (PHE/CEP/Art) - from config
    const ecRules = (config.extraCurricularRules || [])
      .filter(r => r.teacherId === teacherId);
    const extraCurricularPeriods = ecRules.reduce((sum, r) => sum + (r.sectionIds.length * r.periodsPerWeek), 0);

    // 4. Proxy Load (Substitutions) - from actual timetable
    const proxyEntries = timetable.filter(t => t.teacherId === teacherId && t.isSubstitution);
    const proxyCount = proxyEntries.length;

    // 5. Manual/Extra Load - from actual timetable (Non-substitution, manual entries that aren't part of a block)
    const manualEntries = timetable.filter(t => t.teacherId === teacherId && t.isManual && !t.isSubstitution && !t.blockId);
    const manualCount = manualEntries.length;

    // 6. Lab Load - from Config (Assigned)
    const labBlocks = (config.labBlocks || []).filter(b => 
      (b.allocations || []).some(a => a.teacherId === teacherId || a.technicianId === teacherId)
    );
    const labCount = labBlocks.reduce((sum, b) => {
      const periodsPerOccurrence = b.isDoublePeriod ? 2 : 1;
      return sum + (b.weeklyOccurrences * periodsPerOccurrence);
    }, 0);

    const standardBreakdown: { label: string, count: number }[] = [];
    teacherAssignments.forEach(a => {
      const grade = config.grades.find(g => g.id === a.gradeId);
      if (a.anchorSubject && a.anchorPeriods) {
        const section = config.sections.find(s => s.id === (users.find(u => u.id === teacherId)?.classTeacherOf));
        standardBreakdown.push({
          label: `${a.anchorSubject} (Anchor - ${grade?.name || ''} ${section?.name || 'Class'})`,
          count: a.anchorPeriods
        });
      }
      (a.loads || []).forEach(l => {
        const section = config.sections.find(s => s.id === l.sectionId);
        standardBreakdown.push({
          label: `${l.subject} (${grade?.name || ''} ${section?.name || ''})`,
          count: l.periods
        });
      });
    });

    // Add manual entries to breakdown
    manualEntries.forEach(e => {
      standardBreakdown.push({
        label: `${e.subject} (Manual - ${e.className})`,
        count: 1
      });
    });

    // Add lab blocks to breakdown
    labBlocks.forEach(b => {
      const periodsPerOccurrence = b.isDoublePeriod ? 2 : 1;
      const totalPeriods = b.weeklyOccurrences * periodsPerOccurrence;
      standardBreakdown.push({
        label: `${b.title} (Lab Pool - ${config.grades.find(g => g.id === b.gradeId)?.name})`,
        count: totalPeriods
      });
    });

    const poolBreakdown = teacherAssignments
      .filter(a => (a.groupPeriods || 0) > 0)
      .map(a => ({
        label: `Pool (${config.grades.find(g => g.id === a.gradeId)?.name})`,
        count: a.groupPeriods || 0
      }));

    return { 
      base: assignedBase + labCount, 
      pool: assignedPool, 
      ec: extraCurricularPeriods,
      proxy: proxyCount,
      manual: manualCount,
      total: assignedBase + assignedPool + extraCurricularPeriods + proxyCount + manualCount + labCount,
      details: {
        standard: standardBreakdown,
        pools: poolBreakdown,
        extra: ecRules.map(r => ({ label: `${r.subject} (${r.sectionIds.length} Sections)`, count: r.periodsPerWeek * r.sectionIds.length })),
        proxies: Object.entries(proxyEntries.reduce((acc, e) => {
          const key = `${e.subject} Proxy (${e.className})`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)).map(([label, count]) => ({ label, count }))
      }
    };
  };

  const addLoadItem = () => {
    if (!newLoad.subject.trim() || !newLoad.sectionId) return;
    setLoads(prev => [...prev, { ...newLoad }]);
    setNewLoad({ subject: '', periods: 1, sectionId: '', room: '' });
  };

  const handleExport = () => {
    const data = teachingStaff.map(t => {
      const m = getTeacherMetrics(t.id);
      const ctSection = t.classTeacherOf ? config.sections.find(s => s.id === t.classTeacherOf) : null;
      return {
        'Employee ID': t.employeeId,
        'Name': t.name,
        'Role': t.role,
        'Class Teacher Of': ctSection ? ctSection.fullName : 'N/A',
        'Total Load': m.total,
        'Standard Load': m.base + (m.manual || 0),
        'Pool Load': m.pool,
        'Activity Load': m.ec,
        'Proxy Load': m.proxy,
        'Status': m.total > 30 ? 'Overloaded' : m.total < 15 ? 'Underloaded' : 'Normal'
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Faculty Workload");
    XLSX.writeFile(wb, "Faculty_Workload_Report.xlsx");
  };

  const handleSaveClassTeacher = async (sectionId: string, teacherId: string) => {
    try {
      // 1. Remove previous class teacher for this section
      const prevTeacher = users.find(u => u.classTeacherOf === sectionId);
      if (prevTeacher) {
        if (IS_CLOUD_ENABLED && !isSandbox) {
          await supabase.from('profiles').update({ class_teacher_of: null }).eq('id', prevTeacher.id);
        }
        if (setUsers) {
          setUsers(prev => prev.map(u => u.id === prevTeacher.id ? { ...u, classTeacherOf: undefined } : u));
        }
      }

      // 2. Assign new teacher
      if (teacherId) {
        if (IS_CLOUD_ENABLED && !isSandbox) {
          await supabase.from('profiles').update({ class_teacher_of: sectionId }).eq('id', teacherId);
        }
        if (setUsers) {
          setUsers(prev => prev.map(u => u.id === teacherId ? { ...u, classTeacherOf: sectionId } : u));
        }
      }

      showToast("Class Teacher Updated", "success");
    } catch (err: any) {
      console.error("Class Teacher update failed:", err);
      showToast("Update Failed", "error");
    }
  };

  const handleSave = async () => {
    if (!editingId || !selGradeId) return;
    
    // Check if an assignment already exists for this teacher and grade to reuse the ID
    const existingAssignment = assignments.find(a => a.teacherId === editingId && a.gradeId === selGradeId);
    
    const newAsgn: TeacherAssignment = {
      id: existingAssignment ? existingAssignment.id : generateUUID(),
      teacherId: editingId,
      gradeId: selGradeId,
      loads: loads,
      targetSectionIds: selSectionIds,
      groupPeriods: groupPeriods,
      anchorSubject: anchorSubject || undefined,
      anchorPeriods: anchorPeriods || undefined
    };

    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        // Check for existing assignment again to be sure (or trust local state)
        // We will try to UPDATE if we have an ID, otherwise INSERT.
        // Actually, relying on the unique constraint (teacher_id, grade_id) is best.
        
        const { data: existingRows } = await supabase
          .from('teacher_assignments')
          .select('id')
          .eq('teacher_id', editingId)
          .eq('grade_id', selGradeId);

        if (existingRows && existingRows.length > 0) {
           // UPDATE existing record
           const existingId = existingRows[0].id;
           const { error: updateError } = await supabase
             .from('teacher_assignments')
             .update({
               loads: loads,
               target_section_ids: selSectionIds,
               group_periods: groupPeriods,
               anchor_subject: anchorSubject || null,
               anchor_periods: anchorPeriods || 0
             })
             .eq('id', existingId);
             
           if (updateError) throw updateError;
           
           // Update local state with the existing ID
           newAsgn.id = existingId;
        } else {
           // INSERT new record
           const { error: insertError } = await supabase
             .from('teacher_assignments')
             .insert({
               id: newAsgn.id, // Use the generated UUID
               teacher_id: editingId,
               grade_id: selGradeId,
               loads: loads,
               target_section_ids: selSectionIds,
               group_periods: groupPeriods,
               anchor_subject: anchorSubject || null,
               anchor_periods: anchorPeriods || 0
             });
             
           if (insertError) throw insertError;
        }

        const { error: profileError } = await supabase.from('profiles').update({ class_teacher_of: localClassTeacherOf || null }).eq('id', editingId);
        if (profileError) throw profileError;
      }

      if (setUsers) {
        setUsers(prev => prev.map(u => u.id === editingId ? { ...u, classTeacherOf: localClassTeacherOf || undefined } : u));
      }
      
      setAssignments(prev => [...prev.filter(a => !(a.teacherId === editingId && a.gradeId === selGradeId)), newAsgn]);
      
      if (isSandbox) {
        addSandboxLog?.('WORKLOAD_SYNC', { teacherId: editingId, assignment: newAsgn, classTeacherOf: localClassTeacherOf });
      }

      showToast("Workload Matrix Synchronized", "success");
      setEditingId(null);
    } catch (err: any) {
      console.error("Workload sync failed:", err);
      showToast(`Sync Failed: ${err.message}`, "error");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="space-y-1 text-center md:text-left px-2">
        <h1 className="text-2xl md:text-5xl font-black text-[#001f3f] dark:text-white italic tracking-tighter uppercase leading-none">Teacher <span className="text-[#d4af37]">Workloads</span></h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Manage total weekly classes for each teacher</p>
      </div>

      <div className="flex flex-col xl:flex-row items-center gap-6 px-2">
        <input type="text" placeholder="Search teacher name..." value={search} onChange={e => setSearch(e.target.value)} className="w-full xl:w-96 p-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl font-bold text-xs outline-none dark:text-white focus:border-amber-400 transition-all shadow-sm" />
        <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide w-full xl:w-auto">
          {(['ALL', 'PRIMARY', 'SECONDARY', 'SENIOR', 'CLASS_TEACHERS'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeTab === tab ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{tab === 'SENIOR' ? 'Sr. Secondary' : tab === 'CLASS_TEACHERS' ? 'Class Teachers' : tab.charAt(0) + tab.slice(1).toLowerCase()}</button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setViewMode('GRID')} className={`p-3 rounded-xl transition-all ${viewMode === 'GRID' ? 'bg-amber-100 text-amber-600' : 'bg-white dark:bg-slate-900 text-slate-400'}`}><LayoutGrid className="w-5 h-5" /></button>
          <button onClick={() => setViewMode('TABLE')} className={`p-3 rounded-xl transition-all ${viewMode === 'TABLE' ? 'bg-amber-100 text-amber-600' : 'bg-white dark:bg-slate-900 text-slate-400'}`}><Table className="w-5 h-5" /></button>
          <button onClick={handleExport} className="p-3 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-all" title="Export Report"><Download className="w-5 h-5" /></button>
        </div>
      </div>
      
      {activeTab === 'CLASS_TEACHERS' ? (
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                  <th className="p-6 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Grade & Section</th>
                  <th className="p-6 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Class Teacher</th>
                  <th className="p-6 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Assign New Teacher</th>
                  <th className="p-6 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {config.sections.map(section => {
                  const currentTeacher = users.find(u => u.classTeacherOf === section.id);
                  const assignedTeacherId = classTeacherAssignments[section.id] || '';
                  
                  return (
                    <tr key={section.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="p-6">
                        <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{section.fullName}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{config.grades.find(g => g.id === section.gradeId)?.name}</p>
                      </td>
                      <td className="p-6">
                        {currentTeacher ? (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-black">{currentTeacher.name.charAt(0)}</div>
                            <div>
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{currentTeacher.name}</p>
                              <p className="text-[9px] font-bold text-slate-400">{currentTeacher.employeeId}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-rose-400 italic">Not Assigned</span>
                        )}
                      </td>
                      <td className="p-6">
                        <select 
                          value={assignedTeacherId} 
                          onChange={(e) => setClassTeacherAssignments(prev => ({ ...prev, [section.id]: e.target.value }))}
                          className="w-full md:w-64 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-amber-400 transition-all"
                        >
                          <option value="">Select Teacher...</option>
                          {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).sort((a,b) => a.name.localeCompare(b.name)).map(u => (
                            <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-6 text-right">
                        <button 
                          onClick={() => handleSaveClassTeacher(section.id, assignedTeacherId)}
                          disabled={!assignedTeacherId || assignedTeacherId === currentTeacher?.id}
                          className="px-4 py-2 bg-[#001f3f] text-[#d4af37] rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-900 transition-all"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'TABLE' ? (
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                  <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Teacher</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Load</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Standard</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Pools</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Activities</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Proxies</th>
                  <th className="p-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {teachingStaff.map(t => {
                  const m = getTeacherMetrics(t.id);
                  const statusColor = m.total > 30 ? 'text-rose-500 bg-rose-50' : m.total < 15 ? 'text-amber-500 bg-amber-50' : 'text-emerald-500 bg-emerald-50';
                  
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => setViewingBreakdownId(t.id)}>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-black text-slate-500">{t.name.charAt(0)}</div>
                          <div>
                            <p className="text-sm font-bold text-[#001f3f] dark:text-white">{t.name}</p>
                            <p className="text-[10px] font-bold text-slate-400">{t.employeeId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center"><span className="text-lg font-black text-[#001f3f] dark:text-white">{m.total}</span></td>
                      <td className="p-4 text-center"><span className="text-sm font-bold text-slate-600 dark:text-slate-300">{m.base + (m.manual || 0)}</span></td>
                      <td className="p-4 text-center"><span className="text-sm font-bold text-amber-600">{m.pool}</span></td>
                      <td className="p-4 text-center"><span className="text-sm font-bold text-emerald-600">{m.ec}</span></td>
                      <td className="p-4 text-center"><span className="text-sm font-bold text-rose-600">{m.proxy}</span></td>
                      <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${statusColor}`}>
                          {m.total > 30 ? 'Overload' : m.total < 15 ? 'Underload' : 'Normal'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setEditingId(t.id); 
                            const existing = assignments.find(a => a.teacherId === t.id);
                            setLoads(existing?.loads || []);
                            setSelGradeId(existing?.gradeId || config.grades[0]?.id || '');
                            setSelSectionIds(existing?.targetSectionIds || []);
                            setGroupPeriods(existing?.groupPeriods || 0);
                            setAnchorSubject(existing?.anchorSubject || '');
                            setAnchorPeriods(existing?.anchorPeriods || 0);
                            setLocalClassTeacherOf(t.classTeacherOf || ''); 
                          }}
                          className="px-4 py-2 bg-slate-100 hover:bg-[#001f3f] hover:text-[#d4af37] rounded-lg text-[10px] font-black uppercase transition-all"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
         {teachingStaff.map(t => {
            const metrics = getTeacherMetrics(t.id);
            const severityColor = metrics.total > 30 ? 'bg-rose-500' : metrics.total > 25 ? 'bg-amber-500' : 'bg-emerald-500';
            const ctSection = t.classTeacherOf ? config.sections.find(s => s.id === t.classTeacherOf) : null;

            return (
              <div key={t.id} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 group hover:border-[#d4af37] transition-all relative overflow-hidden">
                 <div className="flex justify-between items-start mb-8 relative z-10">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-black text-xl text-[#001f3f] dark:text-white italic uppercase tracking-tight truncate max-w-[180px] leading-none">{t.name}</p>
                        {ctSection && <span className="px-2 py-0.5 bg-sky-50 text-sky-600 text-[6px] font-black uppercase rounded-lg border border-sky-100 shadow-sm">Class Teacher: {ctSection.fullName}</span>}
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{t.employeeId}</p>
                    </div>
                    <button onClick={() => setViewingBreakdownId(t.id)} className={`w-14 h-14 rounded-[1.25rem] ${severityColor} text-white flex flex-col items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all`}>
                        <span className="text-lg font-black leading-none">{metrics.total}</span>
                        <span className="text-[7px] font-black uppercase opacity-60">Periods</span>
                    </button>
                 </div>
                 
                 <div onClick={() => setViewingBreakdownId(t.id)} className="grid grid-cols-2 gap-2 mb-8 cursor-pointer group/stats">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-2xl text-center group-hover/stats:bg-slate-100 transition-colors">
                       <p className="text-[6px] font-black text-slate-400 uppercase mb-1">Standard Classes</p>
                       <p className="text-[10px] font-black text-[#001f3f] dark:text-white">{metrics.base + metrics.pool + (metrics.manual || 0)}P</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-2xl text-center border border-emerald-400/10 group-hover/stats:bg-emerald-50 transition-colors">
                       <p className="text-[6px] font-black text-emerald-500 uppercase mb-1">Activities</p>
                       <p className="text-[10px] font-black text-emerald-600">{metrics.ec}P</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-2xl text-center border border-amber-400/10 group-hover/stats:bg-amber-50 transition-colors">
                       <p className="text-[6px] font-black text-amber-500 uppercase mb-1">Proxy Classes</p>
                       <p className="text-[10px] font-black text-amber-600">{metrics.proxy}P</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-2xl text-center border border-slate-100 group-hover/stats:bg-slate-100 transition-colors">
                       <p className="text-[6px] font-black text-slate-400 uppercase mb-1">Load Status</p>
                       <p className="text-[10px] font-black text-slate-600 dark:text-slate-300">{metrics.total > 30 ? 'HEAVY' : 'NORMAL'}</p>
                    </div>
                 </div>

                 <div className="space-y-1 mb-8">
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner"><div style={{ width: `${Math.min(100, (metrics.total / MAX_PERIODS) * 100)}%` }} className={`h-full ${severityColor} transition-all duration-700`}></div></div>
                    <div className="flex justify-between items-center mt-1">
                      <button onClick={() => setViewingBreakdownId(t.id)} className="text-[7px] font-black text-sky-500 uppercase tracking-widest hover:underline italic">See Full Details</button>
                      <p className="text-[8px] font-black text-slate-400 uppercase">Usage: {Math.round((metrics.total / MAX_PERIODS) * 100)}%</p>
                    </div>
                 </div>
                 <button onClick={() => { 
                   setEditingId(t.id); 
                   const ctSection = t.classTeacherOf ? config.sections.find(s => s.id === t.classTeacherOf) : null;
                   const priorityGradeId = ctSection ? ctSection.gradeId : (config.grades[0]?.id || '');
                   
                   // Find assignment for the priority grade (Class Teacher grade) first, or fallback to any existing assignment
                   const existing = assignments.find(a => a.teacherId === t.id && a.gradeId === priorityGradeId) 
                                 || assignments.find(a => a.teacherId === t.id);

                   setLoads(existing?.loads || []);
                   setSelGradeId(existing?.gradeId || priorityGradeId);
                   setSelSectionIds(existing?.targetSectionIds || []);
                   setGroupPeriods(existing?.groupPeriods || 0);
                   setAnchorSubject(existing?.anchorSubject || '');
                   setAnchorPeriods(existing?.anchorPeriods || 0);
                   setLocalClassTeacherOf(t.classTeacherOf || '');
                 }} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] shadow-lg hover:bg-slate-950 transition-all active:scale-95">Edit Workload</button>
              </div>
            );
         })}
      </div>
      )}

      {/* Load Breakdown Drill-Down Modal */}
      {viewingBreakdownId && breakdownTeacher && (
        <div className="fixed inset-0 z-[1100] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-8 md:p-10 shadow-2xl border-4 border-amber-400/20 animate-in zoom-in duration-300 max-h-[85vh] overflow-y-auto scrollbar-hide">
              <div className="flex justify-between items-start mb-8">
                 <div className="space-y-1">
                    <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Workload Details</h3>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest leading-none">{breakdownTeacher.name} • {breakdownTeacher.employeeId}</p>
                 </div>
                 <button onClick={() => setViewingBreakdownId(null)} className="p-2 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-slate-800 rounded-xl transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>

              {(() => {
                const m = getTeacherMetrics(viewingBreakdownId);
                return (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl text-center border-b-4 border-[#001f3f]"><p className="text-[7px] font-black text-slate-400 uppercase mb-1">Standard</p><p className="text-xl font-black text-[#001f3f] dark:text-white italic">{m.base + (m.manual || 0)}P</p></div>
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl text-center border-b-4 border-amber-400"><p className="text-[7px] font-black text-slate-400 uppercase mb-1">Pools</p><p className="text-xl font-black text-amber-600 italic">{m.pool}P</p></div>
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl text-center border-b-4 border-emerald-500"><p className="text-[7px] font-black text-slate-400 uppercase mb-1">Activities</p><p className="text-xl font-black text-emerald-600 italic">{m.ec}P</p></div>
                      <div className="bg-amber-100 dark:bg-amber-900/40 p-4 rounded-2xl text-center border-b-4 border-amber-600 shadow-sm"><p className="text-[7px] font-black text-amber-700 dark:text-amber-400 uppercase mb-1">Proxy</p><p className="text-xl font-black text-amber-800 dark:text-amber-200 italic">{m.proxy}P</p></div>
                    </div>

                    <div className="space-y-4">
                       <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-4 bg-[#001f3f] rounded-full"></div> Standard Classes</h4>
                       <div className="space-y-2">
                          {m.details.standard.length > 0 ? m.details.standard.map((d, i) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-100 dark:border-slate-800"><span className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic">{d.label}</span><span className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-black shadow-sm">{d.count} Periods</span></div>
                          )) : <p className="text-[10px] font-bold text-slate-300 italic uppercase tracking-widest px-4">No regular classes assigned.</p>}
                       </div>
                    </div>

                    <div className="space-y-4">
                       <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-4 bg-amber-400 rounded-full"></div> Group Class Pools</h4>
                       <div className="space-y-2">
                          {m.details.pools.length > 0 ? m.details.pools.map((d, i) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-amber-50/30 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-800"><span className="text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase italic">{d.label}</span><span className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-black shadow-sm text-amber-600">{d.count} Periods</span></div>
                          )) : <p className="text-[10px] font-bold text-slate-300 italic uppercase tracking-widest px-4">No group pools assigned.</p>}
                       </div>
                    </div>

                    <div className="space-y-4">
                       <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-4 bg-emerald-500 rounded-full"></div> Special Activities</h4>
                       <div className="space-y-2">
                          {m.details.extra.length > 0 ? m.details.extra.map((d, i) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-emerald-50/30 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-900"><span className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase italic">{d.label}</span><span className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-black shadow-sm text-emerald-600">{d.count} Periods</span></div>
                          )) : <p className="text-[10px] font-bold text-slate-300 italic uppercase tracking-widest px-4">No special activities assigned.</p>}
                       </div>
                    </div>

                    <div className="space-y-4">
                       <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2"><div className="w-1.5 h-4 bg-amber-600 rounded-full"></div> Recent Proxies</h4>
                       <div className="space-y-2">
                          {m.details.proxies.length > 0 ? m.details.proxies.map((d, i) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-200 border-amber-800/50"><span className="text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase italic">{d.label}</span><span className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-black shadow-sm text-amber-600">{d.count} Periods</span></div>
                          )) : <p className="text-[10px] font-bold text-slate-300 italic uppercase tracking-widest px-4">No recent proxies detected.</p>}
                       </div>
                    </div>
                  </div>
                );
              })()}

              <div className="pt-8 flex justify-center">
                 <button onClick={() => setViewingBreakdownId(null)} className="px-12 py-5 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl">Close Detailed Audit</button>
              </div>
           </div>
        </div>
      )}

      {/* Edit Workload Modal */}
      {editingId && editingTeacher && (
        <div className="fixed inset-0 z-[1200] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto scrollbar-hide">
              <div className="flex justify-between items-start mb-4">
                 <div>
                    <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Adjust Workload Matrix</h3>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Target: {editingTeacher.name}</p>
                 </div>
                 <button onClick={() => setEditingId(null)} className="p-2 text-slate-400 hover:text-rose-500 transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="space-y-6">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Institutional Anchoring</p>
                    <div className="space-y-4">
                       <select value={selGradeId} onChange={e => setSelGradeId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-amber-400">
                          <option value="">Select Grade Level...</option>
                          {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                       </select>
                       <select value={localClassTeacherOf} onChange={e => setLocalClassTeacherOf(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-sky-400">
                          <option value="">None (Not a Class Teacher)</option>
                          {config.sections.map(s => <option key={s.id} value={s.id}>Class Teacher of: {s.fullName}</option>)}
                       </select>
                       <select 
                         value={anchorSubject} 
                         onChange={e => setAnchorSubject(e.target.value)} 
                         className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-amber-400"
                       >
                          <option value="">Anchor Subject (e.g. ARABIC)</option>
                          {config.subjects.map(s => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                       </select>
                       <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border-2 border-transparent focus-within:border-amber-400">
                          <span className="text-[9px] font-black uppercase text-slate-400 whitespace-nowrap">Anchor Periods</span>
                          <input 
                            type="number" 
                            className="w-full bg-transparent text-right font-black text-sm outline-none" 
                            value={anchorPeriods} 
                            onChange={e => setAnchorPeriods(parseInt(e.target.value) || 0)} 
                          />
                       </div>
                    </div>
                 </div>

                 <div className="space-y-6">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Parallel Load (Pool Periods)</p>
                    <div className="p-6 bg-amber-50 dark:bg-amber-900/10 rounded-3xl border border-amber-100 flex flex-col items-center gap-4">
                       <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase text-center">Set periods where this teacher is part of a synchronized Grade-wide pool.</p>
                       
                       {assignedBlocks.length > 0 ? (
                         <div className="w-full space-y-2 mb-2">
                           <p className="text-[7px] font-black text-amber-600 uppercase tracking-widest text-center">Active Group Assignments:</p>
                           <div className="flex flex-wrap justify-center gap-2">
                             {assignedBlocks.map(b => (
                               <div key={b.id} className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg border border-amber-200 shadow-sm flex items-center gap-2">
                                 <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{b.title}</span>
                                 <span className="text-[8px] font-bold text-amber-500">{b.weeklyPeriods}P</span>
                               </div>
                             ))}
                           </div>
                         </div>
                       ) : (
                         <p className="text-[8px] font-bold text-slate-400 italic">No pool assignments for this grade.</p>
                       )}

                       <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl text-center border-2 border-amber-100 dark:border-amber-800/30 min-w-[100px]">
                          <span className="text-2xl font-black text-[#001f3f] dark:text-white">{groupPeriods}</span>
                          <span className="text-[8px] font-black text-slate-400 uppercase block">Periods</span>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="space-y-6">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Lab Load (Practical Periods)</p>
                 <div className="p-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-3xl border border-emerald-100 flex flex-col items-center gap-4">
                    <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase text-center">Periods where this teacher is assigned to a Lab (as Teacher or Technician).</p>
                    
                    {assignedLabs.length > 0 ? (
                      <div className="w-full space-y-2 mb-2">
                        <p className="text-[7px] font-black text-emerald-600 uppercase tracking-widest text-center">Assigned Lab Sessions:</p>
                        <div className="flex flex-wrap justify-center gap-2 max-h-32 overflow-y-auto scrollbar-hide">
                          {assignedLabs.map((block, idx) => {
                             const periodsPerOccurrence = block.isDoublePeriod ? 2 : 1;
                             const totalPeriods = block.weeklyOccurrences * periodsPerOccurrence;
                             return (
                               <div key={idx} className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 shadow-sm flex items-center gap-2">
                                 <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{block.title}</span>
                                 <span className="text-[8px] font-bold text-emerald-500">{totalPeriods}P</span>
                               </div>
                             );
                           })}
                           {/*
                          {(() => { // test
                            const labCounts = assignedLabs.reduce((acc, l) => {
                              const label = `${l.subject} (${l.className})`; // test
                              acc[label] = (acc[label] || 0) + 1;
                              return acc;
                            }, {} as Record<string, number>);
                            
                            return Object.entries(labCounts).map(([label, count], idx) => (
                              <div key={idx} className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 shadow-sm flex items-center gap-2">
                                <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{label}</span>
                                <span className="text-[8px] font-bold text-emerald-500">{count}P</span>
                              </div>
                            ));
                          })()} // test
                          */}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[8px] font-bold text-slate-400 italic">No lab assignments for this grade.</p>
                    )}

                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl text-center border-2 border-emerald-100 dark:border-emerald-800/30 min-w-[100px]">
                       <span className="text-2xl font-black text-[#001f3f] dark:text-white">
                          {assignedLabs.reduce((sum, b) => sum + (b.weeklyOccurrences * (b.isDoublePeriod ? 2 : 1)), 0)}
                        </span>
                       <span className="text-[8px] font-black text-slate-400 uppercase block">Periods</span>
                    </div>
                 </div>
              </div>

              <div className="space-y-6">
                 <div className="flex justify-between items-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">4. Activity Load (Extra-Curricular)</p>
                 </div>
                  <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 flex flex-col items-center gap-4">
                     <p className="text-[9px] font-bold text-blue-700 dark:text-blue-400 uppercase text-center">Periods where this teacher is assigned to an Activity Class.</p>
                     
                     {assignedActivities.length > 0 ? (
                       <div className="w-full space-y-2 mb-2">
                         <p className="text-[7px] font-black text-blue-600 uppercase tracking-widest text-center">Assigned Activities:</p>
                         <div className="flex flex-wrap justify-center gap-2 max-h-32 overflow-y-auto scrollbar-hide">
                           {assignedActivities.map((activity, idx) => {
                             const gradeSectionIds = config.sections.filter(s => s.gradeId === selGradeId).map(s => s.id);
                             const relevantSections = activity.sectionIds.filter(sid => gradeSectionIds.includes(sid));
                             const sectionNames = relevantSections.map(sid => config.sections.find(s => s.id === sid)?.name).join(', ');
                             const totalPeriods = relevantSections.length * activity.periodsPerWeek;
                             return (
                               <div key={idx} className="px-3 py-1 bg-white dark:bg-slate-900 rounded-lg border border-blue-200 shadow-sm flex items-center gap-2">
                                 <span className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase">{activity.subject} ({sectionNames})</span>
                                 <span className="text-[8px] font-bold text-blue-500">{totalPeriods}P</span>
                               </div>
                             );
                           })}
                         </div>
                       </div>
                     ) : (
                       <p className="text-[8px] font-bold text-slate-400 italic">No activity assignments for this grade.</p>
                     )}

                     <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl text-center border-2 border-blue-100 dark:border-blue-800/30 min-w-[100px]">
                        <span className="text-2xl font-black text-[#001f3f] dark:text-white">
                          {assignedActivities.reduce((sum, r) => {
                            const gradeSectionIds = config.sections.filter(s => s.gradeId === selGradeId).map(s => s.id);
                            const relevantSections = r.sectionIds.filter(sid => gradeSectionIds.includes(sid));
                            return sum + (relevantSections.length * r.periodsPerWeek);
                          }, 0)}
                        </span>
                        <span className="text-[8px] font-black text-slate-400 uppercase block">Periods</span>
                     </div>
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="flex justify-between items-center">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">5. Individual Section Loads</p>
                    <p className="text-[9px] font-bold text-amber-600 uppercase italic">Select the class and section for each specific load</p>
                 </div>
                 <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                       <select 
                         value={newLoad.subject} 
                         onChange={e => setNewLoad({...newLoad, subject: e.target.value})}
                         className="bg-white dark:bg-slate-900 p-4 rounded-xl text-[11px] font-black uppercase outline-none"
                       >
                         <option value="">Subject...</option>
                         {config.subjects.map(s => (
                           <option key={s.id} value={s.name}>{s.name}</option>
                         ))}
                       </select>
                       <select 
                         value={newLoad.sectionId || ''} 
                         onChange={e => setNewLoad({...newLoad, sectionId: e.target.value})}
                         className="bg-white dark:bg-slate-900 p-4 rounded-xl text-[11px] font-black uppercase outline-none"
                       >
                         <option value="">Section...</option>
                         {config.sections.filter(s => s.gradeId === selGradeId).map(s => (
                           <option key={s.id} value={s.id}>{s.name}</option>
                         ))}
                       </select>
                       <input type="number" value={newLoad.periods} onChange={e => setNewLoad({...newLoad, periods: parseInt(e.target.value) || 1})} placeholder="Periods" className="bg-white dark:bg-slate-900 p-4 rounded-xl text-center font-black text-[11px] outline-none" />
                       <button onClick={addLoadItem} className="bg-[#001f3f] text-[#d4af37] rounded-xl font-black text-[10px] uppercase">Add Load</button>
                    </div>
                    <div className="space-y-2">
                       {loads.map((l, i) => {
                         const section = config.sections.find(s => s.id === l.sectionId);
                         return (
                           <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100">
                              <span className="text-[11px] font-black uppercase">{l.subject} • {section?.name || 'N/A'} • {l.periods}P</span>
                              <button onClick={() => setLoads(loads.filter((_, idx) => idx !== i))} className="text-rose-500">×</button>
                           </div>
                         );
                       })}
                    </div>
                 </div>
              </div>

              <div className="pt-4 flex gap-4">
                 <button onClick={handleSave} className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all">Synchronize Workload</button>
                 <button onClick={() => setEditingId(null)} className="px-10 py-6 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-[2rem] font-black text-[10px] uppercase tracking-widest">Discard</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignmentView;
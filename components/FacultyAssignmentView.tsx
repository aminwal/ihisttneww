import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, UserRole, SchoolConfig, TeacherAssignment, SubjectCategory, SubjectLoad, SchoolGrade, SchoolSection, TimeTableEntry } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { LayoutGrid, Table, Download, AlertTriangle, CheckCircle, Clock, Calendar, Search, Filter, Save, X, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

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
  const gradeTabsRef = useRef<HTMLDivElement>(null);
  const [viewingBreakdownId, setViewingBreakdownId] = useState<string | null>(null);
  const [selGradeId, setSelGradeId] = useState<string>('');
  const [selSectionIds, setSelSectionIds] = useState<string[]>([]);
  const [loads, setLoads] = useState<SubjectLoad[]>([]);
  const [groupPeriods, setGroupPeriods] = useState<number>(0);
  const [anchorSubject, setAnchorSubject] = useState<string>('');
  const [anchorPeriods, setAnchorPeriods] = useState<number>(0);
  const [forceAnchorSlot1, setForceAnchorSlot1] = useState<boolean>(false);
  const [preferredSlots, setPreferredSlots] = useState<string[]>([]);
  const [restrictedSlots, setRestrictedSlots] = useState<string[]>([]);
  const [localClassTeacherOf, setLocalClassTeacherOf] = useState<string>('');
  const [newLoad, setNewLoad] = useState<SubjectLoad>({ subject: '', periods: 1, sectionId: '', room: '' });
  
  const [viewMode, setViewMode] = useState<'GRID' | 'TABLE'>('GRID');
  const [activeTab, setActiveTab] = useState<'ALL' | 'PRIMARY' | 'SECONDARY' | 'SENIOR' | 'CLASS_TEACHERS'>('ALL');
  const [classTeacherAssignments, setClassTeacherAssignments] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [importPreview, setImportPreview] = useState<{
    valid: string[];
    warnings: string[];
    errors: string[];
    rawAssignments: TeacherAssignment[];
  } | null>(null);

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
        setForceAnchorSlot1(existing.forceAnchorSlot1 || false);
      } else {
        setLoads([]);
        setSelSectionIds([]);
        // groupPeriods is handled by the effect above
        setAnchorSubject('');
        setAnchorPeriods(0);
        setForceAnchorSlot1(false);
      }
    }
  }, [selGradeId, editingId, assignments]);

  const teachingStaff = useMemo(() => {
    const nonTeachingRoles = [UserRole.ADMIN, UserRole.ADMIN_STAFF, UserRole.MANAGER, UserRole.PRINCIPAL];
    let filtered = users.filter(u => !u.isResigned && !nonTeachingRoles.includes(u.role as UserRole));
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
      filtered = filtered.filter(u => {
        const uName = (u.name || '').toLowerCase();
        const uEmpId = (u.employee_id || '').toLowerCase();
        return uName.includes(q) || uEmpId.includes(q);
      });
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
          label: `${a.anchorSubject} (Anchor - ${grade?.name || ''} ${section?.name || 'Class'} ${section ? `(${config.wings.find(w => w.id === section.wingId)?.name})` : ''})`,
          count: a.anchorPeriods
        });
      }
      (a.loads || []).forEach(l => {
        const section = config.sections.find(s => s.id === l.sectionId);
        standardBreakdown.push({
          label: `${l.subject} (${grade?.name || ''} ${section?.name || ''} ${section ? `(${config.wings.find(w => w.id === section.wingId)?.name})` : ''})`,
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
    
    // Auto-add to targetSectionIds if not already there
    setSelSectionIds(prev => prev.includes(newLoad.sectionId) ? prev : [...prev, newLoad.sectionId]);
    
    setNewLoad({ subject: '', periods: 1, sectionId: '', room: '' });
  };

  const handleUpdateLoad = (subject: string, sectionId: string, periods: number) => {
    setLoads(prev => {
      if (periods <= 0) {
        return prev.filter(l => !(l.subject === subject && l.sectionId === sectionId));
      }
      const existing = prev.find(l => l.subject === subject && l.sectionId === sectionId);
      if (existing) {
        return prev.map(l => l.subject === subject && l.sectionId === sectionId ? { ...l, periods } : l);
      }
      return [...prev, { subject, sectionId, periods }];
    });
  };

  const handleToggleAllSections = (subject: string, sections: SchoolSection[], isAssignedToAll: boolean) => {
    if (isAssignedToAll) {
      sections.forEach(sec => handleUpdateLoad(subject, sec.id, 0));
    } else {
      const existingLoad = loads.find(l => l.subject === subject && sections.some(s => s.id === l.sectionId));
      const periodsToAssign = existingLoad ? existingLoad.periods : 1;
      sections.forEach(sec => {
         const hasLoad = loads.some(l => l.subject === subject && l.sectionId === sec.id);
         if (!hasLoad) {
           handleUpdateLoad(subject, sec.id, periodsToAssign);
         }
      });
    }
  };

  const handleExportTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Workload Data");
    const wsRef = workbook.addWorksheet("Reference Data");

    // 1. Setup Reference Data Sheet
    wsRef.columns = [
      { header: 'Grades', key: 'grades' },
      { header: 'Sections', key: 'sections' },
      { header: 'Subjects', key: 'subjects' }
    ];

    const maxLen = Math.max(config.grades.length, config.sections.length, config.subjects.length);
    for (let i = 0; i < maxLen; i++) {
      wsRef.addRow({
        grades: config.grades[i]?.name || '',
        sections: config.sections[i]?.fullName || '',
        subjects: config.subjects[i]?.name || ''
      });
    }

    // Hide the reference sheet
    wsRef.state = 'hidden';

    // 2. Setup Workload Data Sheet
    ws.columns = [
      { header: 'Employee ID', key: 'empId', width: 15 },
      { header: 'Teacher Name', key: 'name', width: 25 },
      { header: 'Grade', key: 'grade', width: 15 },
      { header: 'Section', key: 'section', width: 15 },
      { header: 'Subject', key: 'subject', width: 20 },
      { header: 'Periods/Week', key: 'periods', width: 15 },
      { header: 'Room', key: 'room', width: 15 },
      { header: 'Is Anchor? (Y/N)', key: 'isAnchor', width: 15 }
    ];

    // Format headers
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // 3. Populate Data
    teachingStaff.forEach(t => {
      const teacherAssignments = assignments.filter(a => a.teacherId === t.id);
      
      if (teacherAssignments.length === 0) {
        ws.addRow({
          empId: t.employee_id,
          name: t.name,
          grade: '',
          section: '',
          subject: '',
          periods: '',
          room: '',
          isAnchor: 'N'
        });
      } else {
        teacherAssignments.forEach(a => {
          const grade = config.grades.find(g => g.id === a.gradeId);
          if (!grade) return;
          
          if (a.anchorSubject && a.anchorPeriods) {
            ws.addRow({
              empId: t.employee_id,
              name: t.name,
              grade: grade.name,
              section: '',
              subject: a.anchorSubject,
              periods: a.anchorPeriods,
              room: '',
              isAnchor: 'Y'
            });
          }
          
          a.loads.forEach(l => {
            const section = config.sections.find(s => s.id === l.sectionId);
            ws.addRow({
              empId: t.employee_id,
              name: t.name,
              grade: grade.name,
              section: section ? section.fullName : '',
              subject: l.subject,
              periods: l.periods,
              room: l.room || '',
              isAnchor: 'N'
            });
          });
        });
      }
    });

    // 4. Add Data Validation
    // We apply validation to the first 1000 rows to allow for new entries
    for (let i = 2; i <= 1000; i++) {
      // Grade column (C)
      if (config.grades.length > 0) {
        ws.getCell(`C${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'Reference Data'!$A$2:$A$${config.grades.length + 1}`]
        };
      }

      // Section column (D)
      if (config.sections.length > 0) {
        ws.getCell(`D${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'Reference Data'!$B$2:$B$${config.sections.length + 1}`]
        };
      }

      // Subject column (E)
      if (config.subjects.length > 0) {
        ws.getCell(`E${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'Reference Data'!$C$2:$C$${config.subjects.length + 1}`]
        };
      }

      // Is Anchor column (H)
      ws.getCell(`H${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Y,N"']
      };
    }

    // 5. Save File
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, "Faculty_Workload_Template.xlsx");
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const valid: string[] = [];
        const warnings: string[] = [];
        const errors: string[] = [];
        const newAssignmentsMap = new Map<string, TeacherAssignment>();

        data.forEach((row: any, index: number) => {
          const rowNum = index + 2;
          const empId = row['Employee ID'];
          const gradeName = row['Grade'];
          const sectionName = row['Section'];
          const subjectName = row['Subject'];
          const periods = parseInt(row['Periods/Week']);
          const room = row['Room'];
          const isAnchor = row['Is Anchor? (Y/N)'] === 'Y';

          if (!empId) return; // Skip empty rows

          const teacher = users.find(u => u.employee_id === empId);
          if (!teacher) {
            errors.push(`Row ${rowNum}: Employee ID '${empId}' not found.`);
            return;
          }

          if (!gradeName && !subjectName && !periods) return; // Empty assignment row

          const grade = config.grades.find(g => g.name === gradeName);
          if (!grade) {
            errors.push(`Row ${rowNum}: Grade '${gradeName}' not found.`);
            return;
          }

          if (!subjectName) {
            errors.push(`Row ${rowNum}: Subject is required.`);
            return;
          }

          if (isNaN(periods) || periods <= 0) {
            errors.push(`Row ${rowNum}: Invalid Periods/Week.`);
            return;
          }

          const key = `${teacher.id}_${grade.id}`;
          if (!newAssignmentsMap.has(key)) {
            newAssignmentsMap.set(key, {
              id: generateUUID(),
              teacherId: teacher.id,
              gradeId: grade.id,
              loads: [],
              targetSectionIds: [],
              groupPeriods: 0
            });
          }

          const assignment = newAssignmentsMap.get(key)!;

          if (isAnchor) {
            assignment.anchorSubject = subjectName;
            assignment.anchorPeriods = periods;
            valid.push(`Row ${rowNum}: Set Anchor Subject '${subjectName}' (${periods} periods) for ${teacher.name} in ${grade.name}`);
          } else {
            const section = config.sections.find(s => s.fullName === sectionName && s.gradeId === grade.id);
            if (!section) {
              errors.push(`Row ${rowNum}: Section '${sectionName}' not found in ${grade.name}.`);
              return;
            }
            assignment.loads.push({
              subject: subjectName,
              periods: periods,
              sectionId: section.id,
              room: room || undefined
            });
            if (!assignment.targetSectionIds.includes(section.id)) {
              assignment.targetSectionIds.push(section.id);
            }
            valid.push(`Row ${rowNum}: Added ${subjectName} (${periods} periods) for ${teacher.name} in ${section.fullName}`);
          }
        });

        // Check for overloaded teachers
        const teacherLoads = new Map<string, number>();
        newAssignmentsMap.forEach(a => {
          let load = (a.anchorPeriods || 0) + a.loads.reduce((sum, l) => sum + l.periods, 0);
          teacherLoads.set(a.teacherId, (teacherLoads.get(a.teacherId) || 0) + load);
        });

        teacherLoads.forEach((load, tId) => {
          const teacher = users.find(u => u.id === tId);
          if (teacher && load > 28) {
            warnings.push(`${teacher.name} is assigned ${load} periods, which exceeds the base target of 28.`);
          }
        });

        setImportPreview({
          valid,
          warnings,
          errors,
          rawAssignments: Array.from(newAssignmentsMap.values())
        });

      } catch (err) {
        showToast("Failed to parse Excel file.", "error");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; // Reset input
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        const teacherIds = Array.from(new Set(importPreview.rawAssignments.map(a => a.teacherId)));
        
        const { error: deleteError } = await supabase
          .from('teacher_assignments')
          .delete()
          .in('teacher_id', teacherIds);
          
        if (deleteError) throw deleteError;

        if (importPreview.rawAssignments.length > 0) {
          const { error: insertError } = await supabase
            .from('teacher_assignments')
            .insert(importPreview.rawAssignments.map(a => ({
              id: a.id,
              teacher_id: a.teacherId,
              grade_id: a.gradeId,
              loads: a.loads,
              target_section_ids: a.targetSectionIds,
              group_periods: a.groupPeriods,
              anchor_subject: a.anchorSubject || null,
              anchor_periods: a.anchorPeriods || 0,
              force_anchor_slot1: a.forceAnchorSlot1 || false,
              preferred_slots: a.preferredSlots || [],
              restricted_slots: a.restrictedSlots || []
            })));
            
          if (insertError) throw insertError;
        }
      }

      const teacherIds = Array.from(new Set(importPreview.rawAssignments.map(a => a.teacherId)));
      setAssignments(prev => [
        ...prev.filter(a => !teacherIds.includes(a.teacherId)),
        ...importPreview.rawAssignments
      ]);

      showToast("Workload successfully imported and synced.", "success");
      setImportPreview(null);
    } catch (err: any) {
      console.error("Import commit failed:", err);
      showToast(`Import Failed: ${err.message}`, "error");
    }
  };

  const handleExport = () => {
    const data = teachingStaff.map(t => {
      const m = getTeacherMetrics(t.id);
      const ctSection = t.classTeacherOf ? config.sections.find(s => s.id === t.classTeacherOf) : null;
      return {
        'Employee ID': t.employee_id,
        'Name': t.name,
        'Role': t.role,
        'Class Teacher Of': ctSection ? `${ctSection.fullName} (${config.wings.find(w => w.id === ctSection.wingId)?.name || ''})` : 'N/A',
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

  const handleSave = async (closeModal: boolean = true) => {
    if (!editingId || !selGradeId) return;
    
    if (localClassTeacherOf && anchorPeriods > 5) {
      showToast("Anchor periods for class teachers cannot exceed 5 per week", "error");
      return;
    }

    // Check if an assignment already exists for this teacher and grade to reuse the ID
    const existingAssignment = assignments.find(a => a.teacherId === editingId && a.gradeId === selGradeId);
    
    const finalSectionIds = Array.from(new Set(loads.map(l => l.sectionId)));
    
    const newAsgn: TeacherAssignment = {
      id: existingAssignment ? existingAssignment.id : generateUUID(),
      teacherId: editingId,
      gradeId: selGradeId,
      loads: loads,
      targetSectionIds: finalSectionIds,
      groupPeriods: groupPeriods,
      anchorSubject: anchorSubject || undefined,
      anchorPeriods: anchorPeriods || undefined,
      forceAnchorSlot1: forceAnchorSlot1,
      preferredSlots: preferredSlots,
      restrictedSlots: restrictedSlots
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
               target_section_ids: finalSectionIds,
               group_periods: groupPeriods,
               anchor_subject: anchorSubject || null,
               anchor_periods: anchorPeriods || 0,
               force_anchor_slot1: forceAnchorSlot1,
               preferred_slots: preferredSlots,
               restricted_slots: restrictedSlots
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
               target_section_ids: finalSectionIds,
               group_periods: groupPeriods,
               anchor_subject: anchorSubject || null,
               anchor_periods: anchorPeriods || 0,
               force_anchor_slot1: forceAnchorSlot1,
               preferred_slots: preferredSlots,
               restricted_slots: restrictedSlots
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
      if (closeModal) setEditingId(null);
    } catch (err: any) {
      console.error("Workload sync failed:", err);
      if (err.code === '23503') {
        showToast("Sync Failed: Teacher profile not found in cloud registry. Please register this teacher in the Staff Directory first.", "error");
      } else {
        showToast(`Sync Failed: ${err.message}`, "error");
      }
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
          
          <div className="relative">
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              onChange={handleImport} 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              title="Import Workload Excel"
            />
            <button className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-all flex items-center gap-2" title="Import Workload">
              <Upload className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider hidden md:block">Import</span>
            </button>
          </div>
          
          <button onClick={handleExportTemplate} className="p-3 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-all flex items-center gap-2" title="Export Template">
            <Download className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider hidden md:block">Export Template</span>
          </button>
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
                        <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{section.fullName} <span className="text-[10px] text-slate-400">({config.wings.find(w => w.id === section.wingId)?.name})</span></p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{config.grades.find(g => g.id === section.gradeId)?.name}</p>
                      </td>
                      <td className="p-6">
                        {currentTeacher ? (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-black">{currentTeacher.name.charAt(0)}</div>
                            <div>
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{currentTeacher.name}</p>
                              <p className="text-[9px] font-bold text-slate-400">{currentTeacher.employee_id}</p>
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
                            <option key={u.id} value={u.id}>{u.name} ({u.employee_id})</option>
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
                            <p className="text-[10px] font-bold text-slate-400">{t.employee_id}</p>
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
                            setForceAnchorSlot1(existing?.forceAnchorSlot1 || false);
                            setPreferredSlots(existing?.preferredSlots || []);
                            setRestrictedSlots(existing?.restrictedSlots || []);
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
                        {ctSection && <span className="px-2 py-0.5 bg-sky-50 text-sky-600 text-[6px] font-black uppercase rounded-lg border border-sky-100 shadow-sm">Class Teacher: {ctSection.fullName} ({config.wings.find(w => w.id === ctSection.wingId)?.name})</span>}
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{t.employee_id}</p>
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
                   setForceAnchorSlot1(existing?.forceAnchorSlot1 || false);
                   setPreferredSlots(existing?.preferredSlots || []);
                   setRestrictedSlots(existing?.restrictedSlots || []);
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
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest leading-none">{breakdownTeacher.name} • {breakdownTeacher.employee_id}</p>
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
          <div className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-[2rem] shadow-2xl flex flex-col animate-in zoom-in duration-300 max-h-[95vh] overflow-hidden">
            
            {/* Sticky Header & Capacity Bar */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 z-10">
               <div className="flex justify-between items-start mb-4">
                 <div>
                    <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Smart Workload Matrix</h3>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Target: {editingTeacher.name}</p>
                 </div>
                 <button onClick={() => setEditingId(null)} className="p-2 text-slate-400 hover:text-rose-500 transition-all"><X className="w-6 h-6"/></button>
               </div>
               
               {/* Capacity Bar */}
               {(() => {
                  const currentMetrics = getTeacherMetrics(editingId);
                  const savedAssignment = assignments.find(a => a.teacherId === editingId && a.gradeId === selGradeId);
                  const savedBaseForGrade = savedAssignment ? (savedAssignment.loads.reduce((s, l) => s + l.periods, 0) + (savedAssignment.anchorPeriods || 0)) : 0;
                  const draftBaseLoad = loads.reduce((sum, l) => sum + l.periods, 0) + (anchorPeriods || 0);
                  const draftTotalLoad = currentMetrics.total - savedBaseForGrade + draftBaseLoad;
                  const capacityPct = Math.min(100, (draftTotalLoad / 28) * 100);
                  const isOverloaded = draftTotalLoad > 28;
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Assigned Capacity</span>
                        <span className={`text-sm font-black italic ${isOverloaded ? 'text-rose-500' : 'text-emerald-500'}`}>{draftTotalLoad} / 28 Periods</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div style={{ width: `${capacityPct}%` }} className={`h-full transition-all duration-300 ${isOverloaded ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                      </div>
                    </div>
                  );
               })()}
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
               
               {/* Grade Tabs */}
               <div className="space-y-3">
                 <div className="flex justify-between items-center">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Select Grade Level</p>
                   <div className="flex gap-1">
                     <button onClick={() => gradeTabsRef.current?.scrollBy({ left: -150, behavior: 'smooth' })} className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-[#001f3f] dark:hover:text-white transition-colors" title="Scroll left">
                       <ChevronLeft className="w-4 h-4" />
                     </button>
                     <button onClick={() => gradeTabsRef.current?.scrollBy({ left: 150, behavior: 'smooth' })} className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-[#001f3f] dark:hover:text-white transition-colors" title="Scroll right">
                       <ChevronRight className="w-4 h-4" />
                     </button>
                   </div>
                 </div>
                 <div ref={gradeTabsRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth">
                   {config.grades.map(g => {
                     const wing = config.wings.find(w => w.id === g.wingId);
                     return (
                       <button 
                         key={g.id}
                         onClick={async () => {
                           if (g.id !== selGradeId) {
                             await handleSave(false); // Save current draft
                             const existing = assignments.find(a => a.teacherId === editingId && a.gradeId === g.id); setLoads(existing?.loads || []); setSelGradeId(g.id); setSelSectionIds(existing?.targetSectionIds || []); setGroupPeriods(existing?.groupPeriods || 0); setAnchorSubject(existing?.anchorSubject || ''); setAnchorPeriods(existing?.anchorPeriods || 0); setForceAnchorSlot1(existing?.forceAnchorSlot1 || false); setPreferredSlots(existing?.preferredSlots || []); setRestrictedSlots(existing?.restrictedSlots || []);
                           }
                         }} 
                         className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider whitespace-nowrap transition-all flex flex-col items-center justify-center gap-0.5 ${selGradeId === g.id ? 'bg-[#001f3f] text-amber-400 shadow-md scale-105' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                       >
                         <span>{g.name}</span>
                         {wing && <span className={`text-[9px] font-bold ${selGradeId === g.id ? 'text-amber-400/70' : 'text-slate-400/70'}`}>{wing.name}</span>}
                       </button>
                     );
                   })}
                 </div>
               </div>

               {/* The Matrix */}
               <div className="space-y-3">
                 <div className="flex justify-between items-end">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Subject & Section Matrix</p>
                   <p className="text-[9px] font-bold text-slate-400 italic">Click cells to assign periods</p>
                 </div>
                 
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
                   <table className="w-full text-left border-collapse min-w-[600px]">
                     <thead>
                       <tr>
                         <th className="p-4 border-b border-slate-200 dark:border-slate-800 font-black text-[10px] text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-800/50">Subject</th>
                         {config.sections.filter(s => s.gradeId === selGradeId).map(sec => (
                           <th key={sec.id} className="p-4 border-b border-slate-200 dark:border-slate-800 font-black text-[11px] text-center text-[#001f3f] dark:text-white uppercase tracking-wider bg-slate-50 dark:bg-slate-800/50">{sec.fullName}</th>
                         ))}
                         <th className="p-4 border-b border-slate-200 dark:border-slate-800 font-black text-[10px] text-right text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-800/50">Quick Action</th>
                       </tr>
                     </thead>
                     <tbody>
                       {config.subjects.map(sub => {
                         const sectionsInGrade = config.sections.filter(s => s.gradeId === selGradeId);
                         if (sectionsInGrade.length === 0) return null;
                         
                         const isAssignedToAll = sectionsInGrade.every(sec => loads.some(l => l.subject === sub.name && l.sectionId === sec.id));
                         const isAssignedToAny = sectionsInGrade.some(sec => loads.some(l => l.subject === sub.name && l.sectionId === sec.id));
                         
                         return (
                           <tr key={sub.id} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors group">
                             <td className="p-4 font-bold text-xs text-slate-700 dark:text-slate-300">{sub.name}</td>
                             {sectionsInGrade.map(sec => {
                               const load = loads.find(l => l.subject === sub.name && l.sectionId === sec.id);
                               return (
                                 <td key={sec.id} className="p-2 text-center">
                                   {load ? (
                                     <div className="inline-flex items-center bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
                                       <button onClick={() => handleUpdateLoad(sub.name, sec.id, load.periods - 1)} className="px-3 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800 font-black transition-colors">-</button>
                                       <span className="px-2 py-2 font-black text-indigo-900 dark:text-indigo-100 text-xs w-8 text-center">{load.periods}</span>
                                       <button onClick={() => handleUpdateLoad(sub.name, sec.id, load.periods + 1)} className="px-3 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800 font-black transition-colors">+</button>
                                     </div>
                                   ) : (
                                     <button onClick={() => handleUpdateLoad(sub.name, sec.id, 1)} className="w-10 h-10 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all flex items-center justify-center mx-auto opacity-0 group-hover:opacity-100 focus:opacity-100">
                                       <span className="font-black text-lg leading-none">+</span>
                                     </button>
                                   )}
                                 </td>
                               );
                             })}
                             <td className="p-4 text-right">
                               <button 
                                 onClick={() => handleToggleAllSections(sub.name, sectionsInGrade, isAssignedToAll)}
                                 className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${isAssignedToAll ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40' : (isAssignedToAny ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600')}`}
                               >
                                 {isAssignedToAll ? 'Clear All' : 'Assign All'}
                               </button>
                             </td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
               </div>

               {/* Advanced Settings (Collapsible or compact) */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Class Teacher & Anchor</p>
                     <select 
                       value={localClassTeacherOf} 
                       onChange={e => {
                         const newSectionId = e.target.value;
                         setLocalClassTeacherOf(newSectionId);
                         if (newSectionId && anchorPeriods > 5) {
                           setAnchorPeriods(5);
                           showToast("Anchor periods capped at 5 for class teachers", "info");
                         }
                       }} 
                       className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-sky-400"
                     >
                        <option value="">None (Not a Class Teacher)</option>
                        {config.sections.map(s => <option key={s.id} value={s.id}>Class Teacher of: {s.fullName} ({config.wings.find(w => w.id === s.wingId)?.name})</option>)}
                     </select>
                     <div className="flex gap-2">
                       <select 
                         value={anchorSubject} 
                         onChange={e => setAnchorSubject(e.target.value)} 
                         className="flex-1 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-amber-400"
                       >
                          <option value="">Anchor Subject</option>
                          {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                       </select>
                       <input 
                         type="number" 
                         placeholder="Periods"
                         className="w-24 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none border-2 border-transparent focus:border-amber-400 text-center" 
                         value={anchorPeriods || ''} 
                         max={localClassTeacherOf ? 5 : undefined}
                         onChange={e => {
                           const val = parseInt(e.target.value) || 0;
                           if (localClassTeacherOf && val > 5) {
                             setAnchorPeriods(5);
                             showToast("Capped at 5 per week", "warning");
                           } else {
                             setAnchorPeriods(val);
                           }
                         }} 
                       />
                     </div>
                  </div>

                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">4. Time Table Preferences</p>
                     {(() => {
                        const grade = config.grades.find(g => g.id === selGradeId);
                        const wing = config.wings.find(w => w.id === grade?.wingId);
                        const slots = wing ? (config.slotDefinitions?.[wing.sectionType] || []) : [];
                        const regularSlots = slots.filter(s => !s.isBreak);
                        
                        if (!selGradeId || regularSlots.length === 0) {
                          return <p className="text-[10px] font-bold text-slate-400 italic">Select a grade to configure slot preferences.</p>;
                        }

                        return (
                          <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {regularSlots.map(slot => {
                                const slotIdStr = slot.id.toString();
                                const isPreferred = preferredSlots.includes(slotIdStr);
                                const isRestricted = restrictedSlots.includes(slotIdStr);
                                return (
                                  <button
                                    key={`pref-${slot.id}`}
                                    onClick={() => {
                                      if (isRestricted) setRestrictedSlots(prev => prev.filter(id => id !== slotIdStr));
                                      if (isPreferred) {
                                        setPreferredSlots(prev => prev.filter(id => id !== slotIdStr));
                                      } else {
                                        setPreferredSlots(prev => [...prev, slotIdStr]);
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      if (isPreferred) setPreferredSlots(prev => prev.filter(id => id !== slotIdStr));
                                      if (isRestricted) {
                                        setRestrictedSlots(prev => prev.filter(id => id !== slotIdStr));
                                      } else {
                                        setRestrictedSlots(prev => [...prev, slotIdStr]);
                                      }
                                    }}
                                    className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${isPreferred ? 'bg-emerald-500 text-white shadow-md' : isRestricted ? 'bg-rose-500 text-white shadow-md' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-400'}`}
                                  >
                                    {slot.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[8px] font-bold text-slate-400 italic">Left-click to prefer, Right-click to restrict.</p>
                          </div>
                        );
                      })()}
                  </div>
               </div>

               {/* Other Assignments (Read-Only) */}
               <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">5. Other Assignments (Read-Only)</p>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="bg-amber-50/50 dark:bg-amber-900/10 p-4 rounded-2xl border border-amber-100 dark:border-amber-800/50">
                     <h5 className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div> Pool Periods</h5>
                     {assignedBlocks.length > 0 ? (
                       <div className="space-y-1.5">
                         {assignedBlocks.map(b => (
                           <div key={b.id} className="flex justify-between items-center bg-white dark:bg-slate-900 px-3 py-2 rounded-xl shadow-sm">
                             <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate pr-2">{b.title}</span>
                             <span className="text-[10px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-md">{b.weeklyPeriods}P</span>
                           </div>
                         ))}
                       </div>
                     ) : <p className="text-[9px] font-bold text-slate-400 italic">No pool periods assigned.</p>}
                   </div>

                   <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                     <h5 className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div> Lab Periods</h5>
                     {assignedLabs.length > 0 ? (
                       <div className="space-y-1.5">
                         {assignedLabs.map(b => {
                           const periods = b.weeklyOccurrences * (b.isDoublePeriod ? 2 : 1);
                           return (
                             <div key={b.id} className="flex justify-between items-center bg-white dark:bg-slate-900 px-3 py-2 rounded-xl shadow-sm">
                               <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate pr-2">{b.title}</span>
                               <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md">{periods}P</span>
                             </div>
                           );
                         })}
                       </div>
                     ) : <p className="text-[9px] font-bold text-slate-400 italic">No lab periods assigned.</p>}
                   </div>

                   <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
                     <h5 className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Extra Curricular</h5>
                     {assignedActivities.length > 0 ? (
                       <div className="space-y-1.5">
                         {assignedActivities.map(r => {
                           const periods = r.sectionIds.length * r.periodsPerWeek;
                           return (
                             <div key={r.id} className="flex justify-between items-center bg-white dark:bg-slate-900 px-3 py-2 rounded-xl shadow-sm">
                               <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate pr-2">{r.subject}</span>
                               <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md">{periods}P</span>
                             </div>
                           );
                         })}
                       </div>
                     ) : <p className="text-[9px] font-bold text-slate-400 italic">No extra curricular assigned.</p>}
                   </div>
                 </div>
               </div>

            </div>

            {/* Footer Actions */}
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 shrink-0 bg-slate-50 dark:bg-slate-900/50 flex gap-4">
               <button onClick={async () => { await handleSave(); }} className="flex-1 bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all">Save & Close</button>
               <button onClick={() => setEditingId(null)} className="px-8 py-5 bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Discard</button>
            </div>
          </div>
        </div>
      )}
      {/* Import Preview Modal */}
      {importPreview && (
        <div className="fixed inset-0 z-[1300] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-start shrink-0">
              <div>
                <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Review Workload Import</h3>
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Verify changes before committing to the database</p>
              </div>
              <button onClick={() => setImportPreview(null)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-4 scrollbar-hide">
              {importPreview.errors.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-rose-500 uppercase flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Critical Errors ({importPreview.errors.length})
                  </h4>
                  <div className="bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 space-y-2">
                    {importPreview.errors.map((err, i) => (
                      <p key={i} className="text-[11px] font-bold text-rose-700 dark:text-rose-400">{err}</p>
                    ))}
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 italic">You must fix these errors in your Excel file and re-upload before you can commit.</p>
                </div>
              )}

              {importPreview.warnings.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-amber-500 uppercase flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Warnings ({importPreview.warnings.length})
                  </h4>
                  <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-2">
                    {importPreview.warnings.map((warn, i) => (
                      <p key={i} className="text-[11px] font-bold text-amber-700 dark:text-amber-400">{warn}</p>
                    ))}
                  </div>
                </div>
              )}

              {importPreview.valid.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-emerald-500 uppercase flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" /> Valid Changes ({importPreview.valid.length})
                  </h4>
                  <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
                    {importPreview.valid.map((msg, i) => (
                      <p key={i} className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border-b border-emerald-100 dark:border-emerald-800/50 pb-2 last:border-0 last:pb-0">{msg}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 flex gap-4 shrink-0 border-t border-slate-100 dark:border-slate-800">
              <button 
                onClick={handleCommitImport} 
                disabled={importPreview.errors.length > 0}
                className={`flex-1 py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl transition-all ${importPreview.errors.length > 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950'}`}
              >
                Commit Workload Matrix
              </button>
              <button onClick={() => setImportPreview(null)} className="px-10 py-6 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-[2rem] font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignmentView;
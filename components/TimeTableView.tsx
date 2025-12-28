import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';

// Declare html2pdf for TypeScript
declare var html2pdf: any;

interface TimeTableViewProps {
  user: User;
  users: User[];
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  substitutions: SubstitutionRecord[];
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  onManualSync: () => void;
  triggerConfirm: (message: string, onConfirm: () => void) => void;
}

const TimeTableView: React.FC<TimeTableViewProps> = ({ user, users, timetable, setTimetable, substitutions, config, assignments, setAssignments, onManualSync, triggerConfirm }) => {
  const isManagement = user.role === UserRole.ADMIN || user.role.startsWith('INCHARGE_');
  
  const [activeSection, setActiveSection] = useState<SectionType>('PRIMARY');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [viewMode, setViewMode] = useState<'CLASS' | 'TEACHER' | 'NONE'>(isManagement ? 'CLASS' : 'TEACHER');
  const [isDesigning, setIsDesigning] = useState(false);
  const [nonMgmtView, setNonMgmtView] = useState<'personal' | 'class'>(user.classTeacherOf ? 'class' : 'personal');
  const [dragOverCell, setDragOverCell] = useState<{ day: string, slotId: number } | null>(null);
  const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);
  const [bulkType, setBulkType] = useState<'CLASS' | 'TEACHER' | 'NONE'>('NONE');
  
  const [mobileDayIndex, setMobileDayIndex] = useState(() => {
    const today = new Date().getDay();
    // Days are 0-4 (Sun-Thu). If Fri(5) or Sat(6), default to Sun(0)
    return today >= 0 && today <= 4 ? today : 0; 
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot} | null>(null);
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const weekDates = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    
    return DAYS.map((_, index) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + index);
      return d.toISOString().split('T')[0];
    });
  }, []);

  useEffect(() => {
    if (!isManagement) {
      if (nonMgmtView === 'class' && user.classTeacherOf) {
        setSelectedClass(user.classTeacherOf);
        setViewMode('CLASS');
      } else {
        setSelectedClass(user.id);
        setViewMode('TEACHER');
      }
    }
  }, [nonMgmtView, isManagement, user.classTeacherOf, user.id]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const slots = useMemo(() => {
    let targetSection = activeSection;
    if (selectedClass && viewMode === 'CLASS') {
      const classObj = config.classes.find(c => c.name === selectedClass);
      if (classObj) targetSection = classObj.section;
    }
    if (targetSection === 'PRIMARY') return PRIMARY_SLOTS;
    if (targetSection === 'SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, [activeSection, selectedClass, config.classes, viewMode]);

  const classTeacherName = (className: string) => {
    return users.find(u => u.classTeacherOf === className)?.name || 'Unassigned';
  };

  const handlePrint = (e: React.MouseEvent) => {
    e.preventDefault();
    window.print();
  };

  const handleSync = () => {
    onManualSync();
    setStatus({ type: 'success', message: 'Timetable synchronization completed.' });
  };

  const handleDownloadPDF = async (e: React.MouseEvent) => {
    e.preventDefault();
    const element = document.querySelector('.printable-area');
    if (!element) return;
    const profileName = viewMode === 'CLASS' ? selectedClass : (users.find(u => u.id === selectedClass)?.name || 'Teacher');
    
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Timetable_${profileName}_2026-27.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    try {
      if (typeof html2pdf !== 'undefined') await html2pdf().set(opt).from(element).save();
    } catch (err) {
      window.print();
    }
  };

  const handleExportBulk = async (type: 'CLASS' | 'TEACHER') => {
    setBulkType(type);
    setIsGeneratingBulk(true);
    
    // Extended timeout to ensure the bulk container and its hundreds of table cells are rendered in DOM
    setTimeout(async () => {
      const element = document.getElementById('bulk-printable-container');
      if (!element) {
        setIsGeneratingBulk(false);
        setBulkType('NONE');
        return;
      }

      const label = type === 'CLASS' ? 'Class_Timetables' : 'Faculty_Timetables';
      const opt = {
        margin: [5, 5, 5, 5],
        filename: `IHIS_Bulk_${label}_2026-27.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'], after: '.page-break' }
      };

      try {
        if (typeof html2pdf !== 'undefined') {
          // Temporarily set to relative for html2pdf to capture content better
          element.style.position = 'relative';
          element.style.opacity = '1';
          element.style.left = '0';
          element.style.top = '0';
          
          await html2pdf().set(opt).from(element).save();
        }
      } catch (err) {
        console.error("Bulk PDF Generation Error:", err);
      } finally {
        setIsGeneratingBulk(false);
        setBulkType('NONE');
        // Reset element position
        if (element) {
          element.style.position = 'fixed';
          element.style.opacity = '0';
          element.style.left = '-9999px';
        }
      }
    }, 1500);
  };

  const availableSubjectsForModal = useMemo(() => {
    const targetTeacherId = viewMode === 'TEACHER' ? selectedClass : manualData.teacherId;
    const targetClassName = viewMode === 'CLASS' ? selectedClass : manualData.className;
    if (!targetTeacherId || !targetClassName) return [];
    const grade = (targetClassName.match(/[IVX]+/) || [targetClassName])[0];
    const tAssignments = assignments.filter(a => a.teacherId === targetTeacherId && a.grade.includes(grade));
    const assignedSubjectNames = Array.from(new Set(tAssignments.flatMap(a => a.loads.map(l => l.subject))));
    if (assignedSubjectNames.length > 0) {
      return config.subjects.filter(s => assignedSubjectNames.includes(s.name));
    }
    return config.subjects;
  }, [viewMode, selectedClass, manualData.teacherId, manualData.className, assignments, config.subjects]);

  const openEntryModal = (day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
    if (!selectedClass) return;
    setEditContext({ day, slot });
    if (entry) {
      setManualData({ teacherId: entry.teacherId, subject: entry.subject, className: entry.className });
    } else {
      setManualData({ 
        teacherId: viewMode === 'TEACHER' ? selectedClass : '', 
        subject: '', 
        className: viewMode === 'CLASS' ? selectedClass : '' 
      });
    }
    setShowEditModal(true);
  };

  const saveManualEntry = () => {
    if (!editContext || !manualData.subject) return;
    const targetTeacherId = viewMode === 'TEACHER' ? selectedClass : manualData.teacherId;
    const targetClassName = viewMode === 'CLASS' ? selectedClass : manualData.className;
    if (!targetTeacherId || !targetClassName) return;

    const teacher = users.find(u => u.id === targetTeacherId);
    const subObj = config.subjects.find(s => s.name === manualData.subject);
    const classObj = config.classes.find(c => c.name === targetClassName);
    
    const newEntry: TimeTableEntry = {
      id: `man-${targetClassName}-${editContext.day}-${editContext.slot.id}-${Date.now()}`,
      className: targetClassName,
      day: editContext.day,
      slotId: editContext.slot.id,
      section: classObj?.section || activeSection,
      subject: manualData.subject,
      subjectCategory: subObj?.category || SubjectCategory.CORE,
      teacherId: targetTeacherId,
      teacherName: teacher?.name || 'Unknown'
    };

    setTimetable(prev => [
      ...prev.filter(t => (
        viewMode === 'CLASS' 
          ? !(t.className === targetClassName && t.day === editContext.day && t.slotId === editContext.slot.id)
          : !(t.teacherId === targetTeacherId && t.day === editContext.day && t.slotId === editContext.slot.id)
      )),
      newEntry
    ]);

    setShowEditModal(false);
  };

  const handleDragStart = (e: React.DragEvent, entryId: string) => {
    if (!isDesigning) return;
    e.dataTransfer.setData('ihis-entry-id', entryId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, day: string, slotId: number) => {
    if (!isDesigning) return;
    e.preventDefault();
    setDragOverCell({ day, slotId });
  };

  const handleDragLeave = () => {
    setDragOverCell(null);
  };

  const handleDrop = (e: React.DragEvent, targetDay: string, targetSlotId: number) => {
    if (!isDesigning) return;
    e.preventDefault();
    setDragOverCell(null);
    const entryId = e.dataTransfer.getData('ihis-entry-id');
    if (!entryId) return;

    const sourceEntry = timetable.find(t => t.id === entryId);
    if (!sourceEntry) return;

    const targetEntry = timetable.find(t => 
      (viewMode === 'CLASS' ? t.className === selectedClass : t.teacherId === selectedClass) &&
      t.day === targetDay && 
      t.slotId === targetSlotId
    );

    setTimetable(prev => {
      let next = [...prev];
      if (targetEntry) {
        next = next.map(t => {
          if (t.id === sourceEntry.id) return { ...t, day: targetDay, slotId: targetSlotId };
          if (t.id === targetEntry.id) return { ...t, day: sourceEntry.day, slotId: sourceEntry.slotId };
          return t;
        });
      } else {
        next = next.map(t => t.id === sourceEntry.id ? { ...t, day: targetDay, slotId: targetSlotId } : t);
      }
      return next;
    });
    setStatus({ type: 'success', message: 'Slot rescheduled successfully.' });
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER') => {
    if (slot.isBreak) return null;
    const dateStr = weekDates[index];
    const isTeacherView = currentViewMode === 'TEACHER';

    const subEntry = substitutions.find(s => 
      s.date === dateStr && 
      s.slotId === slot.id && 
      (isTeacherView ? s.substituteTeacherId === targetId : s.className === targetId)
    );

    const baseEntry = timetable.find(t => t.day === day && t.slotId === slot.id && (isTeacherView ? t.teacherId === targetId : t.className === targetId));
    const iAmAbsentHere = isTeacherView && substitutions.find(s => s.date === dateStr && s.slotId === slot.id && s.absentTeacherId === targetId);

    if (subEntry) {
      return (
        <div className={`h-full flex items-center justify-center bg-red-50 dark:bg-red-950/20 border-2 border-red-500 rounded-lg text-center animate-pulse w-full p-1`}>
          <div className="overflow-hidden">
            <p className="text-[8px] md:text-[11px] font-black uppercase text-red-600 dark:text-red-400 tracking-tight leading-none truncate">
              {subEntry.subject}
            </p>
            <p className="text-[6px] md:text-[9px] font-bold text-red-700 dark:text-red-300 leading-none truncate mt-0.5">
              {isTeacherView ? subEntry.className : `Sub: ${subEntry.substituteTeacherName.split(' ')[0]}`}
            </p>
          </div>
        </div>
      );
    }

    if (iAmAbsentHere) {
      return (
        <div className="h-full border border-red-100 dark:border-red-900/30 rounded-lg flex items-center justify-center opacity-40 bg-red-50/10 w-full">
          <span className="text-red-500 text-[8px] font-black uppercase tracking-widest italic leading-none">ABS</span>
        </div>
      );
    }

    if (!baseEntry) {
      return (
        <div onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800/10 rounded-sm flex items-center justify-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''}`}>
          {isDesigning && <span className="text-slate-200 text-lg font-thin">+</span>}
        </div>
      );
    }

    return (
      <div 
        draggable={isDesigning}
        onDragStart={(e) => handleDragStart(e, baseEntry.id)}
        onClick={() => isDesigning && openEntryModal(day, slot, baseEntry)} 
        className={`h-full p-1 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-sm flex flex-col justify-center text-center group relative transition-all w-full ${isDesigning ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400/50' : ''} print:border-black`}
      >
        {isDesigning && <button onClick={(e) => { e.stopPropagation(); setTimetable(prev => prev.filter(t => t.id !== baseEntry.id)); }} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-500 font-black text-[12px] z-10 no-print">×</button>}
        <div className="overflow-hidden">
          <p className={`text-[8px] md:text-[11px] font-black uppercase tracking-tight leading-none truncate ${baseEntry.subjectCategory === SubjectCategory.CORE ? 'text-sky-600' : 'text-emerald-600'}`}>
            {baseEntry.subject}
          </p>
          <p className="text-[6px] md:text-[9px] font-bold text-[#001f3f] dark:text-white leading-none mt-0.5 truncate">
            {isTeacherView ? baseEntry.className : baseEntry.teacherName.split(' ')[0]}
          </p>
        </div>
      </div>
    );
  };

  const bulkEntities = useMemo(() => {
    if (bulkType === 'CLASS') {
      return [...config.classes].sort((a, b) => a.name.localeCompare(b.name));
    } else if (bulkType === 'TEACHER') {
      return users.filter(u => {
        if (activeSection === 'PRIMARY') return u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY;
        if (activeSection === 'SECONDARY_BOYS' || activeSection === 'SECONDARY_GIRLS') {
          return u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.TEACHER_SENIOR_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY;
        }
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }, [bulkType, config.classes, users, activeSection]);

  const getSlotsForEntity = (entity: any) => {
    let section: SectionType = activeSection;
    if (bulkType === 'CLASS') {
      section = entity.section;
    }
    if (section === 'PRIMARY') return PRIMARY_SLOTS;
    if (section === 'SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  };

  return (
    <div className="flex flex-col h-full max-h-full space-y-2 md:space-y-4 animate-in fade-in duration-700 overflow-hidden print:overflow-visible w-full">
      {/* Loading Overlay for Bulk Export */}
      {isGeneratingBulk && (
        <div className="fixed inset-0 z-[10000] bg-brand-navy/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
          <div className="w-16 h-16 border-4 border-amber-400/20 border-t-amber-400 rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-black uppercase italic tracking-[0.2em] text-amber-400">Institutional Report Engine</h2>
          <p className="text-[9px] font-black uppercase tracking-widest mt-2 opacity-60">Synchronizing bulk data for {bulkEntities.length} profiles...</p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 md:gap-4 no-print shrink-0 px-2">
        <div className="flex items-center space-x-3">
          <h1 className="text-lg md:text-xl font-black text-[#001f3f] dark:text-white tracking-tight italic truncate">
            {viewMode === 'CLASS' ? `Class: ${selectedClass || '...'}` : `Faculty: ${users.find(u => u.id === selectedClass)?.name || '...'}`}
          </h1>
          <div className="hidden sm:block px-3 py-1 bg-sky-100 dark:bg-sky-900/30 rounded-full border border-sky-200 dark:border-sky-800">
             <span className="text-[9px] font-black text-sky-600 uppercase tracking-widest">
               {weekDates[0]} - {weekDates[4]}
             </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 md:gap-2">
          {isManagement && (
            <>
              <button onClick={() => handleExportBulk('CLASS')} disabled={isGeneratingBulk} className="bg-sky-500 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase shadow hover:bg-sky-600 transition-all flex items-center space-x-1">
                 <span>Export All Classes</span>
              </button>
              <button onClick={() => handleExportBulk('TEACHER')} disabled={isGeneratingBulk} className="bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase shadow hover:bg-emerald-700 transition-all flex items-center space-x-1">
                 <span>Export Dept. Faculty</span>
              </button>
              <button onClick={() => setIsDesigning(!isDesigning)} className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Done' : 'Edit'}</button>
              <button onClick={handleSync} className="bg-[#001f3f] text-[#d4af37] px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase shadow">Sync</button>
            </>
          )}
          <button onClick={handleDownloadPDF} className="bg-sky-600 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase flex items-center justify-center space-x-2"><span className="hidden md:inline">PDF</span><svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
          <button onClick={handlePrint} className="bg-[#001f3f] text-[#d4af37] px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase flex items-center justify-center space-x-2 border border-amber-400 shadow"><span className="hidden md:inline">PRINT</span><svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg></button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden no-print shrink-0 mx-2">
        <div className="p-2 flex flex-col sm:flex-row items-center justify-between gap-2 md:gap-4">
          <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-700 w-full sm:w-auto">
             {(isManagement || user.classTeacherOf) && (
               <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`flex-1 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-[9px] md:text-[12px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class</button>
             )}
             <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`flex-1 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-[9px] md:text-[12px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Faculty</button>
          </div>
          {isManagement && (
            <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto scrollbar-hide">
              <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shrink-0">
                {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(s => (
                  <button key={s} onClick={() => setActiveSection(s)} className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase transition-all ${activeSection === s ? 'bg-sky-600 text-white' : 'text-slate-400'}`}>{s.replace('_', ' ')}</button>
                ))}
              </div>
              <select className="bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-xl border-none text-[9px] md:text-[12px] font-black uppercase outline-none dark:text-white min-w-[150px] md:min-w-[200px]" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                <option value="">{viewMode === 'CLASS' ? 'Choose Class...' : 'Choose Staff...'}</option>
                {viewMode === 'CLASS' ? config.classes.filter(c => c.section === activeSection).map(c => <option key={c.id} value={c.name}>{c.name}</option>) : users.filter(u => u.role.startsWith('TEACHER_')).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {selectedClass ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full relative">
          <div className="md:hidden no-print px-2 mb-2 shrink-0">
             <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto scrollbar-hide">
                {DAYS.map((day, idx) => (
                  <button key={day} onClick={() => setMobileDayIndex(idx)} className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap ${mobileDayIndex === idx ? 'bg-sky-600 text-white' : 'text-slate-400'}`}>
                    {day.substring(0,3)}
                  </button>
                ))}
             </div>
          </div>

          <div className="printable-area flex-1 flex flex-col bg-white dark:bg-slate-900 rounded-xl md:rounded-[2.5rem] shadow-lg border border-gray-100 dark:border-slate-800 mx-2 mb-2 print:m-0 overflow-hidden print:overflow-visible h-full">
            <div className="p-3 md:p-8 border-b border-slate-50 dark:border-slate-800/50 bg-slate-50/20 dark:bg-slate-800/20 print:bg-white shrink-0">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h1 className="text-[7px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">IHIS GRID SYSTEM</h1>
                  <h2 className="text-sm md:text-2xl font-black text-[#001f3f] dark:text-white uppercase truncate">
                    {viewMode === 'CLASS' ? selectedClass : users.find(u => u.id === selectedClass)?.name}
                  </h2>
                  {viewMode === 'CLASS' && (
                    <p className="text-[8px] md:text-xs font-bold text-amber-600 dark:text-amber-500 uppercase tracking-widest leading-none mt-1">
                      Teacher: {classTeacherName(selectedClass)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden md:block flex-1 overflow-auto scrollbar-hide print:block">
              <div className="min-w-full">
                <table className="w-full border-collapse print:border-2 print:border-black">
                  <thead>
                    <tr className="bg-[#00122b] h-12 md:h-14 print:bg-white">
                      <th className="w-12 md:w-16"></th>
                      {slots.map((slot) => (
                        <th key={slot.id} className="text-white print:text-black uppercase text-[8px] md:text-[12px] font-black px-0.5 border border-white/5 leading-tight">
                          {slot.label.replace('Period ', 'P')}<br/><span className="text-[7px] md:text-[9px] opacity-40">{slot.startTime}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day, dayIndex) => (
                      <tr key={day} className="h-16 md:h-20 border-b border-slate-50 dark:border-slate-800/10">
                        <td className="bg-[#00122b] text-white print:text-black font-black uppercase text-center p-2 text-[10px] md:text-xs">
                          {day.substring(0,3)}
                        </td>
                        {slots.map((slot) => (
                          <td key={slot.id} className={`border border-slate-100 dark:border-slate-800/20 ${slot.isBreak ? 'bg-amber-50/10' : 'p-0.5 md:p-1'} ${dragOverCell?.day === day && dragOverCell?.slotId === slot.id ? 'bg-amber-100/50' : ''}`} onDragOver={(e) => handleDragOver(e, day, slot.id)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, day, slot.id)}>
                            {slot.isBreak ? <div className="text-center text-amber-500 font-black uppercase text-[8px] md:text-[10px]">BREAK</div> : renderGridCell(day, slot, dayIndex, selectedClass, viewMode)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden flex-1 no-print bg-slate-50/30 dark:bg-slate-900/50 p-1 flex flex-col h-full overflow-hidden">
               {slots.map((slot) => (
                 <div key={slot.id} className="flex-1 flex gap-1 min-h-0 border-b border-slate-100/10 last:border-0 py-0.5">
                    <div className="w-10 flex flex-col items-center justify-center shrink-0">
                       <span className="text-[7px] font-black text-[#001f3f] dark:text-slate-500 leading-none">{slot.startTime}</span>
                       <span className="text-[6px] font-bold text-slate-400 mt-0.5">{slot.label.split(' ')[1]}</span>
                    </div>
                    <div className="flex-1 flex items-stretch">
                       {slot.isBreak ? (
                         <div className="w-full bg-amber-50/30 dark:bg-amber-900/10 border border-amber-100/30 rounded-md flex items-center justify-center">
                            <span className="text-[7px] font-black text-amber-500 uppercase tracking-widest italic">RECESS</span>
                         </div>
                       ) : (
                         <div className="w-full h-full" onDragOver={(e) => handleDragOver(e, DAYS[mobileDayIndex], slot.id)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, DAYS[mobileDayIndex], slot.id)}>
                             {renderGridCell(DAYS[mobileDayIndex], slot, mobileDayIndex, selectedClass, viewMode)}
                         </div>
                       )}
                    </div>
                 </div>
               ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center opacity-30 py-32"><p className="text-sm font-black text-[#001f3f] dark:text-slate-500 uppercase tracking-widest">Select Profile</p></div>
      )}

      {/* Hidden Bulk Printable Container - Enhanced Robust Rendering */}
      {isGeneratingBulk && (
        <div id="bulk-printable-container" className="fixed top-0 left-[-9999px] bg-white text-black p-5 opacity-0 pointer-events-none" style={{ width: '297mm', zIndex: -100 }}>
           {bulkEntities.map((entity) => {
             const entityId = bulkType === 'CLASS' ? entity.name : entity.id;
             const entityName = entity.name;
             const entitySection = bulkType === 'CLASS' ? entity.section : activeSection;
             const entitySlots = getSlotsForEntity(entity);
             
             return (
               <div key={entityId} className="page-break mb-10 border-2 border-black p-6 bg-white" style={{ minHeight: '190mm', position: 'relative' }}>
                  <div className="flex justify-between items-center mb-6 border-b-4 border-black pb-4">
                     <div className="space-y-1">
                        <h2 className="text-2xl font-black uppercase tracking-tighter">{SCHOOL_NAME}</h2>
                        <div className="flex items-center space-x-3">
                           <h3 className="text-xl font-bold bg-black text-white px-3 py-1 uppercase">{bulkType} GRID: {entityName}</h3>
                        </div>
                        <div className="flex flex-col mt-2">
                           {bulkType === 'CLASS' && (
                             <p className="text-md font-black uppercase">Class Incharge: <span className="underline">{classTeacherName(entityId)}</span></p>
                           )}
                           <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Department: {entitySection.replace(/_/g, ' ')}</p>
                        </div>
                     </div>
                     <div className="text-right flex flex-col items-end">
                        <div className="w-16 h-12 bg-black text-white flex items-center justify-center font-black text-xl mb-2">IHIS</div>
                        <p className="text-xs font-black uppercase tracking-widest">AY 2026-27</p>
                        <p className="text-[8px] font-bold text-gray-400">Printed: {new Date().toLocaleDateString()}</p>
                     </div>
                  </div>

                  <table className="w-full border-collapse border-2 border-black text-[10px]">
                    <thead>
                       <tr className="bg-gray-100">
                          <th className="border border-black p-2 w-16 font-black uppercase text-center bg-gray-200">DAY</th>
                          {entitySlots.map(s => (
                            <th key={s.id} className="border border-black p-1 text-center font-black uppercase text-[9px]">
                               {s.label}<br/>
                               <span className="font-normal text-[8px] text-gray-500">{s.startTime} - {s.endTime}</span>
                            </th>
                          ))}
                       </tr>
                    </thead>
                    <tbody>
                       {DAYS.map((day) => (
                         <tr key={day} className="h-14">
                            <td className="border border-black p-2 text-center font-black bg-gray-50 uppercase text-[9px]">{day.substring(0,3)}</td>
                            {entitySlots.map(slot => (
                              <td key={slot.id} className={`border border-black p-1 text-center ${slot.isBreak ? 'bg-gray-50' : ''}`}>
                                 {slot.isBreak ? (
                                   <span className="font-black text-gray-300 tracking-[0.2em] uppercase text-[8px]">RECESS</span>
                                 ) : (
                                   (() => {
                                      const base = timetable.find(t => t.day === day && t.slotId === slot.id && (bulkType === 'TEACHER' ? t.teacherId === entityId : t.className === entityId));
                                      if (!base) return null;
                                      return (
                                        <div className="flex flex-col items-center justify-center leading-none">
                                           <span className="font-black uppercase text-[10px] text-black mb-0.5">{base.subject}</span>
                                           <span className="text-[8px] font-bold text-gray-600 italic">
                                              {bulkType === 'TEACHER' ? base.className : base.teacherName.split(' ')[0]}
                                           </span>
                                        </div>
                                      );
                                   })()
                                 )}
                              </td>
                            ))}
                         </tr>
                       ))}
                    </tbody>
                  </table>
                  
                  <div className="mt-8 flex justify-between items-end">
                     <div className="space-y-4">
                        <div className="w-40 border-b border-black pt-10"></div>
                        <p className="text-[9px] font-black uppercase">Authorized Supervisor</p>
                     </div>
                     <div className="space-y-4 text-right">
                        <div className="w-40 border-b border-black pt-10 ml-auto"></div>
                        <p className="text-[9px] font-black uppercase">Institutional Seal</p>
                     </div>
                  </div>
               </div>
             );
           })}
        </div>
      )}

      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md no-print animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-[400px] rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-amber-200/20 space-y-6">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Grid Override</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase mt-2">{editContext.day} • {editContext.slot.label}</p>
             </div>
             <div className="space-y-4">
                {viewMode === 'CLASS' ? (
                  <select className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border rounded-2xl font-bold text-sm dark:text-white" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                    <option value="">Faculty...</option>
                    {users.filter(u => u.role.startsWith('TEACHER_')).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  <select className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border rounded-2xl font-bold text-sm dark:text-white" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                    <option value="">Room...</option>
                    {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                )}
                <select className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border rounded-2xl font-bold text-sm dark:text-white" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                  <option value="">Subject...</option>
                  {availableSubjectsForModal.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
             </div>
             <button onClick={saveManualEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">Confirm Change</button>
             <button onClick={() => setShowEditModal(false)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest text-center">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;
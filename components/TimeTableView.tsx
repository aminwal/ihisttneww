
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

  const activeSubs = useMemo(() => substitutions.filter(s => !s.isArchived), [substitutions]);

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

  const isCompact = slots.length >= 9;

  // Fix: Implemented missing openEntryModal for adding/editing periods
  const openEntryModal = (day: string, slot: TimeSlot, entry?: TimeTableEntry) => {
    setEditContext({ day, slot });
    if (entry) {
      setManualData({
        teacherId: entry.teacherId,
        subject: entry.subject,
        className: entry.className
      });
    } else {
      setManualData({
        teacherId: viewMode === 'TEACHER' ? selectedClass : '',
        subject: '',
        className: viewMode === 'CLASS' ? selectedClass : ''
      });
    }
    setShowEditModal(true);
  };

  // Fix: Implemented missing handleDragStart for Design Mode functionality
  const handleDragStart = (e: React.DragEvent, entryId: string) => {
    e.dataTransfer.setData('text/plain', entryId);
  };

  const handleSaveEntry = () => {
    if (!editContext || !manualData.subject || !manualData.teacherId || !manualData.className) return;
    
    const teacher = users.find(u => u.id === manualData.teacherId);
    const classObj = config.classes.find(c => c.name === manualData.className);
    const subject = config.subjects.find(s => s.name === manualData.subject);
    
    if (!teacher || !classObj || !subject) return;

    const newEntry: TimeTableEntry = {
      id: `${manualData.className}-${editContext.day}-${editContext.slot.id}-${Date.now()}`,
      section: classObj.section,
      className: manualData.className,
      day: editContext.day,
      slotId: editContext.slot.id,
      subject: manualData.subject,
      subjectCategory: subject.category,
      teacherId: teacher.id,
      teacherName: teacher.name
    };

    setTimetable(prev => {
      // Remove any existing entry for this slot in the current view context
      const filtered = prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === manualData.className : t.teacherId === manualData.teacherId)));
      return [...filtered, newEntry];
    });
    
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Timetable entry synchronized.' });
  };

  const handleDeleteEntry = () => {
    if (!editContext) return;
    setTimetable(prev => prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === selectedClass : t.teacherId === selectedClass))));
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Entry purged from registry.' });
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER') => {
    if (slot.isBreak) return null;
    const dateStr = weekDates[index];
    const isTeacherView = currentViewMode === 'TEACHER';

    const subEntry = activeSubs.find(s => 
      s.date === dateStr && 
      s.slotId === slot.id && 
      (isTeacherView ? s.substituteTeacherId === targetId : s.className === targetId)
    );

    const baseEntry = timetable.find(t => t.day === day && t.slotId === slot.id && (isTeacherView ? t.teacherId === targetId : t.className === targetId));
    const iAmAbsentHere = isTeacherView && activeSubs.find(s => s.date === dateStr && s.slotId === slot.id && s.absentTeacherId === targetId);

    if (subEntry) {
      return (
        <div className={`h-full flex items-center justify-center bg-red-50 dark:bg-red-950/20 border-2 border-red-500 rounded-lg text-center animate-pulse w-full p-1`}>
          <div className="overflow-hidden">
            <p className={`${isCompact ? 'text-[7px] md:text-[9px]' : 'text-[8px] md:text-[11px]'} font-black uppercase text-red-600 tracking-tight leading-none truncate`}>{subEntry.subject}</p>
            <p className={`${isCompact ? 'text-[5px] md:text-[7px]' : 'text-[6px] md:text-[9px]'} font-bold text-red-700 leading-none truncate mt-0.5`}>{isTeacherView ? subEntry.className : `Sub: ${subEntry.substituteTeacherName.split(' ')[0]}`}</p>
          </div>
        </div>
      );
    }

    if (iAmAbsentHere) {
      return <div className="h-full border border-red-100 rounded-lg flex items-center justify-center opacity-40 bg-red-50/10 w-full"><span className="text-red-500 text-[8px] font-black uppercase tracking-widest italic leading-none">ABS</span></div>;
    }

    if (!baseEntry) return <div onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800/10 rounded-sm flex items-center justify-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''}`}>{isDesigning && <span className="text-slate-200 text-lg">+</span>}</div>;

    return (
      <div draggable={isDesigning} onDragStart={(e) => handleDragStart(e, baseEntry.id)} onClick={() => isDesigning && openEntryModal(day, slot, baseEntry)} className={`h-full p-1 bg-white dark:bg-slate-900 border border-slate-100 rounded-sm flex flex-col justify-center text-center group relative transition-all w-full ${isDesigning ? 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-amber-400/50' : ''}`}>
        <div className="overflow-hidden">
          <p className={`${isCompact ? 'text-[7px] md:text-[9px]' : 'text-[8px] md:text-[11px]'} font-black uppercase tracking-tight leading-none truncate ${baseEntry.subjectCategory === SubjectCategory.CORE ? 'text-sky-600' : 'text-emerald-600'}`}>{baseEntry.subject}</p>
          <p className={`${isCompact ? 'text-[5px] md:text-[7px]' : 'text-[6px] md:text-[9px]'} font-bold text-[#001f3f] dark:text-white leading-none mt-0.5 truncate`}>{isTeacherView ? baseEntry.className : baseEntry.teacherName.split(' ')[0]}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-in fade-in duration-700 overflow-hidden w-full px-2">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 no-print">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <h1 className="text-xl font-black text-[#001f3f] italic">
            {viewMode === 'CLASS' ? `Class: ${selectedClass || 'Select'}` : `Staff: ${users.find(u => u.id === selectedClass)?.name || 'Select'}`}
          </h1>
          {isManagement && (
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800">
              <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Class View</button>
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Teacher View</button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
           {isManagement && <button onClick={() => setIsDesigning(!isDesigning)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border'}`}>{isDesigning ? 'Done' : 'Edit'}</button>}
           <button onClick={() => window.print()} className="bg-[#001f3f] text-amber-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase border border-amber-400 shadow">Print</button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-lg border border-gray-100 dark:border-slate-800 overflow-hidden flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/20 no-print flex gap-4">
           <select className="bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border dark:border-slate-700 text-[12px] font-black w-full md:w-64" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
              <option value="">Select Target...</option>
              {viewMode === 'CLASS' ? config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : users.filter(u => u.role.startsWith('TEACHER_')).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
           </select>
           {status && (
             <div className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${status.type === 'error' ? 'text-red-500 bg-red-50' : 'text-emerald-500 bg-emerald-50'}`}>
               {status.message}
             </div>
           )}
        </div>
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full h-full border-collapse table-fixed min-w-[800px]">
            <thead className="bg-[#00122b] sticky top-0 z-10">
              <tr className="h-10">
                <th className="w-20 border border-white/5"></th>
                {slots.map(s => <th key={s.id} className="text-white text-[9px] font-black uppercase border border-white/5">{s.label.replace('Period ', 'P')}<br/><span className="text-[7px] opacity-40">{s.startTime}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, idx) => (
                <tr key={day} className="h-20 border-b border-slate-100 dark:border-slate-800">
                  <td className="bg-[#00122b] text-white font-black text-center text-xs border border-white/5">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td key={s.id} className={`border border-slate-100 dark:border-slate-800 p-0.5 ${s.isBreak ? 'bg-amber-50/10' : ''}`}>
                      {s.isBreak ? <div className="text-center text-amber-500 font-black text-[10px]">BREAK</div> : renderGridCell(day, s, idx, selectedClass, viewMode)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showEditModal && editContext && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl space-y-6">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Period Config</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{editContext.day} - {editContext.slot.label}</p>
             </div>
             <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Class/Room</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3 rounded-xl font-bold text-sm dark:text-white" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                    <option value="">Select Class...</option>
                    {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Teacher</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3 rounded-xl font-bold text-sm dark:text-white" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                    <option value="">Select Teacher...</option>
                    {users.filter(u => u.role.startsWith('TEACHER_')).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">Subject</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3 rounded-xl font-bold text-sm dark:text-white" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                    <option value="">Select Subject...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
             </div>
             <div className="flex flex-col gap-3">
                <button onClick={handleSaveEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-xl">Save Changes</button>
                <button onClick={handleDeleteEntry} className="w-full text-red-500 font-black text-[10px] uppercase py-2">Delete Entry</button>
                <button onClick={() => setShowEditModal(false)} className="w-full text-slate-400 font-black text-[10px] uppercase">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

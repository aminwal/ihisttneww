
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, ROMAN_TO_ARABIC } from '../constants.ts';

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
  const [viewMode, setViewMode] = useState<'CLASS' | 'TEACHER'>(isManagement ? 'CLASS' : 'TEACHER');
  const [isDesigning, setIsDesigning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Default to today's date so current week substitutions reflect immediately
  const [viewDate, setViewDate] = useState<string>(() => new Date().toISOString().split('T')[0]); 
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContext, setEditContext] = useState<{day: string, slot: TimeSlot} | null>(null);
  const [manualData, setManualData] = useState({ teacherId: '', subject: '', className: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const isLimitedSubject = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('art') || n.includes('phe') || n.includes('library') || n.includes('physical education') || n.trim().toUpperCase() === 'CEP';
  };

  const getGradeFromClassName = (name: string) => {
    const romanMatch = name.match(/[IVX]+/);
    if (romanMatch) return `Grade ${romanMatch[0]}`;
    const digitMatch = name.match(/\d+/);
    if (digitMatch) return `Grade ${digitMatch[0]}`;
    return name;
  };

  const slots = useMemo(() => {
    let targetSection = activeSection;
    if (selectedClass && viewMode === 'CLASS') {
      const classObj = config.classes.find(c => c.name === selectedClass);
      if (classObj) targetSection = classObj.section;
    }
    if (targetSection === 'PRIMARY') return PRIMARY_SLOTS;
    if (targetSection === 'SECONDARY_GIRLS' || targetSection === 'SENIOR_SECONDARY_GIRLS') return SECONDARY_GIRLS_SLOTS;
    return SECONDARY_BOYS_SLOTS;
  }, [activeSection, selectedClass, config.classes, viewMode]);

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

  const handleSaveEntry = () => {
    if (!editContext || !manualData.subject || !manualData.teacherId || !manualData.className) return;
    
    const teacher = users.find(u => u.id === manualData.teacherId);
    const classObj = config.classes.find(c => c.name === manualData.className);
    const subject = config.subjects.find(s => s.name === manualData.subject);
    
    if (!teacher || !classObj || !subject) return;

    if (isLimitedSubject(manualData.subject)) {
      const weeklyCount = timetable.filter(t => 
        t.className === manualData.className && 
        t.subject === manualData.subject &&
        !(t.day === editContext.day && t.slotId === editContext.slot.id)
      ).length;

      if (weeklyCount >= 1) {
        if (!window.confirm(`INSTITUTIONAL ALERT: ${manualData.className} already has ${weeklyCount} assigned period(s) of ${manualData.subject} this week. Policy limit is 1. Force manual override?`)) return;
      }
    }

    const newEntry: TimeTableEntry = {
      id: `${manualData.className}-${editContext.day}-${editContext.slot.id}-${Date.now()}`,
      section: classObj.section,
      className: manualData.className,
      day: editContext.day,
      slotId: editContext.slot.id,
      subject: manualData.subject,
      subjectCategory: subject.category,
      teacherId: teacher.id,
      teacherName: teacher.name,
      date: viewDate || undefined,
      isSubstitution: !!viewDate
    };

    setTimetable(prev => {
      const filtered = prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === manualData.className : t.teacherId === manualData.teacherId) && t.date === (viewDate || undefined)));
      return [...filtered, newEntry];
    });
    
    setShowEditModal(false);
    setStatus({ type: 'success', message: 'Institutional Registry Updated.' });
  };

  const handleAutoGenerateClass = async () => {
    if (viewMode !== 'CLASS' || !selectedClass) {
      setStatus({ type: 'error', message: 'Please select a specific class division first.' });
      return;
    }

    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 800));

    const classObj = config.classes.find(c => c.name === selectedClass);
    if (!classObj) { setIsProcessing(false); return; }

    const grade = getGradeFromClassName(selectedClass);
    const gradeAssignments = assignments.filter(a => a.grade === grade);
    
    if (gradeAssignments.length === 0) {
      setStatus({ type: 'warning', message: `Deployment Failed: No faculty workload found for ${grade}. Configure Faculty Load first.` });
      setIsProcessing(false);
      return;
    }

    const newTimetable = [...timetable];
    let addedCount = 0;
    const periodsToPlace: { subject: string, teacherId: string, teacherName: string, category: SubjectCategory }[] = [];

    gradeAssignments.forEach(a => {
      const teacher = users.find(u => u.id === a.teacherId);
      if (!teacher) return;
      a.loads.forEach(l => {
        const sub = config.subjects.find(s => s.name === l.subject);
        if (!sub) return;
        
        const isLimited = isLimitedSubject(l.subject);
        const count = isLimited ? 1 : l.periods;
        
        for(let i=0; i<count; i++) {
          periodsToPlace.push({ subject: l.subject, teacherId: teacher.id, teacherName: teacher.name, category: sub.category });
        }
      });
    });

    periodsToPlace.sort(() => Math.random() - 0.5);

    const emptySlots: { day: string, slotId: number }[] = [];
    DAYS.forEach(day => {
      slots.filter(s => !s.isBreak).forEach(s => {
        const exists = newTimetable.some(t => t.className === selectedClass && t.day === day && t.slotId === s.id && !t.date);
        if (!exists) emptySlots.push({ day, slotId: s.id });
      });
    });

    if (emptySlots.length === 0) {
      setStatus({ type: 'warning', message: `Deployment Halted: ${selectedClass} timetable is already full.` });
      setIsProcessing(false);
      return;
    }

    for (const period of periodsToPlace) {
      const validSlotIndex = emptySlots.findIndex(slot => {
        const teacherBusy = newTimetable.some(t => t.teacherId === period.teacherId && t.day === slot.day && t.slotId === slot.slotId && !t.date);
        if (teacherBusy) return false;
        
        const sameSubToday = newTimetable.some(t => t.className === selectedClass && t.day === slot.day && t.subject === period.subject && !t.date);
        if (sameSubToday && !isLimitedSubject(period.subject)) return false;

        return true;
      });

      if (validSlotIndex !== -1) {
        const targetSlot = emptySlots.splice(validSlotIndex, 1)[0];
        newTimetable.push({
          id: `auto-${selectedClass}-${targetSlot.day}-${targetSlot.slotId}-${Date.now()}`,
          section: classObj.section,
          className: selectedClass,
          day: targetSlot.day,
          slotId: targetSlot.slotId,
          subject: period.subject,
          subjectCategory: period.category,
          teacherId: period.teacherId,
          teacherName: period.teacherName
        });
        addedCount++;
      }
    }

    setTimetable(newTimetable);
    if (addedCount === 0) {
      setStatus({ type: 'error', message: 'Deployment Conflict: Faculty schedules or subject variety rules prevented allocation.' });
    } else {
      setStatus({ type: 'success', message: `Deployment Complete: Successfully allocated ${addedCount} periods for ${selectedClass}.` });
    }
    setIsProcessing(false);
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER') => {
    if (slot.isBreak) return null;
    const isTeacherView = currentViewMode === 'TEACHER';
    
    // Find potential entries: Priority 1: Date specific substitution, Priority 2: Base schedule
    const allMatching = timetable.filter(t => t.day === day && t.slotId === slot.id && (isTeacherView ? t.teacherId === targetId : t.className === targetId));
    
    let baseEntry = allMatching.find(t => t.date === viewDate && viewDate !== '');
    if (!baseEntry) {
      baseEntry = allMatching.find(t => !t.date);
    }

    if (!baseEntry) return <div onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800 rounded-sm flex items-center justify-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''}`}>{isDesigning && <span className="text-slate-300 text-lg">+</span>}</div>;

    const isSub = !!baseEntry.isSubstitution;

    return (
      <div onClick={() => isDesigning && openEntryModal(day, slot, baseEntry)} className={`h-full p-1 border-2 rounded-sm flex flex-col justify-center text-center transition-all w-full relative group ${isSub ? 'bg-amber-50 dark:bg-amber-900/20 border-dashed border-amber-400' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'} ${isDesigning ? 'cursor-pointer hover:ring-2 hover:ring-amber-400' : ''}`}>
        {isSub && <div className="absolute top-0 right-0 bg-amber-400 text-[#001f3f] text-[6px] px-1 font-black rounded-bl shadow-sm">SUB</div>}
        <p className={`text-[9px] font-black uppercase truncate ${isSub ? 'text-amber-600' : 'text-sky-600'}`}>{baseEntry.subject}</p>
        <p className={`text-[8px] font-bold text-[#001f3f] dark:text-white truncate mt-0.5`}>{isTeacherView ? baseEntry.className : baseEntry.teacherName.split(' ')[0]}</p>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-in fade-in duration-700 overflow-hidden w-full px-2">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 no-print">
        <h1 className="text-xl md:text-2xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Institutional Timetable</h1>
        <div className="flex items-center gap-2">
           {isManagement && (
             <>
               <button 
                 onClick={handleAutoGenerateClass} 
                 disabled={isProcessing || !selectedClass || viewMode !== 'CLASS'}
                 className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
               >
                 {isProcessing ? 'Deploying...' : 'Auto-Fill Class'}
               </button>
               <button onClick={() => setIsDesigning(!isDesigning)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Exit Designer' : 'Edit Matrix'}</button>
             </>
           )}
           <button onClick={() => window.print()} className="bg-[#001f3f] text-amber-400 px-4 py-2 rounded-xl text-[9px] font-black uppercase border border-amber-400 shadow-xl transition-all hover:scale-105">Print View</button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/20 no-print flex flex-col xl:flex-row items-center gap-4">
           <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800 shadow-sm shrink-0">
              <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class View</button>
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff View</button>
           </div>
           
           <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Schedule Context:</span>
             <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="bg-transparent text-[10px] font-black outline-none dark:text-white" />
             {viewDate && (
               <button onClick={() => setViewDate('')} className="text-[8px] font-black text-rose-500 uppercase hover:underline">Reset to Base</button>
             )}
             {!viewDate && (
               <span className="text-[8px] font-black text-emerald-500 uppercase">Base Matrix Active</span>
             )}
           </div>

           <select className="bg-white dark:bg-slate-900 px-5 py-2.5 rounded-xl border-2 border-slate-100 dark:border-slate-800 text-[11px] font-black uppercase flex-1 min-w-[200px] outline-none focus:border-amber-400 transition-all dark:text-white" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
             <option value="">Select Targeted Entity...</option>
             {viewMode === 'CLASS' ? config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : users.filter(u => u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
           </select>

           {status && (
             <div className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all animate-in slide-in-from-left duration-300 ${status.type === 'error' ? 'text-red-500 bg-red-50 border border-red-100' : status.type === 'warning' ? 'text-amber-600 bg-amber-50 border border-amber-100' : 'text-emerald-600 bg-emerald-50 border border-emerald-100'}`}>
               {status.message}
             </div>
           )}
        </div>
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full h-full border-collapse table-fixed min-w-[900px]">
            <thead className="bg-[#00122b] sticky top-0 z-10">
              <tr className="h-12">
                <th className="w-20 border border-white/5 text-[9px] font-black text-amber-500 uppercase tracking-widest italic">Day</th>
                {slots.map(s => <th key={s.id} className="text-white text-[9px] font-black uppercase border border-white/5 bg-[#001f3f]/50">
                  {s.label.replace('Period ', 'P')}
                  <div className="text-[7px] opacity-40 font-bold tracking-tight mt-0.5">{s.startTime} - {s.endTime}</div>
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/20">
              {DAYS.map((day, idx) => (
                <tr key={day} className="h-20 hover:bg-slate-50/30 transition-colors">
                  <td className="bg-[#00122b] text-white font-black text-center text-[10px] uppercase border border-white/5 tracking-tighter italic">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td key={s.id} className={`border border-slate-100 dark:border-slate-800/10 p-0.5 relative ${s.isBreak ? 'bg-amber-50/10' : ''}`}>
                      {s.isBreak ? (
                        <div className="flex items-center justify-center h-full">
                           <span className="text-amber-500/30 font-black text-[9px] tracking-[0.4em] uppercase rotate-90 md:rotate-0">RECESS</span>
                        </div>
                      ) : renderGridCell(day, s, idx, selectedClass, viewMode)}
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
          <div className="bg-white dark:bg-slate-900 w-full max-md:rounded-[2rem] max-w-md rounded-[2.5rem] p-10 shadow-2xl space-y-6 border border-white/10">
             <div className="text-center">
                <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tight">Period Controller</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-1 tracking-widest">{editContext.day} — {editContext.slot.label}</p>
                {viewDate && <p className="text-[8px] font-black text-amber-500 uppercase mt-1">Substitution for {viewDate}</p>}
             </div>
             <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Division (Authorized Personnel)</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3.5 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400 transition-all" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                    <option value="">Select Personnel...</option>
                    {users.filter(u => {
                       if (u.role === UserRole.ADMIN) return false;
                       const allRoles = [u.role, ...(u.secondaryRoles || [])];
                       const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === 'INCHARGE_ALL');
                       const isSecondary = allRoles.some(r => r.includes('SECONDARY') || r === 'INCHARGE_ALL');
                       const targetCls = config.classes.find(c => c.name === manualData.className);
                       if (!targetCls) return true;
                       return targetCls.section === 'PRIMARY' ? isPrimary : (targetCls.section.includes('SECONDARY') ? isSecondary : true);
                    }).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class/Section Division</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3.5 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400 transition-all" value={manualData.className} onChange={e => setManualData({...manualData, className: e.target.value})}>
                    <option value="">Select Division...</option>
                    {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Unit</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3.5 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400 transition-all" value={manualData.subject} onChange={e => setManualData({...manualData, subject: e.target.value})}>
                    <option value="">Select Unit...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
             </div>
             <div className="flex flex-col gap-3 pt-4">
                <button onClick={handleSaveEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-4.5 rounded-2xl font-black text-xs uppercase shadow-2xl transition-all hover:bg-slate-900 active:scale-95">Authorize Entry</button>
                <button 
                  onClick={() => {
                    setTimetable(prev => prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === manualData.className : t.teacherId === manualData.teacherId) && t.date === (viewDate || undefined))));
                    setShowEditModal(false);
                  }} 
                  className="w-full text-red-500 font-black text-[10px] uppercase py-2 hover:bg-red-50 rounded-xl transition-all"
                >
                  Decommission Period
                </button>
                <button onClick={() => setShowEditModal(false)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest">Abort Process</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

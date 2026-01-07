
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, UserRole, TimeTableEntry, SectionType, TimeSlot, SubstitutionRecord, SchoolConfig, TeacherAssignment, SubjectCategory } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';

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

    // BUSINESS RULE: 1 class can have only 1 period of PHE, CEP, ART and Library per week (Manual Warning)
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
      teacherName: teacher.name
    };

    setTimetable(prev => {
      const filtered = prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === manualData.className : t.teacherId === manualData.teacherId)));
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

    const gradeMatch = selectedClass.match(/[IVX]+/);
    const grade = gradeMatch ? `Grade ${gradeMatch[0]}` : selectedClass;
    
    const gradeAssignments = assignments.filter(a => a.grade === grade);
    if (gradeAssignments.length === 0) {
      setStatus({ type: 'warning', message: `No faculty workload data found for ${grade}.` });
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
        
        // RULE: Automatic allocation strictly assigns maximum 1 period per week for specialized subjects
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
        const exists = newTimetable.some(t => t.className === selectedClass && t.day === day && t.slotId === s.id);
        if (!exists) emptySlots.push({ day, slotId: s.id });
      });
    });

    for (const period of periodsToPlace) {
      const validSlotIndex = emptySlots.findIndex(slot => {
        const teacherBusy = newTimetable.some(t => t.teacherId === period.teacherId && t.day === slot.day && t.slotId === slot.slotId);
        if (teacherBusy) return false;
        
        // Avoid same subject on same day for core subjects to ensure variety
        const sameSubToday = newTimetable.some(t => t.className === selectedClass && t.day === slot.day && t.subject === period.subject);
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
    setStatus({ type: 'success', message: `Deployment Complete: Distributed ${addedCount} periods for ${selectedClass}.` });
    setIsProcessing(false);
  };

  const renderGridCell = (day: string, slot: TimeSlot, index: number, targetId: string, currentViewMode: 'CLASS' | 'TEACHER') => {
    if (slot.isBreak) return null;
    const isTeacherView = currentViewMode === 'TEACHER';
    const baseEntry = timetable.find(t => t.day === day && t.slotId === slot.id && (isTeacherView ? t.teacherId === targetId : t.className === targetId));

    if (!baseEntry) return <div onClick={() => isDesigning && openEntryModal(day, slot)} className={`h-full border border-slate-100 dark:border-slate-800 rounded-sm flex items-center justify-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:bg-slate-50' : ''}`}>{isDesigning && <span className="text-slate-300 text-lg">+</span>}</div>;

    return (
      <div onClick={() => isDesigning && openEntryModal(day, slot, baseEntry)} className={`h-full p-1 bg-white dark:bg-slate-900 border border-slate-100 rounded-sm flex flex-col justify-center text-center transition-all w-full ${isDesigning ? 'cursor-pointer hover:ring-2 hover:ring-amber-400' : ''}`}>
        <p className={`text-[9px] font-black uppercase text-sky-600 truncate`}>{baseEntry.subject}</p>
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
                 className="bg-sky-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg disabled:opacity-50"
               >
                 {isProcessing ? 'Deploying...' : 'Auto-Fill Class'}
               </button>
               <button onClick={() => setIsDesigning(!isDesigning)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-md ${isDesigning ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200'}`}>{isDesigning ? 'Exit Designer' : 'Edit Matrix'}</button>
             </>
           )}
           <button onClick={() => window.print()} className="bg-[#001f3f] text-amber-400 px-4 py-2 rounded-xl text-[9px] font-black uppercase border border-amber-400 shadow-xl">Print View</button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/20 no-print flex flex-col md:flex-row items-center gap-4">
           <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border dark:border-slate-800 shadow-sm">
              <button onClick={() => { setViewMode('CLASS'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'CLASS' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Class View</button>
              <button onClick={() => { setViewMode('TEACHER'); setSelectedClass(''); }} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'TEACHER' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Staff View</button>
           </div>
           <select className="bg-white dark:bg-slate-900 px-5 py-2.5 rounded-xl border-2 border-slate-100 text-[11px] font-black uppercase w-full md:w-64" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
             <option value="">Select Target...</option>
             {viewMode === 'CLASS' ? config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>) : users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
           </select>
           {status && (
             <div className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all animate-in slide-in-from-left duration-300 ${status.type === 'error' ? 'text-red-500 bg-red-50' : status.type === 'warning' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'}`}>
               {status.message}
             </div>
           )}
        </div>
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full h-full border-collapse table-fixed min-w-[900px]">
            <thead className="bg-[#00122b] sticky top-0 z-10">
              <tr className="h-12">
                <th className="w-20 border border-white/5 text-[9px] font-black text-amber-500 uppercase italic">Day</th>
                {slots.map(s => <th key={s.id} className="text-white text-[9px] font-black uppercase border border-white/5 bg-[#001f3f]/50">
                  {s.label.replace('Period ', 'P')}
                  <div className="text-[7px] opacity-40 font-bold">{s.startTime} - {s.endTime}</div>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, idx) => (
                <tr key={day} className="h-20">
                  <td className="bg-[#00122b] text-white font-black text-center text-[10px] uppercase border border-white/5 italic">{day.substring(0,3)}</td>
                  {slots.map(s => (
                    <td key={s.id} className={`border border-slate-100 p-0.5 relative ${s.isBreak ? 'bg-amber-50/10' : ''}`}>
                      {s.isBreak ? <div className="text-center font-black text-[9px] text-amber-500/30">RECESS</div> : renderGridCell(day, s, idx, selectedClass, viewMode)}
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
             <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic text-center">Period Controller</h4>
             <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Division (Authorized Personnel)</label>
                  <select className="w-full bg-slate-50 dark:bg-slate-800 px-5 py-3.5 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400 transition-all" value={manualData.teacherId} onChange={e => setManualData({...manualData, teacherId: e.target.value})}>
                    <option value="">Select Personnel...</option>
                    {users.filter(u => {
                       const allRoles = [u.role, ...(u.secondaryRoles || [])];
                       const isPrimary = allRoles.some(r => r.includes('PRIMARY') || r === 'INCHARGE_ALL' || r === 'ADMIN');
                       const isSecondary = allRoles.some(r => r.includes('SECONDARY') || r === 'INCHARGE_ALL' || r === 'ADMIN');
                       const targetCls = config.classes.find(c => c.name === manualData.className);
                       if (!targetCls) return true;
                       return targetCls.section === 'PRIMARY' ? isPrimary : isSecondary;
                    }).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class/Section</label>
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
                <button onClick={handleSaveEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-4.5 rounded-2xl font-black text-xs uppercase shadow-2xl transition-all hover:bg-slate-900">Authorize Entry</button>
                {/* Fixed: separated void function calls from truthiness test in onClick */}
                <button 
                  onClick={() => {
                    setTimetable(prev => prev.filter(t => !(t.day === editContext.day && t.slotId === editContext.slot.id && (viewMode === 'CLASS' ? t.className === manualData.className : t.teacherId === manualData.teacherId))));
                    setShowEditModal(false);
                  }} 
                  className="w-full text-red-500 font-black text-[10px] uppercase py-2"
                >
                  Decommission Period
                </button>
                <button onClick={() => setShowEditModal(false)} className="w-full text-slate-400 font-black text-[9px] uppercase tracking-widest">Abort</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTableView;

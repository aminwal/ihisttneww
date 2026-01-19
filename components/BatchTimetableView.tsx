
import React, { useState, useMemo, useCallback } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot, UserRole, TeacherAssignment } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';

// Explicitly declare html2pdf for the TS compiler
declare var html2pdf: any;

interface BatchTimetableViewProps {
  users: User[];
  timetable: TimeTableEntry[];
  config: SchoolConfig;
  currentUser: User; 
  assignments: TeacherAssignment[];
}

const BatchTimetableView: React.FC<BatchTimetableViewProps> = ({ users, timetable, config, currentUser, assignments }) => {
  const [viewType, setViewType] = useState<'CLASS' | 'STAFF' | 'ROOM' | 'DEPARTMENT'>('CLASS');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const isAdmin = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.INCHARGE_ALL;

  // Optimized registry for O(1) cell lookup
  const cellRegistry = useMemo(() => {
    const registry = new Map<string, TimeTableEntry[]>();
    for (const entry of timetable) {
      const key = `${entry.day}-${entry.slotId}`;
      if (!registry.has(key)) {
        registry.set(key, [entry]);
      } else {
        registry.get(key)!.push(entry);
      }
    }
    return registry;
  }, [timetable]);

  const availableEntities = useMemo(() => {
    let list: { id: string; name: string; meta?: string }[] = [];
    
    if (viewType === 'CLASS') {
      let classes = config.classes;
      if (!isAdmin) {
        if (currentUser.role === UserRole.INCHARGE_PRIMARY) classes = classes.filter(c => c.section === 'PRIMARY');
        else if (currentUser.role === UserRole.INCHARGE_SECONDARY) classes = classes.filter(c => c.section !== 'PRIMARY');
      }
      list = classes.map(c => ({ id: c.name, name: c.name, meta: c.section }));
    } else if (viewType === 'STAFF') {
      let staff = users.filter(u => !u.isResigned && u.role.includes('TEACHER'));
      if (!isAdmin) {
        if (currentUser.role === UserRole.INCHARGE_PRIMARY) staff = staff.filter(u => u.role.includes('PRIMARY'));
        else if (currentUser.role === UserRole.INCHARGE_SECONDARY) staff = staff.filter(u => u.role.includes('SECONDARY'));
      }
      list = staff.map(u => ({ id: u.id, name: u.name, meta: u.employeeId }));
    } else if (viewType === 'ROOM') {
      list = (config.rooms || []).map(r => ({ id: r, name: r }));
    } else if (viewType === 'DEPARTMENT') {
      const departments: { id: SectionType; name: string }[] = [
        { id: 'PRIMARY', name: 'Primary Wing' },
        { id: 'SECONDARY_BOYS', name: 'Secondary Boys' },
        { id: 'SECONDARY_GIRLS', name: 'Secondary Girls' },
        { id: 'SENIOR_SECONDARY_BOYS', name: 'Senior Secondary Boys' },
        { id: 'SENIOR_SECONDARY_GIRLS', name: 'Senior Secondary Girls' }
      ];
      list = departments.map(d => ({ id: d.id, name: d.name }));
    }

    if (!searchTerm) return list;
    const lowerSearch = searchTerm.toLowerCase();
    return list.filter(e => 
      e.name.toLowerCase().includes(lowerSearch) || 
      e.id.toLowerCase().includes(lowerSearch)
    );
  }, [viewType, config, users, searchTerm, isAdmin, currentUser]);

  const toggleEntity = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => setSelectedIds(availableEntities.map(e => e.id));
  const clearAll = () => setSelectedIds([]);

  /**
   * Helper to check if a class falls under the I-X rule
   */
  const isGradeItoX = useCallback((className: string) => {
    if (!className) return false;
    const match = className.match(/^(I|II|III|IV|V|VI|VII|VIII|IX|X)\b/i);
    return !!match;
  }, []);

  /**
   * Helper for implicit display duty logic
   */
  const getImplicitEntry = useCallback((day: string, slotId: number, targetId: string, currentViewType: string): any | null => {
    if (slotId !== 1) return null;

    if (currentViewType === 'CLASS') {
      if (!isGradeItoX(targetId)) return null;
      const classTeacher = users.find(u => u.classTeacherOf === targetId);
      if (!classTeacher) return null;
      
      const romanMatch = targetId.match(/[IVX]+/);
      const gradePrefix = romanMatch ? `Grade ${romanMatch[0]}` : targetId;
      const asgn = assignments.find(a => a.teacherId === classTeacher.id && a.grade === gradePrefix);
      const assignedSubject = asgn?.loads?.[0]?.subject || 'CLASS TEACHER P1';

      return { subject: assignedSubject, teacherName: classTeacher.name, className: targetId };
    } else if (currentViewType === 'STAFF') {
      const teacher = users.find(u => u.id === targetId);
      if (!teacher || !teacher.classTeacherOf || !isGradeItoX(teacher.classTeacherOf)) return null;
      
      const romanMatch = teacher.classTeacherOf.match(/[IVX]+/);
      const gradePrefix = romanMatch ? `Grade ${romanMatch[0]}` : teacher.classTeacherOf;
      const asgn = assignments.find(a => a.teacherId === teacher.id && a.grade === gradePrefix);
      const assignedSubject = asgn?.loads?.[0]?.subject || 'CLASS TEACHER P1';

      return { subject: assignedSubject, teacherName: teacher.name, className: teacher.classTeacherOf };
    }
    return null;
  }, [users, assignments, isGradeItoX]);

  const getSlotsForEntity = useCallback((entityId: string, customViewType?: string): TimeSlot[] => {
    const targetType = customViewType || viewType;
    
    if (targetType === 'CLASS' || targetType === 'DEPARTMENT') {
      let section: SectionType = 'PRIMARY';
      if (targetType === 'CLASS') {
        const cls = config.classes.find(c => c.name === entityId);
        section = cls?.section || 'PRIMARY';
      } else {
        section = entityId as SectionType;
      }
      
      if (section === 'PRIMARY') return PRIMARY_SLOTS;
      if (section.includes('GIRLS')) return SECONDARY_GIRLS_SLOTS;
      return SECONDARY_BOYS_SLOTS;
    }

    let baseSlots: TimeSlot[] = SECONDARY_BOYS_SLOTS;
    if (targetType === 'STAFF') {
      const teacher = users.find(u => u.id === entityId);
      if (teacher?.role.includes('PRIMARY') || teacher?.secondaryRoles?.some(r => r.includes('PRIMARY'))) {
        baseSlots = PRIMARY_SLOTS;
      }
    }
    return baseSlots.filter(s => !s.isBreak);
  }, [viewType, config.classes, users]);

  const handleExportPDF = async () => {
    if (selectedIds.length === 0) return;
    setIsExporting(true);
    
    const element = document.getElementById('batch-render-zone');
    if (!element) {
      setIsExporting(false);
      return;
    }

    const opt = {
      margin: 0,
      filename: `IHIS_Batch_Timetables_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        letterRendering: true,
        backgroundColor: '#ffffff',
        logging: false
      },
      jsPDF: { 
        unit: 'mm', 
        format: viewType === 'DEPARTMENT' ? 'a3' : 'a4', 
        orientation: 'landscape', 
        compress: true 
      },
      pagebreak: { mode: 'css' }
    };

    try {
      await new Promise(resolve => setTimeout(resolve, 3000)); 
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("Batch PDF Generation Failure:", err);
      alert("Failed to generate packet. Verify internet and try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const renderDepartmentMasterSheets = (sectionId: SectionType) => {
    const classesInDept = config.classes.filter(c => c.section === sectionId).sort((a, b) => a.name.localeCompare(b.name));
    const slots = getSlotsForEntity(sectionId, 'DEPARTMENT');
    const deptName = availableEntities.find(e => e.id === sectionId)?.name || sectionId;

    return DAYS.map(day => {
      const getCellContent = (className: string, slotId: number) => {
        const key = `${day}-${slotId}`;
        const entries = cellRegistry.get(key) || [];
        let entry = entries.find(t => t.className === className);
        
        // Institutional Rule Check
        if (!entry && slotId === 1 && isGradeItoX(className)) {
           const implicit = getImplicitEntry(day, slotId, className, 'CLASS');
           if (implicit) entry = implicit;
        }

        if (!entry) return null;

        return (
          <div className="flex flex-col items-center justify-center h-full p-0.25">
            <p className="text-[8px] font-black uppercase text-[#001f3f] leading-none print:text-black">{entry.subject}</p>
          </div>
        );
      };

      return (
        <div key={`${sectionId}-${day}`} className="timetable-a4-card bg-white p-4 shadow-xl border border-slate-200 aspect-[1.414/1] w-full max-w-[420mm] mx-auto flex flex-col relative overflow-hidden mb-0">
          <div className="mb-2 border-b-2 border-[#001f3f] pb-2 print:border-black shrink-0">
            <div className="flex items-center justify-center gap-6 mb-1">
              <img src={SCHOOL_LOGO_BASE64} alt="IHIS" className="w-10 h-10 object-contain" />
              <div className="text-center">
                <h2 className="text-lg font-black text-[#001f3f] uppercase italic tracking-tighter print:text-black leading-none">{SCHOOL_NAME}</h2>
                <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.4em] mt-0.5 print:text-black">Master Timetable Matrix • {deptName}</p>
              </div>
            </div>
            <div className="flex justify-between items-end mt-2 px-4">
               <p className="text-xs font-black text-[#001f3f] uppercase print:text-black">DAY: {day.toUpperCase()}</p>
               <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Academic Year 2026-2027</p>
            </div>
          </div>

          <div className="flex-1 overflow-hidden border border-slate-300 print:border-black">
            <table className="w-full h-full border-collapse table-fixed">
              <thead className="bg-[#001f3f] print:bg-slate-100">
                <tr>
                  <th className="w-14 border border-white/10 text-[8px] font-black text-amber-400 uppercase italic print:text-black">Class</th>
                  {slots.map(s => (
                    <th key={s.id} className="border border-white/10 text-white p-0.5 print:border-black print:text-black">
                      <p className="text-[8px] font-black uppercase">{s.label.replace('Period ', 'P')}</p>
                      <p className="text-[6px] opacity-60 font-bold print:opacity-100">{s.startTime}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classesInDept.map((cls, idx) => (
                  <tr key={cls.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} h-6`}>
                    <td className="bg-slate-50 border border-slate-200 text-center font-black text-[8px] uppercase text-[#001f3f] print:text-black">
                      {cls.name}
                    </td>
                    {slots.map(s => (
                      <td key={s.id} className={`border border-slate-200 p-0 print:border-black ${s.isBreak ? 'bg-amber-50/10' : ''}`}>
                        {s.isBreak ? (
                          <div className="flex items-center justify-center h-full">
                            <span className="text-[6px] font-black text-amber-500/50 uppercase print:text-black">R</span>
                          </div>
                        ) : getCellContent(cls.name, s.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="print-footer mt-auto pt-16 flex justify-between items-end px-12 shrink-0">
            <p className="text-[7px] font-bold text-slate-300 italic">Institutional Master Sheet • Page-break: Auto</p>
            <div className="flex flex-col items-center">
              <div className="w-48 h-[1px] bg-[#001f3f] mb-1 print:bg-black"></div>
              <p className="text-[8px] font-black text-[#001f3f] uppercase tracking-[0.2em] print:text-black">Principal's Signature</p>
            </div>
          </div>
        </div>
      );
    });
  };

  const renderTimetableCard = (id: string) => {
    if (viewType === 'DEPARTMENT') {
      return renderDepartmentMasterSheets(id as SectionType);
    }

    const slots = getSlotsForEntity(id);
    let entityName = id;
    let subMeta = '';
    let classTeacher = '';

    if (viewType === 'STAFF') {
      const u = users.find(user => user.id === id);
      entityName = u?.name || id;
      subMeta = `Emp ID: ${u?.employeeId || 'N/A'}`;
    } else if (viewType === 'CLASS') {
      const u = users.find(user => user.classTeacherOf === id);
      classTeacher = u?.name || 'Unassigned';
    }

    const getCellContent = (day: string, slotId: number) => {
      const key = `${day}-${slotId}`;
      const candidates = cellRegistry.get(key) || [];
      
      const activeEntries = candidates.filter(t => {
        if (viewType === 'CLASS') return t.className === id;
        if (viewType === 'STAFF') {
          if (t.teacherId === id) return true;
          if (t.blockId) {
            const block = config.combinedBlocks.find(b => b.id === t.blockId);
            return block?.allocations.some(a => a.teacherId === id);
          }
          return false;
        }
        if (viewType === 'ROOM') {
          if (t.room === id) return true;
          if (t.blockId) {
            const block = config.combinedBlocks.find(b => b.id === t.blockId);
            return block?.allocations.some(a => a.room === id);
          }
          return false;
        }
        return false;
      });

      let entry = activeEntries.find(t => t.isSubstitution);
      if (!entry) entry = activeEntries[0];

      // Check Institutional P1 rule if no entry found
      if (!entry && slotId === 1) {
        const implicit = getImplicitEntry(day, slotId, id, viewType);
        if (implicit) entry = implicit;
      }

      if (!entry) return null;
      
      let displaySub = entry.subject;
      let displayMeta = '';

      if (viewType === 'CLASS') {
        displayMeta = entry.teacherName ? entry.teacherName.split(' ')[0] : 'N/A';
      } else if (viewType === 'STAFF') {
        displayMeta = entry.className;
        if (entry.blockId) {
          const block = config.combinedBlocks.find(b => b.id === entry!.blockId);
          const allocation = block?.allocations.find(a => a.teacherId === id);
          if (allocation) displaySub = allocation.subject;
        }
      } else if (viewType === 'ROOM') {
        displayMeta = `${entry.className} (${entry.teacherName?.split(' ')[0] || 'N/A'})`;
      }

      return (
        <div className="flex flex-col items-center justify-center text-center p-0.5 h-full overflow-hidden">
          <p className="text-[18px] font-black uppercase text-[#001f3f] leading-none print:text-black truncate w-full">{displaySub}</p>
          <p className="text-[14px] font-bold text-slate-500 mt-1 uppercase print:text-black truncate w-full">{displayMeta}</p>
          {entry.isSubstitution && <div className="mt-1 text-[8px] font-black bg-amber-400 text-white px-1.5 rounded no-print">SUB</div>}
        </div>
      );
    };

    return (
      <div key={id} className="timetable-a4-card bg-white p-8 shadow-xl border border-slate-200 aspect-[1.414/1] w-full max-w-[297mm] mx-auto flex flex-col relative overflow-hidden transition-all duration-500 mb-0">
        <div className="mb-4 border-b-2 border-[#001f3f] pb-4 print:border-black shrink-0">
          <div className="flex items-center justify-center gap-6 mb-2">
            <img 
              src={SCHOOL_LOGO_BASE64} 
              alt="IHIS" 
              className="w-16 h-16 object-contain"
            />
            <div className="text-center">
              <h2 className="text-2xl font-black text-[#001f3f] uppercase italic tracking-tighter print:text-black leading-none">{SCHOOL_NAME}</h2>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] mt-1 print:text-black">Academic Year 2026-2027</p>
            </div>
          </div>
          
          <div className="flex justify-between items-end mt-4 px-4">
            <div className="text-left">
              <p className="text-base font-black text-[#001f3f] uppercase print:text-black leading-none">{viewType}: {entityName}</p>
              {subMeta && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest print:text-black mt-1">{subMeta}</p>}
            </div>
            {viewType === 'CLASS' && (
              <p className="text-[10px] font-black text-slate-500 uppercase italic print:text-black">Class Teacher: {classTeacher.toUpperCase()}</p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden border border-slate-300 print:border-black">
          <table className="w-full h-full border-collapse table-fixed">
            <thead className="bg-[#001f3f] print:bg-slate-100">
              <tr>
                <th className="w-20 border border-white/10 text-[14px] font-black text-amber-400 uppercase italic day-column-cell print:text-black">Day</th>
                {slots.map(s => (
                  <th key={s.id} className="border border-white/10 text-white p-2 print:border-black print:text-black">
                    <p className="text-[15px] font-black uppercase">{s.label.replace('Period ', 'P')}</p>
                    <p className="text-[10px] opacity-60 font-bold print:opacity-100">{s.startTime}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day} className="h-[16%]">
                  <td className="bg-slate-50 border border-slate-200 text-center font-black text-[14px] uppercase text-[#001f3f] italic day-column-cell print:text-black">
                    {day.substring(0,3)}
                  </td>
                  {slots.map(s => (
                    <td key={s.id} className={`border border-slate-200 p-0 print:border-black ${s.isBreak ? 'bg-amber-50/20' : ''}`}>
                      {s.isBreak ? (
                        <div className="flex items-center justify-center h-full">
                          <span className="text-[14px] font-black text-amber-400 uppercase tracking-[0.3em] print:text-black">RECESS</span>
                        </div>
                      ) : getCellContent(day, s.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="print-footer mt-auto pt-16 flex justify-end px-12 shrink-0">
          <div className="flex flex-col items-center">
            <div className="w-56 h-[1.5px] bg-[#001f3f] mb-2 print:bg-black"></div>
            <p className="text-[9px] font-black text-[#001f3f] uppercase tracking-[0.3em] print:text-black">Principal's Signature</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col xl:flex-row h-full gap-8 animate-in fade-in duration-700">
      <div className="w-full xl:w-80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col no-print shrink-0">
        <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter mb-6">Batch Controls</h2>
        
        <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl mb-6 flex-wrap gap-1">
          {(['CLASS', 'STAFF', 'ROOM', 'DEPARTMENT'] as const).map(type => (
            <button
              key={type}
              onClick={() => { setViewType(type); setSelectedIds([]); }}
              className={`flex-1 py-2.5 px-1 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${viewType === type ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}
            >
              {type === 'DEPARTMENT' ? 'Master' : type}
            </button>
          ))}
        </div>

        <div className="relative mb-4">
          <input 
            type="text" 
            placeholder={`Search ${viewType.toLowerCase()}...`}
            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold dark:text-white outline-none focus:ring-2 ring-amber-400 transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>

        <div className="flex justify-between mb-4 px-2">
          <button onClick={selectAll} className="text-[9px] font-black text-sky-500 uppercase hover:underline">Select All</button>
          <button onClick={clearAll} className="text-[9px] font-black text-rose-500 uppercase hover:underline">Clear</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
          {availableEntities.map(entity => (
            <label 
              key={entity.id}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                selectedIds.includes(entity.id) 
                ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50' 
                : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <input 
                type="checkbox" 
                checked={selectedIds.includes(entity.id)}
                onChange={() => toggleEntity(entity.id)}
                className="w-4 h-4 rounded border-slate-300 text-[#001f3f] focus:ring-[#001f3f]"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-black uppercase truncate ${selectedIds.includes(entity.id) ? 'text-[#001f3f] dark:text-amber-400' : 'text-slate-500 dark:text-slate-300'}`}>{entity.name}</p>
                {entity.meta && <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{entity.meta}</p>}
              </div>
            </label>
          ))}
        </div>

        <div className="pt-6 space-y-3">
          <button 
            onClick={handleExportPDF}
            disabled={selectedIds.length === 0 || isExporting}
            className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-3"
          >
            <svg className={`w-4 h-4 ${isExporting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {isExporting ? 'Generating Packet...' : 'Download Batch PDF'}
          </button>
          
          <p className="text-[8px] font-black text-slate-300 text-center uppercase tracking-widest">{viewType === 'DEPARTMENT' ? 'A3' : 'A4'} Landscape Format • Multi-Sheet</p>
        </div>
      </div>

      <div id="batch-render-zone" className="flex-1 overflow-y-auto pr-2 scrollbar-hide pb-20 batch-print-container">
        {selectedIds.length > 0 ? (
          <div className="space-y-0">
            {selectedIds.map(id => renderTimetableCard(id))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-40 no-print">
             <svg className="w-32 h-32 text-slate-300 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
             <p className="text-xl font-black uppercase tracking-[0.4em]">Select entities to generate preview</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatchTimetableView;

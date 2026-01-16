import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot } from '../types.ts';
import { DAYS, PRIMARY_SLOTS, SECONDARY_GIRLS_SLOTS, SECONDARY_BOYS_SLOTS, SCHOOL_NAME } from '../constants.ts';

// Explicitly declare html2pdf for the TS compiler
declare var html2pdf: any;

interface BatchTimetableViewProps {
  users: User[];
  timetable: TimeTableEntry[];
  config: SchoolConfig;
}

const BatchTimetableView: React.FC<BatchTimetableViewProps> = ({ users, timetable, config }) => {
  const [viewType, setViewType] = useState<'CLASS' | 'STAFF' | 'ROOM'>('CLASS');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  // Pre-load logo as Base64 to bypass CORS issues in html2canvas/PDF
  useEffect(() => {
    const logoUrl = "https://raw.githubusercontent.com/ahmedminwal/ihis-assets/main/logo.png";
    const convertToBase64 = async (url: string) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.error("Failed to load institutional logo for PDF:", e);
        return null;
      }
    };

    convertToBase64(logoUrl).then(base64 => {
      if (base64) setLogoBase64(base64);
    });
  }, []);

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
      list = config.classes.map(c => ({ id: c.name, name: c.name, meta: c.section }));
    } else if (viewType === 'STAFF') {
      list = users.filter(u => !u.isResigned && u.role.includes('TEACHER')).map(u => ({ id: u.id, name: u.name, meta: u.employeeId }));
    } else {
      list = (config.rooms || []).map(r => ({ id: r, name: r }));
    }

    if (!searchTerm) return list;
    const lowerSearch = searchTerm.toLowerCase();
    return list.filter(e => 
      e.name.toLowerCase().includes(lowerSearch) || 
      e.id.toLowerCase().includes(lowerSearch)
    );
  }, [viewType, config, users, searchTerm]);

  const toggleEntity = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => setSelectedIds(availableEntities.map(e => e.id));
  const clearAll = () => setSelectedIds([]);

  const getSlotsForEntity = useCallback((entityId: string): TimeSlot[] => {
    if (viewType === 'CLASS') {
      const cls = config.classes.find(c => c.name === entityId);
      if (cls?.section === 'PRIMARY') return PRIMARY_SLOTS;
      if (cls?.section.includes('GIRLS')) return SECONDARY_GIRLS_SLOTS;
      return SECONDARY_BOYS_SLOTS;
    }

    let baseSlots: TimeSlot[] = SECONDARY_BOYS_SLOTS;
    if (viewType === 'STAFF') {
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
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
      // Use 'css' mode to strictly follow our last-child page-break logic
      pagebreak: { mode: 'css' }
    };

    try {
      // Increased wait time to 3 seconds to ensure all images (Base64) are fully rendered in the virtual canvas
      await new Promise(resolve => setTimeout(resolve, 3000)); 
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("Batch PDF Generation Failure:", err);
      alert("Failed to generate packet. Verify internet and try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const renderTimetableCard = (id: string) => {
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
      if (!entry) return null;
      
      let displaySub = entry.subject;
      let displayMeta = '';

      if (viewType === 'CLASS') {
        displayMeta = entry.teacherName.split(' ')[0];
      } else if (viewType === 'STAFF') {
        displayMeta = entry.className;
        if (entry.blockId) {
          const block = config.combinedBlocks.find(b => b.id === entry!.blockId);
          const allocation = block?.allocations.find(a => a.teacherId === id);
          if (allocation) displaySub = allocation.subject;
        }
      } else if (viewType === 'ROOM') {
        displayMeta = `${entry.className} (${entry.teacherName.split(' ')[0]})`;
      }

      return (
        <div className="flex flex-col items-center justify-center text-center p-1 h-full overflow-hidden">
          <p className="text-[12px] font-black uppercase text-[#001f3f] leading-tight print:text-black">{displaySub}</p>
          <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase print:text-black truncate w-full">{displayMeta}</p>
          {entry.isSubstitution && <div className="mt-1 text-[7px] font-black bg-amber-400 text-white px-1.5 rounded no-print">SUB</div>}
        </div>
      );
    };

    return (
      <div key={id} className="timetable-a4-card bg-white p-8 shadow-xl border border-slate-200 aspect-[1.414/1] w-full max-w-[297mm] mx-auto flex flex-col relative overflow-hidden transition-all duration-500">
        {/* Institutional Header with Logo */}
        <div className="mb-4 border-b-2 border-[#001f3f] pb-4 print:border-black shrink-0">
          <div className="flex items-center justify-center gap-6 mb-2">
            {/* Using Base64 logo to guarantee cross-origin rendering in PDF */}
            <img 
              src={logoBase64 || "https://raw.githubusercontent.com/ahmedminwal/ihis-assets/main/logo.png"} 
              alt="IHIS Logo" 
              className="w-16 h-16 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="text-center">
              <h2 className="text-2xl font-black text-[#001f3f] uppercase italic tracking-tighter print:text-black leading-none">{SCHOOL_NAME}</h2>
              {/* Changed subheading to Academic Year 2026-2027 */}
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

        {/* Timetable Grid */}
        <div className="flex-1 overflow-hidden border border-slate-300 print:border-black">
          <table className="w-full h-full border-collapse table-fixed">
            <thead className="bg-[#001f3f] print:bg-slate-100">
              <tr>
                <th className="w-20 border border-white/10 text-[10px] font-black text-amber-400 uppercase italic day-column-cell print:text-black">Day</th>
                {slots.map(s => (
                  <th key={s.id} className="border border-white/10 text-white p-2 print:border-black print:text-black">
                    <p className="text-[11px] font-black uppercase">{s.label.replace('Period ', 'P')}</p>
                    <p className="text-[8px] opacity-60 font-bold print:opacity-100">{s.startTime}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day} className="h-[16%]">
                  <td className="bg-slate-50 border border-slate-200 text-center font-black text-[10px] uppercase text-[#001f3f] italic day-column-cell print:text-black">
                    {day.substring(0,3)}
                  </td>
                  {slots.map(s => (
                    <td key={s.id} className={`border border-slate-200 p-0 print:border-black ${s.isBreak ? 'bg-amber-50/20' : ''}`}>
                      {s.isBreak ? (
                        <div className="flex items-center justify-center h-full">
                          <span className="text-[9px] font-black text-amber-400 uppercase tracking-[0.3em] print:text-black">RECESS</span>
                        </div>
                      ) : getCellContent(day, s.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Institutional Footer */}
        <div className="print-footer mt-auto pt-4 flex justify-end px-12 shrink-0">
          <div className="flex flex-col items-center">
            <div className="w-56 h-[1.5px] bg-[#001f3f] mb-2 print:bg-black"></div>
            {/* Changed from Authorizing Signature to Principal's Signature */}
            <p className="text-[9px] font-black text-[#001f3f] uppercase tracking-[0.3em] print:text-black">Principal's Signature</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col xl:flex-row h-full gap-8 animate-in fade-in duration-700">
      {/* Selection Panel */}
      <div className="w-full xl:w-80 bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col no-print shrink-0">
        <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter mb-6">Entity Selector</h2>
        
        <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl mb-6">
          {(['CLASS', 'STAFF', 'ROOM'] as const).map(type => (
            <button
              key={type}
              onClick={() => { setViewType(type); setSelectedIds([]); }}
              className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewType === type ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}
            >
              {type}
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
            className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-3"
          >
            <svg className={`w-4 h-4 ${isExporting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {isExporting ? 'Generating...' : 'Download PDF Packet'}
          </button>
          
          <p className="text-[8px] font-black text-slate-300 text-center uppercase tracking-widest">A4 Landscape Format • High Res</p>
        </div>
      </div>

      {/* Viewer Area */}
      <div id="batch-render-zone" className="flex-1 overflow-y-auto pr-2 scrollbar-hide pb-20 batch-print-container">
        {selectedIds.length > 0 ? (
          <div className="space-y-0">
            {selectedIds.map(id => renderTimetableCard(id))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-40 no-print">
             <svg className="w-32 h-32 text-slate-300 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
             <p className="text-xl font-black uppercase tracking-[0.4em]">Select entities to view</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatchTimetableView;
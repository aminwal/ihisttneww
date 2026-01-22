
import React, { useState, useMemo, useEffect } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot, UserRole } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS } from '../constants.ts';

declare var html2pdf: any;

interface BatchTimetableViewProps {
  users: User[];
  timetable: TimeTableEntry[];
  timetableDraft?: TimeTableEntry[];
  isDraftMode?: boolean;
  config: SchoolConfig;
  currentUser: User;
  assignments: any[];
}

type BatchMode = 'CLASS' | 'STAFF' | 'ROOM' | 'MASTER';

const BatchTimetableView: React.FC<BatchTimetableViewProps> = ({ 
  users, timetable, timetableDraft = [], isDraftMode = false, config 
}) => {
  const [batchMode, setBatchMode] = useState<BatchMode>('CLASS');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(DAYS[0]);
  const [activeWingId, setActiveWingId] = useState<string>(config.wings[0]?.id || '');
  const [isExporting, setIsExporting] = useState(false);

  const activeData = useMemo(() => {
    const data = isDraftMode ? timetableDraft : timetable;
    if (data.length === 0) {
      return !isDraftMode ? timetableDraft : timetable;
    }
    return data;
  }, [isDraftMode, timetable, timetableDraft]);

  const entities = useMemo(() => {
    if (batchMode === 'CLASS') return config.sections.map(s => ({ id: s.id, name: s.fullName, type: 'CLASS' }));
    if (batchMode === 'STAFF') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name, type: 'STAFF' }));
    if (batchMode === 'ROOM') return config.rooms.map(r => ({ id: r, name: r, type: 'ROOM' }));
    return [];
  }, [batchMode, config.sections, config.rooms, users]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedIds.length === entities.length) setSelectedIds([]);
    else setSelectedIds(entities.map(e => e.id));
  };

  const activeWing = useMemo(() => config.wings.find(w => w.id === activeWingId), [config.wings, activeWingId]);
  
  const checkClash = (teacherId: string, day: string, slotId: number, currentEntryId: string) => {
    if (!teacherId) return false;
    const tid = teacherId.toLowerCase();
    return activeData.some(t => 
      t.id !== currentEntryId && 
      t.day === day && 
      t.slotId === slotId && 
      t.teacherId.toLowerCase() === tid && 
      !t.date
    );
  };

  const handleExportPDF = async () => {
    const isMaster = batchMode === 'MASTER';
    if (!isMaster && selectedIds.length === 0) return;
    
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const element = document.getElementById('batch-render-zone');
    if (!element) {
      setIsExporting(false);
      return;
    }

    const opt = {
      margin: 0, 
      filename: `IHIS_${batchMode}_${isMaster ? selectedDay : 'Bundle'}_${isDraftMode ? 'DRAFT' : 'LIVE'}.pdf`,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { 
        scale: 2.5, 
        useCORS: true, 
        logging: false,
        letterRendering: true,
        windowWidth: isMaster ? 1587 : 1122,
      },
      jsPDF: { 
        unit: 'mm', 
        format: isMaster ? 'a3' : 'a4', 
        orientation: 'landscape',
        compress: true
      },
      pagebreak: { mode: ['css', 'legacy'], after: '.pdf-page' }
    };

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("Institutional Export Failure:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const renderSingleTimetable = (entity: { id: string, name: string, type: string }) => {
    const showBreaks = entity.type === 'CLASS';
    const sectionObj = entity.type === 'CLASS' ? config.sections.find(s => s.id === entity.id) : null;
    const classTeacher = entity.type === 'CLASS' ? users.find(u => u.classTeacherOf === entity.id) : null;
    const wingId = sectionObj?.wingId || config.wings[0]?.id;
    const wing = config.wings.find(w => w.id === wingId);
    const slots = (config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || []).filter(s => showBreaks || !s.isBreak);
    const entityIdLower = entity.id.toLowerCase();

    return (
      <div 
        key={entity.id} 
        className="pdf-page bg-white flex flex-col" 
        style={{ 
          width: '297mm', 
          // REDUCED TO 95% OF A4 HEIGHT (210mm * 0.95 = 199.5mm)
          height: '200mm',
          padding: '10mm 5mm 5mm 15mm', 
          pageBreakAfter: 'always',
          overflow: 'hidden',
          boxSizing: 'border-box',
          position: 'relative',
          color: '#001f3f'
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-[0.035]">
           <div style={{ width: '120mm', height: '120mm' }}>
              <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'grayscale(100%)' }} />
           </div>
        </div>

        <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
          <div className="flex justify-between items-start border-b-[6px] border-[#001f3f] pb-4 mb-4">
            <div className="flex items-center gap-6">
              <div className="w-14 h-14">
                <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="Logo" className="w-full h-full object-contain" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-2xl font-black text-[#001f3f] uppercase italic tracking-tighter leading-none">{SCHOOL_NAME}</h2>
                <p className="text-[9px] font-black text-amber-600 uppercase tracking-[0.4em]">Academic Year 2026-2027</p>
                {entity.type === 'CLASS' && classTeacher && (
                  <p className="text-xs font-black text-sky-700 uppercase italic mt-1">Class Teacher: {classTeacher.name}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <h3 className="text-sm font-black text-[#001f3f] uppercase tracking-tighter opacity-40 leading-none">{entity.type} SCHEDULE</h3>
              <p className="text-3xl font-black text-sky-600 uppercase italic leading-none">{entity.name}</p>
            </div>
          </div>

          <div className="flex-1 overflow-hidden w-full">
            <table className="w-full border-collapse border-[5px] border-[#001f3f] bg-transparent" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border-[2px] border-[#001f3f] p-2 text-[10px] font-black uppercase text-[#001f3f] bg-slate-50 italic" style={{ width: '11%' }}>Day</th>
                  {slots.map(s => (
                    <th key={s.id} className={`border-[2px] border-[#001f3f] p-1 text-center ${s.isBreak ? 'bg-amber-50' : ''}`}>
                      <p className="text-[9px] font-black uppercase text-[#001f3f] leading-none">{s.label.replace('Period ', 'P')}</p>
                      <p className="text-[7px] font-bold text-slate-500 mt-1 whitespace-nowrap">{s.startTime}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map(day => (
                  <tr key={day} className="h-[20mm]">
                    <td className="border-[2px] border-[#001f3f] bg-slate-50 text-center text-[10px] font-black uppercase italic text-[#001f3f]">{day.substring(0, 3)}</td>
                    {slots.map(s => {
                      if (s.isBreak) {
                        return <td key={s.id} className="border-[2px] border-[#001f3f] bg-amber-50/40 text-center align-middle text-[8px] font-black text-amber-500 uppercase tracking-widest italic">Break</td>;
                      }

                      const entries = activeData.filter(t => 
                        t.day === day && 
                        t.slotId === s.id && 
                        !t.date &&
                        (entity.type === 'CLASS' ? t.sectionId.toLowerCase() === entityIdLower : 
                         entity.type === 'STAFF' ? t.teacherId.toLowerCase() === entityIdLower : 
                         t.room.toLowerCase() === entityIdLower)
                      );

                      return (
                        <td key={s.id} className="border-[2px] border-[#001f3f] p-0.5 text-center align-middle overflow-hidden relative bg-white">
                          {entries.length > 0 ? entries.map(entry => {
                            const clashing = checkClash(entry.teacherId, entry.day, entry.slotId, entry.id);
                            return (
                              <div key={entry.id} className={`space-y-0.5 p-0.5 rounded ${clashing ? 'bg-rose-50 border border-rose-500' : ''}`}>
                                <p className="text-[9px] font-black uppercase text-[#001f3f] leading-none truncate">{entry.subject}</p>
                                <p className="text-[7px] font-bold text-slate-500 leading-none truncate italic mt-0.5">
                                  {entity.type === 'STAFF' ? entry.className : entry.teacherName.split(' ')[0]}
                                </p>
                              </div>
                            );
                          }) : (
                            <span className="text-[7px] text-slate-100 uppercase font-black italic tracking-widest">Free</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-auto flex justify-between items-end border-t-2 border-slate-100 pt-2 opacity-80 w-full">
          <div className="text-[8px] font-black uppercase tracking-widest text-slate-300 leading-relaxed">
            MATRIX ID: {entity.id.toUpperCase()}<br />
            TIMESTAMP: {new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Bahrain' })}
          </div>
          <div className="text-right">
            <div className="w-40 h-[1.5px] bg-[#001f3f] ml-auto mb-1"></div>
            <span className="text-lg font-black uppercase tracking-[0.3em] text-[#001f3f] italic pr-2">Principal</span>
          </div>
        </div>
      </div>
    );
  };

  const renderMasterMatrix = () => {
    const sections = config.sections.filter(s => s.wingId === activeWingId);
    const wingSlots = (config.slotDefinitions?.[activeWing?.sectionType || 'PRIMARY'] || []);
    
    return (
      <div 
        id="batch-render-zone" 
        className="bg-white flex flex-col mx-auto" 
        style={{ 
          width: '420mm', 
          // REDUCED TO ~95% OF A3 HEIGHT (297mm * 0.95 = 282.15mm)
          height: '282mm', 
          padding: '10mm 5mm 10mm 15mm',
          boxSizing: 'border-box',
          position: 'relative',
          color: '#001f3f'
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-[0.03]">
           <div style={{ width: '220mm', height: '220mm' }}>
              <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
           </div>
        </div>

        <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
          <div className="flex justify-between items-center border-b-[8px] border-[#001f3f] pb-6 mb-8">
            <div className="flex items-center gap-10">
              <div className="w-24 h-24">
                <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="Logo" className="w-full h-full object-contain" />
              </div>
              <div className="space-y-1">
                <h1 className="text-5xl font-black text-[#001f3f] uppercase italic tracking-tighter leading-none">{SCHOOL_NAME}</h1>
                <p className="text-lg font-black text-amber-500 uppercase tracking-[0.5em] mt-2">Academic Year 2026-2027</p>
              </div>
            </div>
            <div className="text-right space-y-4">
              <h2 className="text-2xl font-black text-[#001f3f] uppercase tracking-tighter opacity-30">MASTER TIMETABLE MATRIX</h2>
              <div className="flex justify-end items-center gap-6">
                 <span className="px-8 py-3 bg-[#001f3f] text-[#d4af37] text-xl font-black rounded-2xl uppercase italic shadow-xl">{selectedDay}</span>
                 <span className="px-8 py-3 bg-sky-600 text-white text-xl font-black rounded-2xl uppercase italic shadow-xl">{activeWing?.name}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden w-full">
            <table className="w-full border-collapse border-[6px] border-[#001f3f] bg-transparent" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border-[3px] border-[#001f3f] p-4 text-xl font-black uppercase text-[#001f3f] italic w-64 text-center bg-slate-50">Class / Section</th>
                  {wingSlots.map(s => (
                    <th key={s.id} className={`border-[3px] border-[#001f3f] p-3 text-center ${s.isBreak ? 'bg-amber-50' : ''}`}>
                      <p className="text-xl font-black uppercase text-[#001f3f] leading-none">{s.label.replace('Period ', 'P')}</p>
                      <p className="text-sm font-bold text-slate-500 tracking-widest mt-1">{s.startTime}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map(section => (
                  <tr key={section.id}>
                    <td className="border-[3px] border-[#001f3f] p-3 bg-slate-50 text-center align-middle">
                      <p className="text-3xl font-black text-[#001f3f] uppercase italic leading-tight">{section.fullName}</p>
                    </td>
                    {wingSlots.map(s => {
                      if (s.isBreak) {
                         return <td key={s.id} className="border-[3px] border-[#001f3f] bg-amber-50/20 text-center align-middle text-xs font-black text-amber-500 uppercase tracking-widest italic">Break</td>;
                      }

                      const entry = activeData.find(t => t.sectionId.toLowerCase() === section.id.toLowerCase() && t.day === selectedDay && t.slotId === s.id && !t.date);
                      const clashing = entry ? checkClash(entry.teacherId, entry.day, entry.slotId, entry.id) : false;

                      return (
                        <td key={s.id} className={`border-[3px] border-[#001f3f] p-2 text-center align-middle transition-colors bg-white ${clashing ? 'bg-rose-50' : ''}`}>
                          {entry ? (
                            <div className="space-y-1">
                              <p className={`text-lg font-black uppercase leading-tight line-clamp-2 ${entry.blockId ? 'text-amber-600' : 'text-[#001f3f]'}`}>{entry.subject}</p>
                              <p className={`text-xs font-black uppercase italic truncate ${clashing ? 'text-rose-600' : 'text-sky-700'}`}>{entry.teacherName}</p>
                            </div>
                          ) : (
                            <span className="text-xs font-black text-slate-100 uppercase italic tracking-widest">Free</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-auto flex justify-between items-end border-t-[4px] border-slate-100 pt-6 opacity-80 w-full">
           <div className="space-y-2">
              <p className="text-sm font-black text-slate-400 uppercase tracking-[0.4em]">Integrated Institutional Management Matrix</p>
              <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest leading-loose">
                GENERATED: {new Date().toLocaleString('en-US', { timeZone: 'Asia/Bahrain' })}
              </div>
           </div>
           <div className="text-right space-y-3">
              <div className="w-[80mm] h-[2px] bg-[#001f3f] ml-auto"></div>
              <p className="text-4xl font-black text-[#001f3f] uppercase tracking-[0.2em] italic">Principal</p>
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">
            Batch <span className="text-[#d4af37]">Deployment</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Analytical Resource Packaging ({isDraftMode ? 'Draft Mode' : 'Live Mode'})</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 shadow-sm">
            {(['CLASS', 'STAFF', 'ROOM', 'MASTER'] as BatchMode[]).map(m => (
              <button key={m} onClick={() => { setBatchMode(m); setSelectedIds([]); }} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${batchMode === m ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{m}</button>
            ))}
          </div>

          {batchMode === 'MASTER' ? (
             <div className="flex gap-4">
               <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="bg-white px-5 py-3 rounded-2xl border border-slate-100 text-[10px] font-black uppercase outline-none shadow-sm">
                 {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
               </select>
               <select value={activeWingId} onChange={e => setActiveWingId(e.target.value)} className="bg-white px-5 py-3 rounded-2xl border border-slate-100 text-[10px] font-black uppercase outline-none shadow-sm">
                 {config.wings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
               </select>
             </div>
          ) : (
            <button onClick={selectAll} className="bg-white px-6 py-3 rounded-2xl border border-slate-100 text-[10px] font-black uppercase text-slate-500 shadow-sm hover:bg-slate-50 transition-all">
              {selectedIds.length === entities.length ? 'Deselect All' : 'Select All'}
            </button>
          )}

          <button 
            onClick={handleExportPDF} 
            disabled={isExporting || (batchMode !== 'MASTER' && selectedIds.length === 0)}
            className="bg-rose-600 text-white px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-rose-700 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {isExporting ? 'Packaging Matrix...' : (batchMode === 'MASTER' ? 'Export Master A3' : 'Export Selection')}
          </button>
        </div>
      </div>

      {batchMode !== 'MASTER' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 no-print px-2">
          {entities.map(e => (
            <button 
              key={e.id} 
              onClick={() => toggleSelection(e.id)}
              className={`p-4 rounded-2xl border-2 transition-all text-left group ${selectedIds.includes(e.id) ? 'bg-[#001f3f] border-transparent shadow-lg' : 'bg-white border-slate-50 hover:border-amber-400 shadow-sm'}`}
            >
              <p className={`text-[10px] font-black uppercase truncate leading-none ${selectedIds.includes(e.id) ? 'text-amber-400' : 'text-[#001f3f]'}`}>{e.name}</p>
              <p className={`text-[8px] font-bold uppercase mt-1.5 ${selectedIds.includes(e.id) ? 'text-white/40' : 'text-slate-400'}`}>{e.id.substring(0,8)}</p>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto scrollbar-hide pb-10">
        <div id="batch-render-zone" className="block mx-auto max-w-full">
          {batchMode === 'MASTER' ? (
             renderMasterMatrix()
          ) : (
             entities.filter(e => selectedIds.includes(e.id)).map(e => renderSingleTimetable(e))
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchTimetableView;


import React, { useState, useMemo, useEffect } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot, UserRole, SubstitutionRecord } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS } from '../constants.ts';
import { getWeekDates } from '../utils/dateUtils.ts';

declare var html2pdf: any;

interface BatchTimetableViewProps {
  users: User[];
  timetable: TimeTableEntry[];
  timetableDraft?: TimeTableEntry[];
  isDraftMode?: boolean;
  config: SchoolConfig;
  currentUser: User;
  assignments: any[];
  substitutions: SubstitutionRecord[];
}

type BatchMode = 'CLASS' | 'STAFF' | 'ROOM' | 'MASTER';

const BatchTimetableView: React.FC<BatchTimetableViewProps> = ({ 
  users, timetable, timetableDraft = [], isDraftMode = false, config, substitutions = [], currentUser
}) => {
  const isManagement = currentUser?.role === UserRole.ADMIN || currentUser?.role.startsWith('INCHARGE_');
  const [batchMode, setBatchMode] = useState<BatchMode>(isManagement ? 'CLASS' : 'STAFF');
  const [selectedIds, setSelectedIds] = useState<string[]>(isManagement ? [] : [currentUser.id]);
  const [selectedDay, setSelectedDay] = useState<string>(DAYS[0]);
  const [activeWingId, setActiveWingId] = useState<string>(config.wings[0]?.id || '');
  const [isExporting, setIsExporting] = useState(false);

  const currentWeekDates = useMemo(() => getWeekDates(), []);

  const activeData = useMemo(() => {
    const data = isDraftMode ? timetableDraft : timetable;
    return data.length === 0 ? (!isDraftMode ? timetableDraft : timetable) : data;
  }, [isDraftMode, timetable, timetableDraft]);

  const entities = useMemo(() => {
    if (!isManagement) {
      const list = [{ id: currentUser.id, name: currentUser.name, type: 'STAFF' }];
      if (currentUser.classTeacherOf) {
        const sect = config.sections.find(s => s.id === currentUser.classTeacherOf);
        if (sect) list.push({ id: sect.id, name: sect.fullName, type: 'CLASS' });
      }
      return list;
    }
    if (batchMode === 'CLASS') return config.sections.map(s => ({ id: s.id, name: s.fullName, type: 'CLASS' }));
    if (batchMode === 'STAFF') return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => ({ id: u.id, name: u.name, type: 'STAFF' }));
    if (batchMode === 'ROOM') return config.rooms.map(r => ({ id: r, name: r, type: 'ROOM' }));
    return [];
  }, [batchMode, config.sections, config.rooms, users, isManagement, currentUser]);

  const checkClash = (teacherId: string, day: string, slotId: number, currentEntryId: string) => {
    if (!teacherId) return false;
    const tid = teacherId.toLowerCase();
    return activeData.some(t => t.id !== currentEntryId && t.day === day && t.slotId === slotId && (t.teacherId || '').toLowerCase() === tid && !t.date);
  };

  const handleExportPDF = async () => {
    const isM = batchMode === 'MASTER';
    if (!isM && selectedIds.length === 0) return;
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const element = document.getElementById('batch-render-zone');
    if (!element) { setIsExporting(false); return; }
    const opt = {
      margin: 0, filename: `IHIS_${batchMode}_Audit.pdf`,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2.5, useCORS: true, logging: false, letterRendering: true, windowWidth: isM ? 1587 : 1122 },
      jsPDF: { unit: 'mm', format: isM ? 'a3' : 'a4', orientation: 'landscape', compress: true },
      pagebreak: { mode: ['css', 'legacy'], after: '.pdf-page' }
    };
    try { await html2pdf().set(opt).from(element).save(); } catch (err) { console.error("Export Failure", err); } finally { setIsExporting(false); }
  };

  const renderSingleTimetable = (entity: { id: string, name: string, type: string }) => {
    const isC = entity.type === 'CLASS'; const isS = entity.type === 'STAFF'; const isR = entity.type === 'ROOM';
    const sectObj = isC ? config.sections.find(s => s.id === entity.id) : null;
    const wingId = sectObj?.wingId || activeWingId;
    const wing = config.wings.find(w => w.id === wingId);
    const slots = (config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || []).filter(s => isC || !s.isBreak);
    const eidLower = entity.id.toLowerCase();

    return (
      <div key={entity.id} className="pdf-page bg-white flex flex-col" style={{ width: '297mm', height: '200mm', padding: '10mm 5mm 5mm 15mm', pageBreakAfter: 'always', boxSizing: 'border-box', position: 'relative', color: '#001f3f' }}>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-[0.035]"><div style={{ width: '120mm', height: '120mm' }}><img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div></div>
        <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
          <div className="flex justify-between items-start border-b-[6px] border-[#001f3f] pb-4 mb-4">
            <div className="flex items-center gap-6"><div className="w-14 h-14"><img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="Logo" className="w-full h-full object-contain" /></div><div className="space-y-0.5"><h2 className="text-2xl font-black text-[#001f3f] uppercase italic tracking-tighter leading-none">{SCHOOL_NAME}</h2><p className="text-[9px] font-black text-amber-600 uppercase tracking-[0.4em]">Academic Year 2026-2027</p>{isC && sectObj && (<p className="text-xs font-black text-sky-700 uppercase italic mt-1">Class Teacher: {users.find(u => u.classTeacherOf === sectObj.id)?.name || 'Unassigned'}</p>)}</div></div>
            <div className="text-right"><h3 className="text-sm font-black text-[#001f3f] uppercase tracking-tighter opacity-40 leading-none">{entity.type} SCHEDULE</h3><p className="text-3xl font-black text-sky-600 uppercase italic leading-none">{entity.name}</p></div>
          </div>
          <table className="w-full border-collapse border-[5px] border-[#001f3f]" style={{ tableLayout: 'fixed' }}>
            <thead><tr className="bg-slate-100"><th className="border-[2px] border-[#001f3f] p-2 text-[10px] font-black uppercase text-[#001f3f] bg-slate-50 italic" style={{ width: '11%' }}>Day</th>{slots.map(s => (<th key={s.id} className={`border-[2px] border-[#001f3f] p-1 text-center ${s.isBreak ? 'bg-amber-50' : ''}`}><p className="text-[9px] font-black uppercase text-[#001f3f] leading-none">{s.label.replace('Period ', 'P')}</p><p className="text-[7px] font-bold text-slate-500 mt-1">{s.startTime}</p></th>))}</tr></thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day} className="h-[20mm]">
                  <td className="border-[2px] border-[#001f3f] bg-slate-50 text-center text-[10px] font-black uppercase italic">{day.substring(0, 3)}</td>
                  {slots.map(s => {
                    if (s.isBreak) return <td key={s.id} className="border-[2px] border-[#001f3f] bg-amber-50/40 text-center text-[8px] font-black text-amber-500 uppercase italic">Break</td>;
                    let prx: SubstitutionRecord | undefined = undefined;
                    
                    if (!isDraftMode) {
                      const targetDate = currentWeekDates[day];
                      prx = substitutions.find(sub => {
                        if (sub.date !== targetDate || sub.isArchived) return false;
                        if (isC && sub.sectionId === entity.id && sub.slotId === s.id) return true;
                        if (isS && sub.substituteTeacherId === entity.id && sub.slotId === s.id) return true;
                        if (isR) {
                          const subStaff = users.find(u => u.id === sub.substituteTeacherId);
                          const subHome = subStaff?.classTeacherOf ? config.sections.find(sx => sx.id === subStaff.classTeacherOf) : null;
                          const subRoom = subHome ? `ROOM ${subHome.fullName}` : null;
                          const od = timetable.find(t => t.day === day && t.slotId === s.id && t.teacherId === sub.absentTeacherId && !t.date);
                          return (subRoom === entity.id) || (od?.room === entity.id);
                        }
                        return false;
                      });
                    }
                    if (prx) return <td key={s.id} className="border-[2px] border-amber-500 bg-amber-50/10 p-0.5 text-center relative overflow-hidden"><div className="space-y-0.5"><p className="text-[9px] font-black uppercase text-amber-700 truncate">{prx.subject}</p><p className="text-[7px] font-bold text-slate-500 truncate italic">{isS ? prx.className : prx.substituteTeacherName.split(' ')[0]}</p><span className="absolute bottom-0 right-0 px-1 bg-amber-400 text-[5px] font-black text-[#001f3f]">LIVE</span></div></td>;
                    const entries = activeData.filter(t => t.day === day && t.slotId === s.id && !t.date && (isC ? (t.sectionId || '').toLowerCase() === eidLower : isS ? (t.teacherId || '').toLowerCase() === eidLower : (t.room || '').toLowerCase() === eidLower));
                    return <td key={s.id} className="border-[2px] border-[#001f3f] p-0.5 text-center relative bg-white">{entries.length > 0 ? entries.map(e => { const clash = checkClash(e.teacherId, e.day, e.slotId, e.id); return <div key={e.id} className={`space-y-0.5 p-0.5 rounded relative ${clash ? 'bg-rose-50 border border-rose-500' : ''}`}><p className="text-[9px] font-black uppercase text-[#001f3f] truncate">{e.subject}</p><p className="text-[7px] font-bold text-slate-500 italic">{isS ? e.className : e.teacherName.split(' ')[0]}</p>{clash && <div className="absolute top-0 right-0 p-0.5"><span className="text-[5px] font-black bg-rose-600 text-white px-1 rounded shadow-sm">⚠️ CLASH</span></div>}</div>; }) : <span className="text-[7px] text-slate-100 uppercase font-black italic">Free</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-auto flex justify-between items-end border-t-2 border-slate-100 pt-2 opacity-80"><div className="text-[8px] font-black uppercase tracking-widest text-slate-300">ID: {entity.id.toUpperCase()}<br />TS: {new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Bahrain' })}</div><div className="text-right"><div className="w-40 h-[1.5px] bg-[#001f3f] ml-auto mb-1"></div><span className="text-lg font-black uppercase tracking-[0.3em] text-[#001f3f] italic pr-2">Principal</span></div></div>
      </div>
    );
  };

  const renderMasterMatrix = () => {
    const sects = config.sections.filter(s => s.wingId === activeWingId);
    const wSlots = (config.slotDefinitions?.[config.wings.find(w => w.id === activeWingId)?.sectionType || 'PRIMARY'] || []);
    const targetDate = currentWeekDates[selectedDay];

    return (
      <div id="batch-render-zone" className="bg-white flex flex-col mx-auto" style={{ width: '420mm', height: '282mm', padding: '10mm 5mm 10mm 15mm', boxSizing: 'border-box', position: 'relative', color: '#001f3f' }}>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-[0.03]"><div style={{ width: '220mm', height: '220mm' }}><img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div></div>
        <div className="flex-1 flex flex-col relative z-10 w-full overflow-hidden">
          <div className="flex justify-between items-center border-b-[8px] border-[#001f3f] pb-6 mb-8"><div className="flex items-center gap-10"><div className="w-24 h-24"><img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" alt="Logo" className="w-full h-full object-contain" /></div><div className="space-y-1"><h1 className="text-5xl font-black text-[#001f3f] uppercase italic tracking-tighter leading-none">{SCHOOL_NAME}</h1><p className="text-lg font-black text-amber-500 uppercase mt-2 tracking-[0.5em]">Academic Year 2026-2027</p></div></div><div className="text-right space-y-4"><h2 className="text-2xl font-black text-[#001f3f] uppercase tracking-tighter opacity-30">MASTER TIMETABLE</h2><div className="flex justify-end gap-6"><span className="px-8 py-3 bg-[#001f3f] text-[#d4af37] text-xl font-black rounded-2xl uppercase italic">{selectedDay} • {targetDate}</span></div></div></div>
          <table className="w-full border-collapse border-[6px] border-[#001f3f]" style={{ tableLayout: 'fixed' }}>
            <thead><tr className="bg-slate-100"><th className="border-[3px] border-[#001f3f] p-4 text-xl font-black uppercase text-[#001f3f] italic w-64 text-center bg-slate-50">Class</th>{wSlots.map(s => (<th key={s.id} className={`border-[3px] border-[#001f3f] p-3 text-center ${s.isBreak ? 'bg-amber-50' : ''}`}><p className="text-xl font-black uppercase text-[#001f3f] leading-none">{s.label.replace('Period ', 'P')}</p><p className="text-sm font-bold text-slate-500 mt-1">{s.startTime}</p></th>))}</tr></thead>
            <tbody>
              {sects.map(sec => (
                <tr key={sec.id}>
                  <td className="border-[3px] border-[#001f3f] p-3 bg-slate-50 text-center"><p className="text-3xl font-black text-[#001f3f] uppercase italic">{sec.fullName}</p></td>
                  {wSlots.map(s => {
                    if (s.isBreak) return <td key={s.id} className="border-[3px] border-[#001f3f] bg-amber-50/20 text-center italic text-xs font-black text-amber-500 uppercase">Break</td>;
                    let prx = !isDraftMode ? substitutions.find(sub => { return sub.sectionId === sec.id && sub.slotId === s.id && !sub.isArchived && sub.date === targetDate; }) : undefined;
                    if (prx) return <td key={s.id} className="border-[3px] border-amber-400 p-2 text-center bg-amber-50/20 relative"><div className="space-y-1"><p className="text-lg font-black uppercase leading-tight text-amber-700">{prx.subject}</p><p className="text-xs font-black uppercase italic text-amber-600">Sub: {prx.substituteTeacherName}</p></div><span className="absolute bottom-1 right-1 text-[6px] font-black text-amber-500 uppercase">Proxy</span></td>;
                    const e = activeData.find(t => (t.sectionId || '').toLowerCase() === sec.id.toLowerCase() && t.day === selectedDay && t.slotId === s.id && !t.date);
                    const clash = e ? checkClash(e.teacherId, e.day, e.slotId, e.id) : false;
                    return <td key={s.id} className={`border-[3px] border-[#001f3f] p-2 text-center relative transition-colors bg-white ${clash ? 'bg-rose-50' : ''}`}>{e ? (<div className="space-y-1"><p className={`text-lg font-black uppercase leading-tight line-clamp-2 ${e.blockId ? 'text-amber-600' : 'text-[#001f3f]'}`}>{e.subject}</p><p className={`text-xs font-black uppercase italic truncate ${clash ? 'text-rose-600' : 'text-sky-700'}`}>{e.teacherName}</p>{clash && <span className="absolute top-1 right-1 text-[8px] font-black text-rose-600 bg-rose-100 px-1 rounded border border-rose-200 shadow-sm">⚠️ CLASH</span>}</div>) : (<span className="text-xs font-black text-slate-100 uppercase italic">Free</span>)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div className="space-y-1 text-center md:text-left"><h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight leading-none">Batch <span className="text-[#d4af37]">Deployment</span></h1><p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Analytical Resource Packaging ({isDraftMode ? 'Draft' : 'Live'})</p></div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {(isManagement || (currentUser.classTeacherOf)) && (
            <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 shadow-sm">{(isManagement ? ['CLASS', 'STAFF', 'ROOM', 'MASTER'] : ['CLASS', 'STAFF']).map(m => (<button key={m} onClick={() => { setBatchMode(m as BatchMode); setSelectedIds(isManagement ? [] : (m === 'STAFF' ? [currentUser.id] : (currentUser.classTeacherOf ? [currentUser.classTeacherOf] : []))); }} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${batchMode === m ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{m}</button>))}</div>
          )}
          <div className="flex gap-4">{batchMode === 'MASTER' && (<select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white shadow-sm">{DAYS.map(d => <option key={d} value={d}>{d}</option>)}</select>)}<select value={activeWingId} onChange={e => setActiveWingId(e.target.value)} className={`bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white shadow-sm ${!isManagement ? 'opacity-50' : ''}`} disabled={!isManagement}>{config.wings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
          <button onClick={handleExportPDF} disabled={isExporting || (batchMode !== 'MASTER' && selectedIds.length === 0)} className="bg-rose-600 text-white px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-50 flex items-center gap-3 transition-all">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
             {isExporting ? 'Packaging...' : 'Export Matrix'}
          </button>
        </div>
      </div>
      {batchMode !== 'MASTER' && (<div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 no-print px-2">{entities.map(e => (<button key={e.id} onClick={() => isManagement && setSelectedIds(prev => prev.includes(e.id) ? prev.filter(i => i !== e.id) : [...prev, e.id])} className={`p-5 rounded-[2rem] border-2 transition-all text-left ${selectedIds.includes(e.id) ? 'bg-[#001f3f] border-transparent shadow-lg' : 'bg-white dark:bg-slate-900 border-slate-50 dark:border-slate-800 shadow-sm'} ${!isManagement ? 'cursor-default' : ''}`}><p className={`text-[10px] font-black uppercase truncate ${selectedIds.includes(e.id) ? 'text-amber-400' : 'text-[#001f3f] dark:text-white'}`}>{e.name}</p></button>))}</div>)}
      
      <div className="overflow-x-auto scrollbar-hide pb-10">
        <div id="batch-render-zone" className="block mx-auto max-w-full">
           <div className="md:hidden flex flex-col items-center justify-center py-20 px-6 text-center space-y-6">
              <div className="w-24 h-24 bg-emerald-50 dark:bg-emerald-950/20 rounded-full flex items-center justify-center text-emerald-500 shadow-inner">
                 <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <div className="space-y-2">
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Ready for Export</h4>
                 <p className="text-xs font-medium text-slate-400 leading-relaxed italic">Matrix has been calculated for {batchMode === 'MASTER' ? config.sections.filter(s => s.wingId === activeWingId).length : selectedIds.length} entities. High-fidelity rendering is optimized for A4 Landscape PDF.</p>
              </div>
              <div className="hidden">
                 {batchMode === 'MASTER' ? renderMasterMatrix() : entities.filter(e => selectedIds.includes(e.id)).map(e => renderSingleTimetable(e))}
              </div>
           </div>
           <div className="hidden md:block">
              {batchMode === 'MASTER' ? renderMasterMatrix() : entities.filter(e => selectedIds.includes(e.id)).map(e => renderSingleTimetable(e))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default BatchTimetableView;


import React, { useState, useMemo, useEffect } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot, UserRole, SubstitutionRecord, PrintConfig, PrintMode, PrintTemplate, PrintElement } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS, DEFAULT_PRINT_CONFIG } from '../constants.ts';
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

const BatchTimetableView: React.FC<BatchTimetableViewProps> = ({ 
  users, timetable, timetableDraft = [], isDraftMode = false, config, substitutions = [], currentUser
}) => {
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const isGlobalIncharge = currentUser?.role === UserRole.INCHARGE_ALL;
  const isManagement = isAdmin || isGlobalIncharge || currentUser?.role.startsWith('INCHARGE_');
  
  // ROLE-BASED VISIBILITY SCOPING
  const userWingScope = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return null; // All scopes
    if (currentUser.role === UserRole.INCHARGE_PRIMARY) return 'wing-p';
    if (currentUser.role === UserRole.INCHARGE_SECONDARY) return 'wing-sb'; // Initial anchor for secondary
    return null;
  }, [currentUser.role, isAdmin, isGlobalIncharge]);

  const [batchMode, setBatchMode] = useState<PrintMode>(isManagement ? 'CLASS' : 'STAFF');
  const [selectedIds, setSelectedIds] = useState<string[]>(isManagement ? [] : [currentUser.id]);
  const [selectedDay, setSelectedDay] = useState<string>(DAYS[0]);
  
  const [activeWingId, setActiveWingId] = useState<string>(() => {
    if (userWingScope) return userWingScope;
    return config.wings[0]?.id || '';
  });

  const [isExporting, setIsExporting] = useState(false);

  const currentWeekDates = useMemo(() => getWeekDates(), []);
  const printConfig: PrintConfig = config.printConfig || DEFAULT_PRINT_CONFIG;

  const activeData = useMemo(() => {
    const data = isDraftMode ? timetableDraft : timetable;
    return data.length === 0 ? (!isDraftMode ? timetableDraft : timetable) : data;
  }, [isDraftMode, timetable, timetableDraft]);

  /**
   * GRANULAR ENTITY DISCOVERY
   */
  const entities = useMemo(() => {
    if (!isManagement) {
      const list: { id: string, name: string, type: string }[] = [];
      if (batchMode === 'STAFF') {
        list.push({ id: currentUser.id, name: `${currentUser.name} (Self)`, type: 'STAFF' });
      }
      if (batchMode === 'CLASS' && currentUser.classTeacherOf) {
        const sect = config.sections.find(s => s.id === currentUser.classTeacherOf);
        if (sect) list.push({ id: sect.id, name: `${sect.fullName} (My Class)`, type: 'CLASS' });
      }
      return list;
    }

    const scope = userWingScope;
    if (batchMode === 'CLASS') {
      return config.sections
        .filter(s => scope ? s.wingId.includes(scope.substring(0, 6)) : true) // Broaden scope for secondary wings
        .filter(s => s.wingId === activeWingId)
        .map(s => ({ id: s.id, name: s.fullName, type: 'CLASS' }));
    }
    
    if (batchMode === 'STAFF') {
      return users.filter(u => {
        if (u.isResigned || u.role === UserRole.ADMIN) return false;
        if (currentUser.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY');
        if (currentUser.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY');
        return true;
      }).map(u => ({ id: u.id, name: u.name, type: 'STAFF' }));
    }
    
    if (batchMode === 'ROOM') {
      return config.rooms.map(r => ({ id: r, name: r, type: 'ROOM' }));
    }

    return [];
  }, [batchMode, config.sections, config.rooms, users, isManagement, currentUser, activeWingId, userWingScope]);

  const accessibleWings = useMemo(() => {
    if (isAdmin || isGlobalIncharge) return config.wings;
    if (currentUser.role === UserRole.INCHARGE_PRIMARY) return config.wings.filter(w => w.id === 'wing-p');
    if (currentUser.role === UserRole.INCHARGE_SECONDARY) return config.wings.filter(w => w.id.includes('wing-s'));
    return config.wings; 
  }, [config.wings, currentUser.role, isAdmin, isGlobalIncharge]);

  const handleExportPDF = async () => {
    const isM = batchMode === 'MASTER';
    if (!isM && selectedIds.length === 0) return;
    
    const activeTemplate = printConfig.templates[batchMode];
    const targetPageSize = activeTemplate.tableStyles.pageSize || 'a4';
    
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const element = document.getElementById('batch-render-zone');
    if (!element) { setIsExporting(false); return; }

    const widthMap: Record<string, number> = { 'a4': 1122, 'a3': 1587, 'letter': 1056, 'legal': 1344 };
    const opt = {
      margin: 0, filename: `IHIS_${batchMode}_Audit.pdf`,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2.5, useCORS: true, logging: false, letterRendering: true, windowWidth: widthMap[targetPageSize] || 1122 },
      jsPDF: { unit: 'mm', format: targetPageSize, orientation: 'landscape', compress: true },
      pagebreak: { mode: ['css', 'legacy'], after: '.pdf-page' }
    };
    try { await html2pdf().set(opt).from(element).save(); } catch (err) { console.error(err); } finally { setIsExporting(false); }
  };

  const injectContent = (content: string, entity: any, mode: PrintMode) => {
    let result = content;
    result = result.split('[SCHOOL_NAME]').join(SCHOOL_NAME);
    result = result.split('[ACADEMIC_YEAR]').join('2026-2027');
    result = result.split('[DATE]').join(new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Bahrain', month: 'long', day: 'numeric', year: 'numeric' }));
    result = result.split('[ENTITY_NAME]').join(entity.name);
    return result;
  };

  const renderPrintElement = (el: PrintElement, entity: any, mode: PrintMode) => {
    if (el.type === 'IMAGE') {
      return (
        <div key={el.id} style={{ textAlign: el.style.textAlign, marginTop: `${el.style.marginTop || 0}px`, marginBottom: `${el.style.marginBottom || 0}px`, display: 'flex', justifyContent: el.style.textAlign === 'center' ? 'center' : el.style.textAlign === 'right' ? 'flex-end' : 'flex-start' }}>
          <img src={el.content} crossOrigin="anonymous" style={{ width: `${el.style.width}px`, height: `${el.style.height}px`, objectFit: 'contain', opacity: el.style.opacity ?? 1, filter: el.style.grayscale ? 'grayscale(100%)' : 'none' }} alt="IHIS" />
        </div>
      );
    }
    return (
      <div key={el.id} style={{ fontSize: `${el.style.fontSize}px`, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, color: el.style.color, fontStyle: el.style.italic ? 'italic' : 'normal', textTransform: el.style.uppercase ? 'uppercase' : 'none', letterSpacing: el.style.tracking, marginTop: `${el.style.marginTop || 0}px`, marginBottom: `${el.style.marginBottom || 0}px`, whiteSpace: 'pre-wrap' }}>
        {injectContent(el.content, entity, mode)}
      </div>
    );
  };

  const renderSingleTimetable = (entity: { id: string, name: string, type: string }) => {
    const template = printConfig.templates[batchMode];
    const isC = entity.type === 'CLASS'; const isS = entity.type === 'STAFF'; 
    const sectObj = isC ? config.sections.find(s => s.id === entity.id) : null;
    const wingId = sectObj?.wingId || activeWingId;
    const wing = config.wings.find(w => w.id === wingId);
    const slots = (config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || []).filter(s => isC || !s.isBreak);
    const eidLower = entity.id.toLowerCase();
    
    const pageSizeMap: Record<string, {w: number, h: number}> = { 'a4': {w: 297, h: 210}, 'a3': {w: 420, h: 297}, 'letter': {w: 279.4, h: 215.9}, 'legal': {w: 355.6, h: 215.9} };
    const format = pageSizeMap[template.tableStyles.pageSize || 'a4'] || pageSizeMap['a4'];

    return (
      <div key={entity.id} className="pdf-page bg-white flex flex-col" style={{ width: `${format.w}mm`, height: `${format.h}mm`, padding: `${template.tableStyles.pageMargins}mm`, pageBreakAfter: 'always', boxSizing: 'border-box', position: 'relative' }}>
        <div className="mb-4 relative z-10 flex flex-col">{template.header.map(el => renderPrintElement(el, entity, batchMode))}</div>
        <div className="flex-1 flex flex-col items-center justify-center">
           <table className="border-collapse transition-all" style={{ width: `${template.tableStyles.tableWidthPercent}%`, tableLayout: 'fixed', border: `${template.tableStyles.borderWidth}px solid ${template.tableStyles.borderColor}` }}>
             <thead>
               <tr style={{ background: template.tableStyles.headerBg, color: template.tableStyles.headerTextColor }}>
                  <th style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, fontSize: `${template.tableStyles.fontSize}px`, width: '12%' }} className="font-black uppercase italic">Day</th>
                  {slots.map(s => (
                    <th key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, textAlign: 'center' }}>
                       <p style={{ fontSize: `${template.tableStyles.fontSize}px` }} className="font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p>
                       <p style={{ fontSize: `${template.tableStyles.fontSize - 2}px` }} className="font-bold opacity-60 mt-0.5">{s.startTime}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {DAYS.map((day, dIdx) => (
                   <tr key={day} style={{ height: `${template.tableStyles.rowHeight}mm`, backgroundColor: template.tableStyles.stripeRows && dIdx % 2 !== 0 ? '#f8fafc' : 'transparent' }}>
                      <td style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center', fontSize: `${template.tableStyles.fontSize}px` }} className="font-black uppercase bg-slate-50 italic">{day.substring(0,3)}</td>
                      {slots.map(s => {
                         if (s.isBreak) return <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center', fontSize: `${template.tableStyles.fontSize - 2}px` }} className="bg-amber-50 font-black text-amber-500 uppercase italic">Break</td>;
                         const entries = activeData.filter(t => t.day === day && t.slotId === s.id && !t.date && (isC ? (t.sectionId || '').toLowerCase() === eidLower : isS ? (t.teacherId || '').toLowerCase() === eidLower : (t.room || '').toLowerCase() === eidLower));
                         return (
                           <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, textAlign: 'center', position: 'relative' }}>
                              {entries.map(e => (
                                 <div key={e.id} className="space-y-0.5">
                                    <p style={{ fontSize: `${template.tableStyles.fontSize}px` }} className={`font-black uppercase text-[#001f3f]`}>{e.blockId ? e.blockName : e.subject}</p>
                                    {template.visibility.showTeacherName && <p style={{ fontSize: `${template.tableStyles.fontSize - 2}px` }} className="font-bold text-slate-500 italic leading-none">{isS ? e.className : e.teacherName}</p>}
                                 </div>
                              ))}
                           </td>
                         );
                      })}
                   </tr>
               ))}
             </tbody>
           </table>
        </div>
        <div className="mt-4 flex flex-col relative z-10">{template.footer.map(el => renderPrintElement(el, entity, batchMode))}</div>
      </div>
    );
  };

  const renderMasterMatrix = () => {
    const template = printConfig.templates.MASTER;
    const sects = config.sections.filter(s => s.wingId === activeWingId);
    const wSlots = (config.slotDefinitions?.[config.wings.find(w => w.id === activeWingId)?.sectionType || 'PRIMARY'] || []);
    const targetDate = currentWeekDates[selectedDay];
    const pageSizeMap: Record<string, {w: number, h: number}> = { 'a4': {w: 297, h: 210}, 'a3': {w: 420, h: 297}, 'letter': {w: 279.4, h: 215.9}, 'legal': {w: 355.6, h: 215.9} };
    const format = pageSizeMap[template.tableStyles.pageSize || 'a3'] || pageSizeMap['a3'];

    return (
      <div id="batch-render-zone" className="bg-white flex flex-col mx-auto" style={{ width: `${format.w}mm`, height: `${format.h}mm`, padding: `${template.tableStyles.pageMargins}mm`, boxSizing: 'border-box', position: 'relative' }}>
        <div className="mb-6 flex flex-col">{template.header.map(el => renderPrintElement(el, { name: `${selectedDay} (${targetDate})` }, 'MASTER'))}</div>
        <div className="flex-1 flex flex-col items-center justify-center">
           <table className="border-collapse" style={{ width: `${template.tableStyles.tableWidthPercent}%`, tableLayout: 'fixed', border: `${template.tableStyles.borderWidth}px solid ${template.tableStyles.borderColor}` }}>
             <thead>
               <tr style={{ background: template.tableStyles.headerBg, color: template.tableStyles.headerTextColor }}>
                  <th style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: '10px', width: '10%' }} className="text-xl font-black uppercase italic">Class</th>
                  {wSlots.map(s => (
                    <th key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: '10px', textAlign: 'center' }}>
                       <p style={{ fontSize: '18px' }} className="font-black uppercase leading-none">{s.label.replace('Period ', 'P')}</p>
                       <p style={{ fontSize: '12px' }} className="font-bold opacity-60 mt-1">{s.startTime}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {sects.map((sec, sIdx) => (
                   <tr key={sec.id} style={{ height: `${template.tableStyles.rowHeight}mm`, backgroundColor: template.tableStyles.stripeRows && sIdx % 2 !== 0 ? '#f8fafc' : 'transparent' }}>
                      <td style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center', background: '#f8fafc' }} className="font-black text-2xl uppercase italic text-[#001f3f]">{sec.fullName}</td>
                      {wSlots.map(s => {
                         if (s.isBreak) return <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center' }} className="bg-amber-50 text-xs font-black text-amber-500 uppercase italic">Break</td>;
                         const e = activeData.find(t => (t.sectionId || '').toLowerCase() === sec.id.toLowerCase() && t.day === selectedDay && t.slotId === s.id && !t.date);
                         return (
                           <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, textAlign: 'center' }}>
                              {e ? (
                                <div className="space-y-1">
                                   <p style={{ fontSize: '14px' }} className={`font-black uppercase text-[#001f3f]`}>{e.blockId ? e.blockName : e.subject}</p>
                                   {template.visibility.showTeacherName && <p style={{ fontSize: '10px' }} className="font-bold text-sky-600 italic uppercase leading-none">{e.teacherName}</p>}
                                </div>
                              ) : <span className="text-[10px] text-slate-100 uppercase font-black italic">Free</span>}
                           </td>
                         );
                      })}
                   </tr>
               ))}
             </tbody>
           </table>
        </div>
        <div className="mt-6 flex flex-col">{template.footer.map(el => renderPrintElement(el, { name: 'Master Matrix' }, 'MASTER'))}</div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 no-print">
        <div className="space-y-1 text-center md:text-left"><h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic tracking-tight leading-none">Batch <span className="text-[#d4af37]">Deployment</span></h1><p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Analytical Resource Packaging ({isDraftMode ? 'Draft' : 'Live'})</p></div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 shadow-sm">
             {(['CLASS', 'STAFF', 'ROOM', 'MASTER'] as PrintMode[]).map(m => {
                const isMasterView = m === 'MASTER';
                const isRestricted = isMasterView && !isManagement;
                return (
                  <button 
                    key={m} 
                    disabled={isRestricted}
                    onClick={() => { setBatchMode(m); setSelectedIds(isManagement ? [] : (m === 'STAFF' ? [currentUser.id] : (currentUser.classTeacherOf ? [currentUser.classTeacherOf] : []))); }} 
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${batchMode === m ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'} ${isRestricted ? 'opacity-20 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                  >
                    {m}
                  </button>
                );
             })}
          </div>
          
          <div className="flex gap-4">
            {batchMode === 'MASTER' && (
              <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white shadow-sm">
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select 
              value={activeWingId} 
              onChange={e => !userWingScope && setActiveWingId(e.target.value)} 
              className={`bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase outline-none dark:text-white shadow-sm ${!isAdmin && !isGlobalIncharge ? 'opacity-50 cursor-not-allowed' : ''}`} 
              disabled={!!userWingScope || !isManagement}
            >
              {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <button onClick={handleExportPDF} disabled={isExporting || (batchMode !== 'MASTER' && selectedIds.length === 0)} className="bg-rose-600 text-white px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 disabled:opacity-50 flex items-center gap-3 transition-all">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
             {isExporting ? 'Packaging...' : 'Export Matrix'}
          </button>
        </div>
      </div>

      {batchMode !== 'MASTER' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 no-print px-2">
          {entities.map(e => (
            <button 
              key={e.id} 
              onClick={() => isManagement && setSelectedIds(prev => prev.includes(e.id) ? prev.filter(i => i !== e.id) : [...prev, e.id])} 
              className={`p-5 rounded-[2rem] border-2 transition-all text-left ${selectedIds.includes(e.id) ? 'bg-[#001f3f] border-transparent shadow-lg' : 'bg-white dark:bg-slate-900 border-slate-50 dark:border-slate-800 shadow-sm'} ${!isManagement ? 'cursor-default' : ''}`}
            >
              <p className={`text-[10px] font-black uppercase truncate ${selectedIds.includes(e.id) ? 'text-amber-400' : 'text-[#001f3f] dark:text-white'}`}>{e.name}</p>
            </button>
          ))}
          {entities.length === 0 && (
             <div className="col-span-full py-10 text-center border-2 border-dashed border-slate-200 rounded-[2rem] opacity-30">
                <p className="text-[10px] font-black uppercase tracking-widest italic text-slate-400">No authorized entities in current category</p>
             </div>
          )}
        </div>
      )}
      
      <div className="overflow-x-auto scrollbar-hide pb-10">
        <div id="batch-render-zone" className="block mx-auto max-w-full">
           <div className="hidden md:block">
              {batchMode === 'MASTER' && isManagement ? renderMasterMatrix() : entities.filter(e => selectedIds.includes(e.id)).map(e => renderSingleTimetable(e))}
           </div>
           <div className="md:hidden flex flex-col items-center justify-center py-20 opacity-40 italic px-6 text-center">
              <svg className="w-12 h-12 text-[#001f3f] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 21h6l-.75-4M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              <p className="text-xs font-black uppercase tracking-widest">Desktop Required for Matrix Packaging</p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default BatchTimetableView;

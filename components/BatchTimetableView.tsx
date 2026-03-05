
import React, { useState, useMemo, useEffect } from 'react';
import { User, TimeTableEntry, SchoolConfig, SectionType, TimeSlot, UserRole, SubstitutionRecord, PrintConfig, PrintMode, PrintTemplate, PrintElement } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64, DAYS, DEFAULT_PRINT_CONFIG } from '../constants.ts';
import { getWeekDates } from '../utils/dateUtils.ts';
import { Search, CheckSquare, Square, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';

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

  const [searchQuery, setSearchQuery] = useState('');
  const [previewPage, setPreviewPage] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(0.8);

  const currentWeekDates = useMemo(() => getWeekDates(), []);
  const printConfig: PrintConfig = config.printConfig || DEFAULT_PRINT_CONFIG;

  const activeData = useMemo(() => {
    const data = isDraftMode ? timetableDraft : timetable;
    return data.length === 0 ? (!isDraftMode ? timetableDraft : timetable) : data;
  }, [isDraftMode, timetable, timetableDraft]);

  useEffect(() => {
    if (previewPage >= selectedIds.length && selectedIds.length > 0) {
      setPreviewPage(Math.max(0, selectedIds.length - 1));
    } else if (selectedIds.length === 0) {
      setPreviewPage(0);
    }
  }, [selectedIds.length, previewPage]);

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

  const filteredEntities = useMemo(() => {
    if (!searchQuery) return entities;
    return entities.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [entities, searchQuery]);

  const handleSelectAll = () => {
    const newIds = filteredEntities.map(e => e.id);
    setSelectedIds(Array.from(new Set([...selectedIds, ...newIds])));
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
    setPreviewPage(0);
  };

  const injectContent = (content: string, entity: any, mode: PrintMode, classTeacherName?: string) => {
    let result = content;
    result = result.split('[SCHOOL_NAME]').join(SCHOOL_NAME);
    result = result.split('[ACADEMIC_YEAR]').join('2026-2027');
    result = result.split('[DATE]').join(new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Bahrain', month: 'long', day: 'numeric', year: 'numeric' }));
    result = result.split('[ENTITY_NAME]').join(entity.name);
    result = result.split('[CLASS_TEACHER]').join(classTeacherName || 'Not Assigned');
    return result;
  };

  const renderPrintElement = (el: PrintElement, entity: any, mode: PrintMode, classTeacherName?: string) => {
    if (el.type === 'IMAGE') {
      return (
        <div key={el.id} style={{ textAlign: el.style.textAlign, marginTop: `${el.style.marginTop || 0}px`, marginBottom: `${el.style.marginBottom || 0}px`, display: 'flex', justifyContent: el.style.textAlign === 'center' ? 'center' : el.style.textAlign === 'right' ? 'flex-end' : 'flex-start' }}>
          <img src={el.content} crossOrigin="anonymous" style={{ width: `${el.style.width}px`, height: `${el.style.height}px`, objectFit: 'contain', opacity: el.style.opacity ?? 1, filter: el.style.grayscale ? 'grayscale(100%)' : 'none' }} alt="IHIS" />
        </div>
      );
    }
    return (
      <div key={el.id} style={{ fontSize: `${el.style.fontSize}px`, fontWeight: el.style.fontWeight, textAlign: el.style.textAlign, color: el.style.color, fontStyle: el.style.italic ? 'italic' : 'normal', textTransform: el.style.uppercase ? 'uppercase' : 'none', letterSpacing: el.style.tracking, marginTop: `${el.style.marginTop || 0}px`, marginBottom: `${el.style.marginBottom || 0}px`, whiteSpace: 'pre-wrap' }}>
        {injectContent(el.content, entity, mode, classTeacherName)}
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

    const classTeacher = isC ? users.find(u => u.classTeacherOf === entity.id) : null;

    const totalPeriods = (() => {
      const entries = activeData.filter(t => {
        if (t.date) return false;
        if (isS) {
          if ((t.teacherId || '').toLowerCase() === eidLower) return true;
          if ((t.secondaryTeacherId || '').toLowerCase() === eidLower) return true;
          if (t.blockId) {
            const block = config.combinedBlocks?.find(b => b.id === t.blockId);
            return block?.allocations.some(a => a.teacherId?.toLowerCase() === eidLower);
          }
        } else if (entity.type === 'ROOM') {
          if ((t.room || '').toLowerCase() === eidLower) return true;
          if (t.blockId) {
            const block = config.combinedBlocks?.find(b => b.id === t.blockId);
            return block?.allocations.some(a => a.room?.toLowerCase() === eidLower);
          }
        }
        return false;
      });
      const distinctEntries = (isS || entity.type === 'ROOM') 
        ? entries.filter((v, i, a) => {
           if (!v.blockId) return true;
           return a.findIndex(t => t.blockId === v.blockId && t.day === v.day && t.slotId === v.slotId) === i;
        })
        : entries;
      return distinctEntries.length;
    })();

    return (
      <div key={entity.id} className="pdf-page bg-white flex flex-col" style={{ width: `${format.w}mm`, height: `${format.h}mm`, padding: `${template.tableStyles.pageMargins}mm`, pageBreakAfter: 'always', boxSizing: 'border-box', position: 'relative', fontFamily: '"Times New Roman", Times, serif' }}>
        <div className="mb-4 relative z-10 flex flex-col">
          {template.header.map(el => renderPrintElement(el, entity, batchMode, classTeacher?.name))}
          {(isS || entity.type === 'ROOM') && (
            <div style={{ fontSize: '10px', fontWeight: '900', textTransform: 'uppercase', marginTop: '4px', color: '#001f3f', fontStyle: 'italic', borderTop: '1px dashed #e2e8f0', paddingTop: '4px' }}>
              Total Weekly Periods: {totalPeriods}
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
           <table className="border-collapse transition-all" style={{ width: `${template.tableStyles.tableWidthPercent}%`, tableLayout: 'fixed', border: `${template.tableStyles.borderWidth}px solid ${template.tableStyles.borderColor}` }}>
             <thead>
               <tr style={{ background: template.tableStyles.headerBg, color: template.tableStyles.headerTextColor }}>
                  <th style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, fontSize: `${template.tableStyles.fontSize + (isC ? 4 : 0)}px`, width: '12%' }} className="font-black uppercase italic">Day</th>
                  {slots.map(s => (
                    <th key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, textAlign: 'center' }}>
                       <p style={{ fontSize: `${template.tableStyles.fontSize + (isC ? 4 : 0)}px` }} className="font-black uppercase leading-none">{s.label.toUpperCase()}</p>
                       <p style={{ fontSize: `${template.tableStyles.fontSize - 2 + (isC ? 4 : 0)}px` }} className="font-bold opacity-60 mt-0.5">{s.startTime} - {s.endTime}</p>
                    </th>
                  ))}
               </tr>
             </thead>
             <tbody>
               {DAYS.map((day, dIdx) => (
                   <tr key={day} style={{ height: `${template.tableStyles.rowHeight}mm`, backgroundColor: template.tableStyles.stripeRows && dIdx % 2 !== 0 ? '#f8fafc' : 'transparent' }}>
                      <td style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center', fontSize: `${template.tableStyles.fontSize + (isC ? 4 : 0)}px` }} className="font-black uppercase bg-slate-50 italic">{day.substring(0,3)}</td>
                      {slots.map(s => {
                         if (s.isBreak) return <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, textAlign: 'center', fontSize: `${template.tableStyles.fontSize - 2 + (isC ? 4 : 0)}px` }} className="bg-amber-50 font-black text-amber-500 uppercase italic">Break</td>;
                         const entries = activeData.filter(t => {
                            if (t.day !== day || t.slotId !== s.id || t.date) return false;
                            
                            if (isC) return (t.sectionId || '').toLowerCase() === eidLower;
                            if (isS) {
                              if ((t.teacherId || '').toLowerCase() === eidLower) return true;
                              if ((t.secondaryTeacherId || '').toLowerCase() === eidLower) return true;
                              if (t.blockId) {
                                const block = config.combinedBlocks?.find(b => b.id === t.blockId);
                                return block?.allocations.some(a => a.teacherId?.toLowerCase() === eidLower);
                              }
                              return false;
                            }
                            if (entity.type === 'ROOM') {
                              if ((t.room || '').toLowerCase() === eidLower) return true;
                              if (t.blockId) {
                                const block = config.combinedBlocks?.find(b => b.id === t.blockId);
                                return block?.allocations.some(a => a.room?.toLowerCase() === eidLower);
                              }
                              return false;
                            }
                            return false;
                         });

                         // For Teacher/Room view, we might have multiple entries for the same block (one per section)
                         // We should distinct them by blockId
                         const distinctEntries = (isS || entity.type === 'ROOM') 
                           ? entries.filter((v, i, a) => {
                              if (!v.blockId) return true;
                              return a.findIndex(t => t.blockId === v.blockId) === i;
                           })
                           : entries;

                         return (
                           <td key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: `${template.tableStyles.cellPadding}px`, textAlign: 'center', position: 'relative' }}>
                              {distinctEntries.map(e => {
                                 const block = e.blockId ? config.combinedBlocks?.find(b => b.id === e.blockId) : null;
                                 let displaySubject = block ? block.heading : e.subject;
                                 let displaySubtext = isS ? e.className : e.teacherName;
                                 let displayRoom = e.room;

                                 // Lab Technician View
                                 if (isS && (e.secondaryTeacherId || '').toLowerCase() === eidLower) {
                                    displaySubject = `${e.subject} (Lab)`;
                                    displaySubtext = `${e.className} w/ ${e.teacherName}`;
                                 }

                                 if (block) {
                                   if (isS) {
                                     const alloc = block.allocations.find(a => a.teacherId?.toLowerCase() === eidLower);
                                     if (alloc) {
                                       displaySubject = alloc.subject;
                                       displayRoom = alloc.room || 'Pool';
                                     }
                                   } else if (entity.type === 'ROOM') {
                                     const alloc = block.allocations.find(a => a.room?.toLowerCase() === eidLower);
                                     if (alloc) {
                                       displaySubject = alloc.subject;
                                       displaySubtext = alloc.teacherName;
                                     }
                                   } else if (isC) {
                                     displaySubtext = '';
                                   }
                                 }

                                 return (
                                   <div key={e.id} className="flex flex-col items-center justify-center gap-1 w-full">
                                      <div style={{ backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '4px', width: '100%', boxSizing: 'border-box', wordBreak: 'break-word' }}>
                                        <p style={{ fontSize: `${template.tableStyles.fontSize + (isC ? 4 : 0)}px`, lineHeight: '1.2' }} className={`font-black uppercase text-[#001f3f]`}>{displaySubject}</p>
                                      </div>
                                      {template.visibility.showTeacherName && displaySubtext && <p style={{ fontSize: `${Math.max(8, template.tableStyles.fontSize - 1 + (isC ? 4 : 0))}px`, lineHeight: '1.2' }} className="font-bold text-slate-600 italic">{displaySubtext}</p>}
                                      {template.visibility.showRoom && displayRoom && <p style={{ fontSize: `${Math.max(7, template.tableStyles.fontSize - 2 + (isC ? 4 : 0))}px`, lineHeight: '1.2' }} className="font-black text-sky-700 uppercase mt-0.5">{displayRoom}</p>}
                                   </div>
                                 );
                              })}
                           </td>
                         );
                      })}
                   </tr>
               ))}
             </tbody>
           </table>
        </div>
        <div className="mt-4 flex flex-col relative z-10">{template.footer.map(el => renderPrintElement(el, entity, batchMode, classTeacher?.name))}</div>
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
      <div className="pdf-page bg-white flex flex-col mx-auto" style={{ width: `${format.w}mm`, height: `${format.h}mm`, padding: `${template.tableStyles.pageMargins}mm`, boxSizing: 'border-box', position: 'relative', fontFamily: '"Times New Roman", Times, serif' }}>
        <div className="mb-6 flex flex-col">{template.header.map(el => renderPrintElement(el, { name: `${selectedDay} (${targetDate})` }, 'MASTER'))}</div>
        <div className="flex-1 flex flex-col items-center justify-center">
           <table className="border-collapse" style={{ width: `${template.tableStyles.tableWidthPercent}%`, tableLayout: 'fixed', border: `${template.tableStyles.borderWidth}px solid ${template.tableStyles.borderColor}` }}>
             <thead>
               <tr style={{ background: template.tableStyles.headerBg, color: template.tableStyles.headerTextColor }}>
                  <th style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: '10px', width: '10%' }} className="text-xl font-black uppercase italic">Class</th>
                  {wSlots.map(s => (
                    <th key={s.id} style={{ border: `1px solid ${template.tableStyles.borderColor}`, padding: '10px', textAlign: 'center' }}>
                       <p style={{ fontSize: '18px' }} className="font-black uppercase leading-none">{s.label.toUpperCase()}</p>
                       <p style={{ fontSize: '12px' }} className="font-bold opacity-60 mt-1">{s.startTime} - {s.endTime}</p>
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
                               <div className="flex flex-col items-center justify-center gap-1.5 w-full">
                                  <div style={{ backgroundColor: '#f8fafc', padding: '4px', borderRadius: '6px', width: '100%', boxSizing: 'border-box', wordBreak: 'break-word', border: '1px solid #e2e8f0' }}>
                                    <p style={{ fontSize: '15px', lineHeight: '1.2' }} className={`font-black uppercase text-[#001f3f]`}>{e.subject}</p>
                                  </div>
                                  {template.visibility.showTeacherName && <p style={{ fontSize: '11px', lineHeight: '1.2' }} className="font-bold text-sky-700 italic uppercase">{e.teacherName}</p>}
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

  const renderMobileView = () => {
    if (batchMode === 'MASTER') return <div className="p-6 text-center text-slate-500 italic">Master matrix is too large for mobile viewing. Please export to PDF or use a desktop device.</div>;
    
    const activeEntityId = selectedIds[previewPage];
    if (!activeEntityId) return <div className="p-6 text-center text-slate-500 italic">No entity selected.</div>;
    
    const entity = entities.find(e => e.id === activeEntityId);
    if (!entity) return null;
    
    const isC = entity.type === 'CLASS';
    const isS = entity.type === 'STAFF';
    const eidLower = entity.id.toLowerCase();
    const wingId = isC ? config.sections.find(s => s.id === entity.id)?.wingId || activeWingId : activeWingId;
    const wing = config.wings.find(w => w.id === wingId);
    const slots = (config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || []).filter(s => isC || !s.isBreak);

    return (
      <div className="flex flex-col gap-6 p-4">
        <div className="bg-[#001f3f] text-white p-6 rounded-3xl shadow-lg">
          <h2 className="text-xl font-black uppercase">{entity.name}</h2>
          <p className="text-sm text-amber-400 font-bold mt-1">{entity.type}</p>
        </div>
        
        {DAYS.map(day => {
          const dayEntries = activeData.filter(t => {
            if (t.day !== day || t.date) return false;
            if (isC) return (t.sectionId || '').toLowerCase() === eidLower;
            if (isS) {
              if ((t.teacherId || '').toLowerCase() === eidLower) return true;
              if (t.blockId) {
                const block = config.combinedBlocks?.find(b => b.id === t.blockId);
                return block?.allocations.some(a => a.teacherId?.toLowerCase() === eidLower);
              }
              return false;
            }
            if (entity.type === 'ROOM') {
              if ((t.room || '').toLowerCase() === eidLower) return true;
              if (t.blockId) {
                const block = config.combinedBlocks?.find(b => b.id === t.blockId);
                return block?.allocations.some(a => a.room?.toLowerCase() === eidLower);
              }
              return false;
            }
            return false;
          });
          
          if (dayEntries.length === 0) return null;

          return (
            <div key={day} className="bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-[#001f3f] dark:text-white uppercase mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">{day}</h3>
              <div className="flex flex-col gap-3">
                {slots.map(s => {
                  if (s.isBreak) return null;
                  const slotEntries = dayEntries.filter(e => e.slotId === s.id);
                  if (slotEntries.length === 0) return null;
                  
                  const distinctEntries = (isS || entity.type === 'ROOM') 
                    ? slotEntries.filter((v, i, a) => {
                       if (!v.blockId) return true;
                       return a.findIndex(t => t.blockId === v.blockId) === i;
                    })
                    : slotEntries;

                  return (
                    <div key={s.id} className="flex gap-4 items-center bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl">
                      <div className="flex flex-col items-center justify-center min-w-[60px] border-r border-slate-200 dark:border-slate-700 pr-4">
                        <span className="text-xs font-black text-slate-400 uppercase">{s.label}</span>
                        <span className="text-[10px] font-bold text-slate-500">{s.startTime}</span>
                      </div>
                      <div className="flex-1 flex flex-col gap-2">
                        {distinctEntries.map(e => {
                          const block = e.blockId ? config.combinedBlocks?.find(b => b.id === e.blockId) : null;
                          let displaySubject = block ? block.heading : e.subject;
                          let displaySubtext = isS ? e.className : e.teacherName;
                          let displayRoom = e.room;

                          if (block) {
                            if (isS) {
                              const alloc = block.allocations.find(a => a.teacherId?.toLowerCase() === eidLower);
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displayRoom = alloc.room || 'Pool';
                              }
                            } else if (entity.type === 'ROOM') {
                              const alloc = block.allocations.find(a => a.room?.toLowerCase() === eidLower);
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displaySubtext = alloc.teacherName;
                              }
                            } else if (isC) {
                              displaySubtext = '';
                            }
                          }
                          return (
                            <div key={e.id} className="flex flex-col">
                              <span className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{displaySubject}</span>
                              {!isC && (
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mt-0.5">
                                  {displaySubtext && <span>{displaySubtext}</span>}
                                  {displaySubtext && displayRoom && <span>•</span>}
                                  {displayRoom && <span className="text-sky-600">{displayRoom}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
                    className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase transition-all ${batchMode === m ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'} ${isRestricted ? 'opacity-20 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                  >
                    {m}
                  </button>
                );
             })}
          </div>
          
          <div className="flex gap-4">
            {batchMode === 'MASTER' && (
              <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs font-black uppercase outline-none dark:text-white shadow-sm">
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select 
              value={activeWingId} 
              onChange={e => !userWingScope && setActiveWingId(e.target.value)} 
              className={`bg-white dark:bg-slate-900 px-5 py-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs font-black uppercase outline-none dark:text-white shadow-sm ${!isAdmin && !isGlobalIncharge ? 'opacity-50 cursor-not-allowed' : ''}`} 
              disabled={!!userWingScope || !isManagement}
            >
              {accessibleWings.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {batchMode !== 'MASTER' && (
        <div className="flex flex-col gap-4 no-print px-2">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search entities..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white" />
            </div>
            {isManagement && (
              <div className="flex gap-2 w-full md:w-auto">
                <button onClick={handleSelectAll} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors"><CheckSquare className="w-4 h-4" /> Select All</button>
                <button onClick={handleClearSelection} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors"><Square className="w-4 h-4" /> Clear</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-64 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
            {filteredEntities.map(e => (
              <button 
                key={e.id} 
                onClick={() => isManagement && setSelectedIds(prev => prev.includes(e.id) ? prev.filter(i => i !== e.id) : [...prev, e.id])} 
                className={`p-3 rounded-xl border-2 transition-all text-left flex items-center justify-between ${selectedIds.includes(e.id) ? 'bg-[#001f3f] border-[#001f3f] shadow-md' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'} ${!isManagement ? 'cursor-default' : ''}`}
              >
                <p className={`text-xs font-bold truncate ${selectedIds.includes(e.id) ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>{e.name}</p>
              </button>
            ))}
            {filteredEntities.length === 0 && (
               <div className="col-span-full py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl opacity-50">
                  <p className="text-xs font-black uppercase tracking-widest italic text-slate-400">No entities found</p>
               </div>
            )}
          </div>
        </div>
      )}
      
      <div className="flex flex-col gap-4 mt-8">
        
        <div className="overflow-x-auto scrollbar-hide pb-10">
          <div id="batch-render-zone" className="block mx-auto max-w-full origin-top transition-transform" style={{ transform: batchMode !== 'MASTER' ? `scale(${zoomLevel})` : 'none' }}>
             <div className="block md:block">
                {batchMode === 'MASTER' && isManagement 
                  ? renderMasterMatrix() 
                  : entities.filter(e => selectedIds.includes(e.id)).map(e => (
                      <div key={e.id} className="pdf-page mb-24">
                        {renderSingleTimetable(e)}
                      </div>
                    ))
                }
             </div>
             <div className="md:hidden">
                {renderMobileView()}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchTimetableView;

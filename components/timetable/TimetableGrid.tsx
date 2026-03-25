import React from 'react';
import { Lock } from 'lucide-react';
import { TimeTableEntry, TimeSlot, SchoolConfig, SectionType } from '../../types';
import { DAYS, PRIMARY_SLOTS, SECONDARY_BOYS_SLOTS, SECONDARY_GIRLS_SLOTS } from '../../constants';

interface TimetableGridProps {
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
  selectedTargetId: string;
  displayedSlots: TimeSlot[];
  activeData: TimeTableEntry[];
  config: SchoolConfig;
  compactMode: boolean;
  isDraftMode: boolean;
  isManagement: boolean;
  swapSource: any;
  clashMap: Record<string, string>;
  isCellLocked: (day: string, slotId: number, targetId: string) => boolean;
  isSwapMode: boolean;
  cellNotes: Record<string, string>;
  isOnlineView?: boolean;
  dragOverTarget: { day: string, slotId: number } | null;
  handleCellClick: (day: string, slotId: number, entryId?: string) => void;
  handleContextMenu: (e: React.MouseEvent, day: string, slotId: number, entryId?: string) => void;
  onDragStart: (e: React.DragEvent, day: string, slotId: number, entryId?: string) => void;
  onDragOver: (e: React.DragEvent, day: string, slotId: number) => void;
  onDrop: (e: React.DragEvent, day: string, slotId: number) => void;
  getCellColor: (entries: TimeTableEntry[]) => string;
}

export const TimetableGrid: React.FC<TimetableGridProps> = ({
  viewMode,
  selectedTargetId,
  displayedSlots,
  activeData,
  config,
  compactMode,
  isDraftMode,
  isManagement,
  swapSource,
  clashMap,
  isCellLocked,
  isSwapMode,
  cellNotes,
  isOnlineView,
  dragOverTarget,
  handleCellClick,
  handleContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  getCellColor,
}) => {
  return (
    <div className="hidden md:block overflow-x-auto rounded-[2.5rem] border-8 border-white dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900">
      <table className="w-full border-collapse table-fixed min-w-[1000px]">
        <thead>
          <tr className="bg-slate-50/50 dark:bg-slate-800/30">
            <th className="w-24 p-6 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-col items-center justify-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Day</span>
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Slot</span>
              </div>
            </th>
            {displayedSlots.map(slot => (
              <th key={slot.id} className="p-6 border-b border-slate-100 dark:border-slate-800 text-center">
                <div className="flex flex-col items-center justify-center gap-1">
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{slot.label}</span>
                  {viewMode === 'SECTION' && <span className="text-[13px] font-black text-[#001f3f] dark:text-white tabular-nums">{slot.startTime}</span>}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map(day => (
            <tr key={day} className="group">
              <td className="p-6 bg-slate-50/30 dark:bg-slate-800/20 border-r border-slate-100 dark:border-slate-800 text-center align-middle">
                <p className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase tracking-tighter rotate-[-90deg] origin-center whitespace-nowrap">{day}</p>
              </td>
              {displayedSlots.map(slot => {
                const cellEntries = activeData.filter(e => {
                  if (e.day !== day || e.slotId !== slot.id) return false;
                  const targetIdLower = selectedTargetId?.toLowerCase().trim();
                  if (viewMode === 'SECTION') return e.sectionId?.toLowerCase().trim() === targetIdLower;
                  if (viewMode === 'TEACHER') {
                    if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
                    if (e.secondaryTeacherId?.toLowerCase().trim() === targetIdLower) return true;
                    if (e.blockId) {
                      const block = config.combinedBlocks?.find(b => b.id === e.blockId) || config.labBlocks?.find(b => b.id === e.blockId);
                      return block?.allocations.some(a => a.teacherId?.toLowerCase().trim() === targetIdLower);
                    }
                    return false;
                  }
                  if (viewMode === 'ROOM') {
                    if (e.room?.toLowerCase().trim() === targetIdLower) return true;
                    if (e.blockId) {
                      const block = config.combinedBlocks?.find(b => b.id === e.blockId) || config.labBlocks?.find(b => b.id === e.blockId);
                      return block?.allocations.some(a => a.room?.toLowerCase().trim() === targetIdLower);
                    }
                    return false;
                  }
                  return false;
                });

                const distinctEntries = cellEntries.filter((v, i, a) => {
                   if (!v.blockId) return true;
                   return a.findIndex(t => t.blockId === v.blockId) === i;
                });

                const isSource = swapSource && !swapSource.isFromParkingLot && swapSource.day === day && swapSource.slotId === slot.id;
                const clashReason = clashMap[`${day}-${slot.id}`];
                const isLocked = viewMode === 'SECTION' && isCellLocked(day, slot.id, selectedTargetId);
                const isValidDrop = isSwapMode && swapSource && !isSource && !slot.isBreak && !clashReason && !isLocked;
                const cellNoteKey = `${viewMode}-${selectedTargetId}-${day}-${slot.id}`;
                const hasNote = !!cellNotes[cellNoteKey];

                return (
                  <td 
                    key={slot.id} 
                    onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
                    onContextMenu={(e) => handleContextMenu(e, day, slot.id, distinctEntries[0]?.id)}
                    onDragOver={(e) => onDragOver(e, day, slot.id)}
                    onDrop={(e) => onDrop(e, day, slot.id)}
                    className={`border border-slate-200 dark:border-slate-800 relative transition-all ${compactMode ? 'p-2 min-h-[60px]' : 'p-4 min-h-[100px]'} ${
                      slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10' : 
                      isSource ? 'bg-indigo-100 ring-2 ring-indigo-500' : 
                      dragOverTarget?.day === day && dragOverTarget?.slotId === slot.id ? 'bg-indigo-50 ring-2 ring-indigo-400' :
                      clashReason ? 'bg-rose-50/60 dark:bg-rose-900/20' : 
                      isLocked ? 'bg-slate-100/80 dark:bg-slate-800/80' :
                      isValidDrop ? 'bg-emerald-50/40 dark:bg-emerald-900/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 cursor-pointer border-emerald-200 dark:border-emerald-800' :
                      getCellColor(distinctEntries) || 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer'
                    } shadow-sm rounded-xl`}
                  >
                    <div 
                      draggable={!slot.isBreak && distinctEntries.length > 0 && isDraftMode && isManagement}
                      onDragStart={(e) => onDragStart(e, day, slot.id, distinctEntries[0]?.id)}
                      className={`w-full h-full flex flex-col justify-center ${!slot.isBreak && distinctEntries.length > 0 && isDraftMode && isManagement ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      {hasNote && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full shadow-sm" title={cellNotes[cellNoteKey]} />
                      )}
                      {isLocked && !slot.isBreak && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none overflow-hidden">
                          <Lock className="w-24 h-24 rotate-12" />
                        </div>
                      )}
                      {isLocked && !slot.isBreak && (
                        <div className="absolute top-1 left-1 z-10" title="This period is locked">
                          <Lock className="w-2.5 h-2.5 text-slate-400" />
                        </div>
                      )}
                      {clashReason && (
                        <div className="absolute top-1 right-1 z-10" title={clashReason}>
                          <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></div>
                        </div>
                      )}
                      {slot.isBreak ? (
                        <div className="text-center"><p className="text-[11px] font-black text-amber-600 dark:text-amber-400 uppercase italic">Recess</p></div>
                      ) : distinctEntries.length > 0 ? (
                        distinctEntries.map(e => {
                          let displaySubject = e.subject;
                          let displaySubtext = viewMode === 'TEACHER' ? e.className : e.teacherName;
                          if (e.secondaryTeacherName && viewMode !== 'TEACHER') {
                            displaySubtext = `${e.teacherName} + ${e.secondaryTeacherName}`;
                          }
                          let displayRoom = e.room;
                          let displayClass = e.className;

                          if (viewMode === 'TEACHER' && e.secondaryTeacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim()) {
                             displaySubject = `${e.subject} (Lab)`;
                             displaySubtext = `${e.className} w/ ${e.teacherName}`;
                          }

                          const entryWing = config.wings.find(w => w.id === e.wingId);
                          const wingLabel = entryWing ? (entryWing.name.includes('Boys') ? 'B' : entryWing.name.includes('Girls') ? 'G' : 'P') : '';

                          const wingSlots = isOnlineView 
                            ? (config.onlineSlotDefinitions?.[entryWing?.sectionType || 'PRIMARY'] || [])
                            : (entryWing ? (config.slotDefinitions?.[entryWing.sectionType] || PRIMARY_SLOTS) : PRIMARY_SLOTS);
                          
                          const actualSlot = wingSlots.find(s => s.id === e.slotId);
                          const actualTime = actualSlot ? `${actualSlot.startTime} - ${actualSlot.endTime}` : '';

                          if (e.blockId) {
                            const block = config.combinedBlocks?.find(b => b.id === e.blockId) || config.labBlocks?.find(b => b.id === e.blockId);
                            if (viewMode === 'TEACHER') {
                              const alloc = block?.allocations.find(a => a.teacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displayRoom = alloc.room || 'Pool';
                                displaySubtext = (block as any)?.heading || block?.title || e.className;
                              }
                            } else if (viewMode === 'ROOM') {
                              const alloc = block?.allocations.find(a => a.room?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                              if (alloc) {
                                displaySubject = alloc.subject;
                                displaySubtext = (alloc as any).teacherName || e.teacherName;
                                displayClass = cellEntries
                                  .filter(ce => ce.blockId === e.blockId)
                                  .map(ce => ce.className)
                                  .join(' + ');
                              }
                            } else if (viewMode === 'SECTION') {
                              if (block) {
                                displaySubject = (block as any).heading || block.title || 'Group Period';
                                const uniqueSubjects = Array.from(new Set(block.allocations.map(a => a.subject)));
                                displaySubtext = uniqueSubjects.join(' / ');
                              }
                            }
                          }

                          return (
                            <div key={e.id} className="space-y-1.5 text-center relative">
                              <div className="flex flex-col items-center justify-center gap-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase leading-tight break-words whitespace-normal">{displaySubject}</p>
                                  {(viewMode === 'TEACHER' || viewMode === 'ROOM') && wingLabel && (
                                    <span className={`px-1 rounded-[4px] text-[7px] font-black leading-none py-0.5 border ${wingLabel === 'B' ? 'bg-sky-50 text-sky-600 border-sky-100' : wingLabel === 'G' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`} title={entryWing?.name}>
                                      {wingLabel}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[8px] font-bold text-slate-400 uppercase leading-tight break-words whitespace-normal">{displaySubtext}</p>
                                {(viewMode === 'TEACHER' || viewMode === 'ROOM') && actualTime && (
                                  <p className="text-[7.5px] font-black text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300 px-1 py-0.5 rounded uppercase leading-tight mt-0.5 inline-block border border-indigo-100 dark:border-indigo-800">{actualTime}</p>
                                )}
                                {viewMode === 'ROOM' && <p className="text-[7px] font-black text-amber-500 uppercase leading-tight break-words whitespace-normal mt-1">{displayClass}</p>}
                              </div>
                              {viewMode !== 'ROOM' && <p className="text-[7px] font-black text-sky-500 uppercase italic opacity-70 leading-tight break-words whitespace-normal">{displayRoom}</p>}
                              {e.isManual && <div className="w-1 h-1 bg-amber-400 rounded-full mx-auto" title="Manual Entry"></div>}
                            </div>
                          );
                        })
                      ) : isDraftMode && isManagement ? (
                        <div className="flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-[18px] text-amber-400 font-black">+</span>
                        </div>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

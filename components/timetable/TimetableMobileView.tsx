import React from 'react';
import { Lock } from 'lucide-react';
import { TimeTableEntry, TimeSlot, SchoolConfig, SectionType } from '../../types';
import { DAYS } from '../../constants';

interface TimetableMobileViewProps {
  selectedDayMobile: string;
  setSelectedDayMobile: (day: string) => void;
  displayedSlots: TimeSlot[];
  activeData: TimeTableEntry[];
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
  selectedTargetId: string;
  config: SchoolConfig;
  isDraftMode: boolean;
  isManagement: boolean;
  swapSource: any;
  clashMap: Record<string, string>;
  isCellLocked: (day: string, slotId: number, targetId: string) => boolean;
  isSwapMode: boolean;
  cellNotes: Record<string, string>;
  handleCellClick: (day: string, slotId: number, entryId?: string) => void;
  handleContextMenu: (e: React.MouseEvent, day: string, slotId: number) => void;
}

export const TimetableMobileView: React.FC<TimetableMobileViewProps> = ({
  selectedDayMobile,
  setSelectedDayMobile,
  displayedSlots,
  activeData,
  viewMode,
  selectedTargetId,
  config,
  isDraftMode,
  isManagement,
  swapSource,
  clashMap,
  isCellLocked,
  isSwapMode,
  cellNotes,
  handleCellClick,
  handleContextMenu,
}) => {
  return (
    <div className="md:hidden space-y-6">
      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
        {DAYS.map(day => (
          <button 
            key={day} 
            onClick={() => setSelectedDayMobile(day)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${selectedDayMobile === day ? 'bg-[#001f3f] text-[#d4af37] shadow-lg scale-105' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border border-slate-100 dark:border-slate-700'}`}
          >
            {day}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {displayedSlots.map(slot => {
          const day = selectedDayMobile;
          const cellEntries = activeData.filter(e => {
            if (e.day !== day || e.slotId !== slot.id) return false;
            const targetIdLower = selectedTargetId?.toLowerCase().trim();
            if (viewMode === 'SECTION') return e.sectionId?.toLowerCase().trim() === targetIdLower;
            if (viewMode === 'TEACHER') {
              if (e.teacherId?.toLowerCase().trim() === targetIdLower) return true;
              if (e.blockId) {
                const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                return block?.allocations.some(a => a.teacherId?.toLowerCase().trim() === targetIdLower);
              }
              return false;
            }
            if (viewMode === 'ROOM') {
              if (e.room?.toLowerCase().trim() === targetIdLower) return true;
              if (e.blockId) {
                const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                return block?.allocations.some(a => a.room?.toLowerCase().trim() === targetIdLower);
              }
              return false;
            }
            return false;
          });

          const distinctEntries = (viewMode === 'TEACHER' || viewMode === 'ROOM') 
            ? cellEntries.filter((v, i, a) => {
               if (!v.blockId) return true;
               return a.findIndex(t => t.blockId === v.blockId) === i;
            })
            : cellEntries;

          const isSource = swapSource && !swapSource.isFromParkingLot && swapSource.day === day && swapSource.slotId === slot.id;
          const clashReason = clashMap[`${day}-${slot.id}`];
          const isLocked = viewMode === 'SECTION' && isCellLocked(day, slot.id, selectedTargetId);
          const isValidDrop = isSwapMode && swapSource && !isSource && !slot.isBreak && !clashReason && !isLocked;
          const cellNoteKey = `${viewMode}-${selectedTargetId}-${day}-${slot.id}`;
          const hasNote = !!cellNotes[cellNoteKey];

          return (
            <div 
              key={slot.id} 
              onClick={() => handleCellClick(day, slot.id, distinctEntries[0]?.id)}
              onContextMenu={(e) => handleContextMenu(e, day, slot.id)}
              className={`p-5 rounded-[2rem] border relative transition-all ${
                slot.isBreak ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-300 dark:border-amber-700' : 
                isSource ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500' : 
                clashReason ? 'bg-rose-50 border-rose-200' : 
                isLocked ? 'bg-slate-100/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700' :
                isValidDrop ? 'bg-emerald-50/40 dark:bg-emerald-900/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 cursor-pointer border-emerald-200 dark:border-emerald-800' :
                'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm'
              }`}
            >
              {hasNote && (
                <div className="absolute top-2 right-2 w-2.5 h-2.5 bg-amber-400 rounded-full shadow-sm" title={cellNotes[cellNoteKey]} />
              )}
              {isLocked && !slot.isBreak && (
                <div className="absolute top-4 right-4 z-10">
                  <Lock className="w-3 h-3 text-slate-400" />
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{slot.label}</span>
                  <span className="text-[13px] font-black text-[#001f3f] dark:text-white tabular-nums">{slot.startTime} - {slot.endTime}</span>
                </div>
                {clashReason && <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></div>}
              </div>

              {slot.isBreak ? (
                <p className="text-center text-[12px] font-black text-amber-600 dark:text-amber-400 uppercase italic py-2">Recess Break</p>
              ) : distinctEntries.length > 0 ? (
                <div className="space-y-3">
                  {distinctEntries.map(e => {
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

                    if (e.blockId) {
                      const block = config.combinedBlocks?.find(b => b.id === e.blockId);
                      if (viewMode === 'TEACHER') {
                        const alloc = block?.allocations.find(a => a.teacherId?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                        if (alloc) {
                          displaySubject = alloc.subject;
                          displayRoom = alloc.room || 'Pool';
                        }
                      } else if (viewMode === 'ROOM') {
                        const alloc = block?.allocations.find(a => a.room?.toLowerCase().trim() === selectedTargetId?.toLowerCase().trim());
                        if (alloc) {
                          displaySubject = alloc.subject;
                          displaySubtext = alloc.teacherName;
                          displayClass = cellEntries
                            .filter(ce => ce.blockId === e.blockId)
                            .map(ce => ce.className)
                            .join(' + ');
                        }
                      }
                    }

                    return (
                      <div key={e.id} className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase leading-tight break-words whitespace-normal">{displaySubject}</p>
                            {(viewMode === 'TEACHER' || viewMode === 'ROOM') && wingLabel && (
                              <span className={`px-1.5 rounded-[4px] text-[8px] font-black leading-none py-0.5 border ${wingLabel === 'B' ? 'bg-sky-50 text-sky-600 border-sky-100' : wingLabel === 'G' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                {wingLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase leading-tight break-words whitespace-normal mt-1">{displaySubtext}</p>
                          {viewMode === 'ROOM' && <p className="text-[9px] font-black text-amber-500 uppercase leading-tight break-words whitespace-normal mt-1">{displayClass}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black text-sky-500 uppercase italic leading-tight break-words whitespace-normal">{displayRoom}</p>
                          {e.isManual && <p className="text-[7px] font-black text-amber-500 uppercase mt-1">Manual</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : isDraftMode && isManagement ? (
                <div className="flex items-center justify-center py-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl">
                  <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">+ Assign Class</span>
                </div>
              ) : (
                <p className="text-center text-[9px] font-black text-slate-300 uppercase italic py-2">Free Period</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

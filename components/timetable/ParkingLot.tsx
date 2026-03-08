import React from 'react';
import { Trash2, AlertCircle, Info, Move, Sparkles } from 'lucide-react';
import { ParkedItem, TimeTableEntry } from '../../types';

interface ParkingLotProps {
  parkedEntries: ParkedItem[];
  setParkedEntries: (val: ParkedItem[] | ((prev: ParkedItem[]) => ParkedItem[])) => void;
  isDraftMode: boolean;
  isManagement: boolean;
  onDragStart: (e: React.DragEvent, day: string, slotId: number, entryId?: string, isFromParkingLot?: boolean, parkedItemId?: string) => void;
  setSwapSource: (val: any) => void;
  isSwapMode: boolean;
  swapSource: any;
}

export const ParkingLot: React.FC<ParkingLotProps> = ({
  parkedEntries,
  setParkedEntries,
  isDraftMode,
  isManagement,
  onDragStart,
  setSwapSource,
  isSwapMode,
  swapSource,
}) => {
  if (!isDraftMode || !isManagement || parkedEntries.length === 0) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-8">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border-4 border-rose-400/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Trash2 className="w-24 h-24 text-rose-400" />
        </div>

        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-6">
            <div className="p-5 rounded-[2rem] bg-rose-500 text-white shadow-xl">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">The Parking Lot</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 flex items-center gap-2">
                <Info className="w-3 h-3 text-rose-500" /> {parkedEntries.length} Unplaced Instructional Blocks
              </p>
            </div>
          </div>
          <button 
            onClick={() => setParkedEntries([])}
            className="px-6 py-3 bg-rose-50 text-rose-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-colors"
          >
            Clear All
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {parkedEntries.map(item => {
            const firstEntry = item.entries[0];
            const isSource = swapSource?.isFromParkingLot && swapSource?.parkedItemId === item.id;

            return (
              <div 
                key={item.id}
                draggable
                onDragStart={(e) => onDragStart(e, '', 0, '', true, item.id)}
                onClick={() => {
                  if (isSwapMode) {
                    if (isSource) setSwapSource(null);
                    else setSwapSource({ isFromParkingLot: true, parkedItemId: item.id });
                  }
                }}
                className={`p-5 rounded-3xl border-2 transition-all cursor-move group relative ${
                  isSource ? 'bg-rose-50 border-rose-500 ring-4 ring-rose-500/20' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 hover:border-rose-400'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm">
                    <Move className="w-4 h-4 text-rose-500" />
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setParkedEntries(prev => prev.filter(p => p.id !== item.id));
                    }}
                    className="p-2 hover:bg-rose-100 text-rose-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase leading-tight">{firstEntry.subject}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{firstEntry.teacherName}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.entries.map(e => (
                      <span key={e.id} className="px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-md text-[8px] font-black text-slate-500 uppercase">
                        {e.className}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-[9px] font-bold text-rose-400 italic leading-snug">“{item.reason}”</p>
                </div>

                {isSource && (
                  <div className="absolute inset-0 bg-rose-500/10 rounded-3xl flex items-center justify-center">
                    <div className="bg-rose-500 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg animate-pulse">
                      Ready to Place
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

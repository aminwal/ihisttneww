import React from 'react';
import { Archive, X, Sparkles, Trash2 } from 'lucide-react';
import { TimeTableEntry, SchoolConfig, ParkedItem } from '../types';
import { HapticService } from '../services/hapticService';

interface SwapSuggestion {
  id: string;
  description: string;
  moves: { entryId: string; newDay: string; newSlot: number; }[];
  placements: { parkedEntryId: string; day: string; slot: number; }[];
}

interface ParkingLotPanelProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  parkedEntries: ParkedItem[];
  setParkedEntries: React.Dispatch<React.SetStateAction<ParkedItem[]>>;
  swapSource: any;
  setSwapSource: (source: any) => void;
  resolvingParkedItemId: string | null;
  swapSuggestions: SwapSuggestion[];
  handleFindSwaps: (parked: ParkedItem) => void;
  executeDominoSwap: (suggestion: SwapSuggestion, parked: ParkedItem) => void;
  config: SchoolConfig;
}

export const ParkingLotPanel: React.FC<ParkingLotPanelProps> = ({
  isOpen,
  setIsOpen,
  parkedEntries,
  setParkedEntries,
  swapSource,
  setSwapSource,
  resolvingParkedItemId,
  swapSuggestions,
  handleFindSwaps,
  executeDominoSwap,
  config
}) => {
  return (
    <div className={`fixed top-0 right-0 h-full w-80 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 z-[9999] flex flex-col animate-in slide-in-from-right ${isOpen ? '' : 'hidden'}`}>
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 mt-16 md:mt-0">
        <div className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-bold text-slate-800 dark:text-slate-200">Parking Lot</h3>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer relative z-50">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {parkedEntries.length === 0 ? (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500">
            <Archive className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Parking lot is empty.</p>
            <p className="text-xs mt-1">Select an entry and click "Park Entry" to move it here.</p>
          </div>
        ) : (
          parkedEntries.map(item => {
            const isSelected = swapSource?.isFromParkingLot && swapSource.parkedItemId === item.id;
            const mainEntry = item.entries[0];
            const isBlock = item.type === 'BLOCK';
            
            return (
              <div 
                key={item.id}
                onClick={() => {
                  if (isSelected) setSwapSource(null);
                  else {
                    setSwapSource({ isFromParkingLot: true, parkedItemId: item.id });
                    HapticService.light();
                  }
                }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected 
                    ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500 dark:bg-indigo-900/30' 
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{mainEntry.subject}</span>
                  {isBlock && (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 px-1.5 py-0.5 rounded uppercase">Group</span>
                  )}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <p><span className="font-medium">Teacher:</span> {mainEntry.teacherName} {mainEntry.secondaryTeacherName ? `+ ${mainEntry.secondaryTeacherName}` : ''}</p>
                  <p><span className="font-medium">Room:</span> {mainEntry.room || 'TBD'}</p>
                  <p><span className="font-medium">Sections:</span> {
                    isBlock 
                      ? item.entries.map(e => {
                          const sec = config.sections.find(s => s.id === e.sectionId);
                          return sec ? sec.name : e.sectionId;
                        }).join(', ')
                      : (config.sections.find(s => s.id === mainEntry.sectionId)?.name || mainEntry.sectionId)
                  }</p>
                  {item.reason && (
                    <div className="mt-2 p-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 rounded-lg">
                      <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-tight"><span className="font-bold">Why Parked:</span> {item.reason}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex justify-between items-center">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFindSwaps(item);
                    }}
                    className="flex-1 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center justify-center gap-1 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors mr-2"
                  >
                     <Sparkles className="w-3 h-3" /> AI Resolve
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setParkedEntries(prev => prev.filter(p => p.id !== item.id));
                      if (isSelected) setSwapSource(null);
                    }}
                    className="text-rose-500 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
                    title="Delete permanently"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                {resolvingParkedItemId === item.id && (
                  <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                    {swapSuggestions.length > 0 ? (
                       swapSuggestions.map(suggestion => (
                         <div key={suggestion.id} className="p-2 bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg">
                           <p className="text-[9px] text-slate-600 dark:text-slate-400 mb-2 leading-tight">{suggestion.description}</p>
                           <button onClick={() => executeDominoSwap(suggestion, item)} className="w-full bg-indigo-600 text-white py-1.5 rounded text-[9px] font-black uppercase shadow-sm hover:bg-indigo-700 transition-colors">Execute Swap</button>
                         </div>
                       ))
                    ) : (
                       <div className="p-2 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg text-center">
                         <p className="text-[9px] text-slate-500 dark:text-slate-400">No simple 1-step swaps found.</p>
                       </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

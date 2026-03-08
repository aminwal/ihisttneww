import React from 'react';
import { Wand2, Activity, Clock, Info, Sparkles } from 'lucide-react';

interface TimetableConductorProps {
  isDraftMode: boolean;
  isManagement: boolean;
  isAiProcessing: boolean;
  handleGeneratePools: () => void;
  handleGenerateAnchors: () => void;
  handleGenerateLabs: () => void;
  handleGenerateCurriculars: () => void;
  handleGenerateLoads: () => void;
  handleGapCloser: () => void;
  isPurgeMode: boolean;
  setIsPurgeMode: (val: boolean) => void;
}

export const TimetableConductor: React.FC<TimetableConductorProps> = ({
  isDraftMode,
  isManagement,
  isAiProcessing,
  handleGeneratePools,
  handleGenerateAnchors,
  handleGenerateLabs,
  handleGenerateCurriculars,
  handleGenerateLoads,
  handleGapCloser,
  isPurgeMode,
  setIsPurgeMode,
}) => {
  if (!isDraftMode || !isManagement) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-8">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border-4 border-amber-400/20 relative overflow-hidden">
        {/* Background Sparkles */}
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Sparkles className="w-24 h-24 text-amber-400" />
        </div>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div className={`p-5 rounded-[2rem] bg-amber-400 text-[#001f3f] shadow-xl ${isAiProcessing ? 'animate-bounce' : ''}`}>
              <Wand2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">AI Timetable Conductor</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 flex items-center gap-2">
                <Activity className="w-3 h-3 text-emerald-500" /> Multi-Phase Constraint Satisfaction Engine
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button 
              onClick={() => handleGenerateAnchors()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Phase 1</span>
              Anchors
            </button>
            <button 
              onClick={() => handleGeneratePools()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Phase 2</span>
              Subject Pools
            </button>
            <button 
              onClick={() => handleGenerateLabs()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Phase 3</span>
              Lab Blocks
            </button>
            <button 
              onClick={() => handleGenerateCurriculars()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Phase 4</span>
              Curriculars
            </button>
            <button 
              onClick={() => handleGenerateLoads()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-white dark:bg-slate-900 border border-amber-200 rounded-xl text-[9px] font-black uppercase shadow-sm hover:bg-amber-100 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Phase 5</span>
              CSP Optimizer
            </button>
            <button 
              onClick={() => handleGapCloser()}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-slate-950 transition-all flex flex-col items-center"
            >
              <span className="text-amber-500 mb-1">Final</span>
              Gap Closer
            </button>
          </div>

          <div className="flex items-center gap-4 px-6 py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Purge Mode</span>
              <span className="text-[10px] font-bold text-[#001f3f] dark:text-white uppercase">{isPurgeMode ? 'Overwrite' : 'Append'}</span>
            </div>
            <button 
              onClick={() => setIsPurgeMode(!isPurgeMode)}
              className={`w-12 h-6 rounded-full transition-all relative ${isPurgeMode ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isPurgeMode ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Sparkles, X, Wand2, Activity, Info } from 'lucide-react';
import { TimeTableEntry, SchoolConfig, User } from '../../types';

interface AiResolutionModalProps {
  aiResolutionModal: { conflict: string, source: any, target: { day: string, slotId: number } } | null;
  setAiResolutionModal: (val: any) => void;
  isAiProcessing: boolean;
  handleAiResolve: () => void;
  config: SchoolConfig;
  users: User[];
}

export const AiResolutionModal: React.FC<AiResolutionModalProps> = ({
  aiResolutionModal,
  setAiResolutionModal,
  isAiProcessing,
  handleAiResolve,
  config,
  users,
}) => {
  if (!aiResolutionModal) return null;

  const { conflict, source, target } = aiResolutionModal;
  const teacher = users.find(u => u.id === source.teacherId);
  const section = config.sections.find(s => s.id === source.sectionId);

  return (
    <div className="fixed inset-0 z-[1100] bg-[#001f3f]/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-hidden relative border-4 border-amber-400/30">
        <button onClick={() => setAiResolutionModal(null)} className="absolute top-8 right-8 p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors">
          <X className="w-6 h-6 text-slate-400" />
        </button>

        <div className="text-center space-y-4">
          <div className="inline-flex p-4 bg-amber-400 text-[#001f3f] rounded-[2rem] shadow-xl animate-bounce">
            <Sparkles className="w-8 h-8" />
          </div>
          <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">AI Conflict Resolution</h4>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Neural Constraint Satisfaction Engine</p>
        </div>

        <div className="p-6 bg-rose-50 dark:bg-rose-900/10 border-2 border-rose-200 dark:border-rose-800 rounded-3xl space-y-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-rose-600" />
            <p className="text-[11px] font-black text-rose-700 dark:text-rose-400 uppercase tracking-widest leading-tight">Detected Institutional Policy Violation</p>
          </div>
          <p className="text-sm font-bold text-rose-500 italic leading-relaxed">“{conflict}”</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Attempted Placement</p>
            <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{source.subject} @ {target.day} P{target.slotId}</p>
          </div>
          <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Involved Faculty</p>
            <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{teacher?.name || 'Unknown'}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-800">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 leading-relaxed uppercase">
              The AI will attempt to find a valid slot for this entry by analyzing all available periods, teacher loads, and room capacities across the entire school schedule.
            </p>
          </div>

          <button 
            onClick={handleAiResolve}
            disabled={isAiProcessing}
            className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${isAiProcessing ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950'}`}
          >
            {isAiProcessing ? (
              <>
                <Activity className="w-5 h-5 animate-spin" />
                Processing Neural Path...
              </>
            ) : (
              <>
                <Wand2 className="w-5 h-5" />
                Execute AI Resolution
              </>
            )}
          </button>
          <button onClick={() => setAiResolutionModal(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-rose-500 transition-colors">Dismiss Conflict</button>
        </div>
      </div>
    </div>
  );
};

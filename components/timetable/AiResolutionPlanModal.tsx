import React from 'react';
import { Sparkles, X, Check, ArrowRight, Calendar, Clock, User as UserIcon } from 'lucide-react';
import { AiResolutionPlan } from '../../types';

interface AiResolutionPlanModalProps {
  aiResolutionPlan: AiResolutionPlan | null;
  setAiResolutionPlan: (plan: AiResolutionPlan | null) => void;
  applyAiPlan: () => void;
}

export const AiResolutionPlanModal: React.FC<AiResolutionPlanModalProps> = ({
  aiResolutionPlan,
  setAiResolutionPlan,
  applyAiPlan,
}) => {
  if (!aiResolutionPlan) return null;

  return (
    <div className="fixed inset-0 z-[1200] bg-[#001f3f]/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300 overflow-hidden relative border-4 border-emerald-400/30">
        <button onClick={() => setAiResolutionPlan(null)} className="absolute top-8 right-8 p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors">
          <X className="w-6 h-6 text-slate-400" />
        </button>

        <div className="text-center space-y-4">
          <div className="inline-flex p-4 bg-emerald-400 text-[#001f3f] rounded-[2rem] shadow-xl animate-bounce">
            <Sparkles className="w-8 h-8" />
          </div>
          <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Resolution Found</h4>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Optimization Complete</p>
        </div>

        <div className="p-6 bg-emerald-50 dark:bg-emerald-900/10 border-2 border-emerald-200 dark:border-emerald-800 rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <Check className="w-5 h-5 text-emerald-600" />
            <p className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest leading-tight">Proposed Solution</p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-2xl border border-emerald-100 dark:border-emerald-800/30 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl">
                  <UserIcon className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Teacher</p>
                  <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{aiResolutionPlan.teacherName}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 opacity-50">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current (Conflict)</p>
                <div className="flex items-center gap-2 text-rose-500">
                  <X className="w-4 h-4" />
                  <span className="text-xs font-black uppercase">Blocked</span>
                </div>
              </div>
              <ArrowRight className="w-6 h-6 text-emerald-400 animate-pulse" />
              <div className="flex-1 p-4 bg-white dark:bg-slate-800 rounded-2xl border-2 border-emerald-400 shadow-lg transform scale-105">
                <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mb-2">New Placement</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span className="text-xs font-black text-[#001f3f] dark:text-white uppercase">{aiResolutionPlan.day}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="text-xs font-black text-[#001f3f] dark:text-white uppercase">Period {aiResolutionPlan.slot}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl">
            <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-200 italic leading-relaxed">
              "{aiResolutionPlan.reasoning}"
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <button 
            onClick={applyAiPlan}
            className="w-full py-6 bg-[#001f3f] hover:bg-emerald-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 group"
          >
            <Check className="w-5 h-5 group-hover:scale-125 transition-transform" />
            Apply Resolution
          </button>
          <button onClick={() => setAiResolutionPlan(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-rose-500 transition-colors">Reject Proposal</button>
        </div>
      </div>
    </div>
  );
};

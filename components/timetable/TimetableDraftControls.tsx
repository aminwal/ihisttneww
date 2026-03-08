import React from 'react';
import { Sparkles, Save, Trash2, RefreshCw, Wand2, Activity, Info, AlertCircle, Zap } from 'lucide-react';

interface TimetableDraftControlsProps {
  isDraftMode: boolean;
  setIsDraftMode: (val: boolean) => void;
  isManagement: boolean;
  handleDeployDraft: () => void;
  handleDiscardDraft: () => void;
  handleSaveDraft: () => void;
  handleAiConductor: () => void;
  isAiProcessing: boolean;
  isAutoSaving: boolean;
  isAutoSaveEnabled: boolean;
  setIsAutoSaveEnabled: (val: boolean) => void;
}

export const TimetableDraftControls: React.FC<TimetableDraftControlsProps> = ({
  isDraftMode,
  setIsDraftMode,
  isManagement,
  handleDeployDraft,
  handleDiscardDraft,
  handleSaveDraft,
  handleAiConductor,
  isAiProcessing,
  isAutoSaving,
  isAutoSaveEnabled,
  setIsAutoSaveEnabled,
}) => {
  if (!isManagement) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-12">
      <div className={`p-8 md:p-12 rounded-[3rem] shadow-2xl transition-all duration-500 relative overflow-hidden ${isDraftMode ? 'bg-[#001f3f] border-4 border-amber-400/30' : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800'}`}>
        {/* Background Elements */}
        {isDraftMode && (
          <>
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Sparkles className="w-32 h-32 text-amber-400" />
            </div>
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl animate-pulse" />
          </>
        )}

        <div className="flex flex-col lg:flex-row items-center justify-between gap-12 relative z-10">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className={`p-6 rounded-[2.5rem] shadow-2xl transition-all duration-500 ${isDraftMode ? 'bg-amber-400 text-[#001f3f] scale-110' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
              <Wand2 className={`w-10 h-10 ${isAiProcessing ? 'animate-spin' : ''}`} />
            </div>
            <div className="text-center md:text-left">
              <h3 className={`text-3xl font-black uppercase italic tracking-tighter leading-none transition-colors duration-500 ${isDraftMode ? 'text-white' : 'text-[#001f3f] dark:text-white'}`}>
                {isDraftMode ? 'Draft Sandbox Active' : 'Production Schedule'}
              </h3>
              <p className={`text-[10px] font-bold uppercase tracking-[0.3em] mt-4 flex items-center justify-center md:justify-start gap-2 ${isDraftMode ? 'text-amber-400' : 'text-slate-400'}`}>
                <Activity className={`w-3 h-3 ${isDraftMode ? 'text-amber-400' : 'text-emerald-500'}`} /> 
                {isDraftMode ? 'Experimental Constraint Satisfaction Environment' : 'Live Institutional Deployment'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            {!isDraftMode ? (
              <button 
                onClick={() => setIsDraftMode(true)}
                className="px-10 py-5 bg-[#001f3f] text-[#d4af37] rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 flex items-center gap-3"
              >
                <Sparkles className="w-5 h-5" />
                Initialize Draft Sandbox
              </button>
            ) : (
              <>
                <div className="flex flex-col items-center md:items-end gap-2 mr-4">
                  <div className="flex items-center gap-4 px-4 py-2 bg-white/10 rounded-xl border border-white/10">
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={() => setIsAutoSaveEnabled(!isAutoSaveEnabled)}
                         className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${isAutoSaveEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                       >
                         <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isAutoSaveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                       <span className="text-[9px] font-black text-white uppercase tracking-widest">Auto-Save</span>
                    </div>
                    <div className="w-px h-4 bg-white/10" />
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isAutoSaving ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                      <span className="text-[9px] font-black text-white uppercase tracking-widest">{isAutoSaving ? 'Auto-Saving...' : 'Draft Synchronized'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button 
                    onClick={handleAiConductor}
                    disabled={isAiProcessing}
                    className={`px-8 py-4 bg-amber-400 text-[#001f3f] rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center gap-3 ${isAiProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-500'}`}
                  >
                    <Zap className={`w-4 h-4 ${isAiProcessing ? 'animate-bounce' : ''}`} />
                    AI Conductor
                  </button>
                  <button 
                    onClick={handleSaveDraft}
                    className="px-8 py-4 bg-slate-700 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-3"
                  >
                    <Save className="w-4 h-4" />
                    Save Draft
                  </button>
                  <button 
                    onClick={handleDeployDraft}
                    className="px-8 py-4 bg-emerald-500 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl hover:bg-emerald-600 transition-all active:scale-95 flex items-center gap-3"
                  >
                    <Save className="w-4 h-4" />
                    Deploy to Prod
                  </button>
                  <button 
                    onClick={handleDiscardDraft}
                    className="px-8 py-4 bg-rose-500 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl hover:bg-rose-600 transition-all active:scale-95 flex items-center gap-3"
                  >
                    <Trash2 className="w-4 h-4" />
                    Discard
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {isDraftMode && (
          <div className="mt-8 pt-6 border-t border-white/10 flex items-start gap-4">
            <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-slate-300 uppercase leading-relaxed tracking-wider">
              Draft mode allows you to experiment with schedule changes without affecting the live timetable. Use the AI Conductor to automatically resolve constraints or manually place periods using the grid. Once satisfied, click "Deploy to Prod" to overwrite the live schedule.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

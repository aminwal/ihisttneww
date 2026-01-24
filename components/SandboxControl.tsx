
import React, { useState, useMemo } from 'react';
import { User, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, TeacherAssignment, SandboxLog } from '../types.ts';

interface SandboxControlProps {
  isSandbox: boolean;
  setIsSandbox: (val: boolean) => void;
  enterSandbox: () => void;
  exitSandbox: () => void;
  sandboxLogs: SandboxLog[];
  clearSandboxLogs: () => void;
  simulationTools: {
    generateRandomAbsences: () => void;
    clearAllProxies: () => void;
    forceLateArrivals: () => void;
  };
}

const SandboxControl: React.FC<SandboxControlProps> = ({ 
  isSandbox, setIsSandbox, enterSandbox, exitSandbox, sandboxLogs, clearSandboxLogs, simulationTools 
}) => {
  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">
          Sandbox <span className="text-amber-500">Sentinel</span>
        </h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Administrative Virtual Proving Ground</p>
      </div>

      {!isSandbox ? (
        <div className="bg-white dark:bg-slate-900 rounded-[3.5rem] p-12 shadow-2xl border-4 border-slate-100 dark:border-slate-800 text-center space-y-8">
           <div className="w-24 h-24 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto text-amber-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
           </div>
           <div className="space-y-4 max-w-lg mx-auto">
              <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic">Initialize Shadow State</h3>
              <p className="text-sm font-medium text-slate-400 leading-relaxed italic">
                Entering Sandbox mode clones all institutional data into a temporary session. Changes made in the sandbox <span className="text-rose-500 font-black">will never touch the live cloud</span>. Use this to verify proxies, timetable shifts, and broadcast logic.
              </p>
           </div>
           <button onClick={enterSandbox} className="bg-amber-500 text-[#001f3f] px-12 py-6 rounded-[2.5rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 hover:text-white transition-all active:scale-95">Activate Sandbox Hub</button>
        </div>
      ) : (
        <div className="space-y-8">
           <div className="bg-amber-500 p-10 rounded-[3rem] shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8 border-4 border-black">
              <div className="flex items-center gap-6">
                 <div className="w-16 h-16 bg-black text-white rounded-2xl flex items-center justify-center animate-pulse shadow-lg"><svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
                 <div className="text-black">
                    <h2 className="text-3xl font-black uppercase italic tracking-tighter leading-none">Matrix Sandbox Active</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest mt-2 opacity-60">Session-Isolated Environment • Zero Cloud Impact</p>
                 </div>
              </div>
              <button onClick={exitSandbox} className="bg-black text-white px-10 py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95">Deactivate & Purge</button>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button onClick={simulationTools.generateRandomAbsences} className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 hover:border-amber-400 transition-all text-center space-y-4">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Simulate</p>
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Staff Crisis</h4>
                 <p className="text-[9px] font-medium text-slate-500 italic">Marks 15 random teachers as medical leaves to test proxy fill logic.</p>
              </button>
              <button onClick={simulationTools.forceLateArrivals} className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 hover:border-amber-400 transition-all text-center space-y-4">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Simulate</p>
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Clock Tardiness</h4>
                 <p className="text-[9px] font-medium text-slate-500 italic">Generates late attendance logs for staff arriving after 7:15 AM.</p>
              </button>
              <button onClick={simulationTools.clearAllProxies} className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 hover:border-rose-400 transition-all text-center space-y-4">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reset</p>
                 <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Purge Proxies</h4>
                 <p className="text-[9px] font-medium text-slate-500 italic">Removes all current substitutions for the target date to restart planning.</p>
              </button>
           </div>

           <div className="bg-slate-950 rounded-[3rem] p-10 shadow-2xl space-y-6">
              <div className="flex items-center justify-between">
                 <h3 className="text-sm font-black text-emerald-400 uppercase tracking-[0.3em]">Sandbox Virtual Interceptor</h3>
                 <button onClick={clearSandboxLogs} className="text-[9px] font-black text-slate-500 uppercase hover:text-white">Clear Traffic</button>
              </div>
              <div className="bg-black/50 rounded-3xl p-6 h-64 overflow-y-auto font-mono scrollbar-hide space-y-4 border border-slate-800">
                 {sandboxLogs.length > 0 ? sandboxLogs.map(log => (
                    <div key={log.id} className="text-[10px] flex gap-4 animate-in slide-in-from-left duration-300">
                       <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                       <span className="text-sky-400 shrink-0 font-black">INTERCEPT:</span>
                       <div className="space-y-1">
                          <p className="text-white font-bold">{log.action}</p>
                          <p className="text-slate-500 break-all">{JSON.stringify(log.payload)}</p>
                       </div>
                    </div>
                 )) : (
                    <div className="h-full flex items-center justify-center opacity-20">
                       <p className="text-xs font-black uppercase tracking-widest">No Sandbox Traffic Detected</p>
                    </div>
                 )}
              </div>
              <p className="text-[9px] font-medium text-slate-600 uppercase tracking-widest text-center italic">The interceptor captures all database attempts and redirects them to this local buffer.</p>
           </div>
        </div>
      )}
    </div>
  );
};

export default SandboxControl;

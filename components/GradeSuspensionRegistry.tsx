
import React, { useState, useMemo } from 'react';
import { SchoolConfig, SchoolGrade, GradeSuspension, UserRole } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface GradeSuspensionRegistryProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const GradeSuspensionRegistry: React.FC<GradeSuspensionRegistryProps> = ({ 
  config, setConfig, showToast, isSandbox, addSandboxLog 
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<GradeSuspension>>({
    gradeId: '',
    date: formatBahrainDate(),
    reason: 'Examination Session'
  });

  const activeSuspensions = useMemo(() => {
    return (config.gradeSuspensions || []).sort((a, b) => b.date.localeCompare(a.date));
  }, [config.gradeSuspensions]);

  const handleSave = async () => {
    if (!formData.gradeId || !formData.date || !formData.reason) {
      showToast("All fields are mandatory.", "error");
      return;
    }

    const newSuspension: GradeSuspension = {
      id: generateUUID(),
      gradeId: formData.gradeId!,
      date: formData.date!,
      reason: formData.reason!
    };

    const updatedConfig = { 
      ...config, 
      gradeSuspensions: [...(config.gradeSuspensions || []), newSuspension] 
    };

    if (IS_CLOUD_ENABLED && !isSandbox) {
      try {
        await supabase.from('school_config').upsert({ 
          id: 'primary_config', 
          config_data: updatedConfig, 
          updated_at: new Date().toISOString() 
        });
      } catch (err) {
        showToast("Cloud sync failed.", "error");
        return;
      }
    } else if (isSandbox) {
      addSandboxLog?.('GRADE_SUSPENSION_ADD', newSuspension);
    }

    setConfig(updatedConfig);
    showToast("Grade Suspension Authorized", "success");
    setIsAdding(false);
    setFormData({ gradeId: '', date: formatBahrainDate(), reason: 'Examination Session' });
  };

  const removeSuspension = async (id: string) => {
    if (!confirm("Terminate this suspension protocol? Regular classes will resume.")) return;

    const updatedConfig = { 
      ...config, 
      gradeSuspensions: (config.gradeSuspensions || []).filter(s => s.id !== id) 
    };

    if (IS_CLOUD_ENABLED && !isSandbox) {
      await supabase.from('school_config').upsert({ id: 'primary_config', config_data: updatedConfig });
    } else if (isSandbox) {
      addSandboxLog?.('GRADE_SUSPENSION_REMOVE', { id });
    }

    setConfig(updatedConfig);
    showToast("Suspension Protocol Terminated", "info");
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800">
         <div>
            <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Grade Suspension <span className="text-amber-500">Registry</span></h2>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1 italic">Temporal Override Layer • Hidden Capacity Management</p>
         </div>
         <button onClick={() => setIsAdding(!isAdding)} className={`px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl transition-all ${isAdding ? 'bg-rose-50 text-rose-600' : 'bg-[#001f3f] text-[#d4af37]'}`}>
            {isAdding ? 'Discard Declaration' : '+ Declare Grade Holiday'}
         </button>
      </div>

      {isAdding && (
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] shadow-2xl border-4 border-amber-400/20 animate-in zoom-in duration-300">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                 <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-1">Target Grade</label>
                 <select 
                    className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-xs uppercase outline-none border-2 border-transparent focus:border-amber-400"
                    value={formData.gradeId}
                    onChange={e => setFormData({...formData, gradeId: e.target.value})}
                 >
                    <option value="">Choose Grade...</option>
                    {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                 </select>
              </div>
              <div className="space-y-2">
                 <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-1">Calendar Date</label>
                 <input 
                    type="date" 
                    className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-xs outline-none border-2 border-transparent focus:border-amber-400 dark:text-white"
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                 />
              </div>
              <div className="space-y-2">
                 <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-1">Declaration Reason</label>
                 <input 
                    type="text" 
                    placeholder="e.g. Mid-term Examinations"
                    className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-black text-xs outline-none border-2 border-transparent focus:border-amber-400 dark:text-white"
                    value={formData.reason}
                    onChange={e => setFormData({...formData, reason: e.target.value})}
                 />
              </div>
           </div>
           <div className="mt-8 flex gap-4">
              <button onClick={handleSave} className="flex-1 bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all">Authorize Protocol</button>
           </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
         {activeSuspensions.map(s => {
            const grade = config.grades.find(g => g.id === s.gradeId);
            const isToday = s.date === formatBahrainDate();
            return (
              <div key={s.id} className={`bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border-2 transition-all relative overflow-hidden group ${isToday ? 'border-amber-400' : 'border-slate-100 dark:border-slate-800 opacity-60'}`}>
                 {isToday && (
                   <div className="absolute top-0 right-0 p-4">
                      <span className="px-2 py-1 bg-amber-400 text-[#001f3f] text-[7px] font-black uppercase rounded shadow-lg animate-pulse">Active Today</span>
                   </div>
                 )}
                 <div className="flex justify-between items-start mb-6">
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Protocol ID: {s.id.substring(0,8)}</p>
                       <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter mt-1">{grade?.name || 'Unknown Grade'}</h4>
                    </div>
                    <button onClick={() => removeSuspension(s.id)} className="text-rose-400 hover:bg-rose-50 p-2 rounded-xl transition-all opacity-0 group-hover:opacity-100">×</button>
                 </div>
                 <div className="space-y-4">
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-[#001f3f] dark:text-amber-400 shadow-inner">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                       </div>
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Locked Date</p>
                          <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase">{new Date(s.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                       </div>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Reason for Suspension</p>
                       <p className="text-[11px] font-bold text-[#001f3f] dark:text-slate-300 uppercase leading-relaxed">{s.reason}</p>
                    </div>
                 </div>
              </div>
            );
         })}
         {activeSuspensions.length === 0 && (
            <div className="col-span-full py-20 text-center bg-white dark:bg-slate-900 rounded-[3rem] border-4 border-dashed border-slate-100 dark:border-slate-800 opacity-30">
               <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
               <p className="text-sm font-black uppercase tracking-[0.4em]">No active suspension protocols</p>
            </div>
         )}
      </div>
    </div>
  );
};

export default GradeSuspensionRegistry;

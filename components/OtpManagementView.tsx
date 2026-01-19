
import React, { useState } from 'react';
import { SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';

interface OtpManagementViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const OtpManagementView: React.FC<OtpManagementViewProps> = ({ config, setConfig, showToast }) => {
  const [isRotating, setIsRotating] = useState(false);

  const generateNewKey = async () => {
    setIsRotating(true);
    const newKey = Math.floor(100000 + Math.random() * 900000).toString();
    const updatedConfig = { ...config, attendanceOTP: newKey };
    
    try {
      if (IS_CLOUD_ENABLED) {
        const { error } = await supabase
          .from('school_config')
          .upsert({ 
            id: 'primary_config', 
            config_data: updatedConfig,
            updated_at: new Date().toISOString()
          });
        
        if (error) throw error;
      }
      
      setConfig(updatedConfig);
      localStorage.setItem('ihis_attendance_otp', newKey);
      showToast("Institutional Matrix Key Rotated Successfully", "success");
    } catch (err: any) {
      showToast("Security Handshake Failed: " + err.message, "error");
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-700 pb-20">
      <div className="text-center">
        <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Security Gateway</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Manual Override Synchronization</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 md:p-16 shadow-2xl border border-slate-100 dark:border-slate-800 text-center space-y-10">
        <div className="space-y-4">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em]">Current Active Key (Global)</p>
          <div className="bg-slate-50 dark:bg-slate-950 py-10 rounded-[2.5rem] border-2 border-dashed border-amber-200 dark:border-amber-900/50 group hover:border-amber-400 transition-all cursor-default">
            <span className="text-6xl md:text-8xl font-black text-[#001f3f] dark:text-white tracking-[0.2em] font-mono select-all">
              {config.attendanceOTP || '123456'}
            </span>
          </div>
        </div>

        <div className="space-y-6">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-md mx-auto">
            Provide this code to faculty members encountering biometric or geolocation synchronization failures. 
            <span className="text-amber-600 dark:text-amber-400 font-black block mt-2 italic">Institutional Key is synced to all terminals.</span>
          </p>
          
          <button 
            onClick={generateNewKey}
            disabled={isRotating}
            className="bg-[#001f3f] text-[#d4af37] px-12 py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-2xl hover:bg-slate-950 transition-all active:scale-95 border-2 border-white/10 disabled:opacity-50"
          >
            {isRotating ? 'Synchronizing Cluster...' : 'Rotate Global Matrix Key'}
          </button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/10 p-8 rounded-[2.5rem] border-2 border-dashed border-amber-300 dark:border-amber-900/40 flex items-start gap-5">
        <div className="w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center shrink-0 shadow-lg">
          <svg className="w-6 h-6 text-[#001f3f]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest leading-none">Cluster Protocol</p>
          <p className="text-[11px] text-amber-600/80 dark:text-amber-500/60 font-medium leading-relaxed italic">Once rotated, the old key is immediately invalidated on all teacher devices. Teachers may need a refresh to pull the latest configuration if they were already logged in.</p>
        </div>
      </div>
    </div>
  );
};

export default OtpManagementView;

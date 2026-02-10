
import React, { useState, useEffect } from 'react';
import { SchoolConfig } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { HapticService } from '../services/hapticService.ts';

interface OtpManagementViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const OtpManagementView: React.FC<OtpManagementViewProps> = ({ config, setConfig, showToast, isSandbox, addSandboxLog }) => {
  const [isRotating, setIsRotating] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>('--:--');

  useEffect(() => {
    if (!config.autoRotateOtp || !config.lastOtpRotation) {
      setTimeLeft('--:--');
      return;
    }

    const interval = setInterval(() => {
      const lastRotation = new Date(config.lastOtpRotation!).getTime();
      const nextRotation = lastRotation + (60 * 60 * 1000); // 1 Hour
      const now = Date.now();
      const diff = nextRotation - now;

      if (diff <= 0) {
        setTimeLeft('Rotating...');
      } else {
        const minutes = Math.floor(diff / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [config.autoRotateOtp, config.lastOtpRotation]);

  const generateNewKey = async () => {
    setIsRotating(true);
    const newKey = Math.floor(100000 + Math.random() * 900000).toString();
    const updatedConfig = { 
       ...config, 
       attendanceOTP: newKey,
       lastOtpRotation: config.autoRotateOtp ? new Date().toISOString() : config.lastOtpRotation
    };
    
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        const { error } = await supabase
          .from('school_config')
          .upsert({ 
            id: 'primary_config', 
            config_data: updatedConfig,
            updated_at: new Date().toISOString()
          });
        
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('OTP_KEY_ROTATION', { newKey });
      }
      
      setConfig(updatedConfig);
      localStorage.setItem('ihis_attendance_otp', newKey);
      showToast("Institutional Matrix Key Rotated Successfully", "success");
      HapticService.success();
    } catch (err: any) {
      showToast("Security Handshake Failed: " + err.message, "error");
    } finally {
      setIsRotating(false);
    }
  };

  const handleToggleAutoRotate = async () => {
    const newState = !config.autoRotateOtp;
    HapticService.light();
    
    const updatedConfig = { 
      ...config, 
      autoRotateOtp: newState,
      lastOtpRotation: newState ? new Date().toISOString() : config.lastOtpRotation
    };
    
    try {
      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('school_config').upsert({ 
          id: 'primary_config', 
          config_data: updatedConfig, 
          updated_at: new Date().toISOString() 
        });
      } else if (isSandbox) {
        addSandboxLog?.('TOGGLE_OTP_ROTATION', { autoRotate: newState });
      }
      
      setConfig(updatedConfig);
      showToast(newState ? "Auto-Rotation Enabled" : "Auto-Rotation Disabled", "info");
    } catch (err) {
      showToast("Failed to update rotation settings", "error");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-700 pb-20">
      <div className="text-center">
        <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tight">Security Gateway</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Manual Override Synchronization</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 md:p-16 shadow-2xl border border-slate-100 dark:border-slate-800 text-center space-y-10 relative overflow-hidden">
        
        {config.autoRotateOtp && (
          <div className="absolute top-6 right-8 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest tabular-nums">{timeLeft}</span>
          </div>
        )}

        <div className="space-y-4 pt-6">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em]">Current Active Key (Global)</p>
          <div className="bg-slate-50 dark:bg-slate-950 py-10 rounded-[2.5rem] border-2 border-dashed border-amber-200 dark:border-amber-900/50 group hover:border-amber-400 transition-all cursor-default relative">
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
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
             <button 
               onClick={generateNewKey}
               disabled={isRotating}
               className="w-full sm:w-auto bg-[#001f3f] text-[#d4af37] px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-950 transition-all active:scale-95 border-2 border-white/10 disabled:opacity-50"
             >
               {isRotating ? 'Synchronizing...' : 'Force Rotate Now'}
             </button>

             <button 
               onClick={handleToggleAutoRotate}
               className={`w-full sm:w-auto px-8 py-5 rounded-[2rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-lg transition-all active:scale-95 border-2 ${
                 config.autoRotateOtp 
                   ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' 
                   : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 hover:text-sky-500'
               }`}
             >
               {config.autoRotateOtp ? 'Auto-Rotate ON' : 'Enable Auto-Rotate'}
             </button>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/10 p-8 rounded-[2.5rem] border-2 border-dashed border-amber-300 dark:border-amber-900/40 flex items-start gap-5">
        <div className="w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center shrink-0 shadow-lg">
          <svg className="w-6 h-6 text-[#001f3f]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest leading-none">Cluster Protocol</p>
          <p className="text-[11px] text-amber-600/80 dark:text-amber-500/60 font-medium leading-relaxed italic">Once rotated, the old key is immediately invalidated on all teacher devices. To save bandwidth, automatic rotation only triggers while an administrator is actively monitoring the portal.</p>
        </div>
      </div>
    </div>
  );
};

export default OtpManagementView;

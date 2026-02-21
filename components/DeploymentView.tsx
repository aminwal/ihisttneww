import React, { useState, useEffect } from 'react';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { UserRole } from '../types.ts';
import { MatrixService } from '../services/matrixService.ts';

interface DeploymentViewProps {
  showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const DeploymentView: React.FC<DeploymentViewProps> = ({ showToast }) => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [matrixPulse, setMatrixPulse] = useState<'IDLE' | 'PULSING' | 'ONLINE' | 'OFFLINE' | 'KEY_MISSING'>('IDLE');
  const [pulseRawError, setPulseRawError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('IHIS_GEMINI_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const currentSupabaseUrl = localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '';
  const inferredProjectId = currentSupabaseUrl.split('.')[0].split('//')[1] || '---';

  useEffect(() => {
    const checkConn = async () => {
      if (!IS_CLOUD_ENABLED) { 
        setDbStatus('local'); 
        return; 
      }
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error && error.code !== 'PGRST116') {
          setDbStatus('error');
        } else {
          setDbStatus('connected');
          testMatrixPulse();
        }
      } catch { 
        setDbStatus('error'); 
      }
    };
    checkConn();
  }, []);

  const testMatrixPulse = async () => {
    setMatrixPulse('PULSING');
    setPulseRawError(null);
    try {
      const result = await MatrixService.isReadyExtended();
      if (result.online) {
        setMatrixPulse('ONLINE');
      } else {
        setPulseRawError(result.raw || null);
        if (result.error === 'MISSING_API_KEY') {
          setMatrixPulse('KEY_MISSING');
        } else {
          setMatrixPulse('OFFLINE');
        }
      }
    } catch (e: any) {
      setMatrixPulse('OFFLINE');
      setPulseRawError(e.message);
    }
  };

  const handleManualSave = () => {
    if (!urlInput.trim() || !keyInput.trim()) { 
      setSaveStatus("Error: Credentials required."); 
      return; 
    }
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_URL', urlInput.trim());
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY', keyInput.trim());
    setSaveStatus("Syncing local registry...");
    setTimeout(() => window.location.reload(), 800);
  };

  const handleClearOverride = () => {
    localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_URL');
    localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');
    window.location.reload();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast?.("Dispatched to Clipboard", "success");
  };

  const handleSaveGeminiKey = () => {
    localStorage.setItem('IHIS_GEMINI_KEY', geminiKey.trim());
    showToast?.("Gemini Key Secured Locally", "success");
    testMatrixPulse();
  };

  const sqlSchema = `
-- ==========================================================
-- IHIS INSTITUTIONAL INFRASTRUCTURE SCRIPT (V8.7)
-- Target: Ibn Al Hytham Islamic School Registry
-- Updated: Added WebAuthn Cloud Sync (Biometrics)
-- ==========================================================

-- 1. FACULTY PROFILES (Identity Root)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  password TEXT,
  role TEXT NOT NULL,
  secondary_roles JSONB DEFAULT '[]'::JSONB,
  feature_overrides JSONB DEFAULT '[]'::JSONB,
  responsibilities JSONB DEFAULT '[]'::JSONB,
  expertise JSONB DEFAULT '[]'::JSONB,
  class_teacher_of TEXT,
  phone_number TEXT,
  telegram_chat_id TEXT,
  is_resigned BOOLEAN DEFAULT FALSE,
  ai_authorized BOOLEAN DEFAULT TRUE,
  biometric_public_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. WORKLOAD MATRIX (Academic Constraints)
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  grade_id TEXT NOT NULL,
  loads JSONB DEFAULT '[]'::JSONB,
  target_section_ids JSONB DEFAULT '[]'::JSONB,
  group_periods INTEGER DEFAULT 0,
  anchor_subject TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(teacher_id, grade_id)
);

-- 3. ATTENDANCE SENTINEL (Daily Logs)
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  is_late BOOLEAN DEFAULT FALSE,
  location JSONB,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. SUBSTITUTION LEDGER (Proxy Matrix)
CREATE TABLE IF NOT EXISTS substitution_ledger (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  slot_id INTEGER NOT NULL,
  wing_id TEXT,
  grade_id TEXT,
  section_id TEXT,
  class_name TEXT,
  subject TEXT,
  absent_teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  absent_teacher_name TEXT,
  substitute_teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  substitute_teacher_name TEXT,
  section TEXT, -- SectionType
  is_archived BOOLEAN DEFAULT FALSE,
  last_notified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. INSTITUTIONAL ANNOUNCEMENTS (Messaging Log)
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT,
  message TEXT,
  type TEXT DEFAULT 'ANNOUNCEMENT',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. GLOBAL CONFIGURATION (Matrix State)
CREATE TABLE IF NOT EXISTS school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 7. TIMETABLE ENTRIES (Production Registry)
CREATE TABLE IF NOT EXISTS timetable_entries (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  wing_id TEXT,
  grade_id TEXT,
  section_id TEXT,
  class_name TEXT,
  day TEXT NOT NULL,
  slot_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  subject_category TEXT,
  teacher_id TEXT,
  teacher_name TEXT,
  room TEXT,
  is_substitution BOOLEAN DEFAULT FALSE,
  is_manual BOOLEAN DEFAULT FALSE,
  block_id TEXT,
  block_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 8. LESSON ARCHITECT VAULT
CREATE TABLE IF NOT EXISTS lesson_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_name TEXT NOT NULL,
  date DATE NOT NULL,
  grade_id TEXT NOT NULL,
  section_id TEXT,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  plan_data JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-32 px-4">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 ${dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-rose-50 border-rose-100 text-rose-600'}`}>
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Infrastructure Hub</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 italic">
              Developed by Ahmed Minwal • Institutional Registry 2026-27
            </p>
          </div>
        </div>
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100">
           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Global Status</p>
           <p className={`text-xs font-black uppercase ${IS_CLOUD_ENABLED ? 'text-emerald-500' : 'text-rose-500 animate-pulse'}`}>
             {IS_CLOUD_ENABLED ? 'Cloud Synchronized' : 'Action Required: Browser Linkage'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
           <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Connection Diagnostics</h3>
           
           <div className="space-y-3">
              <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                 <div className={`w-2 h-2 rounded-full ${IS_CLOUD_ENABLED ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></div>
                 <div className="flex-1">
                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase leading-none">1. Browser Identity</p>
                    <p className="text-[8px] text-slate-400 mt-1">{IS_CLOUD_ENABLED ? 'URL & Key saved in browser.' : 'Missing in "Identity Link".'}</p>
                 </div>
              </div>

              <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl relative">
                 <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${matrixPulse === 'ONLINE' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                    <div className="flex-1">
                       <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase leading-none">2. Direct Client AI</p>
                       <p className="text-[8px] text-slate-400 mt-1">{matrixPulse === 'ONLINE' ? 'AI execution verified.' : 'AI features disabled.'}</p>
                    </div>
                 </div>
                 {pulseRawError && (
                   <div className="mt-2 p-3 bg-rose-500/5 rounded-xl border border-rose-500/20">
                      <p className="text-[7px] font-black text-rose-500 uppercase mb-1">Diagnostic Trace:</p>
                      <p className="text-[9px] text-rose-600 font-mono break-words leading-tight italic">{pulseRawError}</p>
                   </div>
                 )}
              </div>

              <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                 <div className={`w-2 h-2 rounded-full ${matrixPulse === 'ONLINE' ? 'bg-emerald-500' : matrixPulse === 'KEY_MISSING' ? 'bg-rose-500' : 'bg-amber-500'}`}></div>
                 <div className="flex-1">
                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase leading-none">3. Matrix Secret</p>
                    <p className="text-[8px] text-slate-400 mt-1">{matrixPulse === 'ONLINE' ? 'Secret Key secured locally.' : matrixPulse === 'KEY_MISSING' ? 'Key missing in browser.' : 'Unverified Status.'}</p>
                 </div>
              </div>
           </div>

           <button 
              onClick={testMatrixPulse} 
              className="w-full py-4 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-950 transition-all"
           >
              Refresh Diagnostic Pulse
           </button>
        </div>

        <div className="lg:col-span-7 bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 space-y-6 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform"><svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.041-1.416-4.041-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></div>
           <h2 className="text-xl font-black text-amber-400 uppercase italic tracking-tighter">GitHub Deployment Logic</h2>
           
           <div className="space-y-4 relative z-10">
              <div className="space-y-4">
                 <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                    <p className="text-[9px] font-black text-emerald-400 uppercase mb-1 italic">Rule: Verification Match</p>
                    <p className="text-[10px] text-white/70 leading-relaxed">Ensure you are linked to project <span className="text-amber-400 font-black">{inferredProjectId}</span> in your terminal before deploying.</p>
                 </div>
                 
                 <div className="space-y-2">
                    <p className="text-[9px] font-black text-white/40 uppercase ml-2">1. Link Terminal to Project</p>
                    <div className="bg-slate-950 p-4 rounded-xl border border-white/10 flex items-center justify-between group/cmd">
                       <code className="text-[10px] text-emerald-400 font-mono">npx supabase link --project-ref {inferredProjectId}</code>
                       <button onClick={() => copyToClipboard(`npx supabase link --project-ref ${inferredProjectId}`)} className="opacity-0 group-hover/cmd:opacity-100 text-[8px] font-black text-amber-500 uppercase">Copy</button>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 space-y-6">
            <div className="flex justify-between items-center">
               <h2 className="text-xl font-black uppercase italic text-[#d4af37]">Identity Link (Browser)</h2>
               {localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') && (
                 <button onClick={handleClearOverride} className="text-[8px] font-black text-rose-500 uppercase border-b border-rose-500">Unlink Website</button>
               )}
            </div>
            <div className="space-y-4">
              <input type="text" placeholder="Project URL (https://xyz...)" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <input type="password" placeholder="API Anon Key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all">Authorize This Website</button>
            </div>
          </section>
          
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 flex flex-col dark:border-slate-800">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Migration Script V8.7</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); showToast?.('Registry Structure Copied.', 'success'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button>
             </div>
             <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl font-mono h-48 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner text-[11px]">
                <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
             </div>
          </section>
      </div>

      <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 space-y-8">
         <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-400 rounded-2xl flex items-center justify-center text-[#001f3f] shadow-lg"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg></div>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Matrix Key Wizard</h2>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <p className="text-[11px] font-black text-white/40 uppercase tracking-widest">A. Gemini API Key</p>
                 <a 
                   href="https://aistudio.google.com/app/apikey" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className="flex items-center gap-2 text-[9px] font-black text-sky-400 hover:text-sky-300 uppercase tracking-widest transition-colors bg-sky-500/10 px-3 py-1.5 rounded-lg border border-sky-500/20"
                 >
                   <span>Open AI Studio</span>
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                 </a>
               </div>
               <input 
                 type="password" 
                 placeholder="Paste your API key here..." 
                 value={geminiKey}
                 onChange={e => setGeminiKey(e.target.value)}
                 className="w-full px-6 py-5 bg-white/5 border border-white/10 rounded-2xl text-sm text-white font-bold outline-none focus:border-amber-400 transition-all"
               />
            </div>

            <div className={`space-y-4 transition-all duration-500 ${!geminiKey ? 'opacity-20 pointer-events-none' : ''}`}>
               <p className="text-[11px] font-black text-amber-500 uppercase tracking-widest">B. Local Browser Vault</p>
               <div className="p-5 bg-slate-950 rounded-2xl border border-amber-400/20">
                  <p className="text-[8px] font-black text-amber-500/50 uppercase mb-2">Status:</p>
                  <code className="text-[10px] text-emerald-400 break-all font-mono">Store key directly in this device for AI features.</code>
               </div>
               <button 
                 onClick={handleSaveGeminiKey}
                 className="w-full bg-[#d4af37] text-[#001f3f] py-4 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl"
               >
                  Authorize Local Execution
               </button>
            </div>
         </div>
      </div>

      <div className="text-center pb-12">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Operational Architecture V8.7 • Ibn Al Hytham Islamic School</p>
      </div>
    </div>
  );
};

export default DeploymentView;

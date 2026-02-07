
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
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [geminiKey, setGeminiKey] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
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
    if (!IS_CLOUD_ENABLED) return;
    setMatrixPulse('PULSING');
    try {
      const result = await MatrixService.isReadyExtended();
      if (result.online) {
        setMatrixPulse('ONLINE');
      } else if (result.error === 'MISSING_API_KEY') {
        setMatrixPulse('KEY_MISSING');
      } else {
        setMatrixPulse('OFFLINE');
      }
    } catch {
      setMatrixPulse('OFFLINE');
    }
  };

  const handleManualSave = () => {
    if (!urlInput.trim() || !keyInput.trim()) { 
      setSaveStatus("Error: Required credentials missing."); 
      return; 
    }
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_URL', urlInput.trim());
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY', keyInput.trim());
    setSaveStatus("Matrix Link Established. Syncing Cluster...");
    setTimeout(() => window.location.reload(), 1200);
  };

  const handleClearOverride = () => {
    localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_URL');
    localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');
    window.location.reload();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast?.("Command Copied to Clipboard!", "success");
  };

  const sqlSchema = `
-- ==========================================================
-- IHIS INSTITUTIONAL INFRASTRUCTURE SCRIPT (V8.4)
-- ==========================================================
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS lesson_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_name TEXT NOT NULL,
  date DATE NOT NULL,
  grade_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  plan_data JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

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
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-24 px-4">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Status Monitoring */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
           <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Institutional Pulse</h3>
              <div className={`w-2 h-2 rounded-full ${matrixPulse === 'ONLINE' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`}></div>
           </div>
           
           <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                 <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Matrix Engine</p>
                    <p className={`text-[10px] font-bold uppercase italic ${matrixPulse === 'ONLINE' ? 'text-emerald-500' : 'text-rose-500'}`}>
                       {matrixPulse === 'PULSING' ? 'Syncing...' : matrixPulse === 'ONLINE' ? 'Cloud Bridge Active' : 'Bridge Offline'}
                    </p>
                 </div>
                 <button onClick={testMatrixPulse} className="px-4 py-2 bg-[#001f3f] text-[#d4af37] rounded-lg text-[8px] font-black uppercase">Refresh Pulse</button>
              </div>

              {matrixPulse === 'OFFLINE' && (
                <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100">
                   <p className="text-[9px] font-black text-rose-600 uppercase">Step 1 Required</p>
                   <p className="text-[10px] text-rose-500 italic mt-1 leading-tight">Run "npx supabase link" and "deploy" in your GitHub terminal.</p>
                </div>
              )}

              {matrixPulse === 'KEY_MISSING' && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200">
                   <p className="text-[9px] font-black text-amber-600 uppercase">Matrix Key Missing</p>
                   <p className="text-[10px] text-amber-500 italic mt-1 leading-tight">The cloud needs your Gemini API Key. Use the wizard on the right.</p>
                </div>
              )}
           </div>
        </div>

        {/* GitHub Terminal Guide */}
        <div className="lg:col-span-7 bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 space-y-6 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform"><svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.041-1.416-4.041-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></div>
           <h2 className="text-xl font-black text-amber-400 uppercase italic tracking-tighter">GitHub Terminal Console</h2>
           
           <div className="space-y-4 relative z-10">
              <div className="space-y-2">
                 <p className="text-[9px] font-black text-white/40 uppercase ml-2">Step 1: Link Project</p>
                 <div className="bg-slate-950 p-4 rounded-xl border border-white/10 flex items-center justify-between group/cmd">
                    <code className="text-[10px] text-emerald-400 font-mono">npx supabase link --project-ref YOUR_ID</code>
                    <button onClick={() => copyToClipboard("npx supabase link --project-ref ")} className="opacity-0 group-hover/cmd:opacity-100 text-[8px] font-black text-amber-500 uppercase">Copy</button>
                 </div>
              </div>
              <div className="space-y-2">
                 <p className="text-[9px] font-black text-white/40 uppercase ml-2">Step 2: Deploy Brain</p>
                 <div className="bg-slate-950 p-4 rounded-xl border border-white/10 flex items-center justify-between group/cmd">
                    <code className="text-[10px] text-emerald-400 font-mono">npx supabase functions deploy lesson-architect --no-verify-jwt</code>
                    <button onClick={() => copyToClipboard("npx supabase functions deploy lesson-architect --no-verify-jwt")} className="opacity-0 group-hover/cmd:opacity-100 text-[8px] font-black text-amber-500 uppercase">Copy</button>
                 </div>
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Identity Link */}
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 space-y-6">
            <div className="flex justify-between items-center">
               <h2 className="text-xl font-black uppercase italic text-[#d4af37]">Identity Link</h2>
               {localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') && (
                 <button onClick={handleClearOverride} className="text-[8px] font-black text-rose-500 uppercase border-b border-rose-500">Unlink Terminal</button>
               )}
            </div>
            <div className="space-y-4">
              <input type="text" placeholder="Supabase Project URL" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <input type="password" placeholder="Anon / Public API Key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all">Authorize Terminal</button>
            </div>
            {saveStatus && <p className={`text-[10px] font-black uppercase text-center ${saveStatus.includes('Error') ? 'text-rose-500' : 'text-emerald-500'}`}>{saveStatus}</p>}
          </section>
          
          {/* SQL Migration Script */}
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 flex flex-col dark:border-slate-800">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Migration Script V8.4</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); showToast?.('Script V8.4 Copied.', 'success'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button>
             </div>
             <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl font-mono h-48 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner text-[11px]">
                <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
             </div>
             <p className="mt-4 text-[9px] font-medium text-slate-400 italic">Open your Supabase SQL Editor and run this script to prepare the cloud tables.</p>
          </section>
      </div>

      {/* API Key Wizard */}
      <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 space-y-8">
         <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-400 rounded-2xl flex items-center justify-center text-[#001f3f] shadow-lg"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg></div>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Matrix Key Wizard</h2>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-4">
               <p className="text-[11px] font-black text-white/40 uppercase tracking-widest">A. Input Gemini API Key</p>
               <input 
                 type="password" 
                 placeholder="Paste your key here..." 
                 value={geminiKey}
                 onChange={e => setGeminiKey(e.target.value)}
                 className="w-full px-6 py-5 bg-white/5 border border-white/10 rounded-2xl text-sm text-white font-bold outline-none focus:border-amber-400 transition-all"
               />
               <p className="text-[9px] text-slate-500 italic">This powers the Lesson Architect and AI Analyst.</p>
            </div>

            <div className={`space-y-4 transition-all duration-500 ${!geminiKey ? 'opacity-20 pointer-events-none' : ''}`}>
               <p className="text-[11px] font-black text-amber-500 uppercase tracking-widest">B. Push Secret to Cloud</p>
               <div className="p-5 bg-slate-950 rounded-2xl border border-amber-400/20">
                  <p className="text-[8px] font-black text-amber-500/50 uppercase mb-2">Execute in GitHub Terminal:</p>
                  <code className="text-[10px] text-emerald-400 break-all font-mono">npx supabase secrets set API_KEY={geminiKey || '...'}</code>
               </div>
               <button 
                 onClick={() => copyToClipboard(`npx supabase secrets set API_KEY=${geminiKey}`)}
                 className="w-full bg-[#d4af37] text-[#001f3f] py-4 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95"
               >
                  Copy Push Command
               </button>
            </div>
         </div>
      </div>

      <div className="text-center pb-12">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Operational Architecture V8.5 • Ibn Al Hytham Islamic School</p>
      </div>
    </div>
  );
};

export default DeploymentView;

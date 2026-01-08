
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient.ts';

const DeploymentView: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  useEffect(() => {
    const checkConn = async () => {
      if (supabase.supabaseUrl.includes('placeholder')) {
        setDbStatus('local');
        return;
      }
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error && error.code !== 'PGRST116') setDbStatus('error');
        else setDbStatus('connected');
      } catch {
        setDbStatus('error');
      }
    };
    checkConn();
  }, []);

  const handleManualSave = () => {
    if (!urlInput || !keyInput) {
      setSaveStatus("Both URL and Key are required.");
      return;
    }
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_URL', urlInput.trim());
    localStorage.setItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY', keyInput.trim());
    setSaveStatus("Credentials Secured. Reloading system...");
    setTimeout(() => window.location.reload(), 1500);
  };

  const sqlSchema = `
-- 1. Profiles Table (Multi-Department Support)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  secondary_roles JSONB DEFAULT '[]'::JSONB,
  class_teacher_of TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Attendance Ledger
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  date DATE NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  is_late BOOLEAN DEFAULT FALSE,
  reason TEXT,
  location JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Institutional Configuration
CREATE TABLE IF NOT EXISTS school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Timetable Registry
CREATE TABLE IF NOT EXISTS timetable_entries (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  class_name TEXT NOT NULL,
  day TEXT NOT NULL,
  slot_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  subject_category TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Substitution Ledger
CREATE TABLE IF NOT EXISTS substitution_ledger (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  slot_id INTEGER NOT NULL,
  class_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  absent_teacher_id TEXT NOT NULL,
  absent_teacher_name TEXT NOT NULL,
  substitute_teacher_id TEXT NOT NULL,
  substitute_teacher_name TEXT NOT NULL,
  section TEXT NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. Faculty Workload Assignments (Workload Matrix)
CREATE TABLE IF NOT EXISTS faculty_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  grade TEXT NOT NULL,
  loads JSONB NOT NULL,
  target_sections JSONB DEFAULT '[]'::JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Security Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitution_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Access" ON profiles FOR ALL USING (true);
CREATE POLICY "Public Access" ON attendance FOR ALL USING (true);
CREATE POLICY "Public Access" ON school_config FOR ALL USING (true);
CREATE POLICY "Public Access" ON timetable_entries FOR ALL USING (true);
CREATE POLICY "Public Access" ON substitution_ledger FOR ALL USING (true);
CREATE POLICY "Public Access" ON faculty_assignments FOR ALL USING (true);
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 transition-all ${
            dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'
          }`}>
             <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase">Cloud Deployment</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Infrastructure Synchronization Hub</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
            <div className="bg-[#001f3f] p-8 text-white">
               <h2 className="text-xl font-black uppercase italic tracking-widest text-[#d4af37]">Cloud Gateway</h2>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-1">Supabase Endpoint URL</label>
                <input type="text" placeholder="https://..." value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 rounded-2xl px-6 py-4 dark:text-white font-bold text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-1">Anonymous Key</label>
                <input type="password" placeholder="••••••••••••••••" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 rounded-2xl px-6 py-4 dark:text-white font-bold text-sm" />
              </div>
              {saveStatus && <p className="text-[10px] font-black uppercase text-amber-500 text-center">{saveStatus}</p>}
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 transition-all">Link Infrastructure</button>
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden h-full flex flex-col">
             <div className="p-8 flex justify-between items-center border-b">
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Database Schema</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Copied to Clipboard!'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button>
             </div>
             <div className="p-8 flex-1">
                <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl text-[10px] font-mono h-64 overflow-y-auto scrollbar-hide border-2 border-slate-900">
                   <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
                </div>
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-4 italic">Execution required in Supabase SQL Editor for production deployment.</p>
             </div>
          </section>
      </div>
    </div>
  );
};

export default DeploymentView;

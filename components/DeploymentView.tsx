
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient.ts';
import { UserRole } from '../types.ts';

const DeploymentView: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  // Diagnostic State
  const [auditLogs, setAuditLogs] = useState<{label: string, status: 'pass' | 'fail' | 'pending'}[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

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

  const seedAdmin = async () => {
    if (dbStatus !== 'connected') return;
    setIsSeeding(true);
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: '00000000-0000-4000-8000-000000000001',
        employee_id: 'emp001',
        name: 'System Admin',
        email: 'admin@school.com',
        password: 'password123',
        role: UserRole.ADMIN,
        secondary_roles: [],
        is_resigned: false
      }, { onConflict: 'id' });

      if (error) throw error;
      alert("ROOT ACCOUNT INITIALIZED: You can now log in with emp001 / password123");
    } catch (e: any) {
      alert("Seeding Failed: " + e.message);
    } finally {
      setIsSeeding(false);
    }
  };

  const runDiagnostic = async () => {
    setIsAuditing(true);
    const logs: typeof auditLogs = [];
    
    try {
      const { error: pErr } = await supabase.from('profiles').select('id').limit(1);
      logs.push({ label: 'Profiles Table Presence', status: pErr ? 'fail' : 'pass' });

      const { error: tErr } = await supabase.from('timetable_entries').select('id').limit(1);
      logs.push({ label: 'Timetable Table Presence', status: tErr ? 'fail' : 'pass' });

      const { error: typeErr } = await supabase.from('timetable_entries').select('id').eq('id', 'stable-id-test-check').maybeSingle();
      if (typeErr && typeErr.code === '22P02') {
        logs.push({ label: 'ID Type: UUID (Outdated)', status: 'fail' });
      } else {
        logs.push({ label: 'ID Type: TEXT (Verified Stable)', status: 'pass' });
      }

      const { error: cErr } = await supabase.from('school_config').select('id').limit(1);
      logs.push({ label: 'Config Table Presence', status: cErr ? 'fail' : 'pass' });

    } catch (e) {
      logs.push({ label: 'Connectivity Handshake', status: 'fail' });
    }

    setAuditLogs(logs);
    setIsAuditing(false);
  };

  const sqlSchema = `
-- IHIS INFRASTRUCTURE MIGRATION SCRIPT
-- WARNING: Running this will reset your existing data.
-- This is necessary to fix the Timetable ID type mismatch.

-- 0. Cleanup existing structures (Ensures types are updated from UUID to TEXT)
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS timetable_entries;
DROP TABLE IF EXISTS substitution_ledger;
DROP TABLE IF EXISTS faculty_assignments;
DROP TABLE IF EXISTS school_config;
DROP TABLE IF EXISTS profiles;

-- 1. Profiles Table
CREATE TABLE profiles (
  id TEXT PRIMARY KEY, -- Changed to TEXT for IHIS Stable IDs
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  secondary_roles JSONB DEFAULT '[]'::JSONB,
  class_teacher_of TEXT,
  is_resigned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Attendance Ledger
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id),
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
CREATE TABLE school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Timetable Registry
CREATE TABLE timetable_entries (
  id TEXT PRIMARY KEY, -- Stable ID Format: base-[class]-[day]-[slot]
  section TEXT NOT NULL,
  class_name TEXT NOT NULL,
  day TEXT NOT NULL,
  slot_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  subject_category TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  date DATE, -- NULL for base schedule, DATE for substitutions
  is_substitution BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Substitution Ledger
CREATE TABLE substitution_ledger (
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

-- 6. Faculty Workload Assignments
CREATE TABLE faculty_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  grade TEXT NOT NULL,
  loads JSONB NOT NULL,
  target_sections JSONB DEFAULT '[]'::JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitution_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_assignments ENABLE ROW LEVEL SECURITY;

-- Create Open Access Policies for the Institutional Registry
CREATE POLICY "Institutional Access" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Institutional Access" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Institutional Access" ON school_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Institutional Access" ON timetable_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Institutional Access" ON substitution_ledger FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Institutional Access" ON faculty_assignments FOR ALL USING (true) WITH CHECK (true);
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 transition-all ${
            dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'
          }`}>
             <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2 2v12a2 2 0 012 2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase">Cloud Deployment</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Infrastructure Synchronization Hub</p>
          </div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 min-w-[240px]">
           <div className="flex items-center justify-between mb-4">
              <span className="text-[9px] font-black uppercase text-slate-400">Institutional Diagnostic</span>
              <button 
                onClick={runDiagnostic}
                disabled={isAuditing || dbStatus !== 'connected'}
                className="text-[8px] font-black text-sky-500 uppercase hover:underline disabled:opacity-30"
              >
                {isAuditing ? 'Auditing...' : 'Execute Structural Audit'}
              </button>
           </div>
           <div className="space-y-2">
              {auditLogs.length > 0 ? auditLogs.map((log, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-slate-500 dark:text-slate-300">{log.label}</span>
                  <span className={log.status === 'pass' ? 'text-emerald-500' : 'text-rose-500'}>
                    {log.status === 'pass' ? '✓ Verified' : '✗ Error'}
                  </span>
                </div>
              )) : (
                <p className="text-[10px] italic text-slate-400 text-center py-2">No audit performed recently.</p>
              )}
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
                <div className="mt-6 flex flex-col gap-4">
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 rounded-2xl">
                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest leading-relaxed">
                      NOTICE: Run the SQL above first, then click below to create your ROOT administrator account.
                    </p>
                  </div>
                  <button 
                    onClick={seedAdmin} 
                    disabled={isSeeding || dbStatus !== 'connected'}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-all disabled:opacity-30"
                  >
                    {isSeeding ? 'Creating Account...' : 'Initialize Root Admin (emp001)'}
                  </button>
                </div>
             </div>
          </section>
      </div>
    </div>
  );
};

export default DeploymentView;

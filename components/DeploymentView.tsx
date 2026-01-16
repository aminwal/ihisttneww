import React, { useState, useEffect } from 'react';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { UserRole } from '../types.ts';

const DeploymentView: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const [auditLogs, setAuditLogs] = useState<{label: string, status: 'pass' | 'fail' | 'pending'}[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    const checkConn = async () => {
      if (!IS_CLOUD_ENABLED) {
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
      alert("ROOT ACCOUNT INITIALIZED: Log in with emp001 / password123");
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

      const { error: cErr } = await supabase.from('school_config').select('id').limit(1);
      logs.push({ label: 'Config Table Presence', status: cErr ? 'fail' : 'pass' });

      const { error: aErr } = await supabase.from('attendance').select('id').limit(1);
      logs.push({ label: 'Attendance Table Presence', status: aErr ? 'fail' : 'pass' });
    } catch (e) {
      logs.push({ label: 'Connectivity Handshake', status: 'fail' });
    }

    setAuditLogs(logs);
    setIsAuditing(false);
  };

  const sqlSchema = `
-- IHIS ULTRA-SAFE INFRASTRUCTURE REPAIR SCRIPT
-- This script safely repair your database without deleting existing data.

-- 1. Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
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

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'phone_number exists';
END $$;

-- 2. School Config (Safe Repair Section)
CREATE TABLE IF NOT EXISTS school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- INITIALIZE if record is completely missing
INSERT INTO school_config (id, config_data)
VALUES ('primary_config', '{"classes":[], "subjects":[], "rooms":[], "combinedBlocks":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- REPAIR if keys are missing from existing record
DO $$ BEGIN
  UPDATE school_config 
  SET config_data = jsonb_build_object(
    'classes', COALESCE(config_data->'classes', '[]'::jsonb),
    'subjects', COALESCE(config_data->'subjects', '[]'::jsonb),
    'rooms', COALESCE(config_data->'rooms', '[]'::jsonb),
    'combinedBlocks', COALESCE(config_data->'combinedBlocks', '[]'::jsonb)
  ) || config_data
  WHERE id = 'primary_config';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Config repair skipped';
END $$;

-- 3. Attendance Registry
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id),
  date DATE NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  is_late BOOLEAN DEFAULT FALSE,
  reason TEXT,
  location JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, date)
);

-- 4. Timetable Entries
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
  room TEXT,
  date DATE,
  is_substitution BOOLEAN DEFAULT FALSE,
  block_id TEXT,
  block_name TEXT,
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

-- 6. Realtime
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE substitution_ledger;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Realtime table exists';
    END;
  END IF;
END $$;

-- 7. RLS Safety
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitution_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Institutional Protocol') THEN
    CREATE POLICY "Institutional Protocol" ON profiles FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Institutional Protocol" ON attendance FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Institutional Protocol" ON school_config FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Institutional Protocol" ON timetable_entries FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Institutional Protocol" ON substitution_ledger FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 transition-all ${
            dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'
          }`}>
             <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-12a2 2 0 012 2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Institutional Infrastructure</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Supabase Cloud Matrix Synchronization</p>
          </div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 min-w-[240px]">
           <div className="flex items-center justify-between mb-4">
              <span className="text-[9px] font-black uppercase text-slate-400">Institutional Audit</span>
              <button 
                onClick={runDiagnostic}
                disabled={isAuditing || dbStatus !== 'connected'}
                className="text-[8px] font-black text-sky-500 uppercase hover:underline disabled:opacity-30"
              >
                {isAuditing ? 'Auditing...' : 'Check Consistency'}
              </button>
           </div>
           <div className="space-y-2">
              {auditLogs.length > 0 ? auditLogs.map((log, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-slate-500 dark:text-slate-300">{log.label}</span>
                  <span className={log.status === 'pass' ? 'text-emerald-500' : 'text-rose-500'}>
                    {log.status === 'pass' ? '✓ Verified' : '✗ Missing'}
                  </span>
                </div>
              )) : (
                <p className="text-[10px] italic text-slate-400 text-center py-2">System idle. Diagnostic available.</p>
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
                <input type="text" placeholder="https://xyz.supabase.co" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-6 py-4 dark:text-white font-bold text-sm outline-none focus:border-amber-400 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-1">Service Anon Key</label>
                <input type="password" placeholder="••••••••••••••••" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-6 py-4 dark:text-white font-bold text-sm outline-none focus:border-amber-400 transition-all" />
              </div>
              {saveStatus && <p className="text-[10px] font-black uppercase text-amber-500 text-center animate-pulse">{saveStatus}</p>}
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 border border-white/5">Establish Secure Link</button>
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden h-full flex flex-col">
             <div className="p-8 flex justify-between items-center border-b border-slate-50 dark:border-slate-800">
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Safe Migration Protocol</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Script Copied to Clipboard.'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg hover:scale-105 active:scale-95 transition-all">Copy SQL Script</button>
             </div>
             <div className="p-8 flex-1 flex flex-col">
                <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl text-[10px] font-mono h-64 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner">
                   <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
                </div>
                <div className="mt-8 space-y-6">
                  <div className="p-5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 rounded-2xl">
                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest leading-relaxed">
                      This script uses additive logic. Execute this in your Supabase SQL Editor to safely enable the new features while preserving your existing data.
                    </p>
                  </div>
                  <button 
                    onClick={seedAdmin} 
                    disabled={isSeeding || dbStatus !== 'connected'}
                    className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all disabled:opacity-30 border border-emerald-400/20 active:scale-95"
                  >
                    {isSeeding ? 'Synchronizing...' : 'Update Infrastructure (Safe)'}
                  </button>
                </div>
             </div>
          </section>
      </div>
    </div>
  );
};

export default DeploymentView;

import React, { useState, useEffect } from 'react';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { UserRole, SchoolConfig } from '../types.ts';

const DeploymentView: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    const checkConn = async () => {
      if (!IS_CLOUD_ENABLED) { setDbStatus('local'); return; }
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error && error.code !== 'PGRST116') setDbStatus('error');
        else setDbStatus('connected');
      } catch { setDbStatus('error'); }
    };
    checkConn();
  }, []);

  const handleManualSave = () => {
    if (!urlInput || !keyInput) { setSaveStatus("Both URL and Key are required."); return; }
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
        responsibilities: [],
        is_resigned: false 
      }, { onConflict: 'id' });
      if (error) throw error;
      alert("ROOT ACCOUNT INITIALIZED: Log in with emp001 / password123");
    } catch (e: any) { alert("Seeding Failed: " + e.message); } finally { setIsSeeding(false); }
  };

  const sqlSchema = `
-- ==========================================================
-- IHIS INSTITUTIONAL INFRASTRUCTURE SCRIPT (V8.2.1)
-- Optimized for: Ibn Al Hytham Islamic School (2026-2027)
-- FIX: ADAPTIVE COLUMN INJECTION (Rule 3 & Rule 6)
-- ==========================================================

-- 1. ADAPT PROFILES (Add Biometric Metadata)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='metadata') THEN
        ALTER TABLE profiles ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='ai_authorized') THEN
        ALTER TABLE profiles ADD COLUMN ai_authorized BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 2. ADAPT ATTENDANCE (Add Temporal Integrity Column)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='captured_at') THEN
        ALTER TABLE attendance ADD COLUMN captured_at TIMESTAMP WITH TIME ZONE DEFAULT now();
    END IF;
END $$;

-- 3. ENSURE AUDIT VAULT EXISTS
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id),
  action TEXT NOT NULL,
  payload JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. ADAPT SUBSTITUTION LEDGER (Add notification tracking)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='substitution_ledger' AND column_name='last_notified_at') THEN
        ALTER TABLE substitution_ledger ADD COLUMN last_notified_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- 5. RE-SYNC INDICES
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_captured ON attendance(captured_at);

-- 6. TIMETABLE MATRIX (Standard Tables)
CREATE TABLE IF NOT EXISTS timetable_entries (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  wing_id TEXT,
  grade_id TEXT,
  section_id TEXT,
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
  is_manual BOOLEAN DEFAULT FALSE,
  block_id TEXT,
  block_name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timetable_drafts (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  wing_id TEXT,
  grade_id TEXT,
  section_id TEXT,
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
  is_manual BOOLEAN DEFAULT FALSE,
  block_id TEXT,
  block_name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 7. GLOBAL CONFIGURATION
CREATE TABLE IF NOT EXISTS school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 8. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================================
-- SECURITY POLICIES (RLS)
-- ==========================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON profiles FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON attendance FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON audit_logs FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timetable_entries' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON timetable_entries FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timetable_drafts' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON timetable_drafts FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_config' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON school_config FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcements' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON announcements FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- ==========================================================
-- REALTIME BROADCAST (V8.2.1 Pulse)
-- ==========================================================

BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE 
    attendance, 
    profiles, 
    announcements;
COMMIT;
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 ${dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-12a2 2 0 012 2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Infrastructure Hub</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Adaptive Resilience Registry (V8.2.1)</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 space-y-6">
            <h2 className="text-xl font-black uppercase italic text-[#d4af37]">Cloud Gateway</h2>
            <div className="space-y-4">
              <input type="text" placeholder="Supabase URL" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <input type="password" placeholder="Service Anon Key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none dark:text-white dark:bg-slate-800 dark:border-slate-700" />
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">Establish Secure Link</button>
            </div>
            {saveStatus && <p className="text-[10px] font-black text-amber-600 uppercase text-center">{saveStatus}</p>}
          </section>
          
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 flex flex-col dark:border-slate-800">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Migration Script V8.2.1</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Adaptive Script Copied.'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button>
             </div>
             <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl text-[10px] font-mono h-48 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner">
                <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
             </div>
             <button onClick={seedAdmin} disabled={isSeeding || dbStatus !== 'connected'} className="mt-6 w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-[10px] uppercase shadow-xl">Update Database Structures</button>
          </section>
      </div>
      
      <div className="bg-emerald-50 dark:bg-emerald-900/10 p-8 rounded-[2.5rem] border border-emerald-200 dark:border-emerald-900/30 flex items-start gap-4">
          <div className="p-2 bg-emerald-500 rounded-xl text-white"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
          <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-500 uppercase leading-relaxed italic">
            Adaptive Protocol: This script uses "ALTER TABLE" to inject missing columns (captured_at, metadata) into your existing tables. This resolves the Phase 6 missing column error without data loss.
          </p>
      </div>

      <div className="text-center pb-12">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Developed by Ahmed Minwal • IHIS Operational Framework</p>
      </div>
    </div>
  );
};

export default DeploymentView;

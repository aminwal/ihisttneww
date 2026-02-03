
import React, { useState, useEffect } from 'react';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { UserRole, SchoolConfig } from '../types.ts';

const DeploymentView: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error' | 'local'>('checking');
  const [urlInput, setUrlInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_URL') || '');
  const [keyInput, setKeyInput] = useState(localStorage.getItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY') || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const [auditLogs, setAuditLogs] = useState<{label: string, status: 'pass' | 'fail' | 'pending'}[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

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
-- IHIS INSTITUTIONAL INFRASTRUCTURE SCRIPT (V6.2)
-- Optimized for: Persistent AI Handshake & Authority Matrix
-- ==========================================================

-- 1. FACULTY PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  secondary_roles JSONB DEFAULT '[]'::JSONB,
  responsibilities JSONB DEFAULT '[]'::JSONB,
  expertise JSONB DEFAULT '[]'::JSONB,
  class_teacher_of TEXT,
  phone_number TEXT,
  telegram_chat_id TEXT,
  is_resigned BOOLEAN DEFAULT FALSE,
  ai_authorized BOOLEAN DEFAULT FALSE, -- Persistent AI Handshake Flag
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Ensure ai_authorized column exists for upgrades
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='ai_authorized') THEN
    ALTER TABLE profiles ADD COLUMN ai_authorized BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 2. ATTENDANCE REGISTRY
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
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

-- 3. LIVE TIMETABLE MATRIX
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

-- 4. INSTITUTIONAL DRAFT MATRIX
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

-- 5. PROXY DUTY LEDGER
CREATE TABLE IF NOT EXISTS substitution_ledger (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  slot_id INTEGER NOT NULL,
  wing_id TEXT,
  grade_id TEXT,
  section_id TEXT,
  class_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  absent_teacher_id TEXT NOT NULL,
  absent_teacher_name TEXT NOT NULL,
  substitute_teacher_id TEXT NOT NULL,
  substitute_teacher_name TEXT NOT NULL,
  section TEXT NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  last_notified_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. FACULTY WORKLOAD ASSIGNMENTS
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  grade_id TEXT NOT NULL,
  loads JSONB NOT NULL DEFAULT '[]'::JSONB,
  target_section_ids JSONB DEFAULT '[]'::JSONB,
  group_periods INTEGER DEFAULT 0,
  anchor_subject TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(teacher_id, grade_id)
);

-- 7. GLOBAL CONFIGURATION
CREATE TABLE IF NOT EXISTS school_config (
  id TEXT PRIMARY KEY,
  config_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 8. LESSON PLAN VAULT
CREATE TABLE IF NOT EXISTS lesson_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  grade_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  plan_data JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 9. INSTITUTIONAL QUESTION BANK
CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY,
  grade_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  marks INTEGER NOT NULL,
  options JSONB,
  correct_answer TEXT,
  marking_scheme TEXT,
  bloom_category TEXT,
  rubric JSONB,
  image_url TEXT,
  author_id TEXT REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 10. ANNOUNCEMENTS
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
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitution_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON profiles FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON attendance FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timetable_entries' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON timetable_entries FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timetable_drafts' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON timetable_drafts FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'substitution_ledger' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON substitution_ledger FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'teacher_assignments' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON teacher_assignments FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_config' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON school_config FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lesson_plans' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON lesson_plans FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'question_bank' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON question_bank FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcements' AND policyname = 'Institutional Protocol') THEN CREATE POLICY "Institutional Protocol" ON announcements FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- ==========================================================
-- REALTIME BROADCAST CONFIGURATION
-- ==========================================================

BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE 
    substitution_ledger, 
    timetable_entries, 
    timetable_drafts, 
    attendance, 
    profiles, 
    announcements, 
    teacher_assignments,
    lesson_plans,
    question_bank;
COMMIT;
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6"><div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 ${dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}><svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-12a2 2 0 012 2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg></div><div><h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Infrastructure Hub</h1><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Supabase Cloud Matrix Synchronization (V6.1)</p></div></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 space-y-6">
            <h2 className="text-xl font-black uppercase italic text-[#d4af37]">Cloud Gateway</h2>
            <div className="space-y-4">
              <input type="text" placeholder="Supabase URL" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none" />
              <input type="password" placeholder="Service Anon Key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm outline-none" />
              <button onClick={handleManualSave} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl">Establish Secure Link</button>
            </div>
            {saveStatus && <p className="text-[10px] font-black text-amber-600 uppercase text-center">{saveStatus}</p>}
          </section>
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 p-8 flex flex-col">
             <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-black uppercase italic text-[#001f3f]">Migration Script V6.1</h2><button onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Copied.'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button></div>
             <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl text-[10px] font-mono h-48 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner"><pre className="whitespace-pre-wrap">{sqlSchema}</pre></div>
             <button onClick={seedAdmin} disabled={isSeeding || dbStatus !== 'connected'} className="mt-6 w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-[10px] uppercase shadow-xl">Update Infrastructure (Safe)</button>
          </section>
      </div>
    </div>
  );
};

export default DeploymentView;

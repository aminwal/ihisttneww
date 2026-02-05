
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
      // Ensure the Root Admin (Ahmed Minwal) is synchronized with the new schema
      const { error } = await supabase.from('profiles').upsert({ 
        id: '00000000-0000-4000-8000-000000000001', 
        employee_id: 'emp001', 
        name: 'System Admin', 
        email: 'admin@school.com', 
        password: 'password123', 
        role: UserRole.ADMIN, 
        secondary_roles: [], 
        feature_overrides: ['can_edit_attendance', 'can_manage_personnel', 'can_use_ai_architect', 'can_assign_proxies', 'can_edit_timetable_live'],
        responsibilities: [],
        expertise: ['SYSTEM_ADMINISTRATION'],
        is_resigned: false 
      }, { onConflict: 'id' });
      if (error) throw error;
      alert("ROOT ACCOUNT RE-SYNCED: Log in with emp001 / password123");
    } catch (e: any) { alert("Seeding Failed: " + e.message); } finally { setIsSeeding(false); }
  };

  const sqlSchema = `
-- ==========================================================
-- IHIS INSTITUTIONAL INFRASTRUCTURE SCRIPT (V8.4)
-- Optimized for: Ibn Al Hytham Islamic School (2026-2027)
-- FIX: COMPREHENSIVE PAYLOAD SYNCHRONIZATION
-- ==========================================================

-- 1. ADAPT PROFILES (Complete Identity Payload)
DO $$ 
BEGIN 
    -- Contact & Integration Columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='phone_number') THEN
        ALTER TABLE profiles ADD COLUMN phone_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='telegram_chat_id') THEN
        ALTER TABLE profiles ADD COLUMN telegram_chat_id TEXT;
    END IF;

    -- Institutional Logic Columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='class_teacher_of') THEN
        ALTER TABLE profiles ADD COLUMN class_teacher_of TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='expertise') THEN
        ALTER TABLE profiles ADD COLUMN expertise JSONB DEFAULT '[]'::JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='responsibilities') THEN
        ALTER TABLE profiles ADD COLUMN responsibilities JSONB DEFAULT '[]'::JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_resigned') THEN
        ALTER TABLE profiles ADD COLUMN is_resigned BOOLEAN DEFAULT FALSE;
    END IF;

    -- Access Control Columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='feature_overrides') THEN
        ALTER TABLE profiles ADD COLUMN feature_overrides JSONB DEFAULT '[]'::JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='metadata') THEN
        ALTER TABLE profiles ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
    END IF;
END $$;

-- 2. CREATE WORKLOAD MATRIX (Teacher Assignments)
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

-- 3. CREATE LESSON ARCHITECT VAULT
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

-- 4. ATTENDANCE (Spatial Update)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='location') THEN
        ALTER TABLE attendance ADD COLUMN location JSONB;
    END IF;
END $$;

-- 5. PERFORMANCE INDICES
CREATE INDEX IF NOT EXISTS idx_profiles_employee_id ON profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_plans_composite ON lesson_plans(teacher_id, date, section_id);

-- 6. SECURITY POLICIES (RLS Apply)
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'teacher_assignments' AND policyname = 'Institutional Protocol') THEN 
    CREATE POLICY "Institutional Protocol" ON teacher_assignments FOR ALL USING (true) WITH CHECK (true); 
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lesson_plans' AND policyname = 'Institutional Protocol') THEN 
    CREATE POLICY "Institutional Protocol" ON lesson_plans FOR ALL USING (true) WITH CHECK (true); 
  END IF;
END $$;

-- 7. REALTIME BROADCAST (V8.4 Full Spectrum Pulse)
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE 
    attendance, 
    profiles, 
    substitution_ledger,
    timetable_entries,
    teacher_assignments,
    lesson_plans,
    announcements;
COMMIT;
  `.trim();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-5xl mx-auto pb-24 px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center border-4 ${dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Infrastructure Hub</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Full Compliance Registry (V8.4)</p>
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
                <h2 className="text-xl font-black uppercase italic text-[#001f3f] dark:text-white">Migration Script V8.4</h2>
                <button onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Script V8.4 Copied.'); }} className="bg-[#d4af37] text-[#001f3f] px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg">Copy SQL</button>
             </div>
             <div className="bg-slate-950 text-emerald-400 p-8 rounded-3xl text-[10px] font-mono h-48 overflow-y-auto scrollbar-hide border-2 border-slate-900 shadow-inner">
                <pre className="whitespace-pre-wrap">{sqlSchema}</pre>
             </div>
             <button onClick={seedAdmin} disabled={isSeeding || dbStatus !== 'connected'} className="mt-6 w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-[10px] uppercase shadow-xl">Synchronize All Tables</button>
          </section>
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900/10 p-8 rounded-[2.5rem] border border-blue-200 dark:border-blue-900/30 flex items-start gap-4">
          <div className="p-2 bg-blue-500 rounded-xl text-white"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
          <p className="text-[11px] font-bold text-blue-800 dark:text-blue-500 uppercase leading-relaxed italic">
            Audit Resolution: This script synchronizes the database with the Phase 6 application logic. It adds missing columns for Staff (Phone, Expertise, Responsibilities) and initializes the Workload Matrix and Lesson Architect tables. Execute in Supabase SQL Editor.
          </p>
      </div>

      <div className="text-center pb-12">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Developed by Ahmed Minwal • IHIS Operational Framework</p>
      </div>
    </div>
  );
};

export default DeploymentView;

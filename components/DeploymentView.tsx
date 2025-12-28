
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

  const clearCredentials = () => {
    if (window.confirm("This will disconnect the current cloud link. Continue?")) {
      localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_URL');
      localStorage.removeItem('IHIS_CFG_VITE_SUPABASE_ANON_KEY');
      window.location.reload();
    }
  };

  const sqlSchema = `
-- 1. Create Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  class_teacher_of TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  date DATE NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  is_late BOOLEAN DEFAULT FALSE,
  reason TEXT,
  location JSONB
);

-- 3. Security: Allow Public Access
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON profiles FOR ALL USING (true);
CREATE POLICY "Public Access" ON attendance FOR ALL USING (true);
  `.trim();

  return (
    <div className="space-y-8 md:space-y-12 animate-in fade-in duration-700 max-w-6xl mx-auto pb-24 px-4">
      {/* GitHub Sync Map */}
      <section className="bg-gradient-to-r from-sky-600 to-blue-700 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <svg className="w-40 h-40" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter mb-4">GitHub Sync Gateway</h2>
          <p className="text-sky-100 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] mb-8 max-w-2xl">Visual guide to resolving the "Insufficient Permissions" error.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10">
              <div className="w-10 h-10 bg-white text-blue-700 rounded-xl flex items-center justify-center font-black mb-4 shadow-lg">1</div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2">Manual Workaround</p>
              <p className="text-[9px] font-bold text-sky-50 leading-relaxed">If AI Studio fails to create a repo, go to **GitHub.com** and create a new repo named `ihis-system` manually first.</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10">
              <div className="w-10 h-10 bg-white text-blue-700 rounded-xl flex items-center justify-center font-black mb-4 shadow-lg">2</div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2">Link Existing</p>
              <p className="text-[9px] font-bold text-sky-50 leading-relaxed">In AI Studio, click "Save to GitHub" but select **"Link to an existing repository"** instead of "Create new".</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10">
              <div className="w-10 h-10 bg-white text-blue-700 rounded-xl flex items-center justify-center font-black mb-4 shadow-lg">3</div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2">Revoke Scopes</p>
              <p className="text-[9px] font-bold text-sky-50 leading-relaxed">If you still see errors, visit **GitHub Settings -> Applications** and revoke Google AI Studio before re-linking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Permission Emergency Alert */}
      <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 p-8 rounded-[2rem] shadow-xl flex flex-col md:flex-row items-center gap-8">
        <div className="w-20 h-20 bg-red-600 text-white rounded-3xl flex items-center justify-center shrink-0 animate-pulse shadow-2xl">
           <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        </div>
        <div className="space-y-4">
          <h3 className="text-xl font-black text-red-700 dark:text-red-400 uppercase italic tracking-tight">Permission Emergency Kit</h3>
          <p className="text-xs font-bold text-red-600/80 uppercase tracking-widest leading-relaxed">
            The "Insufficient Permissions" error means GitHub is blocking the AI Studio App from creating files on your behalf.
          </p>
          <div className="flex flex-wrap gap-3">
             <a href="https://github.com/settings/applications" target="_blank" className="bg-red-600 text-white px-6 py-3 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-red-700 transition-colors">Open GitHub Settings</a>
             <a href="https://github.com/new" target="_blank" className="bg-[#001f3f] text-white px-6 py-3 rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-slate-900 transition-colors">Create Repo Manually</a>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl">
        <div className="flex items-center gap-5">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-4 transition-all ${
            dbStatus === 'connected' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'
          }`}>
             <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
             </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase">Infrastructure</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
              Active Mode: <span className={dbStatus === 'connected' ? 'text-emerald-500' : 'text-amber-500'}>{dbStatus === 'connected' ? 'Cloud Integrated' : 'Local Persistence'}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
           <button onClick={clearCredentials} className="px-5 py-3 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase border border-red-100 hover:bg-red-100 transition-colors">Decommission Link</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
           <div className="bg-[#001f3f] rounded-[2.5rem] p-8 text-[#d4af37] border border-white/10 shadow-2xl relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-3xl"></div>
              <h3 className="text-lg font-black uppercase italic mb-6">Cloud Setup</h3>
              <ul className="space-y-6">
                 <li className="flex gap-4">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                    <div>
                       <p className="text-[11px] font-black uppercase leading-tight">Supabase Project</p>
                       <p className="text-[9px] text-white/50 font-bold mt-1">Visit Supabase.com to create your database backend.</p>
                    </div>
                 </li>
                 <li className="flex gap-4">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                    <div>
                       <p className="text-[11px] font-black uppercase leading-tight">SQL Logic</p>
                       <p className="text-[9px] text-white/50 font-bold mt-1">Run the script below in the Supabase SQL Editor to init tables.</p>
                    </div>
                 </li>
              </ul>
           </div>
        </div>

        <div className="lg:col-span-2">
          <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden h-full flex flex-col">
            <div className="bg-gradient-to-r from-brand-navy to-slate-800 p-8 text-brand-gold shrink-0">
               <h2 className="text-xl font-black uppercase italic tracking-tight">Handshake Link</h2>
               <p className="text-white/40 text-[9px] font-black uppercase tracking-widest mt-1">Connect your code to the live database</p>
            </div>
            <div className="p-8 space-y-6 flex-1">
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-1">Project Endpoint URL</label>
                  <input 
                    type="text" 
                    placeholder="https://your-project.supabase.co"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-6 py-4 font-mono text-sm outline-none focus:border-brand-gold transition-all dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-1">Project Anon Key</label>
                  <input 
                    type="password" 
                    placeholder="eyJhbGciOiJIUzI1..."
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-6 py-4 font-mono text-sm outline-none focus:border-brand-gold transition-all dark:text-white"
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                <button 
                  onClick={handleManualSave}
                  className="w-full sm:w-auto bg-[#001f3f] text-[#d4af37] px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 active:scale-95 transition-all"
                >
                  Activate Link
                </button>
                {saveStatus && (
                  <span className="text-[10px] font-black uppercase text-amber-500 animate-pulse">{saveStatus}</span>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="bg-[#001f3f] p-8 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center space-x-6 text-brand-gold">
            <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center font-black text-2xl border border-white/20">SQL</div>
            <div>
              <h2 className="text-white text-xl font-black uppercase italic tracking-tight">DB Init Script</h2>
              <p className="text-amber-200/50 text-[10px] font-black uppercase tracking-widest">Execute in Supabase SQL Editor</p>
            </div>
          </div>
          <button 
            onClick={() => { navigator.clipboard.writeText(sqlSchema); alert('Schema copied to clipboard!'); }}
            className="bg-brand-gold text-brand-navy px-6 py-3 rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-amber-400 transition-colors"
          >
            Copy Script
          </button>
        </div>
        <div className="p-8">
           <pre className="bg-slate-950 text-emerald-400 p-8 rounded-[1.5rem] text-[11px] font-mono h-64 overflow-y-auto border border-slate-800 scrollbar-hide">
              {sqlSchema}
            </pre>
        </div>
      </section>

      <div className="text-center py-10">
         <p className="text-[9px] font-black text-[#001f3f]/30 dark:text-white/20 uppercase tracking-[0.5em]">Institutional Infrastructure Center</p>
      </div>
    </div>
  );
};

export default DeploymentView;

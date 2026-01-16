import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SchoolConfig, SectionType, Subject, SchoolClass, SubjectCategory } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig }) => {
  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newClass, setNewClass] = useState('');
  const [targetSection, setTargetSection] = useState<SectionType>('PRIMARY');
  const [newRoom, setNewRoom] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'syncing', message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const classFileInputRef = useRef<HTMLInputElement>(null);
  const isCloudActive = IS_CLOUD_ENABLED;

  // Defensive mappings to ensure UI never crashes on stale config
  const currentClasses = config?.classes || [];
  const currentSubjects = config?.subjects || [];
  const currentRooms = config?.rooms || [];

  useEffect(() => {
    if (status && status.type !== 'syncing') {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const SECTION_DISPLAY_MAP: Record<string, SectionType> = {
    'primary wing': 'PRIMARY',
    'secondary (boys)': 'SECONDARY_BOYS',
    'secondary (girls)': 'SECONDARY_GIRLS',
    'senior secondary (boys)': 'SENIOR_SECONDARY_BOYS',
    'senior secondary (girls)': 'SENIOR_SECONDARY_GIRLS',
    'primary': 'PRIMARY',
    'secondary boys': 'SECONDARY_BOYS',
    'secondary girls': 'SECONDARY_GIRLS',
    'senior secondary boys': 'SENIOR_SECONDARY_BOYS',
    'senior secondary girls': 'SENIOR_SECONDARY_GIRLS'
  };

  const syncConfiguration = async (updatedConfig: SchoolConfig) => {
    if (!isCloudActive) return;
    setStatus({ type: 'syncing', message: 'Synchronizing Infrastructure...' });
    try {
      const { error } = await supabase
        .from('school_config')
        .upsert({ 
          id: 'primary_config', 
          config_data: updatedConfig,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      
      if (error) throw error;
      setStatus({ type: 'success', message: 'Institutional Registry Updated.' });
    } catch (err: any) {
      console.error("IHIS Config Sync Error:", err);
      setStatus({ type: 'error', message: `Cloud Handshake Failed: ${err.message}` });
    }
  };

  const addSubject = async () => {
    if (!newSubject.trim()) return;
    const subject: Subject = { 
      id: `sub-${generateUUID()}`, 
      name: newSubject.trim(),
      category: targetCategory
    };
    const updated = { ...config, subjects: [...currentSubjects, subject] };
    setConfig(updated);
    setNewSubject('');
    await syncConfiguration(updated);
  };

  const removeSubject = async (id: string) => {
    if (confirm("Remove this subject from institutional catalog?")) {
      const updated = { ...config, subjects: currentSubjects.filter(s => s.id !== id) };
      setConfig(updated);
      await syncConfiguration(updated);
    }
  };

  const addClass = async () => {
    const trimmedName = newClass.trim();
    if (!trimmedName) return;
    
    if (currentClasses.some(c => c.name.toLowerCase() === trimmedName.toLowerCase())) {
      setStatus({ type: 'error', message: `Section "${trimmedName}" already exists.` });
      return;
    }

    const cls: SchoolClass = { 
      id: `cls-${generateUUID()}`, 
      name: trimmedName, 
      section: targetSection 
    };

    const updatedRooms = currentRooms.includes(trimmedName) 
      ? currentRooms 
      : [...currentRooms, trimmedName];

    const updated = { 
      ...config, 
      classes: [...currentClasses, cls],
      rooms: updatedRooms
    };

    setConfig(updated);
    setNewClass('');
    await syncConfiguration(updated);
  };

  const handleClassBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsBulkProcessing(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const rows = xmlDoc.getElementsByTagName("Row");

        const newClasses: SchoolClass[] = [];
        const newRoomsList: string[] = [...currentRooms];

        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].getElementsByTagName("Cell");
          if (cells.length < 2) continue;

          const getCellData = (idx: number) => {
            const cell = cells[idx];
            if (!cell) return '';
            const dataNode = cell.getElementsByTagName("Data")[0] || cell.querySelector('Data');
            return dataNode?.textContent?.trim() || '';
          };

          const name = getCellData(0);
          const sectionStr = getCellData(1).toLowerCase();

          if (!name || name.toLowerCase() === 'section name') continue;
          if (currentClasses.some(c => c.name === name)) continue;

          const section = SECTION_DISPLAY_MAP[sectionStr] || 'PRIMARY';
          newClasses.push({ id: `cls-${generateUUID()}`, name, section });
          
          if (!newRoomsList.includes(name)) {
            newRoomsList.push(name);
          }
        }

        if (newClasses.length > 0) {
          const updated = { 
            ...config, 
            classes: [...currentClasses, ...newClasses],
            rooms: newRoomsList
          };
          setConfig(updated);
          await syncConfiguration(updated);
          setStatus({ type: 'success', message: `Imported ${newClasses.length} sections.` });
        } else {
          setStatus({ type: 'error', message: 'No new unique sections detected in file.' });
        }
      } catch (err) {
        setStatus({ type: 'error', message: 'XML Parse Error: Invalid structure.' });
      } finally {
        setIsBulkProcessing(false);
        if (classFileInputRef.current) classFileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const removeClass = async (id: string) => {
    const updated = {
      ...config,
      classes: currentClasses.filter(c => c.id !== id)
    };
    setConfig(updated);
    setConfirmDeleteId(null);
    await syncConfiguration(updated);
  };

  const addRoom = async () => {
    const trimmedRoom = newRoom.trim();
    if (!trimmedRoom) return;
    if (currentRooms.includes(trimmedRoom)) {
      setStatus({ type: 'error', message: `Room "${trimmedRoom}" already exists.` });
      return;
    }
    const updated = { ...config, rooms: [...currentRooms, trimmedRoom] };
    setConfig(updated);
    setNewRoom('');
    await syncConfiguration(updated);
  };

  const removeRoom = async (roomName: string) => {
    if (confirm(`Decommission room "${roomName}"?`)) {
      const updated = { ...config, rooms: currentRooms.filter(r => r !== roomName) };
      setConfig(updated);
      await syncConfiguration(updated);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
            Institutional <span className="text-[#d4af37]">Configuration</span>
          </h1>
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.4em] flex items-center gap-2">
            <span className="w-8 h-[1px] bg-slate-200"></span> Core System Parameters
          </p>
        </div>

        {status && (
          <div className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border shadow-lg transition-all animate-in slide-in-from-right ${
            status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
            status.type === 'syncing' ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' : 
            'bg-red-50 text-red-600 border-red-100'
          }`}>
            {status.message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Campus Sections</h2>
            <div className="flex gap-2">
              <label className="p-3 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-2xl cursor-pointer hover:bg-sky-100 transition-all shadow-sm border border-sky-100 dark:border-sky-800">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                <input type="file" ref={classFileInputRef} accept=".xml" className="hidden" onChange={handleClassBulkUpload} disabled={isBulkProcessing} />
              </label>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input placeholder="New Section Name" value={newClass} onChange={e => setNewClass(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" />
            <select value={targetSection} onChange={e => setTargetSection(e.target.value as SectionType)} className="px-6 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl font-black text-[10px] uppercase dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]">
              <option value="PRIMARY">Primary</option>
              <option value="SECONDARY_BOYS">Sec Boys</option>
              <option value="SECONDARY_GIRLS">Sec Girls</option>
              <option value="SENIOR_SECONDARY_BOYS">Senior Boys</option>
              <option value="SENIOR_SECONDARY_GIRLS">Senior Girls</option>
            </select>
            <button onClick={addClass} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/5">Register</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
            {currentClasses.map(c => (
              <div key={c.id} className="group relative p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 flex flex-col justify-center">
                <button onClick={() => removeClass(c.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110 active:scale-90 z-10"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
                <p className="font-black text-xs text-[#001f3f] dark:text-white">{c.name}</p>
                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1">{c.section.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Institutional Rooms</h2>
            <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-lg border border-amber-100 dark:border-amber-800">Resource Registry</span>
          </div>
          <div className="flex gap-3">
            <input placeholder="Room Identifier" value={newRoom} onChange={e => setNewRoom(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-emerald-400" />
            <button onClick={addRoom} className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-emerald-700 transition-all">Authorize</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
            {currentRooms.map(r => (
              <div key={r} className="group relative p-4 bg-emerald-50/30 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100/50 dark:border-emerald-900/50 flex flex-col items-center justify-center text-center">
                 <button onClick={() => removeRoom(r)} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
                 <svg className="w-6 h-6 text-emerald-500/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                 <p className="font-black text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-tighter truncate w-full">{r}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Curriculum Catalog</h2>
            <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border dark:border-slate-700">
               {Object.values(SubjectCategory).map(cat => (
                 <button key={cat} onClick={() => setTargetCategory(cat)} className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase transition-all ${targetCategory === cat ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{cat.replace(/_/g, ' ')}</button>
               ))}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input placeholder="New Subject" value={newSubject} onChange={e => setNewSubject(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-sky-400" />
            <button onClick={addSubject} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-slate-950 transition-all border border-white/5">Authorize</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {currentSubjects.filter(s => s.category === targetCategory).map(s => (
              <div key={s.id} className="group relative p-4 bg-sky-50/30 dark:bg-sky-950/10 rounded-2xl border border-sky-100 dark:border-sky-800/50 flex flex-col justify-center transition-all hover:bg-sky-50 dark:hover:bg-sky-900/20">
                <button onClick={() => removeSubject(s.id)} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
                <p className="font-black text-[10px] text-sky-700 dark:text-sky-400 uppercase tracking-tighter truncate">{s.name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminConfigView;
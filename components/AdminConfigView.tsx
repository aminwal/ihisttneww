
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SchoolConfig, SectionType, Subject, SchoolClass, SubjectCategory } from '../types.ts';
import { supabase } from '../supabaseClient.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig }) => {
  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newClass, setNewClass] = useState('');
  const [targetSection, setTargetSection] = useState<SectionType>('PRIMARY');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'syncing', message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const classFileInputRef = useRef<HTMLInputElement>(null);
  const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

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
    setStatus({ type: 'syncing', message: 'Synchronizing with Cloud Registry...' });
    try {
      const { error } = await supabase
        .from('school_config')
        .upsert({ id: 'primary_config', config_data: updatedConfig }, { onConflict: 'id' });
      
      if (error) throw error;
      setStatus({ type: 'success', message: 'Cloud Integrity Verified.' });
    } catch (err: any) {
      console.error("IHIS Config Sync Error:", err);
      setStatus({ type: 'error', message: `Cloud Handshake Failed: ${err.message}` });
    }
  };

  const addSubject = async () => {
    if (!newSubject.trim()) return;
    const subject: Subject = { 
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
      name: newSubject.trim(),
      category: targetCategory
    };
    const updated = { ...config, subjects: [...config.subjects, subject] };
    setConfig(updated);
    setNewSubject('');
    await syncConfiguration(updated);
  };

  const removeSubject = async (id: string) => {
    if (confirm("Remove this subject from institutional catalog?")) {
      const updated = { ...config, subjects: config.subjects.filter(s => s.id !== id) };
      setConfig(updated);
      await syncConfiguration(updated);
    }
  };

  const addClass = async () => {
    if (!newClass.trim()) return;
    const exists = config.classes.some(c => c.name.toLowerCase() === newClass.trim().toLowerCase());
    if (exists) {
      setStatus({ type: 'error', message: `Section "${newClass}" already exists.` });
      return;
    }
    const cls: SchoolClass = { 
      id: `cls-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
      name: newClass.trim(), 
      section: targetSection 
    };
    const updated = { ...config, classes: [...config.classes, cls] };
    setConfig(updated);
    setNewClass(''); // Corrected reset field
    await syncConfiguration(updated);
  };

  const removeClass = async (id: string, name: string) => {
    const updated = {
      ...config,
      classes: config.classes.filter(c => {
        if (c.id && id) return c.id !== id;
        return c.name !== name;
      })
    };
    setConfig(updated);
    setConfirmDeleteId(null);
    await syncConfiguration(updated);
  };

  const downloadClassTemplate = () => {
    const xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="sHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#001F3F" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Campus Configuration">
  <Table>
   <Column ss:Width="150"/>
   <Column ss:Width="200"/>
   <Row ss:Height="25" ss:StyleID="sHeader">
    <Cell><Data ss:Type="String">ClassName</Data></Cell>
    <Cell><Data ss:Type="String">SectionType</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">XI A</Data></Cell>
    <Cell><Data ss:Type="String">Senior Secondary (Boys)</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DataValidation>
    <Range>R2C2:R500C2</Range>
    <Type>List</Type>
    <Value>&quot;Primary Wing,Secondary (Boys),Secondary (Girls),Senior Secondary (Boys),Senior Secondary (Girls)&quot;</Value>
   </DataValidation>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ihis_campus_template.xml");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClassBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const newClasses: SchoolClass[] = [];
      if (content.trim().startsWith('<?xml')) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const rows = xmlDoc.getElementsByTagName("Row");
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
          const typeDisplay = getCellData(1).toLowerCase().trim();
          if (!name || name.toLowerCase() === 'classname') continue;

          const section = SECTION_DISPLAY_MAP[typeDisplay] || 'PRIMARY';
          const exists = config.classes.some(c => c.name.toLowerCase() === name.toLowerCase());
          if (!exists) newClasses.push({ id: `cls-bulk-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, name, section });
        }
      }
      if (newClasses.length > 0) {
        const updated = { ...config, classes: [...config.classes, ...newClasses] };
        setConfig(updated);
        await syncConfiguration(updated);
      } else setStatus({ type: 'error', message: "No new records found. Ensure XML format is valid." });
      if (classFileInputRef.current) classFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const groupedSubjects = useMemo(() => {
    const groups: Record<SubjectCategory, Subject[]> = {
      [SubjectCategory.CORE]: [],
      [SubjectCategory.LANGUAGE_2ND]: [],
      [SubjectCategory.LANGUAGE_2ND_SENIOR]: [],
      [SubjectCategory.LANGUAGE_3RD]: [],
      [SubjectCategory.RME]: [],
    };
    config.subjects.forEach(s => groups[s.category].push(s));
    return groups;
  }, [config.subjects]);

  const getCategoryTheme = (category: SubjectCategory) => {
    switch (category) {
      case SubjectCategory.CORE: return { bg: 'bg-indigo-50 dark:bg-indigo-950/20', text: 'text-indigo-600', border: 'border-indigo-100', accent: 'text-indigo-500' };
      case SubjectCategory.LANGUAGE_2ND: return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600', border: 'border-amber-100', accent: 'text-amber-500' };
      case SubjectCategory.LANGUAGE_2ND_SENIOR: return { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600', border: 'border-orange-100', accent: 'text-orange-500' };
      case SubjectCategory.LANGUAGE_3RD: return { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600', border: 'border-emerald-100', accent: 'text-emerald-500' };
      case SubjectCategory.RME: return { bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-600', border: 'border-rose-100', accent: 'text-rose-500' };
    }
  };

  return (
    <div className="space-y-6 md:space-y-10 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic">Institutional Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Administrative Infrastructure Control</p>
        </div>
        {status && (
          <div className={`px-5 py-3 rounded-2xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in slide-in-from-right duration-300 ${status.type === 'error' ? 'bg-red-50 text-red-600 border-red-100 shadow-lg shadow-red-500/10' : status.type === 'syncing' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-lg shadow-emerald-500/10'}`}>
            {status.type === 'syncing' && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>}
            {status.type === 'success' && <div className="w-2 h-2 rounded-full bg-emerald-500"></div>}
            {status.message}
          </div>
        )}
      </div>

      <div className="bg-brand-navy p-6 md:p-10 rounded-[2.5rem] shadow-2xl border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-10 opacity-5 transform group-hover:scale-110 transition-transform"><svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
          <div className="flex items-center space-x-6 w-full md:w-auto relative z-10">
            <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
              <svg className="w-7 h-7 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </div>
            <div>
              <h3 className="text-xl font-black text-white italic leading-tight uppercase tracking-tight">Public Timetable Policy</h3>
              <p className="text-[9px] font-black text-amber-200/50 uppercase tracking-[0.4em] mt-1">Gatekeeper Access Protocols</p>
            </div>
          </div>
          <button 
            onClick={() => {
              const updated = { ...config, hideTimetableFromTeachers: !config.hideTimetableFromTeachers };
              setConfig(updated);
              syncConfiguration(updated);
            }}
            className={`w-full md:w-auto px-10 py-5 rounded-[2rem] font-black text-[10px] uppercase tracking-widest transition-all shadow-xl active:scale-95 border-2 ${config.hideTimetableFromTeachers ? 'bg-rose-600 text-white border-transparent' : 'bg-brand-gold text-brand-navy border-transparent'}`}
          >
            {config.hideTimetableFromTeachers ? 'Status: RESTRICTED' : 'Status: ACCESSIBLE'}
          </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Classes Panel */}
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col h-full">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xs font-black text-sky-500 uppercase tracking-[0.3em]">Campus Sections</h3>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Physical Division Registry</p>
            </div>
            <div className="flex gap-2">
               <button onClick={downloadClassTemplate} title="Download XML Template" className="w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-sky-600 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 hover:scale-105 transition-all">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
               </button>
               <label className="bg-[#001f3f] text-[#d4af37] px-5 py-2.5 rounded-xl text-[9px] font-black uppercase cursor-pointer flex items-center shadow-lg hover:bg-slate-900 transition-all border border-white/10">
                  Bulk Import
                  <input type="file" ref={classFileInputRef} accept=".xml" className="hidden" onChange={handleClassBulkUpload} />
               </label>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-[2rem] border border-slate-100 dark:border-slate-800 mb-8 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input placeholder="Division ID (e.g. XI A)..." className="w-full bg-white dark:bg-slate-900 border-2 border-transparent focus:border-sky-500 rounded-2xl px-6 py-4 text-sm font-bold dark:text-white outline-none transition-all shadow-sm" value={newClass} onChange={e => setNewClass(e.target.value)} />
              <select className="w-full bg-white dark:bg-slate-900 border-2 border-transparent focus:border-sky-500 rounded-2xl px-6 py-4 text-[10px] font-black uppercase dark:text-white outline-none transition-all shadow-sm" value={targetSection} onChange={e => setTargetSection(e.target.value as SectionType)}>
                <option value="PRIMARY">Primary Wing</option>
                <option value="SECONDARY_BOYS">Secondary (Boys)</option>
                <option value="SECONDARY_GIRLS">Secondary (Girls)</option>
                <option value="SENIOR_SECONDARY_BOYS">Senior Sec (Boys)</option>
                <option value="SENIOR_SECONDARY_GIRLS">Senior Sec (Girls)</option>
              </select>
            </div>
            <button onClick={addClass} className="w-full bg-sky-600 text-white py-4.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-sky-700 transition-all transform active:scale-95">Deploy Division Registry</button>
          </div>

          <div className="space-y-8 flex-1 overflow-y-auto pr-2 scrollbar-hide max-h-[500px]">
            {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS', 'SENIOR_SECONDARY_BOYS', 'SENIOR_SECONDARY_GIRLS'] as SectionType[]).map(section => {
              const sectionClasses = config.classes.filter(c => c.section === section);
              if (sectionClasses.length === 0) return null;
              return (
                <div key={section} className="space-y-3">
                  <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-l-2 border-sky-500 pl-3 leading-none">{section.replace(/_/g, ' ')}</h4>
                  <div className="flex flex-wrap gap-2.5">
                    {sectionClasses.map(c => {
                      const isConfirming = confirmDeleteId === (c.id || c.name);
                      return (
                        <div key={c.id || c.name} className={`flex items-center space-x-3 px-5 py-3 rounded-2xl border-2 text-[10px] font-black uppercase transition-all shadow-sm ${isConfirming ? 'bg-rose-50 border-rose-500 text-rose-600 animate-pulse' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 dark:text-slate-300'}`}>
                          <span>{c.name}</span>
                          {isConfirming ? (
                            <button onClick={() => removeClass(c.id, c.name)} className="text-rose-600 bg-white px-2 py-0.5 rounded shadow-sm hover:scale-105 active:scale-95">Purge</button>
                          ) : (
                            <button onClick={() => setConfirmDeleteId(c.id || c.name)} className="text-slate-300 hover:text-rose-500 ml-1 text-lg leading-none transition-colors">×</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Subjects Panel */}
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col h-full">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xs font-black text-amber-500 uppercase tracking-[0.3em]">Institutional Subjects</h3>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Academic Curriculum Catalog</p>
            </div>
            <span className="text-[10px] font-black bg-slate-50 dark:bg-slate-800 px-4 py-2 rounded-xl text-slate-400 border border-slate-100 dark:border-slate-700">{config.subjects.length} Units</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-[2rem] border border-slate-100 dark:border-slate-800 mb-8 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input placeholder="Subject Name..." className="w-full bg-white dark:bg-slate-900 border-2 border-transparent focus:border-amber-400 rounded-2xl px-6 py-4 text-sm font-bold dark:text-white outline-none transition-all shadow-sm" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
              <select className="w-full bg-white dark:bg-slate-900 border-2 border-transparent focus:border-amber-400 rounded-2xl px-6 py-4 text-[10px] font-black uppercase dark:text-white outline-none transition-all shadow-sm" value={targetCategory} onChange={e => setTargetCategory(e.target.value as SubjectCategory)}>
                <option value={SubjectCategory.CORE}>Core Academic</option>
                <option value={SubjectCategory.LANGUAGE_2ND}>2nd Lang Block</option>
                <option value={SubjectCategory.LANGUAGE_2ND_SENIOR}>Sr 2nd Block</option>
                <option value={SubjectCategory.LANGUAGE_3RD}>3rd Lang Block</option>
                <option value={SubjectCategory.RME}>RME Block</option>
              </select>
            </div>
            <button onClick={addSubject} className="w-full bg-[#001f3f] text-[#d4af37] py-4.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/5 transform active:scale-95">Authorize Curriculum Unit</button>
          </div>

          <div className="space-y-8 flex-1 overflow-y-auto pr-2 scrollbar-hide max-h-[500px]">
            {(Object.keys(groupedSubjects) as SubjectCategory[]).map(category => {
              const theme = getCategoryTheme(category);
              const subjects = groupedSubjects[category];
              if (subjects.length === 0) return null;
              return (
                <div key={category} className="space-y-4">
                  <h4 className={`text-[9px] font-black uppercase tracking-[0.2em] border-l-2 pl-3 leading-none ${theme?.accent}`}>{category.replace(/_/g, ' ')}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {subjects.map(s => (
                      <div key={s.id} className={`flex items-center justify-between p-4 ${theme?.bg} rounded-2xl border ${theme?.border} group relative transition-all hover:scale-105 hover:shadow-md`}>
                        <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300 truncate tracking-tight">{s.name}</span>
                        <button onClick={() => removeSubject(s.id)} className="text-red-500 font-black text-xl leading-none ml-2 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminConfigView;

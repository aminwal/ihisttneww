
import React, { useState, useMemo, useRef } from 'react';
import { SchoolConfig, SectionType, Subject, SchoolClass, SubjectCategory } from '../types.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig }) => {
  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newClass, setNewClass] = useState('');
  const [targetSection, setTargetSection] = useState<SectionType>('PRIMARY');
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const classFileInputRef = useRef<HTMLInputElement>(null);

  const SECTION_DISPLAY_MAP: Record<string, SectionType> = {
    'primary wing': 'PRIMARY',
    'secondary (boys)': 'SECONDARY_BOYS',
    'secondary (girls)': 'SECONDARY_GIRLS',
    'primary': 'PRIMARY',
    'secondary boys': 'SECONDARY_BOYS',
    'secondary girls': 'SECONDARY_GIRLS'
  };

  const addSubject = () => {
    if (!newSubject.trim()) return;
    const subject: Subject = { 
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
      name: newSubject.trim(),
      category: targetCategory
    };
    setConfig(prev => ({ ...prev, subjects: [...prev.subjects, subject] }));
    setNewSubject('');
    setStatus({ type: 'success', message: `Subject "${subject.name}" added.` });
  };

  const removeSubject = (id: string) => {
    if (confirm("Remove this subject from institutional catalog?")) {
      setConfig(prev => ({ ...prev, subjects: prev.subjects.filter(s => s.id !== id) }));
    }
  };

  const addClass = () => {
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
    setConfig(prev => ({ ...prev, classes: [...prev.classes, cls] }));
    setNewClass('');
    setStatus({ type: 'success', message: `Section "${cls.name}" deployed.` });
  };

  const removeClass = (id: string, name: string) => {
    setConfig(prev => ({
      ...prev,
      classes: prev.classes.filter(c => {
        if (c.id && id) return c.id !== id;
        return c.name !== name;
      })
    }));
    setConfirmDeleteId(null);
    setStatus({ type: 'success', message: "Section decommissioned." });
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
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="sHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#001F3F" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Campus Configuration">
  <Table>
   <Column ss:Width="150"/>
   <Column ss:Width="150"/>
   <Row ss:AutoFitHeight="0" ss:Height="25" ss:StyleID="sHeader">
    <Cell><Data ss:Type="String">ClassName</Data></Cell>
    <Cell><Data ss:Type="String">SectionType</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">I A</Data></Cell>
    <Cell><Data ss:Type="String">Primary Wing</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DataValidation>
    <Range>R2C2:R500C2</Range>
    <Type>List</Type>
    <Value>&quot;Primary Wing,Secondary (Boys),Secondary (Girls)&quot;</Value>
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
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newClasses: SchoolClass[] = [];
      let skipCount = 0;
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
            const dataNode = cell.getElementsByTagName("Data")[0] || 
                            cell.getElementsByTagNameNS("*", "Data")[0] ||
                            cell.querySelector('Data');
            return dataNode?.textContent?.trim() || '';
          };
          
          const name = getCellData(0);
          const typeDisplay = getCellData(1).toLowerCase().trim();

          if (!name || name.toLowerCase() === 'classname') continue;

          const section = SECTION_DISPLAY_MAP[typeDisplay] || 'PRIMARY';
          const exists = config.classes.some(c => c.name.toLowerCase() === name.toLowerCase()) || 
                         newClasses.some(c => c.name.toLowerCase() === name.toLowerCase());
          
          if (exists) skipCount++;
          else newClasses.push({ id: `cls-bulk-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, name, section });
        }
      }
      if (newClasses.length > 0) {
        setConfig(prev => ({ ...prev, classes: [...prev.classes, ...newClasses] }));
        setStatus({ type: 'success', message: `Bulk deployment successful. Imported ${newClasses.length} rooms.` });
      } else setStatus({ type: 'error', message: "Import failed or no new records found. Ensure XML format is valid." });
      
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
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white italic">School Config</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Admin Control Center</p>
        </div>
        {status && (
          <div className={`px-4 py-2 rounded-xl border text-[9px] font-black uppercase ${status.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {status.message}
          </div>
        )}
      </div>

      <div className="bg-brand-navy p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] shadow-xl border border-amber-400/20 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-4 w-full md:w-auto">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <div>
              <h3 className="text-sm md:text-lg font-black text-white italic leading-tight">Institutional Privacy Control</h3>
              <p className="text-[8px] font-black text-amber-200/50 uppercase tracking-[0.3em] mt-1">Timetable Access</p>
            </div>
          </div>
          <button 
            onClick={() => setConfig(prev => ({ ...prev, hideTimetableFromTeachers: !prev.hideTimetableFromTeachers }))}
            className={`w-full md:w-auto px-6 py-4 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${config.hideTimetableFromTeachers ? 'bg-red-500 text-white' : 'bg-brand-gold text-brand-navy'}`}
          >
            {config.hideTimetableFromTeachers ? 'Timetable: Restricted' : 'Timetable: Public'}
          </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Subjects Panel */}
        <div className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-lg border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Subjects Catalog</h3>
            <span className="text-[8px] font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg text-slate-400">{config.subjects.length} Units</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-100 dark:border-slate-800 mb-8 space-y-4">
            <div className="flex flex-col gap-3">
              <input placeholder="Name..." className="w-full bg-white dark:bg-slate-900 border rounded-xl px-4 py-3 text-xs font-bold dark:text-white" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
              <select className="w-full bg-white dark:bg-slate-900 border rounded-xl px-4 py-3 text-[10px] font-black uppercase dark:text-white" value={targetCategory} onChange={e => setTargetCategory(e.target.value as SubjectCategory)}>
                <option value={SubjectCategory.CORE}>Core Academic</option>
                <option value={SubjectCategory.LANGUAGE_2ND}>2nd Lang Block</option>
                <option value={SubjectCategory.LANGUAGE_2ND_SENIOR}>Sr 2nd Block</option>
                <option value={SubjectCategory.LANGUAGE_3RD}>3rd Lang Block</option>
                <option value={SubjectCategory.RME}>RME Block</option>
              </select>
            </div>
            <button onClick={addSubject} className="w-full bg-brand-navy text-brand-gold py-3 rounded-xl font-black text-[9px] uppercase shadow-lg">Register Subject</button>
          </div>

          <div className="space-y-6">
            {(Object.keys(groupedSubjects) as SubjectCategory[]).map(category => {
              const theme = getCategoryTheme(category);
              const subjects = groupedSubjects[category];
              if (subjects.length === 0) return null;
              return (
                <div key={category} className="space-y-3">
                  <h4 className={`text-[9px] font-black uppercase tracking-widest ${theme?.accent}`}>{category.replace(/_/g, ' ')}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {subjects.map(s => (
                      <div key={s.id} className={`flex items-center justify-between p-2 md:p-3 ${theme?.bg} rounded-xl border ${theme?.border} group relative`}>
                        <span className="text-[9px] md:text-[10px] font-black uppercase text-slate-700 dark:text-slate-300 truncate">{s.name}</span>
                        <button onClick={() => removeSubject(s.id)} className="text-red-500 font-black text-md leading-none ml-1 opacity-0 group-hover:opacity-100">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Classes Panel */}
        <div className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-lg border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-black text-sky-500 uppercase tracking-widest">Campus Sections</h3>
            <div className="flex gap-2">
               <button onClick={downloadClassTemplate} title="Download XML Template" className="w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-sky-600 rounded-lg shadow-sm border border-slate-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
               </button>
               <label className="bg-brand-navy text-brand-gold px-3 py-1.5 rounded-lg text-[8px] font-black uppercase cursor-pointer flex items-center">
                  Import
                  <input type="file" ref={classFileInputRef} accept=".xml" className="hidden" onChange={handleClassBulkUpload} />
               </label>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-100 dark:border-slate-800 mb-8 space-y-4">
            <div className="flex flex-col gap-3">
              <input placeholder="Room ID..." className="w-full bg-white dark:bg-slate-900 border rounded-xl px-4 py-3 text-xs font-bold dark:text-white" value={newClass} onChange={e => setNewClass(e.target.value)} />
              <select className="w-full bg-white dark:bg-slate-900 border rounded-xl px-4 py-3 text-[10px] font-black uppercase dark:text-white" value={targetSection} onChange={e => setTargetSection(e.target.value as SectionType)}>
                <option value="PRIMARY">Primary Wing</option>
                <option value="SECONDARY_BOYS">Secondary (Boys)</option>
                <option value="SECONDARY_GIRLS">Secondary (Girls)</option>
              </select>
            </div>
            <button onClick={addClass} className="w-full bg-sky-600 text-white py-3 rounded-xl font-black text-[9px] uppercase shadow-lg">Deploy Room</button>
          </div>

          <div className="space-y-6">
            {(['PRIMARY', 'SECONDARY_BOYS', 'SECONDARY_GIRLS'] as SectionType[]).map(section => (
              <div key={section} className="space-y-3">
                <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{section.replace('_', ' ')}</h4>
                <div className="flex flex-wrap gap-2">
                  {config.classes.filter(c => c.section === section).map(c => {
                    const isConfirming = confirmDeleteId === (c.id || c.name);
                    return (
                      <div key={c.id || c.name} className={`flex items-center space-x-2 px-3 py-2 rounded-xl border text-[10px] font-black uppercase transition-all ${isConfirming ? 'bg-red-50 border-red-500' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
                        <span className="text-slate-800 dark:text-slate-200">{c.name}</span>
                        {isConfirming ? (
                          <button onClick={() => removeClass(c.id, c.name)} className="text-red-500 ml-1 text-[8px] animate-pulse">Confirm</button>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(c.id || c.name)} className="text-red-300 hover:text-red-500 ml-1 text-md leading-none">×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminConfigView;

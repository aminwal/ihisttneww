
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { User, SchoolConfig, TimeTableEntry, ExamPaper, ExamSection, ExamQuestion, ExamBlueprintRow } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

declare var html2pdf: any;

interface ExamPreparerProps {
  user: User;
  config: SchoolConfig;
  timetable: TimeTableEntry[];
  isAuthorizedForRecord: (type: 'LESSON_PLAN' | 'EXAM_PAPER', record: any) => boolean;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const PRESET_PATTERNS: Record<string, ExamBlueprintRow[]> = {
  'STANDARD_MIDTERM': [
    { id: 'p1', sectionTitle: 'SECTION A: OBJECTIVE', type: 'MCQ', count: 10, marksPerQuestion: 1, bloomCategory: 'Recall' },
    { id: 'p2', sectionTitle: 'SECTION B: ANALYTICAL', type: 'SHORT_ANSWER', count: 5, toAttempt: 5, marksPerQuestion: 3, bloomCategory: 'Understanding' },
    { id: 'p3', sectionTitle: 'SECTION C: DESCRIPTIVE', type: 'DESCRIPTIVE', count: 3, toAttempt: 2, marksPerQuestion: 5, bloomCategory: 'Analysis' },
    { id: 'p4', sectionTitle: 'SECTION D: CASE STUDY', type: 'CASE_STUDY', count: 1, marksPerQuestion: 10, bloomCategory: 'Evaluation' },
  ],
  'QUIZ_UNIT_TEST': [
    { id: 'q1', sectionTitle: 'PART 1', type: 'MCQ', count: 10, marksPerQuestion: 1, bloomCategory: 'Recall' },
    { id: 'q2', sectionTitle: 'PART 2', type: 'SHORT_ANSWER', count: 5, marksPerQuestion: 2, bloomCategory: 'Understanding' },
  ]
};

const ExamPreparer: React.FC<ExamPreparerProps> = ({ user, config, timetable, isAuthorizedForRecord, isSandbox, addSandboxLog }) => {
  const [hasKey, setHasKey] = useState<boolean>(true);
  const examTypes = useMemo(() => config.examTypes || ['UNIT TEST', 'MIDTERM', 'FINAL TERM', 'MOCK EXAM'], [config.examTypes]);
  const questionTypesSuggestions = useMemo(() => config.questionTypes || ['MCQ', 'SHORT_ANSWER', 'DESCRIPTIVE', 'CASE_STUDY', 'TRUE/FALSE', 'FILL IN BLANKS', 'MATCHING'], [config.questionTypes]);
  
  const [topic, setTopic] = useState('');
  const [examType, setExamType] = useState<string>(examTypes[0] || 'UNIT TEST');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [examDate, setExamDate] = useState(formatBahrainDate());
  const [targetTotalMarks, setTargetTotalMarks] = useState(50);
  const [duration, setDuration] = useState(90);
  
  const [blueprintRows, setBlueprintRows] = useState<ExamBlueprintRow[]>(PRESET_PATTERNS.STANDARD_MIDTERM);

  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [generatedPaper, setGeneratedPaper] = useState<ExamPaper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const blueprintTotalMarks = useMemo(() => {
    return blueprintRows.reduce((sum, row) => {
      const multiplier = row.toAttempt || row.count;
      return sum + (multiplier * row.marksPerQuestion);
    }, 0);
  }, [blueprintRows]);

  const bloomAudit = useMemo(() => {
    const totals: Record<string, number> = { Recall: 0, Understanding: 0, Analysis: 0, Evaluation: 0 };
    blueprintRows.forEach(row => {
      const category = row.bloomCategory || 'Recall';
      const weight = (row.toAttempt || row.count) * row.marksPerQuestion;
      totals[category] = (totals[category] || 0) + weight;
    });
    return Object.entries(totals).map(([key, val]) => ({
      label: key,
      percent: Math.round((val / (blueprintTotalMarks || 1)) * 100)
    }));
  }, [blueprintRows, blueprintTotalMarks]);

  useEffect(() => {
    const checkKey = async () => {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
    };
    checkKey();
    const interval = setInterval(checkKey, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleLinkKey = async () => {
    HapticService.light();
    await window.aistudio.openSelectKey();
    setHasKey(true);
    setError(null);
  };

  const handleSyncMatrix = () => {
    const duty = timetable.find(t => t.teacherId === user.id);
    if (duty) {
      setGradeId(duty.gradeId);
      setSectionId(duty.sectionId);
      setSubject(duty.subject);
      HapticService.success();
    }
  };

  const handleBlueprintChange = (id: string, field: keyof ExamBlueprintRow, value: any) => {
    setBlueprintRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const addBlueprintRow = () => {
    setBlueprintRows([...blueprintRows, { id: generateUUID(), sectionTitle: `SECTION ${String.fromCharCode(65 + blueprintRows.length)}`, type: 'MCQ', count: 5, marksPerQuestion: 1, bloomCategory: 'Recall' }]);
  };

  const removeBlueprintRow = (id: string) => {
    setBlueprintRows(blueprintRows.filter(r => r.id !== id));
  };

  const shuffleArray = (array: any[]) => {
    const next = [...array];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };

  const executeScramble = () => {
    if (!generatedPaper) return;
    HapticService.success();
    const scrambled = { ...generatedPaper, version: (generatedPaper.version === 'A' ? 'B' : 'A') as 'A' | 'B' };
    scrambled.sections = scrambled.sections.map(sec => ({
      ...sec,
      questions: shuffleArray(sec.questions.map(q => ({
        ...q,
        options: q.options ? shuffleArray(q.options) : undefined
      })))
    }));
    setGeneratedPaper(scrambled);
  };

  const generateExamPaper = async () => {
    if (!hasKey) { setError("Matrix Link Missing."); return; }
    if (!gradeId || !subject) { setError("Grade and Subject must be selected."); return; }
    if (blueprintTotalMarks !== targetTotalMarks) {
      setError(`Mark Mismatch: Blueprint sum (${blueprintTotalMarks}) must match target marks (${targetTotalMarks}).`);
      return;
    }

    setIsGenerating(true);
    setReasoning("Architecting Exam Matrix...");
    setError(null);
    HapticService.light();

    const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
    const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        ACT: Expert Institutional Assessment Designer for ${SCHOOL_NAME}.
        TASK: Create a formal examination paper based STRTICLY on the provided lesson context.
        
        HEADER INFO:
        - TYPE: ${examType}
        - GRADE: ${gradeName} ${sectionName}
        - SUBJECT: ${subject}
        - TOPIC: ${topic}
        - MARKS: ${targetTotalMarks}
        - DURATION: ${duration} minutes
        
        BLUEPRINT SPECIFICATION:
        ${JSON.stringify(blueprintRows)}
        
        RULES:
        1. STRICLY follow the blueprint sections, custom question types, question counts, and marks per question.
        2. EXAM CONTENT SOURCE: Extract terminology, definitions, and concepts from the provided PDF of lessons.
        3. If type is MCQ, provide exactly 4 options.
        4. If type is MATCHING, provide lists to match.
        5. If type is TRUE/FALSE, provide simple statements.
        6. All questions must be high-rigor and aligned with institutional standards.
        7. Output JSON ONLY.
        
        SCHEMA: {
          "title": string,
          "totalMarks": number,
          "durationMinutes": number,
          "instructions": string[],
          "sections": [{
            "title": string,
            "totalMarks": number,
            "choiceInstruction": string (e.g. "Attempt any 5"),
            "questions": [{
              "id": string, "text": string, "type": string, "marks": number, "options": string[] (optional), "correctAnswer": string, "markingScheme": string
            }]
          }]
        }
      `;

      const contents: any[] = [{ text: prompt }];
      if (ocrImage) contents.push({ inlineData: { data: ocrImage.split(',')[1], mimeType: 'image/jpeg' } });
      if (pdfBase64) contents.push({ inlineData: { data: pdfBase64.split(',')[1], mimeType: 'application/pdf' } });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: contents },
        config: { responseMimeType: "application/json" }
      });

      setGeneratedPaper({ ...JSON.parse(response.text || "{}"), id: generateUUID(), authorId: user.id, version: 'A' });
      HapticService.success();
    } catch (err: any) { 
      setError(err.message || "Process Error."); 
    } finally { 
      setIsGenerating(false); 
      setReasoning(''); 
    }
  };

  const clearAssets = () => {
    setOcrImage(null);
    setPdfBase64(null);
    setPdfFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    HapticService.light();
  };

  const handlePrint = (elementId: string, filename: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const opt = { 
      margin: 10, filename, image: { type: 'jpeg', quality: 0.98 }, 
      html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 px-4 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Exam <span className="text-[#d4af37]">Preparer</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mt-2">Institutional Assessment Suite v9.5</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 space-y-8 no-print">
          {/* BLOOM RADAR */}
          <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 space-y-6">
             <h4 className="text-[10px] font-black text-amber-400 uppercase tracking-widest italic">Cognitive Rigor Projection</h4>
             <div className="space-y-4">
                {bloomAudit.map(audit => (
                  <div key={audit.label} className="space-y-1.5">
                     <div className="flex justify-between items-baseline">
                        <span className="text-[8px] font-black text-white/40 uppercase">{audit.label}</span>
                        <span className="text-[9px] font-black text-white italic">{audit.percent}%</span>
                     </div>
                     <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div style={{ width: `${audit.percent}%` }} className={`h-full transition-all duration-1000 ${audit.percent > 40 ? 'bg-amber-400' : 'bg-sky-400'}`}></div>
                     </div>
                  </div>
                ))}
             </div>
          </div>

          {/* BLUEPRINT ARCHITECT */}
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8">
            <div className="flex items-center justify-between">
               <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">Blueprint Architect</h3>
               <button onClick={addBlueprintRow} className="text-[8px] font-black text-sky-500 uppercase border-b border-sky-500">+ Section</button>
            </div>
            
            <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide pr-2">
               {blueprintRows.map((row) => (
                 <div key={row.id} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 relative group">
                    <button onClick={() => removeBlueprintRow(row.id)} className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-black opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">×</button>
                    
                    <div className="space-y-2">
                      <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Section Header</label>
                      <input 
                        className="w-full bg-white dark:bg-slate-950 p-2 rounded-lg font-black text-[10px] uppercase text-[#001f3f] dark:text-white outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400" 
                        value={row.sectionTitle} 
                        onChange={e => handleBlueprintChange(row.id, 'sectionTitle', e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                       <div className="space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Question Type</label>
                          <input 
                            list="question-types-list"
                            className="w-full p-2 bg-white dark:bg-slate-950 rounded-lg text-[9px] font-bold uppercase outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400"
                            value={row.type}
                            onChange={e => handleBlueprintChange(row.id, 'type', e.target.value.toUpperCase())}
                            placeholder="e.g. MCQ"
                          />
                          <datalist id="question-types-list">
                             {questionTypesSuggestions.map(t => <option key={t} value={t} />)}
                          </datalist>
                       </div>
                       <div className="space-y-1">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Complexity</label>
                          <select className="w-full p-2 bg-white dark:bg-slate-950 rounded-lg text-[9px] font-bold uppercase outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400" value={row.bloomCategory} onChange={e => handleBlueprintChange(row.id, 'bloomCategory', e.target.value)}>
                            <option value="Recall">Recall</option>
                            <option value="Understanding">Understanding</option>
                            <option value="Analysis">Analysis</option>
                            <option value="Evaluation">Evaluation</option>
                          </select>
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                       <div className="flex flex-col">
                          <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Total Qs</span>
                          <input type="number" className="p-2 bg-white dark:bg-slate-950 rounded-lg text-[9px] font-black outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400" value={row.count} onChange={e => handleBlueprintChange(row.id, 'count', parseInt(e.target.value) || 0)} />
                       </div>
                       <div className="flex flex-col">
                          <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Marks Each</span>
                          <input type="number" className="p-2 bg-white dark:bg-slate-950 rounded-lg text-[9px] font-black outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400" value={row.marksPerQuestion} onChange={e => handleBlueprintChange(row.id, 'marksPerQuestion', parseInt(e.target.value) || 0)} />
                       </div>
                    </div>
                 </div>
               ))}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-slate-700">
               <div className="flex flex-col">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Mark Balance</span>
                  <span className={`text-xl font-black italic ${blueprintTotalMarks === targetTotalMarks ? 'text-emerald-500' : 'text-rose-500'}`}>{blueprintTotalMarks} / {targetTotalMarks}</span>
               </div>
               {blueprintTotalMarks === targetTotalMarks ? (
                 <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg></div>
               ) : (
                 <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 animate-pulse shadow-sm">!</div>
               )}
            </div>
          </div>

          {/* DISPATCH CONFIG PANEL */}
          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-6">
            <div className="flex items-center justify-between"><h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Dispatch Config</h3><button onClick={handleSyncMatrix} title="Sync from Live Timetable" className="p-2 bg-white/10 rounded-xl text-amber-400 hover:bg-white/20 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button></div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1">
                    <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Exam Category</label>
                    <select value={examType} onChange={e => setExamType(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400 transition-all">
                        {examTypes.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                    </select>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Total Marks</label>
                    <input type="number" placeholder="Marks" value={targetTotalMarks} onChange={e => setTargetTotalMarks(parseInt(e.target.value) || 0)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400 transition-all" />
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1">
                    <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Grade Level</label>
                    <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400 transition-all">
                        <option value="" className="text-black">Select Grade...</option>
                        {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                    </select>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Section</label>
                    <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400 transition-all">
                        <option value="" className="text-black">Select Section...</option>
                        {config.sections.filter(s => s.gradeId === gradeId).map(s => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}
                    </select>
                 </div>
              </div>

              <div className="space-y-1">
                 <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Subject Domain</label>
                 <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400 transition-all">
                    <option value="" className="text-black">Select Subject...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
                 </select>
              </div>

              <div className="space-y-1">
                 <label className="text-[7px] font-black text-white/30 uppercase tracking-widest ml-2">Topic Scope</label>
                 <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enter chapters or specific topic details..." className="w-full h-24 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none" />
              </div>
              
              <div className="space-y-4">
                 <div className="flex justify-between items-center px-2">
                    <label className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Institutional Resource Vault</label>
                    {(pdfBase64 || ocrImage) && (
                      <button onClick={clearAssets} className="text-[7px] font-black text-rose-400 hover:text-rose-600 uppercase border-b border-rose-400/30">Clear Context</button>
                    )}
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <button onClick={() => pdfInputRef.current?.click()} className={`p-4 border-2 border-dashed rounded-2xl flex flex-col items-center gap-2 transition-all ${pdfBase64 ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/10 hover:border-white/20'}`}>
                      <svg className={`w-5 h-5 ${pdfBase64 ? 'text-emerald-400' : 'text-white/40'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                      <span className="text-[7px] font-black text-white/40 uppercase truncate w-full text-center">{pdfFileName || 'Lessons PDF'}</span>
                      <input type="file" ref={pdfInputRef} className="hidden" accept=".pdf" onChange={(e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setPdfFileName(file.name);
                        const reader = new FileReader(); reader.onload = () => setPdfBase64(reader.result as string); reader.readAsDataURL(file);
                      }} />
                   </button>
                   <button onClick={() => fileInputRef.current?.click()} className={`p-4 border-2 border-dashed rounded-2xl flex flex-col items-center gap-2 transition-all ${ocrImage ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/10 hover:border-white/20'}`}>
                      <svg className={`w-5 h-5 ${ocrImage ? 'text-emerald-400' : 'text-white/40'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      <span className="text-[7px] font-black text-white/40 uppercase">{ocrImage ? 'Pic Loaded' : 'Lesson Pic'}</span>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        const reader = new FileReader(); reader.onload = () => setOcrImage(reader.result as string); reader.readAsDataURL(file);
                      }} />
                   </button>
                 </div>
                 {!pdfBase64 && (
                   <p className="text-[8px] font-bold text-white/30 uppercase text-center px-4 italic leading-relaxed">Pro-Tip: Upload a PDF of all lessons to ensure maximum accuracy and alignment.</p>
                 )}
              </div>

              {error && (
                <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-[9px] font-black text-rose-500 uppercase text-center animate-pulse">
                  {error}
                </div>
              )}

              <button 
                onClick={generateExamPaper} 
                disabled={isGenerating || blueprintTotalMarks !== targetTotalMarks || !gradeId || !subject} 
                className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all disabled:opacity-30 disabled:grayscale"
              >
                {isGenerating ? 'Deploying Matrix...' : 'Create Exam Paper'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div id="exam-paper-matrix" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[900px] flex flex-col overflow-hidden relative">
              {generatedPaper ? (
                <div className="flex-1 flex flex-col">
                   <div className="p-6 border-b dark:border-slate-800 bg-slate-50/50 flex flex-wrap justify-between items-center gap-4 no-print sticky top-0 z-[60] backdrop-blur-md">
                      <div className="flex gap-2">
                         <button onClick={executeScramble} className="px-5 py-2.5 bg-amber-400 text-[#001f3f] rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">Scramble Set {generatedPaper.version === 'A' ? 'B' : 'A'}</button>
                         <button onClick={() => alert("Review dispatched to HOD.")} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg">Request Sign-off</button>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => setIsEditMode(!isEditMode)} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg transition-all ${isEditMode ? 'bg-rose-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>{isEditMode ? 'Finish Edits' : 'Edit Matrix'}</button>
                        <button onClick={() => handlePrint('exam-render-zone', `IHIS_${examType}_${subject}.pdf`)} className="px-5 py-2.5 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase shadow-lg">Export PDF</button>
                      </div>
                   </div>

                   <div id="exam-render-zone" className="p-12 md:p-24 text-black bg-white space-y-12">
                      <div className="flex flex-col items-center text-center border-b-2 border-black pb-10">
                         <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" className="w-24 h-24 mb-6" />
                         <h2 className="text-2xl font-black uppercase tracking-tight">{SCHOOL_NAME}</h2>
                         <p className="text-[11px] font-bold uppercase tracking-[0.2em] mt-2">Academic Year 2026-2027 • SET {generatedPaper.version}</p>
                         <div className="mt-8 flex gap-12 font-black text-sm uppercase italic">
                            <p>Grade: {config.grades.find(g => g.id === gradeId)?.name}</p>
                            <p>Subject: {subject}</p>
                            <p>Marks: {generatedPaper.totalMarks}</p>
                         </div>
                         <h3 className="text-3xl font-black uppercase italic tracking-tighter mt-12 underline underline-offset-8">{generatedPaper.title}</h3>
                      </div>

                      <div className="space-y-4">
                         <h4 className="text-[11px] font-black uppercase border-l-4 border-black pl-3">General Instructions</h4>
                         <ul className="text-xs font-bold list-disc ml-6 space-y-1">
                            {generatedPaper.instructions.map((ins, i) => <li key={i}>{ins}</li>)}
                         </ul>
                      </div>

                      <div className="space-y-12">
                         {generatedPaper.sections.map((sec, sIdx) => (
                           <section key={sIdx} className="space-y-8 break-inside-avoid">
                              <div className="border-b-2 border-black pb-2 flex justify-between items-end">
                                 <h4 className="text-lg font-black uppercase italic">{sec.title}</h4>
                                 <div className="text-right">
                                    <p className="text-[10px] font-black uppercase">{sec.totalMarks} Total Marks</p>
                                    <p className="text-[9px] font-bold text-slate-500 italic uppercase">{sec.choiceInstruction}</p>
                                 </div>
                              </div>
                              
                              <div className="space-y-8">
                                 {sec.questions.map((q, qIdx) => (
                                   <div key={q.id} className="relative pl-12 group/q">
                                      <span className="absolute left-0 top-0 text-lg font-black italic">Q{qIdx + 1}.</span>
                                      <div className="space-y-4">
                                         <div className="flex justify-between items-start gap-6">
                                            {isEditMode ? (
                                              <textarea 
                                                className="text-[15px] font-bold leading-relaxed flex-1 bg-amber-50 border-b border-amber-300 p-2 outline-none resize-none"
                                                value={q.text}
                                                onChange={(e) => {
                                                   const nextPaper = {...generatedPaper};
                                                   nextPaper.sections[sIdx].questions[qIdx].text = e.target.value;
                                                   setGeneratedPaper(nextPaper);
                                                }}
                                              />
                                            ) : (
                                              <p className="text-[15px] font-bold leading-relaxed flex-1">{q.text}</p>
                                            )}
                                            <span className="font-black text-sm">({q.marks})</span>
                                         </div>
                                         {q.options && (
                                           <div className="grid grid-cols-2 gap-x-12 gap-y-4 pl-4">
                                              {q.options.map((opt, oIdx) => (
                                                <div key={oIdx} className="flex gap-3 text-sm font-medium">
                                                   <span className="font-black">({String.fromCharCode(97 + oIdx)})</span>
                                                   {isEditMode ? (
                                                     <input 
                                                       className="w-full bg-amber-50 border-b border-amber-300 outline-none px-1"
                                                       value={opt}
                                                       onChange={(e) => {
                                                          const nextPaper = {...generatedPaper};
                                                          nextPaper.sections[sIdx].questions[qIdx].options![oIdx] = e.target.value;
                                                          setGeneratedPaper(nextPaper);
                                                       }}
                                                     />
                                                   ) : (
                                                     <span>{opt}</span>
                                                   )}
                                                </div>
                                              ))}
                                           </div>
                                         )}
                                      </div>
                                   </div>
                                 ))}
                              </div>
                           </section>
                         ))}
                      </div>

                      <div className="pt-20 text-center opacity-40 border-t border-slate-100">
                         <p className="text-[10px] font-black uppercase tracking-[0.5em]">--- END OF EXAMINATION ---</p>
                      </div>
                   </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center">
                   {isGenerating ? (
                     <div className="space-y-6">
                        <div className="w-16 h-16 border-8 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <p className="text-xl font-black uppercase tracking-[0.5em]">{reasoning || 'Calculating Matrix'}</p>
                     </div>
                   ) : (
                     <div className="space-y-4">
                        <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <p className="text-xl font-black uppercase tracking-[0.8em]">Awaiting Command Sequence</p>
                        <p className="text-[10px] font-black uppercase tracking-widest mt-4">Select Grade, Subject & Upload Lessons PDF to Begin</p>
                     </div>
                   )}
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default ExamPreparer;


import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User, SchoolConfig, TimeTableEntry, ExamPaper, ExamSection, ExamQuestion, ExamBlueprintRow } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { AIService } from '../services/geminiService.ts';

declare var html2pdf: any;

interface ExamPreparerProps {
  user: User;
  config: SchoolConfig;
  timetable: TimeTableEntry[];
  isAuthorizedForRecord: (type: 'LESSON_PLAN' | 'EXAM_PAPER', record: any) => boolean;
  showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
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

const ExamPreparer: React.FC<ExamPreparerProps> = ({ user, config, timetable, isAuthorizedForRecord, showToast, isSandbox, addSandboxLog }) => {
  const [hasKey, setHasKey] = useState<boolean>(true);
  const examTypes = useMemo(() => config.examTypes || ['UNIT TEST', 'MIDTERM', 'FINAL TERM', 'MOCK EXAM'], [config.examTypes]);
  
  const [topic, setTopic] = useState('');
  const [examName, setExamName] = useState('');
  const [examType, setExamType] = useState<string>(examTypes[0] || 'UNIT TEST');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [targetTotalMarks, setTargetTotalMarks] = useState(50);
  const [duration, setDuration] = useState(90);
  const [answerMode, setAnswerMode] = useState<'SAME_SHEET' | 'SEPARATE_SHEET'>('SEPARATE_SHEET');
  
  const [blueprintRows, setBlueprintRows] = useState<ExamBlueprintRow[]>(PRESET_PATTERNS.STANDARD_MIDTERM);

  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [generatedPaper, setGeneratedPaper] = useState<ExamPaper | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [aiFeedback, setAiFeedback] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [ocrFiles, setOcrFiles] = useState<{data: string, name: string, type: 'IMAGE' | 'PDF'}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncStatus = async () => {
    setHasKey(true);
  };

  useEffect(() => {
    syncStatus();
  }, []);

  const generateExamPaper = async () => {
    if (!gradeId || !subject) { setError("Grade and Subject must be selected."); return; }
    if (blueprintRows.reduce((sum, row) => sum + ((row.toAttempt || row.count) * row.marksPerQuestion), 0) !== targetTotalMarks) {
      setError(`Mark Mismatch: Blueprint sum must match target marks (${targetTotalMarks}).`);
      return;
    }

    setIsGenerating(true);
    setReasoning("Executing Client-Side Exam Logic...");
    setError(null);
    HapticService.light();

    const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
    const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';

    try {
      const prompt = `Construct a high-rigor examination paper for Ibn Al Hytham Islamic School (2026-2027).
                      EXAM NAME: ${examName || examType}, GRADE: ${gradeName} ${sectionName}, SUBJECT: ${subject}, TOPIC: ${topic}.
                      MARKS: ${targetTotalMarks}, DURATION: ${duration} mins.
                      ANSWER MODE: ${answerMode === 'SAME_SHEET' ? 'Students will write answers in the question paper itself. Provide space for writing answers.' : 'Separate answer sheets will be provided.'}
                      BLUEPRINT: ${JSON.stringify(blueprintRows)}.
                      
                      IMPORTANT ARCHITECTURAL RULES:
                      1. If multiple blueprint rows have the EXACT SAME "sectionTitle", you MUST group all questions from those rows into a SINGLE section with that title in the output JSON.
                      2. If a "type" field contains multiple types (e.g. "MCQ & Fill in the blanks"), distribute the "count" across those types appropriately within that section.
                      3. If ANSWER MODE is SAME_SHEET, for each question, include a "spaceLines" property (integer) indicating how many blank lines should be provided for the student to write their answer based on the marks and complexity.`;

      const contents: any[] = [];
      ocrFiles.forEach(f => contents.push({
        inlineData: { data: f.data.split(',')[1], mimeType: f.type === 'IMAGE' ? 'image/jpeg' : 'application/pdf' }
      }));

      const systemInstruction = "Lead Examination Architect at Ibn Al Hytham Islamic School. Provide purely structured JSON responses matching the ExamPaper schema.";

      const responseText = await AIService.executeEdge(prompt, systemInstruction);
      
      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      const paper = JSON.parse(cleanedText);
      setGeneratedPaper({ ...paper, id: generateUUID(), authorId: user.id, version: 'A', answerMode });
      HapticService.success();
    } catch (err: any) { 
      setError(err.message || "Matrix AI Execution Failed."); 
    } finally { 
      setIsGenerating(false); 
      setReasoning(''); 
    }
  };

  const refineExamPaper = async () => {
    if (!generatedPaper || !aiFeedback.trim()) return;
    
    setIsRefining(true);
    setReasoning("Refining Examination Matrix...");
    setError(null);
    HapticService.light();

    try {
      const prompt = `Refine the existing examination paper based on this teacher feedback: "${aiFeedback}".
                      
                      Existing Paper:
                      ${JSON.stringify(generatedPaper)}
                      
                      Maintain the same JSON structure.`;

      const systemInstruction = "Lead Examination Architect at Ibn Al Hytham Islamic School. Refine the paper while maintaining institutional rigor and standards.";
      
      const responseText = await AIService.executeEdge(prompt, systemInstruction);
      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      
      setGeneratedPaper(parsed);
      setAiFeedback('');
      HapticService.success();
    } catch (err: any) {
      console.error("Refinement Error:", err);
      setError("Refinement Failed: " + (err.message || "Matrix AI Execution Failed."));
    } finally {
      setIsRefining(false);
      setReasoning('');
    }
  };

  const generateParallelSet = async () => {
    if (!generatedPaper) return;
    
    setIsRefining(true);
    setReasoning("Architecting Parallel Set B...");
    setError(null);
    HapticService.light();

    try {
      const prompt = `Architect a "SET B" for this examination paper. 
                      The topics, difficulty level, and blueprint MUST remain identical to SET A, but the questions MUST be different.
                      
                      SET A Paper:
                      ${JSON.stringify(generatedPaper)}
                      
                      Return the new SET B in the same JSON structure. Change the "version" field to "B".`;

      const systemInstruction = "Lead Examination Architect at Ibn Al Hytham Islamic School. Create a parallel set that ensures examination security while maintaining identical assessment standards.";
      
      const responseText = await AIService.executeEdge(prompt, systemInstruction);
      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      
      setGeneratedPaper(parsed);
      HapticService.success();
      showToast?.("Parallel SET B generated successfully.", "success");
    } catch (err: any) {
      setError("Parallel Set Generation Failed: " + (err.message || "Matrix AI Execution Failed."));
    } finally {
      setIsRefining(false);
      setReasoning('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      const type = file.type.includes('image') ? 'IMAGE' : file.type.includes('pdf') ? 'PDF' : null;
      if (!type) return;
      const reader = new FileReader();
      reader.onload = () => setOcrFiles(prev => [...prev, { data: reader.result as string, name: file.name, type: type as any }]);
      reader.readAsDataURL(file);
    });
  };

  const updatePaperField = (field: keyof ExamPaper, value: any) => {
    if (!generatedPaper) return;
    setGeneratedPaper({ ...generatedPaper, [field]: value });
  };

  const updateSectionTitle = (sIdx: number, title: string) => {
    if (!generatedPaper) return;
    const newSections = [...generatedPaper.sections];
    newSections[sIdx] = { ...newSections[sIdx], title };
    setGeneratedPaper({ ...generatedPaper, sections: newSections });
  };

  const updateQuestion = (sIdx: number, qIdx: number, field: keyof ExamQuestion, value: any) => {
    if (!generatedPaper) return;
    const newSections = [...generatedPaper.sections];
    const newQuestions = [...newSections[sIdx].questions];
    newQuestions[qIdx] = { ...newQuestions[qIdx], [field]: value };
    newSections[sIdx] = { ...newSections[sIdx], questions: newQuestions };
    setGeneratedPaper({ ...generatedPaper, sections: newSections });
  };

  const handlePrint = (elementId: string, filename: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const opt = { 
      margin: 10, 
      filename, 
      image: { type: 'jpeg', quality: 1.0 }, 
      html2canvas: { scale: 2, useCORS: true }, 
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(element).save();
  };

  const handleBlueprintChange = (id: string, field: keyof ExamBlueprintRow, value: any) => {
    setBlueprintRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const addBlueprintRow = () => {
    setBlueprintRows([...blueprintRows, { id: generateUUID(), sectionTitle: `SECTION ${String.fromCharCode(65 + blueprintRows.length)}`, type: 'MCQ', count: 5, marksPerQuestion: 1, bloomCategory: 'Recall' }]);
  };

  const duplicateBlueprintRow = (row: ExamBlueprintRow) => {
    setBlueprintRows([...blueprintRows, { ...row, id: generateUUID() }]);
  };

  const removeBlueprintRow = (id: string) => {
    setBlueprintRows(blueprintRows.filter(r => r.id !== id));
  };

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

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 px-4 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Exam <span className="text-[#d4af37]">Preparer</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mt-2">SECURE CLOUD AI ENABLED • 2026-2027</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 space-y-8 no-print">
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

          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8">
            <div className="flex items-center justify-between">
               <h3 className="text-xs font-black text-[#001f3f] dark:text-white uppercase tracking-[0.3em] italic">Blueprint Architect</h3>
               <button onClick={addBlueprintRow} className="text-[8px] font-black text-sky-500 uppercase border-b border-sky-500">+ Section</button>
            </div>
            
            <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide pr-2">
               {blueprintRows.map((row, index) => {
                 const isMerged = blueprintRows.slice(0, index).some(r => r.sectionTitle === row.sectionTitle);
                 return (
                   <div key={row.id} className={`p-4 rounded-2xl border transition-all relative group ${isMerged ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200/30 ml-4' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
                      {isMerged && (
                        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-3 h-px bg-amber-400"></div>
                      )}
                      <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => duplicateBlueprintRow(row)} className="w-5 h-5 bg-sky-500 text-white rounded-full text-[10px] font-black shadow-lg" title="Duplicate Group">D</button>
                        <button onClick={() => removeBlueprintRow(row.id)} className="w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-black shadow-lg">×</button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">
                            {isMerged ? 'Merged into Section' : 'Section Header'}
                          </label>
                          {isMerged && <span className="text-[6px] font-black text-amber-500 uppercase">Linked</span>}
                        </div>
                        <input 
                          className="w-full bg-white dark:bg-slate-900 p-2 rounded-lg font-black text-[10px] uppercase text-[#001f3f] dark:text-white outline-none border border-slate-100 dark:border-slate-700 focus:border-amber-400" 
                          value={row.sectionTitle} 
                          onChange={e => handleBlueprintChange(row.id, 'sectionTitle', e.target.value)}
                        />
                      </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                       <input className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg text-[9px] font-bold uppercase outline-none" value={row.type} onChange={e => handleBlueprintChange(row.id, 'type', e.target.value.toUpperCase())} placeholder="Type" />
                       <select className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg text-[9px] font-bold uppercase outline-none" value={row.bloomCategory} onChange={e => handleBlueprintChange(row.id, 'bloomCategory', e.target.value)}>
                        <option value="Recall">Recall</option>
                        <option value="Understanding">Understanding</option>
                        <option value="Analysis">Analysis</option>
                        <option value="Evaluation">Evaluation</option>
                       </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                       <input type="number" className="p-2 bg-white dark:bg-slate-900 rounded-lg text-[9px] font-black outline-none" value={row.count} onChange={e => handleBlueprintChange(row.id, 'count', parseInt(e.target.value) || 0)} />
                       <input type="number" className="p-2 bg-white dark:bg-slate-900 rounded-lg text-[9px] font-black outline-none" value={row.marksPerQuestion} onChange={e => handleBlueprintChange(row.id, 'marksPerQuestion', parseInt(e.target.value) || 0)} />
                    </div>
                  </div>
                 );
               })}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-slate-700">
               <span className={`text-xl font-black italic ${blueprintTotalMarks === targetTotalMarks ? 'text-emerald-500' : 'text-rose-500'}`}>{blueprintTotalMarks} / {targetTotalMarks} Marks</span>
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-6">
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Dispatch Config</h3>
            <div className="space-y-4">
               <input 
                 type="text" 
                 value={examName} 
                 onChange={e => setExamName(e.target.value)} 
                 placeholder="Exam Name (e.g. Midterm 2026)" 
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" 
               />
               <div className="grid grid-cols-2 gap-4">
                 <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                    <option value="" className="text-black">Select Grade...</option>
                    {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                 </select>
                 <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                    <option value="" className="text-black">Select Subject...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
                 </select>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                   <label className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest ml-1">Max Marks</label>
                   <input 
                     type="number" 
                     value={targetTotalMarks} 
                     onChange={e => setTargetTotalMarks(parseInt(e.target.value) || 0)} 
                     className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" 
                   />
                 </div>
                 <div className="space-y-1">
                   <label className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest ml-1">Duration (m)</label>
                   <input 
                     type="number" 
                     value={duration} 
                     onChange={e => setDuration(parseInt(e.target.value) || 0)} 
                     className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" 
                   />
                 </div>
               </div>

               <div className="space-y-1">
                 <label className="text-[8px] font-black text-amber-400/60 uppercase tracking-widest ml-1">Answer Submission</label>
                 <select 
                   value={answerMode} 
                   onChange={e => setAnswerMode(e.target.value as any)} 
                   className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none"
                 >
                   <option value="SEPARATE_SHEET" className="text-black">Separate Answer Sheet</option>
                   <option value="SAME_SHEET" className="text-black">Write in Question Paper</option>
                 </select>
               </div>

               <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Exam Scope / Topics..." className="w-full h-24 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none" />
               
               <div className="space-y-2">
                  <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="w-full p-4 border-2 border-dashed border-white/10 rounded-2xl text-[10px] text-white/60 uppercase hover:border-amber-400 hover:text-white transition-all font-bold flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                    {ocrFiles.length > 0 ? `${ocrFiles.length} File(s) Attached` : 'Upload Reference Material'}
                  </button>
                  <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*,.pdf" onChange={handleFileUpload} />
               </div>

               <button onClick={generateExamPaper} disabled={isGenerating || !subject} className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all disabled:opacity-30">
                {isGenerating ? 'Processing Matrices...' : 'Create Exam Paper'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div id="exam-paper-matrix" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[900px] flex flex-col overflow-hidden relative">
              {generatedPaper ? (
                <div id="exam-render-zone" className="p-12 md:p-24 text-black bg-white space-y-12">
                   <div className="flex flex-col items-center text-center border-b-2 border-black pb-10">
                      <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" className="w-24 h-24 mb-6" />
                      <h2 className="text-2xl font-black uppercase tracking-tight">{SCHOOL_NAME}</h2>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] mt-2">Academic Year 2026-2027 • SET {generatedPaper.version}</p>
                   </div>

                   {generatedPaper.answerMode === 'SAME_SHEET' && (
                     <div className="grid grid-cols-12 gap-6 border-b-2 border-black pb-8">
                       <div className="col-span-6 space-y-1">
                         <p className="text-[10px] font-black uppercase tracking-widest">Student Name:</p>
                         <div className="border-b border-black h-8 w-full"></div>
                       </div>
                       <div className="col-span-3 space-y-1">
                         <p className="text-[10px] font-black uppercase tracking-widest">GR Number:</p>
                         <div className="border-b border-black h-8 w-full"></div>
                       </div>
                       <div className="col-span-3 space-y-1">
                         <p className="text-[10px] font-black uppercase tracking-widest">Section:</p>
                         <div className="border-b border-black h-8 w-full"></div>
                       </div>
                     </div>
                   )}
                                       <h3 className="text-3xl font-black uppercase italic tracking-tighter text-center">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={generatedPaper.title} 
                          onChange={e => updatePaperField('title', e.target.value)}
                          className="w-full bg-slate-50 border-2 border-amber-400/30 rounded-2xl px-6 py-3 text-center outline-none focus:border-amber-400"
                        />
                      ) : generatedPaper.title}
                    </h3>
                   <div className="space-y-12">
                      {generatedPaper.sections.map((sec, sIdx) => (
                        <section key={sIdx} className="space-y-8 break-inside-avoid">
                                                       <h4 className="text-lg font-black uppercase italic border-b-2 border-black pb-2">
                              {isEditing ? (
                                <input 
                                  type="text" 
                                  value={sec.title} 
                                  onChange={e => updateSectionTitle(sIdx, e.target.value)}
                                  className="w-full bg-slate-50 border border-amber-400/30 rounded-lg px-4 py-2 outline-none focus:border-amber-400"
                                />
                              ) : sec.title}
                            </h4>
                           <div className="space-y-8">
                              {sec.questions.map((q, qIdx) => (
                                <div key={q.id} className="relative pl-12">
                                   <span className="absolute left-0 top-0 text-lg font-black italic">Q{qIdx + 1}.</span>
                                                                       {isEditing ? (
                                      <div className="space-y-4">
                                        <textarea 
                                          value={q.text} 
                                          onChange={e => updateQuestion(sIdx, qIdx, 'text', e.target.value)}
                                          className="w-full bg-slate-50 border border-amber-400/30 rounded-xl p-4 text-sm font-bold outline-none focus:border-amber-400"
                                        />
                                        {q.options && (
                                          <div className="grid grid-cols-2 gap-4">
                                            {q.options.map((opt, oIdx) => (
                                              <input 
                                                key={oIdx}
                                                type="text"
                                                value={opt}
                                                onChange={e => {
                                                  const newOptions = [...(q.options || [])];
                                                  newOptions[oIdx] = e.target.value;
                                                  updateQuestion(sIdx, qIdx, 'options', newOptions);
                                                }}
                                                className="bg-slate-50 border border-amber-400/30 rounded-lg px-3 py-2 text-xs"
                                              />
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <>
                                        <p className="text-[15px] font-bold leading-relaxed">{q.text}</p>
                                        {q.options && (
                                          <div className="grid grid-cols-2 gap-x-12 gap-y-4 pl-4 mt-4">
                                             {q.options.map((opt, oIdx) => <div key={oIdx} className="text-sm font-medium">({String.fromCharCode(97 + oIdx)}) {opt}</div>)}
                                          </div>
                                        )}
                                        {!isEditing && generatedPaper.answerMode === 'SAME_SHEET' && q.spaceLines && (
                                          <div className="mt-4 space-y-2">
                                            {Array.from({ length: q.spaceLines }).map((_, i) => (
                                              <div key={i} className="border-b border-slate-300 h-6 w-full"></div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                 </div>
                              ))}
                           </div>
                        </section>
                      ))}
                   </div>

                   <div className="no-print pt-12 border-t border-slate-100 flex flex-wrap justify-center gap-4">
                      <div className="w-full flex flex-col md:flex-row gap-4 mb-6">
                         <div className="flex-1 relative">
                            <input 
                              type="text" 
                              value={aiFeedback}
                              onChange={e => setAiFeedback(e.target.value)}
                              placeholder="Refine exam with AI (e.g. 'Make it harder', 'Focus more on Algebra')..."
                              className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-6 py-4 text-xs font-medium outline-none focus:border-amber-400 transition-all"
                            />
                            <button 
                              onClick={refineExamPaper}
                              disabled={isRefining || !aiFeedback.trim()}
                              className="absolute right-2 top-2 bottom-2 bg-[#001f3f] text-[#d4af37] px-6 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-950 transition-all disabled:opacity-50"
                            >
                              {isRefining ? 'Refining...' : 'Refine with AI'}
                            </button>
                         </div>
                         <button 
                           onClick={() => setIsEditing(!isEditing)}
                           className={`px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all flex items-center gap-2 ${isEditing ? 'bg-emerald-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                         >
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                           {isEditing ? 'Finish Manual Edit' : 'Manual Edit Mode'}
                         </button>
                      </div>
                      
                      <button onClick={() => handlePrint('exam-render-zone', 'IHIS_ExamPaper.pdf')} className="bg-[#001f3f] text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all">Download PDF</button>
                      <button onClick={() => setGeneratedPaper(null)} className="bg-white text-slate-400 px-8 py-4 rounded-2xl font-black text-[10px] uppercase border border-slate-200">Reset Preparer</button>
                   </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center">
                   {isGenerating ? (
                     <p className="text-xl font-black uppercase tracking-[0.8em] animate-pulse">{reasoning}</p>
                   ) : error ? (
                     <div className="bg-rose-50 border border-rose-200 p-8 rounded-3xl text-center">
                        <p className="text-xs text-rose-500 font-black uppercase leading-relaxed">{error}</p>
                     </div>
                   ) : (
                     <p className="text-xl font-black uppercase tracking-[0.8em]">Awaiting Command Sequence</p>
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

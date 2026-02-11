
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User, SchoolConfig, TimeTableEntry, ExamPaper, ExamSection, ExamQuestion, ExamBlueprintRow } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { MatrixService } from '../services/matrixService.ts';

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
  
  const [topic, setTopic] = useState('');
  const [examType, setExamType] = useState<string>(examTypes[0] || 'UNIT TEST');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [targetTotalMarks, setTargetTotalMarks] = useState(50);
  const [duration, setDuration] = useState(90);
  
  const [blueprintRows, setBlueprintRows] = useState<ExamBlueprintRow[]>(PRESET_PATTERNS.STANDARD_MIDTERM);

  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [generatedPaper, setGeneratedPaper] = useState<ExamPaper | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  const syncStatus = async () => {
    const ready = await MatrixService.isReady();
    setHasKey(ready);
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
                      TYPE: ${examType}, GRADE: ${gradeName} ${sectionName}, SUBJECT: ${subject}, TOPIC: ${topic}.
                      MARKS: ${targetTotalMarks}, DURATION: ${duration} mins.
                      BLUEPRINT: ${JSON.stringify(blueprintRows)}.
                      Return valid JSON only matching the standard paper schema.`;

      const contents: any[] = [];
      if (ocrImage) contents.push({ inlineData: { data: ocrImage.split(',')[1], mimeType: 'image/jpeg' } });
      if (pdfBase64) contents.push({ inlineData: { data: pdfBase64.split(',')[1], mimeType: 'application/pdf' } });

      const configOverride = {
        systemInstruction: "Lead Examination Architect at Ibn Al Hytham Islamic School. Provide purely structured JSON responses.",
        responseMimeType: "application/json"
      };

      const response = await MatrixService.architectRequest(prompt, contents, configOverride);
      
      const cleanedText = response.text.replace(/```json|```/g, '').trim();
      setGeneratedPaper({ ...JSON.parse(cleanedText), id: generateUUID(), authorId: user.id, version: 'A' });
      HapticService.success();
    } catch (err: any) { 
      setError(err.message || "Matrix AI Execution Failed. Ensure API Key is configured."); 
    } finally { 
      setIsGenerating(false); 
      setReasoning(''); 
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
               {blueprintRows.map((row) => (
                 <div key={row.id} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 relative group">
                    <button onClick={() => removeBlueprintRow(row.id)} className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-black opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">×</button>
                    <div className="space-y-2">
                      <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-1">Section Header</label>
                      <input 
                        className="w-full bg-white dark:bg-slate-900 p-2 rounded-lg font-black text-[10px] uppercase text-[#001f3f] dark:text-white outline-none border border-slate-100 dark:border-slate-700" 
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
               ))}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-slate-700">
               <span className={`text-xl font-black italic ${blueprintTotalMarks === targetTotalMarks ? 'text-emerald-500' : 'text-rose-500'}`}>{blueprintTotalMarks} / {targetTotalMarks} Marks</span>
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-6">
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Dispatch Config</h3>
            <div className="space-y-4">
               <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Grade...</option>
                  {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
               </select>
               <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Subject...</option>
                  {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
               </select>
               <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Exam Scope / Topics..." className="w-full h-24 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none" />
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
                   <h3 className="text-3xl font-black uppercase italic tracking-tighter text-center">{generatedPaper.title}</h3>
                   <div className="space-y-12">
                      {generatedPaper.sections.map((sec, sIdx) => (
                        <section key={sIdx} className="space-y-8 break-inside-avoid">
                           <h4 className="text-lg font-black uppercase italic border-b-2 border-black pb-2">{sec.title}</h4>
                           <div className="space-y-8">
                              {sec.questions.map((q, qIdx) => (
                                <div key={q.id} className="relative pl-12">
                                   <span className="absolute left-0 top-0 text-lg font-black italic">Q{qIdx + 1}.</span>
                                   <p className="text-[15px] font-bold leading-relaxed">{q.text}</p>
                                   {q.options && (
                                     <div className="grid grid-cols-2 gap-x-12 gap-y-4 pl-4 mt-4">
                                        {q.options.map((opt, oIdx) => <div key={oIdx} className="text-sm font-medium">({String.fromCharCode(97 + oIdx)}) {opt}</div>)}
                                     </div>
                                   )}
                                </div>
                              ))}
                           </div>
                        </section>
                      ))}
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

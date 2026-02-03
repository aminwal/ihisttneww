
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { User, SchoolConfig, TimeTableEntry, ExamPaper, ExamSection, ExamQuestion, QuestionBankItem, ExamBlueprintRow } from '../types.ts';
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
  ],
  'ADVANCED_ANALYSIS': [
    { id: 'c1', sectionTitle: 'CRITICAL EVALUATION', type: 'DESCRIPTIVE', count: 4, toAttempt: 3, marksPerQuestion: 10, bloomCategory: 'Creation' },
    { id: 'c2', sectionTitle: 'CASE STUDY MATRIX', type: 'CASE_STUDY', count: 2, marksPerQuestion: 5, bloomCategory: 'Analysis' },
  ]
};

const ExamPreparer: React.FC<ExamPreparerProps> = ({ user, config, timetable, isAuthorizedForRecord }) => {
  // Key Readiness State
  const [hasKey, setHasKey] = useState<boolean>(true);

  const examTypes = useMemo(() => config.examTypes || ['UNIT TEST', 'MIDTERM', 'FINAL TERM', 'MOCK EXAM'], [config.examTypes]);
  const questionTypes = useMemo(() => config.questionTypes || ['MCQ', 'SHORT_ANSWER', 'DESCRIPTIVE', 'CASE_STUDY'], [config.questionTypes]);
  
  const [topic, setTopic] = useState('');
  const [examType, setExamType] = useState<string>(examTypes[0] || 'UNIT TEST');
  const [gradeId, setGradeId] = useState('');
  const [subject, setSubject] = useState('');
  const [examDate, setExamDate] = useState(formatBahrainDate());
  const [targetTotalMarks, setTargetTotalMarks] = useState(50);
  const [duration, setDuration] = useState(90);
  const [syllabusKey, setSyllabusKey] = useState('CBSE');
  
  const [blueprintRows, setBlueprintRows] = useState<ExamBlueprintRow[]>([
    { id: generateUUID(), sectionTitle: 'SECTION A', type: 'MCQ', count: 5, marksPerQuestion: 1, bloomCategory: 'Recall' }
  ]);

  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [generatedPaper, setGeneratedPaper] = useState<ExamPaper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'STANDARD' | 'TWO_COLUMN'>('STANDARD');
  const [showWatermark, setShowWatermark] = useState(true);

  // PDF Ingest
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkApiKeyPresence();
  }, []);

  const checkApiKeyPresence = async () => {
    const key = process.env.API_KEY;
    if (!key || key === 'undefined' || key === '') {
      const hasSelected = await window.aistudio.hasSelectedApiKey();
      setHasKey(hasSelected);
    } else {
      setHasKey(true);
    }
  };

  const handleLinkKey = async () => {
    HapticService.light();
    await window.aistudio.openSelectKey();
    setHasKey(true);
    setError(null);
  };

  const blueprintTotalMarks = useMemo(() => {
    return blueprintRows.reduce((sum, row) => {
      const multiplier = row.toAttempt || row.count;
      return sum + (multiplier * row.marksPerQuestion);
    }, 0);
  }, [blueprintRows]);

  const currentPaperMarks = useMemo(() => {
    if (!generatedPaper) return 0;
    return generatedPaper.sections.reduce((acc, sec) => {
      const blueprintSec = blueprintRows.find(b => b.sectionTitle === sec.title);
      if (blueprintSec?.toAttempt) {
        return acc + (blueprintSec.toAttempt * blueprintSec.marksPerQuestion);
      }
      return acc + (sec.totalMarks || 0);
    }, 0);
  }, [generatedPaper, blueprintRows]);

  const handleSyncMatrix = () => {
    const duty = timetable.find(t => t.teacherId === user.id);
    if (duty) {
      setGradeId(duty.gradeId);
      setSubject(duty.subject);
      HapticService.success();
    } else {
      setError("No active duty linked to your ID in the timetable matrix.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setIsPdfLoading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setPdfBase64(base64);
      setIsPdfLoading(false);
    };
    reader.onerror = () => {
      setError("Failed to read PDF file.");
      setIsPdfLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const addBlueprintRow = () => {
    setBlueprintRows([...blueprintRows, { 
      id: generateUUID(), 
      sectionTitle: `SECTION ${String.fromCharCode(65 + blueprintRows.length)}`, 
      type: questionTypes[0] || 'SHORT_ANSWER', 
      count: 2, 
      marksPerQuestion: 2, 
      bloomCategory: 'Understanding' 
    }]);
    HapticService.light();
  };

  const updateBlueprintRow = (id: string, field: keyof ExamBlueprintRow, value: any) => {
    setBlueprintRows(blueprintRows.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const removeBlueprintRow = (id: string) => {
    if (blueprintRows.length <= 1) return;
    setBlueprintRows(blueprintRows.filter(row => row.id !== id));
    HapticService.light();
  };

  const applyPreset = (key: string) => {
    setBlueprintRows(PRESET_PATTERNS[key].map(row => ({ ...row, id: generateUUID() })));
    HapticService.success();
  };

  const generateExamPaper = async (refinement: string = "", isParallelVersion: boolean = false) => {
    if (!hasKey) {
      setError("API Key Selection Required. Click the Matrix Link button.");
      return;
    }

    const isUpdating = (!!refinement || isParallelVersion) && !!generatedPaper;
    if (isUpdating) setReasoning("Refining Exam Layout...");
    else setIsGenerating(true);
    
    setError(null);
    HapticService.light();

    const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
    const wingId = config.grades.find(g => g.id === gradeId)?.wingId || '';

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let promptText = "";
      if (isParallelVersion && generatedPaper) {
        promptText = `GENERATE PARALLEL VERSION (SET B). ORIGINAL: ${JSON.stringify(generatedPaper)}. Output JSON ONLY.`;
      } else if (isUpdating && generatedPaper) {
        promptText = `REFINE PAPER. REQUEST: "${refinement}". CURRENT: ${JSON.stringify(generatedPaper)}. Output JSON ONLY.`;
      } else {
        const blueprintSummary = blueprintRows.map(row => {
          const choiceText = row.toAttempt && row.toAttempt < row.count 
            ? `(Choice: Answer any ${row.toAttempt} out of ${row.count})` 
            : `(All ${row.count} required)`;
          return `- ${row.sectionTitle}: Type: ${row.type}, Qty: ${row.count}, Marks: ${row.marksPerQuestion} each. ${choiceText}. Bloom: ${row.bloomCategory}`;
        }).join('\n');

        promptText = `
          Create a formal examination question paper for ${SCHOOL_NAME}, Bahrain.
          CONTEXT: Type: ${examType}, Grade: ${gradeName}, Subject: ${subject}, Target Marks: ${targetTotalMarks}, Duration: ${duration}m.
          Syllabus: ${syllabusKey}. 
          TOPIC: ${topic}

          STRICT BLUEPRINT (TABLE OF SPECIFICATIONS):
          You MUST structure the exam into these sections exactly. 
          
          BLUEPRINT DETAILS:
          ${blueprintSummary}

          Output JSON ONLY.
        `;
      }

      const contents: any[] = [];
      if (!isUpdating && pdfBase64) {
        contents.push({ inlineData: { data: pdfBase64, mimeType: 'application/pdf' } });
      }
      contents.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: contents },
        config: { responseMimeType: "application/json", temperature: 0.7 }
      });

      const data: ExamPaper = JSON.parse(response.text || "{}");
      setGeneratedPaper({ 
        ...data, 
        id: `exam-${Date.now()}`, 
        subject, 
        gradeId, 
        wingId, 
        authorId: user.id,
        status: 'DRAFT', 
        version: isParallelVersion ? 'B' : 'A', 
        blueprint: blueprintRows 
      });
      HapticService.success();
    } catch (err: any) {
      if (err.message?.includes("API Key")) setHasKey(false);
      setError("System connection interrupted. Check connection.");
    } finally {
      setIsGenerating(false);
      setReasoning('');
    }
  };

  const updateManualField = (path: string, value: any) => {
    if (!generatedPaper) return;
    const newPaper = { ...generatedPaper };
    const parts = path.split('.');
    let current: any = newPaper;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (Array.isArray(current[key])) {
            current[key] = [...current[key]];
        } else {
            current[key] = { ...current[key] };
        }
        current = current[key];
    }
    current[parts[parts.length - 1]] = value;
    setGeneratedPaper(newPaper);
  };

  const handlePrint = (elementId: string, filename: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const opt = { margin: 10, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save();
  };

  const canSeeCurrentPaper = useMemo(() => {
    if (!generatedPaper) return true;
    return isAuthorizedForRecord('EXAM_PAPER', generatedPaper);
  }, [generatedPaper, isAuthorizedForRecord]);

  if (generatedPaper && !canSeeCurrentPaper) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] text-center space-y-4 animate-in fade-in">
         <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center text-rose-500 mx-auto shadow-lg border border-rose-100">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
         </div>
         <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Security Blocked</h3>
         <p className="text-sm font-medium text-slate-500 max-w-md mx-auto italic">This examination document is protected by the Institutional Security Layer.</p>
         <button onClick={() => setGeneratedPaper(null)} className="px-10 py-4 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-widest mt-6">Return to Preparer</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Exam <span className="text-[#d4af37]">Preparer</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Institutional Assessment Suite v6.0</p>
        </div>

        {!hasKey && (
          <button 
            onClick={handleLinkKey}
            className="px-6 py-3 bg-amber-400 text-[#001f3f] rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-3 animate-bounce hover:animate-none transition-all"
          >
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
            Establish Matrix Link
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 space-y-8 no-print">
          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Exam Setup</h3>
              <button onClick={handleSyncMatrix} className="p-2 bg-white/10 rounded-xl text-amber-400 hover:bg-white/20 transition-all shadow-lg" title="Link current duty data"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
            </div>
            
            <div className="space-y-4">
              <div onClick={() => fileInputRef.current?.click()} className={`p-6 border-2 border-dashed rounded-[2rem] transition-all cursor-pointer text-center ${pdfBase64 ? 'border-emerald-400 bg-emerald-400/5' : 'border-white/10 bg-white/5'}`}>
                <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf" onChange={handleFileChange} />
                {isPdfLoading ? <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div> : <span className="text-[9px] font-black text-white/40 uppercase">{pdfFileName || 'Upload Syllabus PDF'}</span>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-white/40 uppercase ml-2">Exam Category</label>
                  <select value={examType} onChange={e => setExamType(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                    {examTypes.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-white/40 uppercase ml-2">Exam Date</label>
                  <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Grade...</option>
                  {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                </select>
                <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Subject...</option>
                  {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                 <input type="number" value={targetTotalMarks} onChange={e => setTargetTotalMarks(parseInt(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" placeholder="Target Marks" />
                 <input type="number" value={duration} onChange={e => setDuration(parseInt(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" placeholder="Time (Min)" />
              </div>
              <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic details for question generation..." className="w-full h-24 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest italic">Exam Structure</h3>
              <div className="relative group">
                <button className="text-[8px] font-black text-sky-500 uppercase border border-sky-200 px-3 py-1 rounded-lg">Use Pattern</button>
                <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 shadow-2xl rounded-2xl p-2 z-[100] hidden group-hover:block border border-slate-100">
                  {Object.keys(PRESET_PATTERNS).map(k => <button key={k} onClick={() => applyPreset(k)} className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-[9px] font-black uppercase">{k.replace(/_/g, ' ')}</button>)}
                </div>
              </div>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide pr-1">
              {blueprintRows.map((row) => (
                <div key={row.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-3 group/row">
                  <div className="flex justify-between items-center">
                    <input 
                      value={row.sectionTitle} 
                      onChange={e => updateBlueprintRow(row.id, 'sectionTitle', e.target.value.toUpperCase())}
                      className="bg-transparent font-black text-[10px] uppercase text-sky-600 outline-none w-2/3"
                    />
                    <button onClick={() => removeBlueprintRow(row.id)} className="text-rose-400 hover:text-rose-600 opacity-0 group-hover/row:opacity-100 transition-opacity">×</button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2">
                      <label className="text-[7px] font-black text-slate-400 uppercase">Question Format</label>
                      <select 
                        value={row.type} 
                        onChange={e => updateBlueprintRow(row.id, 'type', e.target.value)} 
                        className="w-full bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none"
                      >
                        {questionTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[7px] font-black text-slate-400 uppercase">Qty</label>
                      <input type="number" min="1" value={row.count} onChange={e => updateBlueprintRow(row.id, 'count', parseInt(e.target.value) || 0)} className="w-full bg-white dark:bg-slate-900 px-2 py-1.5 rounded-lg text-[10px] font-black" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[7px] font-black text-slate-400 uppercase">Choice</label>
                      <input type="number" min="1" placeholder="All" value={row.toAttempt || ''} onChange={e => updateBlueprintRow(row.id, 'toAttempt', parseInt(e.target.value) || undefined)} className="w-full bg-white dark:bg-slate-900 px-2 py-1.5 rounded-lg text-[10px] font-black" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[7px] font-black text-slate-400 uppercase">Marks</label>
                      <input type="number" min="1" value={row.marksPerQuestion} onChange={e => updateBlueprintRow(row.id, 'marksPerQuestion', parseInt(e.target.value) || 0)} className="w-full bg-white dark:bg-slate-900 px-2 py-1.5 rounded-lg text-[10px] font-black" />
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addBlueprintRow} className="w-full py-3 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-[9px] font-black uppercase text-slate-400 hover:text-[#001f3f] transition-all">+ Add New Section</button>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <div className="flex justify-between items-center px-2">
                <span className="text-[9px] font-black text-slate-400 uppercase">Marks Balance</span>
                <div className={`px-4 py-1.5 rounded-full text-[11px] font-black italic shadow-lg transition-all ${blueprintTotalMarks === targetTotalMarks ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white animate-pulse'}`}>
                  {blueprintTotalMarks} / {targetTotalMarks}
                </div>
              </div>
            </div>

            {!hasKey ? (
              <button 
                onClick={handleLinkKey}
                className="w-full bg-amber-400 text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
                Connect Matrix Link
              </button>
            ) : (
              <button 
                onClick={() => generateExamPaper()} 
                disabled={isGenerating || blueprintTotalMarks !== targetTotalMarks} 
                className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 hover:text-white transition-all disabled:opacity-30"
              >
                {isGenerating ? reasoning || 'Generating Exam Paper...' : 'Create Exam Paper'}
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[800px] flex flex-col overflow-hidden relative">
            {generatedPaper && (
              <div className="p-6 border-b dark:border-slate-800 bg-slate-50/50 flex flex-wrap justify-between items-center gap-4 no-print sticky top-0 z-[60] backdrop-blur-md">
                 <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 shadow-inner">
                    <button onClick={() => setLayoutMode('STANDARD')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${layoutMode === 'STANDARD' ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Standard</button>
                    <button onClick={() => setLayoutMode('TWO_COLUMN')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${layoutMode === 'TWO_COLUMN' ? 'bg-[#001f3f] text-white' : 'text-slate-400'}`}>Two-Column</button>
                 </div>
                 <div className="flex gap-3">
                   <button onClick={() => setIsEditMode(!isEditMode)} className={`px-5 py-3 rounded-2xl text-[9px] font-black uppercase shadow-xl transition-all ${isEditMode ? 'bg-rose-500 text-white' : 'bg-amber-400 text-[#001f3f]'}`}>{isEditMode ? 'Done Editing' : 'Edit Questions'}</button>
                   <button onClick={() => handlePrint('exam-paper-print', `Exam_${generatedPaper.title}.pdf`)} className="px-5 py-3 bg-[#001f3f] text-white rounded-2xl text-[9px] font-black uppercase shadow-xl hover:bg-slate-800 transition-all">Export PDF</button>
                 </div>
              </div>
            )}

            <div className={`p-12 md:p-20 overflow-y-auto scrollbar-hide relative ${showWatermark && generatedPaper ? 'watermark-overlay' : ''}`}>
              {isGenerating ? (
                <div className="h-full flex flex-col items-center justify-center py-48 opacity-40 text-center">
                  <div className="w-20 h-20 border-8 border-slate-100 border-t-amber-400 rounded-full animate-spin mb-6 mx-auto"></div>
                  <p className="text-[10px] font-black uppercase tracking-[0.5em] animate-pulse">{reasoning || 'Designing Exam Structure...'}</p>
                </div>
              ) : generatedPaper ? (
                <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                  <div id="exam-paper-print" className="bg-white p-10 border border-slate-100 text-black min-h-[1000px] relative">
                    <div className="flex flex-col items-center text-center border-b-2 border-black pb-8 mb-12">
                      <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" className="w-20 h-20 mb-4" alt="Seal" />
                      <h2 className="text-2xl font-black uppercase leading-none">{SCHOOL_NAME}</h2>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Academic Year 2026-2027 • SET {generatedPaper.version}</p>
                      {isEditMode ? <input className="w-full text-center text-xl font-black uppercase tracking-tighter mt-8 bg-slate-50 border-b-2 border-amber-400 outline-none" value={generatedPaper.title} onChange={e => updateManualField('title', e.target.value)} /> : <h3 className="text-xl font-black uppercase tracking-tighter mt-8">{generatedPaper.title}</h3>}
                    </div>

                    <div className="grid grid-cols-2 gap-x-12 gap-y-4 mb-10 text-[11px] font-bold uppercase italic border-b pb-6">
                      <div className="flex justify-between border-b border-dotted pb-1"><span>Name: _____________________</span></div>
                      <div className="flex justify-between border-b border-dotted pb-1"><span>GR: ________</span></div>
                      <div className="flex justify-between border-b border-dotted pb-1"><span>Subject: {subject}</span></div>
                      <div className="flex justify-between border-b border-dotted pb-1"><span>Marks: {currentPaperMarks} / {targetTotalMarks}</span></div>
                      <div className="flex justify-between border-b border-dotted pb-1"><span>Time: {duration} Min</span></div>
                      <div className="flex justify-between border-b border-dotted pb-1"><span>Date: {examDate}</span></div>
                    </div>

                    <div className={`space-y-12 ${layoutMode === 'TWO_COLUMN' ? 'columns-2 gap-12' : ''}`}>
                      {generatedPaper.sections.map((section, sIdx) => (
                        <div key={sIdx} className="mb-12 break-inside-avoid">
                          <div className="border-b-2 border-black mb-6 pb-2">
                            <div className="flex justify-between items-center">
                              {isEditMode ? <input className="text-sm font-black uppercase bg-slate-50 outline-none w-2/3" value={section.title} onChange={e => updateManualField(`sections.${sIdx}.title`, e.target.value)} /> : <h4 className="text-sm font-black uppercase">{section.title}</h4>}
                              <span className="text-[10px] font-bold">[{section.totalMarks || 0} Marks]</span>
                            </div>
                            {section.choiceInstruction && <p className="text-[9px] font-black italic text-slate-500 uppercase mt-1">*{section.choiceInstruction}</p>}
                          </div>
                          <div className="space-y-10">
                            {section.questions.map((q, qIdx) => (
                              <div key={q.id} className="relative pl-10 group/q break-inside-avoid">
                                 <div className="absolute left-0 top-0 font-black text-base italic">Q{qIdx + 1}.</div>
                                 <div className="space-y-4">
                                    <div className="flex justify-between items-start gap-4">
                                       <div className="flex-1">
                                          {isEditMode ? (
                                            <textarea className="w-full text-[12px] font-bold leading-relaxed bg-slate-50 border-b-2 border-amber-200 outline-none resize-none" rows={2} value={q.text} onChange={e => updateManualField(`sections.${sIdx}.questions.${qIdx}.text`, e.target.value)} />
                                          ) : <p className="text-[13px] font-bold leading-relaxed">{q.text}</p>}
                                       </div>
                                       <span className="text-[10px] font-black">({q.marks})</span>
                                    </div>
                                    {q.options && (
                                      <div className="grid grid-cols-2 gap-x-8 gap-y-4 pl-4">
                                        {q.options.map((opt, i) => (
                                           <div key={i} className="text-[12px] font-medium flex gap-2">
                                              <span className="font-bold">{String.fromCharCode(97 + i)})</span>
                                              {isEditMode ? <input className="flex-1 bg-slate-50 outline-none" value={opt} onChange={e => { const newOpts = [...q.options!]; newOpts[i] = e.target.value; updateManualField(`sections.${sIdx}.questions.${qIdx}.options`, newOpts); }} /> : <span>{opt}</span>}
                                           </div>
                                        ))}
                                      </div>
                                    )}

                                    {isEditMode && (
                                      <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-100 dark:border-emerald-900 space-y-4 no-print">
                                        <div className="space-y-1">
                                          <label className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Correct Answer / Key</label>
                                          <input 
                                            className="w-full bg-white dark:bg-slate-900 px-4 py-3 rounded-xl text-xs font-bold border-2 border-emerald-100 dark:border-emerald-800 outline-none focus:border-emerald-400 transition-all" 
                                            value={q.correctAnswer} 
                                            onChange={e => updateManualField(`sections.${sIdx}.questions.${qIdx}.correctAnswer`, e.target.value)} 
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Marking Scheme / Logic</label>
                                          <textarea 
                                            className="w-full bg-white dark:bg-slate-900 px-4 py-3 rounded-xl text-xs font-bold border-2 border-emerald-100 dark:border-emerald-800 outline-none focus:border-emerald-400 transition-all resize-none" 
                                            rows={2}
                                            value={q.markingScheme} 
                                            onChange={e => updateManualField(`sections.${sIdx}.questions.${qIdx}.markingScheme`, e.target.value)} 
                                          />
                                        </div>
                                      </div>
                                    )}
                                 </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-12 py-48 opacity-10"><svg className="w-48 h-48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p className="text-xl font-black uppercase tracking-[0.8em]">Awaiting Exam Parameters</p></div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamPreparer;

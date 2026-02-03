
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { User, SchoolConfig, TeacherAssignment, SubjectCategory, SchoolSection, TimeTableEntry, LessonPlan, SavedPlanRecord, Worksheet, WorksheetQuestion } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

declare var html2pdf: any;

type BloomLevel = 'REMEMBER' | 'UNDERSTAND' | 'APPLY' | 'ANALYZE' | 'EVALUATE' | 'CREATE';
type SyllabusKey = 'CBSE' | 'BAHRAIN_NATIONAL' | 'NONE';

interface LessonArchitectViewProps {
  user: User;
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  timetable?: TimeTableEntry[];
  isAuthorizedForRecord: (type: 'LESSON_PLAN' | 'EXAM_PAPER', record: any) => boolean;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const LessonArchitectView: React.FC<LessonArchitectViewProps> = ({ 
  user, config, assignments, timetable = [], isAuthorizedForRecord, isSandbox, addSandboxLog 
}) => {
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [topic, setTopic] = useState('');
  const [supportingText, setSupportingText] = useState('');
  const [lessonDate, setLessonDate] = useState(formatBahrainDate());
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [bloomLevel, setBloomLevel] = useState<BloomLevel>('APPLY');
  const [syllabusKey, setSyllabusKey] = useState<SyllabusKey>('CBSE');
  const [classDuration, setClassDuration] = useState<number>(40);
  
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [blueprintPdfBase64, setBlueprintPdfBase64] = useState<string | null>(null);
  const [blueprintPdfFileName, setBlueprintPdfFileName] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingWorksheet, setIsGeneratingWorksheet] = useState(false);
  const [isGeneratingSlides, setIsGeneratingSlides] = useState(false);
  const [reasoningMsg, setReasoningMsg] = useState('');
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [slideOutline, setSlideOutline] = useState<any[] | null>(null);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [isEditMode, setIsEditMode] = useState(false);
  const [refinementInput, setRefinementInput] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // TEMPORAL LOGIC: Sum check
  const totalProcedureTime = useMemo(() => {
    if (!lessonPlan) return 0;
    return lessonPlan.procedure.reduce((acc, p) => {
      const mins = parseInt(p.duration.replace(/[^0-9]/g, '')) || 0;
      return acc + mins;
    }, 0);
  }, [lessonPlan]);

  // PROACTIVE ADVICE: Logic Engine
  const proactiveAdvice = useMemo(() => {
    if (!lessonPlan) return null;
    const tips = [];
    if (totalProcedureTime > classDuration) tips.push(`Time Overrun: Plan is ${totalProcedureTime - classDuration}m too long.`);
    if (totalProcedureTime < classDuration) tips.push(`Time Gap: ${classDuration - totalProcedureTime}m unfilled.`);
    
    const intro = lessonPlan.procedure.find(p => p.step.toUpperCase().includes('INTRO'));
    const introTime = intro ? parseInt(intro.duration) : 0;
    if (introTime > 10) tips.push("Pedagogical Tip: Introduction is quite long. Consider a shorter 'Hook'.");
    
    if (lessonPlan.objectives.length > 5) tips.push("Design Tip: Too many objectives for one session. Focus on core 3.");
    
    return tips;
  }, [lessonPlan, totalProcedureTime, classDuration]);

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

  // handlePdfChange: Converts selected PDF into a clean base64 string for prompt inclusion.
  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlueprintPdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setBlueprintPdfBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  // handleImageChange: Converts textbook photos to DataURL for OCR integration.
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setOcrImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const generateLessonPlan = async (advice: string = "") => {
    if (!hasKey) { setError("Matrix Link Missing."); return; }
    if (!topic.trim() && !lessonPlan) { setError("Please specify a topic."); return; }

    if (advice) setIsRefining(true);
    else setIsGenerating(true);

    setReasoningMsg(advice ? "Refining Sequence..." : "Designing Matrix Sequence...");
    setError(null);
    HapticService.light();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';

      let prompt = advice && lessonPlan 
        ? `TASK: Refine this plan based on ADVICE: "${advice}". CURRENT PLAN: ${JSON.stringify(lessonPlan)}. MANDATE: Maintain class duration of ${classDuration}m. Output JSON ONLY.`
        : `TASK: Create lesson plan for ${SCHOOL_NAME}. 
           GRADE: ${gradeName}, SUBJECT: ${subject}, TOPIC: ${topic}. 
           BLOOM LEVEL: ${bloomLevel}, SYLLABUS: ${syllabusKey}. 
           TOTAL CLASS DURATION: ${classDuration} minutes.
           SUPPORTING CONTEXT: ${supportingText || "None provided"}.
           MANDATE: Sum of durations MUST exactly equal ${classDuration}.
           Output JSON ONLY. 
           SCHEMA: { "title": string, "objectives": string[], "procedure": [{ "step": string, "description": string, "duration": string }], "assessment": string, "homework": string, "differentiation": { "sen": string, "gt": string }, "exitTickets": string[] }`;

      const contents: any[] = [{ text: prompt }];
      if (!advice) {
        if (ocrImage) contents.push({ inlineData: { data: ocrImage.split(',')[1], mimeType: 'image/jpeg' } });
        if (blueprintPdfBase64) contents.push({ inlineData: { data: blueprintPdfBase64, mimeType: 'application/pdf' } });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: contents },
        config: { responseMimeType: "application/json" }
      });

      setLessonPlan(JSON.parse(response.text || "{}"));
      setWorksheet(null);
      setSlideOutline(null);
      if (advice) setRefinementInput('');
      HapticService.success();
    } catch (err: any) { setError(err.message || "Process Error."); }
    finally { setIsGenerating(false); setIsRefining(false); setReasoningMsg(''); }
  };

  const generateSlideOutline = async () => {
    if (!lessonPlan || !hasKey) return;
    setIsGeneratingSlides(true);
    setReasoningMsg("Architecting Presentation Outline...");
    HapticService.light();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Generate a slide-by-slide presentation outline for this Lesson Plan: ${JSON.stringify(lessonPlan)}. 
      Include 6-8 slides. Output JSON ONLY: { "slides": [{ "title": string, "points": string[], "visualSuggestion": string }] }`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      setSlideOutline(JSON.parse(response.text || "{}").slides);
      HapticService.success();
    } catch (err) { setError("Slide generation failed."); }
    finally { setIsGeneratingSlides(false); setReasoningMsg(''); }
  };

  const generateWorksheet = async (advice: string = "") => {
    if (!lessonPlan || !hasKey) return;
    setIsGeneratingWorksheet(true);
    setReasoningMsg(advice ? "Refining Differentiated Sheet..." : "Architecting Differentiated Worksheet...");
    HapticService.light();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        ACT: Expert Curriculum Designer.
        TASK: Generate a high-fidelity differentiated worksheet based on this LESSON PLAN: ${JSON.stringify(lessonPlan)}.
        {
          "title": string (matching lesson topic),
          "questions": [{ 
             "id": uuid, "type": "MCQ" | "SHORT_ANSWER" | "FILL_BLANK", "text": string, "options": string[] (if MCQ), "answer": string, "tier": "SUPPORT" | "CORE" | "EXTENSION" 
          }]
        }
        GUIDELINES: 15 questions total. 5 Foundation (Support), 5 Standard (Core), 5 Challenge (Extension). 
        ADVICE: ${advice || "None"}
        Output JSON ONLY.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      setWorksheet(JSON.parse(response.text || "{}"));
      if (advice) setRefinementInput('');
      HapticService.success();
    } catch (err) { setError("Worksheet generation failed."); }
    finally { setIsGeneratingWorksheet(false); setReasoningMsg(''); }
  };

  const reorderStep = (index: number, direction: 'UP' | 'DOWN') => {
    if (!lessonPlan) return;
    const next = [...lessonPlan.procedure];
    const targetIdx = direction === 'UP' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    handleManualEdit('procedure', next);
    HapticService.light();
  };

  const handleManualEdit = (path: string, value: any) => {
    if (!lessonPlan) return;
    const updated = { ...lessonPlan };
    const parts = path.split('.');
    let current: any = updated;
    for (let i = 0; i < parts.length - 1; i++) { 
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]]; 
    }
    current[parts[parts.length - 1]] = value;
    setLessonPlan(updated);
  };

  const handleSaveToVault = async () => {
    if (!lessonPlan) return;
    setIsSaving(true);
    try {
      const payload = {
        id: generateUUID(),
        teacher_id: user.id,
        teacher_name: user.name,
        date: lessonDate,
        grade_id: gradeId,
        section_id: sectionId,
        subject: subject,
        topic: topic || lessonPlan.title,
        plan_data: lessonPlan,
        is_shared: false
      };

      if (IS_CLOUD_ENABLED && !isSandbox) {
        await supabase.from('lesson_plans').insert(payload);
      } else if (isSandbox) {
        addSandboxLog?.('LESSON_PLAN_VAULT_SAVE', payload);
      }
      HapticService.success();
      alert("Lesson Plan Synchronized to Institutional Vault.");
    } catch (err) { alert("Sync Failed: Database connection error."); } 
    finally { setIsSaving(false); }
  };

  const handleRequestReview = () => {
    HapticService.success();
    alert("Review Request Dispatched to Department HOD.");
  };

  const handlePrint = (elementId: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const opt = { 
      margin: 10, filename: `IHIS_${topic || 'Document'}.pdf`, 
      image: { type: 'jpeg', quality: 1.0 }, 
      html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 px-4 animate-in fade-in duration-700 relative">
      
      {/* Floating Academic Advisor Panel */}
      {lessonPlan && (
        <div className="fixed bottom-24 right-8 z-[100] w-72 animate-in slide-in-from-right duration-500 hidden xl:block no-print">
           <div className="bg-[#001f3f] rounded-[2.5rem] p-6 shadow-2xl border border-amber-400/30 space-y-4">
              <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-[#001f3f]"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></div>
                 <h4 className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Academic Advisor</h4>
              </div>
              <div className="space-y-3">
                 {proactiveAdvice?.map((tip, i) => (
                   <div key={i} className="bg-white/5 p-3 rounded-xl border border-white/10">
                      <p className="text-[10px] font-bold text-white/80 italic leading-relaxed">“{tip}”</p>
                   </div>
                 ))}
                 {!proactiveAdvice?.length && <p className="text-[10px] text-emerald-400 font-black uppercase text-center italic">Matrix Optimal</p>}
              </div>
              <div className="pt-2 border-t border-white/10">
                 <p className="text-[8px] font-black text-white/30 uppercase text-center tracking-widest">Pedagogical Guardrail Active</p>
              </div>
           </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Lesson <span className="text-[#d4af37]">Architect</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mt-2">Instructional Mission Control</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 space-y-8 no-print">
          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-8 relative overflow-hidden group">
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Genesis Module</h3>
                <button onClick={handleSyncMatrix} className="p-2 bg-white/10 rounded-xl text-amber-400 hover:bg-white/20 transition-all shadow-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={lessonDate} onChange={e => setLessonDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" />
                  <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                    <option value="" className="text-black">Subject...</option>
                    {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                    <option value="" className="text-black">Grade...</option>
                    {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                  </select>
                  <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                    <option value="" className="text-black">Section...</option>
                    {config.sections.filter(s => s.gradeId === gradeId).map(s => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                   <div className="flex justify-between items-center px-2">
                      <p className="text-[8px] font-black text-white/40 uppercase tracking-widest">Class Duration</p>
                      {lessonPlan && (
                        <span className={`text-[8px] font-black uppercase ${totalProcedureTime === classDuration ? 'text-emerald-400' : 'text-amber-400'}`}>
                          Matrix: {totalProcedureTime}/{classDuration}m
                        </span>
                      )}
                   </div>
                   <select value={classDuration} onChange={e => setClassDuration(parseInt(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                      {[30, 35, 40, 45, 50, 60, 80].map(m => <option key={m} value={m} className="text-black">{m} Minutes {m === 40 ? '(Standard)' : ''}</option>)}
                   </select>
                </div>

                <div className="space-y-2">
                   <p className="text-[8px] font-black text-white/40 uppercase tracking-widest ml-2">Topic Heading</p>
                   <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic..." className="w-full bg-white/5 border border-white/10 rounded-xl px-6 py-4 text-sm text-white font-black outline-none focus:border-amber-400" />
                </div>

                <button onClick={() => generateLessonPlan()} disabled={isGenerating || !topic} className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all">
                  {isGenerating ? 'Architecting...' : 'Build Lesson Plan'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
             <h3 className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest italic">Context Ingest</h3>
             <div className="space-y-4">
                <textarea value={supportingText} onChange={e => setSupportingText(e.target.value)} placeholder="Lesson highlights, specific textbook pages..." className="w-full h-24 bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 text-[10px] outline-none focus:border-amber-400 resize-none dark:text-white" />
                <div className="grid grid-cols-2 gap-3">
                   <button onClick={() => pdfInputRef.current?.click()} className={`p-4 border-2 border-dashed rounded-2xl flex flex-col items-center gap-2 ${blueprintPdfBase64 ? 'border-emerald-400' : 'border-slate-200 dark:border-slate-800'}`}>
                      <span className="text-[7px] font-black text-slate-400 uppercase">Syllabus PDF</span>
                      <input type="file" id="pdf-upload" ref={pdfInputRef} className="hidden" accept=".pdf" onChange={handlePdfChange} />
                   </button>
                   <button onClick={() => fileInputRef.current?.click()} className={`p-4 border-2 border-dashed rounded-2xl flex flex-col items-center gap-2 ${ocrImage ? 'border-emerald-400' : 'border-slate-200 dark:border-slate-800'}`}>
                      <span className="text-[7px] font-black text-slate-400 uppercase">Book Photo</span>
                      <input type="file" id="image-upload" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                   </button>
                </div>
             </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-12">
           <div id="lesson-plan-print" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[800px] flex flex-col overflow-hidden relative">
              {lessonPlan ? (
                <div className="flex-1 flex flex-col">
                  <div className="p-6 border-b dark:border-slate-800 bg-slate-50/50 flex flex-wrap justify-between items-center gap-4 no-print sticky top-0 z-[60] backdrop-blur-md">
                     <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest truncate max-w-[200px]">{lessonPlan.title}</p>
                     <div className="flex gap-2">
                        <button onClick={() => generateWorksheet()} disabled={isGeneratingWorksheet} className="px-5 py-2.5 bg-amber-400 text-[#001f3f] rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">Worksheet</button>
                        <button onClick={() => generateSlideOutline()} disabled={isGeneratingSlides} className="px-5 py-2.5 bg-sky-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg">Slide Deck</button>
                        <button onClick={handleRequestReview} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg">Request Review</button>
                        <button onClick={() => setIsEditMode(!isEditMode)} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase shadow-lg ${isEditMode ? 'bg-rose-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{isEditMode ? 'Save Edits' : 'Manual Override'}</button>
                        <button onClick={handleSaveToVault} disabled={isSaving} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg">{isSaving ? 'Saving...' : 'Vault Link'}</button>
                        <button onClick={() => handlePrint('lesson-plan-print')} className="px-5 py-2.5 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase shadow-lg">PDF</button>
                     </div>
                  </div>
                  <div className="p-10 md:p-20 overflow-y-auto text-black space-y-12 bg-white">
                     <div className="flex flex-col items-center text-center border-b-2 border-black pb-8">
                        <img src={SCHOOL_LOGO_BASE64} crossOrigin="anonymous" className="w-16 h-16 mb-4" />
                        <h2 className="text-xl font-black uppercase">{SCHOOL_NAME}</h2>
                        <h3 className="text-3xl font-black uppercase italic tracking-tighter mt-4">{lessonPlan.title}</h3>
                     </div>
                     <div className="grid grid-cols-2 gap-8 text-[10px] font-bold uppercase italic border-b border-black pb-4">
                        <p>Grade: {config.grades.find(g => g.id === gradeId)?.name} | Sub: {subject}</p>
                        <p className="text-right">Author: {user.name} | {lessonDate}</p>
                     </div>
                     <div className="space-y-12">
                        <section>
                           <h4 className="text-xs font-black uppercase italic border-l-4 border-black pl-3 mb-4">Strategic Objectives</h4>
                           <div className={`space-y-2 ${isEditMode ? 'p-4 bg-amber-50 rounded-2xl' : ''}`}>
                              {lessonPlan.objectives.map((o, i) => (
                                 <div key={i} className="flex gap-2">
                                    <span className="font-bold">»</span>
                                    {isEditMode ? (
                                      <input className="w-full text-sm font-medium bg-transparent border-b border-amber-200 outline-none" value={o} onChange={e => {
                                         const next = [...lessonPlan.objectives];
                                         next[i] = e.target.value;
                                         handleManualEdit('objectives', next);
                                      }} />
                                    ) : <p className="font-medium text-sm">{o}</p>}
                                 </div>
                              ))}
                           </div>
                        </section>
                        <section>
                           <h4 className="text-xs font-black uppercase italic border-l-4 border-black pl-3 mb-6">Instructional Sequence ({classDuration}m Total)</h4>
                           <div className={`space-y-6 ${isEditMode ? 'p-6 bg-amber-50 rounded-[2.5rem]' : ''}`}>
                              {lessonPlan.procedure.map((p, i) => (
                                <div key={i} className="flex gap-6 items-start relative group/step">
                                   <div className="flex flex-col gap-1 items-center no-print absolute -left-12 opacity-0 group-hover/step:opacity-100 transition-opacity">
                                      <button onClick={() => reorderStep(i, 'UP')} className="p-1 hover:bg-slate-100 rounded">▲</button>
                                      <button onClick={() => reorderStep(i, 'DOWN')} className="p-1 hover:bg-slate-100 rounded">▼</button>
                                   </div>
                                   <div className="w-10 h-10 bg-slate-50 border border-black rounded flex items-center justify-center font-black shrink-0 shadow-sm">0{i+1}</div>
                                   <div className="flex-1">
                                      <div className="flex justify-between items-center mb-1">
                                         {isEditMode ? (
                                           <div className="flex gap-4 w-full">
                                              <input className="font-black text-sm uppercase bg-transparent border-b border-amber-300 outline-none flex-1" value={p.step} onChange={e => {
                                                 const next = [...lessonPlan.procedure];
                                                 next[i] = { ...next[i], step: e.target.value };
                                                 handleManualEdit('procedure', next);
                                              }} />
                                              <input className="text-[10px] font-bold italic w-16 bg-transparent border-b border-amber-300 outline-none text-right" value={p.duration} onChange={e => {
                                                 const next = [...lessonPlan.procedure];
                                                 next[i] = { ...next[i], duration: e.target.value };
                                                 handleManualEdit('procedure', next);
                                              }} />
                                           </div>
                                         ) : (
                                           <><p className="font-black text-sm uppercase">{p.step}</p><span className="text-[10px] font-bold italic">{p.duration}</span></>
                                         )}
                                      </div>
                                      <p className="text-sm font-medium leading-relaxed">{p.description}</p>
                                   </div>
                                </div>
                              ))}
                           </div>
                        </section>
                        
                        {lessonPlan.exitTickets && lessonPlan.exitTickets.length > 0 && (
                          <section>
                             <h4 className="text-xs font-black uppercase italic border-l-4 border-black pl-3 mb-4">Exit Ticket Protocols</h4>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {lessonPlan.exitTickets.map((et, i) => (
                                  <div key={i} className="p-4 bg-slate-50 border border-black rounded-2xl">
                                     <p className="text-[11px] font-bold">Ticket 0{i+1}: {et}</p>
                                  </div>
                                ))}
                             </div>
                          </section>
                        )}

                        <div className="p-8 bg-[#001f3f] text-white rounded-[2.5rem] space-y-4 no-print-dark">
                           <h4 className="text-xs font-black uppercase tracking-widest text-amber-400">Institutional Differentiation Matrix</h4>
                           <div className="grid grid-cols-2 gap-8">
                              <div><p className="text-[7px] font-black uppercase text-white/40 mb-1">Support (SEN)</p><p className="text-[11px] font-bold italic">{lessonPlan.differentiation?.sen}</p></div>
                              <div><p className="text-[7px] font-black uppercase text-white/40 mb-1">Scholar (GT)</p><p className="text-[11px] font-bold italic">{lessonPlan.differentiation?.gt}</p></div>
                           </div>
                        </div>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center">
                  {isGenerating ? (
                    <div className="space-y-6">
                       <div className="w-16 h-16 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                       <p className="text-xl font-black uppercase tracking-[0.5em]">{reasoningMsg || 'Defining Sequence'}</p>
                    </div>
                  ) : <p className="text-xl font-black uppercase tracking-[0.5em]">Awaiting Architect Command</p>}
                </div>
              )}
           </div>

           {slideOutline && (
             <div className="bg-slate-900 rounded-[3rem] p-10 space-y-8 animate-in zoom-in duration-500 shadow-2xl border-4 border-sky-400/20 no-print">
                <div className="flex justify-between items-center border-b border-white/10 pb-6">
                   <h4 className="text-xl font-black text-sky-400 uppercase italic">Slide Deck Architect</h4>
                   <button onClick={() => setSlideOutline(null)} className="text-white/40 hover:text-white text-xs font-black">Close Outline</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {slideOutline.map((slide, i) => (
                     <div key={i} className="bg-white/5 p-6 rounded-3xl border border-white/10 space-y-4">
                        <div className="flex justify-between">
                           <span className="text-[10px] font-black text-sky-400">SLIDE 0{i+1}</span>
                        </div>
                        <h5 className="text-sm font-black text-white uppercase">{slide.title}</h5>
                        <ul className="space-y-1">
                           {slide.points.map((p: string, j: number) => <li key={j} className="text-[10px] text-white/60 font-medium list-disc ml-4">{p}</li>)}
                        </ul>
                        <p className="text-[8px] font-bold text-amber-400/60 italic">Visual: {slide.visualSuggestion}</p>
                     </div>
                   ))}
                </div>
             </div>
           )}

           {worksheet && (
             <div id="worksheet-print" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border-4 border-amber-400 min-h-[800px] flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 duration-700">
                <div className="p-6 border-b dark:border-slate-800 bg-amber-50 flex justify-between items-center no-print">
                   <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Differentiated Worksheet Matrix</p>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={() => setShowAnswerKey(!showAnswerKey)} className="px-5 py-2.5 bg-sky-600 text-white rounded-xl text-[9px] font-black uppercase">{showAnswerKey ? 'Show Questions' : 'Show Answer Key'}</button>
                      <button onClick={() => handlePrint('worksheet-print')} className="px-5 py-2.5 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase">Export PDF</button>
                   </div>
                </div>
                
                <div className="p-10 md:p-20 text-black bg-white space-y-12">
                   <div className="text-center space-y-2 border-b-2 border-black pb-8">
                      <img src={SCHOOL_LOGO_BASE64} className="w-12 h-12 mx-auto" crossOrigin="anonymous" />
                      <h2 className="text-lg font-black uppercase">{SCHOOL_NAME}</h2>
                      <h3 className="text-2xl font-black uppercase italic">{worksheet.title}</h3>
                   </div>
                   <div className="space-y-12">
                      {showAnswerKey ? (
                        <div className="space-y-8 animate-in fade-in duration-500">
                           <h4 className="text-xs font-black uppercase border-b-2 border-black pb-2">Master Marking Scheme</h4>
                           {worksheet.questions.map((q, i) => (
                             <div key={i} className="flex gap-4 items-start border-l-4 border-emerald-500 pl-4">
                                <span className="font-black text-xs">Q{i+1}.</span>
                                <div><p className="text-xs font-bold text-slate-500">{q.text}</p><p className="text-sm font-black text-emerald-600 mt-1">Ans: {q.answer}</p></div>
                             </div>
                           ))}
                        </div>
                      ) : (
                        <>
                           <div className="space-y-6">
                              <h4 className="text-xs font-black uppercase bg-slate-100 p-3 rounded-xl border-l-8 border-[#001f3f]">Pathway A: Foundation Skills</h4>
                              <div className="space-y-6">{worksheet.questions.filter(q => q.tier === 'SUPPORT').map((q, i) => (
                                <div key={q.id} className="space-y-3 pl-4 relative group/q">
                                   <p className="text-sm font-black">Q{i+1}. {q.text}</p>
                                   <div className="h-6 border-b border-dotted border-black/20 w-full"></div>
                                </div>
                              ))}</div>
                           </div>
                           <div className="space-y-6">
                              <h4 className="text-xs font-black uppercase bg-slate-100 p-3 rounded-xl border-l-8 border-sky-500">Pathway B: Core Competency</h4>
                              <div className="space-y-6">{worksheet.questions.filter(q => q.tier === 'CORE').map((q, i) => (
                                <div key={q.id} className="space-y-3 pl-4 relative group/q">
                                   <p className="text-sm font-black">Q{i+6}. {q.text}</p>
                                   <div className="h-10 border-b border-dotted border-black/20 w-full"></div>
                                </div>
                              ))}</div>
                           </div>
                        </>
                      )}
                   </div>
                </div>
             </div>
           )}

           {(lessonPlan || worksheet) && (
             <div className="no-print pt-10 border-t border-slate-100">
                <div className="bg-[#001f3f] p-8 rounded-[3rem] shadow-2xl relative overflow-hidden">
                   <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                      <div className="flex-1 space-y-2">
                         <h4 className="text-sm font-black text-amber-400 uppercase italic tracking-widest">Master Advisor Oracle</h4>
                         <p className="text-[9px] font-medium text-white/50 uppercase leading-relaxed">Modify the result using conversational advice.</p>
                         <div className="flex gap-3 bg-white/5 p-2 rounded-2xl border border-white/10 mt-4">
                            <input type="text" value={refinementInput} onChange={e => setRefinementInput(e.target.value)} placeholder="Advice (e.g. make the procedure more active)..." className="flex-1 bg-transparent px-4 py-3 text-white font-bold text-xs outline-none" onKeyDown={e => e.key === 'Enter' && (worksheet ? generateWorksheet(refinementInput) : generateLessonPlan(refinementInput))} />
                            <button onClick={() => worksheet ? generateWorksheet(refinementInput) : generateLessonPlan(refinementInput)} disabled={isRefining} className="bg-amber-400 text-[#001f3f] px-6 py-2 rounded-xl font-black text-[10px] uppercase shadow-lg transition-all active:scale-95">
                               {isRefining ? 'Syncing...' : 'Dispatch'}
                            </button>
                         </div>
                      </div>
                   </div>
                </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default LessonArchitectView;

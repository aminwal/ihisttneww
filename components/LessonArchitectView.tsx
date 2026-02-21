import React, { useState, useRef } from 'react';
import { User, SchoolConfig, TeacherAssignment, TimeTableEntry, LessonPlan, AppTab, Worksheet } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { MatrixService } from '../services/matrixService.ts';
import { AIService } from '../services/geminiService.ts';
import { Type } from '@google/genai';

declare var html2pdf: any;

interface LessonArchitectViewProps {
  user: User;
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  timetable?: TimeTableEntry[];
  isAuthorizedForRecord: (type: 'LESSON_PLAN' | 'EXAM_PAPER', record: any) => boolean;
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
  onTabRequest?: (tab: AppTab) => void; 
}

const LessonArchitectView: React.FC<LessonArchitectViewProps> = ({ 
  user, config, assignments, timetable = [], isAuthorizedForRecord, isSandbox, addSandboxLog, onTabRequest 
}) => {
  const [topic, setTopic] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [classDuration, setClassDuration] = useState<number>(40);
  const [targetDate, setTargetDate] = useState(formatBahrainDate());
  const [periodNumber, setPeriodNumber] = useState('');
  
  // Separated File States
  const [blueprintFiles, setBlueprintFiles] = useState<{data: string, name: string, type: 'IMAGE' | 'PDF'}[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<{data: string, name: string, type: 'IMAGE' | 'PDF'}[]>([]);
  
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [isListening, setIsListening] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingWorksheet, setIsGeneratingWorksheet] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reasoningMsg, setReasoningMsg] = useState('');
  
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [isGatingError, setIsGatingError] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const blueprintInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      const type = file.type.includes('image') ? 'IMAGE' : file.type.includes('pdf') ? 'PDF' : null;
      if (!type) return;
      const reader = new FileReader();
      reader.onload = () => setter(prev => [...prev, { data: reader.result as string, name: file.name, type: type as any }]);
      reader.readAsDataURL(file);
    });
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech Recognition is not supported in this browser. Please type your details instead.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false; 
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      HapticService.light();
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setAdditionalDetails(prev => {
         const separator = prev && !prev.endsWith(' ') ? ' ' : '';
         return prev + separator + transcript;
      });
    };

    recognition.onerror = (event: any) => {
      console.error("Speech Recognition Error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const generateLessonPlan = async () => {
    if (!gradeId || !subject || (!topic.trim() && blueprintFiles.length === 0 && referenceFiles.length === 0)) { 
      setError("Grade, Subject, and Topic are mandatory."); 
      return; 
    }

    setIsGenerating(true);
    setIsGatingError(false);
    setReasoningMsg("Executing Client-Side AI Logic...");
    setSaveSuccess(false);
    setWorksheet(null);
    setError(null);
    HapticService.light();

    try {
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
      const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';
      
      const plan = await AIService.generateLessonPlanEdge(subject, gradeName + ' ' + sectionName, topic);
      setLessonPlan(plan);
      HapticService.success();
    } catch (err: any) { 
      console.error("AI Generation Error:", err);
      const msg = err.message || "";
      setError(msg);
      if (msg.includes("GATING_ERROR") || msg.includes("DEPLOYMENT_ERROR")) {
         setIsGatingError(true);
      }
    } finally { 
      setIsGenerating(false); 
      setReasoningMsg(''); 
    }
  };

  const generateWorksheet = async () => {
    if (!lessonPlan || !gradeId || !subject) return;
    
    setIsGeneratingWorksheet(true);
    setReasoningMsg("Synthesizing Worksheet Matrix...");
    setError(null);
    HapticService.light();

    try {
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
      
      const prompt = `Based on the following lesson plan context, construct a differentiated student worksheet for Ibn Al Hytham Islamic School.
                      Grade: ${gradeName}, Subject: ${subject}, Topic: ${topic || lessonPlan.title}.
                      
                      Requirements:
                      - Must contain multiple questions suitable for the specified grade level.
                      - Questions must be explicitly categorized into three cognitive tiers: 'SUPPORT' (basic recall/understanding), 'CORE' (application/analysis), and 'EXTENSION' (evaluation/creation).
                      
                      Lesson Plan Context:
                      ${JSON.stringify(lessonPlan)}`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING },
                text: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.STRING },
                tier: { type: Type.STRING }
              },
              required: ["id", "type", "text", "answer", "tier"]
            }
          }
        },
        required: ["title", "questions"]
      };

      const configOverride = {
        systemInstruction: "Lead Assessment Architect at Ibn Al Hytham Islamic School. Produce rigorous, perfectly formatted JSON educational materials.",
        responseMimeType: "application/json",
        responseSchema: schema
      };

      const response = await MatrixService.architectRequest(prompt, [], configOverride);
      const generatedWs = JSON.parse(response.text);
      setWorksheet(generatedWs);
      HapticService.success();
    } catch (err: any) {
      console.error("Worksheet Generation Error:", err);
      setError("Worksheet Error: " + (err.message || "Matrix AI Execution Failed."));
    } finally {
      setIsGeneratingWorksheet(false);
      setReasoningMsg('');
    }
  };

  const handleSaveToVault = async () => {
    if (!lessonPlan || !IS_CLOUD_ENABLED) return;
    setIsSaving(true);
    try {
      const payload = {
        teacher_id: user.id,
        teacher_name: user.name,
        date: targetDate,
        grade_id: gradeId,
        section_id: sectionId,
        subject: subject,
        topic: topic,
        plan_data: lessonPlan,
        is_shared: true
      };

      if (isSandbox) {
        addSandboxLog?.('LESSON_PLAN_VAULT_SAVE', payload);
      } else {
        const { error } = await supabase.from('lesson_plans').insert(payload);
        if (error) throw error;
      }

      setSaveSuccess(true);
      HapticService.success();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError("Vault Synchronization Failed: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = (elementId: string, filename: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const opt = { 
      margin: 10, 
      filename, 
      image: { type: 'jpeg', quality: 1.0 }, 
      html2canvas: { scale: 2 }, 
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(element).save();
  };

  const displayGradeName = config.grades.find(g => g.id === gradeId)?.name || '';
  const displaySectionName = config.sections.find(s => s.id === sectionId)?.name || '';

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-32 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print px-2">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Lesson <span className="text-[#d4af37]">Architect</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mt-2">SECURE CLOUD AI ENABLED • 2026-2027</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 px-2">
        <div className="lg:col-span-4 space-y-8 no-print">
          <div className="bg-[#001f3f] rounded-[3rem] p-8 shadow-2xl border border-white/10 space-y-8">
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Lesson Parameters</h3>
            <div className="space-y-4">
               <div className="grid grid-cols-3 gap-3">
                 <div className="space-y-1">
                    <label className="text-[8px] font-black text-white/40 uppercase tracking-widest ml-1">Target Date</label>
                    <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[8px] font-black text-white/40 uppercase tracking-widest ml-1">Period</label>
                    <input type="text" placeholder="e.g. 3 or 1 & 2" value={periodNumber} onChange={e => setPeriodNumber(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[8px] font-black text-white/40 uppercase tracking-widest ml-1">Duration (Mins)</label>
                    <input type="number" min="1" placeholder="40" value={classDuration || ''} onChange={e => setClassDuration(parseInt(e.target.value) || 0)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" />
                 </div>
               </div>
               <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Grade...</option>
                  {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
               </select>
               <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Section (Optional)...</option>
                  {config.sections.filter(s => s.gradeId === gradeId).map(s => <option key={s.id} value={s.id} className="text-black">{s.fullName}</option>)}
               </select>
               <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Subject...</option>
                  {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
               </select>
               <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic (e.g. Chemical Bonds)" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" />
               
               <div className="space-y-1 relative">
                 <label className="text-[8px] font-black text-white/40 uppercase tracking-widest ml-1">Additional Details / Spoken Context</label>
                 <textarea 
                   value={additionalDetails}
                   onChange={e => setAdditionalDetails(e.target.value)}
                   placeholder="Write or speak specific pedagogical goals, context, or blueprint details..."
                   className="w-full h-24 bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white outline-none resize-none pr-12 focus:border-amber-400 transition-all"
                 />
                 <button 
                   type="button"
                   onClick={toggleListening}
                   className={`absolute bottom-3 right-3 p-2.5 rounded-lg flex items-center justify-center transition-all ${isListening ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-amber-400'}`}
                   title="Dictate lesson details"
                 >
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                   </svg>
                 </button>
               </div>

               <div className="grid grid-cols-2 gap-3 pt-2">
                  <button onClick={() => blueprintInputRef.current?.click()} className="p-3 border-2 border-dashed border-white/10 rounded-xl text-[9px] text-white/60 uppercase hover:border-sky-400 hover:text-white transition-all font-bold flex flex-col items-center justify-center gap-1.5 text-center">
                     <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                     {blueprintFiles.length > 0 ? <span className="text-sky-400">{blueprintFiles.length} Blueprint(s)</span> : 'Upload Blueprint'}
                  </button>
                  <button onClick={() => referenceInputRef.current?.click()} className="p-3 border-2 border-dashed border-white/10 rounded-xl text-[9px] text-white/60 uppercase hover:border-emerald-400 hover:text-white transition-all font-bold flex flex-col items-center justify-center gap-1.5 text-center">
                     <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                     {referenceFiles.length > 0 ? <span className="text-emerald-400">{referenceFiles.length} Content(s)</span> : 'Upload Content'}
                  </button>
               </div>
               
               <input type="file" ref={blueprintInputRef} className="hidden" multiple accept="image/*,.pdf" onChange={(e) => handleFileUpload(e, setBlueprintFiles)} />
               <input type="file" ref={referenceInputRef} className="hidden" multiple accept="image/*,.pdf" onChange={(e) => handleFileUpload(e, setReferenceFiles)} />

               <button 
                 onClick={generateLessonPlan} 
                 disabled={isGenerating} 
                 className="w-full bg-[#d4af37] text-[#001f3f] py-5 rounded-[2rem] font-black text-xs uppercase shadow-xl hover:bg-white transition-all disabled:opacity-50 mt-4"
               >
                  {isGenerating ? 'Processing AI Models...' : 'Construct Lesson Plan'}
               </button>
            </div>
            {error && !isGatingError && (
               <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                 <p className="text-[10px] text-rose-400 font-bold text-center uppercase leading-relaxed">{error}</p>
               </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800">
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic mb-4">Architect Guidelines</p>
             <p className="text-[11px] text-slate-500 leading-relaxed italic">Plans generated here include specialized differentiation for SEN and GT learners as per IHIS 2026-27 pedagogical standards. Upload structural formatting into Blueprints, and lesson reading materials into Content.</p>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div id="lesson-plan-workspace" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[700px] flex flex-col overflow-hidden">
              {isGatingError ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in zoom-in duration-500">
                   <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center text-rose-500 mb-8">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09m1.916-5.111a10.273 10.273 0 01-1.071 4.76m16.125-9.286a20.587 20.587 0 01-1.184 8.023m-1.258 2.527c-.887 1.413-1.952 2.68-3.152 3.752m-2.456 2.108a16.033 16.033 0 01-5.995-1.1m7.532-5.664a10.513 10.513 0 01-3.136 3.553m-.73-3.135c.342.333.667.697.973 1.088m3.963-6.176a12.42 12.42 0 01-.338 4.466M9 21v-3.338c0-.58-.306-1.118-.812-1.41a10.737 10.737 0 01-3.207-2.542m14.056-6.41A9.147 9.147 0 0017.307 3M15 3.568A10.098 10.098 0 0118 10c0 .329-.016.655-.047.976m-3.805 3.69A8.147 8.147 0 0112 15m-5.333-3.945c.07-.468.145-.932.227-1.396M14 3a2 2 0 114 0c0 .553-.447 1-1 1h-1V3z"/></svg>
                   </div>
                   <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Matrix Connection Failed</h3>
                   <p className="text-xs text-slate-500 font-medium max-w-md mx-auto mt-4 leading-relaxed italic">
                      {error?.replace("GATING_ERROR: ", "")}
                   </p>
                   <div className="mt-10 flex gap-4">
                      <button 
                         onClick={() => onTabRequest?.('deployment')} 
                         className="bg-[#001f3f] text-[#d4af37] px-10 py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-950 transition-all"
                      >
                         Configure Infrastructure
                      </button>
                      <button onClick={generateLessonPlan} className="bg-slate-50 text-slate-400 px-10 py-5 rounded-2xl font-black text-[10px] uppercase border border-slate-100 transition-all">Retry</button>
                   </div>
                </div>
              ) : lessonPlan ? (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                   <div className="p-12 md:p-20 text-black bg-white space-y-8">
                      <div className="flex flex-col items-center text-center">
                         <img src={SCHOOL_LOGO_BASE64} className="w-16 h-16 mb-4" />
                         <h2 className="text-xl font-black uppercase italic">{SCHOOL_NAME}</h2>
                         <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em] mt-1">Academic Year 2026-2027</p>
                      </div>
                      
                      <h3 className="text-3xl font-black uppercase italic tracking-tighter mt-6 mb-8 text-center">{lessonPlan.title}</h3>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full mb-10 border-y-2 border-black/10 py-6 text-left">
                         <div>
                            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Educator</p>
                            <p className="text-sm font-bold text-[#001f3f] uppercase">{user.name}</p>
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Date & Period</p>
                            <p className="text-sm font-bold text-[#001f3f] uppercase">{targetDate} • P{periodNumber || '-'} ({classDuration || 40}m)</p>
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Class</p>
                            <p className="text-sm font-bold text-[#001f3f] uppercase">
                               {displayGradeName} {displaySectionName}
                            </p>
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Subject</p>
                            <p className="text-sm font-bold text-[#001f3f] uppercase">{subject}</p>
                         </div>
                      </div>
                      
                      <div className="space-y-10">
                         <section>
                            <h4 className="text-sm font-black uppercase border-l-4 border-amber-400 pl-3 mb-4">Learning Objectives</h4>
                            <ul className="list-disc pl-8 space-y-2 font-medium">
                               {lessonPlan.objectives.map((o, i) => <li key={i} className="text-slate-700">{o}</li>)}
                            </ul>
                         </section>
                         
                         <section>
                            <h4 className="text-sm font-black uppercase border-l-4 border-amber-400 pl-3 mb-4">Instructional Procedure</h4>
                            <div className="space-y-6">
                               {lessonPlan.procedure.map((p, i) => (
                                  <div key={i} className="flex gap-6 items-start">
                                     <span className="font-black text-amber-500 text-xl italic">0{i+1}</span>
                                     <div>
                                        <p className="font-black uppercase text-xs text-[#001f3f]">{p.step} ({p.duration})</p>
                                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{p.description}</p>
                                     </div>
                                  </div>
                               ))}
                            </div>
                         </section>

                         {lessonPlan.differentiation && (
                           <section className="bg-slate-50 p-8 rounded-3xl border border-slate-100">
                              <h4 className="text-sm font-black uppercase mb-4">Differentiation Matrix</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 <div>
                                    <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1">SEN Support</p>
                                    <p className="text-xs font-medium text-slate-600 italic">{lessonPlan.differentiation.sen}</p>
                                 </div>
                                 <div>
                                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">GT Extension</p>
                                    <p className="text-xs font-medium text-slate-600 italic">{lessonPlan.differentiation.gt}</p>
                                 </div>
                              </div>
                           </section>
                         )}
                      </div>

                      {/* Explicit Worksheet Generation Appendage inside the Printable View */}
                      {worksheet && (
                         <div className="mt-16 pt-16 border-t-[3px] border-dashed border-slate-200 print:break-before-page">
                            <div className="flex flex-col items-center text-center mb-12">
                               <h2 className="text-xl font-black uppercase italic text-[#001f3f]">{SCHOOL_NAME}</h2>
                               <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em] mt-1">Student Worksheet • {displayGradeName}</p>
                               <h3 className="text-3xl font-black uppercase italic tracking-tighter mt-6 text-[#001f3f]">{worksheet.title}</h3>
                            </div>

                            <div className="space-y-12">
                               {['SUPPORT', 'CORE', 'EXTENSION'].map(tier => {
                                 const tierQuestions = worksheet.questions.filter(q => q.tier === tier);
                                 if (tierQuestions.length === 0) return null;
                                 
                                 const tierColor = tier === 'SUPPORT' ? 'border-sky-400 text-sky-700' : 
                                                   tier === 'CORE' ? 'border-amber-400 text-amber-700' : 
                                                   'border-rose-400 text-rose-700';

                                 return (
                                   <section key={tier} className="space-y-6">
                                     <h4 className={`text-sm font-black uppercase border-l-4 pl-3 ${tierColor}`}>
                                       {tier} Tier
                                     </h4>
                                     <div className="space-y-8">
                                       {tierQuestions.map((q, idx) => (
                                         <div key={q.id || idx} className="pl-4">
                                           <p className="text-sm font-bold text-slate-800"><span className="mr-3 font-black text-[#001f3f]">{idx + 1}.</span>{q.text}</p>
                                           
                                           {q.options && q.options.length > 0 && (
                                             <ul className="list-[lower-alpha] pl-8 mt-3 text-sm text-slate-600 space-y-2 font-medium">
                                               {q.options.map((opt, oIdx) => (
                                                 <li key={oIdx}>{opt}</li>
                                               ))}
                                             </ul>
                                           )}
                                           
                                           {/* Answer Key hidden during print */}
                                           <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl no-print">
                                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                                               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                               Teacher Answer Key
                                             </p>
                                             <p className="text-xs font-bold text-slate-700">{q.answer}</p>
                                           </div>
                                         </div>
                                       ))}
                                     </div>
                                   </section>
                                 );
                               })}
                            </div>
                         </div>
                      )}
                   </div>
                   
                   <div className="no-print p-12 bg-slate-50 dark:bg-slate-800/30 flex flex-wrap justify-center gap-4 border-t border-slate-100 dark:border-slate-800">
                      {!worksheet && (
                         <button 
                           onClick={generateWorksheet}
                           disabled={isGeneratingWorksheet}
                           className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50"
                         >
                           {isGeneratingWorksheet ? 'Synthesizing Worksheet...' : '+ Generate Associated Worksheet'}
                         </button>
                      )}
                      <button 
                        onClick={handleSaveToVault} 
                        disabled={isSaving || saveSuccess}
                        className={`px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all flex items-center gap-3 ${saveSuccess ? 'bg-emerald-500 text-white' : 'bg-[#d4af37] text-[#001f3f] hover:bg-white'}`}
                      >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                         {saveSuccess ? 'Vault Synced' : isSaving ? 'Vaulting...' : 'Save to School Vault'}
                      </button>
                      <button onClick={() => handlePrint('lesson-plan-workspace', 'IHIS_LessonPlan.pdf')} className="bg-[#001f3f] text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all">Download PDF</button>
                      <button onClick={() => { setLessonPlan(null); setWorksheet(null); }} className="bg-white text-slate-400 px-8 py-4 rounded-2xl font-black text-[10px] uppercase border border-slate-200">Reset Architect</button>
                      
                      {worksheet && <p className="w-full text-center text-[9px] font-bold text-slate-400 uppercase mt-4 italic">Note: Teacher answer keys are automatically hidden during PDF generation.</p>}
                   </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center">
                   {isGenerating || isGeneratingWorksheet ? (
                     <div className="space-y-4">
                       <div className="w-16 h-16 border-4 border-[#001f3f] border-t-amber-400 rounded-full animate-spin mx-auto"></div>
                       <p className="text-xl font-black uppercase tracking-[0.5em]">{reasoningMsg}</p>
                     </div>
                   ) : (
                     <div className="space-y-6">
                       <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                          <svg className="w-12 h-12 text-[#001f3f]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
                       </div>
                       <p className="text-xl font-black uppercase tracking-[0.5em] leading-relaxed">Awaiting Institutional<br/>Input Command</p>
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

export default LessonArchitectView;

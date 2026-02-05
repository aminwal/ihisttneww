
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, SchoolConfig, TeacherAssignment, TimeTableEntry, LessonPlan, SavedPlanRecord, Worksheet } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { MatrixService } from '../services/matrixService.ts';

declare var html2pdf: any;

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
  const [topic, setTopic] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [subject, setSubject] = useState('');
  const [classDuration, setClassDuration] = useState<number>(40);
  
  const [sourceFiles, setSourceFiles] = useState<{data: string, name: string, type: 'IMAGE' | 'PDF'}[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoningMsg, setReasoningMsg] = useState('');
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceInputRef = useRef<HTMLInputElement>(null);

  const handleSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      const type = file.type.includes('image') ? 'IMAGE' : file.type.includes('pdf') ? 'PDF' : null;
      if (!type) return;
      const reader = new FileReader();
      reader.onload = () => setSourceFiles(prev => [...prev, { data: reader.result as string, name: file.name, type: type as any }]);
      reader.readAsDataURL(file);
    });
  };

  const generateLessonPlan = async () => {
    if (!gradeId || !subject || (!topic.trim() && sourceFiles.length === 0)) { 
      setError("Grade, Subject, and Topic are mandatory."); 
      return; 
    }

    setIsGenerating(true);
    setReasoningMsg("Requesting Secure Architect Logic...");
    setError(null);
    HapticService.light();

    try {
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
      
      // We instruct the AI to return a specific JSON structure
      const prompt = `Construct a formal lesson plan for Ibn Al Hytham Islamic School (Academic Year 2026-2027). 
                      Grade: ${gradeName}, Subject: ${subject}, Topic: ${topic}. 
                      Duration: ${classDuration} minutes. 
                      Ensure the tone is professional and suitable for an Islamic school environment.
                      Return the response in valid JSON format with keys: title, objectives (array), procedure (array of {step, description, duration}).`;

      const contents = sourceFiles.map(f => ({
        inlineData: { 
          data: f.data.split(',')[1], 
          mimeType: f.type === 'IMAGE' ? 'image/jpeg' : 'application/pdf' 
        }
      }));

      const response = await MatrixService.architectRequest(prompt, contents);
      
      // The Edge function returns { text: "..." }
      // We need to parse that text string into a JSON object
      const cleanedText = response.text.replace(/```json|```/g, '').trim();
      const plan = JSON.parse(cleanedText);
      
      setLessonPlan(plan);
      HapticService.success();
    } catch (err: any) { 
      console.error("AI Generation Error:", err);
      setError("The AI Brain encountered an error. Please ensure your API Key in Supabase is valid."); 
    } finally { 
      setIsGenerating(false); 
      setReasoningMsg(''); 
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
            <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Lesson Inputs</h3>
            <div className="space-y-4">
               <select value={gradeId} onChange={e => setGradeId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Grade...</option>
                  {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
               </select>
               <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none">
                  <option value="" className="text-black">Select Subject...</option>
                  {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
               </select>
               <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic (e.g. Thermodynamics)" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none" />
               
               <div className="pt-4">
                  <button onClick={() => sourceInputRef.current?.click()} className="w-full p-4 border-2 border-dashed border-white/10 rounded-2xl text-[10px] text-white/40 uppercase hover:border-amber-400 transition-all">
                     {sourceFiles.length > 0 ? `${sourceFiles.length} Source Files Added` : '+ Upload Lesson Material (PDF/Image)'}
                  </button>
                  <input type="file" ref={sourceInputRef} className="hidden" multiple accept="image/*,.pdf" onChange={handleSourceUpload} />
               </div>

               <button 
                 onClick={generateLessonPlan} 
                 disabled={isGenerating} 
                 className="w-full bg-[#d4af37] text-[#001f3f] py-5 rounded-[2rem] font-black text-xs uppercase shadow-xl hover:bg-white transition-all disabled:opacity-50"
               >
                  {isGenerating ? 'Connecting to Cloud...' : 'Construct Lesson Plan'}
               </button>
            </div>
            {error && <p className="text-[10px] text-rose-400 font-bold text-center uppercase">{error}</p>}
          </div>
          
          <div className="bg-white/5 backdrop-blur-md rounded-[2rem] p-6 border border-white/10">
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">
               All requests are processed via the secure IHIS Matrix Gateway. Your API key remains protected in the cloud vault.
             </p>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div id="lesson-plan-workspace" className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[600px] flex flex-col overflow-hidden">
              {lessonPlan ? (
                <div className="p-12 md:p-20 text-black bg-white space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                   <div className="flex flex-col items-center text-center border-b-2 border-black pb-8">
                      <img src={SCHOOL_LOGO_BASE64} className="w-16 h-16 mb-4" />
                      <h2 className="text-xl font-black uppercase italic">{SCHOOL_NAME}</h2>
                      <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em] mt-1">Academic Year 2026-2027</p>
                      <h3 className="text-3xl font-black uppercase italic tracking-tighter mt-6">{lessonPlan.title}</h3>
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
                   </div>
                   
                   <div className="no-print pt-12 flex justify-center gap-4 border-t border-slate-100">
                      <button onClick={() => handlePrint('lesson-plan-workspace', 'LessonPlan.pdf')} className="bg-[#001f3f] text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:scale-105 transition-all">Download Official PDF</button>
                      <button onClick={() => setLessonPlan(null)} className="bg-slate-50 text-slate-400 px-8 py-4 rounded-2xl font-black text-[10px] uppercase border border-slate-100">Clear</button>
                   </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-20 text-center">
                   {isGenerating ? (
                     <div className="space-y-4">
                       <div className="w-12 h-12 border-4 border-[#001f3f] border-t-amber-400 rounded-full animate-spin mx-auto"></div>
                       <p className="text-xl font-black uppercase tracking-[0.5em]">{reasoningMsg}</p>
                     </div>
                   ) : (
                     <div className="space-y-4">
                       <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                       <p className="text-xl font-black uppercase tracking-[0.5em]">Awaiting Command Sequence</p>
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

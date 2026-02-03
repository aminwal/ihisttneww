
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { User, SchoolConfig, TeacherAssignment, SubjectCategory, SchoolSection, TimeTableEntry, LessonPlan, SavedPlanRecord, Worksheet, WorksheetQuestion } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

declare var html2pdf: any;

type Archetype = 'STANDARD' | 'EXAM_PREP' | 'PROJECT_BASED' | 'REMEDIAL';
type BloomLevel = 'REMEMBER' | 'UNDERSTAND' | 'APPLY' | 'ANALYZE' | 'EVALUATE' | 'CREATE';
type SyllabusKey = 'CBSE' | 'BAHRAIN_NATIONAL' | 'NONE';

interface LessonArchitectViewProps {
  user: User;
  config: SchoolConfig;
  assignments: TeacherAssignment[];
  timetable?: TimeTableEntry[];
  isAuthorizedForRecord: (type: 'LESSON_PLAN' | 'EXAM_PAPER', record: any) => boolean;
}

const LessonArchitectView: React.FC<LessonArchitectViewProps> = ({ user, config, assignments, timetable = [], isAuthorizedForRecord }) => {
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [topic, setTopic] = useState('');
  const [topicDetail, setTopicDetail] = useState('');
  const [classNeeds, setClassNeeds] = useState('');
  const [lessonDate, setLessonDate] = useState(formatBahrainDate());
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [archetype, setArchetype] = useState<Archetype>('STANDARD');
  const [bloomLevel, setBloomLevel] = useState<BloomLevel>('APPLY');
  const [syllabusKey, setSyllabusKey] = useState<SyllabusKey>('NONE');
  
  const [isGeneratingDiagrams, setIsGeneratingDiagrams] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [showWorksheetModal, setShowWorksheetModal] = useState(false);
  const [worksheetConfig, setWorksheetConfig] = useState({
    quantity: 1,
    tiering: 'UNIFIED' as 'UNIFIED' | 'DIFFERENTIATED',
    cognitiveMix: { recall: 60, analysis: 40 },
    components: ['MCQ', 'TRUE_FALSE', 'SCENARIO']
  });
  const [generatedWorksheets, setGeneratedWorksheets] = useState<Worksheet[]>([]);
  const [isGeneratingWorksheet, setIsGeneratingWorksheet] = useState(false);
  const [wsReasoning, setWsReasoning] = useState('');

  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [blueprintPdfBase64, setBlueprintPdfBase64] = useState<string | null>(null);
  const [blueprintPdfFileName, setBlueprintPdfFileName] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [reasoningMsg, setReasoningMsg] = useState('');
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedPlanRecord[]>([]);
  const [sharedPlans, setSharedPlans] = useState<SavedPlanRecord[]>([]);
  const [isLoadingArchives, setIsLoadingArchives] = useState(false);
  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultMode, setVaultMode] = useState<'PERSONAL' | 'DEPARTMENT'>('PERSONAL');
  const [showSaveOptions, setShowSaveOptions] = useState(false);

  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchArchives();
    fetchSharedPlans();
    checkApiKeyPresence();
    const interval = setInterval(checkApiKeyPresence, 3000);
    return () => clearInterval(interval);
  }, [subject]);

  const checkApiKeyPresence = async () => {
    const selected = await window.aistudio.hasSelectedApiKey();
    setHasKey(selected);
  };

  const handleLinkKey = async () => {
    HapticService.light();
    await window.aistudio.openSelectKey();
    setHasKey(true);
    setError(null);
  };

  const fetchArchives = async () => {
    if (!IS_CLOUD_ENABLED) return;
    setIsLoadingArchives(true);
    try {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedPlans(data || []);
    } catch (err) { console.error(err); } finally { setIsLoadingArchives(false); }
  };

  const fetchSharedPlans = async () => {
    if (!IS_CLOUD_ENABLED || !subject) return;
    try {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .eq('is_shared', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSharedPlans(data || []);
    } catch (err) { console.error(err); }
  };

  const generateLessonPlan = async (isRefiningMode: boolean = false) => {
    const selected = await window.aistudio.hasSelectedApiKey();
    if (!selected) {
      setHasKey(false);
      setError("Matrix Intelligence Interrupted: Institutional Link Required.");
      return;
    }

    if (!topic.trim() || !gradeId || !sectionId || !subject) {
      setError("Topic, Grade, Section, and Subject are required for construction.");
      return;
    }
    
    if (isRefiningMode) setIsRefining(true);
    else setIsGenerating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
      const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';
      
      let contents: any[] = [];
      const promptText = `Generate a detailed IHIS lesson plan for ${gradeName} ${sectionName} ${subject} on ${topic}. Output JSON format.`;
      contents.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: contents },
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(response.text || "{}");
      setLessonPlan(data);
      HapticService.success();
    } catch (err: any) {
      if (err.message?.includes("API Key")) setHasKey(false);
      setError(`Matrix Interrupted: ${err.message}`);
    } finally {
      setIsGenerating(false);
      setIsRefining(false);
    }
  };

  // If Key is missing, show high-contrast blocker UI
  if (!hasKey && !lessonPlan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 animate-in zoom-in duration-500">
        <div className="bg-white dark:bg-slate-900 p-12 rounded-[4rem] shadow-2xl border-4 border-amber-400 text-center space-y-8 max-w-xl">
           <div className="w-24 h-24 bg-amber-400 rounded-3xl flex items-center justify-center mx-auto shadow-xl text-[#001f3f] animate-bounce">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
           </div>
           <div className="space-y-4">
              <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Activation Required</h2>
              <p className="text-sm font-medium text-slate-500 leading-relaxed italic">
                A Free API Key is all that is needed. Please visit <strong>My Profile</strong> to link your personal key. 
              </p>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                 Staff with 'Free Keys' are fully supported. No payment details required.
              </div>
           </div>
           <button 
             onClick={handleLinkKey}
             className="w-full bg-[#001f3f] text-amber-400 py-6 rounded-[2rem] font-black text-sm uppercase tracking-[0.4em] shadow-xl hover:bg-slate-950 transition-all active:scale-95"
           >
             Establish Matrix Link
           </button>
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Institutional AI Protocol • Ibn Al Hytham Islamic School</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 px-4 animate-in fade-in duration-700">
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
          <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 space-y-8 relative overflow-hidden group">
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Genesis Module</h3>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Date</label>
                     <input type="date" value={lessonDate} onChange={e => setLessonDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400" />
                   </div>
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Subject</label>
                     <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                        <option value="" className="text-black">Choose...</option>
                        {config.subjects.map(s => <option key={s.id} value={s.name} className="text-black">{s.name}</option>)}
                     </select>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <select value={gradeId} onChange={e => { setGradeId(e.target.value); setSectionId(''); }} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                      <option value="" className="text-black">Grade...</option>
                      {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                   </select>
                   <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                      <option value="" className="text-black">Section...</option>
                      {config.sections.filter(s => s.gradeId === gradeId).map(s => <option key={s.id} value={s.id} className="text-black">{s.name}</option>)}
                   </select>
                </div>

                <div className="space-y-1">
                   <label className="text-[8px] font-black text-white/40 uppercase ml-2">Topic Heading</label>
                   <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Chemical Equilibrium" className="w-full bg-white/5 border border-white/10 rounded-xl px-6 py-4 text-sm text-white font-black outline-none focus:border-amber-400" />
                </div>

                <button 
                  onClick={() => generateLessonPlan(false)}
                  disabled={isGenerating || !topic.trim()}
                  className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all active:scale-95 disabled:opacity-30"
                >
                  {isGenerating ? reasoningMsg || 'Processing Matrix...' : 'Architect Blueprint'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[800px] flex flex-col overflow-hidden relative">
              <div className="p-12 md:p-20 flex-1 flex flex-col items-center justify-center opacity-20 uppercase tracking-[0.5em] text-center">
                 <svg className="w-48 h-48 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                 Defining Matrix Sequence
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default LessonArchitectView;

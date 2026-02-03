import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { User, SchoolConfig, TeacherAssignment, SubjectCategory, SchoolSection, TimeTableEntry, LessonPlan, SavedPlanRecord, Worksheet, WorksheetQuestion } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { formatBahrainDate } from '../utils/dateUtils.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

declare var html2pdf: any;

// Fix: Removed local declare global for window.aistudio to resolve identical modifiers conflict with environment-provided AIStudio type

// Fix: Defining missing types for LessonArchitectView
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
  // Key Readiness State
  const [hasKey, setHasKey] = useState<boolean>(true);

  // Input States
  const [topic, setTopic] = useState('');
  const [topicDetail, setTopicDetail] = useState('');
  // Added classNeeds state to resolve "Cannot find name 'classNeeds'" error
  const [classNeeds, setClassNeeds] = useState('');
  const [lessonDate, setLessonDate] = useState(formatBahrainDate());
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subject, setSubject] = useState('');
  const [archetype, setArchetype] = useState<Archetype>('STANDARD');
  const [bloomLevel, setBloomLevel] = useState<BloomLevel>('APPLY');
  const [syllabusKey, setSyllabusKey] = useState<SyllabusKey>('NONE');
  
  // Advanced Feature States
  const [isGeneratingDiagrams, setIsGeneratingDiagrams] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Worksheet Engine States
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

  // Multimodal States
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [blueprintPdfBase64, setBlueprintPdfBase64] = useState<string | null>(null);
  const [blueprintPdfFileName, setBlueprintPdfFileName] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  // Logic States
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
  
  // Faculty Vault States
  const [showSaveOptions, setShowSaveOptions] = useState(false);

  // Refinement State
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchArchives();
    fetchSharedPlans();
    checkApiKeyPresence();
  }, [subject]);

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

  // Contextual Memory: Identify previous plans for this grade/subject
  const contextualMemoryCount = useMemo(() => {
    if (!gradeId || !subject) return 0;
    return savedPlans.filter(p => p.grade_id === gradeId && p.subject === subject).length;
  }, [gradeId, subject, savedPlans]);

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

  const handleSyncWithMatrix = () => {
    HapticService.light();
    const d = new Date(lessonDate);
    const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(d);
    const duties = timetable.filter(t => t.teacherId === user.id && t.day === dayName && !t.date);
    if (duties.length === 0) {
      setError("No matrix duties detected for the selected date.");
      return;
    }
    const target = duties[0];
    setGradeId(target.gradeId);
    setSectionId(target.sectionId);
    setSubject(target.subject);
    setError(null);
    HapticService.success();
  };

  const handleToggleVoice = () => {
    if (isRecording) {
      setIsRecording(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition not supported on this terminal.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => { setIsRecording(true); HapticService.light(); };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setTopicDetail(prev => prev + " " + transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setOcrImage((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  };

  const handlePdfBlueprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlueprintPdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setBlueprintPdfBase64((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  };

  // Helper to clean JSON response from AI
  const cleanAIJsonResponse = (text: string) => {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
    }
    return cleaned;
  };

  const generateLessonPlan = async (isRefiningMode: boolean = false) => {
    if (!hasKey) {
      setError("API Key Selection Required. Click the Matrix Link button.");
      return;
    }

    if (!topic.trim() || !gradeId || !sectionId || !subject) {
      setError("Topic, Grade, Section, and Subject are required for construction.");
      return;
    }
    
    if (isRefiningMode) setIsRefining(true);
    else setIsGenerating(true);
    
    setError(null);
    setAudioUrl(null);
    HapticService.light();

    const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
    const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';

    const reasoningSteps = [
      "Connecting to Bahrain Matrix...",
      "Sourcing Ibn Al Hytham curriculum data...",
      "Accessing Faculty Vault: Analyzing Contextual Memory...",
      "Applying Bloom's Taxonomy layer...",
      "Analyzing board compliance standards...",
      "Drafting Bahraini contextual examples...",
      "Finalizing Pedagogical Blueprint..."
    ];

    let step = 0;
    const interval = setInterval(() => {
      setReasoningMsg(reasoningSteps[step % reasoningSteps.length]);
      step++;
    }, 1500);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let finalPrompt = "";
      let contents: any[] = [];
      
      if (isRefiningMode && lessonPlan) {
        finalPrompt = `
          REFINE the following lesson plan for ${SCHOOL_NAME}. 
          ORIGINAL PLAN: ${JSON.stringify(lessonPlan)}
          TEACHER'S REFINEMENT REQUEST: "${refinementPrompt}"
          
          Maintain the exact JSON structure. Do not lose existing context unless explicitly asked. 
          Keep Bahraini/Islamic integration consistent.
        `;
      } else {
        const archetypeGuide = {
          STANDARD: "Focus on clear concept delivery and balanced activities.",
          EXAM_PREP: "Focus heavily on question patterns, common errors, and quick recall techniques.",
          PROJECT_BASED: "Focus on inquiry, collaborative build phases, and outcome presentations.",
          REMEDIAL: "Focus on simplifying core concepts and high-frequency feedback loops."
        };

        const blueprintInstruction = blueprintPdfBase64 
          ? "IMPORTANT: A PDF blueprint has been provided. Strictly follow its structure, specific objectives, and instructional flow. Use the metadata provided as a supplement but prioritize the PDF content." 
          : "Create a rigorous and creative plan based on the metadata provided.";

        const previousPlans = savedPlans
          .filter(p => p.grade_id === gradeId && p.subject === subject)
          .map(p => ({ topic: p.topic, objectives: p.plan_data.objectives }));
        
        const memoryInstruction = previousPlans.length > 0 
          ? `CONTEXTUAL MEMORY: The faculty has already taught these topics for this grade: ${JSON.stringify(previousPlans)}. Ensure the current plan on "${topic}" progresses logically from these and avoids redundant objectives.`
          : "";

        finalPrompt = `
          Create a professional lesson plan for ${SCHOOL_NAME}, Bahrain (Academic Year 2026-2027).
          CONTEXT: Teacher: ${user.name}, Grade: ${gradeName}, Section: ${sectionName}, Subject: ${subject}, Topic: ${topic}.
          BOARD ANCHOR: ${syllabusKey === 'NONE' ? 'Standard Institutional' : syllabusKey}.
          PEDAGOGICAL WRAPPER: Archetype: ${archetype} (${archetypeGuide[archetype]}). Bloom Level: ${bloomLevel}. 
          DIFFERENTIATION: ${classNeeds || 'General Mixed Ability'}.
          USER DETAILS: ${topicDetail || 'Standard syllabus.'}

          BLUEPRINT PROTOCOL: ${blueprintInstruction}
          ${memoryInstruction}

          REQUIREMENTS:
          - Use Bahraini/Islamic contextual examples for concepts.
          - Use Bloom's verbs for Objectives.
          - Identify specific Laboratory or ICT resources needed.
          - Output JSON ONLY.
          Structure:
          {
            "title": "...",
            "syllabusKey": "${syllabusKey}",
            "objectives": ["..."],
            "procedure": [{"step": "...", "description": "...", "duration": "..."}],
            "assessment": "...",
            "homework": "...",
            "differentiation": {"sen": "Strategy for SEN", "gt": "Strategy for G&T"},
            "exitTickets": ["3 specific end-of-class questions"],
            "diagramPrompts": ["2-3 descriptive visual prompts for AI image generation"],
            "resourceRequests": ["List of lab/ICT equipment"],
            "rubric": [{"criteria": "...", "expectation": "..."}]
          }
        `;
      }

      if (ocrImage) {
        contents.push({ inlineData: { data: ocrImage, mimeType: 'image/jpeg' } });
      }
      if (blueprintPdfBase64) {
        contents.push({ inlineData: { data: blueprintPdfBase64, mimeType: 'application/pdf' } });
      }
      
      contents.push({ text: finalPrompt });

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: contents },
        config: { 
          // Fix: responseMimeType is not supported for gemini-3-pro-preview when multimodal inputs are present? No, it should be fine.
          responseMimeType: "application/json", 
          temperature: 0.7
        }
      });

      const cleanedText = cleanAIJsonResponse(response.text || "{}");
      const data = JSON.parse(cleanedText);
      setLessonPlan(data);
      setGeneratedWorksheets([]); 
      setRefinementPrompt('');
      setOcrImage(null);
      setBlueprintPdfBase64(null);
      setBlueprintPdfFileName(null);
      if (isRefiningMode) HapticService.success();
    } catch (err: any) {
      console.error("AI GENERATION ERROR:", err);
      if (err.message?.includes("API Key")) {
        setHasKey(false);
      }
      setError(`Matrix Intelligence Interrupted: ${err.message || "Unknown connectivity issue."}`);
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
      setIsRefining(false);
      setReasoningMsg('');
    }
  };

  const handleGenerateVisuals = async () => {
    if (!lessonPlan || !lessonPlan.diagramPrompts?.length) return;
    setIsGeneratingDiagrams(true);
    HapticService.light();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const images: string[] = [];
      
      for (const promptText of lessonPlan.diagramPrompts) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: `High-quality, clean educational diagram for IHIS Classroom: ${promptText}. Plain background, no complex text labels.` }] },
          config: { imageConfig: { aspectRatio: "1:1" } }
        });
        
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            images.push(`data:image/png;base64,${part.inlineData.data}`);
          }
        }
      }
      
      setLessonPlan({ ...lessonPlan, generatedDiagrams: images });
      HapticService.success();
    } catch (err: any) {
      if (err.message?.includes("API Key")) setHasKey(false);
      setError("Visual Oracle Synchronization Failed.");
    } finally {
      setIsGeneratingDiagrams(false);
    }
  };

  const handleGenerateAudioBriefing = async () => {
    if (!lessonPlan) return;
    setIsGeneratingAudio(true);
    HapticService.light();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const summaryText = `Salams. This is your briefing for the lesson on ${topic}. 
        Objectives include: ${lessonPlan.objectives.join(', ')}. 
        The procedure involves ${lessonPlan.procedure.length} phases. 
        Focus on ${lessonPlan.differentiation?.sen} for your support tier. 
        Good luck with the session at Ibn Al Hytham Islamic School.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say professionally and clearly: ${summaryText}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const blob = new Blob([bytes], { type: 'audio/wav' });
        setAudioUrl(URL.createObjectURL(blob));
        setLessonPlan({ ...lessonPlan, audioBriefing: base64Audio });
      }
      HapticService.success();
    } catch (err: any) {
      if (err.message?.includes("API Key")) setHasKey(false);
      setError("Audio Mirroring Protocol Failed.");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const generateWorksheetsLogic = async () => {
    if (!lessonPlan) return;
    setIsGeneratingWorksheet(true);
    HapticService.light();
    
    const reasoningSteps = [
      "Analyzing Lesson Blueprint...",
      "Mapping Bloom's Complexity to Questions...",
      "Synthesizing Tiered Difficulty Levels...",
      "Drafting Marking Scheme Matrix...",
      "Finalizing Institutional Assessment Pack..."
    ];
    let step = 0;
    const interval = setInterval(() => {
      setWsReasoning(reasoningSteps[step % reasoningSteps.length]);
      step++;
    }, 1500);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const gradeName = config.grades.find(g => g.id === gradeId)?.name || 'Unknown Grade';
      const sectionName = config.sections.find(s => s.id === sectionId)?.name || '';

      const prompt = `
        Based on the lesson plan titled "${lessonPlan.title}" for topic "${topic}", generate ${worksheetConfig.quantity} unique worksheet(s).
        
        CONFIG:
        - Tiering Strategy: ${worksheetConfig.tiering} (SUPPORT, CORE, EXTENSION).
        - Cognitive Mix: ${worksheetConfig.cognitiveMix.recall}% Recall / ${worksheetConfig.cognitiveMix.analysis}% Analysis.
        - Question Types: ${worksheetConfig.components.join(', ')}.
        - Bahraini Context: Mandatory integration of local examples.
        - Objectives: ${lessonPlan.objectives.join('; ')}.

        Output JSON ONLY:
        [
          {
            "id": "ws-1",
            "title": "Worksheet Title",
            "tiering": "UNIFIED|DIFFERENTIATED",
            "questions": [
              {
                "id": "q-1",
                "type": "MCQ|TRUE_FALSE|SCENARIO|DIAGRAM_ANALYSIS|DESCRIPTIVE",
                "text": "...",
                "options": ["A", "B", "C", "D"], 
                "answer": "...",
                "markingGuide": "How to award partial marks",
                "tier": "SUPPORT|CORE|EXTENSION"
              }
            ]
          }
        ]
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: { responseMimeType: "application/json", temperature: 0.8 }
      });

      const cleanedText = cleanAIJsonResponse(response.text || "[]");
      const data = JSON.parse(cleanedText);
      const mappedWorksheets = data.map((ws: any) => ({
        ...ws,
        gradeName,
        sectionName,
        subject,
        date: lessonDate
      }));

      setGeneratedWorksheets(mappedWorksheets);
      setShowWorksheetModal(false);
      HapticService.success();
    } catch (err: any) {
      if (err.message?.includes("API Key")) setHasKey(false);
      setError("Worksheet Engine Synchronization Failed.");
    } finally {
      clearInterval(interval);
      setIsGeneratingWorksheet(false);
      setWsReasoning('');
    }
  };

  const regenerateQuestion = async (wsId: string, qId: string) => {
    const wsIdx = generatedWorksheets.findIndex(w => w.id === wsId);
    if (wsIdx === -1) return;
    
    HapticService.light();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentWs = generatedWorksheets[wsIdx];
      const currentQ = currentWs.questions.find(q => q.id === qId);

      const prompt = `Regenerate one ${currentQ?.type} question for topic "${topic}" similar to "${currentQ?.text}" but different content. Match the tier ${currentQ?.tier}. Output JSON ONLY for ONE question object.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const cleanedText = cleanAIJsonResponse(response.text || "{}");
      const newQ = JSON.parse(cleanedText);
      const updatedQs = currentWs.questions.map(q => q.id === qId ? { ...newQ, id: generateUUID() } : q);
      const updatedWs = [...generatedWorksheets];
      updatedWs[wsIdx] = { ...currentWs, questions: updatedQs };
      setGeneratedWorksheets(updatedWs);
    } catch (e: any) {
      if (e.message?.includes("API Key")) setHasKey(false);
      setError("Question swap failed.");
    }
  };

  const handleSavePlan = async (isShared: boolean = false, planStatus: 'DRAFT' | 'APPROVED' = 'APPROVED') => {
    if (!lessonPlan || !IS_CLOUD_ENABLED) return;
    setIsSaving(true);
    setShowSaveOptions(false);
    try {
      const payload = {
        teacher_id: user.id,
        teacher_name: user.name,
        date: lessonDate,
        grade_id: gradeId,
        section_id: sectionId,
        subject: subject,
        topic: topic,
        plan_data: {
          ...lessonPlan,
          status: planStatus,
          worksheets: generatedWorksheets 
        },
        is_shared: isShared,
        department: subject
      };
      const { error } = await supabase.from('lesson_plans').insert(payload);
      if (error) throw error;
      HapticService.success();
      fetchArchives();
      setError(null);
    } catch (err: any) { setError("Matrix Storage Failure."); } finally { setIsSaving(false); }
  };

  const handlePrint = (elementId: string, filename: string) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const opt = {
      margin: 10,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
  };

  const handleDeleteArchive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Permanently dismantle this record?")) return;
    try {
      await supabase.from('lesson_plans').delete().eq('id', id);
      setSavedPlans(prev => prev.filter(p => p.id !== id));
      HapticService.notification();
    } catch (err) { console.error(err); }
  };

  const handleLoadArchive = (archive: SavedPlanRecord) => {
    setLessonDate(archive.date);
    setGradeId(archive.grade_id);
    setSectionId(archive.section_id);
    setSubject(archive.subject);
    setTopic(archive.topic);
    setLessonPlan(archive.plan_data);
    if ((archive.plan_data as any).worksheets) {
      setGeneratedWorksheets((archive.plan_data as any).worksheets);
    } else {
      setGeneratedWorksheets([]);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredArchives = useMemo(() => {
    const list = vaultMode === 'PERSONAL' ? savedPlans : sharedPlans;
    const authorized = list.filter(p => isAuthorizedForRecord('LESSON_PLAN', p));
    
    if (!vaultSearch) return authorized;
    const q = vaultSearch.toLowerCase();
    return authorized.filter(p => p.topic.toLowerCase().includes(q) || p.subject.toLowerCase().includes(q));
  }, [savedPlans, sharedPlans, vaultSearch, vaultMode, isAuthorizedForRecord]);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-32 px-4 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 no-print">
        <div className="space-y-1">
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Lesson <span className="text-[#d4af37]">Architect</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mt-2">Instructional Mission Control</p>
        </div>

        {/* API STATUS BADGE */}
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
          <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 space-y-8 relative overflow-hidden group">
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Genesis Module</h3>
                <button onClick={handleSyncWithMatrix} className="p-2 bg-white/10 rounded-xl text-amber-400 hover:bg-white/20 transition-all shadow-lg" title="Sync with current Timetable Matrix"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
              </div>

              {contextualMemoryCount > 0 && (
                <div className="px-4 py-2 bg-amber-400/10 border border-amber-400/20 rounded-xl flex items-center gap-3 animate-in fade-in zoom-in duration-500">
                   <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                   <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Vault Memory: {contextualMemoryCount} Previous Plans linked</p>
                </div>
              )}

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
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Target Grade</label>
                     <select value={gradeId} onChange={e => { setGradeId(e.target.value); setSectionId(''); }} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                        <option value="" className="text-black">Select Grade...</option>
                        {config.grades.map(g => <option key={g.id} value={g.id} className="text-black">{g.name}</option>)}
                     </select>
                   </div>
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Section</label>
                     <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                        <option value="" className="text-black">Select...</option>
                        {config.sections.filter(s => s.gradeId === gradeId).map(s => (
                          <option key={s.id} value={s.id} className="text-black">{s.name}</option>
                        ))}
                     </select>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Board Compliance</label>
                     <select value={syllabusKey} onChange={e => setSyllabusKey(e.target.value as SyllabusKey)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                        <option value="NONE" className="text-black">Standard IHIS</option>
                        <option value="CBSE" className="text-black">CBSE Framework</option>
                        <option value="BAHRAIN_NATIONAL" className="text-black">Bahrain National</option>
                     </select>
                   </div>
                   <div className="space-y-1">
                     <label className="text-[8px] font-black text-white/40 uppercase ml-2">Bloom's Complexity</label>
                     <select value={bloomLevel} onChange={e => setBloomLevel(e.target.value as BloomLevel)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-amber-400">
                        <option value="REMEMBER" className="text-black">L1: Remember</option>
                        <option value="UNDERSTAND" className="text-black">L2: Understand</option>
                        <option value="APPLY" className="text-black">L3: Apply</option>
                        <option value="ANALYZE" className="text-black">L4: Analyze</option>
                        <option value="EVALUATE" className="text-black">L5: Evaluate</option>
                        <option value="CREATE" className="text-black">L6: Create</option>
                     </select>
                   </div>
                </div>

                <div className="space-y-1">
                   <label className="text-[8px] font-black text-white/40 uppercase ml-2">Topic Heading</label>
                   <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Chemical Equilibrium" className="w-full bg-white/5 border border-white/10 rounded-xl px-6 py-4 text-sm text-white font-black uppercase italic outline-none focus:border-amber-400 placeholder:text-white/20" />
                </div>

                <div className="space-y-1 relative">
                   <label className="text-[8px] font-black text-white/40 uppercase ml-2">Additional Details</label>
                   <textarea value={topicDetail} onChange={e => setTopicDetail(e.target.value)} placeholder="Explain nuances, class profile, or specific lab requirements..." className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none placeholder:text-white/20" />
                   <button onClick={handleToggleVoice} className={`absolute bottom-3 right-3 p-3 rounded-full shadow-lg transition-all ${isRecording ? 'bg-rose-50 animate-pulse text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                   </button>
                </div>

                {/* Added Class Needs / Differentiation field to fix missing variable and improve plan quality */}
                <div className="space-y-1">
                   <label className="text-[8px] font-black text-white/40 uppercase ml-2">Class Needs / Differentiation</label>
                   <textarea value={classNeeds} onChange={e => setClassNeeds(e.target.value)} placeholder="e.g. 5 SEN students, 2 G&T..." className="w-full h-20 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white outline-none focus:border-amber-400 resize-none placeholder:text-white/20" />
                </div>

                <div className="space-y-4">
                   <p className="text-[8px] font-black text-amber-500 uppercase tracking-widest ml-2">Structural Blueprint (Optional PDF)</p>
                   <div onClick={() => pdfInputRef.current?.click()} className={`cursor-pointer border-2 border-dashed rounded-[2rem] p-6 text-center transition-all ${blueprintPdfBase64 ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 hover:border-amber-400 bg-white/5'}`}>
                      {blueprintPdfBase64 ? (
                        <div className="space-y-2">
                           <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center mx-auto"><svg className="w-5 h-5 text-[#001f3f]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>
                           <p className="text-[9px] font-black text-amber-400 uppercase truncate">{blueprintPdfFileName}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                           <svg className="w-8 h-8 text-white/20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>                           <p className="text-[8px] font-black text-white/30 uppercase tracking-widest">Upload PDF Blueprint</p>
                        </div>
                      )}
                   </div>
                   <input type="file" ref={pdfInputRef} className="hidden" accept="application/pdf" onChange={handlePdfBlueprintUpload} />
                </div>

                <div className="space-y-4">
                   <p className="text-[8px] font-black text-sky-400 uppercase tracking-widest ml-2">OCR Source Ingested</p>
                   <div onClick={() => fileInputRef.current?.click()} className={`cursor-pointer border-2 border-dashed rounded-[2rem] p-6 text-center transition-all ${ocrImage ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 hover:border-sky-400 bg-white/5'}`}>
                      {ocrImage ? (
                        <div className="space-y-2">
                           <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center mx-auto"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg></div>
                           <p className="text-[9px] font-black text-emerald-400 uppercase">OCR Source Ingested</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                           <svg className="w-8 h-8 text-white/20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                           <p className="text-[8px] font-black text-white/30 uppercase tracking-widest">Syllabus Snapshot / OCR</p>
                        </div>
                      )}
                   </div>
                   <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                </div>
              </div>

              {error && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl">
                   <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest text-center">{error}</p>
                </div>
              )}

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
                  onClick={() => generateLessonPlan(false)}
                  disabled={isGenerating || !topic.trim()}
                  className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-white transition-all active:scale-95 disabled:opacity-30"
                >
                  {isGenerating ? reasoningMsg : 'Architect Blueprint'}
                </button>
              )}
            </div>
          </div>

          <div className="bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-white/5 space-y-6">
             <div className="flex bg-white/5 p-1 rounded-2xl mb-4">
                <button onClick={() => setVaultMode('PERSONAL')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${vaultMode === 'PERSONAL' ? 'bg-[#001f3f] text-amber-400' : 'text-slate-500'}`}>My Vault</button>
                <button onClick={() => setVaultMode('DEPARTMENT')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${vaultMode === 'DEPARTMENT' ? 'bg-[#001f3f] text-sky-400' : 'text-slate-500'}`}>Dept. Shared</button>
             </div>
             <input type="text" value={vaultSearch} onChange={e => setVaultSearch(e.target.value)} placeholder="Search Repository..." className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none" />
             <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-hide pr-2">
                {filteredArchives.map(plan => (
                  <button key={plan.id} onClick={() => handleLoadArchive(plan)} className="w-full text-left p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group relative overflow-hidden">
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-black text-sky-400 uppercase">{plan.subject}</span>
                        {(plan.plan_data as any).status === 'DRAFT' ? (
                          <span className="px-1.5 py-0.5 bg-slate-500/20 text-slate-400 text-[6px] font-black uppercase rounded">Draft</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[6px] font-black uppercase rounded">Approved</span>
                        )}
                      </div>
                      <span className="text-[8px] font-bold text-white/30">{plan.date}</span>
                    </div>
                    <p className="text-[10px] font-bold text-white truncate uppercase italic">{plan.topic}</p>
                    {vaultMode === 'DEPARTMENT' && <p className="text-[7px] font-black text-slate-500 mt-1">By: {plan.teacher_name}</p>}
                    {vaultMode === 'PERSONAL' && <div onClick={(e) => handleDeleteArchive(plan.id, e)} className="absolute right-2 bottom-2 p-1.5 text-white/10 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></div>}
                  </button>
                ))}
             </div>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div className="bg-white dark:bg-slate-900 rounded-[4rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[800px] flex flex-col overflow-hidden relative">
              {lessonPlan && (
                <div className="absolute top-8 right-8 no-print flex flex-col md:flex-row gap-3 z-50">
                   <button onClick={() => setShowWorksheetModal(true)} className="px-5 py-3 bg-amber-500 text-[#001f3f] rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-amber-400 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Initialize Assessments</button>
                   <button onClick={handleGenerateVisuals} disabled={isGeneratingDiagrams} className="px-5 py-3 bg-indigo-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-indigo-700 transition-all disabled:opacity-50"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>{isGeneratingDiagrams ? 'Generating Visuals...' : 'Visual Oracle'}</button>
                   <button onClick={handleGenerateAudioBriefing} disabled={isGeneratingAudio} className="px-5 py-3 bg-rose-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-rose-700 transition-all disabled:opacity-50"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>{isGeneratingAudio ? 'Synthesizing...' : 'Audio Mirroring'}</button>
                   
                   <div className="relative group">
                     <button onClick={() => setShowSaveOptions(!showSaveOptions)} disabled={isSaving} className="px-5 py-3 bg-emerald-500 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-emerald-600 transition-all disabled:opacity-50"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>Commit to Vault</button>
                     {showSaveOptions && (
                       <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-2 z-[100] border border-slate-100 animate-in zoom-in duration-200">
                          <button onClick={() => handleSavePlan(false, 'DRAFT')} className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-[9px] font-black uppercase flex items-center justify-between">
                            Save as Draft <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                          </button>
                          <button onClick={() => handleSavePlan(false, 'APPROVED')} className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-[9px] font-black uppercase flex items-center justify-between">
                            Finalize & Save <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          </button>
                          <div className="h-px bg-slate-100 dark:bg-slate-700 my-1"></div>
                          <button onClick={() => handleSavePlan(true, 'APPROVED')} className="w-full text-left p-3 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-xl text-[9px] font-black uppercase text-sky-600 flex items-center justify-between">
                            Share with Dept <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                          </button>
                       </div>
                     )}
                   </div>

                   <button onClick={() => window.print()} className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-[9px] font-black uppercase shadow-xl hover:bg-slate-800 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>Print</button>
                </div>
              )}

              <div className="p-12 md:p-20 overflow-y-auto scrollbar-hide">
                 {isGenerating ? (
                   <div className="h-full flex flex-col items-center justify-center space-y-12 py-32">
                      <div className="relative w-40 h-40">
                         <div className="absolute inset-0 border-8 border-slate-100 rounded-full"></div>
                         <div className="absolute inset-0 border-8 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div>
                         <div className="absolute inset-0 flex items-center justify-center font-black text-3xl text-amber-500 animate-pulse italic">IHIS</div>
                      </div>
                      <div className="text-center space-y-2">
                        <p className="text-xl font-black uppercase tracking-[0.5em] text-[#001f3f] dark:text-white">{reasoningMsg}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Neural Link Synchronizing with Institutional Hub</p>
                      </div>
                   </div>
                 ) : lessonPlan ? (
                   <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 space-y-16">
                      <div id="print-area-lesson">
                        <div className="flex items-center gap-10 border-b-4 border-slate-100 dark:border-slate-800 pb-12">
                           <div className="w-28 h-28 p-5 bg-white rounded-[2rem] shadow-2xl border border-slate-50 rotate-3">
                              <img src={SCHOOL_LOGO_BASE64} alt="Seal" className="w-full h-full object-contain" />
                           </div>
                           <div className="flex-1 space-y-4">
                              <h2 className="text-4xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">{SCHOOL_NAME}</h2>
                              <div className="flex flex-wrap items-center gap-6">
                                 <span className="text-xs font-black text-amber-500 uppercase tracking-widest">Faculty: {user.name}</span>
                                 <span className="text-xs font-black text-sky-600 uppercase tracking-widest">Date: {lessonDate}</span>
                                 {lessonPlan.syllabusKey !== 'NONE' && (
                                   <span className="px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-lg text-[9px] font-black uppercase tracking-widest">Compliance: {lessonPlan.syllabusKey}</span>
                                 )}
                              </div>
                           </div>
                        </div>

                        {audioUrl && (
                          <div className="bg-[#001f3f] p-6 rounded-[2.5rem] border border-amber-400/20 shadow-xl flex items-center justify-between gap-6 no-print mt-8">
                             <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center text-[#001f3f] shadow-lg animate-pulse"><svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.983 5.983 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.982 3.982 0 0013 10a3.982 3.982 0 00-1.172-2.828 1 1 0 010-1.415z"/></svg></div>
                                <div>
                                   <p className="text-[10px] font-black text-white uppercase italic tracking-widest">Audio Mirroring Briefing</p>
                                   <p className="text-[8px] font-bold text-amber-400 uppercase tracking-[0.4em]">Faculty Instructional Sequence</p>
                                </div>
                             </div>
                             <audio src={audioUrl} controls className="h-8 max-w-[200px]" />
                          </div>
                        )}

                        <div className="text-center space-y-4 mt-12">
                           <h3 className="text-5xl font-black text-[#001f3f] dark:text-sky-400 uppercase tracking-tighter italic leading-none">{lessonPlan.title}</h3>
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.8em]">{subject} • MATRIX TOPIC: {topic}</p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-12">
                           <div className="bg-slate-50 dark:bg-slate-800/50 p-10 rounded-[3rem] space-y-6 shadow-inner">
                              <h4 className="text-xs font-black text-[#001f3f] dark:text-amber-400 uppercase tracking-[0.3em] flex items-center gap-4">
                                 <div className="w-2 h-6 bg-amber-400 rounded-full"></div> Core Objectives
                              </h4>
                              <ul className="space-y-4">
                                 {lessonPlan.objectives.map((obj, i) => (
                                   <li key={i} className="text-sm font-bold text-slate-600 dark:text-slate-300 flex items-start gap-4 leading-relaxed">
                                      <span className="text-amber-500 mt-1 font-black">»</span> {obj}
                                   </li>
                                 ))}
                              </ul>
                           </div>
                           
                           <div className="bg-emerald-50 dark:bg-emerald-900/10 p-10 rounded-[3rem] space-y-6 shadow-inner border border-emerald-100">
                              <h4 className="text-xs font-black text-emerald-600 uppercase tracking-[0.3em] flex items-center gap-4">
                                 <div className="w-2 h-6 bg-emerald-500 rounded-full"></div> Differentiation Matrix
                              </h4>
                              <div className="space-y-6">
                                 <div className="p-4 bg-white/50 rounded-2xl border border-emerald-200">
                                    <p className="text-[9px] font-black text-emerald-500 uppercase mb-2">Support Tier (SEN)</p>
                                    <p className="text-xs font-bold italic text-slate-600">{lessonPlan.differentiation?.sen}</p>
                                 </div>
                                 <div className="p-4 bg-white/50 rounded-2xl border border-sky-200">
                                    <p className="text-[9px] font-black text-sky-500 uppercase mb-2">Extension Tier (G&T)</p>
                                    <p className="text-xs font-bold italic text-slate-600">{lessonPlan.differentiation?.gt}</p>
                                 </div>
                              </div>
                           </div>
                        </div>

                        {lessonPlan.resourceRequests && lessonPlan.resourceRequests.length > 0 && (
                          <div className="bg-[#001f3f] rounded-[3rem] p-10 space-y-6 shadow-2xl border border-amber-400/20 mt-16 relative overflow-hidden group">
                             <div className="absolute -top-10 -right-10 opacity-5 group-hover:scale-125 transition-all duration-1000"><svg className="w-48 h-48 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/><path d="M7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg></div>
                             <div className="relative z-10">
                               <h4 className="text-xs font-black text-amber-400 uppercase tracking-[0.4em] italic flex items-center gap-4">
                                  <div className="w-2 h-6 bg-amber-400 rounded-full"></div> Resource Sentinel Requests
                               </h4>
                               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                                  {lessonPlan.resourceRequests.map((r, i) => (
                                    <div key={i} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center gap-3">
                                       <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                                       <span className="text-[10px] font-black text-white uppercase tracking-tight truncate">{r}</span>
                                    </div>
                                  ))}
                               </div>
                               <button className="mt-8 px-6 py-3 bg-white text-[#001f3f] rounded-2xl text-[9px] font-black uppercase shadow-xl hover:bg-amber-400 transition-all no-print">Dispatch to Lab Assistant</button>
                             </div>
                          </div>
                        )}

                        <div className="space-y-10 mt-16">
                           <h4 className="text-sm font-black text-slate-400 uppercase tracking-[0.6em] text-center italic">Phase Sequence & Visual Assets</h4>
                           <div className="space-y-12">
                              {lessonPlan.procedure.map((p, i) => (
                                <div key={i} className="space-y-6">
                                  <div className="group flex gap-8 p-10 rounded-[3rem] bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-slate-800 hover:border-amber-400 transition-all shadow-xl">
                                     <div className="shrink-0 flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 bg-[#001f3f] text-white rounded-3xl flex items-center justify-center font-black text-2xl italic shadow-2xl group-hover:rotate-6 transition-transform">{i + 1}</div>
                                        <span className="text-[9px] font-black text-amber-500 uppercase">{p.duration}</span>
                                     </div>
                                     <div className="flex-1 space-y-3">
                                        <h5 className="text-lg font-black text-[#001f3f] dark:text-white uppercase tracking-widest italic">{p.step}</h5>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{p.description}</p>
                                     </div>
                                  </div>
                                  
                                  {lessonPlan.generatedDiagrams?.[i] && (
                                    <div className="mx-12 p-8 bg-slate-50 rounded-[3rem] border-4 border-dashed border-slate-200 flex flex-col items-center gap-6 animate-in zoom-in duration-700">
                                       <img src={lessonPlan.generatedDiagrams[i]} className="w-full max-w-lg rounded-3xl shadow-2xl border-8 border-white" alt={`Diagram ${i+1}`} />
                                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] italic">Visual Oracle Artifact: {lessonPlan.diagramPrompts?.[i]}</p>
                                    </div>
                                  )}
                                </div>
                              ))}
                           </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-16">
                          <div className="space-y-6">
                              <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-3"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Exit Tickets (CFU)</h4>
                              <div className="space-y-4">
                                {lessonPlan.exitTickets?.map((t, i) => (
                                  <div key={i} className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 font-bold text-xs italic text-[#001f3f] dark:text-white">{t}</div>
                                ))}
                              </div>
                          </div>
                          <div className="space-y-6">
                              <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-3"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>Home-Study Extension</h4>
                              <p className="text-sm font-bold text-slate-600 dark:text-slate-300 italic leading-relaxed bg-rose-50 dark:bg-rose-900/10 p-6 rounded-[2rem] border border-rose-100 dark:border-rose-900/30">{lessonPlan.homework}</p>
                          </div>
                        </div>

                        {lessonPlan.rubric && (
                          <div className="bg-slate-900 rounded-[3rem] p-10 space-y-6 shadow-2xl border border-white/5 overflow-hidden relative mt-16">
                              <div className="absolute top-0 right-0 p-10 opacity-5 font-black text-4xl text-white italic">RUBRIC</div>
                              <h4 className="text-xs font-black text-sky-400 uppercase tracking-[0.4em] italic">Analytical Rubric Benchmark</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {lessonPlan.rubric.map((r, i) => (
                                  <div key={i} className="p-6 bg-white/5 rounded-2xl border border-white/10">
                                      <p className="text-[10px] font-black text-amber-400 uppercase mb-2">{r.criteria}</p>
                                      <p className="text-xs font-bold text-white/70 italic leading-relaxed">{r.expectation}</p>
                                  </div>
                                ))}
                              </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-16 pt-16 border-t-8 border-slate-50 dark:border-slate-800 no-print">
                         <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl relative overflow-hidden border border-amber-400/20">
                            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                            <div className="relative z-10 space-y-6">
                               <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-2xl bg-amber-400 flex items-center justify-center text-[#001f3f] shadow-lg animate-pulse"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/></svg></div>
                                  <div>
                                     <h4 className="text-xl font-black text-white uppercase italic tracking-tighter">Architect's Dialogue</h4>
                                     <p className="text-[8px] font-black text-amber-400 uppercase tracking-[0.3em]">Refine existing blueprint through AI collaboration</p>
                                  </div>
                               </div>
                               <div className="flex flex-col md:flex-row gap-4">
                                  <input 
                                     type="text" 
                                     value={refinementPrompt} 
                                     onChange={e => setRefinementPrompt(e.target.value)} 
                                     placeholder="e.g. 'Make the rubric more aligned with IGCSE standards' or 'Add a Quranic reference for this science topic'" 
                                     className="flex-1 bg-white/5 border border-white/20 rounded-2xl px-6 py-4 text-white font-bold text-sm outline-none focus:border-amber-400 transition-all placeholder:text-white/20" 
                                  />
                                  <button 
                                     onClick={() => generateLessonPlan(true)} 
                                     disabled={isRefining || !refinementPrompt.trim()}
                                     className="px-10 py-4 bg-white text-[#001f3f] rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-amber-400 transition-all disabled:opacity-30"
                                  >
                                     {isRefining ? 'Re-Architecting...' : 'Refine Blueprint'}
                                  </button>
                               </div>
                            </div>
                         </div>
                      </div>

                      {generatedWorksheets.length > 0 && (
                        <div className="space-y-12 pt-16 border-t-8 border-[#001f3f] animate-in slide-in-from-bottom-8 duration-1000 no-print">
                           <div className="text-center">
                              <h4 className="text-3xl font-black text-[#001f3f] dark:text-amber-400 uppercase italic tracking-tighter">Institutional <span className="text-sky-500">Assessments</span></h4>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Dynamic Question Matrix Synchronized</p>
                           </div>

                           <div className="space-y-16">
                              {generatedWorksheets.map((ws, wsIdx) => (
                                <div key={ws.id} className="bg-slate-50 dark:bg-slate-800/30 p-10 rounded-[4rem] border border-slate-200 dark:border-slate-800 space-y-10">
                                   <div className="flex justify-between items-center">
                                      <h5 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{ws.title}</h5>
                                      <div className="flex gap-4">
                                         <button onClick={() => handlePrint(`ws-student-${ws.id}`, `Worksheet_Student_${ws.id}.pdf`)} className="px-5 py-2.5 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-slate-950">Student PDF</button>
                                         <button onClick={() => handlePrint(`ws-teacher-${ws.id}`, `Worksheet_Marking_Scheme_${ws.id}.pdf`)} className="px-5 py-2.5 bg-sky-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-sky-700">Marking Scheme</button>
                                      </div>
                                   </div>

                                   <div className="space-y-6">
                                      {ws.questions.map((q, qIdx) => (
                                        <div key={q.id} className="p-8 bg-white dark:bg-slate-950 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-800 relative group transition-all hover:border-amber-400">
                                           <div className="absolute -left-3 top-8 w-10 h-10 bg-[#001f3f] text-white rounded-xl flex items-center justify-center font-black text-xs shadow-xl">{qIdx + 1}</div>
                                           <div className="pl-10 space-y-4">
                                              <div className="flex justify-between">
                                                 <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">{q.type.replace('_', ' ')} • TIER: {q.tier}</span>
                                                 <button onClick={() => regenerateQuestion(ws.id, q.id)} className="opacity-0 group-hover:opacity-100 transition-all text-sky-500 text-[8px] font-black uppercase underline">Swap Question</button>
                                              </div>
                                              <p className="text-base font-bold text-[#001f3f] dark:text-white leading-relaxed italic">"{q.text}"</p>
                                              {q.options && (
                                                <div className="grid grid-cols-2 gap-3 pt-4">
                                                   {q.options.map((opt, i) => (
                                                     <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-500">{String.fromCharCode(65+i)}. {opt}</div>
                                                   ))}
                                                </div>
                                              )}
                                           </div>
                                        </div>
                                      ))}
                                   </div>

                                   <div className="hidden">
                                      <div id={`ws-student-${ws.id}`} className="p-12 space-y-12">
                                         <div className="flex items-center gap-8 border-b-2 border-slate-200 pb-8">
                                            <img src={SCHOOL_LOGO_BASE64} className="w-20 h-20 object-contain" alt="Logo" />
                                            <div className="flex-1">
                                               <h2 className="text-xl font-black uppercase text-[#001f3f]">{SCHOOL_NAME}</h2>
                                               <p className="text-[10px] font-bold uppercase text-amber-600">Worksheet: {ws.title}</p>
                                               <div className="grid grid-cols-2 gap-4 mt-6">
                                                  <div className="border-b border-slate-300 pb-1 text-[10px] font-bold uppercase">Student Name: _____________________</div>
                                                  <div className="border-b border-slate-300 pb-1 text-[10px] font-bold uppercase">Roll No: ________</div>
                                                  <div className="border-b border-slate-300 pb-1 text-[10px] font-bold uppercase">Class/Sec: {ws.gradeName} - {ws.sectionName}</div>
                                                  <div className="border-b border-slate-300 pb-1 text-[10px] font-bold uppercase">Date: {ws.date}</div>
                                               </div>
                                            </div>
                                         </div>
                                         <div className="space-y-10">
                                            {ws.questions.map((q, i) => (
                                              <div key={q.id} className="space-y-4" style={{ pageBreakInside: 'avoid' }}>
                                                 <p className="text-sm font-bold">{i + 1}. {q.text}</p>
                                                 {q.options ? (
                                                   <div className="grid grid-cols-2 gap-4 pl-6">
                                                      {q.options.map((opt, oIdx) => <div key={oIdx} className="text-xs">{String.fromCharCode(65+oIdx)}. {opt}</div>)}
                                                   </div>
                                                 ) : (
                                                   <div className="h-24 border border-dashed border-slate-300 rounded-xl"></div>
                                                 )}
                                              </div>
                                            ))}
                                         </div>
                                      </div>
                                      <div id={`ws-teacher-${ws.id}`} className="p-12 space-y-12">
                                         <div className="flex items-center gap-8 border-b-2 border-slate-200 pb-8">
                                            <img src={SCHOOL_LOGO_BASE64} className="w-20 h-20 object-contain" alt="Logo" />
                                            <div className="flex-1">
                                               <h2 className="text-xl font-black uppercase text-[#001f3f]">{SCHOOL_NAME}</h2>
                                               <p className="text-[10px] font-black uppercase text-sky-600">Marking Scheme: {ws.title}</p>
                                            </div>
                                         </div>
                                         <div className="space-y-10">
                                            {ws.questions.map((q, i) => (
                                              <div key={q.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-3" style={{ pageBreakInside: 'avoid' }}>
                                                 <p className="text-sm font-black italic">{i + 1}. {q.text}</p>
                                                 <p className="text-xs font-black text-emerald-600 uppercase tracking-widest">Correct Answer: {q.answer}</p>
                                                 <p className="text-[10px] font-bold text-slate-500">Guide: {q.markingGuide}</p>
                                              </div>
                                            ))}
                                         </div>
                                      </div>
                                   </div>
                                </div>
                              ))}
                           </div>
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className="h-full flex flex-col items-center justify-center space-y-12 opacity-10 py-48">
                      <svg className="w-48 h-48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      <p className="text-xl font-black uppercase tracking-[0.8em]">Defining the Matrix of Learning</p>
                   </div>
                 )}
              </div>
           </div>
        </div>
      </div>

      {showWorksheetModal && (
        <div className="fixed inset-0 z-[1100] bg-[#001f3f]/95 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl space-y-10 animate-in zoom-in duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                 <svg className="w-32 h-32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>

              <div className="text-center relative z-10">
                 <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Worksheet <span className="text-amber-500">Sentinel</span></h4>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Assessment Matrix Orchestrator</p>
              </div>

              {isGeneratingWorksheet ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-8 animate-pulse">
                   <div className="w-20 h-20 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                   <p className="text-sm font-black text-slate-500 uppercase tracking-widest">{wsReasoning}</p>
                </div>
              ) : (
                <div className="space-y-8 relative z-10">
                   <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-4">
                         <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Quantity & Strategy</p>
                         <div className="space-y-3">
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                               <span className="text-[9px] font-black uppercase text-slate-400">Total Sheets</span>
                               <input type="number" min="1" max="5" value={worksheetConfig.quantity} onChange={e => setWorksheetConfig({...worksheetConfig, quantity: parseInt(e.target.value) || 1})} className="w-12 bg-white dark:bg-slate-900 rounded-lg text-center font-black text-sm" />
                            </div>
                            <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-100 dark:border-slate-700">
                               <button onClick={() => setWorksheetConfig({...worksheetConfig, tiering: 'UNIFIED'})} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${worksheetConfig.tiering === 'UNIFIED' ? 'bg-[#001f3f] text-white shadow-lg' : 'text-slate-400'}`}>Unified</button>
                               <button onClick={() => setWorksheetConfig({...worksheetConfig, tiering: 'DIFFERENTIATED'})} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${worksheetConfig.tiering === 'DIFFERENTIATED' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-400'}`}>Differentiated</button>
                            </div>
                         </div>
                      </div>

                      <div className="space-y-4">
                         <p className="text-[10px] font-black text-sky-500 uppercase tracking-widest">Cognitive Weighting</p>
                         <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                            <div className="flex justify-between items-center"><span className="text-[9px] font-bold text-slate-500 uppercase">Recall: {worksheetConfig.cognitiveMix.recall}%</span><span className="text-[9px] font-bold text-slate-500 uppercase">Analytic: {worksheetConfig.cognitiveMix.analysis}%</span></div>
                            <input type="range" min="0" max="100" step="10" value={worksheetConfig.cognitiveMix.recall} onChange={e => setWorksheetConfig({...worksheetConfig, cognitiveMix: { recall: parseInt(e.target.value), analysis: 100 - parseInt(e.target.value) }})} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none accent-sky-500" />
                            <p className="text-[7px] font-bold text-slate-400 text-center uppercase tracking-widest">Synchronized with Bloom's Tier {bloomLevel}</p>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Question Component Selection</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                         {['MCQ', 'TRUE_FALSE', 'SCENARIO', 'DIAGRAM_ANALYSIS', 'DESCRIPTIVE'].map(type => (
                           <button 
                             key={type} 
                             onClick={() => {
                               const current = worksheetConfig.components;
                               setWorksheetConfig({...worksheetConfig, components: current.includes(type) ? current.filter(c => c !== type) : [...current, type]});
                             }}
                             className={`px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-tighter border-2 transition-all ${worksheetConfig.components.includes(type) ? 'bg-[#001f3f] text-emerald-400 border-transparent shadow-lg scale-105' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-300'}`}
                           >
                             {type.replace('_', ' ')}
                           </button>
                         ))}
                      </div>
                   </div>

                   <div className="pt-6 flex gap-4">
                      <button onClick={generateWorksheetsLogic} disabled={worksheetConfig.components.length === 0} className="flex-1 bg-emerald-600 text-white py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-30">Authorize Generation</button>
                      <button onClick={() => setShowWorksheetModal(false)} className="px-8 py-6 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-[2rem] font-black text-[10px] uppercase tracking-widest">Abort</button>
                   </div>
                </div>
              )}
           </div>
        </div>
      )}
    </div>
  );
};

export default LessonArchitectView;

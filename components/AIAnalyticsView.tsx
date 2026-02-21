
import React, { useState, useEffect, useRef } from 'react';
import { User, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, UserRole } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { AIService } from '../services/geminiService.ts';

interface AIAnalyticsViewProps {
  users: User[];
  attendance: AttendanceRecord[];
  timetable: TimeTableEntry[];
  substitutions: SubstitutionRecord[];
  config: SchoolConfig;
}

const AIAnalyticsView: React.FC<AIAnalyticsViewProps> = ({ users, attendance, timetable, substitutions, config }) => {
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string>('Institutional Intelligence Briefing');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responseEndRef = useRef<HTMLDivElement>(null);

  const syncStatus = async () => {
    // Check if keys are available locally or cloud is enabled
    setHasKey(true); 
  };

  useEffect(() => {
    syncStatus();
  }, []);

  const generateReport = async () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    setError(null);
    setResponse(null);
    HapticService.light();

    try {
      const systemInstruction = `
        You are the IHIS Hybrid Intelligence Matrix Analyst for ${SCHOOL_NAME}. 
        Academic Year: 2026-2027. 
        YOUR IDENTITY: Data-driven analyst, visionary strategist, and empathetic administrator.
        INSTITUTIONAL RULES: Threshold 07:20 AM, Work Week Sun-Thu, Asia/Bahrain timezone.
      `;

      const responseText = await AIService.executeEdge(`USER REQUEST: ${prompt}`, systemInstruction);

      const fullText = responseText || "";
      const lines = fullText.split('\n');
      const detectedTitle = lines[0].replace(/[#*]/g, '').trim();
      const contentBody = lines.slice(1).join('\n').trim();

      setReportTitle(detectedTitle || "Institutional Intelligence Briefing");
      setResponse(contentBody || "Matrix analysis yielded no conclusive data.");
      HapticService.success();
    } catch (err: any) {
      setError(err.message || "Matrix Link Failure. Ensure API Key is configured in Infrastructure Hub.");
    } finally {
      setIsLoading(false);
    }
  };

  const suggestions = [
    "Identify patterns in staff tardiness this month.",
    "Which teachers are handling the highest proxy burden?",
    "Analyze Grade IX workload balance and suggest improvements.",
    "Flag faculty members at risk of burnout based on recent loads."
  ];

  useEffect(() => {
    if (response) responseEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [response]);

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-32 px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-4">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Matrix AI <span className="text-[#d4af37]">Analyst</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-0.5 bg-emerald-500 text-white text-[7px] font-black uppercase rounded shadow-sm">Hybrid Mode</span>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Visionary & Empathetic Tier Active</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6 no-print">
          <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
               <svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            </div>
            
            <div className="relative z-10 space-y-6">
              <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Intelligence Dispatch</h3>
              <textarea 
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Ask Matrix Analyst..."
                className="w-full h-48 bg-white/5 border border-white/10 rounded-[2rem] p-6 text-sm text-white font-medium outline-none focus:border-amber-400 transition-all resize-none shadow-inner"
              />
              <button 
                onClick={generateReport}
                disabled={isLoading || !prompt.trim()}
                className="w-full bg-[#d4af37] text-[#001f3f] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-white transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-3"
              >
                {isLoading ? 'Processing Request...' : 'Execute Analysis'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Queries</p>
             <div className="space-y-3">
                {suggestions.map((s, i) => (
                  <button 
                    key={i} 
                    onClick={() => setPrompt(s)}
                    className="w-full text-left p-4 bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-2xl text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-all border border-transparent hover:border-amber-200"
                  >
                    {s}
                  </button>
                ))}
             </div>
          </div>
        </div>

        <div className="lg:col-span-8">
           <div id="ai-report-matrix" className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 min-h-[600px] flex flex-col overflow-hidden relative">
              <div className="flex-1 p-8 md:p-12 overflow-y-auto scrollbar-hide">
                 {isLoading ? (
                   <div className="h-full flex flex-col items-center justify-center py-48 opacity-40">
                      <p className="text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">Analyzing Pattern Clusters</p>
                   </div>
                 ) : error ? (
                   <div className="bg-rose-50 border-2 border-rose-100 p-8 rounded-3xl text-center">
                      <p className="text-xs text-rose-500 font-medium">{error}</p>
                   </div>
                 ) : response ? (
                   <div className="prose prose-slate dark:prose-invert max-w-none animate-in fade-in slide-in-from-bottom-4 duration-1000">
                      <div className="flex flex-col items-center text-center mb-10 pb-8 border-b-2 border-slate-100 dark:border-slate-800">
                         <img src={SCHOOL_LOGO_BASE64} alt="Seal" className="w-24 h-24 mb-6" />
                         <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase leading-none">{SCHOOL_NAME}</h2>
                         <h3 className="text-xl font-black text-amber-500 uppercase mt-4">{reportTitle}</h3>
                      </div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{response}</div>
                   </div>
                 ) : (
                   <div className="h-full flex flex-col items-center justify-center py-48 opacity-10 uppercase tracking-[0.5em]">Awaiting Command Sequence</div>
                 )}
                 <div ref={responseEndRef} />
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AIAnalyticsView;

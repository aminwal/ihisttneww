
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { User, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, UserRole } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';

interface AIAnalyticsViewProps {
  users: User[];
  attendance: AttendanceRecord[];
  timetable: TimeTableEntry[];
  substitutions: SubstitutionRecord[];
  config: SchoolConfig;
}

const AIAnalyticsView: React.FC<AIAnalyticsViewProps> = ({ users, attendance, timetable, substitutions, config }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string>('Institutional Intelligence Briefing');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responseEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    responseEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (response) scrollToBottom();
  }, [response]);

  const generateReport = async () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sanitizedUsers = users.map(({ password, telegram_chat_id, ...u }) => u);
      const sanitizedConfig = { ...config, telegramBotToken: 'REDACTED', attendanceOTP: 'REDACTED' };

      const systemInstruction = `
        You are the IHIS Hybrid Intelligence Matrix Analyst for ${SCHOOL_NAME}. 
        Academic Year: 2026-2027. 
        
        YOUR IDENTITY (Triple-Tier Persona Protocol):
        1. DEFAULT ANALYST: Be precise, professional, and data-driven. Cite institutional rules strictly.
        2. VISIONARY STRATEGIST: Identify patterns and trends. Provide 2-3 actionable "Strategic Recommendations" for institutional improvement in every response.
        3. EMPATHETIC ADMINISTRATOR: Prioritize teacher well-being. Flag "Load Fatigue" if staff handle too many proxies or exceed their period caps. Suggest rest or distribution shifts where necessary.

        INSTITUTIONAL RULES:
        - Timezone: Asia/Bahrain (Strict).
        - Threshold: Arrival after 07:20 AM is "LATE".
        - Work Week: Sunday to Thursday.
        - Load Intelligence: Period caps apply (Primary: 28, Secondary: 26, Senior: 22).

        OUTPUT STYLE:
        - Use professional, analytical Markdown.
        - Create tables for lists.
        - End with a dedicated "Faculty Well-being & Strategy" section.
        - DO NOT repeat the school name or logo in your text output, as the UI handles the formal header.
        - YOUR FIRST LINE MUST BE A SUCCINCT AND FORMAL REPORT TITLE (e.g., "Faculty Tardiness Cluster Analysis").
      `;

      const dataContext = `
        Institutional State:
        - Faculty: ${sanitizedUsers.length}
        - Logs: ${attendance.length} entries
        - Matrix Entries: ${timetable.length}
        - Proxies: ${substitutions.length}

        Data Snapshot:
        Faculty: ${JSON.stringify(sanitizedUsers.slice(0, 40))}
        Attendance (Recent): ${JSON.stringify(attendance.slice(0, 100))}
        Proxies: ${JSON.stringify(substitutions.slice(0, 50))}
      `;

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `USER REQUEST: ${prompt}\n\nDATA CONTEXT: ${dataContext}`,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.8,
        }
      });

      const fullText = result.text || "";
      const lines = fullText.split('\n');
      const detectedTitle = lines[0].replace(/[#*]/g, '').trim();
      const contentBody = lines.slice(1).join('\n').trim();

      setReportTitle(detectedTitle || "Institutional Intelligence Briefing");
      setResponse(contentBody || "Matrix analysis yielded no conclusive data.");
    } catch (err: any) {
      setError("Matrix Link Failure: " + (err.message || "Unknown Exception"));
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
                placeholder="Ask Matrix Analyst to analyze trends or staff well-being..."
                className="w-full h-48 bg-white/5 border border-white/10 rounded-[2rem] p-6 text-sm text-white font-medium outline-none focus:border-amber-400 transition-all resize-none shadow-inner"
              />
              <button 
                onClick={generateReport}
                disabled={isLoading || !prompt.trim()}
                className="w-full bg-[#d4af37] text-[#001f3f] py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-white transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-3"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-4 border-[#001f3f] border-t-transparent rounded-full animate-spin"></div>
                    <span>Processing Matrix...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <span>Execute Analysis</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Hybrid Intelligence Queries</p>
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
              <div className="p-6 border-b dark:border-slate-800 bg-slate-50/50 flex justify-between items-center no-print">
                 <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
                    <span className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase tracking-widest">Hybrid Intelligence Buffer</span>
                 </div>
                 {response && (
                   <button onClick={() => window.print()} className="text-[9px] font-black text-sky-500 uppercase hover:underline">Export Analytical PDF</button>
                 )}
              </div>

              <div className="flex-1 p-8 md:p-12 overflow-y-auto scrollbar-hide">
                 {isLoading ? (
                   <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-40">
                      <div className="w-24 h-1 bg-slate-100 rounded-full overflow-hidden">
                         <div className="h-full bg-[#d4af37] w-1/2 animate-[loading_1.5s_infinite]"></div>
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">Analyzing Pattern Clusters</p>
                   </div>
                 ) : error ? (
                   <div className="bg-rose-50 border-2 border-rose-100 p-8 rounded-3xl text-center">
                      <p className="text-sm font-black text-rose-600 uppercase italic mb-2">Matrix Anomaly Detected</p>
                      <p className="text-xs text-rose-500 font-medium">{error}</p>
                   </div>
                 ) : response ? (
                   <div className="prose prose-slate dark:prose-invert max-w-none animate-in fade-in slide-in-from-bottom-4 duration-1000">
                      {/* Institutional Formal Header */}
                      <div className="flex flex-col items-center text-center mb-10 pb-8 border-b-2 border-slate-100 dark:border-slate-800">
                         <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center p-4 shadow-xl border border-slate-50 mb-6 group transition-all duration-700 hover:rotate-6">
                            <img src={SCHOOL_LOGO_BASE64} alt="IHIS Seal" className="w-full h-full object-contain" />
                         </div>
                         <div className="space-y-1">
                            <h2 className="text-2xl font-black text-[#001f3f] dark:text-white m-0 uppercase tracking-tight italic leading-none">{SCHOOL_NAME}</h2>
                            <p className="text-[10px] font-black text-amber-500 uppercase m-0 tracking-[0.4em] mt-2">Academic Year 2026-2027</p>
                         </div>
                         <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 w-full">
                            <h3 className="text-xl font-black text-[#001f3f] dark:text-sky-400 uppercase tracking-tighter italic m-0">{reportTitle}</h3>
                            <div className="flex items-center justify-center gap-4 mt-2">
                               <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Date: {new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Bahrain', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                               <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                               <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest italic">Matrix Audit Mode Active</span>
                            </div>
                         </div>
                      </div>
                      
                      <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                         {response}
                      </div>

                      {/* Institutional Footer */}
                      <div className="mt-16 pt-8 border-t border-slate-100 dark:border-slate-800 flex justify-between items-end opacity-30">
                         <div className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                            Generated by IHIS Matrix Analyst<br/>
                            Neural Link ID: {Math.random().toString(36).substring(7).toUpperCase()}<br/>
                            Audit Reference: {new Date().getTime()}
                         </div>
                         <div className="text-right">
                            <div className="w-32 h-px bg-slate-400 mb-2"></div>
                            <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 italic">Analytical Validation Sentinel</span>
                         </div>
                      </div>
                   </div>
                 ) : (
                   <div className="h-full flex flex-col items-center justify-center space-y-8 opacity-10">
                      <svg className="w-32 h-32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                      <p className="text-sm font-black uppercase tracking-[0.5em]">Awaiting Hybrid Command Sequence</p>
                   </div>
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

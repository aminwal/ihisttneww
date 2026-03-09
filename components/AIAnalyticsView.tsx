
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, AttendanceRecord, TimeTableEntry, SubstitutionRecord, SchoolConfig, UserRole } from '../types.ts';
import { SCHOOL_NAME, SCHOOL_LOGO_BASE64 } from '../constants.ts';
import { HapticService } from '../services/hapticService.ts';
import { AIService } from '../services/geminiService.ts';
import { Mic, MicOff, Send, History, Trash2, Download, Sparkles, BarChart3, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import Markdown from 'react-markdown';

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
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{title: string, date: string, prompt: string, response: string}[]>(() => {
    const saved = localStorage.getItem('ihis_ai_history');
    return saved ? JSON.parse(saved) : [];
  });
  const responseEndRef = useRef<HTMLDivElement>(null);

  const toggleListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('speechRecognition' in window)) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).speechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setPrompt(prev => prev ? `${prev} ${transcript}` : transcript);
      HapticService.light();
    };

    recognition.start();
  };

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
      const contextSummary = `
        CURRENT INSTITUTIONAL SNAPSHOT (2026-2027):
        - Total Registered Faculty: ${users.length}
        - Today's Attendance Count: ${attendance.filter(a => a.date === new Date().toISOString().split('T')[0]).length}
        - Active Substitutions Today: ${substitutions.filter(s => s.date === new Date().toISOString().split('T')[0]).length}
        - Late Threshold: 07:20 AM
      `;

      const systemInstruction = `
        You are the IHIS Hybrid Intelligence Matrix Analyst for ${SCHOOL_NAME}. 
        Academic Year: 2026-2027. 
        YOUR IDENTITY: Data-driven analyst, visionary strategist, and empathetic administrator.
        INSTITUTIONAL RULES: Threshold 07:20 AM, Work Week Sun-Thu, Asia/Bahrain timezone.
        CONTEXT: ${contextSummary}
        
        FORMATTING: Use clear headings, bullet points, and a professional tone. 
        Start with a bold title on the first line.
      `;

      const responseText = await AIService.executeEdge(`USER REQUEST: ${prompt}`, systemInstruction);

      const fullText = responseText || "";
      const lines = fullText.split('\n');
      const detectedTitle = lines[0].replace(/[#*]/g, '').trim();
      const contentBody = lines.slice(1).join('\n').trim();

      const finalTitle = detectedTitle || "Institutional Intelligence Briefing";
      const finalResponse = contentBody || "Matrix analysis yielded no conclusive data.";

      setReportTitle(finalTitle);
      setResponse(finalResponse);

      // Save to history
      const newHistory = [{
        title: finalTitle,
        date: new Date().toLocaleString(),
        prompt: prompt,
        response: finalResponse
      }, ...history].slice(0, 10);
      setHistory(newHistory);
      localStorage.setItem('ihis_ai_history', JSON.stringify(newHistory));

      HapticService.success();
    } catch (err: any) {
      setError(err.message || "Matrix Link Failure. Ensure API Key is configured in Infrastructure Hub.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = () => {
    window.print();
  };

  const quickInsights = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = attendance.filter(a => a.date === today);
    const lates = todayAttendance.filter(a => {
      if (!a.checkIn) return false;
      const [h, m] = a.checkIn.split(':').map(Number);
      return h > 7 || (h === 7 && m > 20);
    }).length;

    const totalStaff = users.length;
    const present = todayAttendance.length;
    const absent = totalStaff - present;
    const proxies = substitutions.filter(s => s.date === today).length;

    const chartData = [
      { name: 'Present', value: present, color: '#10b981' },
      { name: 'Absent', value: absent, color: '#f43f5e' },
      { name: 'Proxies', value: proxies, color: '#f59e0b' }
    ];

    return {
      stats: [
        { label: "Today's Lates", value: lates, icon: "🕒", color: "text-rose-500" },
        { label: "Active Proxies", value: proxies, icon: "🔄", color: "text-amber-500" },
        { label: "Staff Present", value: present, icon: "👥", color: "text-emerald-500" }
      ],
      chartData
    };
  }, [attendance, substitutions, users]);

  const loadDistributionData = useMemo(() => {
    const rules = config.extraCurricularRules || [];
    const distribution: Record<string, number> = {};
    
    rules.forEach(rule => {
      rule.sectionIds.forEach(sectionId => {
        distribution[sectionId] = (distribution[sectionId] || 0) + rule.periodsPerWeek;
      });
    });

    return Object.entries(distribution).map(([sectionId, periods]) => ({
      section: config.sections.find(s => s.id === sectionId)?.fullName || sectionId,
      periods
    }));
  }, [config.extraCurricularRules, config.sections]);

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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-4 no-print">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Matrix AI <span className="text-[#d4af37]">Analyst</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="px-2 py-0.5 bg-emerald-500 text-white text-[7px] font-black uppercase rounded shadow-sm">Hybrid Mode</span>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Visionary & Empathetic Tier Active</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
           {response && (
             <button 
               onClick={handleExportPDF}
               className="bg-white dark:bg-slate-900 text-[#001f3f] dark:text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 transition-all flex items-center gap-2"
             >
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
               Export Intelligence
             </button>
           )}
        </div>
      </div>

      {/* Quick Insights Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 no-print">
        {quickInsights.stats.map((insight, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{insight.label}</p>
              <p className={`text-2xl font-black italic ${insight.color}`}>{insight.value}</p>
            </div>
            <span className="text-2xl opacity-50">{insight.icon}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6 no-print">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6">Curricular Load Distribution</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={loadDistributionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="section" hide />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="periods" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6">Matrix Snapshot</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={quickInsights.chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {quickInsights.chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {quickInsights.chartData.map(item => (
                <div key={item.name} className="text-center">
                  <p className="text-lg font-black text-[#001f3f] dark:text-white leading-none">{item.value}</p>
                  <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1">{item.name}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#001f3f] rounded-[2.5rem] p-8 shadow-2xl border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
               <svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            </div>
            
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-[0.3em] italic">Intelligence Dispatch</h3>
                <button 
                  onClick={toggleListening}
                  className={`p-2 rounded-lg transition-all ${isListening ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/10 text-white/40 hover:text-amber-400'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                </button>
              </div>
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
             <div className="flex items-center justify-between">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Recent Intelligence</p>
               {history.length > 0 && (
                 <button 
                   onClick={() => { setHistory([]); localStorage.removeItem('ihis_ai_history'); }}
                   className="text-[7px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                 >
                   Clear All
                 </button>
               )}
             </div>
             <div className="space-y-3">
                {history.length > 0 ? history.map((h, i) => (
                  <button 
                    key={i} 
                    onClick={() => { setResponse(h.response); setReportTitle(h.title); setPrompt(h.prompt); }}
                    className="w-full text-left p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-2xl transition-all border border-transparent"
                  >
                    <p className="text-[9px] font-black text-[#001f3f] dark:text-white uppercase truncate">{h.title}</p>
                    <p className="text-[7px] font-bold text-slate-400 uppercase mt-1">{h.date}</p>
                  </button>
                )) : (
                  <p className="text-[9px] font-bold text-slate-300 italic uppercase text-center py-4">No history found</p>
                )}
             </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Suggested Queries</p>
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


import React, { useState } from 'react';
import { HapticService } from '../services/hapticService.ts';

const HandbookView: React.FC = () => {
  const [isCaching, setIsCaching] = useState(false);

  const handleCacheOffline = async () => {
    setIsCaching(true);
    HapticService.light();
    
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
       navigator.serviceWorker.controller.postMessage({ type: 'PRE_CACHE_OFFLINE' });
    }

    await new Promise(r => setTimeout(r, 1000));
    setIsCaching(false);
    HapticService.success();
    alert("Administrative Handbook Secured for Offline Use.");
  };

  const procedures = [
    {
      title: "1. Institutional Hierarchy",
      category: "INFRASTRUCTURE",
      description: "Defining the school's structural DNA. This must be done sequentially.",
      steps: [
        { label: "Create Wings", detail: "Start at 'School Settings'. Wings (e.g., Primary) are the roots. Every wing defines a specific 'Period Timing Slot' which applies to all sections inside it." },
        { label: "Grade Mapping", detail: "Anchor Grades (e.g., Grade 9) to a specific Wing. This ensures they follow the correct timing schedule (Boys vs Girls vs Primary)." },
        { label: "Deploy Sections", detail: "Add Sections (A, B, C) to Grades. The system automatically initializes a matching room in the 'Room Registry' (e.g., ROOM IX A)." },
        { label: "Subject Catalog", detail: "Add subjects and assign categories. 'CORE' subjects appear in primary reports, while 'RME' or 'Language' drive specific analytics." }
      ],
      icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
    },
    {
      title: "2. Personnel & Authority",
      category: "IDENTITY",
      description: "Managing faculty access, multi-wing duties, and subject leadership.",
      steps: [
        { label: "Enroll Staff", detail: "Use 'Manage Staff'. The 'Employee ID' is an immutable key. Ensure unique passwords for initial login." },
        { label: "Multi-Wing Duty", detail: "For staff teaching across departments, select their primary role first, then use 'Secondary Roles' to grant multi-wing visibility." },
        { label: "HOD Badging", detail: "Under 'Authority Matrix', select the HOD badge and pick the Subject from the dropdown. This authorizes them to review all departmental records." },
        { label: "Telegram Sync", detail: "Mandatory: Staff must visit 'My Profile' and click 'Sync Telegram'. Without this, they will not receive automated Proxy Alerts." }
      ],
      icon: "M12 4.354a4 4 0 110 15.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    },
    {
      title: "3. Workload Intelligence",
      category: "ACADEMIC LOAD",
      description: "Setting constraints for the Timetable Engine to follow.",
      steps: [
        { label: "Period 1 Anchoring", detail: "Assign 'Class Teacher' status in 'Teacher Workloads'. Rule: Class teachers are hard-locked to Period 1 for morning registration." },
        { label: "Load Allocation", detail: "Enter specific subject periods per week for each teacher. The system flags 'Overload' if Primary > 28, Secondary > 26, or Senior > 22." },
        { label: "Parallel Pools", detail: "For 'Group Periods' (e.g., Urdu/Arabic taught together), enter the total weekly periods in the 'Pool' input. This locks those slots across multiple teachers." }
      ],
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
    },
    {
      title: "4. Timetable Matrix",
      category: "OPERATIONS",
      description: "Constructing and deploying the live school schedule.",
      steps: [
        { label: "Activate Draft Mode", detail: "CRITICAL: Always work in 'Draft' mode first. Changes in Live mode are visible to all staff instantly and affect reporting." },
        { label: "Reciprocal Swap", detail: "To trade periods, click the source then the target. The 'Collision Sentinel' will automatically block moves that clash Teacher or Room availability." },
        { label: "Batch Deployment", detail: "Once verified, click 'Deploy Live'. This performs an atomic overwrite of the cloud database." }
      ],
      icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    },
    {
      title: "5. Attendance Sentinel",
      category: "SECURITY",
      description: "Managing daily logs, GPS boundary checks, and late arrivals.",
      steps: [
        { label: "GPS Radius", detail: "Set in 'School Settings'. Default is 60m. The 15m Capped Buffer handles variable GPS accuracy to prevent home check-ins." },
        { label: "Late Threshold", detail: "Hardcoded Rule: Arrival after 07:20 AM is marked LATE. This is immutable to ensure registry integrity." },
        { label: "Manual PIN Bypass", detail: "In GPS failure cases, provide the daily 6-digit PIN from the 'Attendance PIN' tab. This allows a staff member to override the location lock." }
      ],
      icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
    }
  ];

  const mandates = [
    { rule: "Identity & Branding", detail: "The school name 'Ibn Al Hytham Islamic School' and Academic Year '2026-2027' are hardcoded. Developer credit to 'Ahmed Minwal' is mandatory." },
    { rule: "Temporal Integrity", detail: "All operations are strictly locked to Asia/Bahrain time. The work week is Sunday to Thursday only." },
    { rule: "Security Boundary", detail: "Capped Buffer Logic: Even with high signal variance, users only get a 15m credit toward the 60m radius to ensure physical presence." },
    { rule: "Collision Sentinel", detail: "Hardcoded Rule 7: The collision detection system prevents overlapping staff, rooms, or classes and cannot be bypassed in the UI." },
    { rule: "Biometric Protocol", detail: "Hardcoded Rule 6: WebAuthn (Passkeys) is the institutional identity standard for all secure authentication events." }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700 pb-32 px-4">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-center md:text-left space-y-4">
          <div className="inline-block px-4 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-full mb-2">
             <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.3em]">Institutional Protocol</p>
          </div>
          <h1 className="text-4xl md:text-6xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Administrative <span className="text-[#d4af37]">Handbook</span>
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.4em]">Official Operational Framework • v6.1</p>
        </div>

        <button 
          onClick={handleCacheOffline}
          disabled={isCaching}
          className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl transition-all active:scale-95 ${isCaching ? 'bg-slate-100 text-slate-400 animate-pulse' : 'bg-emerald-600 text-white'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          {isCaching ? 'Caching Handbook...' : 'Save Guide for Offline'}
        </button>
      </div>

      <div className="bg-[#001f3f] rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden border border-white/10 group">
         <div className="relative z-10 space-y-8">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-amber-400 rounded-2xl flex items-center justify-center text-[#001f3f] shadow-lg animate-pulse">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
               </div>
               <div>
                  <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">Institutional Mandates</h3>
                  <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">Immutable System Rules & Logic Constraints</p>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {mandates.map((m, i) => (
                 <div key={i} className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-2 group/mandate hover:bg-white/10 transition-all">
                    <h4 className="text-[11px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                       <span className="opacity-40">0{i+1}</span> {m.rule}
                    </h4>
                    <p className="text-[11px] text-white/60 font-medium leading-relaxed italic">{m.detail}</p>
                 </div>
               ))}
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         {procedures.map((proc, i) => (
           <div key={i} className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-10 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8 flex flex-col group hover:border-[#d4af37] transition-all">
              <div className="flex justify-between items-start">
                 <div className="space-y-1">
                    <p className="text-[10px] font-black text-[#d4af37] uppercase tracking-[0.3em]">{proc.category}</p>
                    <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{proc.title}</h3>
                 </div>
                 <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={proc.icon}/></svg>
                 </div>
              </div>

              <p className="text-xs text-slate-500 font-medium italic border-l-4 border-amber-400 pl-4">{proc.description}</p>

              <div className="flex-1 space-y-6">
                 {proc.steps.map((step, sIdx) => (
                   <div key={sIdx} className="space-y-1">
                      <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase flex items-center gap-2">
                         <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                         {step.label}
                      </p>
                      <p className="text-[11px] text-slate-400 leading-relaxed font-medium pl-3.5">{step.detail}</p>
                   </div>
                 ))}
              </div>
           </div>
         ))}
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/50 p-10 rounded-[3rem] border border-slate-200 dark:border-slate-700 text-center">
         <p className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest mb-4">Support & Documentation</p>
         <p className="text-xs text-slate-500 max-w-2xl mx-auto leading-relaxed font-medium mb-8">
            This system operates under a Strict Persistence Policy. Buttons, widgets, and functions are never removed without explicit authorization to ensure administrative continuity. If a logical conflict arises between user requests and Hardcoded Rules, the Rules maintain supremacy.
         </p>
         <div className="flex justify-center gap-4">
            <div className="px-6 py-3 bg-[#001f3f] text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg">Matrix Ver 6.1.0</div>
            <div className="px-6 py-3 bg-amber-400 text-[#001f3f] rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg italic">Build: IHIS-2026-PRO</div>
         </div>
      </div>
    </div>
  );
};

export default HandbookView;

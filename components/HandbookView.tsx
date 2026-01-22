
import React from 'react';

const HandbookView: React.FC = () => {
  const steps = [
    {
      title: "Step 1: Institutional Genesis",
      category: "CONFIG",
      description: "Define the skeletal structure of the school. Without this, no logic can be mapped.",
      tasks: [
        "Create Wings (Primary, Secondary Boys, etc.) to set distinct timing slots.",
        "Define Grades (e.g., Grade IX) and link them to Wings.",
        "Deploy Sections (A, B, C) within each Grade.",
        "Populate the Room Registry (e.g., Room 101, ICT Lab)."
      ],
      icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    },
    {
      title: "Step 2: Personnel Authorization",
      category: "STAFF",
      description: "Authorize the faculty who will inhabit the timetable matrix.",
      tasks: [
        "Register all teaching staff with correct Employee IDs.",
        "Assign Class Teachers to their respective Sections.",
        "Crucial: Ensure teachers sync their Telegram accounts for real-time alerts."
      ],
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    },
    {
      title: "Step 3: Workload Intelligence",
      category: "LOADS",
      description: "Define the weekly period constraints for each faculty member.",
      tasks: [
        "Select a teacher and their target Grade.",
        "Add individual Subject Loads (e.g., Math: 6 periods/week).",
        "Set 'Group Periods' (Critical for subjects taught simultaneously across the Grade).",
        "Map specific Sections to each load."
      ],
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2"
    },
    {
      title: "Step 4: Parallel Block Templates",
      category: "GROUPS",
      description: "Establish templates for 'Subject Pools'—classes that must occur in parallel.",
      tasks: [
        "Identify grades with parallel blocks (e.g., Grade IX Arabic/Urdu).",
        "Create a Pool Template linking all sections of that Grade.",
        "Allocate multiple teachers and rooms to that single temporal slot."
      ],
      icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
    },
    {
      title: "Step 5: Matrix Construction",
      category: "TIMETABLE",
      description: "The final phase of generating and publishing the institutional schedule.",
      tasks: [
        "Enter 'Draft Mode' to prevent disrupting live operations.",
        "Execute 'Grade Master Fill'—this handles blocks first, then residuals.",
        "Use 'Swap Mode' and 'Drag-and-Drop' for human fine-tuning.",
        "Final Review: 'Publish to Live' to deploy the matrix globally."
      ],
      icon: "M13 10V3L4 14h7v7l9-11h-7z"
    }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-700 pb-32 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-4xl md:text-5xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
          Administrative <span className="text-[#d4af37]">Handbook</span>
        </h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Protocol for Matrix Construction v4.0</p>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {steps.map((step, idx) => (
          <div key={idx} className="relative flex flex-col md:flex-row gap-8 group">
            <div className="md:w-16 flex flex-col items-center">
              <div className="w-16 h-16 bg-[#001f3f] text-[#d4af37] rounded-3xl flex items-center justify-center shadow-2xl z-10 group-hover:scale-110 transition-transform duration-500 border-2 border-amber-400/20">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={step.icon} />
                </svg>
              </div>
              {idx < steps.length - 1 && (
                <div className="hidden md:block w-1 h-full bg-slate-100 dark:bg-slate-800 my-4 rounded-full"></div>
              )}
            </div>

            <div className="flex-1 bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-10 shadow-xl border border-slate-100 dark:border-slate-800 transition-all hover:border-[#d4af37] relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-5 font-black text-6xl italic select-none pointer-events-none">{idx + 1}</div>
               
               <div className="space-y-6">
                  <div className="flex items-center justify-between">
                     <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{step.title}</h3>
                     <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 text-[8px] font-black uppercase rounded-lg border border-amber-100 dark:border-amber-900/50">{step.category}</span>
                  </div>

                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed italic">{step.description}</p>

                  <div className="space-y-4">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Key Protocols:</p>
                     <ul className="space-y-3">
                        {step.tasks.map((task, tIdx) => (
                          <li key={tIdx} className="flex items-start gap-4">
                             <div className="w-5 h-5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                             </div>
                             <span className="text-xs font-bold text-[#001f3f] dark:text-slate-300 leading-relaxed">{task}</span>
                          </li>
                        ))}
                     </ul>
                  </div>
               </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 p-10 rounded-[3rem] border-2 border-dashed border-amber-200 dark:border-amber-900/40 text-center space-y-4">
         <h4 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Gold Standard Rule</h4>
         <p className="text-sm font-medium text-amber-800/70 dark:text-amber-300/60 leading-relaxed italic">
           "The complexity of the Institutional Matrix is managed by first anchoring the parallel blocks (Subjects Pool). Once the most constrained periods are set, individual teacher loads fill the remaining gaps effortlessly."
         </p>
      </div>

      <div className="text-center opacity-30">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.5em]">Institutional Intelligence Matrix v4.0</p>
      </div>
    </div>
  );
};

export default HandbookView;

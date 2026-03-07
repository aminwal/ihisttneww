import React from 'react';
import { AppTab } from '../types.ts';
import { Map, UserCheck, FileBarChart, BookOpen, FileText, Book, Briefcase } from 'lucide-react';

interface OperationsHubProps {
  setActiveTab: (tab: AppTab) => void;
  hasAccess: (tab: AppTab) => boolean;
}

const OperationsHub: React.FC<OperationsHubProps> = ({ setActiveTab, hasAccess }) => {
  const hubItems = [
    {
      id: 'lesson_architect' as AppTab,
      title: 'Lesson Planner',
      description: 'Design, organize, and manage lesson plans and curriculum structures.',
      icon: BookOpen,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20',
      category: 'Academic Tools'
    },
    {
      id: 'exam_preparer' as AppTab,
      title: 'Exam Preparer',
      description: 'Create and manage examination blueprints, schedules, and assessments.',
      icon: FileText,
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-500/10',
      borderColor: 'border-indigo-500/20',
      category: 'Academic Tools'
    },
    {
      id: 'occupancy' as AppTab,
      title: 'Campus Map',
      description: 'View real-time room occupancy, availability, and campus layout.',
      icon: Map,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      category: 'Campus & Staff'
    },
    {
      id: 'history' as AppTab,
      title: 'Staff Attendance',
      description: 'Track daily check-ins, absences, and staff availability history.',
      icon: UserCheck,
      color: 'text-teal-500',
      bgColor: 'bg-teal-500/10',
      borderColor: 'border-teal-500/20',
      category: 'Campus & Staff'
    },
    {
      id: 'reports' as AppTab,
      title: 'School Reports',
      description: 'Generate and export comprehensive analytics and operational reports.',
      icon: FileBarChart,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      category: 'Insights & Guides'
    },
    {
      id: 'handbook' as AppTab,
      title: 'Admin Guide',
      description: 'Access the system manual, best practices, and operational guidelines.',
      icon: Book,
      color: 'text-rose-500',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20',
      category: 'Insights & Guides'
    }
  ];

  const categories = ['Academic Tools', 'Campus & Staff', 'Insights & Guides'];

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-7xl mx-auto pb-32 px-4">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center border-4 bg-indigo-50 border-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400">
            <Briefcase className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Operations Hub</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 italic">
              Academic & Campus Management
            </p>
          </div>
        </div>
      </div>

      {categories.map(category => {
        const categoryItems = hubItems.filter(item => item.category === category && hasAccess(item.id));
        if (categoryItems.length === 0) return null;

        return (
          <div key={category} className="space-y-4">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest pl-4">{category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categoryItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className="group relative bg-white dark:bg-slate-900 rounded-[2rem] p-8 text-left border border-slate-100 dark:border-slate-800 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 overflow-hidden"
                >
                  <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-transparent to-current opacity-5 rounded-bl-full -mr-8 -mt-8 ${item.color}`} />
                  
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 border ${item.bgColor} ${item.borderColor} ${item.color} group-hover:scale-110 transition-transform duration-300`}>
                    <item.icon className="w-7 h-7" />
                  </div>
                  
                  <h3 className="text-lg font-black text-[#001f3f] dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {item.title}
                  </h3>
                  
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    {item.description}
                  </p>

                  <div className="mt-6 flex items-center text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    <span>Access Module</span>
                    <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default OperationsHub;

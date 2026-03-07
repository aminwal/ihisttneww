import React from 'react';
import { AppTab } from '../types.ts';
import { Calendar, Layers, Users, Zap, Trophy, RefreshCw, ClipboardList } from 'lucide-react';

interface TimetableHubProps {
  setActiveTab: (tab: AppTab) => void;
  hasAccess: (tab: AppTab) => boolean;
}

const TimetableHub: React.FC<TimetableHubProps> = ({ setActiveTab, hasAccess }) => {
  const hubItems = [
    {
      id: 'timetable' as AppTab,
      title: 'Timetable Editor',
      description: 'The primary drag-and-drop interface for building the master schedule.',
      icon: Calendar,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20',
      category: 'Core Architecture'
    },
    {
      id: 'batch_timetable' as AppTab,
      title: 'Batchview',
      description: 'High-level overview to see multiple classes, grades, or the whole school at a glance.',
      icon: Layers,
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-500/10',
      borderColor: 'border-indigo-500/20',
      category: 'Core Architecture'
    },
    {
      id: 'assignments' as AppTab,
      title: 'Teacher Workload',
      description: 'Manage teaching loads, assign subjects, and balance staff capacity.',
      icon: Users,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      category: 'Resource Allocation'
    },
    {
      id: 'groups' as AppTab,
      title: 'Pool Periods',
      description: 'Managing unassigned or floating periods and class groupings.',
      icon: RefreshCw,
      color: 'text-teal-500',
      bgColor: 'bg-teal-500/10',
      borderColor: 'border-teal-500/20',
      category: 'Resource Allocation'
    },
    {
      id: 'substitutions' as AppTab,
      title: 'Substitution Ledger',
      description: 'Manage teacher absences and assign proxy teachers to cover classes.',
      icon: ClipboardList,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
      borderColor: 'border-purple-500/20',
      category: 'Resource Allocation'
    },
    {
      id: 'lab_periods' as AppTab,
      title: 'Labs Management',
      description: 'Handling split classes, practicals, and physical lab room availability.',
      icon: Zap,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      category: 'Specialized Logistics'
    },
    {
      id: 'extra_curricular' as AppTab,
      title: 'Extra Curricular',
      description: 'Managing clubs, sports, and non-academic blocks.',
      icon: Trophy,
      color: 'text-rose-500',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20',
      category: 'Specialized Logistics'
    }
  ];

  const categories = ['Core Architecture', 'Resource Allocation', 'Specialized Logistics'];

  return (
    <div className="space-y-8 animate-in fade-in duration-700 max-w-7xl mx-auto pb-32 px-4">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center border-4 bg-sky-50 border-sky-100 text-sky-600 dark:bg-sky-900/30 dark:border-sky-800 dark:text-sky-400">
            <Calendar className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic uppercase leading-none">Scheduling Matrix</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 italic">
              Centralized Timetable Command Center
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
                  
                  <h3 className="text-lg font-black text-[#001f3f] dark:text-white mb-2 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                    {item.title}
                  </h3>
                  
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                    {item.description}
                  </p>

                  <div className="mt-6 flex items-center text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
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

export default TimetableHub;

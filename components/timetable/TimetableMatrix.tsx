import React, { useMemo } from 'react';
import { TimeTableEntry, SchoolConfig, User, UserRole } from '../../types';

interface TimetableMatrixProps {
  currentTimetable: TimeTableEntry[];
  config: SchoolConfig;
  users: User[];
  isDraftMode: boolean;
  isManagement: boolean;
}

export const TimetableMatrix: React.FC<TimetableMatrixProps> = ({
  currentTimetable,
  config,
  users,
  isDraftMode,
  isManagement,
}) => {
  if (!isDraftMode || !isManagement) return null;

  const matrix = useMemo(() => {
    return users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(teacher => {
      const assigned = currentTimetable.filter(e => e.teacherId === teacher.id).length;
      const policy = config.loadPolicies[teacher.role] || config.loadPolicies['DEFAULT'] || { baseTarget: 30 };
      const target = policy.baseTarget;
      const utilization = target > 0 ? Math.round((assigned / target) * 100) : 0;
      
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        targetLoad: target,
        currentLoad: assigned,
        utilization
      };
    }).sort((a, b) => b.utilization - a.utilization);
  }, [currentTimetable, users, config]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-8">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border-4 border-emerald-400/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
          <div className="flex items-center gap-6">
            <div className="p-5 rounded-[2rem] bg-emerald-500 text-white shadow-xl">
              <span className="text-2xl font-black">M</span>
            </div>
            <div>
              <h3 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Institutional Load Matrix</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3 flex items-center gap-2">
                <span className="w-3 h-3 text-emerald-500">📊</span> Real-time Resource Allocation Analysis
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50">
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">Faculty Member</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">Target Load</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">Current Load</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">Utilization</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {matrix.map(row => (
                <tr key={row.teacherId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-4 text-xs font-black text-[#001f3f] dark:text-white uppercase">{row.teacherName}</td>
                  <td className="px-4 py-4 text-xs font-black text-slate-500 tabular-nums">{row.targetLoad}</td>
                  <td className="px-4 py-4 text-xs font-black text-slate-900 dark:text-white tabular-nums">{row.currentLoad}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${row.utilization > 100 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, row.utilization)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-black text-slate-400 tabular-nums">{row.utilization}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${
                      row.utilization === 100 ? 'bg-emerald-50 text-emerald-600' :
                      row.utilization > 100 ? 'bg-rose-50 text-rose-600' :
                      'bg-amber-50 text-amber-600'
                    }`}>
                      {row.utilization === 100 ? 'Optimized' : row.utilization > 100 ? 'Overloaded' : 'Underload'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

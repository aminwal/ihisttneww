import React from 'react';
import { History, ChevronDown } from 'lucide-react';
import { AssignmentLogEntry } from '../../types';

interface AssignmentLogProps {
  assignmentLogs: AssignmentLogEntry[];
}

export const AssignmentLog: React.FC<AssignmentLogProps> = ({ assignmentLogs }) => {
  if (assignmentLogs.length === 0) return null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 mt-8">
      <details className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-600 dark:text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Assignment Activity Log</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Track automatic and manual assignment events</p>
            </div>
          </div>
          <ChevronDown className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" />
        </summary>
        
        <div className="border-t border-slate-100 dark:border-slate-800 max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Time</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject/Group</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {assignmentLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-xs font-medium text-slate-500 font-mono">{log.timestamp}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                      log.actionType.includes('AUTO') 
                        ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
                        : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                    }`}>
                      {log.actionType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {log.subject}
                    <span className="block text-[10px] font-normal text-slate-400">{log.teacherName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                      log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' :
                      log.status === 'PARTIAL' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' :
                      'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        log.status === 'SUCCESS' ? 'bg-emerald-500' :
                        log.status === 'PARTIAL' ? 'bg-amber-500' :
                        'bg-rose-500'
                      }`} />
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

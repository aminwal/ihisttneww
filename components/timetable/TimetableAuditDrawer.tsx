import React from 'react';
import { Activity, X, Lock, ArrowRight, AlertCircle, RefreshCw, Wand2, Palette, Plus, Trash2, Info } from 'lucide-react';
import { SectionAuditData, TimeTableEntry } from '../../types';

interface TimetableAuditDrawerProps {
  isAuditDrawerOpen: boolean;
  setIsAuditDrawerOpen: (val: boolean) => void;
  sectionAuditData: SectionAuditData | null;
  getGlobalTeacherLoad: (teacherId: string) => { assigned: number, target: number };
  setCurrentTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

const AuditStatusBadge = ({ assigned, allocated }: { assigned: number, allocated: number }) => {
  if (assigned === allocated) return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[8px] font-black uppercase tracking-widest">Complete</span>;
  if (assigned > allocated) return <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[8px] font-black uppercase tracking-widest">Overload</span>;
  return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[8px] font-black uppercase tracking-widest">Missing {allocated - assigned}</span>;
};

export const TimetableAuditDrawer: React.FC<TimetableAuditDrawerProps> = ({
  isAuditDrawerOpen,
  setIsAuditDrawerOpen,
  sectionAuditData,
  getGlobalTeacherLoad,
  setCurrentTimetable,
  showToast,
}) => {
  if (!isAuditDrawerOpen || !sectionAuditData) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsAuditDrawerOpen(false)} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-[#001f3f]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#d4af37]/20 rounded-xl">
              <Activity className="w-5 h-5 text-[#d4af37]" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-widest">Registry Audit</h2>
              <p className="text-[10px] font-bold text-[#d4af37] uppercase tracking-widest">{sectionAuditData.sectionName}</p>
            </div>
          </div>
          <button onClick={() => setIsAuditDrawerOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Unlinked Entries</p>
              <p className={`text-xl font-black ${sectionAuditData.unlinkedCount > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                {sectionAuditData.unlinkedCount}
              </p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Health Score</p>
              <p className="text-xl font-black text-[#001f3f] dark:text-[#d4af37]">
                {Math.round(((sectionAuditData.standardLoads.filter(l => l.assigned === l.allocated).length + 
                  sectionAuditData.pools.filter(p => p.assigned === p.allocated).length + 
                  sectionAuditData.labs.filter(l => l.assigned === l.allocated).length) / 
                  (sectionAuditData.standardLoads.length + sectionAuditData.pools.length + sectionAuditData.labs.length || 1)) * 100)}%
              </p>
            </div>
          </div>

          {/* Anchors Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
              <Lock className="w-4 h-4" />
              <h3 className="text-[10px] font-black uppercase tracking-widest">Registry Anchors</h3>
            </div>
            <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{sectionAuditData.anchors.teacherName || 'Not Assigned'}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Class Teacher (Slot 1)</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-slate-900 dark:text-white">{sectionAuditData.anchors.assigned} / {sectionAuditData.anchors.allocated}</p>
                  <AuditStatusBadge assigned={sectionAuditData.anchors.assigned} allocated={sectionAuditData.anchors.allocated} />
                </div>
              </div>
            </div>
          </div>

          {/* Standard Loads */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
              <ArrowRight className="w-4 h-4" />
              <h3 className="text-[10px] font-black uppercase tracking-widest">Standard Loads</h3>
            </div>
            <div className="space-y-2">
              {sectionAuditData.standardLoads.sort((a, b) => (a.assigned === a.allocated ? 1 : -1)).map((load, idx) => {
                const global = getGlobalTeacherLoad(load.teacherId);
                return (
                  <div key={idx} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm hover:border-amber-400 transition-colors group">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{load.subject}</p>
                          {global.assigned > global.target && (
                            <span className="p-1 bg-rose-100 text-rose-600 rounded-md" title="Overloaded school-wide">
                              <AlertCircle className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{load.teacherName}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 ${load.assigned > load.allocated ? 'bg-rose-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, (load.assigned / load.allocated) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-black text-slate-400">{global.assigned}/{global.target} Total</span>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-xs font-black text-slate-900 dark:text-white">{load.assigned} / {load.allocated}</p>
                        <AuditStatusBadge assigned={load.assigned} allocated={load.allocated} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pools Section */}
          {sectionAuditData.pools.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                <RefreshCw className="w-4 h-4" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Parallel Pools</h3>
              </div>
              <div className="space-y-2">
                {sectionAuditData.pools.map((pool) => (
                  <div key={pool.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{pool.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{pool.teachers}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900 dark:text-white">{pool.assigned} / {pool.allocated}</p>
                        <AuditStatusBadge assigned={pool.assigned} allocated={pool.allocated} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Labs Section */}
          {sectionAuditData.labs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                <Wand2 className="w-4 h-4" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Specialist Labs</h3>
              </div>
              <div className="space-y-2">
                {sectionAuditData.labs.map((lab) => (
                  <div key={lab.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{lab.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{lab.teachers}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900 dark:text-white">{lab.assigned} / {lab.allocated}</p>
                        <AuditStatusBadge assigned={lab.assigned} allocated={lab.allocated} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity Periods Section */}
          {sectionAuditData.curriculars.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                <Palette className="w-4 h-4" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Activity Periods</h3>
              </div>
              <div className="space-y-2">
                {sectionAuditData.curriculars.map((activity) => (
                  <div key={activity.id} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{activity.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{activity.teacherName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900 dark:text-white">{activity.assigned} / {activity.allocated}</p>
                        <AuditStatusBadge assigned={activity.assigned} allocated={activity.allocated} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual & Extra Periods Section */}
          {sectionAuditData.manualPeriods.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[#001f3f] dark:text-[#d4af37]">
                <Plus className="w-4 h-4" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Manual & Extra Periods</h3>
              </div>
              <div className="space-y-2">
                {sectionAuditData.manualPeriods.map((e, idx) => (
                  <div key={idx} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase">{e.subject}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{e.teacherName} • {e.day} P{e.slotId}</p>
                      </div>
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[8px] font-black rounded-lg uppercase tracking-widest">Manual</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unlinked Entries */}
          {sectionAuditData.unlinkedCount > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-rose-500">
                <AlertCircle className="w-4 h-4" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Unlinked (Ghost) Entries</h3>
              </div>
              <div className="p-4 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-100 dark:border-rose-900/30">
                <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase mb-3">
                  The following entries exist in the timetable but have no matching record in the registry:
                </p>
                <div className="space-y-2">
                  {sectionAuditData.unlinkedEntries.map((e, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 bg-white dark:bg-slate-800 rounded-xl border border-rose-100 dark:border-rose-900/20">
                      <div>
                        <p className="text-[10px] font-black text-slate-900 dark:text-white uppercase">{e.subject}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{e.teacherName} • {e.day} P{e.slotId}</p>
                      </div>
                      <button 
                        onClick={() => {
                          setCurrentTimetable(prev => prev.filter(item => item.id !== e.id));
                          showToast("Ghost entry removed", "info");
                        }}
                        className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-slate-400 mt-0.5" />
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-relaxed">
              This audit report compares your current draft against the Teacher Workload, Group Period, and Lab Period registries. Use it to ensure 100% coverage before sharing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

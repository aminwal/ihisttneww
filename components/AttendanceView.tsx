
import React, { useState, useMemo, useCallback } from 'react';
import { User, AttendanceRecord, UserRole } from '../types.ts';
// Import IS_CLOUD_ENABLED to avoid accessing protected supabase.supabaseUrl
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface AttendanceViewProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  users: User[];
  // Fix: Add 'warning' to showToast type
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const AttendanceView: React.FC<AttendanceViewProps> = ({ user, attendance, setAttendance, users, showToast }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const isAdmin = user.role === UserRole.ADMIN;
  const isManagement = isAdmin || user.role.startsWith('INCHARGE_');

  const visibleUsers = useMemo(() => {
    return users.filter(u => {
      if (isAdmin) return true;
      if (u.role === UserRole.ADMIN) return false;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY') || u.id === user.id;
      if (user.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY') || u.id === user.id;
      return u.id === user.id;
    });
  }, [users, user, isAdmin]);

  const unifiedHistory = useMemo(() => {
    let filtered = visibleUsers.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.employeeId.toLowerCase().includes(search.toLowerCase()));
    return filtered.map(u => {
      const record = attendance.find(r => r.userId === u.id && r.date === selectedDate);
      return { user: u, record, isPresent: !!record, statusLabel: record ? 'PRESENT' : 'ABSENT' };
    }).filter(item => statusFilter === 'PRESENT' ? item.isPresent : statusFilter === 'ABSENT' ? !item.isPresent : true)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [visibleUsers, attendance, selectedDate, search, statusFilter]);

  const handleMarkPresent = useCallback(async (targetUser: User) => {
    if (!window.confirm(`Force mark ${targetUser.name} as PRESENT for ${selectedDate}?`)) return;
    
    const time = "07:20 AM"; 
    const newRecord: AttendanceRecord = {
      id: generateUUID(),
      userId: targetUser.id,
      userName: targetUser.name,
      date: selectedDate,
      checkIn: time,
      isManual: true,
      isLate: false,
      reason: 'Admin Override'
    };

    try {
      if (IS_CLOUD_ENABLED) {
        const { error } = await supabase.from('attendance').insert({
          id: newRecord.id,
          user_id: newRecord.userId,
          date: newRecord.date,
          check_in: newRecord.checkIn,
          is_manual: true,
          is_late: false,
          reason: 'Admin Override'
        });
        if (error) throw error;
      }
      setAttendance(prev => [newRecord, ...prev]);
      showToast(`${targetUser.name} manually registered as present.`, "success");
    } catch (err: any) {
      showToast("Cloud handshake failed: " + err.message, "error");
    }
  }, [selectedDate, setAttendance, showToast]);

  const handleSinglePurge = useCallback(async (record: AttendanceRecord) => {
    if (!window.confirm(`Purge registry for ${record.userName}?`)) return;
    try {
      // Fix: Use IS_CLOUD_ENABLED instead of protected supabaseUrl
      if (IS_CLOUD_ENABLED) {
        await supabase.from('attendance').delete().match({ user_id: record.userId, date: record.date });
      }
      setAttendance(current => current.filter(r => r.id !== record.id));
      showToast("Registry Entry Purged", "success");
    } catch (e) { showToast("Operation Failed", "error"); }
  }, [setAttendance, showToast]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Faculty Ledger</h1>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{isManagement ? 'Institutional Oversight' : 'Personal Registry History'}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-sm border border-slate-100 dark:border-white/5">
            <button onClick={() => setViewMode('table')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'table' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>List view</button>
            <button onClick={() => setViewMode('calendar')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'calendar' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Heatmap</button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-50 dark:border-white/5 overflow-hidden">
        <div className="p-6 md:p-8 border-b border-slate-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-50/30 dark:bg-slate-800/20">
           <div className="relative w-full max-w-md">
              <input type="text" placeholder="Personnel search..." className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl text-sm font-bold shadow-sm focus:ring-2 focus:ring-[#d4af37] outline-none" value={search} onChange={e => setSearch(e.target.value)} />
              <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
           </div>
           <div className="flex items-center gap-3">
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white dark:bg-slate-950 px-6 py-4 rounded-2xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-[#001f3f] dark:text-white" />
           </div>
        </div>

        <div className="overflow-x-auto">
          {/* Desktop Table: Professional Spreadsheet Style */}
          <table className="hidden lg:table w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                <th className="px-10 py-6">Faculty Member</th>
                <th className="px-10 py-6 text-center">Status</th>
                <th className="px-10 py-6 text-center">Registry Stamping</th>
                <th className="px-10 py-6 text-center">Methodology</th>
                {isManagement && <th className="px-10 py-6 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-white/5">
              {unifiedHistory.map(item => (
                <tr key={item.user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-10 py-8">
                     <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm shadow-sm ${item.isPresent ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-red-50 text-red-400'}`}>{item.user.name.substring(0,2)}</div>
                        <div>
                           <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{item.user.name}</p>
                           <p className="text-xs font-bold text-slate-400 uppercase mt-2 tracking-widest">{item.user.employeeId}</p>
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8 text-center">
                     <span className={`text-[10px] font-black px-4 py-2 rounded-full border tracking-widest ${item.isPresent ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-500 border-red-100'}`}>
                       {item.statusLabel}
                     </span>
                  </td>
                  <td className="px-10 py-8 text-center">
                     {item.record ? (
                        <div className="flex flex-col gap-1">
                           <span className="text-sm font-black text-[#001f3f] dark:text-white">{item.record.checkIn}</span>
                           <span className="text-xs font-bold text-amber-500 uppercase tracking-tighter">Exit: {item.record.checkOut || 'In Progress'}</span>
                        </div>
                     ) : <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">No Record</span>}
                  </td>
                  <td className="px-10 py-8 text-center">
                     <p className="text-[10px] font-bold text-slate-400 uppercase italic">{item.record?.reason || (item.record ? 'Standard Geotag' : '--')}</p>
                  </td>
                  {isManagement && (
                    <td className="px-10 py-8 text-right">
                       <div className="flex items-center justify-end gap-3">
                          {!item.isPresent ? (
                            <button 
                              onClick={() => handleMarkPresent(item.user)}
                              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-all active:scale-95"
                            >
                              Mark Present
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleSinglePurge(item.record!)}
                              className="px-4 py-2 bg-rose-50 text-rose-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all"
                            >
                              Purge Record
                            </button>
                          )}
                       </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile Architecture: Modern Card Deck */}
          <div className="lg:hidden p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/50">
             {unifiedHistory.map(item => (
               <div key={item.user.id} className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-xl border border-slate-100 dark:border-white/5 space-y-5">
                  <div className="flex justify-between items-start">
                     <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs ${item.isPresent ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-red-100 text-red-500'}`}>{item.user.name.substring(0,2)}</div>
                        <div>
                           <p className="font-black text-sm text-[#001f3f] dark:text-white">{item.user.name}</p>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.user.employeeId}</p>
                        </div>
                     </div>
                     <span className={`text-[9px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-widest ${item.isPresent ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-500 border-red-100'}`}>
                       {item.statusLabel}
                     </span>
                  </div>
                  {item.record && (
                     <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50 dark:border-white/5">
                        <div className="text-center">
                           <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Check-In</p>
                           <p className="text-xs font-black text-[#001f3f] dark:text-white">{item.record.checkIn}</p>
                        </div>
                        <div className="text-center">
                           <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Check-Out</p>
                           <p className="text-xs font-black text-[#001f3f] dark:text-white">{item.record.checkOut || 'Active'}</p>
                        </div>
                     </div>
                  )}
                  {isManagement && (
                    <div className="pt-4 flex gap-3">
                       {!item.isPresent ? (
                         <button 
                           onClick={() => handleMarkPresent(item.user)}
                           className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-md"
                         >
                           Mark Present
                         </button>
                       ) : (
                         <button 
                           onClick={() => handleSinglePurge(item.record!)}
                           className="flex-1 py-3 bg-rose-50 text-rose-500 rounded-2xl text-[9px] font-black uppercase tracking-widest"
                         >
                           Purge Record
                         </button>
                       )}
                    </div>
                  )}
               </div>
             ))}
             {unifiedHistory.length === 0 && (
               <div className="py-20 text-center">
                 <p className="text-xs font-black text-slate-300 uppercase tracking-[0.4em]">No personnel matching criteria</p>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttendanceView;

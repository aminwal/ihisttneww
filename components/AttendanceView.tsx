import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, AttendanceRecord, UserRole } from '../types.ts';
import { supabase } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface AttendanceViewProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  users: User[];
}

const AttendanceView: React.FC<AttendanceViewProps> = ({ user, attendance, setAttendance, users }) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showManualModal, setShowManualModal] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [manualEntry, setManualEntry] = useState({ id: '', userId: '', date: new Date().toISOString().split('T')[0], checkIn: '07:20', checkOut: '', reason: '' });

  const isAdmin = user.role === UserRole.ADMIN;
  const isManagement = isAdmin || user.role.startsWith('INCHARGE_');
  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  const formatRoleName = (role: string) => role.replace(/_/g, ' ').toUpperCase();
  const fuzzyMatch = (query: string, target: string) => !query || target.toLowerCase().trim().includes(query.toLowerCase().trim());

  const unifiedHistory = useMemo(() => {
    let targetUsers = users.filter(u => {
      if (isAdmin) return true;
      if (u.role === UserRole.ADMIN) return false;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role === UserRole.TEACHER_PRIMARY || u.role === UserRole.INCHARGE_PRIMARY || u.id === user.id;
      if (user.role === UserRole.INCHARGE_SECONDARY) return u.role === UserRole.TEACHER_SECONDARY || u.role === UserRole.TEACHER_SENIOR_SECONDARY || u.role === UserRole.INCHARGE_SECONDARY || u.id === user.id;
      return u.id === user.id;
    }).filter(u => (roleFilter === 'ALL' || u.role === roleFilter) && (fuzzyMatch(search, u.name) || fuzzyMatch(search, u.employeeId) || fuzzyMatch(search, formatRoleName(u.role))));

    return targetUsers.map(u => {
      const record = attendance.find(r => r.userId === u.id && r.date === selectedDate);
      return { user: u, record, isPresent: !!record, statusLabel: record ? 'PRESENT' : 'ABSENT' };
    }).filter(item => statusFilter === 'PRESENT' ? item.isPresent : statusFilter === 'ABSENT' ? !item.isPresent : true)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [users, attendance, selectedDate, roleFilter, search, user, isAdmin, statusFilter]);

  const handleSinglePurge = useCallback(async (record: AttendanceRecord) => {
    if (window.confirm(`Purge log for ${record.userName}?`)) {
      if (!supabase.supabaseUrl.includes('placeholder')) {
        await supabase.from('attendance').delete().match({ user_id: record.userId, date: record.date });
      }
      setAttendance(current => current.filter(r => r.id !== record.id));
      setStatusMsg({ type: 'success', text: `Log for ${record.userName} purged.` });
    }
  }, [setAttendance]);

  const handleExportCSV = () => {
    const headers = ["Faculty Name", "Employee ID", "Role", "Date", "Status", "Check-In", "Check-Out", "Method", "Notes"];
    const rows = unifiedHistory.map(item => [
      `"${item.user.name}"`,
      `"${item.user.employeeId}"`,
      `"${item.user.role.replace(/_/g, ' ')}"`,
      item.record?.date || selectedDate,
      item.statusLabel,
      item.record?.checkIn || "N/A",
      item.record?.checkOut || "N/A",
      item.record ? (item.record.isManual ? "Manual" : "Geo-tag") : "Void",
      `"${item.record?.reason || ''}"`
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `IHIS_Attendance_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatusMsg({ type: 'success', text: 'CSV Export successful.' });
  };

  const markTeacherPresent = async (u: User) => {
    const isToday = selectedDate === todayStr;
    const time = isToday ? new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' }) : "07:20 AM";
    const newRecord: AttendanceRecord = {
      id: generateUUID(), userId: u.id, userName: u.name, date: selectedDate, checkIn: time, isManual: true, isLate: false, reason: 'Authorized Presence'
    };

    if (!supabase.supabaseUrl.includes('placeholder')) {
      await supabase.from('attendance').insert({
        user_id: u.id, date: selectedDate, check_in: time, is_manual: true, is_late: false, reason: 'Authorized Presence'
      });
    }

    setAttendance(prev => [newRecord, ...prev]);
    setStatusMsg({ type: 'success', text: `Authorized presence for ${u.name}.` });
  };

  const saveManualEntry = async () => {
    const u = users.find(x => x.id === manualEntry.userId);
    if (!u || !manualEntry.date || !manualEntry.checkIn) return;
    
    if (!supabase.supabaseUrl.includes('placeholder')) {
      if (manualEntry.id) {
         await supabase.from('attendance').update({
           check_in: manualEntry.checkIn,
           check_out: manualEntry.checkOut || null,
           is_manual: true,
           reason: manualEntry.reason
         }).match({ user_id: u.id, date: manualEntry.date });
      } else {
         await supabase.from('attendance').insert({
           user_id: u.id, date: manualEntry.date, check_in: manualEntry.checkIn, check_out: manualEntry.checkOut || null, is_manual: true, reason: manualEntry.reason
         });
      }
    }

    if (manualEntry.id) {
      setAttendance(prev => prev.map(r => r.id === manualEntry.id ? { ...r, userId: u.id, userName: u.name, date: manualEntry.date, checkIn: manualEntry.checkIn, checkOut: manualEntry.checkOut || undefined, isManual: true, reason: manualEntry.reason } : r));
    } else {
      setAttendance(prev => [{ id: generateUUID(), userId: u.id, userName: u.name, date: manualEntry.date, checkIn: manualEntry.checkIn, checkOut: manualEntry.checkOut || undefined, isManual: true, isLate: false, reason: manualEntry.reason }, ...prev]);
    }
    setShowManualModal(false);
    setStatusMsg({ type: 'success', text: 'Cloud Synchronized.' });
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-7xl mx-auto w-full px-2">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic">Attendance Ledger</h1>
          <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">{isManagement ? 'Institutional Repository' : 'Your History'}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {isManagement && (
            <>
              <button onClick={handleExportCSV} className="px-4 py-2 bg-sky-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-sky-700 transition-colors flex items-center gap-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export CSV
              </button>
              <button onClick={() => { setManualEntry({ id: '', userId: '', date: todayStr, checkIn: '07:20', checkOut: '', reason: '' }); setShowManualModal(true); }} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-emerald-700 transition-colors">+ Add Log</button>
            </>
          )}
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800">
            <button onClick={() => setViewMode('table')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'table' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-gray-400'}`}>Table</button>
            <button onClick={() => setViewMode('calendar')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${viewMode === 'calendar' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-gray-400'}`}>Calendar</button>
          </div>
        </div>
      </div>

      {/* Adaptive Layout Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col min-h-[400px]">
        {/* Unified Search/Filter (Stacks on Mobile) */}
        <div className="p-4 md:p-8 border-b border-gray-100 dark:border-slate-800 flex flex-col xl:flex-row items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/20 no-print">
          <div className="relative w-full max-w-md">
             <input type="text" placeholder="Search name/ID..." className="w-full px-12 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-bold shadow-sm" value={search} onChange={e => setSearch(e.target.value)} />
             <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 w-full xl:w-auto">
            <div className="flex bg-white dark:bg-slate-950 p-1 rounded-2xl border border-slate-100 shadow-sm overflow-x-auto scrollbar-hide">
               {(['ALL', 'PRESENT', 'ABSENT'] as const).map(status => (
                 <button key={status} onClick={() => setStatusFilter(status)} className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase transition-all whitespace-nowrap ${statusFilter === status ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{status}</button>
               ))}
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-slate-950 px-3 py-2 rounded-2xl border border-slate-100 shadow-sm">
               <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-[11px] font-black text-[#001f3f] dark:text-white outline-none" />
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block flex-1 overflow-x-auto w-full scrollbar-hide">
          <table className="w-full text-left min-w-[900px]">
            <thead>
              <tr className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/50">
                <th className="px-10 py-6">Faculty Profile</th>
                <th className="px-10 py-6">Employee ID</th>
                <th className="px-10 py-6 text-center">Status</th>
                <th className="px-10 py-6 text-center">In/Out</th>
                <th className="px-10 py-6 text-center">Method</th>
                <th className="px-10 py-6">Reason / Note</th>
                {isManagement && <th className="px-10 py-6 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {unifiedHistory.map(item => (
                <tr key={item.user.id} className={`transition-colors group ${item.isPresent ? 'hover:bg-amber-50/10' : 'bg-red-50/5'}`}>
                  <td className="px-10 py-6">
                    <div className="flex items-center space-x-4">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[9px] flex-shrink-0 ${item.isPresent ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-red-100 text-red-400'}`}>{item.user.name.substring(0,2)}</div>
                      <div className="min-w-0">
                        <p className="font-black text-xs text-[#001f3f] dark:text-white truncate">{item.user.name}</p>
                        <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">{formatRoleName(item.user.role)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-lg">{item.user.employeeId}</span></td>
                  <td className="px-10 py-6 text-center"><span className={`text-[7px] font-black px-2 py-1 rounded-lg border whitespace-nowrap ${item.isPresent ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>{item.statusLabel}</span></td>
                  <td className="px-10 py-6 text-center">
                    {item.record ? (
                      <div className="flex flex-col">
                        <span className={`text-xs font-black ${item.record.isLate ? 'text-red-500' : 'text-emerald-600'}`}>{item.record.checkIn}</span>
                        <span className="text-[10px] font-bold text-amber-500">{item.record.checkOut || '--:--'}</span>
                      </div>
                    ) : <span className="text-xs font-black text-slate-300">--:--</span>}
                  </td>
                  <td className="px-10 py-6 text-center">{item.record ? <span className={`text-[7px] font-black uppercase px-2 py-1 rounded-lg ${item.record.isManual ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 dark:bg-slate-800'}`}>{item.record.isManual ? 'MANUAL' : 'GEO-TAG'}</span> : <span className="text-[7px] font-black text-slate-300">VOID</span>}</td>
                  <td className="px-10 py-6">
                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 line-clamp-2 italic max-w-xs">{item.record?.reason || (item.isPresent ? 'System Verified' : '--')}</p>
                  </td>
                  {isManagement && (
                    <td className="px-10 py-6 text-right">
                       <div className="flex items-center justify-end space-x-4">
                         {item.record ? (
                           <>
                             <button onClick={() => { setManualEntry({ id: item.record!.id, userId: item.record!.userId, date: item.record!.date, checkIn: item.record!.checkIn, checkOut: item.record!.checkOut || '', reason: item.record!.reason || '' }); setShowManualModal(true); }} className="text-sky-600 text-[9px] font-black uppercase">Edit</button>
                             <button onClick={() => handleSinglePurge(item.record!)} className="text-red-500 text-[9px] font-black uppercase">Purge</button>
                           </>
                         ) : <button onClick={() => markTeacherPresent(item.user)} className="text-emerald-600 text-[9px] font-black uppercase">Authorize</button>}
                       </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View: Vertical Card Feed */}
        <div className="md:hidden flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30 dark:bg-slate-900/50">
           {unifiedHistory.map(item => (
             <div key={item.user.id} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                   <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] ${item.isPresent ? 'bg-[#001f3f] text-[#d4af37]' : 'bg-red-100 text-red-500'}`}>{item.user.name.substring(0,2)}</div>
                      <div>
                        <p className="font-black text-sm text-[#001f3f] dark:text-white leading-none">{item.user.name}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">{item.user.employeeId}</p>
                      </div>
                   </div>
                   <div className="flex flex-col items-end">
                     <span className={`text-[8px] font-black px-2 py-1 rounded-lg border ${item.isPresent ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>{item.statusLabel}</span>
                     {item.record?.isManual && <span className="text-[6px] font-black text-amber-500 uppercase mt-1">Manual Log</span>}
                   </div>
                </div>
                
                {item.isPresent ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                       <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Entry</p>
                          <p className={`text-xs font-black ${item.record?.isLate ? 'text-red-500' : 'text-emerald-600'}`}>{item.record?.checkIn}</p>
                       </div>
                       <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-xl border border-slate-100 dark:border-slate-700">
                          <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Exit</p>
                          <p className="text-xs font-black text-[#d4af37]">{item.record?.checkOut || '--:--'}</p>
                       </div>
                    </div>
                    {item.record?.reason && (
                       <div className="bg-amber-50/30 dark:bg-amber-900/10 p-2 rounded-xl border border-amber-100/50">
                          <p className="text-[7px] font-black text-amber-600 uppercase mb-0.5">Note</p>
                          <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 italic leading-tight">{item.record.reason}</p>
                       </div>
                    )}
                  </div>
                ) : (
                  <div className="py-2 text-center border-2 border-dashed border-red-100 dark:border-red-900/20 rounded-xl">
                     <p className="text-[9px] font-black text-red-400 uppercase">Awaiting Identity Log</p>
                  </div>
                )}

                {isManagement && (
                  <div className="flex items-center justify-end gap-4 pt-2 border-t border-slate-50 dark:border-slate-800">
                     {item.isPresent ? (
                        <>
                          <button onClick={() => { setManualEntry({ id: item.record!.id, userId: item.record!.userId, date: item.record!.date, checkIn: item.record!.checkIn, checkOut: item.record!.checkOut || '', reason: item.record!.reason || '' }); setShowManualModal(true); }} className="text-sky-600 text-[10px] font-black uppercase">Edit</button>
                          <button onClick={() => handleSinglePurge(item.record!)} className="text-red-500 text-[10px] font-black uppercase">Delete</button>
                        </>
                     ) : (
                        <button onClick={() => markTeacherPresent(item.user)} className="text-emerald-600 text-[10px] font-black uppercase">Authorize Present</button>
                     )}
                  </div>
                )}
             </div>
           ))}
        </div>
      </div>

      {showManualModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md no-print">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6">
             <div className="text-center"><h4 className="text-lg font-black text-[#001f3f] dark:text-white uppercase italic">Manual Log Entry</h4></div>
             <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[9px] font-black text-slate-400 uppercase">Faculty Member</label>
                   <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={manualEntry.userId} onChange={e => setManualEntry({...manualEntry, userId: e.target.value})} disabled={!!manualEntry.id}>
                     <option value="">Select Personnel...</option>
                     {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Check-In</label>
                      <input type="time" className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={manualEntry.checkIn} onChange={e => setManualEntry({...manualEntry, checkIn: e.target.value})} />
                   </div>
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">Check-Out</label>
                      <input type="time" className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white" value={manualEntry.checkOut} onChange={e => setManualEntry({...manualEntry, checkOut: e.target.value})} />
                   </div>
                </div>
                <div className="space-y-1">
                   <label className="text-[9px] font-black text-slate-400 uppercase">Reason for Manual Entry</label>
                   <textarea 
                     className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-amber-400" 
                     placeholder="e.g. Geolocation fail, Forgot to mark, Official duty..." 
                     rows={3}
                     value={manualEntry.reason}
                     onChange={e => setManualEntry({...manualEntry, reason: e.target.value})}
                   />
                </div>
             </div>
             <div className="flex flex-col space-y-3">
                <button onClick={saveManualEntry} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[11px] uppercase tracking-widest shadow-xl">Commit Log</button>
                <button onClick={() => setShowManualModal(false)} className="w-full text-slate-400 font-black text-[10px] uppercase">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;
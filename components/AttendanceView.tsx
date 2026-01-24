
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, AttendanceRecord, UserRole, SubstitutionRecord } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { validateTimeInput, formatBahrainDate } from '../utils/dateUtils.ts';

interface AttendanceViewProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  users: User[];
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  substitutions: SubstitutionRecord[];
  isSandbox?: boolean;
  addSandboxLog?: (action: string, payload: any) => void;
}

const AttendanceView: React.FC<AttendanceViewProps> = ({ user, attendance, setAttendance, users, showToast, substitutions, isSandbox, addSandboxLog }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [selectedDate, setSelectedDate] = useState(formatBahrainDate());
  
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualRegistryData, setManualRegistryData] = useState({
    userId: '',
    date: selectedDate,
    time: '07:20 AM'
  });

  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editFields, setEditFields] = useState({ checkIn: '', checkOut: '' });
  
  const [isProcessing, setIsProcessing] = useState(false);

  const isAdmin = user.role === UserRole.ADMIN;
  const isGlobalManager = isAdmin || user.role === UserRole.INCHARGE_ALL;
  const isManagement = isGlobalManager || user.role.startsWith('INCHARGE_');

  const visibleUsers = useMemo(() => {
    return users.filter(u => {
      if (isGlobalManager) return true;
      if (u.role === UserRole.ADMIN) return false;
      if (user.role === UserRole.INCHARGE_PRIMARY) return u.role.includes('PRIMARY') || u.id === user.id;
      if (user.role === UserRole.INCHARGE_SECONDARY) return u.role.includes('SECONDARY') || u.id === user.id;
      return u.id === user.id;
    });
  }, [users, user, isGlobalManager]);

  const unifiedHistory = useMemo(() => {
    let filtered = visibleUsers.filter(u => 
      !search || 
      u.name.toLowerCase().includes(search.toLowerCase()) || 
      u.employeeId.toLowerCase().includes(search.toLowerCase())
    );
    
    return filtered.map(u => {
      const record = attendance.find(r => r.userId === u.id && r.date === selectedDate);
      const userProxies = substitutions.filter(s => s.substituteTeacherId === u.id && s.date === selectedDate && !s.isArchived);
      return { 
        user: u, 
        record, 
        isPresent: !!record, 
        statusLabel: record ? (record.checkIn === 'MEDICAL' ? 'MEDICAL' : 'PRESENT') : 'ABSENT',
        proxies: userProxies
      };
    }).filter(item => {
      if (statusFilter === 'PRESENT') return item.isPresent;
      if (statusFilter === 'ABSENT') return !item.isPresent;
      return true;
    }).sort((a, b) => a.user.name.localeCompare(b.name));
  }, [visibleUsers, attendance, selectedDate, search, statusFilter, substitutions]);

  const handleManualAdd = async () => {
    if (!manualRegistryData.userId) return;
    if (!validateTimeInput(manualRegistryData.time)) {
      showToast("Format Error: Use 'HH:MM AM/PM' (e.g., 07:20 AM)", "error");
      return;
    }
    
    setIsProcessing(true);
    try {
      const target = users.find(u => u.id === manualRegistryData.userId);
      const id = generateUUID();
      const payload = {
        id,
        user_id: manualRegistryData.userId,
        date: manualRegistryData.date,
        check_in: manualRegistryData.time.toUpperCase(),
        is_manual: true,
        reason: 'Admin Override'
      };

      if (IS_CLOUD_ENABLED && !isSandbox) {
        const { error } = await supabase.from('attendance').insert(payload);
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('MANUAL_ATTENDANCE_ADD', payload);
      }

      setAttendance(prev => [{
        id,
        userId: payload.user_id,
        userName: target?.name || 'Unknown',
        date: payload.date,
        checkIn: payload.check_in,
        isManual: true,
        reason: payload.reason
      }, ...prev]);
      
      showToast("Attendance Registry Updated", "success");
      setIsManualModalOpen(false);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateRecord = async () => {
    if (!editingRecord) return;
    if (!validateTimeInput(editFields.checkIn)) {
       showToast("Arrival Time format invalid.", "error");
       return;
    }
    if (editFields.checkOut && !validateTimeInput(editFields.checkOut)) {
       showToast("Departure Time format invalid.", "error");
       return;
    }

    setIsProcessing(true);
    try {
      const upd = { check_in: editFields.checkIn.toUpperCase(), check_out: editFields.checkOut ? editFields.checkOut.toUpperCase() : null };
      if (IS_CLOUD_ENABLED && !isSandbox) {
        const { error } = await supabase.from('attendance')
          .update(upd)
          .eq('id', editingRecord.id);
        if (error) throw error;
      } else if (isSandbox) {
        addSandboxLog?.('ATTENDANCE_RECORD_UPDATE', { id: editingRecord.id, ...upd });
      }

      setAttendance(prev => prev.map(r => r.id === editingRecord.id ? { ...r, checkIn: upd.check_in, checkOut: upd.check_out || undefined } : r));
      showToast("Registry modified successfully", "success");
      setEditingRecord(null);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-24 px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-4">
        <div className="space-y-1 text-center md:text-left">
          <h2 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">
            Attendance <span className="text-[#d4af37]">Registry</span>
          </h2>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Faculty Persistence Ledger</p>
        </div>
        
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <button onClick={() => setViewMode('table')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'table' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>List</button>
            <button onClick={() => setViewMode('calendar')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'calendar' ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>Heatmap</button>
          </div>
          {isManagement && (
            <button onClick={() => setIsManualModalOpen(true)} className="bg-[#001f3f] text-[#d4af37] px-6 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all">Manual Entry</button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="p-6 md:p-10 border-b border-slate-50 dark:border-slate-800 flex flex-col xl:flex-row items-center justify-between gap-8 bg-slate-50/30">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            <div className="relative w-full md:w-64">
              <input 
                type="text" 
                placeholder="Search Personnel..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-slate-800 rounded-2xl text-[11px] font-black uppercase tracking-widest outline-none focus:border-amber-400 transition-all shadow-sm"
              />
              <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>
            <input 
              type="date" 
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full md:w-auto px-6 py-4 bg-white dark:bg-slate-950 border-2 border-slate-100 dark:border-slate-800 rounded-2xl text-[11px] font-black uppercase outline-none focus:border-amber-400 transition-all shadow-sm dark:text-white"
            />
          </div>

          <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide w-full xl:w-auto pb-2 xl:pb-0">
            {(['ALL', 'PRESENT', 'ABSENT'] as const).map(f => (
              <button 
                key={f} 
                onClick={() => setStatusFilter(f)}
                className={`px-5 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border-2 transition-all whitespace-nowrap flex-1 md:flex-none ${statusFilter === f ? 'bg-[#001f3f] text-[#d4af37] border-transparent shadow-lg' : 'bg-white dark:bg-slate-950 text-slate-400 border-slate-50 dark:border-slate-800'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50 dark:bg-slate-800/30 border-y border-slate-100 dark:border-slate-800">
                <th className="px-10 py-6">Faculty Member</th>
                <th className="px-10 py-6">Status Matrix</th>
                <th className="px-10 py-6">Entry Log</th>
                <th className="px-10 py-6">Exit Log</th>
                <th className="px-10 py-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {unifiedHistory.map(({ user: u, record, isPresent, statusLabel, proxies }) => (
                <tr key={u.id} className="hover:bg-amber-50/5 transition-colors group stagger-row">
                  <td className="px-10 py-8">
                    <div className="flex items-center space-x-6">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs shadow-lg bg-[#001f3f] text-[#d4af37] group-hover:scale-110 transition-transform">
                        {u.name.substring(0,2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                           <p className="font-black text-base italic text-[#001f3f] dark:text-white tracking-tight leading-none">{u.name}</p>
                           {proxies.length > 0 && (
                             <div className="relative group/proxy">
                               <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 cursor-help border border-amber-200 dark:border-amber-800">
                                 <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
                               </div>
                               <div className="absolute left-0 bottom-full mb-3 hidden group-hover/proxy:block w-56 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 z-50">
                                  <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-3">Proxy Assignments</p>
                                  <div className="space-y-2">
                                     {proxies.map(p => (
                                       <div key={p.id} className="flex justify-between items-center text-[10px] font-bold">
                                          <span className="text-slate-500">Period {p.slotId}</span>
                                          <span className="text-[#001f3f] dark:text-white">{p.className}</span>
                                       </div>
                                     ))}
                                  </div>
                               </div>
                             </div>
                           )}
                        </div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">{u.employeeId} • {u.role.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border-2 ${
                      statusLabel === 'PRESENT' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                      statusLabel === 'MEDICAL' ? 'bg-rose-50 text-rose-600 border-rose-100' : 
                      'bg-slate-50 text-slate-400 border-slate-100'
                    }`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td className="px-10 py-8">
                    <p className={`text-xs font-black italic ${record?.checkIn === 'MEDICAL' ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>
                      {record?.checkIn || '--:--'}
                    </p>
                    {record?.isManual && <span className="text-[7px] font-black text-amber-500 uppercase tracking-tighter">Manual Override</span>}
                  </td>
                  <td className="px-10 py-8">
                    <p className="text-xs font-black italic text-slate-400">
                      {record?.checkIn === 'MEDICAL' ? 'N/A' : (record?.checkOut || '--:--')}
                    </p>
                  </td>
                  <td className="px-10 py-8 text-right">
                    {isManagement && isPresent && (
                      <button 
                        onClick={() => {
                          setEditingRecord(record || null);
                          setEditFields({ checkIn: record?.checkIn || '', checkOut: record?.checkOut || '' });
                        }}
                        className="p-3 text-slate-400 hover:text-sky-500 bg-slate-50 dark:bg-slate-800 rounded-xl transition-all"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden p-4 space-y-4">
           {unifiedHistory.map(({ user: u, record, isPresent, statusLabel, proxies }) => (
             <div key={u.id} className={`p-6 rounded-[2rem] border-2 transition-all bg-white dark:bg-slate-900 ${isPresent ? 'border-emerald-100 shadow-lg' : 'border-slate-50 shadow-sm opacity-80'}`}>
                <div className="flex items-center justify-between mb-4">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#001f3f] text-[#d4af37] flex items-center justify-center font-black text-[10px]">{u.name.substring(0,2)}</div>
                      <div>
                         <p className="text-xs font-black text-[#001f3f] dark:text-white uppercase truncate max-w-[120px]">{u.name}</p>
                         <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{u.employeeId}</p>
                      </div>
                   </div>
                   <span className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                     statusLabel === 'PRESENT' ? 'bg-emerald-50 text-emerald-600' : 
                     statusLabel === 'MEDICAL' ? 'bg-rose-50 text-rose-600' : 
                     'bg-slate-50 text-slate-400'
                   }`}>
                     {statusLabel}
                   </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50 dark:border-slate-800">
                   <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">In-Stamp</p>
                      <p className={`text-xs font-black italic ${record?.checkIn === 'MEDICAL' ? 'text-rose-500' : 'text-[#001f3f] dark:text-white'}`}>{record?.checkIn || '--:--'}</p>
                   </div>
                   <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Out-Stamp</p>
                      <p className="text-xs font-black italic text-slate-400">{record?.checkIn === 'MEDICAL' ? 'N/A' : (record?.checkOut || '--:--')}</p>
                   </div>
                </div>

                <div className="flex items-center justify-between mt-4">
                   <div className="flex gap-1.5">
                      {proxies.length > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[7px] font-black uppercase rounded border border-amber-100">{proxies.length} Proxy</span>}
                      {record?.isManual && <span className="px-2 py-0.5 bg-sky-50 text-sky-600 text-[7px] font-black uppercase rounded border border-sky-100">Manual</span>}
                   </div>
                   {isManagement && isPresent && (
                     <button 
                        onClick={() => { setEditingRecord(record || null); setEditFields({ checkIn: record?.checkIn || '', checkOut: record?.checkOut || '' }); }}
                        className="px-4 py-2 bg-slate-50 text-[#001f3f] text-[8px] font-black uppercase rounded-lg border border-slate-100"
                     >
                        Edit Registry
                     </button>
                   )}
                </div>
             </div>
           ))}
        </div>

        {unifiedHistory.length === 0 && (
          <div className="py-32 text-center">
            <div className="opacity-20 flex flex-col items-center gap-4">
               <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9.172 9.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               <p className="text-sm font-black uppercase tracking-[0.4em]">No matching records found</p>
            </div>
          </div>
        )}
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md no-pdf">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Override</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Administrative Registry Stamping</p>
             </div>
             
             <div className="space-y-4">
                <div className="space-y-2">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Personnel</label>
                   <select 
                     value={manualRegistryData.userId}
                     onChange={e => setManualRegistryData({...manualRegistryData, userId: e.target.value})}
                     className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                   >
                     <option value="">Choose Faculty...</option>
                     {visibleUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Date</label>
                      <input type="date" value={manualRegistryData.date} onChange={e => setManualRegistryData({...manualRegistryData, date: e.target.value})} className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black dark:text-white outline-none" />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Arrival Time (HH:MM AM/PM)</label>
                      <input type="text" placeholder="07:20 AM" value={manualRegistryData.time} onChange={e => setManualRegistryData({...manualRegistryData, time: e.target.value.toUpperCase()})} className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black dark:text-white outline-none" />
                   </div>
                </div>
             </div>

             <div className="pt-6 space-y-4">
                <button 
                  onClick={handleManualAdd}
                  disabled={isProcessing || !manualRegistryData.userId}
                  className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Authorize Registry'}
                </button>
                <button onClick={() => setIsManualModalOpen(false)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest">Abort Action</button>
             </div>
           </div>
        </div>
      )}

      {editingRecord && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-[#001f3f]/95 backdrop-blur-md no-pdf">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Edit Timestamp</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Adjusting Registry for {editingRecord.userName}</p>
             </div>
             
             <div className="space-y-4">
                <div className="space-y-2">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Arrival (Entry)</label>
                   <input 
                     type="text" 
                     placeholder="07:20 AM"
                     value={editFields.checkIn} 
                     onChange={e => setEditFields({...editFields, checkIn: e.target.value.toUpperCase()})}
                     className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Departure (Exit)</label>
                   <input 
                     type="text" 
                     placeholder="01:40 PM"
                     value={editFields.checkOut} 
                     onChange={e => setEditFields({...editFields, checkOut: e.target.value.toUpperCase()})}
                     className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black dark:text-white outline-none focus:ring-4 focus:ring-amber-400/20"
                   />
                </div>
             </div>

             <div className="pt-6 space-y-4">
                <button 
                  onClick={handleUpdateRecord}
                  disabled={isProcessing}
                  className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-3xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? 'Saving...' : 'Commit Modification'}
                </button>
                <button onClick={() => setEditingRecord(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest">Discard Changes</button>
             </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;

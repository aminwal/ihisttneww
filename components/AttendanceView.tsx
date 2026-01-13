
import React, { useState, useMemo, useCallback } from 'react';
import { User, AttendanceRecord, UserRole } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';

interface AttendanceViewProps {
  user: User;
  attendance: AttendanceRecord[];
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  users: User[];
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const AttendanceView: React.FC<AttendanceViewProps> = ({ user, attendance, setAttendance, users, showToast }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualRegistryData, setManualRegistryData] = useState({
    userId: '',
    date: selectedDate,
    time: '07:20 AM'
  });
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
      return { 
        user: u, 
        record, 
        isPresent: !!record, 
        statusLabel: record ? (record.checkIn === 'MEDICAL' ? 'MEDICAL' : 'PRESENT') : 'ABSENT' 
      };
    }).filter(item => {
      if (statusFilter === 'PRESENT') return item.isPresent;
      if (statusFilter === 'ABSENT') return !item.isPresent;
      return true;
    }).sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [visibleUsers, attendance, selectedDate, search, statusFilter]);

  const handleManualRegistrySubmit = async () => {
    if (!manualRegistryData.userId || !manualRegistryData.date || !manualRegistryData.time) {
      showToast("Missing required registry parameters.", "error");
      return;
    }
    const targetUser = users.find(u => u.id === manualRegistryData.userId);
    if (!targetUser) return;

    setIsProcessing(true);
    try {
      let finalRecord: AttendanceRecord;
      if (IS_CLOUD_ENABLED) {
        const { data, error } = await supabase.from('attendance').upsert({
          user_id: targetUser.id,
          date: manualRegistryData.date,
          check_in: manualRegistryData.time,
          is_manual: true,
          is_late: false,
          reason: 'Authorized Stamping'
        }, { onConflict: 'user_id, date' }).select().single();
        if (error) throw error;
        finalRecord = {
          id: data.id, userId: data.user_id, userName: targetUser.name, date: data.date,
          checkIn: data.check_in, checkOut: data.check_out, isManual: data.is_manual,
          isLate: data.is_late, reason: data.reason, location: data.location
        };
      } else {
        finalRecord = {
          id: `local-${generateUUID()}`, userId: targetUser.id, userName: targetUser.name,
          date: manualRegistryData.date, checkIn: manualRegistryData.time, isManual: true,
          isLate: false, reason: 'Authorized Stamping'
        };
      }

      setAttendance(prev => {
        const filtered = prev.filter(r => !(r.userId === finalRecord.userId && r.date === finalRecord.date));
        return [finalRecord, ...filtered];
      });
      showToast(`Registry synchronized for ${targetUser.name}.`, "success");
      setIsManualModalOpen(false);
      setManualRegistryData(prev => ({ ...prev, userId: '' }));
    } catch (err: any) {
      showToast("Handshake Failed: " + err.message, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkPresent = useCallback(async (targetUser: User) => {
    if (!window.confirm(`Force mark ${targetUser.name} as PRESENT for ${selectedDate}?`)) return;
    
    const time = "07:20 AM";
    const isCloudActive = IS_CLOUD_ENABLED;

    try {
      let finalRecord: AttendanceRecord;
      if (isCloudActive) {
        const { data, error } = await supabase.from('attendance').upsert({
          user_id: targetUser.id,
          date: selectedDate,
          check_in: time,
          is_manual: true,
          is_late: false,
          reason: 'Admin Override'
        }, { onConflict: 'user_id, date' }).select().single();
        if (error) throw error;
        finalRecord = {
          id: data.id, userId: data.user_id, userName: targetUser.name, date: data.date,
          checkIn: data.check_in, checkOut: data.check_out, isManual: data.is_manual,
          isLate: data.is_late, reason: data.reason, location: data.location
        };
      } else {
        finalRecord = {
          id: `local-${generateUUID()}`, userId: targetUser.id, userName: targetUser.name,
          date: selectedDate, checkIn: time, isManual: true, isLate: false, reason: 'Admin Override'
        };
      }
      
      setAttendance(prev => {
        const filtered = prev.filter(r => !(r.userId === finalRecord.userId && r.date === finalRecord.date));
        return [finalRecord, ...filtered];
      });
      showToast(`${targetUser.name} marked as present.`, "success");
    } catch (err: any) {
      showToast("Institutional handshake failed: " + err.message, "error");
    }
  }, [selectedDate, setAttendance, showToast]);

  const handleSinglePurge = useCallback(async (record: AttendanceRecord) => {
    if (!window.confirm(`Purge registry for ${record.userName} on ${record.date}?`)) return;
    try {
      if (IS_CLOUD_ENABLED) {
        const { error } = await supabase.from('attendance').delete().match({ user_id: record.userId, date: record.date });
        if (error) throw error;
      }
      setAttendance(current => current.filter(r => r.id !== record.id));
      showToast("Registry Entry Purged", "success");
    } catch (err: any) { 
      showToast("Purge failed: " + err.message, "error"); 
    }
  }, [setAttendance, showToast]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-[#001f3f] dark:text-white italic tracking-tight uppercase leading-none">Faculty Ledger</h1>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{isManagement ? 'Institutional Oversight' : 'Personal Registry History'}</p>
        </div>
        
        <div className="flex items-center gap-3">
          {isManagement && (
            <button 
              onClick={() => setIsManualModalOpen(true)}
              className="bg-[#001f3f] text-[#d4af37] px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl border border-white/10 hover:bg-slate-900 transition-all active:scale-95"
            >
              Manual Registry
            </button>
          )}
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
           <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter:</span>
                 <select 
                   value={statusFilter} 
                   onChange={e => setStatusFilter(e.target.value as any)}
                   className="bg-white dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase outline-none focus:ring-2 ring-amber-400 transition-all dark:text-white"
                 >
                    <option value="ALL">All Staff</option>
                    <option value="PRESENT">Present Only</option>
                    <option value="ABSENT">Absent Only</option>
                 </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date:</span>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-[#001f3f] dark:text-white outline-none focus:ring-2 ring-amber-400" />
              </div>
           </div>
        </div>

        <div className="overflow-x-auto">
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
                <tr key={item.user.id} className="hover:bg-slate-50/50 transition-colors stagger-row">
                  <td className="px-10 py-8">
                     <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm shadow-sm ${item.isPresent ? (item.record?.checkIn === 'MEDICAL' ? 'bg-rose-500 text-white' : 'bg-[#001f3f] text-[#d4af37]') : 'bg-slate-100 text-slate-400'}`}>{item.user.name.substring(0,2)}</div>
                        <div>
                           <p className="font-black text-sm text-[#001f3f] dark:text-white italic leading-none">{item.user.name}</p>
                           <p className="text-xs font-bold text-slate-400 uppercase mt-2 tracking-widest">{item.user.employeeId}</p>
                        </div>
                     </div>
                  </td>
                  <td className="px-10 py-8 text-center">
                     <span className={`text-[10px] font-black px-4 py-2 rounded-full border tracking-widest ${
                       item.statusLabel === 'PRESENT' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                       item.statusLabel === 'MEDICAL' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                       'bg-slate-50 text-slate-400 border-slate-100'
                     }`}>
                       {item.statusLabel}
                     </span>
                  </td>
                  <td className="px-10 py-8 text-center">
                     {item.record ? (
                        <div className="flex flex-col gap-1">
                           <span className="text-sm font-black text-[#001f3f] dark:text-white">{item.record.checkIn}</span>
                           <span className="text-xs font-bold text-amber-500 uppercase tracking-tighter">Exit: {item.record.checkOut || 'In Progress'}</span>
                        </div>
                     ) : <span className="text-xs font-bold text-slate-200 uppercase tracking-widest italic">Awaiting Registry</span>}
                  </td>
                  <td className="px-10 py-8 text-center">
                     <p className="text-[10px] font-bold text-slate-400 uppercase italic">{item.record?.reason || (item.record ? 'Geotag Verified' : '--')}</p>
                  </td>
                  {isManagement && (
                    <td className="px-10 py-8 text-right">
                       <div className="flex items-center justify-end gap-3">
                          {!item.isPresent ? (
                            <button onClick={() => handleMarkPresent(item.user)} className="px-4 py-2 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-900 transition-all active:scale-95 border border-white/5">Mark Present</button>
                          ) : (
                            <button onClick={() => handleSinglePurge(item.record!)} className="px-4 py-2 bg-rose-50 text-rose-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all border border-rose-100">Purge Record</button>
                          )}
                       </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isManualModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Manual Registry</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Authorization Gateway</p>
             </div>
             
             <div className="space-y-6">
                <div className="space-y-1.5">
                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel</label>
                   <select 
                     className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm"
                     value={manualRegistryData.userId}
                     onChange={e => setManualRegistryData({...manualRegistryData, userId: e.target.value})}
                   >
                      <option value="">Select Faculty...</option>
                      {users.filter(u => u.role !== UserRole.ADMIN && !u.isResigned).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                   </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registry Date</label>
                      <input type="date" className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-black text-[10px] uppercase tracking-widest" value={manualRegistryData.date} onChange={e => setManualRegistryData({...manualRegistryData, date: e.target.value})} />
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Check-In Time</label>
                      <input type="text" placeholder="07:20 AM" className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-2xl px-6 py-4 dark:text-white font-bold text-sm" value={manualRegistryData.time} onChange={e => setManualRegistryData({...manualRegistryData, time: e.target.value})} />
                   </div>
                </div>
             </div>

             <button disabled={isProcessing} onClick={handleManualRegistrySubmit} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-950 transition-all border border-white/10 active:scale-95 disabled:opacity-50">
               {isProcessing ? 'AUTHORIZING...' : 'AUTHORIZE REGISTRY STAMP'}
             </button>
             <button onClick={() => setIsManualModalOpen(false)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-slate-600 transition-colors">Discard Process</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;

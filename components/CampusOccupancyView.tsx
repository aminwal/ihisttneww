
import React, { useState, useMemo, useEffect } from 'react';
import { SchoolConfig, TimeTableEntry, SubstitutionRecord, User } from '../types.ts';
import { getBahrainTime, formatBahrainDate } from '../utils/dateUtils.ts';

// Add explicit RoomStatus interface for matrix spatial state
interface RoomStatus {
  occupied: boolean;
  teacher?: string;
  subject?: string;
  section?: string;
  type: 'REGULAR' | 'PROXY' | 'NONE';
}

interface CampusOccupancyViewProps {
  config: SchoolConfig;
  timetable: TimeTableEntry[];
  substitutions: SubstitutionRecord[];
  users: User[];
}

const CampusOccupancyView: React.FC<CampusOccupancyViewProps> = ({ config, timetable, substitutions, users }) => {
  const [currentTime, setCurrentTime] = useState(getBahrainTime());
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(getBahrainTime()), 30000);
    return () => clearInterval(timer);
  }, []);

  const currentStats = useMemo(() => {
    const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Bahrain' }).format(currentTime);
    const timeStr = currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Bahrain' }).substring(0, 5);
    const todayStr = formatBahrainDate(currentTime);

    // Fix: Explicitly type the Map to prevent 'unknown' property errors during iteration
    const roomStatusMap = new Map<string, RoomStatus>();

    config.rooms.forEach(room => {
      // 1. Check Standard Timetable
      const standard = timetable.find(t => {
        if (t.room !== room || t.day !== dayName || t.date) return false;
        const wing = config.wings.find(w => w.id === t.wingId);
        const slots = config.slotDefinitions?.[wing?.sectionType || 'PRIMARY'] || [];
        const slot = slots.find(s => s.id === t.slotId);
        return slot && timeStr >= slot.startTime && timeStr <= slot.endTime;
      });

      if (standard) {
        roomStatusMap.set(room, {
          occupied: true,
          teacher: standard.teacherName,
          subject: standard.subject,
          section: standard.className,
          type: 'REGULAR'
        });
        return;
      }

      // 2. Check Proxy Matrix (Substitutions)
      // Since proxies don't have explicit rooms, we check if the section belonging to this room has a proxy
      const proxy = substitutions.find(s => {
        if (s.date !== todayStr || s.isArchived) return false;
        const slots = config.slotDefinitions?.[s.section] || [];
        const slot = slots.find(sl => sl.id === s.slotId);
        const isInTime = slot && timeStr >= slot.startTime && timeStr <= slot.endTime;
        if (!isInTime) return false;

        // Link back to original room via timetable class assignment
        const originalEntry = timetable.find(t => t.sectionId === s.sectionId && t.day === dayName && t.slotId === s.slotId && !t.date);
        return originalEntry?.room === room;
      });

      if (proxy) {
        roomStatusMap.set(room, {
          occupied: true,
          teacher: proxy.substituteTeacherName,
          subject: `${proxy.subject} (Proxy)`,
          section: proxy.className,
          type: 'PROXY'
        });
        return;
      }

      roomStatusMap.set(room, { occupied: false, type: 'NONE' });
    });

    return { map: roomStatusMap, day: dayName, time: timeStr };
  }, [currentTime, config, timetable, substitutions]);

  // Fix: Explicitly type 'v' as RoomStatus to resolve 'unknown' property access on 'occupied'
  const totalOccupied = Array.from(currentStats.map.values()).filter((v: RoomStatus) => v.occupied).length;
  const totalFree = config.rooms.length - totalOccupied;

  return (
    <div className="space-y-8 animate-in fade-in duration-700 w-full px-2 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Campus <span className="text-emerald-500">Occupancy</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Real-Time Spatial Resource Matrix</p>
        </div>
        
        <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-4 rounded-[2rem] border border-slate-100 shadow-xl">
           <div className="text-right">
              <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest leading-none">{currentStats.day}</p>
              <p className="text-2xl font-black text-[#001f3f] dark:text-white italic tabular-nums">{currentStats.time}</p>
           </div>
           <div className="w-10 h-10 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin"></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-2">
         <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Resources</p><p className="text-3xl font-black text-[#001f3f] dark:text-white italic">{config.rooms.length}</p></div>
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl"><svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg></div>
         </div>
         <div className="bg-emerald-50 dark:bg-emerald-950/20 p-6 rounded-[2.5rem] shadow-xl border border-emerald-100 dark:border-emerald-900 flex items-center justify-between">
            <div><p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Available Spaces</p><p className="text-3xl font-black text-emerald-600 italic">{totalFree}</p></div>
            <div className="p-4 bg-white dark:bg-emerald-900/50 rounded-2xl shadow-sm text-emerald-500"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
         </div>
         <div className="bg-rose-50 dark:bg-rose-950/20 p-6 rounded-[2.5rem] shadow-xl border border-rose-100 dark:border-rose-900 flex items-center justify-between">
            <div><p className="text-[9px] font-black text-rose-600 uppercase tracking-widest">In Use / Session</p><p className="text-3xl font-black text-rose-600 italic">{totalOccupied}</p></div>
            <div className="p-4 bg-white dark:bg-rose-900/50 rounded-2xl shadow-sm text-rose-500"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800">
         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
            {config.rooms.map(room => {
              const status = currentStats.map.get(room)!;
              return (
                <button 
                  key={room}
                  onClick={() => status.occupied && setSelectedRoom(room)}
                  className={`relative p-6 rounded-[2rem] border-2 transition-all group flex flex-col items-center text-center ${
                    status.occupied 
                      ? 'border-rose-200 bg-rose-50/50 hover:bg-rose-100 hover:scale-105' 
                      : 'border-emerald-200 bg-emerald-50/50 cursor-default scale-100'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full mb-4 ${status.occupied ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></div>
                  <span className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic leading-none">{room}</span>
                  <p className={`text-[8px] font-black uppercase mt-3 tracking-widest ${status.occupied ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {status.occupied ? 'OCCUPIED' : 'VACANT'}
                  </p>
                  
                  {status.occupied && (
                    <div className="mt-4 space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       <p className="text-[7px] font-bold text-rose-400 uppercase truncate w-full">{status.teacher?.split(' ')[0]}</p>
                    </div>
                  )}
                </button>
              )
            })}
         </div>
      </div>

      {selectedRoom && (
        <div className="fixed inset-0 z-[1100] bg-[#001f3f]/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl border-4 border-rose-400/20 text-center space-y-8 animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/40 rounded-3xl flex items-center justify-center mx-auto text-rose-500">
                 <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              </div>
              <div>
                 <h4 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">{selectedRoom}</h4>
                 <p className="text-[10px] font-black text-rose-500 uppercase tracking-[0.4em] mt-2">Active Session Protocol</p>
              </div>
              <div className="space-y-4 py-4 border-y border-slate-100 dark:border-slate-800">
                 <div className="space-y-1">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Faculty Member</p>
                    <p className="text-lg font-black text-[#001f3f] dark:text-white uppercase">{currentStats.map.get(selectedRoom)?.teacher}</p>
                 </div>
                 <div className="space-y-1">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Current Domain</p>
                    <p className="text-lg font-black text-rose-600 uppercase italic">{currentStats.map.get(selectedRoom)?.subject}</p>
                 </div>
                 <div className="space-y-1">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Active Section</p>
                    <p className="text-lg font-black text-sky-600 uppercase italic">{currentStats.map.get(selectedRoom)?.section}</p>
                 </div>
              </div>
              <button onClick={() => setSelectedRoom(null)} className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl">Close Matrix Detail</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default CampusOccupancyView;

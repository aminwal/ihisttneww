
import React, { useState, useEffect, useMemo } from 'react';
import { SchoolConfig, SectionType, Subject, SubjectCategory, User, TimeSlot, SchoolWing, SchoolGrade, SchoolSection } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { getCurrentPosition } from '../utils/geoUtils.ts';
import { TelegramService } from '../services/telegramService.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig, users }) => {
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'syncing' | 'warning' | 'info', message: string } | null>(null);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  
  const [selWingId, setSelWingId] = useState<string>('');
  const [selGradeId, setSelGradeId] = useState<string>('');
  
  const [newWingName, setNewWingName] = useState('');
  const [newWingType, setNewWingType] = useState<SectionType>('PRIMARY');
  const [newGradeName, setNewGradeName] = useState('');
  const [newClassName, setNewClassName] = useState('');

  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newRoom, setNewRoom] = useState('');
  
  const [editingSlotType, setEditingSlotType] = useState<SectionType>('PRIMARY');

  const [botToken, setBotToken] = useState(config?.telegramBotToken || '');
  const [botUsername, setBotUsername] = useState(config?.telegramBotUsername || '');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [radius, setRadius] = useState(config?.radiusMeters || 60);

  const isCloudActive = IS_CLOUD_ENABLED;

  useEffect(() => {
    if (status && status.type !== 'syncing') {
      const timer = setTimeout(() => setStatus(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const syncConfiguration = async (updatedConfig: SchoolConfig) => {
    if (!isCloudActive) return;
    setStatus({ type: 'syncing', message: 'Synchronizing Infrastructure...' });
    try {
      const { error } = await supabase
        .from('school_config')
        .upsert({ id: 'primary_config', config_data: updatedConfig, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw error;
      setStatus({ type: 'success', message: 'Institutional Registry Updated.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: `Cloud Sync Error: ${err.message}` });
    }
  };

  const handleAddWing = async () => {
    if (!newWingName.trim()) return;
    const wing: SchoolWing = { id: `wing-${generateUUID().substring(0, 8)}`, name: newWingName.trim(), sectionType: newWingType };
    
    setConfig(prev => {
      const updated = { ...prev, wings: [...(prev.wings || []), wing] };
      syncConfiguration(updated);
      return updated;
    });
    
    setNewWingName('');
  };

  const handleAddGrade = async () => {
    if (!newGradeName.trim() || !selWingId) return;
    const grade: SchoolGrade = { id: `grade-${generateUUID().substring(0, 8)}`, name: newGradeName.trim(), wingId: selWingId };
    
    setConfig(prev => {
      const updated = { ...prev, grades: [...(prev.grades || []), grade] };
      syncConfiguration(updated);
      return updated;
    });
    
    setNewGradeName('');
  };

  const handleAddClass = async () => {
    if (!newClassName.trim() || !selGradeId) return;
    const grade = config.grades.find(g => g.id === selGradeId);
    if (!grade) return;
    const section: SchoolSection = { 
      id: `sect-${generateUUID().substring(0, 8)}`, 
      name: newClassName.trim().toUpperCase(), 
      gradeId: selGradeId, 
      wingId: grade.wingId,
      fullName: `${grade.name.replace('Grade ', '')} ${newClassName.trim().toUpperCase()}`
    };
    
    // Automatic Room Linkage Logic
    const roomName = `ROOM ${section.fullName}`;
    
    setConfig(prev => {
      const currentRooms = prev.rooms || [];
      const updatedRooms = currentRooms.includes(roomName) ? currentRooms : [...currentRooms, roomName];
      const updated = { 
        ...prev, 
        sections: [...(prev.sections || []), section],
        rooms: updatedRooms
      };
      syncConfiguration(updated);
      return updated;
    });
    
    setNewClassName('');
    setStatus({ type: 'info', message: `Class ${section.fullName} deployed with Home Room link.` });
  };

  const removeHierarchyItem = async (type: 'wings' | 'grades' | 'sections', id: string) => {
    setConfig(prev => {
      let updated = { ...prev };
      if (type === 'wings') {
        updated.wings = updated.wings.filter(w => w.id !== id);
        updated.grades = updated.grades.filter(g => g.wingId !== id);
        updated.sections = updated.sections.filter(s => s.wingId !== id);
        if (selWingId === id) setSelWingId('');
      } else if (type === 'grades') {
        updated.grades = updated.grades.filter(g => g.id !== id);
        updated.sections = updated.sections.filter(s => s.gradeId !== id);
        if (selGradeId === id) setSelGradeId('');
      } else {
        updated.sections = updated.sections.filter(s => s.id !== id);
      }
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleUpdateSlot = (slotId: number, field: keyof TimeSlot, value: any) => {
    setConfig(prev => {
      const currentSlots = prev.slotDefinitions?.[editingSlotType] || [];
      const updatedSlots = currentSlots.map(s => s.id === slotId ? { ...s, [field]: value } : s);
      const updated = { 
        ...prev, 
        slotDefinitions: { ...prev.slotDefinitions, [editingSlotType]: updatedSlots } 
      } as SchoolConfig;
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleAddSlot = () => {
    setConfig(prev => {
      const currentSlots = prev.slotDefinitions?.[editingSlotType] || [];
      const newId = Math.max(0, ...currentSlots.map(s => s.id)) + 1;
      const newSlot: TimeSlot = { 
        id: newId, 
        label: `Period ${newId}`, 
        startTime: '00:00', 
        endTime: '00:00', 
        isBreak: false 
      };
      const updated = { 
        ...prev, 
        slotDefinitions: { ...prev.slotDefinitions, [editingSlotType]: [...currentSlots, newSlot] } 
      } as SchoolConfig;
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleRemoveSlot = (slotId: number) => {
    setConfig(prev => {
      const currentSlots = prev.slotDefinitions?.[editingSlotType] || [];
      const updatedSlots = currentSlots.filter(s => s.id !== slotId);
      const updated = { 
        ...prev, 
        slotDefinitions: { ...prev.slotDefinitions, [editingSlotType]: updatedSlots } 
      } as SchoolConfig;
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleAddSubject = async () => {
    if (!newSubject.trim()) return;
    const subject: Subject = { id: generateUUID(), name: newSubject.toUpperCase().trim(), category: targetCategory };
    
    setConfig(prev => {
      const updated = { ...prev, subjects: [...(prev.subjects || []), subject] };
      syncConfiguration(updated);
      return updated;
    });
    
    setNewSubject('');
  };

  const handleAddRoom = async () => {
    if (!newRoom.trim()) return;
    setConfig(prev => {
      const updated = { ...prev, rooms: [...(prev.rooms || []), newRoom.toUpperCase().trim()] };
      syncConfiguration(updated);
      return updated;
    });
    setNewRoom('');
  };

  const removeItem = async (type: 'subjects' | 'rooms', value: any) => {
    setConfig(prev => {
      const updated = type === 'rooms' 
        ? { ...prev, rooms: (prev.rooms || []).filter(r => r !== value) } 
        : { ...prev, subjects: (prev.subjects || []).filter(s => s.id !== value) };
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleUpdateTelegramConfig = async () => {
    setConfig(prev => {
      const updated = { ...prev, telegramBotToken: botToken.trim(), telegramBotUsername: botUsername.trim().replace('@', '') };
      syncConfiguration(updated);
      return updated;
    });
  };

  const handleBroadcast = async () => {
    if (!broadcastMsg.trim() || !botToken) return;
    setIsBroadcasting(true);
    try {
      const results = await TelegramService.broadcast(botToken, users, broadcastMsg);
      if (isCloudActive) await supabase.from('announcements').insert({ id: generateUUID(), title: "Institutional Notice", message: broadcastMsg, type: 'ANNOUNCEMENT' });
      setBroadcastMsg('');
      setStatus({ type: 'success', message: `Dispatched: ${results.success} Success / ${results.fail} Fail.` });
    } catch (err) { setStatus({ type: 'error', message: 'Signal Broadcast Error.' }); }
    finally { setIsBroadcasting(false); }
  };

  const handlePinLocation = async () => {
    setIsGeoLoading(true);
    try {
      const pos = await getCurrentPosition();
      setConfig(prev => {
        const updated = { ...prev, latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        syncConfiguration(updated);
        return updated;
      });
      setStatus({ type: 'success', message: 'Campus GPS Pin Updated.' });
    } catch (err) { setStatus({ type: 'error', message: 'Geolocation Authorization Refused.' }); }
    finally { setIsGeoLoading(false); }
  };

  const handleUpdateRadius = async (val: number) => {
    setRadius(val);
    setConfig(prev => {
      const updated = { ...prev, radiusMeters: val };
      syncConfiguration(updated);
      return updated;
    });
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-700 w-full px-2 max-w-7xl mx-auto pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-5xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">Settings <span className="text-[#d4af37]">& Matrix</span></h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">Institutional Genesis Hub</p>
        </div>
        {status && (
          <div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border shadow-xl animate-in slide-in-from-right bg-white ${status.type === 'error' ? 'text-rose-500 border-rose-100' : status.type === 'syncing' ? 'text-sky-500 border-sky-100 animate-pulse' : 'text-emerald-500 border-emerald-100'}`}>{status.message}</div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-12">
         <div className="flex items-center gap-4">
            <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Academic Architecture</h2>
            <div className="flex-1 h-[2px] bg-slate-50 dark:bg-slate-800"></div>
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-6">
               <div className="flex items-center justify-between"><p className="text-[11px] font-black text-amber-500 uppercase tracking-[0.2em]">Step 1: Wings</p></div>
               <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
                  <input placeholder="Wing Name (e.g. Primary)" className="w-full px-4 py-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs outline-none" value={newWingName} onChange={e => setNewWingName(e.target.value)} />
                  <select className="w-full px-4 py-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none" value={newWingType} onChange={e => setNewWingType(e.target.value as SectionType)}>
                     <option value="PRIMARY">Primary Timing</option>
                     <option value="SECONDARY_BOYS">Sec Boys Timing</option>
                     <option value="SECONDARY_GIRLS">Sec Girls Timing</option>
                     <option value="SENIOR_SECONDARY_BOYS">Sr Sec Boys Timing</option>
                     <option value="SENIOR_SECONDARY_GIRLS">Sr Sec Girls Timing</option>
                  </select>
                  <button onClick={handleAddWing} className="bg-[#001f3f] text-[#d4af37] py-3 rounded-xl font-black text-[10px] uppercase shadow-md active:scale-95 transition-all">Create Wing</button>
               </div>
               <div className="space-y-2 max-h-56 overflow-y-auto scrollbar-hide pr-2">
                  {config.wings && config.wings.length > 0 ? (config.wings || []).map(w => (
                    <button key={w.id} onClick={() => setSelWingId(w.id)} className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all group ${selWingId === w.id ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/10' : 'border-transparent bg-slate-50 dark:bg-slate-800'}`}>
                       <span className={`text-[10px] font-black uppercase ${selWingId === w.id ? 'text-amber-600' : 'text-slate-600 dark:text-slate-300'}`}>{w.name}</span>
                       <span onClick={(e) => { e.stopPropagation(); removeHierarchyItem('wings', w.id); }} className="text-rose-400 opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-50 rounded">×</span>
                    </button>
                  )) : (
                    <div className="p-10 text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-3xl">
                       <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic leading-relaxed">No Wings Identified<br/>Sync Protocol Required</p>
                    </div>
                  )}
               </div>
            </div>

            <div className={`space-y-6 transition-all duration-500 ${!selWingId ? 'opacity-30 pointer-events-none scale-95' : ''}`}>
               <p className="text-[11px] font-black text-amber-500 uppercase tracking-[0.2em]">Step 2: Grades</p>
               <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
                  <input placeholder="e.g. Grade IX" className="w-full px-4 py-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs outline-none" value={newGradeName} onChange={e => setNewGradeName(e.target.value)} />
                  <button onClick={handleAddGrade} className="bg-[#001f3f] text-[#d4af37] py-3 rounded-xl font-black text-[10px] uppercase shadow-md active:scale-95 transition-all">Link Grade</button>
               </div>
               <div className="space-y-2 max-h-56 overflow-y-auto scrollbar-hide pr-2">
                  {(config.grades || []).filter(g => g.wingId === selWingId).map(g => (
                    <button key={g.id} onClick={() => setSelGradeId(g.id)} className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all group ${selGradeId === g.id ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/10' : 'border-transparent bg-slate-50 dark:bg-slate-800'}`}>
                       <span className={`text-[10px] font-black uppercase ${selGradeId === g.id ? 'text-sky-600' : 'text-slate-600 dark:text-slate-300'}`}>{g.name}</span>
                       <span onClick={(e) => { e.stopPropagation(); removeHierarchyItem('grades', g.id); }} className="text-rose-400 opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-50 rounded">×</span>
                    </button>
                  ))}
               </div>
            </div>

            <div className={`space-y-6 transition-all duration-500 ${!selGradeId ? 'opacity-30 pointer-events-none scale-95' : ''}`}>
               <p className="text-[11px] font-black text-amber-500 uppercase tracking-[0.2em]">Step 3: Classes & Auto-Rooms</p>
               <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
                  <input placeholder="Section Name (e.g. A)" className="w-full px-4 py-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs outline-none" value={newClassName} onChange={e => setNewClassName(e.target.value)} />
                  <button onClick={handleAddClass} className="bg-[#001f3f] text-[#d4af37] py-3 rounded-xl font-black text-[10px] uppercase shadow-md active:scale-95 transition-all">Deploy Class + Room</button>
               </div>
               <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto scrollbar-hide pr-2">
                  {(config.sections || []).filter(s => s.gradeId === selGradeId).map(s => (
                    <div key={s.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 group">
                       <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300">{s.name}</span>
                       <span onClick={() => removeHierarchyItem('sections', s.id)} className="text-rose-400 cursor-pointer p-1 hover:bg-rose-50 rounded transition-colors opacity-0 group-hover:opacity-100">×</span>
                    </div>
                  ))}
               </div>
            </div>
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-12">
         <div className="flex items-center gap-4">
            <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Temporal Architecture</h2>
            <div className="flex-1 h-[2px] bg-slate-50 dark:bg-slate-800"></div>
            <select 
               className="px-6 py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase border-2 border-amber-400/20 shadow-sm"
               value={editingSlotType}
               onChange={e => setEditingSlotType(e.target.value as SectionType)}
            >
               <option value="PRIMARY">Primary timing</option>
               <option value="SECONDARY_BOYS">Sec Boys Timing</option>
               <option value="SECONDARY_GIRLS">Sec Girls Timing</option>
               <option value="SENIOR_SECONDARY_BOYS">Sr Sec Boys</option>
               <option value="SENIOR_SECONDARY_GIRLS">Sr Sec Girls</option>
            </select>
         </div>

         <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 dark:bg-slate-800/50">
                     <th className="px-6 py-4">Slot Identifier</th>
                     <th className="px-6 py-4">Start Time</th>
                     <th className="px-6 py-4">End Time</th>
                     <th className="px-6 py-4 text-center">Recess/Break</th>
                     <th className="px-6 py-4 text-right">Controls</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {(config.slotDefinitions?.[editingSlotType] || []).map((slot) => (
                    <tr key={slot.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                       <td className="px-6 py-4">
                          <input 
                             type="text" 
                             className="bg-transparent font-black text-sm text-[#001f3f] dark:text-white uppercase outline-none focus:text-amber-500"
                             value={slot.label}
                             onChange={e => handleUpdateSlot(slot.id, 'label', e.target.value)}
                          />
                       </td>
                       <td className="px-6 py-4">
                          <input 
                             type="time" 
                             className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-lg font-bold text-xs outline-none dark:text-white"
                             value={slot.startTime}
                             onChange={e => handleUpdateSlot(slot.id, 'startTime', e.target.value)}
                          />
                       </td>
                       <td className="px-6 py-4">
                          <input 
                             type="time" 
                             className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-lg font-bold text-xs outline-none dark:text-white"
                             value={slot.endTime}
                             onChange={e => handleUpdateSlot(slot.id, 'endTime', e.target.value)}
                          />
                       </td>
                       <td className="px-6 py-4 text-center">
                          <input 
                             type="checkbox" 
                             className="w-5 h-5 accent-amber-500 cursor-pointer"
                             checked={!!slot.isBreak}
                             onChange={e => handleUpdateSlot(slot.id, 'isBreak', e.target.checked)}
                          />
                       </td>
                       <td className="px-6 py-4 text-right">
                          <button 
                             onClick={() => handleRemoveSlot(slot.id)}
                             className="text-rose-400 hover:text-rose-600 p-2 transition-colors"
                          >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                       </td>
                    </tr>
                  ))}
               </tbody>
            </table>
            <div className="mt-8 flex justify-center">
               <button 
                  onClick={handleAddSlot}
                  className="px-12 py-4 bg-[#001f3f] text-[#d4af37] rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all active:scale-95"
               >
                  + Add Temporal Slot
               </button>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
         <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Curriculum Catalog</h2>
            <div className="space-y-4">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input placeholder="Subject (e.g. PHYSICS)" className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs outline-none" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
                  <select className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none" value={targetCategory} onChange={e => setTargetCategory(e.target.value as SubjectCategory)}>
                     {Object.values(SubjectCategory).map(cat => <option key={cat} value={cat}>{cat.replace('_', ' ')}</option>)}
                  </select>
               </div>
               <button onClick={handleAddSubject} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg">Authorize Subject</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-64 overflow-y-auto scrollbar-hide pr-2">
               {(config.subjects || []).map(s => (
                 <div key={s.id} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center group">
                    <div>
                       <p className="text-[9px] font-black uppercase text-slate-700 dark:text-slate-300 leading-none">{s.name}</p>
                       <p className="text-[7px] font-bold text-amber-500 uppercase mt-1">{s.category.split('_')[0]}</p>
                    </div>
                    <button onClick={() => removeItem('subjects', s.id)} className="text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                 </div>
               ))}
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Campus Resource Registry</h2>
            <div className="flex gap-3">
               <input placeholder="Room Identification (Labs/Libraries/Halls)" className="flex-1 px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs outline-none" value={newRoom} onChange={e => setNewRoom(e.target.value)} />
               <button onClick={handleAddRoom} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg">Add</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-64 overflow-y-auto scrollbar-hide pr-2">
               {(config.rooms || []).map(r => (
                 <div key={r} className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex justify-between items-center group">
                    <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300 italic">{r}</span>
                    <button onClick={() => removeItem('rooms', r)} className="text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                 </div>
               ))}
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
         <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl space-y-8 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700"><svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg></div>
            <div className="relative z-10 space-y-6">
               <h3 className="text-xl font-black text-[#d4af37] uppercase italic tracking-[0.2em]">Telegram Matrix Configuration</h3>
               <div className="space-y-4">
                  <input placeholder="Bot Access Token" className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-2xl font-bold text-xs text-white outline-none focus:border-amber-400 transition-all" value={botToken} onChange={e => setBotToken(e.target.value)} />
                  <input placeholder="Bot Username (e.g. IHISBot)" className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-2xl font-bold text-xs text-white outline-none focus:border-amber-400 transition-all" value={botUsername} onChange={e => setBotUsername(e.target.value)} />
                  <button onClick={handleUpdateTelegramConfig} className="w-full bg-[#d4af37] text-[#001f3f] py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">Secure Bot Matrix</button>
               </div>
            </div>
         </div>

         <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
            <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Global Signal Dispatch</h3>
            <div className="space-y-4">
               <textarea placeholder="Compose emergency institutional notice..." className="w-full h-36 px-6 py-5 bg-slate-50 dark:bg-slate-800 rounded-3xl font-bold text-sm outline-none border-2 border-transparent focus:border-rose-400 transition-all resize-none" value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} />
               <button onClick={handleBroadcast} disabled={isBroadcasting || !botToken} className="w-full bg-rose-500 text-white py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] shadow-xl hover:bg-rose-600 disabled:opacity-30 flex items-center justify-center gap-3 transition-all active:scale-95">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>
                  {isBroadcasting ? 'Dispatched matrix signal...' : 'Emergency Broadcast'}
               </button>
            </div>
         </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-10">
         <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Geofence Intelligence</h2>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
               <div className="flex justify-between items-end">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Boundary</p>
                  <span className="text-4xl font-black text-[#001f3f] dark:text-white italic tracking-tighter">{radius}m</span>
               </div>
               <input type="range" min="10" max="500" step="10" value={radius} onChange={e => handleUpdateRadius(parseInt(e.target.value))} className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none cursor-pointer accent-amber-400" />
               <p className="text-[9px] font-bold text-slate-400 uppercase italic leading-relaxed">Threshold controls the radius around the campus center for biometric authorization.</p>
            </div>
            
            <div className="space-y-4">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Institutional Centerpoint</p>
               <div className="bg-slate-50 dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 flex items-center justify-between shadow-inner">
                  <div className="space-y-1">
                     <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">Lat: {config.latitude?.toFixed(6) || '--'}</p>
                     <p className="text-[10px] font-black text-[#001f3f] dark:text-white uppercase">Lng: {config.longitude?.toFixed(6) || '--'}</p>
                  </div>
                  <button onClick={handlePinLocation} disabled={isGeoLoading} className="bg-[#001f3f] text-[#d4af37] px-6 py-3 rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-slate-950 active:scale-95 transition-all">
                    {isGeoLoading ? 'Pinning...' : 'Re-Pin Matrix'}
                  </button>
               </div>
            </div>
         </div>
      </div>

      <div className="text-center opacity-30">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.5em]">Institutional Intelligence Matrix v3.5</p>
      </div>
    </div>
  );
};

export default AdminConfigView;

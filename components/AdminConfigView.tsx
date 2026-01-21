
import React, { useState, useEffect } from 'react';
import { SchoolConfig, SectionType, Subject, SchoolClass, SubjectCategory, User } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { getCurrentPosition } from '../utils/geoUtils.ts';
import { NotificationService } from '../services/notificationService.ts';
import { TelegramService } from '../services/telegramService.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  users: User[];
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig, users }) => {
  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newClass, setNewClass] = useState('');
  const [targetSection, setTargetSection] = useState<SectionType>('PRIMARY');
  const [newRoom, setNewRoom] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'syncing' | 'warning' | 'info', message: string } | null>(null);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  
  // Telegram States
  const [botToken, setBotToken] = useState(config?.telegramBotToken || '');
  const [botUsername, setBotUsername] = useState(config?.telegramBotUsername || '');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Geofence states
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
        .upsert({ 
          id: 'primary_config', 
          config_data: updatedConfig,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      
      if (error) throw error;
      setStatus({ type: 'success', message: 'Institutional Registry Updated.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: `Cloud Handshake Failed: ${err.message}` });
    }
  };

  const handleUpdateTelegramConfig = async () => {
    const updated = { 
      ...config, 
      telegramBotToken: botToken.trim(), 
      telegramBotUsername: botUsername.trim().replace('@', '') 
    };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const handleBroadcast = async () => {
    if (!broadcastMsg.trim() || !botToken) {
      setStatus({ type: 'error', message: 'Message and Token required for broadcast.' });
      return;
    }

    setIsBroadcasting(true);
    setStatus({ type: 'info', message: 'Initiating Global Broadcast...' });

    try {
      const results = await TelegramService.broadcast(botToken, users, broadcastMsg);
      if (isCloudActive) {
        await supabase.from('announcements').insert({
          id: generateUUID(),
          title: "Institutional Notice",
          message: broadcastMsg,
          type: 'ANNOUNCEMENT'
        });
      }
      setBroadcastMsg('');
      setStatus({ 
        type: 'success', 
        message: `Broadcast Complete. Telegram: ${results.success} Delivered.` 
      });
    } catch (err) {
      setStatus({ type: 'error', message: 'Broadcast Matrix Failure.' });
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handlePinLocation = async () => {
    setIsGeoLoading(true);
    try {
      const pos = await getCurrentPosition();
      const updated = { ...config, latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setConfig(updated);
      await syncConfiguration(updated);
      setStatus({ type: 'success', message: 'Campus Center Recalibrated.' });
    } catch (err) {
      setStatus({ type: 'error', message: 'GPS Access Denied.' });
    } finally {
      setIsGeoLoading(false);
    }
  };

  const handleRadiusChange = async (newVal: number) => {
    setRadius(newVal);
    const updated = { ...config, radiusMeters: newVal };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const handleAddClass = async () => {
    if (!newClass.trim()) return;
    const updated = { ...config, classes: [...config.classes, { id: generateUUID(), name: newClass.toUpperCase().trim(), section: targetSection }] };
    setConfig(updated);
    setNewClass('');
    await syncConfiguration(updated);
  };

  const handleAddSubject = async () => {
    if (!newSubject.trim()) return;
    const updated = { ...config, subjects: [...config.subjects, { id: generateUUID(), name: newSubject.toUpperCase().trim(), category: targetCategory }] };
    setConfig(updated);
    setNewSubject('');
    await syncConfiguration(updated);
  };

  const handleAddRoom = async () => {
    if (!newRoom.trim()) return;
    const updated = { ...config, rooms: [...(config.rooms || []), newRoom.toUpperCase().trim()] };
    setConfig(updated);
    setNewRoom('');
    await syncConfiguration(updated);
  };

  const removeItem = async (type: 'classes' | 'subjects' | 'rooms', value: any) => {
    let updated: SchoolConfig;
    if (type === 'rooms') {
      updated = { ...config, rooms: config.rooms.filter(r => r !== value) };
    } else {
      updated = { ...config, [type]: (config[type] as any[]).filter(i => i.id !== value) };
    }
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const linkedStaffCount = users.filter(u => !!u.telegram_chat_id).length;

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-2">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
            Institutional <span className="text-[#d4af37]">Configuration</span>
          </h1>
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.4em]">Core System Parameters</p>
        </div>

        {status && (
          <div className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border shadow-lg transition-all animate-in slide-in-from-right ${
            status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
            status.type === 'info' ? 'bg-sky-50 text-sky-600 border-sky-100' :
            status.type === 'syncing' ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' : 
            'bg-red-50 text-red-600 border-red-100'
          }`}>
            {status.message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        {/* Classes Manager */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
           <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Academic Sections</h2>
           <div className="flex flex-col sm:flex-row gap-3">
              <input placeholder="Class Name (e.g. XI A)" className="flex-1 px-5 py-3.5 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs outline-none focus:ring-2 ring-amber-400" value={newClass} onChange={e => setNewClass(e.target.value)} />
              <select className="px-4 py-3.5 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-[10px] uppercase outline-none focus:ring-2 ring-amber-400" value={targetSection} onChange={e => setTargetSection(e.target.value as SectionType)}>
                <option value="PRIMARY">Primary</option>
                <option value="SECONDARY_BOYS">Secondary Boys</option>
                <option value="SECONDARY_GIRLS">Secondary Girls</option>
                <option value="SENIOR_SECONDARY_BOYS">Senior Boys</option>
                <option value="SENIOR_SECONDARY_GIRLS">Senior Girls</option>
              </select>
              <button onClick={handleAddClass} className="bg-[#001f3f] text-[#d4af37] px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase">Add</button>
           </div>
           <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto scrollbar-hide p-2 bg-slate-50/50 dark:bg-slate-950/20 rounded-3xl">
              {config.classes.map(cls => (
                <div key={cls.id} className="flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm group">
                  <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-200">{cls.name}</span>
                  <button onClick={() => removeItem('classes', cls.id)} className="text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
                </div>
              ))}
           </div>
        </div>

        {/* Subjects Manager */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
           <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Curriculum Catalog</h2>
           <div className="flex flex-col sm:flex-row gap-3">
              <input placeholder="Subject Name" className="flex-1 px-5 py-3.5 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs outline-none focus:ring-2 ring-amber-400" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
              <select className="px-4 py-3.5 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-[10px] uppercase outline-none focus:ring-2 ring-amber-400" value={targetCategory} onChange={e => setTargetCategory(e.target.value as SubjectCategory)}>
                <option value={SubjectCategory.CORE}>Core</option>
                <option value={SubjectCategory.LANGUAGE_2ND}>2nd Language</option>
                <option value={SubjectCategory.LANGUAGE_3RD}>3rd Language</option>
                <option value={SubjectCategory.RME}>RME</option>
              </select>
              <button onClick={handleAddSubject} className="bg-[#001f3f] text-[#d4af37] px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase">Add</button>
           </div>
           <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto scrollbar-hide p-2 bg-slate-50/50 dark:bg-slate-950/20 rounded-3xl">
              {config.subjects.map(sub => (
                <div key={sub.id} className="flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm group">
                  <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-200">{sub.name}</span>
                  <button onClick={() => removeItem('subjects', sub.id)} className="text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
                </div>
              ))}
           </div>
        </div>

        {/* Telegram Bot Infrastructure & Global Broadcast */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8 relative overflow-hidden group">
           <div className="flex justify-between items-start">
             <div className="space-y-1">
                <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Telegram Matrix</h2>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Global Communications Hub</p>
             </div>
             <div className="w-10 h-10 bg-[#0088cc] rounded-xl flex items-center justify-center text-white shadow-lg">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.35-.49.96-.75 3.78-1.65 6.31-2.73 7.57-3.24 3.59-1.47 4.34-1.73 4.82-1.73.11 0 .35.03.5.15.13.09.16.22.18.31.02.08.02.24.01.41z"/></svg>
             </div>
           </div>
           
           <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <input type="password" placeholder="Bot API Token" value={botToken} onChange={e => setBotToken(e.target.value)} className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs dark:text-white outline-none focus:ring-2 ring-[#0088cc] shadow-sm" />
                 <input type="text" placeholder="Bot Username" value={botUsername} onChange={e => setBotUsername(e.target.value)} className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs dark:text-white outline-none focus:ring-2 ring-[#0088cc] shadow-sm" />
              </div>
              <button onClick={handleUpdateTelegramConfig} className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-all">Sync Bot Protocol</button>
           </div>

           {/* Bulk Messaging Area */}
           <div className="pt-8 border-t border-slate-50 dark:border-slate-800 space-y-6">
              <div className="flex justify-between items-center">
                 <h3 className="text-[10px] font-black text-[#0088cc] uppercase tracking-[0.2em] italic">Global Announcement Dispatch</h3>
                 <span className="text-[8px] font-black bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg border border-emerald-100">
                    {linkedStaffCount} Linked Personnel
                 </span>
              </div>
              <div className="space-y-4">
                 <textarea 
                   rows={4}
                   placeholder="Type Global Broadcast Message..." 
                   className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs dark:text-white outline-none focus:ring-2 ring-[#0088cc] shadow-inner resize-none"
                   value={broadcastMsg}
                   onChange={e => setBroadcastMsg(e.target.value)}
                 />
                 <button 
                   onClick={handleBroadcast}
                   disabled={isBroadcasting || !broadcastMsg.trim() || !botToken}
                   className={`w-full py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${
                     isBroadcasting ? 'bg-amber-400 text-[#001f3f]' : 'bg-[#0088cc] text-white hover:bg-[#0077b5]'
                   }`}
                 >
                   {isBroadcasting ? (
                     <>
                        <div className="w-4 h-4 border-2 border-[#001f3f] border-t-transparent rounded-full animate-spin"></div>
                        Transmitting...
                     </>
                   ) : (
                     <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Dispatch Global Notice
                     </>
                   )}
                 </button>
                 <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest text-center italic leading-relaxed">
                    Broadcast will be sent via Telegram and logged in the Staff Portal Announcements.
                 </p>
              </div>
           </div>
        </div>

        {/* Geofencing Calibration */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8 relative overflow-hidden group">
          <div className="relative z-10 space-y-2">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Campus Perimeter</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Geofencing Matrix</p>
          </div>
          <div className="space-y-6 pt-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Detection Radius (Meters)</label>
                <span className="text-xs font-black text-[#001f3f] dark:text-white italic">{radius}m</span>
              </div>
              <input type="range" min="10" max="500" step="5" value={radius} onChange={e => handleRadiusChange(parseInt(e.target.value))} className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#d4af37]" />
              <div className="flex justify-between text-[8px] font-bold text-slate-300 uppercase tracking-tighter"><span>Narrow (10m)</span><span>Balanced</span><span>Wide (500m)</span></div>
            </div>
            <button onClick={handlePinLocation} disabled={isGeoLoading} className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-slate-950 transition-all active:scale-95 flex items-center justify-center gap-3 border-2 border-white/5">
              {isGeoLoading ? <div className="w-4 h-4 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin"></div> : "PIN CAMPUS CENTER"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminConfigView;

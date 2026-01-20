import React, { useState, useEffect } from 'react';
import { SchoolConfig, SectionType, Subject, SchoolClass, SubjectCategory } from '../types.ts';
import { supabase, IS_CLOUD_ENABLED } from '../supabaseClient.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { getCurrentPosition } from '../utils/geoUtils.ts';
import { NotificationService } from '../services/notificationService.ts';

interface AdminConfigViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
}

const AdminConfigView: React.FC<AdminConfigViewProps> = ({ config, setConfig }) => {
  const [newSubject, setNewSubject] = useState('');
  const [targetCategory, setTargetCategory] = useState<SubjectCategory>(SubjectCategory.CORE);
  const [newClass, setNewClass] = useState('');
  const [targetSection, setTargetSection] = useState<SectionType>('PRIMARY');
  const [newRoom, setNewRoom] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'syncing', message: string } | null>(null);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  const isCloudActive = IS_CLOUD_ENABLED;

  const currentClasses = config?.classes || [];
  const currentSubjects = config?.subjects || [];
  const currentRooms = config?.rooms || [];

  useEffect(() => {
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }
    if (status && status.type !== 'syncing') {
      const timer = setTimeout(() => setStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleTestNotification = async () => {
    try {
      const permission = await NotificationService.requestPermission();
      setNotifPermission(permission);
      
      if (permission === 'granted') {
        // Fix: Cast the options object to any to bypass strict NotificationOptions check for 'vibrate' property which might be missing from some TS DOM lib versions
        await NotificationService.sendNotification("IHIS Matrix Connectivity Test", {
          body: "Push notification architecture verified. Your device is ready to receive proxy alerts.",
          vibrate: [100, 50, 100],
          requireInteraction: true
        } as any);
        setStatus({ type: 'success', message: 'Diagnostic Broadcast Initiated.' });
      } else {
        setStatus({ type: 'error', message: 'Notification Access Denied by Browser.' });
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Notif Failed: ' + err.message });
    }
  };

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

  const handlePinLocation = async () => {
    setIsGeoLoading(true);
    try {
      const pos = await getCurrentPosition();
      const updated = { 
        ...config, 
        latitude: pos.coords.latitude, 
        longitude: pos.coords.longitude 
      };
      setConfig(updated);
      await syncConfiguration(updated);
      setStatus({ type: 'success', message: 'Campus Center Recalibrated.' });
    } catch (err) {
      setStatus({ type: 'error', message: 'GPS Access Denied.' });
    } finally {
      setIsGeoLoading(false);
    }
  };

  const handleUpdateRadius = async (radius: number) => {
    const updated = { ...config, radiusMeters: radius };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const addSubject = async () => {
    if (!newSubject.trim()) return;
    const subject: Subject = { id: `sub-${generateUUID()}`, name: newSubject.trim().toUpperCase(), category: targetCategory };
    const updated = { ...config, subjects: [...currentSubjects, subject] };
    setConfig(updated);
    setNewSubject('');
    await syncConfiguration(updated);
  };

  const removeSubject = async (id: string) => {
    const updated = { ...config, subjects: currentSubjects.filter(s => s.id !== id) };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const addClass = async () => {
    const trimmedName = newClass.trim().toUpperCase();
    if (!trimmedName) return;
    const cls: SchoolClass = { id: `cls-${generateUUID()}`, name: trimmedName, section: targetSection };
    const updated = { 
      ...config, 
      classes: [...currentClasses, cls], 
      rooms: currentRooms.includes(trimmedName) ? currentRooms : [...currentRooms, trimmedName] 
    };
    setConfig(updated);
    setNewClass('');
    await syncConfiguration(updated);
  };

  const removeClass = async (id: string) => {
    const updated = { ...config, classes: currentClasses.filter(c => c.id !== id) };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  const addRoom = async () => {
    if (!newRoom.trim()) return;
    const roomName = newRoom.trim().toUpperCase();
    if (currentRooms.includes(roomName)) return;
    const updated = { ...config, rooms: [...currentRooms, roomName] };
    setConfig(updated);
    setNewRoom('');
    await syncConfiguration(updated);
  };

  const removeRoom = async (room: string) => {
    const updated = { ...config, rooms: currentRooms.filter(r => r !== room) };
    setConfig(updated);
    await syncConfiguration(updated);
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 w-full px-2 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-black text-[#001f3f] dark:text-white italic uppercase tracking-tighter leading-none">
            Institutional <span className="text-[#d4af37]">Configuration</span>
          </h1>
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.4em]">Core System Parameters</p>
        </div>

        {status && (
          <div className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border shadow-lg transition-all animate-in slide-in-from-right ${
            status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
            status.type === 'syncing' ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' : 
            'bg-red-50 text-red-600 border-red-100'
          }`}>
            {status.message}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        {/* Communication Diagnostics Hub */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
           <div className="flex justify-between items-start">
             <div className="space-y-1">
                <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Diagnostic Center</h2>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Network & Messaging Testing</p>
             </div>
             <div className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-tighter border ${
               notifPermission === 'granted' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
               notifPermission === 'denied' ? 'bg-rose-50 text-rose-600 border-rose-100' :
               'bg-slate-50 text-slate-400 border-slate-200'
             }`}>
               Browser Status: {notifPermission}
             </div>
           </div>

           <div className="bg-sky-50 dark:bg-sky-950/20 rounded-3xl p-6 border border-sky-100 dark:border-sky-900/40 space-y-4">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-sky-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                 </div>
                 <div>
                    <h4 className="text-xs font-black text-sky-700 dark:text-sky-400 uppercase tracking-tight">Push Signal Test</h4>
                    <p className="text-[9px] font-medium text-sky-600/70 dark:text-sky-500/70 leading-relaxed">Broadcast a local test packet to this device to verify the Service Worker integrity.</p>
                 </div>
              </div>
              <button 
                onClick={handleTestNotification}
                className="w-full bg-sky-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-sky-700 transition-all active:scale-95"
              >
                Send Test Notification
              </button>
           </div>
           <p className="text-[8px] font-bold text-slate-400 italic text-center uppercase tracking-widest px-4">Note: On iOS, notifications only function when the app is "Added to Home Screen".</p>
        </div>

        {/* Geofencing Calibration Module */}
        <div className="bg-[#001f3f] rounded-[3rem] p-10 shadow-2xl border border-white/10 space-y-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700">
             <svg className="w-32 h-32 text-[#d4af37]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          </div>
          <div className="relative z-10 space-y-2">
            <h2 className="text-xl font-black text-[#d4af37] uppercase italic tracking-tighter">Campus Perimeter Control</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Calibration of Global Geofencing Matrix</p>
          </div>
          
          <div className="bg-white/5 backdrop-blur-md rounded-3xl p-6 border border-white/10 space-y-6">
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                   <p className="text-[8px] font-black text-slate-500 uppercase">Latitude</p>
                   <p className="text-sm font-mono text-white">{config.latitude?.toFixed(6) || 'Not Set'}</p>
                </div>
                <div className="space-y-1">
                   <p className="text-[8px] font-black text-slate-500 uppercase">Longitude</p>
                   <p className="text-sm font-mono text-white">{config.longitude?.toFixed(6) || 'Not Set'}</p>
                </div>
             </div>
             <div className="space-y-3">
                <div className="flex justify-between items-end">
                   <p className="text-[9px] font-black text-[#d4af37] uppercase tracking-widest">Authorized Radius</p>
                   <p className="text-lg font-black text-white italic">{config.radiusMeters}m</p>
                </div>
                <input 
                  type="range" min="30" max="300" step="5"
                  value={config.radiusMeters || 60}
                  onChange={(e) => handleUpdateRadius(parseInt(e.target.value))}
                  className="w-full accent-[#d4af37] bg-white/10 rounded-full h-2 appearance-none cursor-pointer"
                />
             </div>
          </div>
          <button 
            onClick={handlePinLocation}
            disabled={isGeoLoading}
            className="w-full bg-[#d4af37] text-[#001f3f] py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl hover:bg-white transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            {isGeoLoading ? <div className="w-4 h-4 border-2 border-[#001f3f] border-t-transparent rounded-full animate-spin"></div> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>}
            {isGeoLoading ? 'PINNING GPS...' : 'PIN CAMPUS CENTER'}
          </button>
        </div>

        {/* Campus Sections (Classes) Card */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Campus Sections</h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Divisional Structure Management</p>
          </div>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input placeholder="Class Name (e.g. IX A)" value={newClass} onChange={e => setNewClass(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" />
              <select 
                value={targetSection} 
                onChange={e => setTargetSection(e.target.value as SectionType)}
                className="px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#d4af37] dark:text-white"
              >
                <option value="PRIMARY">Primary Wing</option>
                <option value="SECONDARY_BOYS">Secondary Boys</option>
                <option value="SECONDARY_GIRLS">Secondary Girls</option>
                <option value="SENIOR_SECONDARY_BOYS">Senior Boys</option>
                <option value="SENIOR_SECONDARY_GIRLS">Senior Girls</option>
              </select>
              <button onClick={addClass} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-slate-950 transition-all">Register</button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
            {currentClasses.map(c => (
              <div key={c.id} className="group p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 flex justify-between items-center transition-all hover:border-amber-200">
                <div className="space-y-0.5">
                  <p className="font-black text-xs text-[#001f3f] dark:text-white">{c.name}</p>
                  <p className="text-[7px] font-black text-slate-400 uppercase">{c.section.replace('_', ' ')}</p>
                </div>
                <button onClick={() => removeClass(c.id)} className="opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-700 transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Curriculum Catalog (Subjects) Card */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 xl:col-span-2">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Curriculum Catalog</h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Instructional Units & Categories</p>
          </div>
          <div className="flex flex-col lg:flex-row gap-4">
            <input placeholder="Subject Name" value={newSubject} onChange={e => setNewSubject(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-sky-400" />
            <select 
              value={targetCategory} 
              onChange={e => setTargetCategory(e.target.value as SubjectCategory)}
              className="px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-sky-400 dark:text-white"
            >
              {Object.entries(SubjectCategory).map(([key, val]) => (
                <option key={key} value={val}>{val.replace('_', ' ')}</option>
              ))}
            </select>
            <button onClick={addSubject} className="bg-[#001f3f] text-[#d4af37] px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-slate-950 transition-all">Authorize</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {currentSubjects.map(s => (
              <div key={s.id} className="group p-4 bg-sky-50/30 dark:bg-sky-950/10 rounded-2xl border border-sky-100 dark:border-sky-800/50 flex flex-col items-center text-center relative transition-all hover:bg-sky-100/50">
                <p className="font-black text-[10px] text-sky-700 dark:text-sky-400 uppercase">{s.name}</p>
                <p className="text-[7px] font-bold text-slate-400 mt-1 uppercase">{s.category.replace('_', ' ')}</p>
                <button onClick={() => removeSubject(s.id)} className="absolute -top-2 -right-2 bg-white dark:bg-slate-800 rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 text-rose-500 transition-all">
                   <svg className="w-3 v-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Physical Infrastructure (Rooms) Card */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Physical Infrastructure</h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Room & Facility Registry</p>
          </div>
          <div className="flex gap-3">
            <input placeholder="Room Number / Lab Name" value={newRoom} onChange={e => setNewRoom(e.target.value)} className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none focus:ring-2 focus:ring-emerald-400" />
            <button onClick={addRoom} className="bg-[#001f3f] text-[#d4af37] px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl">Audit</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[250px] overflow-y-auto pr-2 scrollbar-hide">
            {currentRooms.map(r => (
              <div key={r} className="group p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-600 dark:text-slate-300">{r}</span>
                <button onClick={() => removeRoom(r)} className="opacity-0 group-hover:opacity-100 text-rose-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminConfigView;
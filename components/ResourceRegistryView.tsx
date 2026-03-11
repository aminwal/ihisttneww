import React, { useState } from 'react';
import { SchoolConfig, ResourceConstraint } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { Plus, Trash2, Save, Edit2, X, Check } from 'lucide-react';

interface ResourceRegistryViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (msg: string, type?: any) => void;
  onUpdateRoomName?: (oldName: string, newName: string) => void;
}

const ResourceRegistryView: React.FC<ResourceRegistryViewProps> = ({ config, setConfig, showToast, onUpdateRoomName }) => {
  const [constraints, setConstraints] = useState<ResourceConstraint[]>(config.resourceConstraints || []);
  const [newRoom, setNewRoom] = useState('');
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editedRoomName, setEditedRoomName] = useState('');

  const addConstraint = () => {
    const newConstraint: ResourceConstraint = {
      id: generateUUID(),
      resourceName: '',
      resourceType: 'ROOM',
      allowedGradeIds: [],
      allowedWingIds: []
    };
    setConstraints([...constraints, newConstraint]);
  };

  const updateConstraint = (id: string, field: keyof ResourceConstraint, value: any) => {
    setConstraints(constraints.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeConstraint = (id: string) => {
    setConstraints(constraints.filter(c => c.id !== id));
  };

  const saveConfig = () => {
    setConfig({ ...config, resourceConstraints: constraints });
    showToast("Resource Registry Updated", "success");
  };

  const handleAddRoom = () => {
    if (!newRoom.trim()) return;
    const finalName = newRoom.toUpperCase().trim();
    if (config.rooms?.includes(finalName)) {
      showToast("Room already exists", "error");
      return;
    }
    setConfig(prev => ({
      ...prev,
      rooms: [...(prev.rooms || []), finalName]
    }));
    setNewRoom('');
    showToast("Room Added", "success");
  };

  const handleRemoveRoom = (room: string) => {
    if (confirm(`Are you sure you want to delete ${room}? This might affect existing timetables.`)) {
      setConfig(prev => ({
        ...prev,
        rooms: (prev.rooms || []).filter(r => r !== room)
      }));
      showToast("Room Removed", "success");
    }
  };

  const saveRoomEdit = (oldName: string) => {
    if (!editedRoomName.trim() || oldName === editedRoomName) {
      setEditingRoom(null);
      return;
    }
    const finalNewName = editedRoomName.toUpperCase().trim();
    if (config.rooms?.includes(finalNewName)) {
      showToast("Room name already exists", "error");
      return;
    }
    
    if (onUpdateRoomName) {
      onUpdateRoomName(oldName, finalNewName);
    } else {
      // Fallback if onUpdateRoomName is not provided
      setConfig(prev => ({
        ...prev,
        rooms: (prev.rooms || []).map(r => r === oldName ? finalNewName : r)
      }));
    }
    setEditingRoom(null);
    showToast("Room Updated", "success");
  };

  return (
    <div className="space-y-8 p-6 animate-in fade-in duration-700 pb-32">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Resource Registry</h2>
        <button onClick={saveConfig} className="bg-[#001f3f] text-[#d4af37] px-6 py-3 rounded-xl font-black text-xs uppercase flex items-center gap-2 shadow-lg hover:scale-105 transition-transform">
          <Save className="w-4 h-4" /> Save Constraints
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Rooms & Labs Management */}
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Rooms & Labs</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manage Physical Spaces</p>
          </div>
          
          <div className="flex gap-3">
            <input 
              placeholder="e.g. ROOM 101 or ICT LAB" 
              className="flex-1 px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-xs outline-none dark:text-white border border-slate-200 dark:border-slate-700 focus:border-amber-400" 
              value={newRoom} 
              onChange={e => setNewRoom(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleAddRoom()}
            />
            <button onClick={handleAddRoom} className="bg-emerald-500 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:bg-emerald-600 transition-colors">Add</button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto scrollbar-hide pr-2">
            {(config.rooms || []).map(r => (
              <div key={r} className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex flex-col gap-2 group relative transition-all hover:border-amber-200">
                {editingRoom === r ? (
                  <div className="flex flex-col gap-3 w-full">
                    <input 
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 rounded-xl text-xs font-black uppercase outline-none border-2 border-amber-400"
                      value={editedRoomName}
                      onChange={e => setEditedRoomName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveRoomEdit(r)}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button 
                        onClick={() => setEditingRoom(null)}
                        className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-300 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => saveRoomEdit(r)}
                        className="p-2 bg-emerald-500 rounded-lg text-white hover:bg-emerald-600 transition-colors"
                        title="Save"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 italic">{r}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setEditingRoom(r);
                          setEditedRoomName(r);
                        }}
                        className="p-2 text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-lg transition-colors"
                        title="Edit Room Name"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleRemoveRoom(r)} 
                        className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors" 
                        title="Delete Room"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Resource Constraints */}
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xl font-black text-[#001f3f] dark:text-white uppercase italic">Resource Constraints</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Define Eligibility Rules</p>
          </div>

          <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide pr-2">
            {constraints.map(c => (
              <div key={c.id} className="bg-slate-50 dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4 relative group">
                <button onClick={() => removeConstraint(c.id)} className="absolute top-4 right-4 text-rose-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-5 h-5" />
                </button>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pr-8">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Resource Name</label>
                    <select
                      value={c.resourceName}
                      onChange={e => updateConstraint(c.id, 'resourceName', e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 outline-none focus:border-amber-400"
                    >
                      <option value="">Select Resource...</option>
                      {(config.rooms || []).map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Type</label>
                    <select 
                      value={c.resourceType} 
                      onChange={e => updateConstraint(c.id, 'resourceType', e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 p-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 outline-none focus:border-amber-400"
                    >
                      <option value="ROOM">ROOM</option>
                      <option value="LAB">LAB</option>
                      <option value="PLAYGROUND">PLAYGROUND</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Allowed Wings</label>
                    <div className="flex flex-wrap gap-2">
                      {config.wings.map(wing => (
                        <label key={wing.id} className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-amber-400 transition-colors">
                          <input 
                            type="checkbox" 
                            className="accent-amber-500"
                            checked={c.allowedWingIds.includes(wing.id)}
                            onChange={(e) => {
                              const newWings = e.target.checked 
                                ? [...c.allowedWingIds, wing.id]
                                : c.allowedWingIds.filter(id => id !== wing.id);
                              updateConstraint(c.id, 'allowedWingIds', newWings);
                            }}
                          />
                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{wing.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Allowed Grades</label>
                    <div className="flex flex-wrap gap-2">
                      {config.grades.map(grade => (
                        <label key={grade.id} className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-amber-400 transition-colors">
                          <input 
                            type="checkbox" 
                            className="accent-amber-500"
                            checked={c.allowedGradeIds.includes(grade.id)}
                            onChange={(e) => {
                              const newGrades = e.target.checked 
                                ? [...c.allowedGradeIds, grade.id]
                                : c.allowedGradeIds.filter(id => id !== grade.id);
                              updateConstraint(c.id, 'allowedGradeIds', newGrades);
                            }}
                          />
                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{grade.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {constraints.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase">No constraints defined</p>
              </div>
            )}
          </div>

          <button onClick={addConstraint} className="w-full py-4 border-2 border-dashed border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add Constraint
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResourceRegistryView;

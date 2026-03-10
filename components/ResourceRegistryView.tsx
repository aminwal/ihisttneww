import React, { useState } from 'react';
import { SchoolConfig, ResourceConstraint } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { Plus, Trash2, Save } from 'lucide-react';

interface ResourceRegistryViewProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  showToast: (msg: string, type?: any) => void;
}

const ResourceRegistryView: React.FC<ResourceRegistryViewProps> = ({ config, setConfig, showToast }) => {
  const [constraints, setConstraints] = useState<ResourceConstraint[]>(config.resourceConstraints || []);

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

  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic">Resource Registry</h2>
        <button onClick={saveConfig} className="bg-[#001f3f] text-[#d4af37] px-6 py-3 rounded-xl font-black text-xs uppercase flex items-center gap-2">
          <Save className="w-4 h-4" /> Save Registry
        </button>
      </div>

      <div className="grid gap-4">
        {constraints.map(c => (
          <div key={c.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <input 
              type="text" 
              placeholder="Resource Name (e.g., Physics Lab)" 
              value={c.resourceName} 
              onChange={e => updateConstraint(c.id, 'resourceName', e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg text-sm font-bold"
            />
            <select 
              value={c.resourceType} 
              onChange={e => updateConstraint(c.id, 'resourceType', e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg text-sm font-bold"
            >
              <option value="ROOM">ROOM</option>
              <option value="LAB">LAB</option>
              <option value="PLAYGROUND">PLAYGROUND</option>
            </select>
            <button onClick={() => removeConstraint(c.id)} className="text-rose-500 p-2">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
      </div>

      <button onClick={addConstraint} className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
        <Plus className="w-5 h-5" /> Add Resource Constraint
      </button>
    </div>
  );
};

export default ResourceRegistryView;

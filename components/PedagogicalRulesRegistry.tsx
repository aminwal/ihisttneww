import React, { useState } from 'react';
import { SchoolConfig, PedagogicalRule, RuleTemplate, RuleSeverity, Subject } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { Shield, Plus, Trash2, Check, AlertTriangle, Settings2, Sparkles, Loader2 } from 'lucide-react';
import { AIService } from '../services/geminiService.ts';

interface PedagogicalRulesRegistryProps {
  config: SchoolConfig;
  setConfig: React.Dispatch<React.SetStateAction<SchoolConfig>>;
  syncConfiguration: (updatedConfig: SchoolConfig) => Promise<void>;
}

const PedagogicalRulesRegistry: React.FC<PedagogicalRulesRegistryProps> = ({ config, setConfig, syncConfiguration }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [newRule, setNewRule] = useState<Partial<PedagogicalRule>>({
    name: '',
    template: RuleTemplate.ADJACENCY_RESTRICTION,
    targetWingIds: [],
    config: {
      primaryTypes: ['GROUP_PERIOD'],
      secondaryTypes: ['GROUP_PERIOD'],
      subjectIds: [],
      secondarySubjectIds: [],
      allowIfSame: true,
      forbiddenIfDifferent: true
    },
    severity: RuleSeverity.BLOCK,
    isActive: true
  });

  const handleGenerateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    setAiError(null);
    try {
      const generatedRule = await AIService.generatePedagogicalRule(aiPrompt, config);
      
      // Merge generated rule with defaults to ensure no missing fields crash the UI
      setNewRule({
        name: generatedRule.name || 'AI Generated Rule',
        template: generatedRule.template as RuleTemplate || RuleTemplate.ADJACENCY_RESTRICTION,
        targetWingIds: generatedRule.targetWingIds?.length > 0 ? generatedRule.targetWingIds : config.wings.map(w => w.id),
        severity: generatedRule.severity as RuleSeverity || RuleSeverity.BLOCK,
        isActive: true,
        config: {
          primaryTypes: generatedRule.config?.primaryTypes || ['ALL_PERIODS'],
          secondaryTypes: generatedRule.config?.secondaryTypes || ['ALL_PERIODS'],
          subjectIds: generatedRule.config?.subjectIds || [],
          secondarySubjectIds: generatedRule.config?.secondarySubjectIds || [],
          maxCount: generatedRule.config?.maxCount || 1,
          allowedSlots: generatedRule.config?.allowedSlots || [],
          allowIfSame: generatedRule.config?.allowIfSame ?? true,
          forbiddenIfDifferent: generatedRule.config?.forbiddenIfDifferent ?? true
        }
      });
      setAiPrompt('');
    } catch (error: any) {
      console.error("Failed to generate rule:", error);
      setAiError(error.message || "Failed to generate rule. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddRule = () => {
    if (!newRule.name || newRule.targetWingIds?.length === 0) return;
    
    const rule: PedagogicalRule = {
      ...newRule as PedagogicalRule,
      id: generateUUID()
    };

    setConfig(prev => {
      const updated = { ...prev, pedagogicalRules: [...(prev.pedagogicalRules || []), rule] };
      syncConfiguration(updated);
      return updated;
    });

    setIsAdding(false);
    setNewRule({
      name: '',
      template: RuleTemplate.ADJACENCY_RESTRICTION,
      targetWingIds: [],
      config: {
        primaryTypes: ['GROUP_PERIOD'],
        secondaryTypes: ['GROUP_PERIOD'],
        subjectIds: [],
        secondarySubjectIds: [],
        allowIfSame: true,
        forbiddenIfDifferent: true
      },
      severity: RuleSeverity.BLOCK,
      isActive: true
    });
  };

  const removeRule = (id: string) => {
    setConfig(prev => {
      const updated = { ...prev, pedagogicalRules: (prev.pedagogicalRules || []).filter(r => r.id !== id) };
      syncConfiguration(updated);
      return updated;
    });
  };

  const toggleRule = (id: string) => {
    setConfig(prev => {
      const updated = {
        ...prev,
        pedagogicalRules: (prev.pedagogicalRules || []).map(r => 
          r.id === id ? { ...r, isActive: !r.isActive } : r
        )
      };
      syncConfiguration(updated);
      return updated;
    });
  };

  const RuleTypeSelector = ({ 
    label, 
    selectedTypes, 
    selectedSubjects, 
    onTypesChange, 
    onSubjectsChange 
  }: { 
    label: string, 
    selectedTypes?: string[], 
    selectedSubjects?: string[], 
    onTypesChange: (vals: string[]) => void, 
    onSubjectsChange: (vals: string[]) => void 
  }) => (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label} - Period Types</label>
        <div className="flex flex-wrap gap-2">
          {['ALL_PERIODS', 'GROUP_PERIOD', 'LAB_PERIOD', 'EXTRA_CURRICULAR'].map(type => (
            <button
              key={type}
              onClick={() => {
                const current = selectedTypes || [];
                let updated: string[];
                if (type === 'ALL_PERIODS') {
                  updated = ['ALL_PERIODS'];
                } else {
                  const filtered = current.filter(t => t !== 'ALL_PERIODS');
                  updated = filtered.includes(type)
                    ? filtered.filter(t => t !== type)
                    : [...filtered, type];
                  if (updated.length === 0) updated = ['ALL_PERIODS'];
                }
                onTypesChange(updated);
              }}
              className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all border ${
                (selectedTypes || ['ALL_PERIODS']).includes(type)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-100 dark:border-slate-700'
              }`}
            >
              {type.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label} - Specific Subjects (Optional)</label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
          {config.subjects.map(s => (
            <button
              key={s.id}
              onClick={() => {
                const current = selectedSubjects || [];
                const updated = current.includes(s.id)
                  ? current.filter(id => id !== s.id)
                  : [...current, s.id];
                onSubjectsChange(updated);
              }}
              className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all border ${
                (selectedSubjects || []).includes(s.id)
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
              }`}
            >
              {s.name}
            </button>
          ))}
          {config.subjects.length === 0 && (
            <span className="text-[8px] font-bold text-slate-400 uppercase p-2">No subjects defined</span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 md:p-12 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b dark:border-slate-800 pb-8">
          <div>
            <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Pedagogical Policies</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Define rules for timetable generation and manual moves</p>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create New Policy
          </button>
        </div>

        {isAdding && (
          <div className="p-8 bg-slate-50 dark:bg-slate-800 rounded-[2rem] border-2 border-indigo-100 dark:border-indigo-900/30 space-y-6 animate-in zoom-in duration-300">
            
            {/* AI Assistant Panel */}
            <div className="p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 space-y-4">
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                <Sparkles className="w-5 h-5" />
                <h3 className="text-xs font-black uppercase tracking-widest">AI Rule Assistant</h3>
              </div>
              <p className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70 font-bold">
                Describe the rule you want in plain English, and the AI will configure the settings below for you.
              </p>
              <div className="flex gap-3">
                <input 
                  type="text"
                  placeholder="e.g., Don't allow Math and Science to be back-to-back, and limit Math to 2 periods a day."
                  className="flex-1 px-4 py-3 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold outline-none border border-indigo-100 dark:border-indigo-800/50 focus:border-indigo-400 dark:text-white"
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGenerateWithAI()}
                />
                <button 
                  onClick={handleGenerateWithAI}
                  disabled={isGenerating || !aiPrompt.trim()}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Generate
                </button>
              </div>
              {aiError && (
                <p className="text-[10px] text-rose-500 font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {aiError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Policy Name</label>
                <input 
                  placeholder="e.g. No Back-to-Back Different Group Periods"
                  className="w-full px-6 py-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none dark:text-white border border-transparent focus:border-indigo-400"
                  value={newRule.name}
                  onChange={e => setNewRule(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Rule Template</label>
                <select 
                  className="w-full px-6 py-4 bg-white dark:bg-slate-900 rounded-2xl text-[10px] font-black uppercase outline-none dark:text-white border border-transparent focus:border-indigo-400"
                  value={newRule.template}
                  onChange={e => setNewRule(prev => ({ ...prev, template: e.target.value as RuleTemplate }))}
                >
                  <option value={RuleTemplate.ADJACENCY_RESTRICTION}>Adjacency Restriction</option>
                  <option value={RuleTemplate.DAILY_LIMIT}>Daily Limit</option>
                  <option value={RuleTemplate.CONSECUTIVE_LIMIT}>Consecutive Limit</option>
                  <option value={RuleTemplate.SLOT_RESTRICTION}>Slot Restriction</option>
                  <option value={RuleTemplate.BACK_TO_BACK_DAYS_RESTRICTION}>Back-to-Back Days Restriction</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Target Wings</label>
              <div className="flex flex-wrap gap-2">
                {config.wings.map(wing => (
                  <button
                    key={wing.id}
                    onClick={() => {
                      const current = newRule.targetWingIds || [];
                      const updated = current.includes(wing.id) 
                        ? current.filter(id => id !== wing.id)
                        : [...current, wing.id];
                      setNewRule(prev => ({ ...prev, targetWingIds: updated }));
                    }}
                    className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${
                      newRule.targetWingIds?.includes(wing.id)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    {wing.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-6">
              <h4 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Configure Logic
              </h4>
              
              {newRule.template === RuleTemplate.ADJACENCY_RESTRICTION && (
                <div className="space-y-8">
                  <RuleTypeSelector 
                    label="Primary Filter"
                    selectedTypes={newRule.config?.primaryTypes}
                    selectedSubjects={newRule.config?.subjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, primaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, subjectIds: vals } }))}
                  />
                  <div className="h-px bg-slate-100 dark:bg-slate-800" />
                  <RuleTypeSelector 
                    label="Secondary Filter"
                    selectedTypes={newRule.config?.secondaryTypes}
                    selectedSubjects={newRule.config?.secondarySubjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, secondaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, secondarySubjectIds: vals } }))}
                  />
                  <div className="flex items-center gap-6 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={newRule.config?.allowIfSame}
                        onChange={e => setNewRule(prev => ({ ...prev, config: { ...prev.config, allowIfSame: e.target.checked } }))}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase">Allow if same subject</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={newRule.config?.forbiddenIfDifferent}
                        onChange={e => setNewRule(prev => ({ ...prev, config: { ...prev.config, forbiddenIfDifferent: e.target.checked } }))}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase">Forbidden if different</span>
                    </label>
                  </div>
                </div>
              )}

              {newRule.template === RuleTemplate.DAILY_LIMIT && (
                <div className="space-y-6">
                  <RuleTypeSelector 
                    label="Target Filter"
                    selectedTypes={newRule.config?.primaryTypes}
                    selectedSubjects={newRule.config?.subjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, primaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, subjectIds: vals } }))}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Max Daily Count</label>
                      <input 
                        type="number"
                        min="1"
                        max="10"
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white"
                        value={newRule.config?.maxCount || 1}
                        onChange={e => setNewRule(prev => ({ ...prev, config: { ...prev.config, maxCount: parseInt(e.target.value) } }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {newRule.template === RuleTemplate.CONSECUTIVE_LIMIT && (
                <div className="space-y-6">
                  <RuleTypeSelector 
                    label="Target Filter"
                    selectedTypes={newRule.config?.primaryTypes}
                    selectedSubjects={newRule.config?.subjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, primaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, subjectIds: vals } }))}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Max Consecutive Periods</label>
                      <input 
                        type="number"
                        min="1"
                        max="10"
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white"
                        value={newRule.config?.maxCount || 3}
                        onChange={e => setNewRule(prev => ({ ...prev, config: { ...prev.config, maxCount: parseInt(e.target.value) } }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {newRule.template === RuleTemplate.SLOT_RESTRICTION && (
                <div className="space-y-6">
                  <RuleTypeSelector 
                    label="Target Filter"
                    selectedTypes={newRule.config?.primaryTypes}
                    selectedSubjects={newRule.config?.subjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, primaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, subjectIds: vals } }))}
                  />
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Allowed Slots (Comma separated, e.g. 1,2,3)</label>
                    <input 
                      type="text"
                      placeholder="1, 2, 3"
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white"
                      value={newRule.config?.allowedSlots?.join(', ') || ''}
                      onChange={e => {
                        const slots = e.target.value.split(',').map(s => parseInt(s.trim())).filter(s => !isNaN(s));
                        setNewRule(prev => ({ ...prev, config: { ...prev.config, allowedSlots: slots } }));
                      }}
                    />
                  </div>
                </div>
              )}

              {newRule.template === RuleTemplate.BACK_TO_BACK_DAYS_RESTRICTION && (
                <div className="space-y-6">
                  <RuleTypeSelector 
                    label="Target Filter"
                    selectedTypes={newRule.config?.primaryTypes}
                    selectedSubjects={newRule.config?.subjectIds}
                    onTypesChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, primaryTypes: vals } }))}
                    onSubjectsChange={vals => setNewRule(prev => ({ ...prev, config: { ...prev.config, subjectIds: vals } }))}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Enforcement Severity</label>
                  <select 
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white"
                    value={newRule.severity}
                    onChange={e => setNewRule(prev => ({ ...prev, severity: e.target.value as RuleSeverity }))}
                  >
                    <option value={RuleSeverity.BLOCK}>Hard Block (Prevent Move)</option>
                    <option value={RuleSeverity.WARN}>Soft Warning (Audit Alert)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button 
                onClick={() => setIsAdding(false)}
                className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddRule}
                className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Save Policy
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {(!config.pedagogicalRules || config.pedagogicalRules.length === 0) ? (
            <div className="p-20 text-center border-4 border-dashed border-slate-50 dark:border-slate-800 rounded-[3rem]">
              <Shield className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
              <p className="text-xs font-black text-slate-300 uppercase tracking-widest italic">No pedagogical policies defined yet.</p>
            </div>
          ) : (
            config.pedagogicalRules.map(rule => (
              <div key={rule.id} className={`p-6 bg-white dark:bg-slate-900 rounded-[2rem] border-2 transition-all ${rule.isActive ? 'border-slate-100 dark:border-slate-800' : 'border-slate-50 dark:border-slate-900 opacity-50'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${rule.severity === RuleSeverity.BLOCK ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                      {rule.severity === RuleSeverity.BLOCK ? <Shield className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">{rule.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md">
                          {rule.template.replace('_', ' ')}
                        </span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase">
                          Applied to: {rule.targetWingIds.map(id => config.wings.find(w => w.id === id)?.name).join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => toggleRule(rule.id)}
                      className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        rule.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {rule.isActive ? 'Active' : 'Disabled'}
                    </button>
                    <button 
                      onClick={() => removeRule(rule.id)}
                      className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PedagogicalRulesRegistry;

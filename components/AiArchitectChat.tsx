import React from 'react';
import { Bot, X, Sparkles, ShieldAlert, Send } from 'lucide-react';
import { MatrixService } from '../services/matrixService';

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AiArchitectChatProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  isDraftMode: boolean;
  isAiProcessing: boolean;
  handleAiConductor: () => void;
  isGatingError: boolean;
  setIsGatingError: (isError: boolean) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  aiMessages: AiMessage[];
  aiInput: string;
  setAiInput: (input: string) => void;
  handleAiArchitectSubmit: () => void;
}

export const AiArchitectChat: React.FC<AiArchitectChatProps> = ({
  isOpen,
  setIsOpen,
  isDraftMode,
  isAiProcessing,
  handleAiConductor,
  isGatingError,
  setIsGatingError,
  showToast,
  aiMessages,
  aiInput,
  setAiInput,
  handleAiArchitectSubmit
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 z-[9999] flex flex-col animate-in slide-in-from-right">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 mt-16 md:mt-0">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-bold text-slate-800 dark:text-slate-200">AI Architect</h3>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      
      <div className="p-4 bg-indigo-50/50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-800/30">
         <button
            onClick={handleAiConductor}
            disabled={!isDraftMode || isAiProcessing}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
         >
            <Sparkles className="w-4 h-4 group-hover:animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">Run AI Conductor</span>
         </button>
         <p className="text-[10px] text-center text-indigo-400 mt-2 font-medium">
            Auto-generates timetable & closes gaps
         </p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isGatingError && (
          <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 rounded-2xl text-center space-y-4 animate-in fade-in zoom-in">
            <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto" />
            <h4 className="text-sm font-black text-rose-600 uppercase italic">AI Key Required</h4>
            <p className="text-[10px] text-rose-700 dark:text-rose-300 font-medium">
              The Gemini API key is missing or invalid. Please connect your key to enable AI Architect features.
            </p>
            <button 
              onClick={async () => {
                const success = await MatrixService.ensureKey();
                if (success) {
                  setIsGatingError(false);
                  showToast("AI Key Connected", "success");
                } else {
                  const manualKey = prompt("The platform's key selector is unavailable. Please enter your Gemini API Key manually:");
                  if (manualKey) {
                    localStorage.setItem('IHIS_GEMINI_KEY', manualKey.trim());
                    setIsGatingError(false);
                    showToast("AI Key Saved Locally", "success");
                  }
                }
              }}
              className="w-full py-3 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-rose-700 transition-all"
            >
              {/* @ts-ignore */}
              {window.aistudio ? "Connect AI Key" : "Configure Infrastructure"}
            </button>
          </div>
        )}

        {aiMessages.length === 0 && !isGatingError && (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">I am your AI Timetable Architect.</p>
            <p className="text-xs mt-1">Ask me to analyze conflicts, suggest improvements, or help with scheduling.</p>
          </div>
        )}
        
        {aiMessages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl text-xs ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-tl-none'}`}>
              {msg.content}
            </div>
          </div>
        ))}
        
        {isAiProcessing && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>
      
      <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div className="flex gap-2">
          <input
            type="text"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAiArchitectSubmit()}
            placeholder="Ask AI Architect..."
            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500"
          />
          <button 
            onClick={handleAiArchitectSubmit}
            disabled={!aiInput.trim() || isAiProcessing}
            className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

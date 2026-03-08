import React from 'react';
import { MessageSquare, X } from 'lucide-react';

interface NoteModalProps {
  noteModal: { viewMode: string, targetId: string, day: string, slotId: number } | null;
  setNoteModal: (val: any) => void;
  cellNotes: Record<string, string>;
  setCellNotes: (val: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  noteModal,
  setNoteModal,
  cellNotes,
  setCellNotes,
}) => {
  if (!noteModal) return null;

  const key = `${noteModal.viewMode}-${noteModal.targetId}-${noteModal.day}-${noteModal.slotId}`;
  const currentNote = cellNotes[key] || '';

  return (
    <div className="fixed inset-0 z-[1000] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] p-8 md:p-12 shadow-2xl space-y-8 animate-in zoom-in duration-300">
        <div className="text-center">
          <div className="inline-flex p-4 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-2xl mb-4">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Cell Annotation</h4>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{noteModal.day} • Period {noteModal.slotId}</p>
        </div>

        <textarea 
          autoFocus
          className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 focus:border-amber-400 focus:ring-0 resize-none"
          placeholder="Add a note for this specific cell..."
          defaultValue={currentNote}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const val = e.currentTarget.value.trim();
              setCellNotes(prev => {
                const next = { ...prev };
                if (val) next[key] = val;
                else delete next[key];
                return next;
              });
              setNoteModal(null);
            }
          }}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
            setCellNotes(prev => {
              const next = { ...prev };
              if (val) next[key] = val;
              else delete next[key];
              return next;
            });
          }}
        />
        <div className="flex gap-3">
          <button 
            onClick={() => {
              setCellNotes(prev => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setNoteModal(null);
            }}
            className="flex-1 py-3 bg-rose-50 text-rose-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-colors"
          >
            Clear
          </button>
          <button 
            onClick={() => setNoteModal(null)}
            className="flex-1 py-3 bg-[#001f3f] text-[#d4af37] rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

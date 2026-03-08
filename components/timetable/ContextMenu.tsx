import React from 'react';
import { Copy, Trash2, ClipboardPaste, MoreHorizontal, Unlock, Lock } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  day: string;
  slotId: number;
  entryId?: string;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onPaste: () => void;
  onNote: () => void;
  onToggleLock: () => void;
  isLocked: boolean;
  canPaste: boolean;
  viewMode: string;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y, day, slotId, entryId, onClose, onCopy, onDelete, onPaste, onNote, onToggleLock, isLocked, canPaste, viewMode
}) => {
  return (
    <div 
      className="fixed z-[1300] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-48 py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ top: y, left: x }}
      onMouseLeave={onClose}
    >
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{day} • P{slotId}</p>
      </div>
      
      {entryId ? (
        <>
          <button 
            onClick={onCopy}
            className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
          >
            <Copy className="w-3 h-3" /> Copy Period
          </button>
          <button 
            onClick={onDelete}
            className="w-full text-left px-4 py-2 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-xs font-medium text-rose-600 flex items-center gap-2"
          >
            <Trash2 className="w-3 h-3" /> Delete Period
          </button>
        </>
      ) : (
        canPaste && (
          <button 
            onClick={onPaste}
            className="w-full text-left px-4 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs font-medium text-emerald-600 flex items-center gap-2"
          >
            <ClipboardPaste className="w-3 h-3" /> Paste Period
          </button>
        )
      )}
      
      <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
      
      <button 
        onClick={onNote}
        className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
      >
        <MoreHorizontal className="w-3 h-3" /> Cell Note
      </button>
      
      {viewMode === 'SECTION' && (
         <button 
           onClick={onToggleLock}
           className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"
         >
           {isLocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
           {isLocked ? 'Unlock Section' : 'Lock Section'}
         </button>
      )}
    </div>
  );
};

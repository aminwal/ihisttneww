import React from 'react';
import { Archive, X } from 'lucide-react';

interface FloatingActionBarProps {
  swapSource: any;
  onPark: () => void;
  onCancel: () => void;
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  swapSource, onPark, onCancel
}) => {
  if (!swapSource) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50 animate-in slide-in-from-bottom-10">
      <span className="text-sm font-medium">
        {swapSource.isFromParkingLot 
          ? 'Select destination to place parked item' 
          : 'Select destination to swap'}
      </span>
      <div className="w-px h-4 bg-slate-700 dark:bg-slate-300" />
      {!swapSource.isFromParkingLot && (
        <button onClick={onPark} className="text-sm font-bold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1">
          <Archive className="w-4 h-4" /> Park Entry
        </button>
      )}
      <button onClick={onCancel} className="text-sm font-bold text-slate-400 hover:text-slate-500 transition-colors flex items-center gap-1">
        <X className="w-4 h-4" /> Cancel
      </button>
    </div>
  );
};

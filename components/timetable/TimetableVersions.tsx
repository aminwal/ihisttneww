import React from 'react';
import { History, Save, Trash2, RefreshCw, Clock, Info, X } from 'lucide-react';
import { TimetableVersion, TimeTableEntry } from '../../types';

interface TimetableVersionsProps {
  isOpen: boolean;
  onClose: () => void;
  versions: TimetableVersion[];
  timetableDraft: TimeTableEntry[];
  handleSaveVersion: () => void;
  handleShareVersion: (versionId: string) => void;
  handleRestoreVersion: (version: TimetableVersion) => void;
  handleDeleteVersion: (id: string) => void;
}

export const TimetableVersions: React.FC<TimetableVersionsProps> = ({
  isOpen,
  onClose,
  versions,
  timetableDraft,
  handleSaveVersion,
  handleShareVersion,
  handleRestoreVersion,
  handleDeleteVersion
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2 text-slate-800">
            <History className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-lg">Version History</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-indigo-900 flex items-center gap-2">
                <Save className="w-4 h-4" />
                Current Draft
              </h4>
              <span className="text-xs font-medium bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full">
                {timetableDraft.length} entries
              </span>
            </div>
            <p className="text-xs text-indigo-700 mb-3">
              Save the current state as a version to restore it later.
            </p>
            <button
              onClick={handleSaveVersion}
              disabled={timetableDraft.length === 0}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              Save New Version
            </button>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Saved Versions</h4>
            {versions.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No saved versions yet</p>
              </div>
            ) : (
              versions.map((version) => (
                <div key={version.id} className="bg-white border border-slate-200 rounded-xl p-3 hover:border-indigo-300 transition-colors group">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-slate-700">{version.name}</span>
                        {version.isAuto && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">AUTO</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(version.createdAt).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Info className="w-3 h-3" />
                          {version.entries.length} entries
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRestoreVersion(version)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Restore this version"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteVersion(version.id)}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Delete version"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

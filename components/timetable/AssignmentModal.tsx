import React from 'react';
import { Wand2, Sparkles } from 'lucide-react';
import { 
  User, UserRole, SchoolConfig, SubjectCategory, 
  TimeTableEntry, TimeSlot 
} from '../../types';
import { DAYS } from '../../constants';

interface AssignmentModalProps {
  assigningSlot: { day: string, slotId: number, sectionId?: string } | null;
  setAssigningSlot: (val: any) => void;
  assignmentType: 'STANDARD' | 'POOL' | 'ACTIVITY' | 'LAB';
  setAssignmentType: (val: any) => void;
  selAssignDay: string;
  setSelAssignDay: (val: string) => void;
  selAssignSlotId: number;
  setSelAssignSlotId: (val: number) => void;
  selAssignSectionId: string;
  setSelAssignSectionId: (val: string) => void;
  selAssignTeacherId: string;
  setSelAssignTeacherId: (val: string) => void;
  selAssignSubject: string;
  setSelAssignSubject: (val: string) => void;
  selAssignRoom: string;
  setSelAssignRoom: (val: string) => void;
  selLabBlockId: string;
  setSelLabBlockId: (val: string) => void;
  selLabTechnicianId: string;
  setSelLabTechnicianId: (val: string) => void;
  selLabSection2Id: string;
  setSelLabSection2Id: (val: string) => void;
  selLab2TeacherId: string;
  setSelLab2TeacherId: (val: string) => void;
  selLab2TechnicianId: string;
  setSelLab2TechnicianId: (val: string) => void;
  selLab2Subject: string;
  setSelLab2Subject: (val: string) => void;
  selLab2Room: string;
  setSelLab2Room: (val: string) => void;
  selLab3TeacherId: string;
  setSelLab3TeacherId: (val: string) => void;
  selLab3TechnicianId: string;
  setSelLab3TechnicianId: (val: string) => void;
  selLab3Subject: string;
  setSelLab3Subject: (val: string) => void;
  selLab3Room: string;
  setSelLab3Room: (val: string) => void;
  selPoolId: string;
  setSelPoolId: (val: string) => void;
  selActivityId: string;
  setSelActivityId: (val: string) => void;
  currentClash: string | null;
  setAiResolutionModal: (val: any) => void;
  handleMagicFill: () => void;
  handleQuickAssign: () => void;
  isQuickAssignValid: boolean;
  config: SchoolConfig;
  users: User[];
  currentTimetable: TimeTableEntry[];
  slots: TimeSlot[];
  viewMode: 'SECTION' | 'TEACHER' | 'ROOM';
  selectedTargetId: string;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  assigningSlot,
  setAssigningSlot,
  assignmentType,
  setAssignmentType,
  selAssignDay,
  setSelAssignDay,
  selAssignSlotId,
  setSelAssignSlotId,
  selAssignSectionId,
  setSelAssignSectionId,
  selAssignTeacherId,
  setSelAssignTeacherId,
  selAssignSubject,
  setSelAssignSubject,
  selAssignRoom,
  setSelAssignRoom,
  selLabBlockId,
  setSelLabBlockId,
  selLabTechnicianId,
  setSelLabTechnicianId,
  selLabSection2Id,
  setSelLabSection2Id,
  selLab2TeacherId,
  setSelLab2TeacherId,
  selLab2TechnicianId,
  setSelLab2TechnicianId,
  selLab2Subject,
  setSelLab2Subject,
  selLab2Room,
  setSelLab2Room,
  selLab3TeacherId,
  setSelLab3TeacherId,
  selLab3TechnicianId,
  setSelLab3TechnicianId,
  selLab3Subject,
  setSelLab3Subject,
  selLab3Room,
  setSelLab3Room,
  selPoolId,
  setSelPoolId,
  selActivityId,
  setSelActivityId,
  currentClash,
  setAiResolutionModal,
  handleMagicFill,
  handleQuickAssign,
  isQuickAssignValid,
  config,
  users,
  currentTimetable,
  slots,
  viewMode,
  selectedTargetId,
}) => {
  if (!assigningSlot) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-[#001f3f]/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 shadow-2xl space-y-6 md:space-y-8 animate-in zoom-in duration-300 overflow-y-auto max-h-[90vh] scrollbar-hide">
        <div className="text-center">
          <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter leading-none">Manual Allocation</h4>
          {!assigningSlot.sectionId ? (
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-3">{assigningSlot.day} • Period {assigningSlot.slotId}</p>
          ) : (
            <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mt-3">Advanced Form Deployment</p>
          )}
        </div>

        <div className="flex bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner">
          {(['STANDARD', 'POOL', 'ACTIVITY', 'LAB'] as const).map(type => (
            <button key={type} onClick={() => setAssignmentType(type)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${assignmentType === type ? 'bg-[#001f3f] text-[#d4af37]' : 'text-slate-400'}`}>{type}</button>
          ))}
        </div>

        <div className="space-y-4">
          {(!assigningSlot.sectionId || viewMode !== 'SECTION') && (
            <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700">
              <div className="space-y-1">
                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Day</label>
                <select value={selAssignDay} onChange={e => setSelAssignDay(e.target.value)} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none">
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Period</label>
                <select value={selAssignSlotId} onChange={e => setSelAssignSlotId(parseInt(e.target.value))} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none">
                  {slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Target Class (Section)</label>
                <select value={selAssignSectionId} onChange={e => setSelAssignSectionId(e.target.value)} className="w-full bg-white dark:bg-slate-950 p-2 rounded-xl text-[9px] font-bold uppercase outline-none border-2 border-amber-400/50">
                  <option value="">Select Section...</option>
                  {config.sections.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </div>
            </div>
          )}

          {assignmentType === 'STANDARD' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between items-center ml-4 mr-2">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Faculty Member</label>
                  <button onClick={handleMagicFill} className="text-[8px] font-black text-indigo-500 uppercase flex items-center gap-1 hover:text-indigo-600 transition-colors" title="Suggest available teacher with lowest load">
                    <Wand2 className="w-3 h-3" /> Suggest
                  </button>
                </div>
                <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                  <option value="">Select Staff...</option>
                  {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => {
                    const load = currentTimetable.filter(e => e.teacherId === u.id).length;
                    return <option key={u.id} value={u.id}>{u.name} ({load})</option>;
                  })}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Instructional Domain</label>
                <select value={selAssignSubject} onChange={e => setSelAssignSubject(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                  <option value="">Select Subject...</option>
                  {config.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Room Allocation</label>
                <select value={selAssignRoom} onChange={e => setSelAssignRoom(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                  <option value="">Assign Room...</option>
                  {config.rooms.filter(r => {
                    const constraint = config.resourceConstraints.find(c => c.resourceName === r);
                    if (!constraint) return true;
                    if (constraint.allowedGradeIds.length === 0 && constraint.allowedWingIds.length === 0) return true;
                    const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                    const targetSec = config.sections.find(s => s.id === targetSecId);
                    if (!targetSec) return false;
                    return constraint.allowedGradeIds.includes(targetSec.gradeId) || 
                           constraint.allowedWingIds.includes(targetSec.wingId);
                  }).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </>
          )}
          {assignmentType === 'LAB' && (
            <div className="space-y-6">
              <div className="space-y-1 px-4">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Lab Period Template</label>
                <select value={selLabBlockId} onChange={e => setSelLabBlockId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-amber-400/50 focus:border-amber-400 transition-all">
                  <option value="">Manual Configuration (No Template)</option>
                  {config.labBlocks?.filter(l => {
                    const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                    return l.sectionIds?.includes(targetSecId);
                  }).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>

              <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 1 (Primary)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                    <select value={selAssignTeacherId} onChange={e => setSelAssignTeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                    <select value={selLabTechnicianId} onChange={e => setSelLabTechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                    <select value={selAssignSubject} onChange={e => setSelAssignSubject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Subject...</option>
                      {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                    <select value={selAssignRoom} onChange={e => setSelAssignRoom(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Assign Room...</option>
                      {config.rooms.filter(r => {
                        const constraint = config.resourceConstraints.find(c => c.resourceName === r);
                        if (!constraint) return true;
                        if (constraint.allowedGradeIds.length === 0 && constraint.allowedWingIds.length === 0) return true;
                        const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                        const targetSec = config.sections.find(s => s.id === targetSecId);
                        if (!targetSec) return false;
                        return constraint.allowedGradeIds.includes(targetSec.gradeId) || 
                               constraint.allowedWingIds.includes(targetSec.wingId);
                      }).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 2 (Optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                    <select value={selLab2TeacherId} onChange={e => setSelLab2TeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                    <select value={selLab2TechnicianId} onChange={e => setSelLab2TechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                    <select value={selLab2Subject} onChange={e => setSelLab2Subject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Subject...</option>
                      {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                    <select value={selLab2Room} onChange={e => setSelLab2Room(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Assign Room...</option>
                      {config.rooms.filter(r => {
                        const constraint = config.resourceConstraints.find(c => c.resourceName === r);
                        if (!constraint) return true;
                        if (constraint.allowedGradeIds.length === 0 && constraint.allowedWingIds.length === 0) return true;
                        const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                        const targetSec = config.sections.find(s => s.id === targetSecId);
                        if (!targetSec) return false;
                        return constraint.allowedGradeIds.includes(targetSec.gradeId) || 
                               constraint.allowedWingIds.includes(targetSec.wingId);
                      }).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4">
                <p className="text-[9px] font-black text-[#001f3f] dark:text-[#d4af37] uppercase tracking-[0.2em]">Lab Group 3 (Optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Subject Teacher</label>
                    <select value={selLab3TeacherId} onChange={e => setSelLab3TeacherId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Technician</label>
                    <select value={selLab3TechnicianId} onChange={e => setSelLab3TechnicianId(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Staff...</option>
                      {users.filter(u => !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Subject</label>
                    <select value={selLab3Subject} onChange={e => setSelLab3Subject(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Select Subject...</option>
                      {config.subjects.filter(s => s.name.toLowerCase().includes('lab') || s.name.toLowerCase().includes('science') || s.name.toLowerCase().includes('physics') || s.name.toLowerCase().includes('chemistry') || s.name.toLowerCase().includes('biology') || s.name.toLowerCase().includes('computer')).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] font-black text-slate-400 uppercase tracking-widest ml-2">Lab Room</label>
                    <select value={selLab3Room} onChange={e => setSelLab3Room(e.target.value)} className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl text-[10px] font-black uppercase outline-none border border-slate-200 dark:border-slate-700">
                      <option value="">Assign Room...</option>
                      {config.rooms.filter(r => {
                        const constraint = config.resourceConstraints.find(c => c.resourceName === r);
                        if (!constraint) return true;
                        if (constraint.allowedGradeIds.length === 0 && constraint.allowedWingIds.length === 0) return true;
                        const targetSecId = assigningSlot?.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                        const targetSec = config.sections.find(s => s.id === targetSecId);
                        if (!targetSec) return false;
                        return constraint.allowedGradeIds.includes(targetSec.gradeId) || 
                               constraint.allowedWingIds.includes(targetSec.wingId);
                      }).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Secondary Section (Optional)</label>
                <select value={selLabSection2Id} onChange={e => setSelLabSection2Id(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                  <option value="">None (Single Section)</option>
                  {config.sections.filter(s => s.id !== (assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : ''))).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </div>
              
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                <p className="text-[10px] font-black text-amber-600 uppercase italic">Note: Lab periods are automatically assigned as a double period (2 consecutive slots). Multiple groups will be assigned to the same section(s) simultaneously.</p>
              </div>
            </div>
          )}
          {assignmentType === 'POOL' && (
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Grade Pool Template</label>
              <select value={selPoolId} onChange={e => setSelPoolId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                <option value="">Select Template...</option>
                {config.combinedBlocks?.filter(b => {
                  const targetSecId = assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : '');
                  const targetSec = config.sections.find(s => s.id === targetSecId);
                  if (!targetSec) return false;
                  const targetGradeName = config.grades.find(g => g.id === targetSec.gradeId)?.name;
                  const blockGradeName = config.grades.find(g => g.id === b.gradeId)?.name;
                  return targetGradeName === blockGradeName || (b.sectionIds && b.sectionIds.includes(targetSec.id));
                }).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            </div>
          )}
          {assignmentType === 'ACTIVITY' && (
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-4">Extra Curricular Rule</label>
              <select value={selActivityId} onChange={e => setSelActivityId(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-2 border-transparent focus:border-amber-400 transition-all">
                <option value="">Select Rule...</option>
                {config.extraCurricularRules?.filter(r => (r.sectionIds || []).includes(assigningSlot.sectionId || selAssignSectionId || (viewMode === 'SECTION' ? selectedTargetId : ''))).map(r => <option key={r.id} value={r.id}>{r.title || r.subject}</option>)}
              </select>
            </div>
          )}
        </div>

        {currentClash && (
          <div className="p-5 bg-rose-50 border-2 border-rose-200 rounded-3xl animate-pulse">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest leading-tight">Institutional Policy Conflict Detected</p>
            </div>
            <p className="text-[11px] font-bold text-rose-500 mt-3 italic">“{currentClash}”</p>
            
            <button 
              onClick={() => {
                setAiResolutionModal({
                  conflict: currentClash,
                  source: {
                    teacherId: selAssignTeacherId,
                    sectionId: assigningSlot.sectionId || selAssignSectionId,
                    subject: selAssignSubject,
                    type: assignmentType
                  },
                  target: {
                    day: assigningSlot.day || selAssignDay,
                    slotId: assigningSlot.slotId || selAssignSlotId
                  }
                });
                setAssigningSlot(null);
              }}
              className="mt-4 w-full py-2 bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-sm hover:bg-rose-700 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3 h-3" /> Resolve with AI
            </button>
          </div>
        )}

        <div className="pt-6 space-y-4">
          <button 
            onClick={handleQuickAssign} 
            disabled={!isQuickAssignValid}
            className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl transition-all active:scale-95 ${!isQuickAssignValid ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-[#001f3f] text-[#d4af37] hover:bg-slate-950'}`}
          >
            Authorize Allocation
          </button>
          <button onClick={() => setAssigningSlot(null)} className="w-full text-slate-400 font-black text-[11px] uppercase tracking-widest hover:text-rose-500 transition-colors">Abort Changes</button>
        </div>
      </div>
    </div>
  );
};

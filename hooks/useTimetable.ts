
import { useState, useCallback } from 'react';
import { TimeTableEntry, DUMMY_TIMETABLE } from '../types.ts';

export const useTimetable = (isSandbox: boolean) => {
  const [timetable, setTimetable] = useState<TimeTableEntry[]>(DUMMY_TIMETABLE);
  const [timetableDraft, setTimetableDraft] = useState<TimeTableEntry[]>([]);
  
  const [sTimetable, setSTimetable] = useState<TimeTableEntry[]>([]);
  const [sTimetableDraft, setSTimetableDraft] = useState<TimeTableEntry[]>([]);

  const dTimetable = isSandbox ? sTimetable : timetable;
  const dTimetableDraft = isSandbox ? sTimetableDraft : timetableDraft;

  const setDTimetable = isSandbox ? setSTimetable : setTimetable;
  const setDTimetableDraft = isSandbox ? setSTimetableDraft : setTimetableDraft;

  const enterSandbox = useCallback((liveTimetable: TimeTableEntry[], liveDraft: TimeTableEntry[]) => {
    setSTimetable([...liveTimetable]);
    setSTimetableDraft([...liveDraft]);
  }, []);

  return {
    timetable: dTimetable,
    timetableDraft: dTimetableDraft,
    setTimetable: setDTimetable,
    setTimetableDraft: setDTimetableDraft,
    liveTimetable: timetable,
    liveTimetableDraft: timetableDraft,
    setLiveTimetable: setTimetable,
    setLiveTimetableDraft: setTimetableDraft,
    enterSandbox
  };
};

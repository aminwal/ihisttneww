
import { useState, useCallback } from 'react';
import { AttendanceRecord } from '../types.ts';
import { DUMMY_ATTENDANCE } from '../constants.ts';

export const useAttendance = (isSandbox: boolean) => {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(DUMMY_ATTENDANCE);
  const [sAttendance, setSAttendance] = useState<AttendanceRecord[]>([]);

  const dAttendance = isSandbox ? sAttendance : attendance;
  const setDAttendance = isSandbox ? setSAttendance : setAttendance;

  const enterSandbox = useCallback((liveAttendance: AttendanceRecord[]) => {
    setSAttendance([...liveAttendance]);
  }, []);

  return {
    attendance: dAttendance,
    setAttendance: setDAttendance,
    liveAttendance: attendance,
    setLiveAttendance: setAttendance,
    enterSandbox
  };
};

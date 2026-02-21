
import { useState, useCallback } from 'react';
import { TeacherAssignment } from '../types.ts';

export const useTeacherAssignments = (isSandbox: boolean) => {
  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignment[]>([]);
  const [sTeacherAssignments, setSTeacherAssignments] = useState<TeacherAssignment[]>([]);

  const dTeacherAssignments = isSandbox ? sTeacherAssignments : teacherAssignments;
  const setDTeacherAssignments = isSandbox ? setSTeacherAssignments : setTeacherAssignments;

  const enterSandbox = useCallback((liveAssignments: TeacherAssignment[]) => {
    setSTeacherAssignments([...liveAssignments]);
  }, []);

  return {
    teacherAssignments: dTeacherAssignments,
    setTeacherAssignments: setDTeacherAssignments,
    liveTeacherAssignments: teacherAssignments,
    setLiveTeacherAssignments: setTeacherAssignments,
    enterSandbox
  };
};


export enum UserRole {
  ADMIN = 'ADMIN',
  INCHARGE_ALL = 'INCHARGE_ALL',
  INCHARGE_PRIMARY = 'INCHARGE_PRIMARY',
  INCHARGE_SECONDARY = 'INCHARGE_SECONDARY',
  TEACHER_PRIMARY = 'TEACHER_PRIMARY',
  TEACHER_SECONDARY = 'TEACHER_SECONDARY',
  TEACHER_SENIOR_SECONDARY = 'TEACHER_SENIOR_SECONDARY',
  ADMIN_STAFF = 'ADMIN_STAFF'
}

export enum SubjectCategory {
  CORE = 'CORE',
  LANGUAGE_2ND = 'LANGUAGE_2ND',
  LANGUAGE_2ND_SENIOR = 'LANGUAGE_2ND_SENIOR',
  LANGUAGE_3RD = 'LANGUAGE_3RD',
  RME = 'RME'
}

export interface User {
  id: string;
  employeeId: string;
  password?: string;
  name: string;
  role: UserRole;
  secondaryRoles?: UserRole[]; 
  email: string;
  classTeacherOf?: string;
  expertise?: string[];
  isResigned?: boolean;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  date: string;
  checkIn: string;
  checkOut?: string;
  isManual?: boolean;
  isLate?: boolean;
  reason?: string;
  location?: {
    lat: number;
    lng: number;
  };
}

export type SectionType = 'PRIMARY' | 'SECONDARY_BOYS' | 'SECONDARY_GIRLS' | 'SENIOR_SECONDARY_BOYS' | 'SENIOR_SECONDARY_GIRLS';

export interface TimeSlot {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}

export interface TimeTableEntry {
  id: string;
  section: SectionType;
  className: string;
  day: string;
  slotId: number;
  subject: string;
  subjectCategory: SubjectCategory;
  teacherId: string;
  teacherName: string;
  date?: string; 
  isSubstitution?: boolean; 
}

export interface SubstitutionRecord {
  id: string;
  date: string;
  slotId: number;
  className: string;
  subject: string;
  absentTeacherId: string;
  absentTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  section: SectionType;
  isArchived?: boolean;
}

export interface SchoolClass {
  id: string;
  name: string;
  section: SectionType;
}

export interface Subject {
  id: string;
  name: string;
  category: SubjectCategory;
}

export interface SchoolConfig {
  classes: SchoolClass[];
  subjects: Subject[];
  hideTimetableFromTeachers?: boolean;
}

export interface SubjectLoad {
  subject: string;
  periods: number;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  grade: string;
  loads: SubjectLoad[]; 
  targetSections?: string[];
}

export interface SchoolNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'SUBSTITUTION' | 'ATTENDANCE' | 'ANNOUNCEMENT';
  read: boolean;
}

export type AppTab = 'dashboard' | 'history' | 'users' | 'timetable' | 'substitutions' | 'config' | 'assignments' | 'deployment' | 'reports' | 'profile';

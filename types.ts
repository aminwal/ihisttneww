
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
  phone_number?: string; // New: For WhatsApp integration
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
  room?: string;
  date?: string; 
  isSubstitution?: boolean; 
  blockId?: string;
  blockName?: string;
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

export interface CombinedBlock {
  id: string;
  name: string;
  sectionNames: string[];
  allocations: {
    teacherId: string;
    teacherName: string;
    subject: string;
    room?: string;
  }[];
}

export interface SchoolConfig {
  classes: SchoolClass[];
  subjects: Subject[];
  combinedBlocks: CombinedBlock[];
  rooms: string[];
  hideTimetableFromTeachers?: boolean;
}

export interface SubjectLoad {
  subject: string;
  periods: number;
  room?: string;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  grade: string;
  loads: SubjectLoad[]; 
  targetSections?: string[];
  groupPeriods?: number;
}

export interface SchoolNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'SUBSTITUTION' | 'ATTENDANCE' | 'ANNOUNCEMENT';
  read: boolean;
}

export type AppTab = 'dashboard' | 'history' | 'users' | 'timetable' | 'substitutions' | 'config' | 'assignments' | 'groups' | 'deployment' | 'reports' | 'profile' | 'batch_timetable';
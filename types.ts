
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
  phone_number?: string; 
  telegram_chat_id?: string;
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

export interface SchoolWing {
  id: string;
  name: string;
  sectionType: SectionType;
  color?: string;
}

export interface SchoolGrade {
  id: string;
  name: string;
  wingId: string;
}

export interface SchoolSection {
  id: string;
  name: string;
  gradeId: string;
  wingId: string;
  fullName: string;
}

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
  wingId: string;
  gradeId: string;
  sectionId: string;
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
  wingId: string; 
  gradeId: string; 
  sectionId: string;
  className: string;
  subject: string;
  absentTeacherId: string;
  absentTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  section: SectionType;
  isArchived?: boolean;
}

export interface Subject {
  id: string;
  name: string;
  category: SubjectCategory;
}

export interface CombinedBlock {
  id: string;
  title: string;      
  heading: string;    
  gradeId: string; 
  sectionIds: string[]; 
  weeklyPeriods: number;
  allocations: {
    teacherId: string;
    teacherName: string;
    subject: string;
    room?: string;
  }[];
}

export interface ChangeLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface SchoolConfig {
  wings: SchoolWing[];
  grades: SchoolGrade[];
  sections: SchoolSection[];
  classes: any[]; 
  subjects: Subject[];
  combinedBlocks: CombinedBlock[];
  rooms: string[];
  hideTimetableFromTeachers?: boolean;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  attendanceOTP?: string; 
  telegramBotToken?: string;
  telegramBotUsername?: string; 
  slotDefinitions?: Record<SectionType, TimeSlot[]>;
}

export interface SubjectLoad {
  subject: string;
  periods: number;
  room?: string;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  gradeId: string; 
  loads: SubjectLoad[]; 
  targetSectionIds?: string[];
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

export type AppTab = 'dashboard' | 'history' | 'users' | 'timetable' | 'substitutions' | 'config' | 'assignments' | 'groups' | 'deployment' | 'reports' | 'profile' | 'batch_timetable' | 'otp' | 'handbook';

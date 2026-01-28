
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
  role: UserRole | string;
  secondaryRoles?: (UserRole | string)[]; 
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
  isManual?: boolean; 
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
  lastNotifiedAt?: string; 
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

export interface ExtraCurricularRule {
  id: string;
  subject: string;
  teacherId: string;
  room: string;
  sectionIds: string[];
  periodsPerWeek: number;
}

export interface RoleLoadPolicy {
  baseTarget: number;
  substitutionCap: number;
}

export type PrintMode = 'CLASS' | 'STAFF' | 'ROOM' | 'MASTER';
export type PageSize = 'a4' | 'a3' | 'letter' | 'legal';

export interface PrintElement {
  id: string;
  type: 'STATIC_TEXT' | 'DYNAMIC_BRICK' | 'IMAGE';
  content: string; 
  style: {
    fontSize: number;
    fontWeight: 'normal' | 'bold' | '900';
    textAlign: 'left' | 'center' | 'right';
    color: string;
    italic: boolean;
    uppercase: boolean;
    tracking: string;
    width?: number; 
    height?: number; 
    marginTop?: number;
    marginBottom?: number;
    opacity?: number; 
    grayscale?: boolean; 
  };
}

export interface PrintTemplate {
  id: PrintMode;
  header: PrintElement[];
  footer: PrintElement[];
  tableStyles: {
    pageSize: PageSize; 
    cellPadding: number;
    fontSize: number;
    rowHeight: number;
    borderWidth: number;
    borderColor: string;
    headerBg: string;
    headerTextColor: string; 
    stripeRows: boolean; 
    tableWidthPercent: number;
    pageMargins: number; 
  };
  visibility: {
    showRoom: boolean;
    showStaffId: boolean;
    showSubjectCategory: boolean;
    showBlockIdentity: boolean;
    showTeacherName: boolean;
  };
}

export interface PrintConfig {
  templates: Record<PrintMode, PrintTemplate>;
  activeVariant: 'FORMAL' | 'ECO' | 'INTERNAL';
}

export type AppTab = 'dashboard' | 'history' | 'users' | 'timetable' | 'substitutions' | 'config' | 'assignments' | 'groups' | 'extra_curricular' | 'deployment' | 'reports' | 'profile' | 'batch_timetable' | 'otp' | 'handbook' | 'control_center' | 'sandbox_control';

export type PermissionsConfig = Record<string, AppTab[]>;

export interface SchoolConfig {
  wings: SchoolWing[];
  grades: SchoolGrade[];
  sections: SchoolSection[];
  classes: any[]; 
  subjects: Subject[];
  combinedBlocks: CombinedBlock[];
  extraCurricularRules?: ExtraCurricularRule[];
  rooms: string[];
  hideTimetableFromTeachers?: boolean;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  attendanceOTP?: string; 
  telegramBotToken?: string;
  telegramBotUsername?: string; 
  slotDefinitions?: Record<SectionType, TimeSlot[]>;
  permissions?: PermissionsConfig;
  customRoles?: string[]; 
  loadPolicies?: Record<string, RoleLoadPolicy>;
  printConfig?: PrintConfig;
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
  anchorSubject?: string;
}

export interface SchoolNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'SUBSTITUTION' | 'ATTENDANCE' | 'ANNOUNCEMENT';
  read: boolean;
}

export interface SandboxLog {
  id: string;
  timestamp: string;
  action: string;
  payload: any;
}

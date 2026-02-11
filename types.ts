
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

export type ResponsibilityBadge = 'HOD' | 'EXAM_COORDINATOR';
export type ResponsibilityScope = 'GLOBAL' | 'PRIMARY' | 'SECONDARY' | 'SENIOR_SECONDARY';

export interface InstitutionalResponsibility {
  id: string;
  badge: ResponsibilityBadge;
  target: string; // Subject Name for HOD, 'ASSESSMENT' for Coordinator
  scope: ResponsibilityScope;
}

export interface User {
  id: string;
  employeeId: string;
  password?: string;
  name: string;
  role: UserRole | string;
  secondaryRoles?: (UserRole | string)[]; 
  featureOverrides?: string[]; 
  responsibilities?: InstitutionalResponsibility[]; 
  email: string;
  phone_number?: string; 
  telegram_chat_id?: string;
  classTeacherOf?: string; 
  expertise?: string[];
  isResigned?: boolean;
  ai_authorized?: boolean; 
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

export interface GradeSuspension {
  id: string;
  gradeId: string;
  date: string;
  reason: string;
}

export interface RoleLoadPolicy {
  baseTarget: number;
  substitutionCap: number;
}

export type PrintMode = 'CLASS' | 'STAFF' | 'ROOM' | 'MASTER';
export type PageSize = 'a4' | 'a3' | 'letter';

export type AppTab = 
  | 'dashboard' 
  | 'timetable' 
  | 'batch_timetable' 
  | 'history' 
  | 'substitutions' 
  | 'users' 
  | 'config' 
  | 'assignments' 
  | 'groups' 
  | 'extra_curricular' 
  | 'deployment' 
  | 'reports' 
  | 'profile' 
  | 'otp' 
  | 'handbook' 
  | 'control_center' 
  | 'sandbox_control' 
  | 'occupancy'
  | 'ai_analytics'
  | 'lesson_architect'
  | 'exam_preparer';

export type FeaturePower = 
  | 'can_edit_attendance' 
  | 'can_assign_proxies' 
  | 'can_edit_timetable_live'
  | 'can_export_sensitive_reports'
  | 'can_manage_personnel'
  | 'can_override_geolocation'; 

export interface SchoolConfig {
  wings: SchoolWing[];
  grades: SchoolGrade[];
  sections: SchoolSection[];
  classes: any[];
  subjects: Subject[];
  rooms: string[];
  combinedBlocks: CombinedBlock[];
  extraCurricularRules: ExtraCurricularRule[];
  gradeSuspensions: GradeSuspension[];
  latitude: number;
  longitude: number;
  radiusMeters: number;
  attendanceOTP?: string;
  autoRotateOtp?: boolean;
  lastOtpRotation?: string;
  telegramBotToken?: string;
  telegramBotUsername?: string;
  slotDefinitions: Record<string, TimeSlot[]>;
  permissions: PermissionsConfig;
  featurePermissions?: Record<string, FeaturePower[]>; 
  loadPolicies: Record<string, RoleLoadPolicy>;
  printConfig: PrintConfig;
  customRoles?: string[];
  examDutyUserIds?: string[];
  examTypes?: string[];
  questionTypes?: string[];
}

export type PermissionsConfig = Record<string, AppTab[]>;

export interface SchoolNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface SandboxLog {
  id: string;
  timestamp: string;
  action: string;
  payload: any;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  gradeId: string;
  loads: SubjectLoad[];
  targetSectionIds: string[];
  groupPeriods: number;
  anchorSubject?: string;
}

export interface SubjectLoad {
  subject: string;
  periods: number;
  room?: string;
}

export interface PrintConfig {
  templates: Record<PrintMode, PrintTemplate>;
  activeVariant: 'FORMAL' | 'MODERN';
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

export interface PrintElement {
  id: string;
  type: 'STATIC_TEXT' | 'DYNAMIC_BRICK' | 'IMAGE';
  content: string;
  style: {
    fontSize: number;
    fontWeight: string;
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

export interface WorksheetQuestion {
  id: string;
  type: string;
  text: string;
  options?: string[];
  answer: string;
  tier: 'SUPPORT' | 'CORE' | 'EXTENSION';
}

export interface Worksheet {
  title: string;
  questions: WorksheetQuestion[];
}

export interface LessonPlan {
  title: string;
  objectives: string[];
  procedure: {
    step: string;
    description: string;
    duration: string;
  }[];
  differentiation: {
    sen: string;
    gt: string;
  };
}

export interface SavedPlanRecord {
  id?: string;
  teacher_id: string;
  teacher_name: string;
  date: string;
  grade_id: string;
  section_id?: string;
  subject: string;
  topic: string;
  plan_data: LessonPlan;
  is_shared: boolean;
  created_at?: string;
}

export interface ExamQuestion {
  id: string;
  text: string;
  type: string;
  options?: string[];
  answer?: string;
  marks: number;
}

export interface ExamSection {
  title: string;
  questions: ExamQuestion[];
}

export interface ExamPaper {
  id: string;
  authorId: string;
  title: string;
  type: string;
  subject: string;
  grade_id: string;
  total_marks: number;
  duration_minutes: number;
  sections: ExamSection[];
  version: string;
  status: string;
}

export interface ExamBlueprintRow {
  id: string;
  sectionTitle: string;
  type: string;
  count: number;
  toAttempt?: number;
  marksPerQuestion: number;
  bloomCategory: string;
}

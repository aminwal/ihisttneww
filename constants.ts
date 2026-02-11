
import { UserRole, User, TimeSlot, SchoolConfig, SubjectCategory, TimeTableEntry, AppTab, RoleLoadPolicy, AttendanceRecord, SubstitutionRecord, PrintConfig, PrintTemplate, PrintElement } from './types.ts';

export const SCHOOL_NAME = "Ibn Al Hytham Islamic School";
export const SCHOOL_LOGO_BASE64 = "https://i.imgur.com/SmEY27a.png";
export const TARGET_LAT = 26.225603;
export const TARGET_LNG = 50.519723;
export const RADIUS_METERS = 60; 

export const LATE_THRESHOLD_HOUR = 7;
export const LATE_THRESHOLD_MINUTE = 20;

export const DUMMY_ATTENDANCE: AttendanceRecord[] = [];
export const DUMMY_TIMETABLE: TimeTableEntry[] = [];
export const DUMMY_SUBSTITUTIONS: SubstitutionRecord[] = [];

const createDefaultTemplate = (mode: string): PrintTemplate => ({
  id: mode as any,
  header: [
    {
      id: 'logo-init', type: 'IMAGE', content: SCHOOL_LOGO_BASE64,
      style: { fontSize: 0, fontWeight: 'normal', textAlign: 'center', color: '', italic: false, uppercase: false, tracking: 'normal', width: 60, height: 60, marginBottom: 10, opacity: 1, grayscale: false }
    },
    { 
      id: 'h1', type: 'DYNAMIC_BRICK', content: '[SCHOOL_NAME]', 
      style: { fontSize: 24, fontWeight: '900', textAlign: 'center', color: '#001f3f', italic: true, uppercase: true, tracking: 'tight' } 
    },
    { 
      id: 'h2', type: 'DYNAMIC_BRICK', content: 'Academic Year 2026-2027', 
      style: { fontSize: 10, fontWeight: 'bold', textAlign: 'center', color: '#d4af37', italic: false, uppercase: true, tracking: '[0.4em]' } 
    },
    { 
      id: 'h3', type: 'DYNAMIC_BRICK', content: '[ENTITY_NAME] - Schedule', 
      style: { fontSize: 14, fontWeight: '900', textAlign: 'center', color: '#001f3f', italic: true, uppercase: true, tracking: 'tight' } 
    }
  ],
  footer: [
    { 
      id: 'f1', type: 'STATIC_TEXT', content: 'Please report any discrepancies to the Administrative Office within 24 hours. Computer generated document.', 
      style: { fontSize: 8, fontWeight: 'normal', textAlign: 'left', color: '#64748b', italic: true, uppercase: false, tracking: 'normal' } 
    },
    { 
      id: 'f2', type: 'DYNAMIC_BRICK', content: 'Principal Signature _________________', 
      style: { fontSize: 10, fontWeight: 'bold', textAlign: 'right', color: '#001f3f', italic: false, uppercase: true, tracking: 'widest' } 
    }
  ],
  tableStyles: {
    pageSize: 'a4',
    cellPadding: 4,
    fontSize: 9,
    rowHeight: 18,
    borderWidth: 2,
    borderColor: '#001f3f',
    headerBg: '#001f3f',
    headerTextColor: '#ffffff',
    stripeRows: true,
    tableWidthPercent: 100,
    pageMargins: 15
  },
  visibility: {
    showRoom: true,
    showStaffId: false,
    showSubjectCategory: false,
    showBlockIdentity: true,
    showTeacherName: true
  }
});

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  templates: {
    CLASS: createDefaultTemplate('CLASS'),
    STAFF: createDefaultTemplate('STAFF'),
    ROOM: createDefaultTemplate('ROOM'),
    MASTER: {
      ...createDefaultTemplate('MASTER'),
      tableStyles: { pageSize: 'a3', cellPadding: 2, fontSize: 8, rowHeight: 15, borderWidth: 3, borderColor: '#001f3f', headerBg: '#f1f5f9', headerTextColor: '#001f3f', stripeRows: true, tableWidthPercent: 100, pageMargins: 15 }
    }
  },
  activeVariant: 'FORMAL'
};

export const INITIAL_USERS: User[] = [
  { id: 'u-admin-001', employeeId: 'emp001', password: 'password123', name: 'System Admin', role: UserRole.ADMIN, email: 'admin@school.com' },
  { id: 'u-inc-001', employeeId: 'emp002', password: 'password123', name: 'Sarah Ahmed', role: UserRole.INCHARGE_PRIMARY, email: 'sarah@school.com' },
  { id: 'u-inc-002', employeeId: 'emp003', password: 'password123', name: 'Mohammed Khan', role: UserRole.INCHARGE_SECONDARY, email: 'mohammed@school.com' },
  { id: 'u-t-001', employeeId: 'emp101', password: 'password123', name: 'John Doe', role: UserRole.TEACHER_PRIMARY, email: 'john@school.com', expertise: ['ENGLISH', 'SOCIAL STUDIES'] },
  { id: 'u-t-002', employeeId: 'emp102', password: 'password123', name: 'Jane Smith', role: UserRole.TEACHER_PRIMARY, email: 'jane@school.com', expertise: ['MATHEMATICS'] },
  { id: 'u-t-003', employeeId: 'emp103', password: 'password123', name: 'Ali Redha', role: UserRole.TEACHER_SECONDARY, email: 'ali@school.com', expertise: ['ARABIC', 'ISLAMIC STUDIES'] },
  { id: 'u-t-004', employeeId: 'emp104', password: 'password123', name: 'Fatima Hassan', role: UserRole.TEACHER_SECONDARY, email: 'fatima@school.com', expertise: ['SCIENCE', 'BIOLOGY'] },
  { id: 'u-t-005', employeeId: 'emp105', password: 'password123', name: 'Rahul Sharma', role: UserRole.TEACHER_SENIOR_SECONDARY, email: 'rahul@school.com', expertise: ['PHYSICS', 'MATHEMATICS'] },
  { id: 'u-t-006', employeeId: 'emp106', password: 'password123', name: 'Zainab Yusuf', role: UserRole.TEACHER_PRIMARY, email: 'zainab@school.com', expertise: ['URDU'] },
  { id: 'u-t-007', employeeId: 'emp107', password: 'password123', name: 'David Wilson', role: UserRole.TEACHER_SECONDARY, email: 'david@school.com', expertise: ['ICT', 'COMPUTER SCIENCE'] },
];

export const DEFAULT_PERMISSIONS: Record<string, AppTab[]> = {
  [UserRole.ADMIN]: ['dashboard', 'history', 'users', 'timetable', 'substitutions', 'config', 'assignments', 'groups', 'extra_curricular', 'deployment', 'reports', 'profile', 'batch_timetable', 'otp', 'handbook', 'control_center', 'sandbox_control', 'occupancy', 'ai_analytics', 'lesson_architect', 'exam_preparer'],
  [UserRole.INCHARGE_ALL]: ['dashboard', 'history', 'users', 'timetable', 'substitutions', 'assignments', 'groups', 'extra_curricular', 'reports', 'profile', 'batch_timetable', 'otp', 'handbook', 'occupancy', 'ai_analytics', 'lesson_architect', 'exam_preparer'],
  [UserRole.INCHARGE_PRIMARY]: ['dashboard', 'history', 'users', 'timetable', 'substitutions', 'assignments', 'groups', 'extra_curricular', 'reports', 'profile', 'batch_timetable', 'otp', 'handbook', 'occupancy', 'ai_analytics', 'lesson_architect', 'exam_preparer'],
  [UserRole.INCHARGE_SECONDARY]: ['dashboard', 'history', 'users', 'timetable', 'substitutions', 'assignments', 'groups', 'extra_curricular', 'reports', 'profile', 'batch_timetable', 'otp', 'handbook', 'occupancy', 'ai_analytics', 'lesson_architect', 'exam_preparer'],
  [UserRole.TEACHER_PRIMARY]: ['dashboard', 'history', 'timetable', 'substitutions', 'profile', 'lesson_architect', 'exam_preparer'],
  [UserRole.TEACHER_SECONDARY]: ['dashboard', 'history', 'timetable', 'substitutions', 'profile', 'lesson_architect', 'exam_preparer'],
  [UserRole.TEACHER_SENIOR_SECONDARY]: ['dashboard', 'history', 'timetable', 'substitutions', 'profile', 'lesson_architect', 'exam_preparer'],
  [UserRole.ADMIN_STAFF]: ['dashboard', 'history', 'profile', 'otp']
};

export const DEFAULT_LOAD_POLICIES: Record<string, RoleLoadPolicy> = {
  [UserRole.ADMIN]: { baseTarget: 0, substitutionCap: 0 },
  [UserRole.INCHARGE_ALL]: { baseTarget: 10, substitutionCap: 2 },
  [UserRole.INCHARGE_PRIMARY]: { baseTarget: 12, substitutionCap: 2 },
  [UserRole.INCHARGE_SECONDARY]: { baseTarget: 12, substitutionCap: 2 },
  [UserRole.TEACHER_PRIMARY]: { baseTarget: 28, substitutionCap: 5 },
  [UserRole.TEACHER_SECONDARY]: { baseTarget: 26, substitutionCap: 5 },
  [UserRole.TEACHER_SENIOR_SECONDARY]: { baseTarget: 22, substitutionCap: 3 },
  [UserRole.ADMIN_STAFF]: { baseTarget: 0, substitutionCap: 0 }
};

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

export const PRIMARY_SLOTS: TimeSlot[] = [
  { id: 1, label: 'Period 1', startTime: '07:20', endTime: '08:00' },
  { id: 2, label: 'Period 2', startTime: '08:00', endTime: '08:40' },
  { id: 3, label: 'Period 3', startTime: '08:40', endTime: '09:20' },
  { id: 4, label: 'Period 4', startTime: '09:20', endTime: '10:00' },
  { id: 5, label: 'Recess', startTime: '10:00', endTime: '10:20', isBreak: true },
  { id: 6, label: 'Period 5', startTime: '10:20', endTime: '11:00' },
  { id: 7, label: 'Period 6', startTime: '11:00', endTime: '11:40' },
  { id: 8, label: 'Period 7', startTime: '11:40', endTime: '12:20' },
  { id: 9, label: 'Period 8', startTime: '12:20', endTime: '13:00' },
];

export const SECONDARY_BOYS_SLOTS: TimeSlot[] = [
  { id: 1, label: 'Period 1', startTime: '07:20', endTime: '08:00' },
  { id: 2, label: 'Period 2', startTime: '08:00', endTime: '08:40' },
  { id: 3, label: 'Period 3', startTime: '08:40', endTime: '09:20' },
  { id: 4, label: 'Period 4', startTime: '09:20', endTime: '10:00' },
  { id: 5, label: 'Period 5', startTime: '10:00', endTime: '10:40' },
  { id: 6, label: 'Recess', startTime: '10:40', endTime: '11:00', isBreak: true },
  { id: 7, label: 'Period 6', startTime: '11:00', endTime: '11:40' },
  { id: 8, label: 'Period 7', startTime: '11:40', endTime: '12:20' },
  { id: 9, label: 'Period 8', startTime: '12:20', endTime: '13:00' },
  { id: 10, label: 'Period 9', startTime: '13:00', endTime: '13:40' },
];

export const SECONDARY_GIRLS_SLOTS: TimeSlot[] = [
  { id: 1, label: 'Period 1', startTime: '07:20', endTime: '08:00' },
  { id: 2, label: 'Period 2', startTime: '08:00', endTime: '08:40' },
  { id: 3, label: 'Period 3', startTime: '08:40', endTime: '09:20' },
  { id: 4, label: 'Period 4', startTime: '09:20', endTime: '10:00' },
  { id: 5, label: 'Recess', startTime: '10:00', endTime: '10:20', isBreak: true },
  { id: 6, label: 'Period 5', startTime: '10:20', endTime: '11:00' },
  { id: 7, label: 'Period 6', startTime: '11:00', endTime: '11:40' },
  { id: 8, label: 'Period 7', startTime: '11:40', endTime: '12:20' },
  { id: 9, label: 'Period 8', startTime: '12:20', endTime: '13:00' },
  { id: 10, label: 'Period 9', startTime: '13:00', endTime: '13:40' },
];

export const INITIAL_CONFIG: SchoolConfig = {
  wings: [
    { id: 'wing-p', name: 'Primary Wing', sectionType: 'PRIMARY' },
    { id: 'wing-sb', name: 'Secondary Boys', sectionType: 'SECONDARY_BOYS' },
    { id: 'wing-sg', name: 'Secondary Girls', sectionType: 'SECONDARY_GIRLS' },
  ],
  grades: [
    { id: 'grade-1', name: 'Grade I', wingId: 'wing-p' },
    { id: 'grade-2', name: 'Grade II', wingId: 'wing-p' },
    { id: 'grade-9', name: 'Grade IX', wingId: 'wing-sb' },
    { id: 'grade-10', name: 'Grade X', wingId: 'wing-sb' },
  ],
  sections: [
    { id: 'sect-1-a', name: 'A', gradeId: 'grade-1', wingId: 'wing-p', fullName: 'I A' },
    { id: 'sect-1-b', name: 'B', gradeId: 'grade-1', wingId: 'wing-p', fullName: 'I B' },
    { id: 'sect-2-a', name: 'A', gradeId: 'grade-2', wingId: 'wing-p', fullName: 'II A' },
    { id: 'sect-2-b', name: 'B', gradeId: 'grade-2', wingId: 'wing-p', fullName: 'II B' },
    { id: 'sect-9-a', name: 'A', gradeId: 'grade-9', wingId: 'wing-sb', fullName: 'IX A' },
    { id: 'sect-9-b', name: 'B', gradeId: 'grade-9', wingId: 'wing-sb', fullName: 'IX B' },
    { id: 'sect-10-a', name: 'A', gradeId: 'grade-10', wingId: 'wing-sb', fullName: 'X A' },
    { id: 'sect-10-b', name: 'B', gradeId: 'grade-10', wingId: 'wing-sb', fullName: 'X B' },
  ],
  classes: [],
  subjects: [
    { id: 's1', name: 'ENGLISH', category: SubjectCategory.CORE },
    { id: 's2', name: 'MATHEMATICS', category: SubjectCategory.CORE },
    { id: 's3', name: 'SCIENCE', category: SubjectCategory.CORE },
    { id: 's4', name: 'ARABIC', category: SubjectCategory.LANGUAGE_2ND },
    { id: 's5', name: 'SOCIAL STUDIES', category: SubjectCategory.CORE },
    { id: 's6', name: 'URDU', category: SubjectCategory.LANGUAGE_2ND },
    { id: 's7', name: 'PHYSICS', category: SubjectCategory.CORE },
    { id: 's8', name: 'ICT', category: SubjectCategory.CORE },
  ],
  combinedBlocks: [],
  extraCurricularRules: [],
  gradeSuspensions: [],
  rooms: ['ROOM 101', 'ROOM 102', 'ROOM 201', 'ROOM 202', 'ROOM IX A', 'ROOM IX B', 'ICT LAB', 'GYM'],
  latitude: TARGET_LAT,
  longitude: TARGET_LNG,
  radiusMeters: RADIUS_METERS,
  attendanceOTP: '123456',
  autoRotateOtp: false,
  lastOtpRotation: new Date().toISOString(),
  slotDefinitions: {
    'PRIMARY': PRIMARY_SLOTS,
    'SECONDARY_BOYS': SECONDARY_BOYS_SLOTS,
    'SECONDARY_GIRLS': SECONDARY_GIRLS_SLOTS,
    'SENIOR_SECONDARY_BOYS': SECONDARY_BOYS_SLOTS,
    'SENIOR_SECONDARY_GIRLS': SECONDARY_BOYS_SLOTS
  },
  permissions: DEFAULT_PERMISSIONS,
  loadPolicies: DEFAULT_LOAD_POLICIES,
  printConfig: DEFAULT_PRINT_CONFIG,
  examDutyUserIds: [],
  examTypes: ['UNIT TEST', 'MIDTERM', 'FINAL TERM', 'MOCK EXAM']
};

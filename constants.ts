
import { UserRole, User, TimeSlot, SchoolConfig, SubjectCategory, TimeTableEntry } from './types.ts';

export const SCHOOL_NAME = "Ibn Al Hytham Islamic School";
export const SCHOOL_LOGO_BASE64 = "https://i.imgur.com/SmEY27a.png";
export const TARGET_LAT = 26.225603;
export const TARGET_LNG = 50.519723;
export const RADIUS_METERS = 60; 

export const LATE_THRESHOLD_HOUR = 7;
export const LATE_THRESHOLD_MINUTE = 15;

export const INITIAL_USERS: User[] = [
  { id: 'u-admin-001', employeeId: 'emp001', password: 'password123', name: 'System Admin', role: UserRole.ADMIN, email: 'admin@school.com' },
  { id: 'u-teach-002', employeeId: 'emp002', password: 'password123', name: 'Sarah Ahmed', role: UserRole.TEACHER_PRIMARY, email: 'sarah.a@school.com', classTeacherOf: 'sect-1-a', expertise: ['English', 'EVS'] },
  { id: 'u-teach-003', employeeId: 'emp003', password: 'password123', name: 'Mohammed Khan', role: UserRole.TEACHER_SECONDARY, email: 'm.khan@school.com', expertise: ['Math', 'Physics'] },
  { id: 'u-teach-004', employeeId: 'emp004', password: 'password123', name: 'Fatima Ali', role: UserRole.TEACHER_PRIMARY, email: 'fatima.a@school.com', expertise: ['Arabic', 'Social Studies'] },
];

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
  ],
  combinedBlocks: [],
  rooms: ['ROOM 101', 'ROOM 102', 'ROOM 201', 'ROOM 202', 'ICT LAB', 'GYM'],
  latitude: TARGET_LAT,
  longitude: TARGET_LNG,
  radiusMeters: RADIUS_METERS,
  attendanceOTP: '123456',
  slotDefinitions: {
    'PRIMARY': PRIMARY_SLOTS,
    'SECONDARY_BOYS': SECONDARY_BOYS_SLOTS,
    'SECONDARY_GIRLS': SECONDARY_GIRLS_SLOTS,
    'SENIOR_SECONDARY_BOYS': SECONDARY_BOYS_SLOTS,
    'SENIOR_SECONDARY_GIRLS': SECONDARY_GIRLS_SLOTS
  }
};

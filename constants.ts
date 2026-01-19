
import { UserRole, User, TimeSlot, SchoolConfig, SubjectCategory } from './types.ts';

export const SCHOOL_NAME = "Ibn Al Hytham Islamic School";

/** 
 * UPDATED: Replaced old base64 with new direct image URL for the school logo.
 */
export const SCHOOL_LOGO_BASE64 = "https://i.imgur.com/SmEY27a.png";

// DEFAULT CAMPUS LOCATION (Admin can override this in Settings)
export const TARGET_LAT = 26.225603;
export const TARGET_LNG = 50.519723;
export const RADIUS_METERS = 60; 

export const LATE_THRESHOLD_HOUR = 7;
export const LATE_THRESHOLD_MINUTE = 15;

export const ROMAN_TO_ARABIC: Record<string, number> = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10, 'XI': 11, 'XII': 12
};

export const INITIAL_USERS: User[] = [
  { id: 'u-admin-001', employeeId: 'emp001', password: 'password123', name: 'System Admin', role: UserRole.ADMIN, email: 'admin@school.com' },
  { id: 'u-teach-002', employeeId: 'emp002', password: 'password123', name: 'Sarah Ahmed', role: UserRole.TEACHER_PRIMARY, email: 'sarah.a@school.com', classTeacherOf: 'I A', expertise: ['English', 'EVS'] },
  { id: 'u-teach-003', employeeId: 'emp003', password: 'password123', name: 'John Doe', role: UserRole.TEACHER_SECONDARY, email: 'john.d@school.com', classTeacherOf: 'IX B', expertise: ['Science', 'Math'] },
  { id: 'u-teach-004', employeeId: 'emp004', password: 'password123', name: 'Maria Khan', role: UserRole.TEACHER_SENIOR_SECONDARY, email: 'maria.k@school.com', classTeacherOf: 'XI Sci', expertise: ['Physics', 'Math'] },
  { id: 'u-inch-005', employeeId: 'emp005', password: 'password123', name: 'Robert Smith', role: UserRole.INCHARGE_PRIMARY, email: 'robert.s@school.com' },
  { id: 'u-inch-006', employeeId: 'emp006', password: 'password123', name: 'Lisa Wong', role: UserRole.INCHARGE_SECONDARY, email: 'lisa.w@school.com' },
];

export const INITIAL_CONFIG: SchoolConfig = {
  classes: [
    { id: 'c1', name: 'I A', section: 'PRIMARY' },
    { id: 'c2', name: 'I B', section: 'PRIMARY' },
    { id: 'c3', name: 'II A', section: 'PRIMARY' },
    { id: 'c4', name: 'III A', section: 'PRIMARY' },
    { id: 'c5', name: 'IX A', section: 'SECONDARY_BOYS' },
    { id: 'c6', name: 'IX B', section: 'SECONDARY_GIRLS' },
    { id: 'c7', name: 'X A', section: 'SECONDARY_BOYS' },
    { id: 'c8', name: 'XI Sci', section: 'SENIOR_SECONDARY_BOYS' },
    { id: 'c9', name: 'XII Com', section: 'SENIOR_SECONDARY_GIRLS' },
  ],
  subjects: [
    { id: 's1', name: 'ENGLISH', category: SubjectCategory.CORE },
    { id: 's2', name: 'MATHEMATICS', category: SubjectCategory.CORE },
    { id: 's3', name: 'SCIENCE', category: SubjectCategory.CORE },
    { id: 's4', name: 'SOCIAL SCIENCE', category: SubjectCategory.CORE },
    { id: 's5', name: 'PHYSICS', category: SubjectCategory.CORE },
    { id: 's6', name: 'CHEMISTRY', category: SubjectCategory.CORE },
    { id: 's7', name: 'ARABIC', category: SubjectCategory.LANGUAGE_2ND },
    { id: 's8', name: 'HINDI', category: SubjectCategory.LANGUAGE_2ND },
    { id: 's9', name: 'ISLAMIC STUDIES', category: SubjectCategory.RME },
  ],
  combinedBlocks: [],
  rooms: ['ROOM 101', 'ROOM 102', 'ROOM 201', 'ROOM 202', 'PHYSICS LAB', 'ICT LAB', 'AUDITORIUM'],
  latitude: TARGET_LAT,
  longitude: TARGET_LNG,
  radiusMeters: RADIUS_METERS,
  attendanceOTP: '123456'
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

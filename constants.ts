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
  { id: '00000000-0000-4000-8000-000000000001', employeeId: 'emp001', password: 'password123', name: 'System Admin', role: UserRole.ADMIN, email: 'admin@school.com' },
];

export const INITIAL_CONFIG: SchoolConfig = {
  classes: [],
  subjects: [],
  combinedBlocks: [],
  rooms: [],
  latitude: TARGET_LAT,
  longitude: TARGET_LNG,
  radiusMeters: RADIUS_METERS
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
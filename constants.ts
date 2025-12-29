
import { UserRole, User, TimeSlot, SchoolConfig, SubjectCategory } from './types.ts';

export const SCHOOL_NAME = "Ibn Al Hytham Islamic School";

export const TARGET_LAT = 26.225603;
export const TARGET_LNG = 50.519723;
export const RADIUS_METERS = 20;

export const LATE_THRESHOLD_HOUR = 7;
export const LATE_THRESHOLD_MINUTE = 15;

export const ROMAN_TO_ARABIC: Record<string, number> = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10, 'XI': 11, 'XII': 12
};

export const ARABIC_TO_ROMAN: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII'
};

export const INITIAL_USERS: User[] = [
  { id: '00000000-0000-4000-8000-000000000001', employeeId: 'emp001', password: 'password123', name: 'System Admin', role: UserRole.ADMIN, email: 'admin@school.com' },
  { id: '00000000-0000-4000-8000-000000000002', employeeId: 'emp002', password: 'password123', name: 'Principal', role: UserRole.INCHARGE_ALL, email: 'principal@school.com' },
  { id: '00000000-0000-4000-8000-000000000003', employeeId: 'emp003', password: 'password123', name: 'Primary Incharge', role: UserRole.INCHARGE_PRIMARY, email: 'incharge.primary@school.com' },
  { id: '00000000-0000-4000-8000-000000000101', employeeId: 'emp101', password: 'password123', name: 'Mohammed Ali', role: UserRole.TEACHER_PRIMARY, email: 'm.ali@school.com', classTeacherOf: 'IV A' },
  { id: '00000000-0000-4000-8000-000000000102', employeeId: 'emp102', password: 'password123', name: 'Fatima Zohra', role: UserRole.TEACHER_SECONDARY, email: 'f.zohra@school.com', classTeacherOf: 'X B' },
  { id: '00000000-0000-4000-8000-000000000103', employeeId: 'emp103', password: 'password123', name: 'Senior Teacher', role: UserRole.TEACHER_SENIOR_SECONDARY, email: 'senior@school.com' },
  { id: '00000000-0000-4000-8000-000000000201', employeeId: 'emp201', password: 'password123', name: 'Ahmed Registrar', role: UserRole.ADMIN_STAFF, email: 'ahmed.admin@school.com' },
];

export const INITIAL_CONFIG: SchoolConfig = {
  classes: [
    { id: 'c1', name: 'I A', section: 'PRIMARY' },
    { id: 'c2', name: 'IV A', section: 'PRIMARY' },
    { id: 'c3', name: 'IX B', section: 'SECONDARY_BOYS' },
    { id: 'c4', name: 'X B', section: 'SECONDARY_GIRLS' },
  ],
  subjects: [
    { id: 's1', name: 'Mathematics', category: SubjectCategory.CORE },
    { id: 's4', name: 'English', category: SubjectCategory.CORE },
    { id: 's5', name: 'Science', category: SubjectCategory.CORE },
    { id: 's6', name: 'Social Studies', category: SubjectCategory.CORE },
    { id: 's-bh', name: 'Bahrain History', category: SubjectCategory.CORE },
    { id: 's-cep', name: 'CEP', category: SubjectCategory.CORE },
    { id: 's-evs', name: 'EVS', category: SubjectCategory.CORE },
    { id: 's-gk', name: 'GK', category: SubjectCategory.CORE },
    { id: 's-phy', name: 'PHYSICS', category: SubjectCategory.CORE },
    { id: 's-chem', name: 'CHEMISTRY', category: SubjectCategory.CORE },
    { id: 's-bio', name: 'BIOLOGY', category: SubjectCategory.CORE },
    { id: 's-cs', name: 'COMPUTER SCIENCE', category: SubjectCategory.CORE },
    { id: 's-ip', name: 'IP', category: SubjectCategory.CORE },
    { id: 's-bst', name: 'BUSINESS STUDIES', category: SubjectCategory.CORE },
    { id: 's-eco', name: 'ECONOMICS', category: SubjectCategory.CORE },
    { id: 's-acc', name: 'ACCOUNTANCY', category: SubjectCategory.CORE },
    { id: 's-mkt', name: 'MARKETING', category: SubjectCategory.CORE },
    { id: 's-mgmt', name: 'MANAGEMENT', category: SubjectCategory.CORE },
    { id: 'l2-1', name: 'Hindi', category: SubjectCategory.LANGUAGE_2ND },
    { id: 'l2-2', name: 'Arabic', category: SubjectCategory.LANGUAGE_2ND },
    { id: 'l2-3', name: 'Urdu (2nd Lang)', category: SubjectCategory.LANGUAGE_2ND },
    { id: 'l2s-1', name: 'Hindi IX-X', category: SubjectCategory.LANGUAGE_2ND_SENIOR },
    { id: 'l2s-2', name: 'Arabic IX-X', category: SubjectCategory.LANGUAGE_2ND_SENIOR },
    { id: 'l2s-3', name: 'Urdu IX-X', category: SubjectCategory.LANGUAGE_2ND_SENIOR },
    { id: 'l2s-4', name: 'Malayalam IX-X', category: SubjectCategory.LANGUAGE_2ND_SENIOR },
    { id: 'l3-1', name: 'Urdu (3rd Lang)', category: SubjectCategory.LANGUAGE_3RD },
    { id: 'l3-2', name: 'Malayalam (3rd Lang)', category: SubjectCategory.LANGUAGE_3RD },
    { id: 'l3-3', name: 'English Core', category: SubjectCategory.LANGUAGE_3RD },
    { id: 'rme-1', name: 'Islamic Studies', category: SubjectCategory.RME },
    { id: 'rme-2', name: 'Moral Science', category: SubjectCategory.RME },
    { id: 'rme-3', name: 'Islamic Education', category: SubjectCategory.RME },
    { id: 'spec-1', name: 'Art & Craft', category: SubjectCategory.CORE },
    { id: 'spec-2', name: 'PHE', category: SubjectCategory.CORE },
    { id: 'spec-3', name: 'Library', category: SubjectCategory.CORE },
  ]
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

export const EDUCATIONAL_QUOTES = [
  { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
  { text: "Education is not preparation for life; education is life itself.", author: "John Dewey" },
  { text: "One child, one teacher, one book, one pen can change the world.", author: "Malala Yousafzai" }
];

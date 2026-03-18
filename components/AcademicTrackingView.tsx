import React, { useState, useMemo } from 'react';
import { SchoolConfig, Assessment, StudentGrade, Student, User } from '../types.ts';
import { Plus, Search, Filter, Save, CheckCircle, X, FileText, BarChart2 } from 'lucide-react';
import { generateUUID } from '../utils/idUtils.ts';

interface AcademicTrackingViewProps {
  config: SchoolConfig;
  currentUser: User | null;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

// Mock Data
const MOCK_STUDENTS: Student[] = [
  { id: 's1', admissionNumber: 'A001', firstName: 'John', lastName: 'Doe', wingId: 'w1', gradeId: 'g1', sectionId: 'sec1', gender: 'MALE' },
  { id: 's2', admissionNumber: 'A002', firstName: 'Jane', lastName: 'Smith', wingId: 'w1', gradeId: 'g1', sectionId: 'sec1', gender: 'FEMALE' },
  { id: 's3', admissionNumber: 'A003', firstName: 'Alice', lastName: 'Johnson', wingId: 'w1', gradeId: 'g1', sectionId: 'sec2', gender: 'FEMALE' },
];

const MOCK_ASSESSMENTS: Assessment[] = [
  { id: 'a1', title: 'Midterm Math Quiz', type: 'QUIZ', date: '2026-03-10', maxScore: 20, gradeId: 'g1', sectionId: 'sec1', subjectId: 'sub1', teacherId: 't1' },
];

const MOCK_GRADES: StudentGrade[] = [
  { id: 'g1', studentId: 's1', assessmentId: 'a1', score: 18, submitted: true },
  { id: 'g2', studentId: 's2', assessmentId: 'a1', score: 15, submitted: true },
];

export default function AcademicTrackingView({ config, currentUser, showToast }: AcademicTrackingViewProps) {
  const [assessments, setAssessments] = useState<Assessment[]>(MOCK_ASSESSMENTS);
  const [grades, setGrades] = useState<StudentGrade[]>(MOCK_GRADES);
  const [students] = useState<Student[]>(MOCK_STUDENTS);

  const [selectedGradeId, setSelectedGradeId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');

  const [isCreatingAssessment, setIsCreatingAssessment] = useState(false);
  const [newAssessment, setNewAssessment] = useState<Partial<Assessment>>({ type: 'QUIZ', maxScore: 100 });

  const filteredSections = useMemo(() => config.sections.filter(s => s.gradeId === selectedGradeId), [config.sections, selectedGradeId]);
  const filteredSubjects = useMemo(() => config.subjects.filter(s => s.gradeId === selectedGradeId), [config.subjects, selectedGradeId]);
  
  const filteredAssessments = useMemo(() => {
    return assessments.filter(a => 
      (!selectedGradeId || a.gradeId === selectedGradeId) &&
      (!selectedSectionId || a.sectionId === selectedSectionId) &&
      (!selectedSubjectId || a.subjectId === selectedSubjectId)
    );
  }, [assessments, selectedGradeId, selectedSectionId, selectedSubjectId]);

  const currentAssessment = assessments.find(a => a.id === selectedAssessmentId);
  const currentStudents = students.filter(s => s.gradeId === currentAssessment?.gradeId && s.sectionId === currentAssessment?.sectionId);

  const handleCreateAssessment = () => {
    if (!newAssessment.title || !newAssessment.date || !newAssessment.maxScore || !selectedGradeId || !selectedSectionId || !selectedSubjectId) {
      showToast('Please fill all required fields', 'error');
      return;
    }
    const assessment: Assessment = {
      id: generateUUID(),
      title: newAssessment.title,
      type: newAssessment.type as any,
      date: newAssessment.date,
      maxScore: newAssessment.maxScore,
      gradeId: selectedGradeId,
      sectionId: selectedSectionId,
      subjectId: selectedSubjectId,
      teacherId: currentUser?.id || 'unknown'
    };
    setAssessments([...assessments, assessment]);
    setIsCreatingAssessment(false);
    setNewAssessment({ type: 'QUIZ', maxScore: 100 });
    setSelectedAssessmentId(assessment.id);
    showToast('Assessment created successfully', 'success');
  };

  const handleGradeChange = (studentId: string, field: 'score' | 'remarks' | 'submitted', value: any) => {
    if (!currentAssessment) return;
    
    setGrades(prev => {
      const existing = prev.find(g => g.studentId === studentId && g.assessmentId === currentAssessment.id);
      if (existing) {
        return prev.map(g => g.id === existing.id ? { ...g, [field]: value } : g);
      } else {
        return [...prev, {
          id: generateUUID(),
          studentId,
          assessmentId: currentAssessment.id,
          submitted: field === 'submitted' ? value : false,
          [field]: value
        }];
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase tracking-tight">Academic Tracking</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Internal Gradebook & Submission Checklists</p>
        </div>
        <button 
          onClick={() => setIsCreatingAssessment(true)}
          className="flex items-center gap-2 bg-[#001f3f] text-[#d4af37] px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" />
          New Assessment
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Grade</label>
          <select 
            value={selectedGradeId} 
            onChange={(e) => { setSelectedGradeId(e.target.value); setSelectedSectionId(''); setSelectedSubjectId(''); setSelectedAssessmentId(''); }}
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm font-bold text-[#001f3f] dark:text-white p-3 focus:ring-2 focus:ring-[#d4af37]"
          >
            <option value="">All Grades</option>
            {config.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Section</label>
          <select 
            value={selectedSectionId} 
            onChange={(e) => { setSelectedSectionId(e.target.value); setSelectedAssessmentId(''); }}
            disabled={!selectedGradeId}
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm font-bold text-[#001f3f] dark:text-white p-3 focus:ring-2 focus:ring-[#d4af37] disabled:opacity-50"
          >
            <option value="">All Sections</option>
            {filteredSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Subject</label>
          <select 
            value={selectedSubjectId} 
            onChange={(e) => { setSelectedSubjectId(e.target.value); setSelectedAssessmentId(''); }}
            disabled={!selectedGradeId}
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm font-bold text-[#001f3f] dark:text-white p-3 focus:ring-2 focus:ring-[#d4af37] disabled:opacity-50"
          >
            <option value="">All Subjects</option>
            {filteredSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {isCreatingAssessment && (
        <div className="bg-[#001f3f]/5 dark:bg-[#001f3f]/20 p-6 rounded-2xl border border-[#001f3f]/10 dark:border-[#001f3f]/30 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase tracking-widest flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#d4af37]" />
              Create Assessment
            </h3>
            <button onClick={() => setIsCreatingAssessment(false)} className="text-slate-400 hover:text-red-500"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Title</label>
              <input type="text" value={newAssessment.title || ''} onChange={e => setNewAssessment({...newAssessment, title: e.target.value})} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm font-bold" placeholder="e.g. Midterm Exam" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Type</label>
              <select value={newAssessment.type} onChange={e => setNewAssessment({...newAssessment, type: e.target.value as any})} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm font-bold">
                <option value="QUIZ">Quiz</option>
                <option value="EXAM">Exam</option>
                <option value="PROJECT">Project</option>
                <option value="ASSIGNMENT">Assignment</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Date</label>
              <input type="date" value={newAssessment.date || ''} onChange={e => setNewAssessment({...newAssessment, date: e.target.value})} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm font-bold" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Max Score</label>
              <input type="number" value={newAssessment.maxScore || ''} onChange={e => setNewAssessment({...newAssessment, maxScore: Number(e.target.value)})} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm font-bold" />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={handleCreateAssessment} className="bg-[#001f3f] text-[#d4af37] px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-colors shadow-md">
              Save Assessment
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Assessment List */}
        <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Assessments</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredAssessments.length === 0 ? (
              <div className="text-center p-8 text-slate-400 text-sm font-medium">No assessments found.</div>
            ) : (
              filteredAssessments.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAssessmentId(a.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all border ${selectedAssessmentId === a.id ? 'bg-[#001f3f] border-[#001f3f] text-white shadow-md' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-xs font-black uppercase tracking-wider ${selectedAssessmentId === a.id ? 'text-[#d4af37]' : 'text-[#001f3f] dark:text-white'}`}>{a.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${selectedAssessmentId === a.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{a.type}</span>
                  </div>
                  <div className={`text-[10px] font-medium ${selectedAssessmentId === a.id ? 'text-white/70' : 'text-slate-500'}`}>
                    {new Date(a.date).toLocaleDateString()} • Max: {a.maxScore}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Gradebook / Checklist */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[600px]">
          {!currentAssessment ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
              <BarChart2 className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium">Select an assessment to view or enter grades</p>
            </div>
          ) : (
            <>
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-black text-[#001f3f] dark:text-white uppercase tracking-tight">{currentAssessment.title}</h3>
                  <p className="text-xs font-bold text-slate-500 mt-1">
                    {config.grades.find(g => g.id === currentAssessment.gradeId)?.name} • {config.sections.find(s => s.id === currentAssessment.sectionId)?.name} • {config.subjects.find(s => s.id === currentAssessment.subjectId)?.name}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-[#d4af37]">{currentAssessment.maxScore}</div>
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Max Score</div>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">Student</th>
                      <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 text-center w-24">Submitted</th>
                      <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 w-32">Score</th>
                      <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {currentStudents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 text-sm font-medium">No students found in this section.</td>
                      </tr>
                    ) : (
                      currentStudents.map(student => {
                        const grade = grades.find(g => g.studentId === student.id && g.assessmentId === currentAssessment.id);
                        return (
                          <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="p-4">
                              <div className="font-bold text-sm text-[#001f3f] dark:text-white">{student.firstName} {student.lastName}</div>
                              <div className="text-[10px] font-medium text-slate-500">{student.admissionNumber}</div>
                            </td>
                            <td className="p-4 text-center">
                              <button 
                                onClick={() => handleGradeChange(student.id, 'submitted', !(grade?.submitted))}
                                className={`w-6 h-6 rounded-full flex items-center justify-center mx-auto transition-colors ${grade?.submitted ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 hover:bg-slate-300'}`}
                              >
                                {grade?.submitted && <CheckCircle className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="p-4">
                              <input 
                                type="number" 
                                value={grade?.score ?? ''}
                                onChange={e => handleGradeChange(student.id, 'score', e.target.value ? Number(e.target.value) : undefined)}
                                max={currentAssessment.maxScore}
                                min={0}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-sm font-bold text-center focus:ring-2 focus:ring-[#d4af37]"
                              />
                            </td>
                            <td className="p-4">
                              <input 
                                type="text" 
                                value={grade?.remarks || ''}
                                onChange={e => handleGradeChange(student.id, 'remarks', e.target.value)}
                                placeholder="Add remark..."
                                className="w-full bg-transparent border-none text-sm font-medium text-slate-600 dark:text-slate-300 focus:ring-0 p-0 placeholder:text-slate-300 dark:placeholder:text-slate-600"
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

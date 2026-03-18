import React, { useState, useMemo } from 'react';
import { SchoolConfig, Student } from '../types.ts';
import { Search, Plus, Upload, Edit2, Trash2, UserCheck, UserX, GraduationCap, Download } from 'lucide-react';
import { generateUUID } from '../utils/idUtils.ts';

interface StudentManagementViewProps {
  config: SchoolConfig;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

// Mock Data for initial view
const MOCK_STUDENTS: Student[] = [
  {
    id: 's1',
    admissionNumber: 'ADM-2023-001',
    firstName: 'Ahmed',
    lastName: 'Ali',
    wingId: 'wing-sb',
    gradeId: 'g-9',
    sectionId: 'sec-9a',
    gender: 'MALE',
    status: 'ACTIVE'
  },
  {
    id: 's2',
    admissionNumber: 'ADM-2023-002',
    firstName: 'Fatima',
    lastName: 'Zahra',
    wingId: 'wing-sg',
    gradeId: 'g-9',
    sectionId: 'sec-9b',
    gender: 'FEMALE',
    status: 'ACTIVE'
  },
  {
    id: 's3',
    admissionNumber: 'ADM-2022-105',
    firstName: 'Omar',
    lastName: 'Hassan',
    wingId: 'wing-p',
    gradeId: 'g-4',
    sectionId: 'sec-4a',
    gender: 'MALE',
    status: 'INACTIVE'
  }
];

const StudentManagementView: React.FC<StudentManagementViewProps> = ({ config, showToast }) => {
  const [students, setStudents] = useState<Student[]>(MOCK_STUDENTS);
  const [search, setSearch] = useState('');
  const [wingFilter, setWingFilter] = useState('ALL');
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Partial<Student>>({
    admissionNumber: '',
    firstName: '',
    lastName: '',
    wingId: '',
    gradeId: '',
    sectionId: '',
    gender: 'MALE',
    status: 'ACTIVE'
  });

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchesSearch = 
        s.firstName.toLowerCase().includes(search.toLowerCase()) || 
        s.lastName.toLowerCase().includes(search.toLowerCase()) ||
        s.admissionNumber.toLowerCase().includes(search.toLowerCase());
      
      const matchesWing = wingFilter === 'ALL' || s.wingId === wingFilter;
      const matchesGrade = gradeFilter === 'ALL' || s.gradeId === gradeFilter;
      const matchesSection = sectionFilter === 'ALL' || s.sectionId === sectionFilter;

      return matchesSearch && matchesWing && matchesGrade && matchesSection;
    });
  }, [students, search, wingFilter, gradeFilter, sectionFilter]);

  const handleSave = () => {
    if (!formData.firstName || !formData.lastName || !formData.admissionNumber || !formData.sectionId) {
      showToast("Please fill in all required fields (Name, Admission No, Section).", "error");
      return;
    }

    if (editingId) {
      setStudents(prev => prev.map(s => s.id === editingId ? { ...s, ...formData } as Student : s));
      showToast("Student updated successfully.", "success");
    } else {
      const newStudent: Student = {
        ...(formData as Student),
        id: generateUUID()
      };
      setStudents(prev => [...prev, newStudent]);
      showToast("Student added successfully.", "success");
    }
    
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      admissionNumber: '',
      firstName: '',
      lastName: '',
      wingId: '',
      gradeId: '',
      sectionId: '',
      gender: 'MALE',
      status: 'ACTIVE'
    });
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (student: Student) => {
    setFormData(student);
    setEditingId(student.id);
    setIsFormVisible(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this student?")) {
      setStudents(prev => prev.filter(s => s.id !== id));
      showToast("Student deleted.", "info");
    }
  };

  const handleBulkImport = () => {
    showToast("Bulk import feature coming soon. Requires CSV parsing module.", "info");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Student Directory</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage student enrollments and assignments</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleBulkImport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </button>
          <button 
            onClick={() => { resetForm(); setIsFormVisible(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Student
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or admission number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        
        <select
          value={wingFilter}
          onChange={(e) => {
            setWingFilter(e.target.value);
            setGradeFilter('ALL');
            setSectionFilter('ALL');
          }}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
        >
          <option value="ALL">All Wings</option>
          {config.wings.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        <select
          value={gradeFilter}
          onChange={(e) => {
            setGradeFilter(e.target.value);
            setSectionFilter('ALL');
          }}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
        >
          <option value="ALL">All Grades</option>
          {config.grades
            .filter(g => wingFilter === 'ALL' || g.wingId === wingFilter)
            .map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <select
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
        >
          <option value="ALL">All Sections</option>
          {config.sections
            .filter(s => gradeFilter === 'ALL' || s.gradeId === gradeFilter)
            .map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-3 font-medium">Admission No.</th>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Gender</th>
                <th className="px-6 py-3 font-medium">Class/Section</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                    No students found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredStudents.map(student => {
                  const section = config.sections.find(s => s.id === student.sectionId);
                  return (
                    <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-slate-900 dark:text-white">
                        {student.admissionNumber}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                        {student.firstName} {student.lastName}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                        {student.gender}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                        {section?.fullName || 'Unassigned'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          student.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          student.status === 'GRADUATED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                          'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {student.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(student)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(student.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isFormVisible && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                {editingId ? 'Edit Student' : 'Add New Student'}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Admission Number *</label>
                  <input
                    type="text"
                    value={formData.admissionNumber}
                    onChange={e => setFormData({...formData, admissionNumber: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. ADM-2024-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value as any})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="GRADUATED">Graduated</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">First Name *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={e => setFormData({...formData, firstName: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Last Name *</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={e => setFormData({...formData, lastName: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={e => setFormData({...formData, gender: e.target.value as any})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={formData.dateOfBirth || ''}
                    onChange={e => setFormData({...formData, dateOfBirth: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="md:col-span-2 border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Academic Placement</h4>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Wing</label>
                  <select
                    value={formData.wingId}
                    onChange={e => setFormData({...formData, wingId: e.target.value, gradeId: '', sectionId: ''})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">Select Wing...</option>
                    {config.wings.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Grade</label>
                  <select
                    value={formData.gradeId}
                    onChange={e => setFormData({...formData, gradeId: e.target.value, sectionId: ''})}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={!formData.wingId}
                  >
                    <option value="">Select Grade...</option>
                    {config.grades.filter(g => g.wingId === formData.wingId).map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Section *</label>
                  <select
                    value={formData.sectionId}
                    onChange={e => {
                      const sect = config.sections.find(s => s.id === e.target.value);
                      if (sect) {
                        setFormData({
                          ...formData, 
                          sectionId: sect.id,
                          gradeId: sect.gradeId,
                          wingId: sect.wingId
                        });
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">Select Section...</option>
                    {config.sections
                      .filter(s => !formData.gradeId || s.gradeId === formData.gradeId)
                      .map(s => (
                      <option key={s.id} value={s.id}>{s.fullName}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {editingId ? 'Save Changes' : 'Add Student'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentManagementView;

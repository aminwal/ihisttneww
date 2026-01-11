
import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig, TimeTableEntry, TeacherAssignment } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase } from '../supabaseClient.ts';
import { ROMAN_TO_ARABIC } from '../constants.ts';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  currentUser: User;
  timetable: TimeTableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimeTableEntry[]>>;
  assignments: TeacherAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherAssignment[]>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, config, currentUser, timetable, setTimetable, assignments, setAssignments, showToast }) => {
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    employeeId: '', 
    password: '', 
    role: UserRole.TEACHER_PRIMARY, 
    secondaryRoles: [] as UserRole[],
    classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  
  // Succession Hub States
  const [successionTarget, setSuccessionTarget] = useState<User | null>(null);
  const [successorId, setSuccessorId] = useState<string>('');
  const [isProcessingSuccession, setIsProcessingSuccession] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Secondary Faculty',
    [UserRole.INCHARGE_PRIMARY]: 'Primary Incharge',
    [UserRole.INCHARGE_SECONDARY]: 'Secondary Incharge',
    [UserRole.INCHARGE_ALL]: 'Principal',
    ...(isAdmin ? { [UserRole.ADMIN]: 'Administrator' } : {}),
    [UserRole.ADMIN_STAFF]: 'Admin Staff',
  };

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      const allRoles = [u.role, ...(u.secondaryRoles || [])];
      if (roleFilter !== 'ALL' && !allRoles.includes(roleFilter as UserRole)) return false;
      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const toggleSecondaryRole = (role: UserRole) => {
    if (formData.role === role) return;
    setFormData(prev => ({
      ...prev,
      secondaryRoles: prev.secondaryRoles.includes(role)
        ? prev.secondaryRoles.filter(r => r !== role)
        : [...prev.secondaryRoles, role]
    }));
  };

  const downloadStaffTemplate = () => {
    const rolesList = Object.keys(ROLE_DISPLAY_MAP).join(',');
    const xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="sHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#001F3F" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Staff Registry">
  <Table>
   <Column ss:Width="150"/>
   <Column ss:Width="100"/>
   <Column ss:Width="180"/>
   <Column ss:Width="100"/>
   <Column ss:Width="180"/>
   <Column ss:Width="100"/>
   <Row ss:Height="25" ss:StyleID="sHeader">
    <Cell><Data ss:Type="String">FullName</Data></Cell>
    <Cell><Data ss:Type="String">EmployeeID</Data></Cell>
    <Cell><Data ss:Type="String">Email</Data></Cell>
    <Cell><Data ss:Type="String">Password</Data></Cell>
    <Cell><Data ss:Type="String">Role</Data></Cell>
    <Cell><Data ss:Type="String">ClassTeacherOf</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Ahmed Khan</Data></Cell>
    <Cell><Data ss:Type="String">emp202</Data></Cell>
    <Cell><Data ss:Type="String">a.khan@school.com</Data></Cell>
    <Cell><Data ss:Type="String">password123</Data></Cell>
    <Cell><Data ss:Type="String">TEACHER_PRIMARY</Data></Cell>
    <Cell><Data ss:Type="String">IV A</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DataValidation>
    <Range>R2C5:R500C5</Range>
    <Type>List</Type>
    <Value>&quot;${rolesList}&quot;</Value>
   </DataValidation>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ihis_faculty_template.xml");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsBulkProcessing(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const newStaff: User[] = [];
      const cloudPayload: any[] = [];

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");
        const rows = xmlDoc.getElementsByTagName("Row");

        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].getElementsByTagName("Cell");
          if (cells.length < 5) continue;

          const getCellData = (idx: number) => {
            const cell = cells[idx];
            if (!cell) return '';
            const dataNode = cell.getElementsByTagName("Data")[0] || cell.querySelector('Data');
            return dataNode?.textContent?.trim() || '';
          };

          const name = getCellData(0);
          const empId = getCellData(1);
          const email = getCellData(2);
          const pwd = getCellData(3);
          const roleRaw = getCellData(4);
          const classTeacherOf = getCellData(5);

          if (!name || !empId || !email) continue;

          const id = generateUUID();
          const role = (UserRole as any)[roleRaw] || UserRole.TEACHER_PRIMARY;

          const userObj: User = {
            id,
            name,
            employeeId: empId,
            email,
            password: pwd || 'ihis@2025',
            role,
            secondaryRoles: [],
            classTeacherOf: classTeacherOf || undefined
          };

          newStaff.push(userObj);
          cloudPayload.push({
            id: userObj.id,
            employee_id: userObj.employeeId,
            name: userObj.name,
            email: userObj.email,
            password: userObj.password,
            role: userObj.role,
            secondary_roles: [],
            class_teacher_of: userObj.classTeacherOf || null
          });
        }

        if (newStaff.length > 0) {
          if (isCloudActive) {
            const { error } = await supabase.from('profiles').upsert(cloudPayload, { onConflict: 'id' });
            if (error) throw error;
          }
          setUsers(prev => [...newStaff, ...prev]);
          showToast(`Bulk Deployment Successful: ${newStaff.length} faculty members registered.`, "success");
        } else {
          showToast("No valid records found in XML file.", "error");
        }
      } catch (err: any) {
        showToast("Bulk Sync Failed: " + err.message, "error");
      } finally {
        setIsBulkProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').update({
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          }).eq('id', editingId);
          if (error) throw error;
        }
        const updated = users.map(u => u.id === editingId ? { ...u, ...formData } : u);
        setUsers(updated);
        setEditingId(null);
        setStatus({ type: 'success', message: 'Staff profile synchronized with database.' });
      } else {
        const id = generateUUID();
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').insert({
            id,
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            secondary_roles: formData.secondaryRoles,
            class_teacher_of: formData.classTeacherOf || null
          });
          if (error) throw error;
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        setStatus({ type: 'success', message: 'New faculty credential authorized.' });
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', role: UserRole.TEACHER_PRIMARY, secondaryRoles: [], classTeacherOf: '' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Institutional Handshake Failed.' });
    }
    setTimeout(() => setStatus(null), 3000);
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({ 
      name: user.name, 
      email: user.email, 
      employeeId: user.employeeId, 
      password: user.password || '', 
      role: user.role, 
      secondaryRoles: user.secondaryRoles || [],
      classTeacherOf: user.classTeacherOf || '' 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getGradeFromClassName = (name: string) => {
    const romanMatch = name.match(/[IVX]+/);
    if (romanMatch) return `Grade ${romanMatch[0]}`;
    const digitMatch = name.match(/\d+/);
    if (digitMatch) return `Grade ${digitMatch[0]}`;
    return name;
  };

  const handleSuccessionReplace = async () => {
    if (!successionTarget || !successorId) return;
    const successor = users.find(u => u.id === successorId);
    if (!successor) return;

    setIsProcessingSuccession(true);
    try {
      const updatedTimetable = timetable.map(t => {
        if (t.teacherId === successionTarget.id) {
          return { ...t, teacherId: successor.id, teacherName: successor.name };
        }
        return t;
      });

      const updatedAssignments = assignments.map(a => {
        if (a.teacherId === successionTarget.id) {
          return { ...a, teacherId: successor.id, id: `${successor.id}-${a.grade}` };
        }
        return a;
      });

      const updatedUsers = users.map(u => u.id === successionTarget.id ? { ...u, isResigned: true } : u);

      setTimetable(updatedTimetable);
      setAssignments(updatedAssignments);
      setUsers(updatedUsers);

      showToast(`Succession authorized: ${successor.name} has inherited the duty matrix of ${successionTarget.name}.`, "success");
      setSuccessionTarget(null);
      setSuccessorId('');
    } catch (e) {
      showToast("Succession handshake failed.", "error");
    } finally {
      setIsProcessingSuccession(false);
    }
  };

  const handleFragmentationRecalibrate = async () => {
    if (!successionTarget) return;
    setIsProcessingSuccession(true);

    try {
      let currentTimetable = [...timetable];
      let currentAssignments = [...assignments];
      const departedId = successionTarget.id;
      const departedDuties = currentTimetable.filter(t => t.teacherId === departedId && !t.date); 

      let reallocatedCount = 0;
      let conflictCount = 0;

      for (const duty of departedDuties) {
        const grade = getGradeFromClassName(duty.className);
        
        const candidates = users.filter(u => {
          if (u.id === departedId || u.isResigned || u.role === UserRole.ADMIN) return false;
          const teachesInGrade = assignments.some(a => a.teacherId === u.id && a.grade === grade);
          if (!teachesInGrade) return false;
          const isBusy = currentTimetable.some(t => t.teacherId === u.id && t.day === duty.day && t.slotId === duty.slotId);
          return !isBusy;
        });

        if (candidates.length > 0) {
          const best = candidates.sort((a, b) => {
            const loadA = currentTimetable.filter(t => t.teacherId === a.id).length;
            const loadB = currentTimetable.filter(t => t.teacherId === b.id).length;
            return loadA - loadB;
          })[0];

          currentTimetable = currentTimetable.map(t => t.id === duty.id ? { ...t, teacherId: best.id, teacherName: best.name } : t);
          
          const targetAsgn = currentAssignments.find(a => a.teacherId === best.id && a.grade === grade);
          if (targetAsgn) {
            const existingLoad = targetAsgn.loads.find(l => l.subject === duty.subject);
            if (existingLoad) {
               targetAsgn.loads = targetAsgn.loads.map(l => l.subject === duty.subject ? { ...l, periods: l.periods + 1 } : l);
            } else {
               targetAsgn.loads.push({ subject: duty.subject, periods: 1 });
            }
          } else {
            currentAssignments.push({
              id: `${best.id}-${grade}`,
              teacherId: best.id,
              grade: grade,
              loads: [{ subject: duty.subject, periods: 1 }]
            });
          }
          reallocatedCount++;
        } else {
          conflictCount++;
        }
      }

      currentTimetable = currentTimetable.filter(t => t.teacherId !== departedId);
      currentAssignments = currentAssignments.filter(a => a.teacherId !== departedId);

      setTimetable(currentTimetable);
      setAssignments(currentAssignments);
      setUsers(users.map(u => u.id === departedId ? { ...u, isResigned: true } : u));

      showToast(`Recalibration complete: ${reallocatedCount} duties distributed. ${conflictCount} slots remain unassigned.`, reallocatedCount > 0 ? "success" : "warning");
      setSuccessionTarget(null);
    } catch (e) {
      showToast("Deployment recalibration failed.", "error");
    } finally {
      setIsProcessingSuccession(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase leading-none">Faculty Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">Multi-Departmental Deployment Control Center</p>
        </div>
        
        <div className="flex gap-2">
           <button onClick={downloadStaffTemplate} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-sky-600 shadow-sm hover:scale-105 transition-all" title="Download XML Template">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
           </button>
           <label className="flex items-center gap-2 bg-[#001f3f] text-[#d4af37] px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl cursor-pointer hover:bg-slate-900 transition-all">
              {isBulkProcessing ? 'Syncing...' : 'Bulk Import Faculty'}
              <input type="file" ref={fileInputRef} accept=".xml" className="hidden" onChange={handleBulkUpload} disabled={isBulkProcessing} />
           </label>
        </div>
      </div>
      
      <div className={`bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl border transition-all ${editingId ? 'ring-4 ring-[#d4af37] border-transparent' : 'border-slate-100 dark:border-slate-800'}`}>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-8">Personnel Deployment Form</h3>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Personnel Full Name</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID (Emp No)</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Security Access Key</label>
              <input required className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Department Wing</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole, secondaryRoles: formData.secondaryRoles.filter(r => r !== e.target.value)})}>
                {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input required type="email" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Engagement</label>
              <select className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
                <option value="">No Active Class Assignment</option>
                {config.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Secondary Functional Roles (Multi-Wing Duties)</label>
            <div className="flex flex-wrap gap-2.5 bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-inner">
               {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => {
                 if (val === formData.role) return null;
                 const isSelected = formData.secondaryRoles.includes(val as UserRole);
                 return (
                   <button 
                     type="button" 
                     key={val} 
                     onClick={() => toggleSecondaryRole(val as UserRole)}
                     className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all border shadow-sm ${isSelected ? 'bg-[#d4af37] text-[#001f3f] border-transparent scale-105' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'}`}
                   >
                     {label}
                   </button>
                 );
               })}
            </div>
          </div>

          {status && (
            <div className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase border tracking-widest animate-in zoom-in duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
               {status.message}
            </div>
          )}

          <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl hover:bg-slate-900 transition-all transform active:scale-95">
            {editingId ? 'COMMIT STAFF UPDATES' : 'DEPLOY PERSONNEL CREDENTIALS'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-8 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
           <h3 className="text-sm font-black text-[#001f3f] dark:text-white uppercase italic">Active Institutional Roster</h3>
           <div className="flex gap-4">
              <input type="text" placeholder="Filter roster..." value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} className="px-5 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-[10px] font-black uppercase" />
           </div>
        </div>
        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-6">Faculty Member</th>
                   <th className="px-10 py-6">Departmental Assignments</th>
                   <th className="px-10 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => {
                  const allRoles = [u.role, ...(u.secondaryRoles || [])];
                  return (
                    <tr key={u.id} className={`transition-colors ${u.isResigned ? 'bg-slate-100/50 dark:bg-slate-800/30' : 'hover:bg-amber-50/5'}`}>
                      <td className="px-10 py-8">
                        <div className="flex items-center space-x-5">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs shadow-md ${u.isResigned ? 'bg-slate-300 text-white' : 'bg-[#001f3f] text-[#d4af37]'}`}>{u.name.substring(0,2)}</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className={`font-black text-sm italic leading-tight ${u.isResigned ? 'text-slate-400 line-through' : 'text-[#001f3f] dark:text-white'}`}>{u.name}</p>
                              {u.isResigned && <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-500 text-[7px] font-black uppercase">Resigned</span>}
                            </div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">{u.employeeId} | {u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-10 py-8">
                        <div className="flex flex-wrap gap-2">
                          {allRoles.map(r => (
                            <span key={r} className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase border whitespace-nowrap ${r === u.role ? 'bg-sky-50 text-sky-600 border-sky-100 shadow-sm' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                              {ROLE_DISPLAY_MAP[r]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-10 py-8 text-right">
                         <div className="flex items-center justify-end space-x-4">
                            {!u.isResigned && <button onClick={() => setSuccessionTarget(u)} className="text-[10px] font-black uppercase bg-rose-50 text-rose-500 px-4 py-2 rounded-xl hover:bg-rose-100 transition-all">Resign</button>}
                            <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600 hover:underline">Edit</button>
                            <button onClick={() => setUsers(prev => prev.filter(x => x.id !== u.id))} className="text-[10px] font-black uppercase text-red-500 hover:underline">Purge</button>
                         </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
           </table>
        </div>
      </div>

      {successionTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#001f3f]/95 backdrop-blur-md">
           <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl space-y-8 border border-white/10 animate-in zoom-in duration-300">
             <div className="text-center">
                <h4 className="text-2xl font-black text-[#001f3f] dark:text-white uppercase italic tracking-tighter">Faculty Succession Hub</h4>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Managing the Departure of {successionTarget.name}</p>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 space-y-4 flex flex-col">
                   <h5 className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest">A. Direct Succession</h5>
                   <p className="text-[9px] text-slate-500 font-bold leading-relaxed flex-1">Assign a new teacher or existing faculty member to inherit the entire existing duty matrix of the departed staff.</p>
                   <div className="space-y-3 pt-4">
                      <select className="w-full bg-white dark:bg-slate-900 border rounded-xl px-4 py-3 text-[10px] font-black uppercase dark:text-white" value={successorId} onChange={e => setSuccessorId(e.target.value)}>
                         <option value="">Choose Successor...</option>
                         {users.filter(u => u.id !== successionTarget.id && !u.isResigned && u.role !== UserRole.ADMIN).map(u => <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>)}
                      </select>
                      <button 
                        disabled={!successorId || isProcessingSuccession} 
                        onClick={handleSuccessionReplace} 
                        className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-slate-900 transition-all disabled:opacity-50"
                      >
                        {isProcessingSuccession ? 'Authorizing...' : 'Commit Succession'}
                      </button>
                   </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 space-y-4 flex flex-col">
                   <h5 className="text-[11px] font-black text-[#001f3f] dark:text-white uppercase italic tracking-widest">B. Fragmentation</h5>
                   <p className="text-[9px] text-slate-500 font-bold leading-relaxed flex-1">Redistribute periods to other teachers in the same grade by filling their schedule gaps without overwriting their current duties.</p>
                   <button 
                     disabled={isProcessingSuccession} 
                     onClick={handleFragmentationRecalibrate} 
                     className="w-full bg-sky-600 text-white py-4 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-sky-700 transition-all disabled:opacity-50"
                   >
                     {isProcessingSuccession ? 'Analyzing...' : 'Auto-Recalibrate Duties'}
                   </button>
                </div>
             </div>

             <div className="pt-4 flex flex-col items-center gap-4">
                <button 
                  onClick={() => setUsers(prev => prev.map(u => u.id === successionTarget.id ? { ...u, isResigned: true } : u)) && setSuccessionTarget(null)} 
                  className="text-rose-500 font-black text-[9px] uppercase tracking-widest border-b border-rose-200"
                >
                  Mark as Resigned (No reallocation)
                </button>
                <button onClick={() => setSuccessionTarget(null)} className="w-full text-slate-400 font-black text-[10px] uppercase tracking-widest">Abort Succession Process</button>
             </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;

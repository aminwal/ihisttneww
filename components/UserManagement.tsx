
import React, { useState, useMemo, useRef } from 'react';
import { User, UserRole, SchoolConfig } from '../types.ts';
import { generateUUID } from '../utils/idUtils.ts';
import { supabase } from '../supabaseClient.ts';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  config: SchoolConfig;
  currentUser: User;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, config, currentUser }) => {
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    employeeId: '', 
    password: '', 
    role: UserRole.TEACHER_PRIMARY, 
    classTeacherOf: '' 
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = currentUser.role === UserRole.ADMIN;

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Faculty',
    [UserRole.INCHARGE_PRIMARY]: 'Primary Incharge',
    [UserRole.INCHARGE_SECONDARY]: 'Secondary Incharge',
    [UserRole.INCHARGE_ALL]: 'Principal',
    ...(isAdmin ? { [UserRole.ADMIN]: 'Administrator' } : {}),
    [UserRole.ADMIN_STAFF]: 'Admin Staff',
  };

  const REVERSE_ROLE_MAP: Record<string, UserRole> = Object.entries(ROLE_DISPLAY_MAP).reduce((acc, [key, value]) => {
    acc[value.toLowerCase().trim()] = key as UserRole;
    return acc;
  }, {} as Record<string, UserRole>);

  const filteredTeachers = useMemo(() => {
    return users.filter(u => {
      if (!isAdmin && u.role === UserRole.ADMIN) return false;
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      const searchLower = teacherSearch.toLowerCase().trim();
      return !searchLower || u.name.toLowerCase().includes(searchLower) || u.employeeId.toLowerCase().includes(searchLower);
    });
  }, [users, teacherSearch, roleFilter, isAdmin]);

  const getClassTeacherStatus = (className: string) => {
    const owner = users.find(u => u.classTeacherOf === className && u.id !== editingId);
    return owner ? owner.name : null;
  };

  const downloadEmployeeTemplate = () => {
    const roles = Object.values(ROLE_DISPLAY_MAP).join(',');
    const classes = config.classes.map(c => c.name).join(',');
    
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
 <Worksheet ss:Name="Faculty Manifest">
  <Table>
   <Column ss:Width="150"/>
   <Column ss:Width="150"/>
   <Column ss:Width="200"/>
   <Column ss:Width="100"/>
   <Column ss:Width="150"/>
   <Column ss:Width="120"/>
   <Row ss:AutoFitHeight="0" ss:Height="25" ss:StyleID="sHeader">
    <Cell><Data ss:Type="String">Name</Data></Cell>
    <Cell><Data ss:Type="String">EmployeeID</Data></Cell>
    <Cell><Data ss:Type="String">Email</Data></Cell>
    <Cell><Data ss:Type="String">Password</Data></Cell>
    <Cell><Data ss:Type="String">FunctionalRole</Data></Cell>
    <Cell><Data ss:Type="String">ClassTeacherOf</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">John Doe</Data></Cell>
    <Cell><Data ss:Type="String">emp999</Data></Cell>
    <Cell><Data ss:Type="String">j.doe@ihis.edu</Data></Cell>
    <Cell><Data ss:Type="String">pass123</Data></Cell>
    <Cell><Data ss:Type="String">Primary Faculty</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DataValidation>
    <Range>R2C5:R500C5</Range>
    <Type>List</Type>
    <Value>&quot;${roles}&quot;</Value>
   </DataValidation>
   <DataValidation>
    <Range>R2C6:R500C6</Range>
    <Type>List</Type>
    <Value>&quot;${classes}&quot;</Value>
   </DataValidation>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "IHIS_Faculty_Template.xml";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEmployeeBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBulkProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const newUsers: User[] = [];
      const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

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
            const dataNode = cell.getElementsByTagName("Data")[0] || 
                            cell.getElementsByTagNameNS("*", "Data")[0] ||
                            cell.querySelector('Data');
            return dataNode?.textContent?.trim() || '';
          };

          const name = getCellData(0);
          const employeeId = getCellData(1);
          const email = getCellData(2);
          const password = getCellData(3);
          const roleDisplay = getCellData(4);
          const classTeacherOf = getCellData(5);

          if (!name || !employeeId || !email || !password) continue;

          const role = REVERSE_ROLE_MAP[roleDisplay.toLowerCase().trim()] || UserRole.TEACHER_PRIMARY;
          
          // Check for existing Employee ID or Email
          const alreadyExists = users.some(u => u.employeeId.toLowerCase() === employeeId.toLowerCase() || u.email.toLowerCase() === email.toLowerCase()) ||
                               newUsers.some(u => u.employeeId.toLowerCase() === employeeId.toLowerCase() || u.email.toLowerCase() === email.toLowerCase());
          
          if (alreadyExists) continue;

          const newUser: User = {
            id: generateUUID(),
            name,
            employeeId,
            email,
            password,
            role,
            classTeacherOf: classTeacherOf || undefined
          };

          newUsers.push(newUser);
        }

        if (newUsers.length > 0) {
          if (isCloudActive) {
            const { error } = await supabase.from('profiles').insert(newUsers.map(u => ({
              id: u.id,
              name: u.name,
              employee_id: u.employeeId,
              email: u.email,
              password: u.password,
              role: u.role,
              class_teacher_of: u.classTeacherOf || null
            })));
            if (error) throw error;
          }
          setUsers(prev => [...newUsers, ...prev]);
          setStatus({ type: 'success', message: `Bulk synchronization successful. ${newUsers.length} profiles deployed.` });
        } else {
          setStatus({ type: 'error', message: "No valid or unique records identified in the manifest." });
        }
      } catch (err: any) {
        setStatus({ type: 'error', message: "Process Aborted: XML parsing failure or network error." });
      } finally {
        setIsBulkProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Constraint Check: 1 class = 1 teacher
    if (formData.classTeacherOf) {
      const currentOwner = users.find(u => u.classTeacherOf === formData.classTeacherOf && u.id !== editingId);
      if (currentOwner) {
        setStatus({ type: 'error', message: `Violation: ${formData.classTeacherOf} is already assigned to ${currentOwner.name}.` });
        return;
      }
    }

    const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

    try {
      if (editingId) {
        if (isCloudActive) {
          const { error } = await supabase.from('profiles').update({
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            class_teacher_of: formData.classTeacherOf || null
          }).eq('id', editingId);
          if (error) throw error;
        }
        const updated = users.map(u => u.id === editingId ? { ...u, ...formData } : u);
        setUsers(updated);
        setEditingId(null);
        setStatus({ type: 'success', message: 'Faculty record synchronized.' });
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
            class_teacher_of: formData.classTeacherOf || null
          });
          if (error) throw error;
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        setStatus({ type: 'success', message: 'New faculty credential deployed.' });
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', role: UserRole.TEACHER_PRIMARY, classTeacherOf: '' });
    } catch (err: any) {
      console.error("Cloud Error:", err);
      setStatus({ type: 'error', message: err.message || 'Handshake failed: Validation Conflict.' });
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
      classTeacherOf: user.classTeacherOf || '' 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic uppercase">Faculty Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Institutional Identity Control</p>
        </div>
        <div className="flex items-center gap-3">
           <button 
             onClick={downloadEmployeeTemplate}
             className="px-4 py-2 bg-white dark:bg-slate-800 text-[#001f3f] dark:text-[#d4af37] border border-slate-200 dark:border-slate-700 rounded-xl text-[9px] font-black uppercase shadow-sm hover:shadow-md transition-all flex items-center gap-2"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
           </button>
           <label className="px-4 py-2 bg-[#d4af37] text-[#001f3f] rounded-xl text-[9px] font-black uppercase shadow-lg hover:bg-amber-500 cursor-pointer transition-all flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              {isBulkProcessing ? 'Syncing...' : 'Bulk Upload'}
              <input type="file" ref={fileInputRef} accept=".xml" className="hidden" onChange={handleEmployeeBulkUpload} disabled={isBulkProcessing} />
           </label>
           {status && (
            <div className={`px-4 py-2 rounded-xl border text-[8px] font-black uppercase transition-all duration-300 ${status.type === 'error' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {status.message}
            </div>
           )}
        </div>
      </div>
      
      <div className={`bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-xl border ${editingId ? 'ring-4 ring-[#d4af37] border-transparent' : 'border-gray-100 dark:border-slate-800'}`}>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-6">Credential Management</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
             <input required className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" placeholder="e.g. Ahmed Ali" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff ID</label>
             <input required className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" placeholder="e.g. emp001" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Institutional Email</label>
             <input required className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" placeholder="email@ihis.edu" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
           </div>
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Access Key (Password)</label>
             <input required className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-bold dark:text-white outline-none focus:ring-2 focus:ring-[#d4af37]" placeholder="••••••••" type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
           </div>
           
           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Functional Role</label>
             <select className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-[#d4af37]" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
               {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
             </select>
           </div>

           <div className="space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Assignment (1:1 Strictly)</label>
             <select 
               className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl text-[11px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 ${formData.classTeacherOf && getClassTeacherStatus(formData.classTeacherOf) ? 'ring-2 ring-red-400' : 'focus:ring-[#d4af37]'}`} 
               value={formData.classTeacherOf} 
               onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}
             >
               <option value="">No Active Charge</option>
               {config.classes.map(c => {
                 const currentOwner = getClassTeacherStatus(c.name);
                 return (
                   <option key={c.id} value={c.name} disabled={!!currentOwner}>
                     {c.name} {currentOwner ? `— Taken by ${currentOwner}` : `(${c.section.replace('_', ' ')})`}
                   </option>
                 );
               })}
             </select>
           </div>

           <div className="flex items-end lg:col-span-3">
             <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-900 active:scale-95 transition-all">
               {editingId ? 'COMMIT IDENTITY UPDATE' : 'DEPLOY FACULTY CREDENTIAL'}
             </button>
           </div>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-4 md:p-8 bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 items-center justify-between">
           <div className="relative w-full md:w-80">
              <input type="text" placeholder="Filter Faculty..." className="w-full pl-12 pr-6 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#d4af37]" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} />
              <svg className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
           </div>
           <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="w-full md:w-auto px-6 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-[10px] font-black uppercase outline-none dark:text-white focus:ring-2 focus:ring-[#d4af37]">
             <option value="ALL">All Departments</option>
             {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
           </select>
        </div>

        <div className="overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-5">Personnel Profile</th>
                   <th className="px-10 py-5">Access Permission</th>
                   <th className="px-10 py-5">Class Charge</th>
                   <th className="px-10 py-5 text-right">Registry Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-10 py-6">
                       <div className="flex items-center space-x-5">
                          <div className="w-12 h-12 bg-[#001f3f] text-[#d4af37] rounded-2xl flex items-center justify-center font-black text-xs border-2 border-transparent group-hover:border-[#d4af37]/30 transition-all">{u.name.substring(0,2)}</div>
                          <div>
                            <p className="font-black text-sm text-[#001f3f] dark:text-white leading-tight">{u.name}</p>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{u.employeeId}</p>
                          </div>
                       </div>
                    </td>
                    <td className="px-10 py-6">
                       <span className="px-4 py-1.5 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-xl text-[9px] font-black uppercase border border-sky-100 italic">{ROLE_DISPLAY_MAP[u.role]}</span>
                    </td>
                    <td className="px-10 py-6">
                       {u.classTeacherOf ? (
                         <span className="px-4 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-xl text-[9px] font-black uppercase border border-amber-100">Charge: {u.classTeacherOf}</span>
                       ) : (
                         <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">No Charge</span>
                       )}
                    </td>
                    <td className="px-10 py-6 text-right">
                       <button onClick={() => startEdit(u)} className="text-[11px] font-black uppercase text-sky-600 mr-5 hover:underline">Revise</button>
                       <button onClick={async () => {
                          if (confirm(`Decommission all credentials for ${u.name}?`)) {
                            if (!supabase.supabaseUrl.includes('placeholder-project')) {
                              await supabase.from('profiles').delete().eq('id', u.id);
                            }
                            setUsers(prev => prev.filter(x => x.id !== u.id));
                          }
                       }} className="text-[11px] font-black uppercase text-red-500 hover:underline">Purge</button>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
           {filteredTeachers.length === 0 && (
             <div className="py-20 text-center text-slate-300 uppercase font-black text-[10px] tracking-[0.3em]">No matching personnel identified</div>
           )}
        </div>
      </div>
    </div>
  );
};

export default UserManagement;

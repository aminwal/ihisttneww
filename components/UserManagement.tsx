
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = currentUser.role === UserRole.ADMIN;

  const ROLE_DISPLAY_MAP: Record<string, string> = {
    [UserRole.TEACHER_PRIMARY]: 'Primary Faculty',
    [UserRole.TEACHER_SECONDARY]: 'Secondary Faculty',
    [UserRole.TEACHER_SENIOR_SECONDARY]: 'Senior Faculty',
    [UserRole.INCHARGE_PRIMARY]: 'Primary Incharge',
    [UserRole.INCHARGE_SECONDARY]: 'Secondary Incharge',
    [UserRole.INCHARGE_ALL]: 'General Incharge',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');

    try {
      if (editingId) {
        if (isCloudActive) {
          await supabase.from('profiles').update({
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            class_teacher_of: formData.classTeacherOf || null
          }).eq('id', editingId);
        }
        const updated = users.map(u => u.id === editingId ? { ...u, ...formData } : u);
        setUsers(updated);
        setEditingId(null);
        setStatus({ type: 'success', message: 'Faculty record updated.' });
      } else {
        const id = generateUUID();
        if (isCloudActive) {
          await supabase.from('profiles').insert({
            id,
            name: formData.name,
            email: formData.email,
            employee_id: formData.employeeId,
            password: formData.password,
            role: formData.role,
            class_teacher_of: formData.classTeacherOf || null
          });
        }
        const newUser = { id, ...formData };
        setUsers([newUser, ...users]);
        setStatus({ type: 'success', message: 'New faculty registered.' });
      }
      setFormData({ name: '', email: '', employeeId: '', password: '', role: UserRole.TEACHER_PRIMARY, classTeacherOf: '' });
    } catch (err) {
      console.error("Cloud Error:", err);
      setStatus({ type: 'error', message: 'Synchronization failed. Check credentials.' });
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

  const downloadUserTemplate = () => {
    const rolesList = Object.values(ROLE_DISPLAY_MAP).join(',');
    const classList = config.classes.map(c => c.name).join(',');
    
    const xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="sHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#001F3F" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="sGuide">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="9" ss:Color="#666666" ss:Italic="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Faculty Registry">
  <Table>
   <Column ss:Width="150"/>
   <Column ss:Width="100"/>
   <Column ss:Width="150"/>
   <Column ss:Width="100"/>
   <Column ss:Width="150"/>
   <Column ss:Width="100"/>
   <Column ss:Width="120"/>
   <Row ss:AutoFitHeight="0" ss:Height="25" ss:StyleID="sHeader">
    <Cell><Data ss:Type="String">Name</Data></Cell>
    <Cell><Data ss:Type="String">Employee ID</Data></Cell>
    <Cell><Data ss:Type="String">Email</Data></Cell>
    <Cell><Data ss:Type="String">Password</Data></Cell>
    <Cell><Data ss:Type="String">Role</Data></Cell>
    <Cell><Data ss:Type="String">Is Class Teacher</Data></Cell>
    <Cell><Data ss:Type="String">Class Teacher Of</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">John Doe</Data></Cell>
    <Cell><Data ss:Type="String">emp501</Data></Cell>
    <Cell><Data ss:Type="String">j.doe@school.com</Data></Cell>
    <Cell><Data ss:Type="String">pass123</Data></Cell>
    <Cell><Data ss:Type="String">Primary Faculty</Data></Cell>
    <Cell><Data ss:Type="String">Yes</Data></Cell>
    <Cell><Data ss:Type="String">IV A</Data></Cell>
   </Row>
   <Row ss:Index="15">
    <Cell ss:StyleID="sGuide" ss:MergeAcross="6"><Data ss:Type="String">REGISTRY GUIDE:</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="sGuide" ss:MergeAcross="6"><Data ss:Type="String">1. Select Role from the dropdown menu (click the cell in Role column).</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="sGuide" ss:MergeAcross="6"><Data ss:Type="String">2. Choose 'Yes' for Class Teacher status if they have a class assigned.</Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DataValidation>
    <Range>R2C5:R500C5</Range>
    <Type>List</Type>
    <Value>&quot;${rolesList}&quot;</Value>
   </DataValidation>
   <DataValidation>
    <Range>R2C6:R500C6</Range>
    <Type>List</Type>
    <Value>&quot;Yes,No&quot;</Value>
   </DataValidation>
   <DataValidation>
    <Range>R2C7:R500C7</Range>
    <Type>List</Type>
    <Value>&quot;${classList}&quot;</Value>
   </DataValidation>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ihis_faculty_registry_template.xml");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const newUsers: User[] = [];
      let skipCount = 0;

      if (content.trim().startsWith('<?xml')) {
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
          const roleLabel = getCellData(4);
          const isClassTeacher = getCellData(5); 
          const classTeacherOf = getCellData(6);

          if (!name || name === 'REGISTRY GUIDE:') break;
          if (name.toLowerCase() === 'name') continue; 

          const role = REVERSE_ROLE_MAP[roleLabel.toLowerCase().trim()];
          if (!role) {
            console.warn(`Invalid role encountered: "${roleLabel}" at row ${i+1}`);
            skipCount++;
            continue;
          }

          const exists = users.some(u => u.employeeId.toLowerCase() === employeeId.toLowerCase()) || 
                         newUsers.some(u => u.employeeId.toLowerCase() === employeeId.toLowerCase());
          
          if (exists) {
            skipCount++;
            continue;
          }

          newUsers.push({
            id: generateUUID(),
            name,
            employeeId,
            email,
            password,
            role,
            classTeacherOf: isClassTeacher.toLowerCase() === 'yes' ? classTeacherOf : undefined
          });
        }
      }

      if (newUsers.length > 0) {
        const isCloudActive = !supabase.supabaseUrl.includes('placeholder-project');
        
        if (isCloudActive) {
          try {
            const dbRows = newUsers.map(u => ({
              id: u.id,
              name: u.name,
              employee_id: u.employeeId,
              email: u.email,
              password: u.password,
              role: u.role,
              class_teacher_of: u.classTeacherOf || null
            }));
            
            const { error } = await supabase.from('profiles').insert(dbRows);
            if (error) throw error;

            setUsers(prev => [...newUsers, ...prev]);
            setStatus({ 
              type: 'success', 
              message: `Cloud Synced: Imported ${newUsers.length} faculty. ${skipCount > 0 ? `Skipped ${skipCount} duplicates.` : ''}` 
            });
          } catch (err) {
            console.error("Cloud Batch Error:", err);
            setStatus({ type: 'error', message: 'Cloud insert failed. Records saved locally only.' });
            setUsers(prev => [...newUsers, ...prev]);
          }
        } else {
          setUsers(prev => [...newUsers, ...prev]);
          setStatus({ 
            type: 'success', 
            message: `Imported ${newUsers.length} faculty locally. ${skipCount > 0 ? `Skipped ${skipCount} duplicates.` : ''}` 
          });
        }
      } else {
        setStatus({ type: 'error', message: 'No valid records identified in XML. Check role names.' });
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700 w-full px-2">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-black text-[#001f3f] dark:text-white tracking-tight italic">Faculty Registry</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Staff Directory Control</p>
        </div>
        <div className="flex items-center gap-2">
           {status && (
            <div className={`px-4 py-2 rounded-xl border text-[8px] font-black uppercase transition-all duration-300 ${status.type === 'error' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {status.message}
            </div>
           )}
           <button onClick={downloadUserTemplate} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-[9px] font-black uppercase border border-slate-200 dark:border-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-2">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              XML Template
           </button>
           <label className="px-4 py-2 bg-[#001f3f] text-[#d4af37] rounded-xl text-[9px] font-black uppercase shadow-lg cursor-pointer hover:bg-slate-900 transition-colors flex items-center gap-2">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12" /></svg>
              Bulk Import
              <input type="file" ref={fileInputRef} accept=".xml" className="hidden" onChange={handleBulkUpload} />
           </label>
        </div>
      </div>
      
      {/* Dynamic Form Area */}
      <div className={`bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-xl border ${editingId ? 'ring-4 ring-amber-400 border-transparent' : 'border-gray-100 dark:border-slate-800'}`}>
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-6">Identity Registry</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none" placeholder="Full Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
           <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none" placeholder="Employee ID" value={formData.employeeId} onChange={e => setFormData({...formData, employeeId: e.target.value})} />
           <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none" placeholder="Email" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
           <input required className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm font-bold dark:text-white outline-none" placeholder="Password" type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
           
           <div className="flex flex-col space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Privilege</label>
             <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-amber-400" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
               {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
             </select>
           </div>

           <div className="flex flex-col space-y-1">
             <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Class Teacher Assignment</label>
             <select className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[10px] font-black uppercase dark:text-white outline-none border-none focus:ring-2 focus:ring-amber-400" value={formData.classTeacherOf} onChange={e => setFormData({...formData, classTeacherOf: e.target.value})}>
               <option value="">None / Not a Class Teacher</option>
               {config.classes.map(c => (
                 <option key={c.id} value={c.name}>{c.name} ({c.section.replace('_', ' ')})</option>
               ))}
             </select>
           </div>

           <div className="flex items-end lg:col-span-3">
             <button type="submit" className="w-full bg-[#001f3f] text-[#d4af37] py-4 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-900 active:scale-95 transition-all">
               {editingId ? 'Update Faculty Record' : 'Register New Faculty'}
             </button>
           </div>
        </form>
      </div>

      {/* Faculty List Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
        <div className="p-4 md:p-8 bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 items-center justify-between">
           <input type="text" placeholder="Search faculty..." className="w-full md:w-64 px-5 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase outline-none" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} />
           <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="w-full md:w-auto px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase outline-none dark:text-white">
             <option value="ALL">All Roles</option>
             {Object.entries(ROLE_DISPLAY_MAP).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
           </select>
        </div>

        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
           <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-gray-400 uppercase tracking-widest bg-slate-50/50">
                   <th className="px-10 py-5">Identity</th>
                   <th className="px-10 py-5">Privilege</th>
                   <th className="px-10 py-5">Class Charge</th>
                   <th className="px-10 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTeachers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-10 py-6">
                       <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs">{u.name.substring(0,2)}</div>
                          <div>
                            <p className="font-black text-sm text-[#001f3f] dark:text-white">{u.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{u.employeeId}</p>
                          </div>
                       </div>
                    </td>
                    <td className="px-10 py-6">
                       <span className="px-3 py-1 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-lg text-[8px] font-black uppercase border border-sky-100">{ROLE_DISPLAY_MAP[u.role]}</span>
                    </td>
                    <td className="px-10 py-6">
                       {u.classTeacherOf ? (
                         <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-lg text-[8px] font-black uppercase border border-amber-100">Class: {u.classTeacherOf}</span>
                       ) : (
                         <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">N/A</span>
                       )}
                    </td>
                    <td className="px-10 py-6 text-right">
                       <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600 mr-4 hover:underline">Edit</button>
                       <button onClick={async () => {
                         if (confirm("Purge this identity from all institutional records?")) {
                            if (!supabase.supabaseUrl.includes('placeholder-project')) {
                               await supabase.from('profiles').delete().eq('id', u.id);
                            }
                            setUsers(prev => prev.filter(x => x.id !== u.id));
                         }
                       }} className="text-[10px] font-black uppercase text-red-500 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>

        {/* Mobile Card Feed */}
        <div className="md:hidden p-4 space-y-3 bg-slate-50/30 dark:bg-slate-900/50">
           {filteredTeachers.map(u => (
             <div key={u.id} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                   <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-[#001f3f] text-[#d4af37] rounded-xl flex items-center justify-center font-black text-xs">{u.name.substring(0,2)}</div>
                      <div>
                        <p className="font-black text-sm text-[#001f3f] dark:text-white">{u.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{u.employeeId}</p>
                      </div>
                   </div>
                   <div className="flex flex-col items-end space-y-1">
                      <span className="text-[7px] font-black px-2 py-1 bg-sky-50 dark:bg-sky-950/30 text-sky-600 rounded-lg border border-sky-100 uppercase">{ROLE_DISPLAY_MAP[u.role]}</span>
                      {u.classTeacherOf && (
                        <span className="text-[7px] font-black px-2 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-lg border border-amber-100 uppercase">{u.classTeacherOf}</span>
                      )}
                   </div>
                </div>
                <div className="flex items-center justify-end gap-6 pt-2 border-t border-slate-50 dark:border-slate-800">
                   <button onClick={() => startEdit(u)} className="text-[10px] font-black uppercase text-sky-600">Update Profile</button>
                   <button onClick={async () => {
                      if (confirm("Decommission this identity?")) {
                        if (!supabase.supabaseUrl.includes('placeholder-project')) {
                          await supabase.from('profiles').delete().eq('id', u.id);
                        }
                        setUsers(prev => prev.filter(x => x.id !== u.id));
                      }
                   }} className="text-[10px] font-black uppercase text-red-500">Purge</button>
                </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
};

export default UserManagement;

import fs from 'fs';

const timeTableView = fs.readFileSync('components/TimeTableView.tsx', 'utf-8');

const startStr = '  const handleGenerateLoads = (inputTimetable?: TimeTableEntry[]) => {';
const endStr = '  const handleGapCloser = async (inputTimetable: TimeTableEntry[]) => {';

const startIndex = timeTableView.indexOf(startStr);
const endIndex = timeTableView.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find start or end strings');
  process.exit(1);
}

const newHandleGenerateLoads = `  const handleGenerateLoads = async (inputTimetable?: TimeTableEntry[]) => {
    if (!isDraftMode) return inputTimetable || currentTimetable;

    const activeSectionId = viewMode === 'SECTION' ? selectedTargetId : null;
    const activeSection = activeSectionId ? config.sections.find(s => s.id === activeSectionId) : null;
    const activeGradeId = activeSection?.gradeId;

    if (!inputTimetable) showToast("Phase 5: Distributing remaining loads via CSP Worker...", "info");

    return new Promise<TimeTableEntry[]>((resolve, reject) => {
      const worker = new Worker(new URL('../workers/timetableWorker.ts', import.meta.url), { type: 'module' });
      
      worker.onmessage = (e) => {
        const { newTimetable, parkedItems, logs } = e.data;
        
        const count = newTimetable.length - (inputTimetable ? inputTimetable.length : currentTimetable.length);
        const parkedCount = parkedItems.length;

        if (!inputTimetable) {
          if (count > 0 || isPurgeMode || parkedCount > 0) {
            if (count > 0 || isPurgeMode) setCurrentTimetable(newTimetable);
            if (parkedCount > 0) setParkedEntries(prev => [...prev, ...parkedItems]);
            HapticService.success();
            const targetName = activeSectionId ? config.sections.find(s => s.id === activeSectionId)?.fullName : 'all classes';
            const parkMsg = parkedCount > 0 ? \` (\${parkedCount} periods parked)\` : '';
            showToast(\`Phase 5 Complete: \${count} instructional load periods distributed for \${targetName}\${parkMsg}.\`, "success");
            
            setAssignmentLogs(prev => [{
              id: generateUUID(),
              timestamp: new Date().toLocaleTimeString(),
              actionType: 'AUTO_POOL',
              subject: 'Instructional Loads',
              teacherName: 'System',
              status: parkedCount > 0 ? 'PARTIAL' : 'SUCCESS',
              details: \`Distributed \${count} load periods for \${targetName}. \${parkedCount} periods parked.\`,
              assignedCount: count,
              totalCount: count + parkedCount
            }, ...prev]);
          } else {
            showToast("Phase 5: Optimization complete. No deployable loads remaining.", "info");
            
            setAssignmentLogs(prev => [{
              id: generateUUID(),
              timestamp: new Date().toLocaleTimeString(),
              actionType: 'AUTO_POOL',
              subject: 'Instructional Loads',
              teacherName: 'System',
              status: 'FAILED',
              details: 'Optimization complete. No deployable loads remaining.',
              assignedCount: 0,
              totalCount: 0
            }, ...prev]);
          }
        }
        
        worker.terminate();
        resolve(newTimetable);
      };

      worker.onerror = (error) => {
        console.error("Worker error:", error);
        showToast("Phase 5: Worker encountered an error.", "error");
        worker.terminate();
        resolve(inputTimetable || currentTimetable);
      };

      worker.postMessage({
        config,
        users,
        assignments,
        lockedSectionIds,
        currentTimetable: inputTimetable || currentTimetable,
        activeSectionId,
        isPurgeMode
      });
    });
  };

`;

const newTimeTableView = timeTableView.substring(0, startIndex) + newHandleGenerateLoads + timeTableView.substring(endIndex);
fs.writeFileSync('components/TimeTableView.tsx', newTimeTableView);

console.log('Replacement complete');

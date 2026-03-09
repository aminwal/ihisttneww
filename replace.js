import fs from 'fs';

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace section: ... ? 'PRIMARY' : 'SECONDARY_BOYS'
  content = content.replace(/section:\s*\(?([a-zA-Z0-9_]+)\.wingId\.includes\('wing-p'\)\s*\?\s*'PRIMARY'\s*:\s*'SECONDARY_BOYS'\)?\s*(as\s+SectionType)?/g, 
    "section: (config.wings.find(w => w.id === $1.wingId)?.sectionType || 'PRIMARY') as SectionType");
    
  // Replace wingSlots = ...
  content = content.replace(/config\.slotDefinitions\?\.\[([a-zA-Z0-9_]+)\.wingId\.includes\('wing-p'\)\s*\?\s*'PRIMARY'\s*:\s*'SECONDARY_BOYS'\]/g, 
    "config.slotDefinitions?.[config.wings.find(w => w.id === $1.wingId)?.sectionType || 'PRIMARY']");

  fs.writeFileSync(filePath, content, 'utf8');
}

replaceInFile('components/TimeTableView.tsx');
replaceInFile('utils/timetable/autoScheduler.ts');
console.log('Done');

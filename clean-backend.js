const fs = require('fs');

function cleanFile(path) {
  let c = fs.readFileSync(path, 'utf8');

  // Remove lines defining or assigning these fields
  c = c.replace(/.*workingDays.*?\n/g, '');
  c = c.replace(/.*workStartTime.*?\n/g, '');
  c = c.replace(/.*workEndTime.*?\n/g, '');
  c = c.replace(/.*timingSnapshotAt.*?\n/g, '');
  
  c = c.replace(/.*assignedTo.*\n/g, '');
  
  // Actually, businessUnit and clientName might be more complex
  // Let's replace usages of dto.businessUnit, etc.

  fs.writeFileSync(path, c);
}

// I should do this more carefully manually using regex

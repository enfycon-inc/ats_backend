const fs = require('fs');

let js = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

js = js.replace(/data:\s*\{\s*assignedTo:\s*'ALL'\s*\}/g, 'data: { /* removed assignedTo */ }');
js = js.replace(/data:\s*\{\s*assignedTo:\s*dto\.assignedTo\s*\}/g, 'data: { /* removed assignedTo */ }');
js = js.replace(/if\s*\(currentJob\.clientName\)/g, 'if (false /* removed clientName */)');
js = js.replace(/currentJob\.clientName/g, '""');
js = js.replace(/if\s*\(currentJob\.endClientName/g, 'if (false /* removed endClientName */');
js = js.replace(/currentJob\.endClientName/g, '""');
js = js.replace(/const\s*assignedTo\s*=\s*overrides\?\.assignedTo\s*\|\|\s*currentJob\.assignedTo\s*\|\|\s*'All Branch Recruiters';/g, '');
js = js.replace(/assignedTo,\s*\n/g, '');

fs.writeFileSync('src/jobs/jobs.service.ts', js);

let rs = fs.readFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', 'utf8');
rs = rs.replace(/clientName:\s*true,?\s*/g, '');
rs = rs.replace(/clientName:\s*existing\.job\?\.clientName,?\s*/g, "clientName: 'N/A',");
rs = rs.replace(/existing\.candidate\?/g, "(existing as any).candidate?");
rs = rs.replace(/existing\.job\?/g, "(existing as any).job?");
fs.writeFileSync('src/recruiter-submissions/recruiter-submissions.service.ts', rs);

console.log('✅ Final TS fixes applied');

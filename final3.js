const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// Replace any line that looks like `currency,`
bu = bu.replace(/^\s*currency,\s*$/gm, '');

bu = bu.replace(/job\.businessUnitRef\?\.market/g, "(job.businessUnitRef as any)?.marketSegment?.code");
bu = bu.replace(/job\.branch\?\.market/g, "(job.branch as any)?.market");
fs.writeFileSync('src/business-units/business-units.service.ts', bu);
console.log("Replaced currency using gm regex!");

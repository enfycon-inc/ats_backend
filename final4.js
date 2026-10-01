const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

bu = bu.split('domain = job.businessUnitRef.market.toUpperCase();').join('domain = (job.businessUnitRef as any)?.marketSegment?.code?.toUpperCase() || "US";');
bu = bu.split('domain = job.branch.market.toUpperCase();').join('domain = (job.branch as any)?.market?.toUpperCase() || "INDIA";');

fs.writeFileSync('src/business-units/business-units.service.ts', bu);
console.log("Fixed domain assignments!");

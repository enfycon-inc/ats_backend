const fs = require('fs');

// Fix BusinessUnitsService
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// 1. Remove data payloads (create/update)
bu = bu.replace(/\s*market,\r?\n/g, '\n');
bu = bu.replace(/\s*currency,\r?\n/g, '\n');

// 2. Remove 'market' from where clause in candidate-staff logic (line 336 approx)
bu = bu.replace(/market: \{\s*in: isDomestic[^}]+\},\r?\n/, '');

// 3. Fix mappings
bu = bu.replace(/market: bu\.market/g, "market: (bu as any).marketSegment?.code || 'US'");
bu = bu.replace(/currency: bu\.currency/g, "currency: (bu as any).marketSegment?.defaultCurrency || 'USD'");
bu = bu.replace(/market: u\.market/g, "market: (u as any).marketSegment?.code || 'US'");
bu = bu.replace(/currency: u\.currency/g, "currency: (u as any).marketSegment?.defaultCurrency || 'USD'");

// 4. Fix job domain finding
bu = bu.replace(/job\.businessUnitRef\?\.market/g, "(job.businessUnitRef as any)?.marketSegment?.code");

// 5. Fix string literals
bu = bu.replace(/u\.market ===/g, "(u as any).marketSegment?.code ===");
bu = bu.replace(/existing\.market/g, "(existing as any).marketSegment?.code || 'US'");
bu = bu.replace(/existing\.currency/g, "(existing as any).marketSegment?.defaultCurrency || 'USD'");

fs.writeFileSync('src/business-units/business-units.service.ts', bu);


// Fix JobsService
let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

// 1. Fix unitCode assignment
jobs = jobs.replace(/unitCode = bu\.code \|\| bu\.marketSegment\?\.code \|\| 'GEN';/, "unitCode = bu.code || (bu as any).marketSegment?.code || 'GEN';");
jobs = jobs.replace(/branchMarket = bu\.market \|\| '';/, "branchMarket = (bu as any).marketSegment?.code || '';");

fs.writeFileSync('src/jobs/jobs.service.ts', jobs);

console.log("Patched properly");

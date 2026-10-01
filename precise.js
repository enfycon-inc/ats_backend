const fs = require('fs');

let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// The create payload
bu = bu.replace(/\n\s*market,?\n/, '\n');
bu = bu.replace(/\n\s*currency,?\n/, '\n');

// The update payload
bu = bu.replace(/\n\s*market,?\n/, '\n');
bu = bu.replace(/\n\s*currency,?\n/, '\n');

// The candidate-staff market filter
bu = bu.replace(/market: \{\s*in: isDomestic[^}]+\},\s*\n/, '');

// The mapping
bu = bu.split('market: bu.market').join("market: (bu as any).marketSegment?.code || 'US'");
bu = bu.split('currency: bu.currency').join("currency: (bu as any).marketSegment?.defaultCurrency || 'USD'");
bu = bu.split('market: u.market').join("market: (u as any).marketSegment?.code || 'US'");
bu = bu.split('currency: u.currency').join("currency: (u as any).marketSegment?.defaultCurrency || 'USD'");

// Job properties
bu = bu.split('job.businessUnitRef?.market').join("(job.businessUnitRef as any)?.marketSegment?.code");
bu = bu.split('job.branch?.market').join("(job.branch as any)?.market");
bu = bu.split("u.market === 'US'").join("(u as any).marketSegment?.code === 'US'");

// existing mapping
bu = bu.split('existing.market').join("((existing as any).marketSegment?.code || 'US')");
bu = bu.split('existing.currency').join("((existing as any).marketSegment?.defaultCurrency || 'USD')");

fs.writeFileSync('src/business-units/business-units.service.ts', bu);


let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');

jobs = jobs.split("unitCode = bu.code || bu.marketSegment?.code || 'GEN';").join("unitCode = bu.code || (bu as any).marketSegment?.code || 'GEN';");
jobs = jobs.split("branchMarket = bu.market || '';").join("branchMarket = (bu as any).marketSegment?.code || '';");
jobs = jobs.split("select: { id: true, code: true, name: true, market: true }").join("select: { id: true, code: true, name: true, marketSegment: { select: { code: true } } }");

fs.writeFileSync('src/jobs/jobs.service.ts', jobs);

console.log("Replaced exactly");

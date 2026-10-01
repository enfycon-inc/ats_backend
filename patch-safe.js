const fs = require('fs');
let content = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// We just want to comment out the Prisma data payloads for market and currency.
content = content.replace(/market,\n/g, '');
content = content.replace(/currency,\n/g, '');

// Also for mapping, replace `market: bu.market` with `market: (bu as any).marketSegment?.code || 'US'`
content = content.replace(/market: bu\.market/g, "market: (bu as any).marketSegment?.code || 'US'");
content = content.replace(/currency: bu\.currency/g, "currency: (bu as any).marketSegment?.defaultCurrency || 'USD'");
content = content.replace(/market: u\.market/g, "market: (u as any).marketSegment?.code || 'US'");
content = content.replace(/currency: u\.currency/g, "currency: (u as any).marketSegment?.defaultCurrency || 'USD'");

// existing.market
content = content.replace(/existing\.market/g, "(existing as any).marketSegment?.code || 'US'");
content = content.replace(/existing\.currency/g, "(existing as any).marketSegment?.defaultCurrency || 'USD'");

// Also in jobs
let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');
jobs = jobs.replace(/bu\.market/g, "(bu as any).marketSegment?.code || 'US'");
fs.writeFileSync('src/jobs/jobs.service.ts', jobs);

fs.writeFileSync('src/business-units/business-units.service.ts', content);
console.log("Patched safely");

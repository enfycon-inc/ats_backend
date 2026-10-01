const fs = require('fs');

let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');
bu = bu.replace(/[\t ]*market,?\r?\n/g, '');
bu = bu.replace(/[\t ]*currency,?\r?\n/g, '');
bu = bu.replace(/job\.businessUnitRef\?\.market/g, "(job.businessUnitRef as any)?.marketSegment?.code");
bu = bu.replace(/u\.market ===/g, "(u as any).marketSegment?.code ===");
bu = bu.replace(/job\.branch\?\.market/g, "(job.branch as any)?.market");
fs.writeFileSync('src/business-units/business-units.service.ts', bu);

let jobs = fs.readFileSync('src/jobs/jobs.service.ts', 'utf8');
jobs = jobs.replace(/select: \{ id: true, code: true, name: true, market: true \}/g, "select: { id: true, code: true, name: true, marketSegment: { select: { code: true } } }");
fs.writeFileSync('src/jobs/jobs.service.ts', jobs);

console.log("Fixed lingering references");

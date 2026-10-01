const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// Replace create
bu = bu.replace(/branch: dto\.branchId \? \{ connect: \{ id: dto\.branchId \} \} : undefined,/,
  "...(dto.branchId ? { branch: { connect: { id: dto.branchId } } } : {}),");
bu = bu.replace(/marketSegment: \(dto as any\)\.marketSegmentId \? \{ connect: \{ id: \(dto as any\)\.marketSegmentId \} \} : undefined,/,
  "...((dto as any).marketSegmentId ? { marketSegment: { connect: { id: (dto as any).marketSegmentId } } } : {}),");

fs.writeFileSync('src/business-units/business-units.service.ts', bu);
console.log("Fixed create payload spreading!");

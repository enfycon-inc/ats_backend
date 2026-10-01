const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// Fix create payload
bu = bu.replace(/branchId: dto\.branchId \|\| null,/,
  "branch: dto.branchId ? { connect: { id: dto.branchId } } : undefined,");

bu = bu.replace(/marketSegmentId: \(dto as any\)\.marketSegmentId \|\| null,/,
  "marketSegment: (dto as any).marketSegmentId ? { connect: { id: (dto as any).marketSegmentId } } : undefined,");

// Fix update payload
bu = bu.replace(/\.\.\.\(dto\.branchId !== undefined \? \{ branchId: dto\.branchId \} : \{\}\),/,
  "...(dto.branchId !== undefined ? (dto.branchId ? { branch: { connect: { id: dto.branchId } } } : { branch: { disconnect: true } }) : {}),");

bu = bu.replace(/\.\.\.\(\(dto as any\)\.marketSegmentId !== undefined \? \{ marketSegmentId: \(dto as any\)\.marketSegmentId \|\| null \} : \{\}\),/,
  "...((dto as any).marketSegmentId !== undefined ? ((dto as any).marketSegmentId ? { marketSegment: { connect: { id: (dto as any).marketSegmentId } } } : { marketSegment: { disconnect: true } }) : {}),");

fs.writeFileSync('src/business-units/business-units.service.ts', bu);
console.log("Fixed relations in create/update payloads!");

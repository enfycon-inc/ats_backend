const fs = require('fs');
let content = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// Replace create payload
content = content.replace(/\.\.\.\(dto\.branchId !== undefined \? \{ branchId: dto\.branchId \} : \{\}\),/, 
  "...(dto.branchId !== undefined ? (dto.branchId ? { branch: { connect: { id: dto.branchId } } } : {}) : {})");

content = content.replace(/\.\.\.\(\(dto as any\)\.marketSegmentId !== undefined \? \{ marketSegmentId: \(dto as any\)\.marketSegmentId \|\| null \} : \{\}\),/,
  "...((dto as any).marketSegmentId !== undefined ? ((dto as any).marketSegmentId ? { marketSegment: { connect: { id: (dto as any).marketSegmentId } } } : {}) : {})");

// Wait, the regex might be tricky. Let's just use simple string splitting.

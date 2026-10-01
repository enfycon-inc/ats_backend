const fs = require('fs');

function patch(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/bu\.market/g, "(bu as any).marketSegment?.code || 'US'");
  content = content.replace(/bu\.currency/g, "(bu as any).marketSegment?.defaultCurrency || 'USD'");
  content = content.replace(/u\.market/g, "(u as any).marketSegment?.code || 'US'");
  content = content.replace(/u\.currency/g, "(u as any).marketSegment?.defaultCurrency || 'USD'");
  content = content.replace(/existing\.market/g, "(existing as any).marketSegment?.code || 'US'");
  content = content.replace(/existing\.currency/g, "(existing as any).marketSegment?.defaultCurrency || 'USD'");
  fs.writeFileSync(file, content);
}

patch('src/branches/branches.service.ts');
patch('src/business-units/business-units.service.ts');
patch('src/jobs/jobs.service.ts');

console.log("Patched service files");

const fs = require('fs');
let bu = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

bu = bu.replace(/data: \{/g, "data: {");
// Wait, easier way:
// Change `this.prisma.businessUnit.create({` to `this.prisma.businessUnit.create({ data: { ... } as any`?
// No, I can just find the create block.

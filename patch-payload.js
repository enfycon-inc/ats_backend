const fs = require('fs');
let content = fs.readFileSync('src/business-units/business-units.service.ts', 'utf8');

// The create payload
content = content.replace(/          market,\n/, '');
content = content.replace(/          currency,\n/, '');

// The update payload
content = content.replace(/          market,\n/, '');
content = content.replace(/          currency,\n/, '');

fs.writeFileSync('src/business-units/business-units.service.ts', content);
console.log("Patched create/update payload");

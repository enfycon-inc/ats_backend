const fs = require('fs');
const file = 'Dockerfile.prod';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/npx prisma db push --skip-generate/g, 'npx prisma db push --skip-generate --accept-data-loss');

fs.writeFileSync(file, c);

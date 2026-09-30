const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/main.ts');
let content = fs.readFileSync(filePath, 'utf8');

const corsRegex = /app\.enableCors\(\{[\s\S]*?origin: true,[\s\S]*?credentials: true,[\s\S]*?\}\);/;
const safeCors = `app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
      const isAllowed = /localhost:\\d+$|\\.enfyjobs\\.com$|\\.enfycon\\.com$/i.test(origin) || allowedOrigins.includes(origin);
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed for this origin'));
      }
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-branch-id', 'x-custom-tenant-domain', 'x-tenant-domain'],
  });`;

content = content.replace(corsRegex, safeCors);
fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched main.ts for CORS');

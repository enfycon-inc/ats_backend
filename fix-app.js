const fs = require('fs'); 
let c = fs.readFileSync('src/app.module.ts', 'utf8'); 
c = c.replace("import { Module } from '@nestjs/common';", "import { Module } from '@nestjs/common';\nimport { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';\nimport { APP_GUARD } from '@nestjs/core';");
c = c.replace("imports: [", "imports: [\n    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),");
c = c.replace("providers: [", "providers: [\n    { provide: APP_GUARD, useClass: ThrottlerGuard },");
fs.writeFileSync('src/app.module.ts', c);

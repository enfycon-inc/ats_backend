const fs = require('fs'); 
let c = fs.readFileSync('src/auth/auth.controller.ts', 'utf8'); 
c = c.replace("@Get('diagnostic')", "@Get('diagnostic')\n  @UseGuards(JwtAuthGuard)");
fs.writeFileSync('src/auth/auth.controller.ts', c);

const fs = require('fs');
let c = fs.readFileSync('src/auth/auth.controller.ts', 'utf8');
const search = '  async refresh(@Body(\'refreshToken\') refreshToken: string) {\r\n    return this.authService.refreshKeycloakToken(refreshToken);\r\n  }';
const search2 = search.replace(/\r\n/g, '\n');

const replace = search2 + '\n\n  @Post(\'logout\')\n  @HttpCode(HttpStatus.OK)\n  async logout(@Body(\'refreshToken\') refreshToken: string) {\n    return this.authService.logoutKeycloakSession(refreshToken);\n  }';

if (c.includes(search)) {
  c = c.replace(search, replace);
  console.log('replaced with \\r\\n');
} else if (c.includes(search2)) {
  c = c.replace(search2, replace);
  console.log('replaced with \\n');
} else {
  console.log('not found');
}
fs.writeFileSync('src/auth/auth.controller.ts', c);

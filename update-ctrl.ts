import * as fs from 'fs';
const data = fs.readFileSync('src/auth/auth.controller.ts', 'utf8');
const lines = data.split('\n');
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// --- POST /api/auth/register-tenant')) {
    out.push('  // --- GET /api/auth/check-email ----------------------------------');
    out.push('  @Get(\'check-email\')');
    out.push('  @ApiOperation({');
    out.push('    summary: \'Check if an email is already registered globally (Public)\',');
    out.push('    description: \'Returns true if the email is available, false if already taken in any tenant.\',');
    out.push('  })');
    out.push('  @ApiResponse({ status: 200, description: \'Availability status returned.\' })');
    out.push('  async checkEmail(@Query(\'email\') email: string) {');
    out.push('    return this.authService.checkEmailAvailability(email);');
    out.push('  }');
    out.push('');
  }
  out.push(lines[i]);
}
fs.writeFileSync('src/auth/auth.controller.ts', out.join('\n'));

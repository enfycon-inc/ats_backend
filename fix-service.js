const fs = require('fs');
const data = fs.readFileSync('src/auth/auth.service.ts', 'utf8');
const lines = data.split('\n');
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('inviteUser(dto: InviteUserDto')) {
    out.push('  async checkEmailAvailability(email: string) {');
    out.push('    return this.coreService.checkEmailAvailability(email);');
    out.push('  }');
    out.push('');
  }
  out.push(lines[i]);
}
fs.writeFileSync('src/auth/auth.service.ts', out.join('\n'));

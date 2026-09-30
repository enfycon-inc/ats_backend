const fs = require('fs');
const data = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');
const lines = data.split('\n');
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('async login(dto: { email: string; password: string; subdomain?: string }) {')) {
    out.push('  async checkEmailAvailability(email: string) {');
    out.push('    if (!email) throw new BadRequestException(\'Email is required.\');');
    out.push('    const cleanEmail = email.trim().toLowerCase();');
    out.push('    const result = await this.authQuery.query(\'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1\', [cleanEmail]);');
    out.push('    return { available: result.rows.length === 0 };');
    out.push('  }');
    out.push('');
  }
  out.push(lines[i]);
}
fs.writeFileSync('src/auth/services/auth-core.service.ts', out.join('\n'));

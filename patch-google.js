const fs = require('fs');
let c = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8');
const search1 = "    const brokerClaims = dto.provider?.toLowerCase() === 'keycloak'\n      ? await this.verifyBrokerAccessToken(dto.accessToken)\n      : null;";
const search2 = "    const brokerClaims = dto.provider?.toLowerCase() === 'keycloak'\r\n      ? await this.verifyBrokerAccessToken(dto.accessToken)\r\n      : null;";
const repl = "    let brokerClaims = null;\n    if (dto.provider?.toLowerCase() === 'keycloak') {\n      brokerClaims = await this.verifyBrokerAccessToken(dto.accessToken);\n    } else if (dto.provider?.toLowerCase() === 'google') {\n      if (!dto.idToken) throw new UnauthorizedException('Google ID token is required for verification.');\n      const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + dto.idToken).catch(() => null);\n      if (!res || !res.ok) throw new UnauthorizedException('Invalid Google ID token.');\n      brokerClaims = await res.json();\n    }";
c = c.replace(search1, repl).replace(search2, repl);
fs.writeFileSync('src/auth/services/auth-core.service.ts', c);

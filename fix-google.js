const fs = require('fs'); 
let c = fs.readFileSync('src/auth/services/auth-core.service.ts', 'utf8'); 
const orig =   async ssoLogin(dto: SsoLoginDto) {
    const brokerClaims = dto.provider?.toLowerCase() === 'keycloak'
      ? await this.verifyBrokerAccessToken(dto.accessToken)
      : null;
    const cleanEmail = (brokerClaims?.email || dto.email || '').trim().toLowerCase();;
const repl =   async ssoLogin(dto: SsoLoginDto) {
    let brokerClaims = null;
    if (dto.provider?.toLowerCase() === 'keycloak') {
      brokerClaims = await this.verifyBrokerAccessToken(dto.accessToken);
    } else if (dto.provider?.toLowerCase() === 'google') {
      if (!dto.idToken) throw new UnauthorizedException('Google ID token is required for verification.');
      const res = await fetch(\https://oauth2.googleapis.com/tokeninfo?id_token=\\).catch(() => null);
      if (!res || !res.ok) throw new UnauthorizedException('Invalid Google ID token.');
      brokerClaims = await res.json();
    }
    const cleanEmail = (brokerClaims?.email || dto.email || '').trim().toLowerCase();;
c = c.replace(orig, repl);
fs.writeFileSync('src/auth/services/auth-core.service.ts', c);

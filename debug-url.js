const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
const baseUrl = issuer.split('/realms/')[0];
const idpUrl = (baseUrl.includes('localhost') ? baseUrl.replace('localhost', 'keycloak') : baseUrl.replace('keycloak', 'localhost')) + '/admin/realms/' + realm + '/identity-provider/instances';
console.log('KEYCLOAK_ISSUER:', issuer);
console.log('baseUrl:', baseUrl);
console.log('idpUrl:', idpUrl);
// Try a direct call
fetch(idpUrl, { headers: { 'Authorization': 'Bearer test' } })
  .then(r => { console.log('Status:', r.status); return r.text(); })
  .then(t => console.log('Body:', t.substring(0, 200)))
  .catch(e => console.log('Error:', e.message));

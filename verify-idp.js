async function check() {
  const tokenRes = await fetch('http://keycloak:8080/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin&grant_type=password&client_id=admin-cli'
  }).then(r => r.json());
  const token = tokenRes.access_token;
  const idps = await fetch('http://keycloak:8080/admin/realms/enfycon-ats/identity-provider/instances', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());
  console.log('IdP count:', idps.length);
  idps.forEach(i => console.log(' -', i.alias, '| enabled:', i.enabled, '| providerId:', i.providerId));
}
check().catch(console.error);

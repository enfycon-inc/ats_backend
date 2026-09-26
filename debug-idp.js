async function provision() {
  // Step 1: Get admin token
  const tokenRes = await fetch('http://keycloak:8080/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin&grant_type=password&client_id=admin-cli'
  }).then(r => r.json());
  const token = tokenRes.access_token;
  console.log('Token obtained:', !!token);

  // Step 2: Check existing IdPs
  const existing = await fetch('http://keycloak:8080/admin/realms/enfycon-ats/identity-provider/instances', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());
  console.log('Existing IdPs:', existing.map(i => i.alias));

  // Step 3: Read actual stored credentials from DB
  const dbRes = await fetch('http://localhost:5000/api/debug/sso-creds').catch(() => null);
  console.log('DB endpoint:', dbRes ? dbRes.status : 'N/A');
}
provision().catch(console.error);

const http = require('http');
async function fixRedirectUris() {
  const tokenRes = await fetch('http://keycloak:8080/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin&grant_type=password&client_id=admin-cli'
  }).then(r => r.json());
  
  const token = tokenRes.access_token;
  const clients = await fetch('http://keycloak:8080/admin/realms/enfycon-ats/clients?clientId=enfycon-ats', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());

  const client = clients[0];
  const newUris = new Set(client.redirectUris || []);
  newUris.add('http://deb.localhost:3000/*');
  newUris.add('http://localhost:3000/*');
  
  client.redirectUris = Array.from(newUris);
  await fetch('http://keycloak:8080/admin/realms/enfycon-ats/clients/' + client.id, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(client)
  });
}
fixRedirectUris().catch(console.error);

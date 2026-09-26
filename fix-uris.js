const http = require('http');

async function fixRedirectUris() {
  const tokenRes = await fetch('http://keycloak:8080/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin&grant_type=password&client_id=admin-cli'
  }).then(r => r.json());
  
  const token = tokenRes.access_token;
  if (!token) {
    console.error('Failed to get token:', tokenRes);
    return;
  }

  const clients = await fetch('http://keycloak:8080/admin/realms/enfycon-ats/clients?clientId=enfycon-ats', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());

  if (!clients || clients.length === 0) {
    console.error('Client enfycon-ats not found');
    return;
  }

  const client = clients[0];
  console.log('Current redirect URIs:', client.redirectUris);

  // Add the required URIs
  const newUris = new Set(client.redirectUris || []);
  newUris.add('http://*.localhost:3000/*');
  newUris.add('https://*.enfyjobs.com/*');
  
  client.redirectUris = Array.from(newUris);
  
  const updateRes = await fetch('http://keycloak:8080/admin/realms/enfycon-ats/clients/' + client.id, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(client)
  });

  if (updateRes.ok) {
    console.log('Successfully updated redirect URIs:', client.redirectUris);
  } else {
    console.error('Failed to update:', await updateRes.text());
  }
}

fixRedirectUris().catch(console.error);

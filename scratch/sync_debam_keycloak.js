const { Client } = require('pg');

async function syncKeycloak() {
  const keycloakUrl = process.env.KEYCLOAK_URL || "http://localhost:8080";
  const realm = process.env.KEYCLOAK_REALM || "enfycon-ats";
  const adminUser = process.env.KEYCLOAK_ADMIN || "admin";
  const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";

  try {
    console.log(`Connecting to Keycloak at ${keycloakUrl}...`);
    // 1. Get Master Admin Token
    const tokenRes = await fetch(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: adminUser,
        password: adminPass,
      }),
    });

    if (!tokenRes.ok) {
      console.error('Failed to get master admin token from Keycloak:', tokenRes.statusText);
      return;
    }

    const { access_token } = await tokenRes.json();
    console.log('Got master admin token.');

    // 2. Search for debam@deb.com in enfycon-ats realm
    const searchRes = await fetch(`${keycloakUrl}/admin/realms/${realm}/users?email=debam@deb.com`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const users = await searchRes.json();
    let userId = null;

    if (users && users.length > 0) {
      userId = users[0].id;
      console.log(`Found user debam@deb.com in Keycloak ID: ${userId}`);
    } else {
      // Create user
      console.log('User debam@deb.com not found in Keycloak. Creating user...');
      const createRes = await fetch(`${keycloakUrl}/admin/realms/${realm}/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'debam@deb.com',
          email: 'debam@deb.com',
          firstName: 'Debam',
          lastName: 'Manager',
          enabled: true,
          emailVerified: true,
          credentials: [
            {
              type: 'password',
              value: 'enfycon123',
              temporary: false,
            },
          ],
        }),
      });

      if (createRes.ok || createRes.status === 201) {
        console.log('✅ Created user debam@deb.com in Keycloak with password enfycon123.');
      } else {
        console.error('Failed to create user in Keycloak:', await createRes.text());
        return;
      }
    }

    if (userId) {
      // Reset password for debam@deb.com to enfycon123
      const resetRes = await fetch(`${keycloakUrl}/admin/realms/${realm}/users/${userId}/reset-password`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'password',
          value: 'enfycon123',
          temporary: false,
        }),
      });

      if (resetRes.ok) {
        console.log('✅ Updated password for debam@deb.com in Keycloak to enfycon123.');
      } else {
        console.error('Failed to reset password in Keycloak:', await resetRes.text());
      }
    }

  } catch (err) {
    console.error('Keycloak Sync Error:', err);
  }
}

syncKeycloak();

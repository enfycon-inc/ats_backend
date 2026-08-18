async function testClients() {
  try {
    const adminRes = await fetch("http://127.0.0.1:8080/realms/master/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        username: "admin",
        password: "admin",
        grant_type: "password",
      }),
    });
    const adminData = await adminRes.json();
    const token = adminData.access_token;

    const clientsRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/clients", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const clients = await clientsRes.json();
    console.log("CLIENTS IN ENFYCON-ATS:", clients.map(c => ({ clientId: c.clientId, secret: c.secret, directAccessGrantsEnabled: c.directAccessGrantsEnabled, publicClient: c.publicClient })));

    // Test password grant on ats client
    for (const c of clients) {
      if (!c.directAccessGrantsEnabled) continue;
      console.log(`\nTesting auth with client '${c.clientId}'...`);
      const body = {
        client_id: c.clientId,
        username: "debam@deb.com",
        password: "password123",
        grant_type: "password"
      };
      if (c.secret) body.client_secret = c.secret;

      const r = await fetch("http://127.0.0.1:8080/realms/enfycon-ats/protocol/openid-connect/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body)
      });
      const resData = await r.json();
      if (resData.access_token) {
        console.log(`✅ SUCCESS WITH CLIENT '${c.clientId}'! Access Token:`, resData.access_token.substring(0, 35) + "...");
      } else {
        console.log(`❌ Client '${c.clientId}' error:`, resData);
      }
    }

  } catch (err) {
    console.error(err);
  }
}
testClients();

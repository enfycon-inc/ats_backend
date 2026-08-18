async function fixUserActions() {
  try {
    console.log("1. Getting admin token...");
    const tokenRes = await fetch("http://127.0.0.1:8080/realms/master/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        username: "admin",
        password: "admin",
        grant_type: "password",
      }),
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    console.log("2. Fetching users in enfycon-ats realm...");
    const usersRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/users", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const users = await usersRes.json();

    for (const u of users) {
      if (u.username === 'service-account-ats') continue;
      console.log(`Clearing requiredActions and verifying email for '${u.username}'...`);
      await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/users/${u.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ...u,
          emailVerified: true,
          requiredActions: []
        })
      });
    }

    console.log("\n3. Testing authentication for debam@deb.com...");
    const authRes = await fetch("http://127.0.0.1:8080/realms/enfycon-ats/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "ats",
        client_secret: "1EXjjhVK0vSZPPS6lX2ajuYptmEIaLOS",
        username: "debam@deb.com",
        password: "password123",
        grant_type: "password"
      })
    });
    const authData = await authRes.json();
    if (authData.access_token) {
      console.log("\n🎉 AUTHENTICATION SUCCESSFUL! JWT ACCESS TOKEN OBTAINED FROM SUPABASE DB BACKED KEYCLOAK!");
      console.log("Token Scope:", authData.scope);
      console.log("Token Type:", authData.token_type);
      console.log("Expires In:", authData.expires_in, "seconds");
    } else {
      console.error("\n❌ Auth failed:", authData);
    }

  } catch (err) {
    console.error("Fix script failed:", err.message);
  }
}

fixUserActions();

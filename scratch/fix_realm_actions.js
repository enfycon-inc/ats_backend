async function fixRealmActions() {
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

    console.log("1. Disabling required actions at realm level...");
    const actionsRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/authentication/required-actions", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const actions = await actionsRes.json();
    console.log("Required actions:", actions.map(a => ({ alias: a.alias, name: a.name, enabled: a.enabled, defaultAction: a.defaultAction })));

    for (const a of actions) {
      if (a.defaultAction) {
        console.log(`Disabling defaultAction for '${a.alias}'...`);
        await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/authentication/required-actions/${a.alias}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ ...a, defaultAction: false })
        });
      }
    }

    console.log("\n2. Resetting password for debam@deb.com explicitly...");
    const usersRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/users?username=debam@deb.com", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const users = await usersRes.json();
    const debam = users[0];

    // Reset password with temporary: false
    await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/users/${debam.id}/reset-password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        type: "password",
        value: "password123",
        temporary: false
      })
    });

    // Update user: emailVerified true, requiredActions empty
    await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/users/${debam.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        ...debam,
        emailVerified: true,
        requiredActions: []
      })
    });

    console.log("\n3. Testing authentication for debam@deb.com...");
    const r = await fetch("http://127.0.0.1:8080/realms/enfycon-ats/protocol/openid-connect/token", {
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
    const resData = await r.json();
    if (resData.access_token) {
      console.log("🎉 SUCCESS! JWT ACCESS TOKEN OBTAINED FROM SUPABASE KEYCLOAK DATABASE:");
      console.log("Token:", resData.access_token.substring(0, 50) + "...");
    } else {
      console.error("❌ Still failed:", resData);
    }

  } catch (err) {
    console.error(err);
  }
}
fixRealmActions();

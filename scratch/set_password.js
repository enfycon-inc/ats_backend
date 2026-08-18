async function setPasswords() {
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
    console.log("Admin token obtained!");

    console.log("2. Fetching users in enfycon-ats realm...");
    const usersRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/users", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const users = await usersRes.json();
    console.log(`Found ${users.length} users in enfycon-ats:`, users.map(u => u.username));

    for (const u of users) {
      if (u.username === 'service-account-ats') continue;
      console.log(`Resetting password to 'password123' for user '${u.username}'...`);
      const resetRes = await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/users/${u.id}/reset-password`, {
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
      console.log(`Reset password for '${u.username}' status:`, resetRes.status);
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
      console.log("\n✅ AUTHENTICATION SUCCESSFUL FOR debam@deb.com ON SUPABASE DB!");
      console.log("Access Token received:", authData.access_token.substring(0, 40) + "...");
    } else {
      console.error("\n❌ Auth failed:", authData);
    }

  } catch (err) {
    console.error("Set password script failed:", err.message);
  }
}

setPasswords();

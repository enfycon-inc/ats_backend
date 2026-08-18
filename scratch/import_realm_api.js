const fs = require('fs');

async function importRealm() {
  try {
    console.log("1. Fetching Admin Access Token from Keycloak...");
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
    if (!tokenData.access_token) {
      console.error("Failed to get admin token:", tokenData);
      return;
    }
    console.log("Admin token obtained successfully!");

    console.log("2. Reading exported realm JSON file...");
    const realmJsonPath = "c:/Users/deb/enfyProjects/ATS_DOCKERREPO/keycloak/imports/enfycon-ats-realm.json";
    const realmData = JSON.parse(fs.readFileSync(realmJsonPath, 'utf8'));

    console.log("3. Importing 'enfycon-ats' realm into Supabase Keycloak database...");
    const importRes = await fetch("http://127.0.0.1:8080/admin/realms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify(realmData),
    });

    if (importRes.status === 201 || importRes.status === 200 || importRes.status === 409) {
      console.log("REALM IMPORT SUCCESSFUL! Status:", importRes.status);
    } else {
      const errText = await importRes.text();
      console.error("Realm import error:", importRes.status, errText);
    }

    console.log("4. Reading exported users JSON file...");
    const usersJsonPath = "c:/Users/deb/enfyProjects/ATS_DOCKERREPO/keycloak/imports/enfycon-ats-users-0.json";
    if (fs.existsSync(usersJsonPath)) {
      const usersData = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
      console.log(`Found ${usersData.length} users to import into 'enfycon-ats'...`);
      for (const u of usersData) {
        const uRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenData.access_token}`,
          },
          body: JSON.stringify(u),
        });
        console.log(`User '${u.username}' import status:`, uRes.status);
      }
    }

  } catch (err) {
    console.error("Import script failed:", err.message);
  }
}

importRealm();

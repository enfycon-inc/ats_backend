async function getUserDetails() {
  try {
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

    const usersRes = await fetch("http://127.0.0.1:8080/admin/realms/enfycon-ats/users?username=debam@deb.com", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const users = await usersRes.json();
    console.log("DEBAM USER DETAILS:", JSON.stringify(users[0], null, 2));

    const credsRes = await fetch(`http://127.0.0.1:8080/admin/realms/enfycon-ats/users/${users[0].id}/credentials`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const creds = await credsRes.json();
    console.log("DEBAM CREDENTIALS:", JSON.stringify(creds, null, 2));

  } catch (err) {
    console.error(err);
  }
}
getUserDetails();

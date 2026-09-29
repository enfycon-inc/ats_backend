

// Create a dummy token for Sahadeb Barman (isApproved: false, tenantId: 737f666b-916a-4e9c-91bd-b2bd37e475d1)
// Wait, we need a REAL token signed by Keycloak, OR we can just hit the login endpoint to get one!

async function test() {
  const res = await fetch("http://127.0.0.1:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sahadeb@enfycon.com",
      password: "Password123!", // assuming this is a test account
      subdomain: "deb"
    })
  });
  const data = await res.json();
  console.log("Login:", data);
  if (data.accessToken) {
    const bRes = await fetch("http://127.0.0.1:5000/api/branches", {
      headers: {
        "Authorization": `Bearer ${data.accessToken}`,
        "x-tenant-domain": "deb"
      }
    });
    const branches = await bRes.json();
    console.log("Branches:", branches);
  }
}

test().catch(console.error);

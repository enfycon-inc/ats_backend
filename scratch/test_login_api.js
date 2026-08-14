async function testApiLogin() {
  try {
    const res = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "debam@deb.com",
        password: "enfycon123",
      }),
    });

    console.log("Login Response Status:", res.status);
    const data = await res.json();
    console.log("Login Response Data:", data);

  } catch (err) {
    console.error("API Login Error:", err);
  }
}

testApiLogin();

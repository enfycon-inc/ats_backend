

async function testE2E() {
  try {
    console.log('=== 1. TEST LOGIN API FOR debam@deb.com ===');
    const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'debam@deb.com', password: 'enfycon123' })
    });

    console.log('Login Status:', loginRes.status);
    const loginData = await loginRes.json();
    console.log('Login User Data:', JSON.stringify(loginData.user, null, 2));

    const token = loginData.accessToken;
    const tenantId = loginData.user.tenantId;
    const branchId = loginData.user.branchId;

    console.log('\n=== 2. TEST GET /api/auth/me ===');
    const meRes = await fetch('http://127.0.0.1:5000/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': tenantId
      }
    });
    console.log('/api/auth/me Status:', meRes.status);
    const meData = await meRes.json();
    console.log('/api/auth/me Data:', JSON.stringify(meData, null, 2));

    console.log('\n=== 3. TEST GET /api/branches ===');
    const branchesRes = await fetch('http://127.0.0.1:5000/api/branches', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': tenantId
      }
    });
    console.log('/api/branches Status:', branchesRes.status);
    const branchesData = await branchesRes.json();
    console.log('/api/branches Data:', JSON.stringify(branchesData, null, 2));

    console.log('\n=== 4. TEST GET /api/jobs ===');
    const jobsRes = await fetch('http://127.0.0.1:5000/api/jobs', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': tenantId,
        'x-branch-id': branchId
      }
    });
    console.log('/api/jobs Status:', jobsRes.status);
    const jobsData = await jobsRes.json();
    console.log(`Returned ${Array.isArray(jobsData) ? jobsData.length : 0} jobs.`);

    console.log('\n=== 5. TEST GET /email/accounts ===');
    const emailRes = await fetch('http://127.0.0.1:5000/email/accounts', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': tenantId
      }
    });
    console.log('/email/accounts Status:', emailRes.status);
    const emailData = await emailRes.json();
    console.log('Email Accounts:', JSON.stringify(emailData, null, 2));
    if (Array.isArray(jobsData)) {
      console.table(jobsData.slice(0, 10).map(j => ({
        id: j.id,
        jobCode: j.jobCode,
        jobTitle: j.jobTitle,
        market: j.market,
        branchId: j.branchId,
        branchName: j.branchName,
        accountManagerId: j.accountManagerId,
        createdBy: j.createdBy
      })));
    } else {
      console.log('Error Data:', jobsData);
    }

  } catch (err) {
    console.error('E2E Test Error:', err);
  }
}

testE2E();

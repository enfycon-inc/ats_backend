const https = require('http');

const data = JSON.stringify({
  email: 'admin@enfycon.com',
  password: 'AtsDevPass2024'
});

const req = https.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Response:', JSON.parse(body)));
});

req.on('error', console.error);
req.write(data);
req.end();

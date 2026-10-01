const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000, 
  path: '/api/branches',
  method: 'GET',
  headers: {
    'x-tenant-id': '737f666b-916a-4e9c-91bd-b2bd37e475d1'
  }
};
const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const b = JSON.parse(data).find(x => x.name === 'Vizag');
      console.log('API managers for Vizag:', b.managers);
    } catch(e) { console.log(data); }
  });
});
req.end();

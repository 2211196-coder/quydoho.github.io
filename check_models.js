const https = require('https');

const apiKey = process.env.GROQ_API_KEY || ''; // The default API key from server.js

const options = {
  hostname: 'api.groq.com',
  path: '/openai/v1/models',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${apiKey}`
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log("AVAILABLE MODELS:");
      json.data.forEach(m => console.log(m.id));
    } catch(e) {
      console.log(data);
    }
  });
});

req.on('error', e => console.error(e));
req.end();

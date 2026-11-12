const https = require('https');

const data = JSON.stringify({
  api_key: process.env.TAVILY_API_KEY,
  query: 'Gmail spam trigger words list B2B cold email avoid 2024',
  max_results: 5,
  include_answer: true
});

const options = {
  hostname: 'api.tavily.com',
  path: '/search',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      if (result.answer) {
        console.log('=== AI Answer ===');
        console.log(result.answer);
      }
      if (result.results) {
        result.results.forEach((r, i) => {
          console.log(`\n=== Result ${i+1}: ${r.title} ===`);
          console.log(r.url);
          console.log((r.content || '').substring(0, 800));
        });
      }
      if (result.error) console.log('ERROR:', result.error);
    } catch(e) { console.log('Parse error:', e.message, body.substring(0, 500)); }
  });
});
req.on('error', e => console.log('Request error:', e.message));
req.write(data);
req.end();

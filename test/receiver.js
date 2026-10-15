// Receptor local de webhooks de prueba: verifica la firma HMAC y guarda lo recibido en test/webhooks-recibidos.jsonl
const http = require('http'), crypto = require('crypto'), fs = require('fs');
const SECRETS = () => JSON.parse(fs.readFileSync(__dirname + '/../data.json')).projects.reduce((m, p) => (m[p.slug] = p.webhook_secret, m), {});
http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
  const ev = JSON.parse(b), ts = req.headers['x-tuberia-timestamp'];
  const exp = 'sha256=' + crypto.createHmac('sha256', SECRETS()[ev.project]).update(`${ts}.${b}`).digest('hex');
  const valid = req.headers['x-tuberia-signature'] === exp;
  fs.appendFileSync(__dirname + '/webhooks-recibidos.jsonl', JSON.stringify({ valid, event: ev.event, data: ev.data }) + '\n');
  res.writeHead(valid ? 200 : 401).end(); }); }).listen(4000, () => console.log('receptor en :4000'));

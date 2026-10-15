// Servidor falso que imita las API de Brevo/Resend (para probar sin cuentas). Guarda lo recibido en test/mail-api-recibido.jsonl
const http = require('http'), fs = require('fs');
http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
  fs.appendFileSync(__dirname + '/mail-api-recibido.jsonl', JSON.stringify({ path: req.url, auth: req.headers['api-key'] || req.headers.authorization, body: JSON.parse(b) }) + '\n');
  res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ messageId: '<mock@brevo>' })); }); }).listen(4100, () => console.log('mock mail api :4100'));

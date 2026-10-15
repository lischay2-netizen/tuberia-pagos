// Prueba de punta a punta de producto digital (servidor en :3000).
const fs = require('fs'), assert = require('assert'); const B = 'http://localhost:3000';
const ok = m => console.log('✔', m);
(async () => {
  const b64 = fs.readFileSync('samples/partitura-ejemplo.pdf').toString('base64');
  const mk = async (name, amount) => (await (await fetch(B + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, type: 'digital', amount, merchant_id: 'bg_comercio_partituras', author: 'Lischay', seller: 'lischay', file_b64: b64 }) })).json());
  const p = await mk('Alfonsina y el Mar – Piano', 7.5); await mk('Bésame Mucho – Guitarra', 5); ok('2 productos digitales creados: /p/' + p.slug);
  const bad = await fetch(B + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X', type: 'digital', amount: 1, merchant_id: 'x', file_b64: Buffer.from('hola').toString('base64') }) });
  assert.equal(bad.status, 400); ok('archivo no-PDF rechazado');
  const t = await (await fetch(B + '/p/' + p.slug + '/pay', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ cardnumber: '4111111111111111', 'cc-exp': '12/28', cvc: '123', buyer: 'María Pérez', email: 'maria@correo.com' }) })).text();
  const link = t.match(/href="(http[^"]+\/d\/[^"]+)"/)[1]; ok('pago aprobado, link en confirmación: ' + link);
  const mail = fs.readdirSync('outbox').filter(f => f.includes('maria') && f.endsWith('.html')).map(f => fs.readFileSync('outbox/' + f, 'utf8')).pop();
  assert(mail.includes(link)); ok('mismo link en el recibo del outbox');
  const r = await fetch(link); assert.equal(r.headers.get('content-type'), 'application/pdf');
  fs.writeFileSync('samples/descarga-maria.pdf', Buffer.from(await r.arrayBuffer())); ok('PDF con marca de agua descargado → samples/descarga-maria.pdf');
  for (let i = 2; i <= 5; i++) assert.equal((await fetch(link)).status, 200);
  assert.equal((await fetch(link)).status, 410); ok('descargas 2-5 OK, la 6ª bloqueada (410)');
  assert.equal((await fetch(B + '/d/tokenfalso')).status, 404); ok('token falso → 404');
  const cat = await (await fetch(B + '/tienda/lischay')).text(); assert(cat.includes('Alfonsina') && cat.includes('Bésame')); ok('catálogo /tienda/lischay lista los 2 productos');
})().catch(e => { console.error('✘', e); process.exit(1); });

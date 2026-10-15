// Prueba de punta a punta (con el servidor en :3000 y el receptor en :4000 corriendo, data.json vacío).
const fs = require('fs'), assert = require('assert');
const B = 'http://localhost:3000', J = { 'content-type': 'application/json' }, F = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (u, b, form) => fetch(B + u, { method: 'POST', headers: form ? F : J, body: form ? new URLSearchParams(b) : JSON.stringify(b), redirect: 'manual' });
const ok = m => console.log('✔', m);
(async () => {
  await post('/api/projects', { name: 'Juego de Mateo – Premium', type: 'subscription', amount: 4.99, merchant_id: 'bg_comercio_juegos', webhook_url: 'http://localhost:4000/hook' });
  await post('/api/projects', { name: 'Donación Comunidad', type: 'donation', merchant_id: 'bg_comercio_fundacion', webhook_url: 'http://localhost:4000/hook' });
  const card = (c, email) => ({ cardnumber: c, 'cc-exp': '12/28', cvc: '123', email });
  let t = await (await post('/p/juego-de-mateo-premium/pay', card('4111111111111111', 'ana@correo.com'), 1)).text(); assert(t.includes('¡Pago listo!')); ok('suscripción con tarjeta buena aprobada');
  t = await (await post('/p/juego-de-mateo-premium/pay', card('4000000000000341', 'luis@correo.com'), 1)).text(); assert(t.includes('¡Pago listo!')); ok('suscripción con tarjeta 0341 aprobada (fallará al renovar)');
  t = await (await post('/p/donacion-comunidad/pay', { ...card('4000000000000002', 'x@correo.com'), amount: 10 }, 1)).text(); assert(t.includes('El pago no se hizo')); ok('tarjeta 0002 rechazada');
  t = await (await post('/p/donacion-comunidad/pay', { amount: 15, wallet: 'google_pay' }, 1)).text(); assert(t.includes('¡Pago listo!')); ok('Google Pay (simulado) aprobado');
  const runs = [];
  const d0 = new Date(); const at = days => new Date(d0.getTime() + days * 864e5).toISOString();
  for (const d of [32, 35, 38]) runs.push(await (await post('/api/billing/run', { now: at(d) })).json());
  console.log(JSON.stringify(runs, null, 1));
  const subs = await (await fetch(B + '/api/subscriptions')).json();
  const ana = subs.find(s => s.email === 'ana@correo.com'), luis = subs.find(s => s.email === 'luis@correo.com');
  assert.equal(luis.status, 'canceled'); assert.equal(luis.retries, 3); ok('0341: 3 fallos (día 32, 35, 38) → cancelada');
  assert.equal(ana.status, 'active'); ok('ana: renovada día 32, sigue activa');
  // autoservicio: sacar link de cancelar del recibo de ana
  const f = fs.readdirSync('outbox').filter(x => x.includes('ana') && x.endsWith('.html')).map(x => fs.readFileSync('outbox/' + x, 'utf8')).find(h => h.includes('/cancelar?t='));
  const link = f.match(/href="([^"]*cancelar\?t=[^"]*)"/)[1];
  assert((await (await fetch(link.replace('t=', 't=x'))).status) === 404); ok('link con token alterado → 404');
  t = await (await fetch(link)).text(); assert(t.includes('Sí, cancelar'));
  t = await (await fetch(link, { method: 'POST', headers: F, body: new URLSearchParams({ t: new URL(link).searchParams.get('t') }) })).text(); assert(t.includes('Suscripción cancelada')); ok('cliente canceló desde el link del recibo');
  await new Promise(r => setTimeout(r, 500));
  const hooks = fs.readFileSync('test/webhooks-recibidos.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert(hooks.length > 0 && hooks.every(h => h.valid)); ok(`${hooks.length} webhooks recibidos, todos con firma HMAC válida: ` + hooks.map(h => h.event).join(', '));
  console.log('✔ correos en outbox:', fs.readdirSync('outbox').filter(x => x.endsWith('.eml')).length);
})().catch(e => { console.error('✘', e); process.exit(1); });

const express = require('express');
const crypto = require('crypto');
const { db, save, init: initDb, close: closeDb, backend: dbBackend } = require('./db');
const digital = require('./digital');
const processor = require('./adapters/' + (process.env.PROCESSOR || 'mock'));
const mailer = require('./mailer');
const fees = require('./fees');
const yappy = require('./adapters/' + (process.env.YAPPY || 'yappy-mock'));
const app = express();
app.use(express.urlencoded({ extended: true, limit: '30mb' })); app.use(express.json({ limit: '30mb' }));
app.set('trust proxy', 'loopback');
const clientIp = req => req.headers['cf-connecting-ip'] || req.ip;
// Cabeceras de seguridad
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://pay.google.com")',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://pay.google.com https://applepay.cdn-apple.com https://bt-cdn.yappy.cloud; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self' https://bt-cdn.yappy.cloud https://apipagosbg.bgeneral.cloud https://google.com https://pay.google.com https://*.google.com https://applepay.cdn-apple.com; font-src 'self' data: https://fonts.gstatic.com https://bt-cdn.yappy.cloud https://applepay.cdn-apple.com https://fonts.gstatic.com; frame-src https://pay.google.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'" });
  res.removeHeader('X-Powered-By'); next();
});
// Límite simple de peticiones por IP (en memoria)
const buckets = new Map();
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const k = name + ':' + clientIp(req), now = Date.now(); let b = buckets.get(k);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
  if (++b.n > max) { res.set('Retry-After', Math.ceil((b.reset - now) / 1000)); return res.status(429).send('Demasiados intentos. Espera un momento.'); }
  next();
};
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();
app.use('/d/', rateLimit('d', 20, 10 * 60 * 1000));
app.use('/p/', rateLimit('p', 60, 60 * 1000));
app.use('/s/', rateLimit('s', 20, 10 * 60 * 1000));
// Panel y API protegidos con contraseña (Basic Auth, usuario "admin"); máximo 10 intentos fallidos por IP cada 15 min
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const fails = new Map();
app.use(['/admin', '/api'], (req, res, next) => {
  if (!ADMIN_PASSWORD) return next();
  const ip = clientIp(req), f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() < f.until) return res.status(429).send('Demasiados intentos. Espera 15 minutos.');
  const [u, ...rest] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
  const ha = crypto.createHash('sha256').update(rest.join(':')).digest(), hb = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (u === 'admin' && crypto.timingSafeEqual(ha, hb)) { fails.delete(ip); return next(); }
  if (req.headers.authorization) { const g = fails.get(ip) || { n: 0 }; g.n++; g.until = Date.now() + 15 * 60 * 1000; fails.set(ip, g); }
  res.set('WWW-Authenticate', 'Basic realm="Panel", charset="UTF-8"').status(401).send('Se requiere contraseña');
});
// Solo se sirve public/ (style.css, button.js). files/, samples/, outbox/, data.json y .env NO están ahí.
app.use(express.static(__dirname + '/../public', { index: false, dotfiles: 'deny', redirect: false }));
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET = process.env.APP_SECRET || 'dev-secret-cambiar';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slugify = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const TYPES = { donation: 'Donación', subscription: 'Suscripción mensual', one_time: 'Pago único', digital: 'Producto digital' };
const money = n => '$' + Number(n).toFixed(2);
const fdate = d => new Date(d).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Panama' });
const SIM = processor.name === 'mock' ? '<div class="sim">MODO SIMULACIÓN · no se cobra dinero real<br><small>No escribas datos de una tarjeta real. Usa 4111 1111 1111 1111</small></div>' : '';
const layout = (title, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body>${SIM}${body}</body></html>`;
const cancelToken = sid => crypto.createHmac('sha256', SECRET).update('cancel:' + sid).digest('hex').slice(0, 32);
const cancelUrl = s => `${BASE}/s/${s.id}/cancelar?t=${cancelToken(s.id)}`;
db.subscriptions ||= []; db.downloads ||= [];
const dlUrl = d => `${BASE}/d/${d.token}`;

// ---------- Webhooks salientes firmados (HMAC-SHA256) ----------
async function notifyProject(p, event, data) {
  if (!p.webhook_url) return;
  const body = JSON.stringify({ id: crypto.randomUUID(), event, project: p.slug, created_at: new Date().toISOString(), data });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', p.webhook_secret).update(`${ts}.${body}`).digest('hex');
  try { await fetch(p.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tuberia-timestamp': ts, 'x-tuberia-signature': 'sha256=' + sig }, body }); }
  catch (e) { console.error('webhook fallo', p.webhook_url, e.message); }
}

// ---------- Recibo por correo ----------
function receiptHtml(p, pay, sub, dl) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f3f3f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="100%" style="max-width:460px;background:#fff;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px;text-align:center">
<div style="width:56px;height:56px;border-radius:50%;background:#1db954;color:#fff;font-size:30px;line-height:56px;margin:0 auto">✓</div>
<h1 style="font-size:22px;margin:14px 0 4px">Recibo de pago</h1>
<div style="color:#666">${esc(p.name)}</div>
<div style="font-size:40px;font-weight:bold;margin:14px 0">${money(pay.amount)}</div>
<table width="100%" style="font-size:14px;text-align:left;border-top:1px solid #eee" cellpadding="8">
<tr><td style="color:#666">Fecha</td><td align="right">${fdate(pay.created_at)}</td></tr>
<tr><td style="color:#666">Tipo</td><td align="right">${TYPES[p.type]}${pay.recurring ? ' (cobro automático)' : ''}</td></tr>
<tr><td style="color:#666">Medio de pago</td><td align="right">${esc(pay.brand || 'Tarjeta')} •••• ${esc(pay.last4 || '')}</td></tr>
<tr><td style="color:#666">Comprobante</td><td align="right">${esc(pay.transaction_id)}</td></tr>
${dl ? `</table><a href="${dlUrl(dl)}" style="display:block;background:#1a73e8;color:#fff;text-decoration:none;border-radius:12px;padding:16px;font-size:18px;font-weight:bold;margin-top:20px">Descargar PDF</a><p style="font-size:12px;color:#666">El link vence el ${fdate(dl.expires_at)} y permite ${dl.max} descargas. El PDF lleva tu nombre y número de pedido; es para uso personal.</p><table>` : ''}
${sub ? `<tr><td style="color:#666">Próximo cobro</td><td align="right">${fdate(sub.next_charge_at)}</td></tr>` : ''}
</table>
${sub ? `<p style="font-size:13px;color:#666;margin-top:20px">Se cobra solo cada mes. ¿Ya no lo quieres? <a href="${cancelUrl(sub)}" style="color:#1a73e8">Cancelar suscripción</a></p>` : ''}
<p style="font-size:12px;color:#999;margin-top:20px">Guarda este correo como comprobante.</p>
</td></tr></table></td></tr></table></body></html>`;
}
const sendReceipt = (p, pay, sub, dl) => mailer.send({ to: pay.email, subject: `Recibo: ${p.name} – ${money(pay.amount)}`, html: receiptHtml(p, pay, sub, dl) }).catch(e => console.error('mailer', e));
function failHtml(p, sub, final) {
  return `<div style="font-family:Arial;max-width:460px;margin:auto;padding:24px"><h2>${final ? 'Tu suscripción fue cancelada' : 'No pudimos cobrar tu suscripción'}</h2>
<p>${esc(p.name)} – ${money(sub.amount)}/mes.</p><p>${final ? 'Intentamos cobrar 3 veces sin éxito, así que la cancelamos. No se cobrará nada más.' : `Lo intentaremos de nuevo el ${fdate(sub.next_charge_at)}. Revisa que tu tarjeta tenga fondos.`}</p></div>`;
}

// ---------- API ----------
app.get('/api/projects', (req, res) => res.json(db.projects.map(({ webhook_secret, ...p }) => p)));
app.post('/api/projects', async (req, res) => {
  const { name, type, amount, free_amount, merchant_id, webhook_url, author, seller, file_b64, description } = req.body;
  const compare = req.body.compare_at_price ? Number(req.body.compare_at_price) : null;
  if (type === 'digital' && (!amount || !file_b64)) return res.status(400).json({ error: 'producto digital requiere precio y PDF' });
  if (!name || !TYPES[type] || !merchant_id) return res.status(400).json({ error: 'name, type y merchant_id son obligatorios' });
  let slug = slugify(req.body.slug || name); if (db.projects.find(p => p.slug === slug)) slug += '-' + crypto.randomBytes(2).toString('hex');
  const p = { id: crypto.randomUUID(), slug, name, type, amount: amount ? Number(amount) : null,
    free_amount: type !== 'digital' && (free_amount === 'on' || free_amount === true || !amount), card_fee_pct: req.body.card_fee_pct !== undefined && req.body.card_fee_pct !== '' ? Number(req.body.card_fee_pct) : null, card_fee_fixed: req.body.card_fee_fixed !== undefined && req.body.card_fee_fixed !== '' ? Number(req.body.card_fee_fixed) : null, author: author || null, description: description ? String(description).slice(0, 300) : null, compare_at_price: compare && amount && compare > Number(amount) ? compare : null, seller: seller ? slugify(seller) : null, merchant_id, webhook_url: webhook_url || null,
    webhook_secret: 'whsec_' + crypto.randomBytes(16).toString('hex'), created_at: new Date().toISOString() };
  if (type === 'digital') { try { p.file = await digital.saveProductFile(p.id, file_b64); p.preview = await digital.makePreview(p.file); p.preview_v = digital.PREVIEW_V; } catch (e) { return res.status(400).json({ error: e.message }); } }
  db.projects.push(p); save();
  if (req.is('json')) return res.status(201).json(p);
  res.redirect('/admin');
});
app.get('/api/payments', (req, res) => res.json(db.payments));
app.get('/api/subscriptions', (req, res) => res.json(db.subscriptions.map(({ token, ...s }) => s)));

// ---------- Admin / tablero ----------
app.get('/admin', (req, res) => {
  const ok = db.payments.filter(x => x.status === 'approved');
  const sum = arr => arr.reduce((a, x) => a + x.amount, 0);
  const total = sum(ok);
  const byAcc = {}; ok.forEach(x => byAcc[x.merchant_id] = (byAcc[x.merchant_id] || 0) + x.amount);
  const active = db.subscriptions.filter(s => s.status === 'active');
  const projRows = db.projects.map(p => {
    const pp = ok.filter(x => x.project_id === p.id);
    const subs = db.subscriptions.filter(s => s.project_id === p.id && s.status === 'active').length;
    return `<div class="card proj"><div class="row"><b>${esc(p.name)}</b><span class="tag">${TYPES[p.type]}</span></div>
      <div class="muted">Cuenta destino: <code>${esc(p.merchant_id)}</code> · Monto: ${p.amount ? money(p.amount) : 'libre'}${fees.yappyAllowed(p) && p.amount ? ` · Yappy: ${money(fees.yappyPrice(p.amount, p).price)}` : ''} · comisión tarjeta ${fees.cardFee(p).pct}% + ${money(fees.cardFee(p).fixed)}${fees.cardFee(p).estimate ? ' (estimada)' : ''}</div>
      <div class="muted">Recaudado: <b>${money(sum(pp))}</b> · ${pp.length} pago(s)${p.type === 'subscription' ? ` · ${subs} suscriptor(es) activos` : ''}</div>
      <label>Link</label><input readonly value="${esc(BASE)}/p/${esc(p.slug)}">
      <label>Botón para pegar</label><textarea readonly rows="2">&lt;script src="${esc(BASE)}/button.js" data-project="${esc(p.slug)}"&gt;&lt;/script&gt;</textarea>
      ${p.type === 'digital' ? `<div class="muted small">PDF: ${esc(p.file)} · Autor: ${esc(p.author)} · Descargas: ${db.downloads.filter(d => d.project_id === p.id).reduce((a, d) => a + d.count, 0)}${p.seller ? ` · Tienda: <a href="/tienda/${esc(p.seller)}">/tienda/${esc(p.seller)}</a>` : ''}</div>` : ''}
      ${p.webhook_url ? `<div class="muted small">Webhook: ${esc(p.webhook_url)} · secreto: <code>${esc(p.webhook_secret)}</code></div>` : ''}
      <a class="btn sm" href="/p/${esc(p.slug)}" target="_blank">Abrir checkout</a></div>`;
  }).join('') || '<p class="muted">Aún no hay proyectos.</p>';
  const ST = { approved: '✅ aprobado', declined: '❌ rechazado' };
  const pays = db.payments.slice(-15).reverse().map(x => `<tr><td>${fdate(x.created_at)}</td><td>${esc(x.project_name)}</td><td>${money(x.amount)}</td><td>${ST[x.status]}${x.recurring ? ' · auto' : ''}</td><td><code>${esc(x.merchant_id)}</code></td><td>${esc(x.brand || '')} ${x.last4 ? '•••• ' + esc(x.last4) : ''}</td></tr>`).join('');
  const SS = { active: '🟢 activa', past_due: '🟠 pago pendiente', canceled: '⚪ cancelada' };
  const subs = db.subscriptions.slice().reverse().map(s => { const p = db.projects.find(x => x.id === s.project_id);
    return `<tr><td>${esc(p?.name)}</td><td>${esc(s.email)}</td><td>${money(s.amount)}/mes</td><td>${SS[s.status]}${s.retries ? ` (${s.retries} fallo/s)` : ''}</td><td>${s.status === 'canceled' ? '—' : fdate(s.next_charge_at)}</td>
    <td>${s.status !== 'canceled' ? `<form method="post" action="/admin/subscriptions/${s.id}/cancel" onsubmit="return confirm('¿Cancelar esta suscripción?')"><button class="btn xs">Cancelar</button></form>` : ''}</td></tr>`; }).join('');
  res.send(layout('Panel · Tubería de pagos', `<main class="admin"><h1>Tubería de pagos</h1><p class="muted">Panel · procesador: <b>${esc(processor.name)}</b> · correo: <b>${esc(mailer.name)}</b></p>
  <div class="kpis"><div class="card"><div class="muted small">Total recaudado</div><div class="kpi">${money(total)}</div></div>
  <div class="card"><div class="muted small">Pagos aprobados</div><div class="kpi">${ok.length}</div></div>
  <div class="card"><div class="muted small">Suscripciones activas</div><div class="kpi">${active.length}</div></div>
  <div class="card"><div class="muted small">Ingreso mensual recurrente</div><div class="kpi">${money(sum(active))}</div></div></div>
  <h2>Por cuenta destino</h2><div class="card"><table><tr><th>Cuenta</th><th>Recaudado</th></tr>${Object.entries(byAcc).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${money(v)}</td></tr>`).join('')}</table></div>
  <h2>Suscripciones</h2><div class="card scroll"><table><tr><th>Proyecto</th><th>Cliente</th><th>Monto</th><th>Estado</th><th>Próximo cobro</th><th></th></tr>${subs}</table></div>
  <h2>Últimos pagos</h2><div class="card scroll"><table><tr><th>Fecha</th><th>Proyecto</th><th>Monto</th><th>Estado</th><th>Cuenta</th><th>Medio</th></tr>${pays}</table></div>
  <h2>Proyectos</h2>${projRows}
  <form class="card" method="post" action="/api/projects"><h2>Nuevo proyecto</h2>
    <label>Concepto / producto (es lo único que verá quien paga)</label><input name="name" required placeholder="Juego de Mateo – Premium">
    <label>Tipo de cobro</label><select name="type"><option value="donation">Donación</option><option value="subscription">Suscripción mensual</option><option value="one_time">Pago único</option><option value="digital">Producto digital (PDF)</option></select>
    <label>Monto (USD) — vacío = monto libre</label><input name="amount" type="number" step="0.01" min="1" placeholder="4.99">
    <label class="chk"><input type="checkbox" name="free_amount"> Permitir que la persona elija el monto</label>
    <label>Cuenta / comercio destino (merchant ID)</label><input name="merchant_id" required placeholder="bg_comercio_juegos">
    <fieldset class="dig"><legend>Solo producto digital</legend>
    <label>PDF del producto</label><input type="file" accept="application/pdf" id="pdf"><input type="hidden" name="file_b64" id="file_b64">
    <label>Autor del arreglo (sale en la marca de agua)</label><input name="author" placeholder="Tu nombre artístico">
    <label>Tienda (para /tienda/&lt;nombre&gt;)</label><input name="seller" placeholder="mitienda"></fieldset>
    <script>document.getElementById('pdf').onchange=e=>{const r=new FileReader();r.onload=()=>document.getElementById('file_b64').value=r.result;r.readAsDataURL(e.target.files[0])}</script>
    <label>Comisión de tarjeta para este proyecto (vacío = global ${fees.cardFee({}).pct}% + ${money(fees.cardFee({}).fixed)}, ESTIMADA)</label><div class="two"><input name="card_fee_pct" type="number" step="0.01" placeholder="% ej. 3.75"><input name="card_fee_fixed" type="number" step="0.01" placeholder="fijo ej. 0.50"></div>
    <label>Webhook del proyecto (opcional)</label><input name="webhook_url" placeholder="https://miapp.com/pagos/webhook">
    <button class="btn">Crear proyecto</button></form></main>`));
});
app.get('/', (req, res) => res.redirect('/admin'));

async function cancelSub(s, by) {
  if (s.status === 'canceled') return;
  s.status = 'canceled'; s.canceled_at = new Date().toISOString(); s.canceled_by = by; save();
  const p = db.projects.find(x => x.id === s.project_id);
  await notifyProject(p, 'subscription.canceled', { subscription_id: s.id, email: s.email, by });
}
app.post('/admin/subscriptions/:id/cancel', async (req, res) => {
  const s = db.subscriptions.find(x => x.id === req.params.id); if (!s) return res.status(404).end();
  await cancelSub(s, 'admin'); res.redirect('/admin');
});

// ---------- Autoservicio del cliente: cancelar ----------
function subFromLink(req) {
  const s = db.subscriptions.find(x => x.id === req.params.id);
  const t = String(req.query.t || req.body?.t || '');
  if (!s || t.length !== 32 || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(cancelToken(s.id)))) return null;
  return s;
}
app.get('/s/:id/cancelar', (req, res) => {
  const s = subFromLink(req); if (!s) return res.status(404).send(layout('Link no válido', '<main class="co"><div class="card center"><h1>Este link no es válido</h1></div></main>'));
  const p = db.projects.find(x => x.id === s.project_id);
  if (s.status === 'canceled') return res.send(layout('Suscripción cancelada', `<main class="co"><div class="card center"><h1>Ya está cancelada</h1><p>${esc(p.name)}</p><p class="muted">No se cobrará nada más.</p></div></main>`));
  res.send(layout('Cancelar suscripción', `<main class="co"><div class="card center"><div class="concept">${esc(p.name)}</div><div class="big">${money(s.amount)}</div><div class="muted">cada mes · próximo cobro ${fdate(s.next_charge_at)}</div></div>
  <form class="card center" method="post"><input type="hidden" name="t" value="${esc(req.query.t)}"><p>¿Quieres cancelar tu suscripción? No se te cobrará más.</p><button class="btn full danger">Sí, cancelar</button><p class="muted small">Si no quieres cancelar, solo cierra esta página.</p></form></main>`));
});
app.post('/s/:id/cancelar', async (req, res) => {
  const s = subFromLink(req); if (!s) return res.status(404).end();
  await cancelSub(s, 'cliente');
  const p = db.projects.find(x => x.id === s.project_id);
  res.send(layout('Suscripción cancelada', `<main class="co"><div class="card center result"><div class="icon ok">✓</div><h1>Suscripción cancelada</h1><p>${esc(p.name)}</p><p class="muted">No se cobrará nada más. Ya puedes cerrar esta página.</p></div></main>`));
});

// ---------- Checkout público (diseño ÚNICO y neutro para todos los proyectos) ----------
const VERB = { donation: 'Donar', subscription: 'Pagar', one_time: 'Pagar', digital: 'Comprar' };
app.get('/p/:slug', (req, res) => {
  const p = db.projects.find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).send(layout('Link no válido', '<main class="co"><div class="card center"><h1>Este link no es válido</h1></div></main>'));
  const amt = p.amount || 5, sub = p.type === 'subscription';
  const showYappy = fees.yappyAllowed(p), y = fees.yappyPrice(amt, p), fee = fees.cardFee(p);
  const w = processor.capabilities?.wallets || [];
  const amountField = p.free_amount ? `<label for="amount">¿Cuánto quieres dar? (USD)</label><input id="amount" name="amount" type="number" step="0.01" min="1" value="${amt}" inputmode="decimal">` : `<input type="hidden" name="amount" value="${amt}">`;
  // Botones OFICIALES: Google Pay vía pay.js createButton (Google) y Apple Pay vía <apple-pay-button> (SDK oficial de Apple).
  // En simulación, al tocarlos se envía el formulario con wallet=google_pay|apple_pay (no se abre la hoja real de pago).
  const wallets = w.length ? `<div class="wallets">${w.includes('google_pay') ? '<div id="gpay" class="wslot"></div>' : ''}${w.includes('apple_pay') ? '<apple-pay-button id="apay" class="wslot" buttonstyle="black" type="pay" locale="es-ES"></apple-pay-button>' : ''}</div><input type="hidden" name="wallet" id="wallet"><div class="or"><span>o paga con tarjeta</span></div>` : '';
  const walletJs = w.length ? `<script src="https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js"></script>
  <script>function payWith(v){const f=document.querySelector('form');document.getElementById('wallet').value=v;f.noValidate=true;f.submit()}
  const ap=document.getElementById('apay');ap&&ap.addEventListener('click',()=>payWith('apple_pay'));
  function onGooglePayLoaded(){const c=new google.payments.api.PaymentsClient({environment:'TEST'});
    document.getElementById('gpay')?.appendChild(c.createButton({buttonColor:'black',buttonType:'pay',buttonLocale:'es',buttonSizeMode:'fill',buttonRadius:12,onClick:e=>{e.preventDefault();payWith('google_pay')}}))}</script>
  <script async src="https://pay.google.com/gp/p/js/pay.js" onload="onGooglePayLoaded()"></script>` : '';
  res.send(layout('Pago', `<main class="co">
  <div class="card center"><div class="concept">${esc(p.name)}</div>${showYappy ? '<div class="muted small">Con tarjeta</div>' : ''}${p.compare_at_price && !p.free_amount ? `<div class="launch">Precio de lanzamiento</div><div class="was">${money(p.compare_at_price)}</div>` : ''}<div class="big" id="total">${money(amt)}</div><div class="muted">${sub ? 'cada mes' : p.type === 'donation' ? 'donación' : p.type === 'digital' ? 'PDF · descarga inmediata' : 'pago único'}</div>${p.description ? `<p class="muted small desc">${esc(p.description)}</p>` : ''}${showYappy ? `<div class="yprice-line">Con Yappy <b id="yprice">${money(y.price)}</b> · <span class="ysave" id="ysave">ahorras ${money(y.savings)}</span></div>
  <div class="ywrap"><btn-yappy id="ybtn" theme="blue" rounded="true"></btn-yappy>
  <a class="yappy-fallback" id="yappyLink" href="/p/${esc(p.slug)}/yappy?amount=${amt}">Pagar con <img src="/yappy-logo-blanco.svg" alt="Yappy" height="26"></a></div><p class="muted small">Con Yappy no hay comisión de tarjeta${fee.estimate ? ' (ahorro estimado)' : ''}.</p>` : ''}${p.preview ? `<img class="preview" src="/preview/${esc(p.slug)}.png?v=${p.preview_v || 1}" alt="Vista previa de la primera página">` : ''}</div>
  <form class="card" method="post" action="/p/${esc(p.slug)}/pay" autocomplete="on">
    ${amountField}
    ${wallets}
    <label for="card">Número de tarjeta</label><input id="card" name="cardnumber" inputmode="numeric" autocomplete="cc-number" required placeholder="0000 0000 0000 0000" maxlength="23">
    <div class="two"><div><label for="exp">Vence (MM/AA)</label><input id="exp" name="cc-exp" autocomplete="cc-exp" required placeholder="MM/AA"></div><div><label for="cvv">Código de atrás</label><input id="cvv" name="cvc" inputmode="numeric" autocomplete="cc-csc" required maxlength="4" placeholder="123"></div></div>
    ${p.type === 'digital' ? '<label for="buyer">Tu nombre</label><input id="buyer" name="buyer" autocomplete="name" required placeholder="Nombre y apellido">' : ''}
    <label for="email">Tu correo (para el recibo)</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="tu@correo.com">
    <button class="btn full">${VERB[p.type]} <span id="btnamt">${money(amt)}</span></button>
    <p class="muted small center">🔒 Pago seguro.${sub ? ' Se cobra solo cada mes. Puedes cancelar cuando quieras.' : ''}</p>
  </form></main>
  <script>const a=document.getElementById('amount');a&&a.addEventListener('input',()=>{const s='$'+Number(a.value||0).toFixed(2);document.getElementById('total').textContent=s;document.getElementById('btnamt').textContent=s;const yl=document.getElementById('yappyLink');if(yl){const v=Number(a.value||0),f=Math.round((v*${fee.pct}/100+${fee.fixed})*100)/100,yp=Math.max(0,Math.round((v-f)*100)/100);document.getElementById('yprice').textContent='$'+yp.toFixed(2);document.getElementById('ysave').textContent='ahorras $'+(v-yp).toFixed(2);yl.href='/p/${esc(p.slug)}/yappy?amount='+v}})</script>${showYappy ? `<script type="module" src="https://bt-cdn.yappy.cloud/v1/cdn/web-component-btn-yappy.js"></script>
  <script>/* Botón OFICIAL de Yappy (web component). En simulación su clic lleva a nuestro flujo simulado. Si el CDN no carga, queda el botón alterno con el logo oficial. */
  customElements.whenDefined('btn-yappy').then(()=>document.querySelector('.ywrap').classList.add('wc-ok'));
  const yb=document.getElementById('ybtn'),go=()=>location.href=document.getElementById('yappyLink').href;yb.addEventListener('eventClick',go);yb.addEventListener('click',go);</script>` : ''}${walletJs}`));
});

app.post('/p/:slug/pay', async (req, res) => {
  const p = db.projects.find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).end();
  const amount = p.free_amount ? Number(req.body.amount) : p.amount;
  const back = msg => res.status(400).send(layout('Error', `<main class="co"><div class="card center"><h1>${msg}</h1><a class="btn full" href="/p/${esc(p.slug)}">Volver</a></div></main>`));
  if (!(amount >= 1)) return back('El monto no es válido');
  const wallet = (processor.capabilities?.wallets || []).includes(req.body.wallet) ? req.body.wallet : null;
  // En simulación la billetera no devuelve correo real; en producción lo entrega Google/Apple Pay.
  const email = req.body.email || (wallet ? `cliente-${wallet}@simulacion.local` : '');
  if (!email) return back('Escribe tu correo para enviarte el recibo');
  const r = await processor.authorize({ card: req.body.cardnumber, wallet, amount, project: p });
  return completePayment(req, res, p, { amount, email, buyer: req.body.buyer, r, wallet, method: wallet || 'card' });
});

async function completePayment(req, res, p, { amount, email, buyer, r, wallet, method }) {
  const pay = { id: crypto.randomUUID(), project_id: p.id, project_name: p.name, merchant_id: p.merchant_id, amount, email,
    status: r.status, transaction_id: r.transactionId || null, last4: r.last4 || null, brand: r.brand || null, wallet, method,
    processor: method === 'yappy' ? yappy.name : processor.name, created_at: new Date().toISOString() };
  db.payments.push(pay);
  let sub = null;
  if (r.status === 'approved' && p.type === 'subscription') {
    const next = new Date(); next.setMonth(next.getMonth() + 1);
    sub = { id: crypto.randomUUID(), project_id: p.id, email, amount, token: r.token, last4: r.last4, brand: r.brand,
      status: 'active', next_charge_at: next.toISOString(), retries: 0, created_at: pay.created_at };
    db.subscriptions.push(sub); pay.subscription_id = sub.id;
  }
  save();
  notifyProject(p, 'payment.' + r.status, { payment_id: pay.id, amount, email, subscription_id: sub?.id || null });
  let dl = null;
  if (r.status === 'approved' && p.type === 'digital') { pay.buyer = buyer || email; dl = digital.createDownload(db, pay); save(); }
  if (r.status === 'approved') sendReceipt(p, pay, sub, dl);
  const ok = r.status === 'approved';
  res.send(layout(ok ? 'Pago listo' : 'Pago no realizado', `<main class="co"><div class="card center result">
    <div class="icon ${ok ? 'ok' : 'ko'}">${ok ? '✓' : '✕'}</div><h1>${ok ? '¡Pago listo!' : 'El pago no se hizo'}</h1>
    ${ok ? `<p class="big">${money(amount)}</p><p>${esc(p.name)}</p><p class="muted">El recibo llegará a ${esc(email)}.${sub ? ' El próximo cobro será en un mes.' : ''}</p>${dl ? `<a class="btn full" href="${dlUrl(dl)}">Descargar PDF</a><p class="muted small">También te lo enviamos por correo. El link vence el ${fdate(dl.expires_at)} y permite ${dl.max} descargas.</p>` : ''}<p class="muted small">Comprobante: ${esc(pay.transaction_id)}</p>${dl ? '' : '<p class="muted small">Ya puedes cerrar esta página.</p>'}`
         : `<p>No se cobró nada. ${method === 'yappy' ? 'El pago no se aprobó en Yappy.' : 'Revisa los datos de tu tarjeta o usa otra.'}</p><a class="btn full" href="/p/${esc(p.slug)}">Intentar de nuevo</a>`}</div></main>`));
}

// ---------- Yappy (flujo simulado detrás de la interfaz yappy.createOrder/resolve) ----------
app.use('/p/:slug/yappy', rateLimit('y', 30, 10 * 60 * 1000));
const yappyProject = req => { const p = db.projects.find(x => x.slug === req.params.slug); return p && fees.yappyAllowed(p) ? p : null; };
const cardAmount = (p, v) => p.free_amount ? Number(v) : p.amount;
app.get('/p/:slug/yappy', (req, res) => {
  const p = yappyProject(req); if (!p) return res.status(404).send(layout('No disponible', '<main class="co"><div class="card center"><h1>Yappy no está disponible para este pago</h1></div></main>'));
  const ca = cardAmount(p, req.query.amount); if (!(ca >= 1)) return res.redirect('/p/' + p.slug);
  const y = fees.yappyPrice(ca, p);
  res.send(layout('Pagar con Yappy', `<main class="co"><div class="card center"><div class="concept">${esc(p.name)}</div><div class="muted small">Con Yappy</div><div class="big">${money(y.price)}</div><div class="muted">Ahorras ${money(y.savings)} · con tarjeta ${money(ca)}</div></div>
  <form class="card" method="post"><input type="hidden" name="amount" value="${esc(ca)}">
    <label for="phone">Tu número de Yappy</label><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required pattern="6[0-9]{3}-?[0-9]{4}" placeholder="6000-0000">
    ${p.type === 'digital' ? '<label for="buyer">Tu nombre</label><input id="buyer" name="buyer" autocomplete="name" required placeholder="Nombre y apellido">' : ''}
    <label for="email">Tu correo (para el recibo)</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="tu@correo.com">
    <button class="btn full ybtn">Pagar ${money(y.price)} con <img src="/yappy-logo-blanco.svg" alt="Yappy" height="22" style="vertical-align:middle"></button>
    <p class="muted small center">Te llegará una solicitud a tu app de Yappy para aprobar el pago.</p>
    <p class="center"><a class="muted small" href="/p/${esc(p.slug)}">Volver y pagar con tarjeta</a></p></form></main>`));
});
app.post('/p/:slug/yappy', async (req, res) => {
  const p = yappyProject(req); if (!p) return res.status(404).end();
  const ca = cardAmount(p, req.body.amount), phone = String(req.body.phone || '').replace(/\D/g, '');
  if (!(ca >= 1) || !/^6\d{7}$/.test(phone) || !req.body.email) return res.status(400).send(layout('Error', `<main class="co"><div class="card center"><h1>Revisa tu número de Yappy y tu correo</h1><a class="btn full" href="/p/${esc(p.slug)}/yappy?amount=${esc(ca)}">Volver</a></div></main>`));
  const y = fees.yappyPrice(ca, p);
  const o = await yappy.createOrder({ amount: y.price, phone, project: p });
  o.email = req.body.email; o.buyer = req.body.buyer; o.card_amount = ca;
  res.send(layout('Aprueba en Yappy', `<main class="co"><div class="card center"><div class="concept">${esc(p.name)}</div><div class="big">${money(y.price)}</div>
    <div class="spinner"></div><h1>Abre tu app de Yappy</h1><p>Enviamos la solicitud de pago al <b>${phone.slice(0, 4)}-${phone.slice(4)}</b>. Apruébala para terminar.</p><p class="muted small">Orden ${esc(o.id)}</p></div>
    ${yappy.name === 'yappy-mock' ? `<form class="card center" method="post" action="/p/${esc(p.slug)}/yappy/${esc(o.id)}"><input type="hidden" name="k" value="${o.secret}"><p class="muted small">SIMULACIÓN: así respondería la app de Yappy</p>
      <button class="btn full ybtn" name="r" value="ok">Aprobar en Yappy (simulación)</button><button class="btn full ghost" name="r" value="no">Rechazar (simulación)</button></form>` : ''}</main>`));
});
app.post('/p/:slug/yappy/:order', async (req, res) => {
  const p = yappyProject(req), o = yappy.getOrder(req.params.order);
  if (!p || !o || o.project_id !== p.id || String(req.body.k || '').length !== 32 || !crypto.timingSafeEqual(Buffer.from(String(req.body.k)), Buffer.from(o.secret))) return res.status(404).end();
  const r = await yappy.resolve(o.id, req.body.r === 'ok'); if (!r) return res.redirect('/p/' + p.slug);
  return completePayment(req, res, p, { amount: o.amount, email: o.email, buyer: o.buyer, r, wallet: null, method: 'yappy' });
});

// ---------- Descarga segura ----------
app.get('/d/:token', async (req, res) => {
  const want = crypto.createHash('sha256').update(String(req.params.token)).digest();
  let d = null; for (const x of db.downloads) if (crypto.timingSafeEqual(want, crypto.createHash('sha256').update(x.token).digest())) d = x;
  const err = (code, msg) => res.status(code).send(layout('Descarga', `<main class="co"><div class="card center"><h1>${msg}</h1><p class="muted">Si compraste este producto y necesitas ayuda, responde al correo del recibo.</p></div></main>`));
  if (!d) return err(404, 'Este link no es válido');
  if (new Date(d.expires_at) < new Date()) return err(410, 'Este link ya venció');
  if (d.count >= d.max) return err(410, 'Ya se usaron todas las descargas');
  const p = db.projects.find(x => x.id === d.project_id), pay = db.payments.find(x => x.id === d.payment_id);
  const orderId = pay.transaction_id;
  const pdf = await digital.watermark(p.file, { buyer: pay.buyer, email: pay.email, date: fdate(pay.created_at), orderId, author: p.author || 'el autor' });
  d.count++; (d.log ||= []).push({ at: new Date().toISOString(), ip: req.ip }); save();
  res.set({ 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${slugify(p.name)}-${orderId}.pdf"`, 'cache-control': 'no-store' }).send(pdf);
});

// ---------- Vista previa pública (solo PNG baja resolución de la página 1 con "VISTA PREVIA") ----------
app.get('/preview/:slug.png', (req, res) => {
  const p = db.projects.find(x => x.slug === req.params.slug && x.type === 'digital' && x.preview);
  if (!p) return res.status(404).end();
  res.set('cache-control', 'public, max-age=3600').sendFile(require('path').join(__dirname, '..', 'files', p.preview));
});

// ---------- Tienda / catálogo (mismo diseño neutro) ----------
app.get('/tienda/:seller', (req, res) => {
  const items = db.projects.filter(p => p.seller === req.params.seller);
  if (!items.length) return res.status(404).send(layout('Tienda', '<main class="co"><div class="card center"><h1>Tienda no encontrada</h1></div></main>'));
  res.send(layout('Tienda', `<main class="co"><h1 class="center" style="margin:18px 0 4px">Catálogo</h1><p class="muted center">Toca un producto para comprarlo</p>
  ${items.map(p => `<a class="card item" href="/p/${esc(p.slug)}"><div><div class="concept">${esc(p.name)}</div><div class="muted small">${p.type === 'digital' ? 'PDF · descarga inmediata' : TYPES[p.type]}</div></div><div class="price">${p.compare_at_price ? `<span class="was">${money(p.compare_at_price)}</span> ` : ''}${p.amount ? money(p.amount) : 'Libre'}${p.compare_at_price ? '<div class="launch">Precio de lanzamiento</div>' : ''}</div></a>`).join('')}</main>`));
});

// ---------- Cobros recurrentes: cobra vencidas; si falla reintenta cada 3 días; al 3er fallo cancela ----------
const RETRY_DAYS = 3, MAX_FAILS = 3;
async function runBilling(now = new Date()) {
  const log = [];
  for (const s of db.subscriptions.filter(s => (s.status === 'active' || s.status === 'past_due') && new Date(s.next_charge_at) <= now)) {
    const p = db.projects.find(x => x.id === s.project_id);
    const r = await processor.charge(s.token, s.amount, p);
    const pay = { id: crypto.randomUUID(), project_id: p.id, project_name: p.name, merchant_id: p.merchant_id, amount: s.amount, email: s.email,
      status: r.status, transaction_id: r.transactionId || null, last4: s.last4, brand: s.brand, recurring: true, subscription_id: s.id,
      processor: processor.name, created_at: now.toISOString() };
    db.payments.push(pay);
    if (r.status === 'approved') {
      const n = new Date(now); n.setMonth(n.getMonth() + 1); s.next_charge_at = n.toISOString(); s.retries = 0; s.status = 'active';
      sendReceipt(p, pay, s); await notifyProject(p, 'payment.approved', { payment_id: pay.id, amount: s.amount, subscription_id: s.id, recurring: true });
    } else {
      s.retries++;
      await notifyProject(p, 'payment.declined', { payment_id: pay.id, amount: s.amount, subscription_id: s.id, attempt: s.retries, recurring: true });
      if (s.retries >= MAX_FAILS) {
        s.status = 'canceled'; s.canceled_at = now.toISOString(); s.canceled_by = 'impago';
        await mailer.send({ to: s.email, subject: `Suscripción cancelada: ${p.name}`, html: failHtml(p, s, true) });
        await notifyProject(p, 'subscription.canceled', { subscription_id: s.id, email: s.email, by: 'impago' });
      } else {
        s.status = 'past_due'; const n = new Date(now); n.setDate(n.getDate() + RETRY_DAYS); s.next_charge_at = n.toISOString();
        await mailer.send({ to: s.email, subject: `No pudimos cobrar: ${p.name}`, html: failHtml(p, s, false) });
      }
    }
    log.push({ subscription: s.id, result: r.status, status: s.status, retries: s.retries, next: s.next_charge_at });
  }
  save(); return log;
}
app.post('/api/billing/run', async (req, res) => res.json(await runBilling(req.body.now ? new Date(req.body.now) : new Date())));
setInterval(() => runBilling().catch(console.error), 60 * 60 * 1000);

app.post('/webhooks/processor', (req, res) => { if (!processor.verifyWebhook(req)) return res.status(401).end(); res.json({ received: true }); });
(async () => {
  await initDb();
// Datos de demostración si la base está vacía (SEED_DEMO=1), útil en despliegues nuevos
if (process.env.SEED_DEMO === '1' && !db.projects.length) {
  const fs = require('fs'), path = require('path'); const mk = (o) => { const p = { id: crypto.randomUUID(), slug: slugify(o.name), amount: null, free_amount: false, webhook_url: null,
    webhook_secret: 'whsec_' + crypto.randomBytes(16).toString('hex'), author: null, seller: null, created_at: new Date().toISOString(), ...o }; db.projects.push(p); return p; };
  mk({ name: 'Juego de Mateo – Premium', type: 'subscription', amount: 4.99, merchant_id: 'bg_comercio_juegos' });
  mk({ name: 'Donación Comunidad', type: 'donation', free_amount: true, merchant_id: 'bg_comercio_fundacion' });
  const sample = path.join(__dirname, '..', 'samples', 'partitura-ejemplo.pdf');
  if (fs.existsSync(sample)) for (const [name, amount] of [['Alfonsina y el Mar – Piano', 7.5], ['Bésame Mucho – Guitarra', 5]]) {
    const p = mk({ name, type: 'digital', amount, merchant_id: 'bg_comercio_partituras', author: 'Lischay', seller: 'lischay' });
    p.file = await digital.saveProductFile(p.id, fs.readFileSync(sample).toString('base64')); }
  save(); console.log('Datos de demostración creados');
}
for (const p of db.projects) if (p.type === 'digital' && p.file && (!p.preview || p.preview_v !== digital.PREVIEW_V || !require('fs').existsSync(require('path').join(__dirname, '..', 'files', p.preview)))) { try { p.preview = await digital.makePreview(p.file); p.preview_v = digital.PREVIEW_V; save(); } catch (e) { console.error('preview', e.message); } }
  save();
  app.listen(PORT, () => console.log(`Tubería de pagos en ${BASE} (procesador: ${processor.name}, correo: ${mailer.name}, datos: ${dbBackend})`));
})().catch(e => { console.error('arranque', e); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await closeDb().catch(() => {}); process.exit(0); });

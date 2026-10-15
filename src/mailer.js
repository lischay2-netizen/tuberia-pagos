// Mailer enchufable. MAILER=outbox (defecto) | brevo | resend
//  - outbox: escribe .eml + .html en ./outbox, NO envía nada.
//  - brevo:  API HTTP de Brevo (funciona en Render free, que bloquea los puertos SMTP). Vars: BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME
//  - resend: API HTTP de Resend (requiere dominio propio verificado). Vars: RESEND_API_KEY, MAIL_FROM, MAIL_FROM_NAME
// Si un envío real falla, se guarda una copia en outbox/ y se registra el error (el pago NO se ve afectado).
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'outbox');
const FROM = process.env.MAIL_FROM || 'recibos@tuberia.local', FROM_NAME = process.env.MAIL_FROM_NAME || 'Recibos';
const outbox = {
  name: 'outbox',
  async send({ to, subject, html }) {
    fs.mkdirSync(OUT, { recursive: true });
    const base = path.join(OUT, `${Date.now()}-${String(to).replace(/[^a-z0-9]/gi, '_')}`);
    const eml = `From: ${FROM_NAME} <${FROM}>\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`;
    fs.writeFileSync(base + '.eml', eml); fs.writeFileSync(base + '.html', html);
    return { id: path.basename(base), file: base + '.html' };
  }
};
const http = (name, url, headers, body) => ({
  name,
  async send(msg) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers() }, body: JSON.stringify(body(msg)) });
      const t = await r.text(); if (!r.ok) throw new Error(`${name} ${r.status}: ${t.slice(0, 300)}`);
      return { id: (JSON.parse(t || '{}').messageId || JSON.parse(t || '{}').id || 'ok') };
    } catch (e) { console.error('mailer', e.message); await outbox.send(msg); return { error: e.message }; }
  }
});
const brevo = http('brevo', process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', () => ({ 'api-key': process.env.BREVO_API_KEY }),
  m => ({ sender: { email: FROM, name: FROM_NAME }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html }));
const resend = http('resend', process.env.RESEND_API_URL || 'https://api.resend.com/emails', () => ({ authorization: 'Bearer ' + process.env.RESEND_API_KEY }),
  m => ({ from: `${FROM_NAME} <${FROM}>`, to: [m.to], subject: m.subject, html: m.html }));
const chosen = { outbox, brevo, resend }[process.env.MAILER || 'outbox'];
if (!chosen) throw new Error('MAILER desconocido: ' + process.env.MAILER);
module.exports = chosen;

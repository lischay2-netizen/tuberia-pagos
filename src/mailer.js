// Mailer enchufable. MAILER=outbox (defecto): escribe .eml + .html en ./outbox, NO envía nada.
// Para producción: crear src/mailers/smtp.js o similar con la misma función send({to,subject,html}).
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'outbox');
const outbox = {
  name: 'outbox',
  async send({ to, subject, html }) {
    fs.mkdirSync(OUT, { recursive: true });
    const base = path.join(OUT, `${Date.now()}-${String(to).replace(/[^a-z0-9]/gi, '_')}`);
    const eml = `From: Recibos <recibos@tuberia.local>\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`;
    fs.writeFileSync(base + '.eml', eml); fs.writeFileSync(base + '.html', html);
    return { id: path.basename(base), file: base + '.html' };
  }
};
module.exports = { outbox }[process.env.MAILER || 'outbox'];

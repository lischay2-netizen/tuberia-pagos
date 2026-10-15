// Productos digitales (partituras PDF): entrega con link seguro que expira, límite de descargas y marca de agua por comprador.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const FILES = path.join(__dirname, '..', 'files');
const MAX_DOWNLOADS = Number(process.env.MAX_DOWNLOADS || 5), LINK_DAYS = Number(process.env.LINK_DAYS || 7);
// Las fuentes estándar de PDF solo cubren WinAnsi: se limpian caracteres raros.
const clean = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');

async function saveProductFile(projectId, base64) {
  const buf = Buffer.from(String(base64).replace(/^data:.*?;base64,/, ''), 'base64');
  if (buf.slice(0, 5).toString() !== '%PDF-') throw new Error('El archivo no es un PDF');
  fs.mkdirSync(FILES, { recursive: true });
  const f = path.join(FILES, projectId + '.pdf'); fs.writeFileSync(f, buf); await require('./db').putFile(path.basename(f), buf); return path.basename(f);
}
function createDownload(db, pay) {
  const d = { token: crypto.randomBytes(24).toString('base64url'), payment_id: pay.id, project_id: pay.project_id,
    expires_at: new Date(Date.now() + LINK_DAYS * 864e5).toISOString(), count: 0, max: MAX_DOWNLOADS, created_at: new Date().toISOString() };
  (db.downloads ||= []).push(d); return d;
}
async function watermark(file, { buyer, email, date, orderId, author }) {
  const pdf = await PDFDocument.load(fs.readFileSync(path.join(FILES, file)));
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const line1 = clean(`Licenciado a: ${buyer} <${email}> · ${date} · Pedido ${orderId}`);
  const line2 = clean(`Arreglo © ${author}. Licencia de uso personal. Prohibida su redistribución.`);
  for (const pg of pdf.getPages()) {
    const { width, height } = pg.getSize();
    const fs1 = Math.min(8, (width - 40) / font.widthOfTextAtSize(line1, 1));
    pg.drawRectangle({ x: 0, y: 0, width, height: 26, color: rgb(1, 1, 1), opacity: 0.85 });
    pg.drawText(line1, { x: 20, y: 15, size: fs1, font, color: rgb(0.25, 0.25, 0.25) });
    pg.drawText(line2, { x: 20, y: 6, size: Math.min(7, (width - 40) / bold.widthOfTextAtSize(line2, 1)), font: bold, color: rgb(0.25, 0.25, 0.25) });
    const diag = clean(`${email} · ${orderId}`), size = 26;
    pg.drawText(diag, { x: width / 2 - font.widthOfTextAtSize(diag, size) * 0.35, y: height / 2 - font.widthOfTextAtSize(diag, size) * 0.35,
      size, font, color: rgb(0.6, 0.6, 0.6), opacity: 0.18, rotate: degrees(45) });
  }
  pdf.setTitle(clean(`Licenciado a ${buyer} - Pedido ${orderId}`)); pdf.setAuthor(clean(author));
  return Buffer.from(await pdf.save());
}
module.exports = { saveProductFile, createDownload, watermark, MAX_DOWNLOADS, LINK_DAYS };

// Vista previa: solo página 1, baja resolución, con "VISTA PREVIA" repetido. Requiere pdftoppm (poppler-utils).
async function makePreview(file) {
  const { execFileSync } = require('child_process');
  const src = await PDFDocument.load(fs.readFileSync(path.join(FILES, file)));
  const pdf = await PDFDocument.create(); const [pg] = await pdf.copyPages(src, [0]); pdf.addPage(pg);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold); const { width, height } = pg.getSize();
  for (let y = -height; y < height * 1.5; y += 140) for (let x = -width; x < width * 1.5; x += 300)
    pg.drawText('VISTA PREVIA', { x, y, size: 34, font, color: rgb(0.85, 0.1, 0.1), opacity: 0.28, rotate: degrees(35) });
  const tmp = path.join(FILES, file + '.preview.pdf'); fs.writeFileSync(tmp, await pdf.save());
  const out = path.join(FILES, file.replace(/\.pdf$/, '') + '-preview');
  execFileSync('pdftoppm', ['-png', '-r', '45', '-singlefile', tmp, out]); fs.unlinkSync(tmp);
  await require('./db').putFile(path.basename(out) + '.png', fs.readFileSync(out + '.png'));
  return path.basename(out) + '.png';
}
module.exports.makePreview = makePreview;

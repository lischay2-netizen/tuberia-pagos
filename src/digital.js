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
  // Cada página original se incrusta y la marca va encima: así las transformaciones internas del PDF
  // (p. ej. MuseScore) nunca desplazan el pie de licencia.
  const src = await PDFDocument.load(fs.readFileSync(path.join(FILES, file)));
  const pdf = await PDFDocument.create(), embs = await pdf.embedPdf(src, src.getPageIndices());
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const line1 = clean(`Licenciado a: ${buyer} <${email}> · ${date} · Pedido ${orderId}`);
  const line2 = clean(`Arreglo © ${author}. Licencia de uso personal. Prohibida su redistribución.`);
  const ink = rgb(0.35, 0.35, 0.38);
  for (const emb of embs) {
    const pg = pdf.addPage([emb.width, emb.height]); pg.drawPage(emb);
    const { width, height } = pg.getSize(), m = 28;
    const s1 = Math.min(7.5, (width - 2 * m) / font.widthOfTextAtSize(line1, 1)), s2 = Math.min(6.5, (width - 2 * m) / bold.widthOfTextAtSize(line2, 1));
    pg.drawRectangle({ x: 0, y: 0, width, height: 30, color: rgb(1, 1, 1), opacity: 0.9 });
    pg.drawLine({ start: { x: m, y: 27 }, end: { x: width - m, y: 27 }, thickness: 0.4, color: rgb(0.75, 0.75, 0.78) });
    pg.drawText(line1, { x: (width - font.widthOfTextAtSize(line1, s1)) / 2, y: 17, size: s1, font, color: ink });
    pg.drawText(line2, { x: (width - bold.widthOfTextAtSize(line2, s2)) / 2, y: 8, size: s2, font: bold, color: ink });
  }
  pdf.setTitle(clean(`Licenciado a ${buyer} - Pedido ${orderId}`)); pdf.setAuthor(clean(author));
  return Buffer.from(await pdf.save());
}
module.exports = { saveProductFile, createDownload, watermark, MAX_DOWNLOADS, LINK_DAYS };

// Vista previa: solo página 1, baja resolución, con "VISTA PREVIA" repetido. Requiere pdftoppm (poppler-utils).
async function makePreview(file) {
  const { execFileSync } = require('child_process');
  const src = await PDFDocument.load(fs.readFileSync(path.join(FILES, file)));
  const pdf = await PDFDocument.create(); const [emb] = await pdf.embedPdf(src, [0]);
  const pg = pdf.addPage([emb.width, emb.height]); pg.drawPage(emb); // incrustada: su contenido no altera las coordenadas de la superposición
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = pg.getSize(), gray = rgb(0.25, 0.25, 0.28);
  // Marca muy tenue en diagonal (≈7 %) para que las capturas sigan identificadas.
  for (let y = -height; y < height * 1.5; y += 120) for (let x = -width; x < width * 1.5; x += 260)
    pg.drawText('Vista previa', { x, y, size: 20, font, color: gray, opacity: 0.07, rotate: degrees(30) });
  // Mitad inferior: degradado suave hacia blanco, la página completa no se puede usar.
  const fadeTop = height * 0.6, steps = 40;
  for (let i = 0; i < steps; i++) { const h = fadeTop / steps, t = (i + 1) / steps;
    pg.drawRectangle({ x: 0, y: fadeTop - (i + 1) * h, width, height: h + 0.5, color: rgb(1, 1, 1), opacity: Math.min(1, Math.pow(t, 0.7) * 1.7) }); }
  pg.drawRectangle({ x: 0, y: 0, width, height: fadeTop * 0.4, color: rgb(1, 1, 1), opacity: 1 });
  // Etiqueta discreta tipo píldora, centrada en la zona desvanecida.
  const label = 'VISTA PREVIA · PÁGINA 1', size = 13, tw = bold.widthOfTextAtSize(label, size), pw = tw + 36, ph = 30, px = (width - pw) / 2, py = fadeTop * 0.5;
  pg.drawRectangle({ x: px, y: py, width: pw, height: ph, color: rgb(0.13, 0.13, 0.15), opacity: 0.78, borderColor: rgb(0.13, 0.13, 0.15), borderOpacity: 0 });
  pg.drawText(label, { x: px + 18, y: py + 10, size, font: bold, color: rgb(1, 1, 1) });
  const tmp = path.join(FILES, file + '.preview.pdf'); fs.writeFileSync(tmp, await pdf.save());
  const out = path.join(FILES, file.replace(/\.pdf$/, '') + '-preview');
  execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', tmp, out]); fs.unlinkSync(tmp);
  await require('./db').putFile(path.basename(out) + '.png', fs.readFileSync(out + '.png'));
  return path.basename(out) + '.png';
}
module.exports.makePreview = makePreview;
module.exports.PREVIEW_V = 2; // subir al cambiar el diseño de la vista previa → se regeneran todas al arrancar

// Genera una partitura de ejemplo (2 páginas con pentagramas) en samples/partitura-ejemplo.pdf
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib'); const fs = require('fs');
(async () => { const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.TimesRomanBold), r = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let n = 1; n <= 2; n++) { const pg = pdf.addPage([595, 842]);
    if (n === 1) { pg.drawText('Alfonsina y el Mar', { x: 175, y: 780, size: 28, font: f }); pg.drawText('Arreglo para piano (EJEMPLO)', { x: 200, y: 755, size: 13, font: r }); }
    for (let s = 0; s < 9; s++) { const y0 = 700 - s * 72; for (let l = 0; l < 5; l++) pg.drawLine({ start: { x: 50, y: y0 - l * 7 }, end: { x: 545, y: y0 - l * 7 }, thickness: 0.7 });
      for (let b = 1; b < 4; b++) pg.drawLine({ start: { x: 50 + b * 124, y: y0 }, end: { x: 50 + b * 124, y: y0 - 28 }, thickness: 0.7 });
      for (let k = 0; k < 14; k++) { const x = 70 + k * 34, y = y0 - 28 + ((k * 5 + s * 3) % 9) * 3.5; pg.drawEllipse({ x, y, xScale: 4.2, yScale: 3, color: rgb(0, 0, 0) }); pg.drawLine({ start: { x: x + 4, y }, end: { x: x + 4, y: y + 22 }, thickness: 0.8 }); } }
    pg.drawText(`- ${n} -`, { x: 285, y: 40, size: 10, font: r }); }
  fs.mkdirSync('samples', { recursive: true }); fs.writeFileSync('samples/partitura-ejemplo.pdf', await pdf.save()); console.log('samples/partitura-ejemplo.pdf'); })();

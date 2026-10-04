// Vuelca el texto de las cartolas de muestra para estudiar su formato antes de escribir un parser.
// Lee Cartolas/muestras/<broker>/*.pdf y escribe Cartolas/muestras/_texto/<broker>/<archivo>.txt
// (ambas carpetas están en el .gitignore: nada de esto llega a GitHub).
//
// Uso (desde web/):  node scripts/volcar-cartolas.mjs [broker]
//
// Usa pdf.js, la misma librería con la que la página lee las cartolas en el navegador, y reconstruye
// las líneas agrupando el texto por su posición vertical, para ver las tablas como en el PDF.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';

const MUESTRAS = path.resolve(import.meta.dirname, '../../Cartolas/muestras');
const SALIDA = path.join(MUESTRAS, '_texto');
const soloBroker = process.argv[2];

async function texto(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items.filter(i => i.str.trim());
    // Agrupa por línea (misma altura, con tolerancia de 2 puntos) y ordena de izquierda a derecha
    const lineas = [];
    for (const it of items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
      const y = it.transform[5];
      const linea = lineas.find(l => Math.abs(l.y - y) <= 2);
      if (linea) linea.items.push(it); else lineas.push({ y, items: [it] });
    }
    const render = lineas.map(l => {
      let out = '';
      for (const it of l.items.sort((a, b) => a.transform[4] - b.transform[4])) {
        const col = Math.round(it.transform[4] / 4); // ~4 puntos por carácter
        out = out.padEnd(Math.max(out.length + 1, col)) + it.str;
      }
      return out.trimEnd();
    });
    paginas.push(`===== Página ${n} de ${doc.numPages} =====\n${render.join('\n')}`);
  }
  return { paginas: doc.numPages, texto: paginas.join('\n\n'), caracteres: paginas.join('').length };
}

if (!fs.existsSync(MUESTRAS)) {
  console.error(`No existe ${MUESTRAS}`);
  process.exit(1);
}
for (const broker of fs.readdirSync(MUESTRAS).filter(d => d !== '_texto' && (!soloBroker || d === soloBroker))) {
  const dir = path.join(MUESTRAS, broker);
  if (!fs.statSync(dir).isDirectory()) continue;
  const pdfs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) {
    console.log(`${broker}: sin PDFs`);
    continue;
  }
  fs.mkdirSync(path.join(SALIDA, broker), { recursive: true });
  for (const f of pdfs) {
    try {
      const r = await texto(path.join(dir, f));
      fs.writeFileSync(path.join(SALIDA, broker, `${f}.txt`), r.texto, 'utf8');
      const aviso = r.caracteres < 200 * r.paginas ? '  ⚠ casi sin texto: probablemente escaneado (necesita OCR)' : '';
      console.log(`${broker}/${f}: ${r.paginas} páginas, ${r.caracteres} caracteres${aviso}`);
    } catch (e) {
      console.log(`${broker}/${f}: no se pudo leer (${e.message})`);
    }
  }
}

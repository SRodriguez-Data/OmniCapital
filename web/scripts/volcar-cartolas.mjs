// Vuelca el texto de las cartolas de muestra para estudiar su formato antes de escribir un parser.
// Lee Cartolas/muestras/<broker>/**/*.pdf y escribe Cartolas/muestras/_texto/<broker>/<archivo>.txt
// (ambas carpetas están en el .gitignore: nada de esto llega a GitHub).
//
// Uso (desde web/):  node scripts/volcar-cartolas.mjs [broker]
//
// Usa la misma extracción por líneas que la página (textoDePdf en src/lib/CartolaParser.ts),
// así el texto volcado es exactamente el que ven los parsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { textoDePdf } from '../src/lib/CartolaParser.ts';

const MUESTRAS = path.resolve(import.meta.dirname, '../../Cartolas/muestras');
const SALIDA = path.join(MUESTRAS, '_texto');
const soloBroker = process.argv[2];

async function texto(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const texto = await textoDePdf(doc);
  return { paginas: doc.numPages, texto, caracteres: texto.replace(/\s+/g, '').length };
}

if (!fs.existsSync(MUESTRAS)) {
  console.error(`No existe ${MUESTRAS}`);
  process.exit(1);
}

// PDFs de una carpeta y sus subcarpetas (ej. racional/Racional Stocks y racional/Racional Portafolio)
const pdfsEn = dir => fs.readdirSync(dir, { recursive: true })
  .filter(f => f.toLowerCase().endsWith('.pdf'))
  .sort();

for (const broker of fs.readdirSync(MUESTRAS).filter(d => d !== '_texto' && (!soloBroker || d === soloBroker))) {
  const dir = path.join(MUESTRAS, broker);
  if (!fs.statSync(dir).isDirectory()) continue;
  const pdfs = pdfsEn(dir);
  if (pdfs.length === 0) {
    console.log(`${broker}: sin PDFs`);
    continue;
  }
  for (const f of pdfs) {
    try {
      const r = await texto(path.join(dir, f));
      const destino = path.join(SALIDA, broker, `${f}.txt`);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, r.texto, 'utf8');
      const aviso = r.caracteres < 200 * r.paginas ? '  ⚠ casi sin texto: probablemente escaneado (necesita OCR)' : '';
      console.log(`${broker}/${f}: ${r.paginas} páginas, ${r.caracteres} caracteres${aviso}`);
    } catch (e) {
      console.log(`${broker}/${f}: no se pudo leer (${e.message})`);
    }
  }
}

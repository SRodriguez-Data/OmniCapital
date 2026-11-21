// Abre un PDF de cartola probando, en orden: sin clave, las dadas con --clave=XXXX y las CLAVE_PDF_* del .env de la
// raíz del repositorio (BTG y XTB mandan sus PDF con claves distintas). El .env no se sube a GitHub y las claves
// nunca se imprimen.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ENV = path.resolve(import.meta.dirname, '../../.env');

export function clavesPdf(argv = process.argv) {
  const claves = argv.filter(a => a.startsWith('--clave=')).map(a => a.slice('--clave='.length));
  if (fs.existsSync(ENV)) {
    for (const linea of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*CLAVE_PDF_[A-Z0-9_]+\s*=\s*(.*)$/);
      const valor = m?.[1].trim().replace(/^["']|["']$/g, '');
      if (valor) claves.push(valor);
    }
  }
  return [...new Set(claves)];
}

// Devuelve el documento abierto. Si ninguna clave sirve, lanza la PasswordException de pdf.js
export async function abrirPdf(datos, claves) {
  let ultimo;
  for (const password of [undefined, ...claves]) {
    try {
      // pdf.js se queda con el arreglo que recibe: cada intento usa su propia copia
      return await pdfjs.getDocument({ data: new Uint8Array(datos), password, verbosity: 0 }).promise;
    } catch (e) {
      if (e?.name !== 'PasswordException') throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

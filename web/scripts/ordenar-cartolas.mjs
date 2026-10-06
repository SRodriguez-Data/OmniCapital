// Ordena las cartolas por su CONTENIDO (no por el nombre del archivo) para que no se pisen ni se pierdan:
// cada PDF queda en la carpeta de su cuenta con un nombre estándar, ej. "BTG Pactual 2025-11 noviembre.pdf".
//
// Uso (desde web/):
//   node scripts/ordenar-cartolas.mjs [carpeta ...]            solo muestra qué haría (no toca nada)
//   node scripts/ordenar-cartolas.mjs [carpeta ...] --aplicar  mueve y renombra
//   --clave=XXXX  clave para abrir los PDF protegidos (BTG y XTB los envían con clave)
// Por defecto revisa Cartolas/muestras. Reglas:
// - Nunca sobrescribe ni borra: si ya existe la misma cartola (mismo texto), la copia sobrante va a
//   Cartolas/muestras/_duplicados/. Si existe una cartola distinta del mismo período, se guarda como "(versión 2)".
// - Los PDF con clave no se pueden leer: se informan y se dejan donde están.
// - Cada movimiento queda registrado en Cartolas/revision/renombres.csv (para deshacerlo si hace falta).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { textoDePdf, parseCartolaText } from '../src/lib/CartolaParser.ts';

const RAIZ = path.resolve(import.meta.dirname, '../../Cartolas');
const MUESTRAS = path.join(RAIZ, 'muestras');
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const clave = args.find(a => a.startsWith('--clave='))?.slice('--clave='.length);
const carpetas = args.filter(a => !a.startsWith('--')).map(a => path.resolve(a));
if (carpetas.length === 0) carpetas.push(MUESTRAS);

// Carpeta de cada cuenta dentro de Cartolas/muestras
const CARPETA = {
  'Racional USD': 'racional/Racional Stocks',
  'Racional CLP': 'racional/Racional Portafolio',
  'Zesty': 'zesty',
  'BTG Pactual': 'btg',
  'XTB': 'xtb',
  'Fintual': 'fintual',
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function nombreEstandar(r) {
  if (!r.hasta) return undefined;
  if (r.tipoDoc === 'CERTIFICADO') return `${r.cuenta} certificado ${r.hasta}.pdf`;
  const [anio, mes, dia] = r.hasta.split('-');
  return `${r.cuenta} ${anio}-${mes} ${MESES[Number(mes) - 1]}${r.tipoDoc === 'PARCIAL' ? ` (al ${dia})` : ''}.pdf`;
}

const pdfs = carpetas.flatMap(c => fs.readdirSync(c, { recursive: true })
  .filter(f => f.toLowerCase().endsWith('.pdf') && !/^_(texto|duplicados)/.test(f))
  .map(f => path.join(c, f)))
  .sort();

// 1. Identificar cada PDF
const fichas = [];
for (const archivo of pdfs) {
  const datos = fs.readFileSync(archivo);
  const ficha = { archivo, bytes: datos.length };
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(datos), password: clave, verbosity: 0 }).promise;
    const texto = await textoDePdf(doc);
    const r = parseCartolaText(texto, path.basename(archivo));
    Object.assign(ficha, { r, huella: crypto.createHash('sha1').update(texto).digest('hex'), nombre: nombreEstandar(r) });
    if (r.sinTexto) ficha.problema = 'sin texto (escaneado)';
    else if (r.desconocido) ficha.problema = r.avisos[0] ?? 'formato no reconocido';
    else if (!ficha.nombre) ficha.problema = 'no se encontró la fecha de la cartola';
  } catch (e) {
    ficha.conClave = e?.name === 'PasswordException';
    ficha.problema = ficha.conClave ? 'PDF con clave: desbloquéalo para poder leerlo' : `no se pudo abrir (${e?.message})`;
  }
  fichas.push(ficha);
}

// 2. Decidir destino: primero las que ya están bien ubicadas, para que no se muevan sin necesidad
const ocupados = new Map(); // ruta destino -> huella
const plan = [];
const rel = p => path.relative(RAIZ, p);
const ordenadas = [...fichas].sort((a, b) => {
  const ok = f => (f.nombre && path.basename(f.archivo) === f.nombre ? 0 : 1);
  return ok(a) - ok(b) || a.archivo.localeCompare(b.archivo);
});
for (const f of ordenadas) {
  if (f.problema) {
    // Un PDF con clave dentro de muestras se aparta a _con_clave para que no se confunda con las legibles
    const dentro = !path.relative(MUESTRAS, f.archivo).startsWith('..');
    if (f.conClave && dentro) {
      const destino = path.join(MUESTRAS, '_con_clave', path.basename(f.archivo));
      plan.push({ f, accion: path.resolve(destino) === path.resolve(f.archivo) ? 'dejar' : 'mover', destino, motivo: f.problema });
    } else plan.push({ f, accion: 'dejar', motivo: f.problema });
    continue;
  }
  const carpeta = path.join(MUESTRAS, CARPETA[f.r.cuenta] ?? f.r.broker.toLowerCase().replace(/\s+/g, '-'));
  let destino = path.join(carpeta, f.nombre);
  const existente = ocupados.get(destino.toLowerCase()) ?? (fs.existsSync(destino) && path.resolve(destino) !== path.resolve(f.archivo)
    ? fichas.find(x => path.resolve(x.archivo) === path.resolve(destino))?.huella ?? 'desconocida' : undefined);
  if (existente === f.huella) {
    const dup = path.join(MUESTRAS, '_duplicados', f.nombre);
    let n = 1;
    let destinoDup = dup;
    while (fs.existsSync(destinoDup) || ocupados.has(destinoDup.toLowerCase())) destinoDup = dup.replace(/\.pdf$/, ` (copia ${++n}).pdf`);
    ocupados.set(destinoDup.toLowerCase(), f.huella);
    plan.push({ f, accion: 'duplicado', destino: destinoDup, motivo: 'misma cartola que otro archivo' });
    continue;
  }
  if (existente) {
    let n = 2;
    while (ocupados.has(destino.toLowerCase()) || (fs.existsSync(destino) && path.resolve(destino) !== path.resolve(f.archivo))) {
      destino = path.join(carpeta, f.nombre.replace(/\.pdf$/, ` (versión ${n++}).pdf`));
    }
  }
  ocupados.set(destino.toLowerCase(), f.huella);
  plan.push({ f, accion: path.resolve(destino) === path.resolve(f.archivo) ? 'ok' : 'mover', destino, motivo: existente ? 'otra versión del mismo período' : '' });
}

// 3. Mostrar y (si se pidió) aplicar
const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = [];
for (const p of plan.sort((a, b) => (a.destino ?? a.f.archivo).localeCompare(b.destino ?? b.f.archivo))) {
  const desc = p.f.r && !p.f.problema ? `${p.f.r.cuenta} ${p.f.r.tipoDoc} ${p.f.r.hasta}` : '';
  if (p.accion === 'ok') console.log(`  ok        ${rel(p.f.archivo)}`);
  else if (p.accion === 'dejar') console.log(`  ⚠ dejar   ${rel(p.f.archivo)}  (${p.motivo})`);
  else console.log(`  ${p.accion === 'duplicado' ? 'duplicado' : 'mover    '} ${rel(p.f.archivo)}\n         -> ${rel(p.destino)}  [${desc}${p.motivo ? `; ${p.motivo}` : ''}]`);
  if (aplicar && (p.accion === 'mover' || p.accion === 'duplicado')) {
    fs.mkdirSync(path.dirname(p.destino), { recursive: true });
    fs.renameSync(p.f.archivo, p.destino);
    log.push([fecha, rel(p.f.archivo), rel(p.destino), p.accion, p.motivo]);
  }
}
const resumen = plan.reduce((s, p) => ({ ...s, [p.accion]: (s[p.accion] ?? 0) + 1 }), {});
console.log(`\n${pdfs.length} PDF: ${JSON.stringify(resumen)}${aplicar ? '' : '\n(no se movió nada: agrega --aplicar para hacerlo)'}`);
if (aplicar && log.length) {
  const csv = path.join(RAIZ, 'revision', 'renombres.csv');
  fs.mkdirSync(path.dirname(csv), { recursive: true });
  const nuevo = !fs.existsSync(csv);
  fs.appendFileSync(csv, (nuevo ? '﻿fecha;origen;destino;accion;motivo\n' : '') + log.map(l => l.map(v => `"${v}"`).join(';')).join('\n') + '\n', 'utf8');
  console.log(`Registro en ${csv}`);
}

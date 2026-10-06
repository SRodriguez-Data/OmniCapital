// Revisa todas las cartolas de Cartolas/muestras con el mismo lector que usa la página y deja el resultado
// en Cartolas/revision/ (carpeta ignorada por git: nada de esto llega a GitHub):
//   informe.md        resumen por cuenta, faltantes, duplicados y cuadratura mes a mes
//   movimientos.csv   todos los movimientos con fecha (compras, ventas, dividendos, comisiones, aportes...)
//   posiciones.csv    posiciones actuales con su fecha de compra y costo promedio
//
// Uso (desde web/):  node scripts/revisar-cartolas.mjs [fecha de hoy YYYY-MM-DD]
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { textoDePdf, parseCartolaText } from '../src/lib/CartolaParser.ts';
import { construirLibro, formatoMonto, tickerYahoo, valorizarHoy } from '../src/lib/LibroInversiones.ts';
import YahooFinance from 'yahoo-finance2';

const RAIZ = path.resolve(import.meta.dirname, '../../Cartolas');
const MUESTRAS = path.join(RAIZ, 'muestras');
const SALIDA = path.join(RAIZ, 'revision');
const hoy = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const archivos = fs.readdirSync(MUESTRAS, { recursive: true })
  .filter(f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('_texto'))
  .sort();

const resultados = [];
for (const rel of archivos) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(MUESTRAS, rel))), verbosity: 0 }).promise;
  const r = parseCartolaText(await textoDePdf(doc), path.basename(rel));
  resultados.push(r);
  const tipos = {};
  for (const m of r.movimientos) tipos[m.tipo] = (tipos[m.tipo] ?? 0) + 1;
  console.log(`${r.cuenta.padEnd(13)} ${r.tipoDoc.padEnd(11)} ${(r.hasta ?? '?').padEnd(10)} ${path.basename(rel).slice(0, 48).padEnd(48)} ${JSON.stringify(tipos)}${r.foto ? ` foto:${r.foto.posiciones.length}pos caja:${r.foto.caja}` : ''}`);
}

const libro = construirLibro(resultados, hoy);
const fmt = (n, moneda) => (n === undefined ? '—' : formatoMonto(n, moneda));
const pct = n => (n === undefined ? '—' : `${(n * 100).toFixed(2)}%`);
const fecha = f => (f ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : '—');

const md = [];
md.push(`# Revisión de cartolas (${fecha(hoy)})`, '', `${resultados.length} archivos leídos. ${libro.movimientos.length} movimientos en el libro.`, '');
md.push('## Cómo vas por cuenta', '');
md.push('| Cuenta | Período | Cartolas | Capital previo | Aportes | Retiros | Dividendos | Impuestos | Comisiones | Sin detalle | Gan. realizada | Valor actual | Ganancia | Rentab. | TIR anual |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of libro.cuentas) {
  const m = c.moneda;
  md.push(`| ${c.cuenta} | ${fecha(c.desde)} → ${fecha(c.hasta)} | ${c.cartolas} | ${fmt(c.capitalInicial, m)} | ${fmt(c.aportes, m)}${c.aportesImplicitos ? ' (deducidos)' : ''} | ${fmt(c.retiros, m)} | ${fmt(c.dividendos, m)} | ${fmt(c.impuestos, m)} | ${fmt(c.comisiones + c.comisionesIncluidas, m)} | ${fmt(c.noInformado, m)} | ${fmt(c.gananciaRealizada, m)} | ${fmt(c.valorActual, m)} ${c.fechaValor ? `(${fecha(c.fechaValor)})` : ''} | ${fmt(c.ganancia, m)} | ${pct(c.rentabilidad)} | ${pct(c.tir)} |`);
}
if (libro.dolar) md.push('', `Dólar de referencia: $${libro.dolar.valor.toLocaleString('es-CL')} (${fecha(libro.dolar.fecha)}).`);

// Valorización a hoy con precios de Yahoo (si hay internet)
try {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], validation: { logErrors: false }, versionCheck: false });
  const simbolos = [...new Set(libro.posiciones.map(p => tickerYahoo(p.ticker, p.moneda))), 'CLP=X'];
  const precios = {};
  for (const q of await yf.quote(simbolos)) if (q.regularMarketPrice) precios[q.symbol] = q.regularMarketPrice;
  const dolarHoy = precios['CLP=X'];
  const hoyValor = valorizarHoy(libro, precios, dolarHoy, hoy);
  md.push('', `## Cómo vas a hoy (${fecha(hoy)}, precios de Yahoo, dólar $${dolarHoy?.toFixed(2)})`, '');
  md.push('| Cuenta | Invertido (capital previo + aportes) | Retiros | Valor hoy | Ganancia | Rentab. | TIR anual |', '|---|---|---|---|---|---|---|');
  let totalInv = 0, totalRet = 0, totalValor = 0;
  for (const v of hoyValor) {
    const c = libro.cuentas.find(x => x.cuenta === v.cuenta);
    const aClp = n => (c.moneda === 'USD' ? n * dolarHoy : n);
    totalInv += aClp(c.aportes + c.capitalInicial); totalRet += aClp(c.retiros); totalValor += aClp(v.valor);
    md.push(`| ${v.cuenta} | ${fmt(c.aportes + c.capitalInicial, c.moneda)} | ${fmt(c.retiros, c.moneda)} | ${fmt(v.valor, c.moneda)} | ${fmt(v.ganancia, c.moneda)} | ${pct(v.rentabilidad)} | ${pct(v.tir)} |${v.sinPrecio.length ? ` sin precio: ${v.sinPrecio.join(', ')}` : ''}`);
  }
  md.push(`| **Total en pesos** (USD al dólar de hoy) | ${fmt(totalInv, 'CLP')} | ${fmt(totalRet, 'CLP')} | ${fmt(totalValor, 'CLP')} | ${fmt(totalValor + totalRet - totalInv, 'CLP')} | ${pct((totalValor + totalRet - totalInv) / totalInv)} | |`);
} catch (e) {
  md.push('', `(No se pudo valorizar a hoy: ${e.message})`);
}

md.push('', '## Alertas', '');
for (const a of libro.alertas) md.push(`- **${a.nivel}** ${a.texto}`);
md.push('', '## Duplicados', '');
if (libro.duplicados.length === 0) md.push('- Ninguno.');
for (const d of libro.duplicados) md.push(`- (${d.tipo}) ${d.texto}`);
md.push('', '## Cuadratura mes a mes', '');
for (const c of libro.conciliaciones) md.push(`- ${c.ok ? '✅' : '❌'} ${c.cuenta} ${fecha(c.fecha)} (${c.archivo})${c.ok ? '' : `: ${c.diferencias.join(' ')}`}`);

md.push('', '## Posiciones actuales', '');
md.push('| Cuenta | Activo | Cantidad | Costo promedio | Costo total | Desde | Dividendos cobrados | Precio cartola | Valor cartola |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const p of libro.posiciones) {
  md.push(`| ${p.cuenta} | ${p.ticker} | ${p.cantidad} | ${p.costo !== undefined ? fmt(p.costo / p.cantidad, p.moneda) : 'no informado'} | ${fmt(p.costo, p.moneda)} | ${fecha(p.fechaCompra)}${p.fechaCompraAproximada ? ' o antes' : ''} | ${fmt(p.dividendos, p.monedaDividendos)} | ${fmt(p.precio, p.moneda)} | ${fmt(p.valor, p.moneda)} (${fecha(p.fechaPrecio)}) |`);
}

const csv = filas => filas.map(f => f.map(v => (v === undefined || v === null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(';')).join('\n');
fs.mkdirSync(SALIDA, { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'informe.md'), md.join('\n'), 'utf8');
fs.writeFileSync(path.join(SALIDA, 'movimientos.csv'), '﻿' + csv([
  ['fecha', 'fecha_liquidacion', 'cuenta', 'tipo', 'ticker', 'cantidad', 'precio', 'monto', 'moneda', 'deducido', 'detalle', 'archivo'],
  ...libro.movimientos.map(m => [m.fecha, m.fechaLiquidacion, m.cuenta, m.tipo, m.ticker, m.cantidad, m.precio, m.montoIncluido ?? m.monto, m.moneda, m.implicito ? 'si' : '', m.detalle, m.archivo]),
]), 'utf8');
fs.writeFileSync(path.join(SALIDA, 'posiciones.csv'), '﻿' + csv([
  ['cuenta', 'ticker', 'cantidad', 'costo_total', 'costo_promedio', 'moneda', 'desde', 'fecha_aproximada', 'dividendos_cobrados'],
  ...libro.posiciones.map(p => [p.cuenta, p.ticker, p.cantidad, p.costo, p.costo !== undefined ? p.costo / p.cantidad : undefined, p.moneda, p.fechaCompra, p.fechaCompraAproximada ? 'si' : '', p.dividendos]),
]), 'utf8');

console.log('\n' + md.join('\n'));
console.log(`\nArchivos escritos en ${SALIDA}`);

// Lee el texto de un comprobante de compra o venta que la corredora manda por correo y lo convierte en operaciones listas
// para registrar en mi_portafolio (las usa el bot del correo, scripts/leer-correo.ts). Sin dependencias de servidor.
//
// Comprobantes que entiende (el PDF adjunto, ya convertido a texto con textoDePdf):
//   - XTB: "Confirmación de órdenes ejecutadas" (DailyStatement; órdenes de compra y de venta, acciones enteras y fraccionadas).
//   - Vector Capital (la corredora detrás de Racional Portafolio y de Zesty): factura electrónica con líneas COMPRA RV / VENTA RV.
//   - Alpaca (la custodia de Fintual Acciones): "Confirmación de transacciones" con ORDER ID, SYMBOL, buy/sell.
// Lo demás (dividendos, comisiones, cartolas mensuales, traspasos) no es una operación: se devuelve sin operaciones.
// Si un comprobante parece de operaciones pero no se pudo leer, se devuelve en `avisos` para que alguien lo mire, nunca
// se adivina.

export interface Operacion {
  /** Identifica la operación para no registrarla dos veces, aunque el correo llegue repetido */
  clave: string;
  fuente: 'XTB' | 'Vector' | 'Alpaca';
  ticker: string;
  lado: 'COMPRAR' | 'VENDER';
  cantidad: number;
  precio: number;
  moneda: 'USD' | 'CLP';
  fecha: string; // YYYY-MM-DD
}

export interface Lectura {
  fuente: Operacion['fuente'] | null;
  operaciones: Operacion[];
  avisos: string[];
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const dos = (n: number | string) => String(n).padStart(2, '0');
const fechaIso = (a: number | string, m: number | string, d: number | string) => `${a}-${dos(m)}-${dos(d)}`;

/** "1.234,56" → 1234.56 (formato chileno: punto de miles, coma decimal) */
export function numeroCl(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

// --- XTB --------------------------------------------------------------------------------------------------------------

function leerXtb(texto: string): Lectura {
  const r: Lectura = { fuente: 'XTB', operaciones: [], avisos: [] };
  let lado: 'COMPRAR' | 'VENDER' | null = null;
  let filasVistas = 0;
  for (const linea of texto.split('\n')) {
    const seccion = linea.match(/[ÓO]rdenes de (compra|venta)/i);
    if (seccion) lado = seccion[1].toLowerCase() === 'compra' ? 'COMPRAR' : 'VENDER';
    const fila = linea.match(/^\s*\d+\s+(\d{6,})\s+(.*)$/);
    if (!fila) continue;
    filasVistas++;
    const [, idOrden, resto] = fila;
    const t = resto.match(/\b([A-Z0-9]+(?:-[A-Z])?)\.([A-Z]{2})\b/);
    const d = resto.match(/(\d[\d.]*,\d+)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(buy|sell)\b(?:\s+(?:limit|stop|market))?\s+(\d[\d.]*,\d+)/i);
    if (!t || !d || !lado) {
      r.avisos.push(`XTB: no pude leer la orden ${idOrden}.`);
      continue;
    }
    const ladoFila = d[5].toLowerCase() === 'buy' ? 'COMPRAR' : 'VENDER';
    if (ladoFila !== lado) {
      r.avisos.push(`XTB: la orden ${idOrden} dice ${d[5]} pero está en la sección de ${lado === 'COMPRAR' ? 'compras' : 'ventas'}.`);
      continue;
    }
    if (t[2] !== 'US') {
      r.avisos.push(`XTB: la orden ${idOrden} es de ${t[1]}.${t[2]}, un mercado que el bot no registra.`);
      continue;
    }
    const cantidad = numeroCl(d[1]);
    const precio = numeroCl(d[6]);
    if (!(cantidad > 0) || !(precio > 0)) {
      r.avisos.push(`XTB: la orden ${idOrden} trae cantidad o precio inválidos.`);
      continue;
    }
    r.operaciones.push({ clave: `xtb:${idOrden}:${d[1]}`, fuente: 'XTB', ticker: t[1], lado, cantidad, precio, moneda: 'USD', fecha: fechaIso(d[4], d[3], d[2]) });
  }
  if (!filasVistas) r.avisos.push('XTB: el comprobante dice que hay órdenes ejecutadas, pero no encontré ninguna fila.');
  return r;
}

// --- Vector Capital (Racional Portafolio y Zesty) ----------------------------------------------------------------------

function leerVector(texto: string): Lectura {
  const r: Lectura = { fuente: 'Vector', operaciones: [], avisos: [] };
  const numero = texto.match(/\bN°\s*(\d{5,})/)?.[1];
  const f = texto.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+del?\s+(\d{4})/);
  const mes = f ? MESES.indexOf(f[2].toLowerCase()) : -1;
  if (!numero || !f || mes < 0) {
    r.avisos.push('Vector: no encontré el número o la fecha de la factura.');
    return r;
  }
  const fecha = fechaIso(f[3], mes + 1, f[1]);
  for (const linea of texto.split('\n')) {
    if (!/^\s*(COMPRA|VENTA)\s+RV\b/.test(linea)) continue;
    const m = linea.match(/^\s*(COMPRA|VENTA)\s+RV\s+([A-Z0-9][A-Z0-9-]*)\s+(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*)\s/);
    if (!m) {
      r.avisos.push(`Vector: no pude leer una línea de la factura ${numero}.`);
      continue;
    }
    const cantidad = numeroCl(m[4]);
    const precio = numeroCl(m[3]);
    if (!(cantidad > 0) || !(precio > 0)) {
      r.avisos.push(`Vector: la factura ${numero} trae cantidad o precio inválidos.`);
      continue;
    }
    const lado = m[1] === 'COMPRA' ? 'COMPRAR' : 'VENDER';
    r.operaciones.push({ clave: `vector:${numero}:${lado}:${m[2]}:${m[3]}:${m[4]}`, fuente: 'Vector', ticker: `${m[2]}.SN`, lado, cantidad, precio, moneda: 'CLP', fecha });
  }
  // Las facturas de comisión, derechos o IVA no tienen líneas de compra o venta: no son operaciones
  return r;
}

// --- Alpaca (Fintual Acciones) -----------------------------------------------------------------------------------------

function leerAlpaca(texto: string): Lectura {
  const r: Lectura = { fuente: 'Alpaca', operaciones: [], avisos: [] };
  const bloques = texto.split(/ORDER ID:\s*/).slice(1);
  if (!bloques.length) {
    r.avisos.push('Alpaca: no encontré ninguna orden en la confirmación.');
    return r;
  }
  for (const b of bloques) {
    const id = b.match(/^([0-9a-f-]{8,})/i)?.[1];
    const simbolo = b.match(/SYMBOL:\s*([A-Z0-9.]+)/)?.[1];
    const fila = b.match(/\b(buy|sell)\s+(\d+(?:\.\d+)?)\s+([A-Z]{3})\s+(\d+(?:\.\d+)?)\s+-?\d[\d.,]*\s+-?\d[\d.,]*\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/);
    const mes = fila ? MESES_EN.indexOf(fila[5].toLowerCase()) : -1;
    if (!id || !simbolo || !fila || mes < 0) {
      r.avisos.push(`Alpaca: no pude leer la orden ${id ?? '(sin id)'}.`);
      continue;
    }
    if (fila[3] !== 'USD') {
      r.avisos.push(`Alpaca: la orden ${id} está en ${fila[3]}, no en dólares.`);
      continue;
    }
    const cantidad = Number(fila[2]);
    const precio = Number(fila[4]);
    if (!(cantidad > 0) || !(precio > 0)) {
      r.avisos.push(`Alpaca: la orden ${id} trae cantidad o precio inválidos.`);
      continue;
    }
    r.operaciones.push({ clave: `alpaca:${id}`, fuente: 'Alpaca', ticker: simbolo, lado: fila[1] === 'buy' ? 'COMPRAR' : 'VENDER', cantidad, precio, moneda: 'USD', fecha: fechaIso(fila[7], mes + 1, fila[6]) });
  }
  return r;
}

// --- Entrada -----------------------------------------------------------------------------------------------------------

/** Reconoce el comprobante por lo que dice, no por quién lo mandó (el correo llega reenviado). */
export function leerComprobante(texto: string): Lectura {
  if (/Confirmaci[óo]n de [óo]rdenes ejecutadas/i.test(texto)) return leerXtb(texto);
  if (/FACTURA ELECTRONICA/i.test(texto) && /Vector Capital/i.test(texto)) return leerVector(texto);
  if (/ORDER ID:/.test(texto) && /Alpaca/i.test(texto)) return leerAlpaca(texto);
  return { fuente: null, operaciones: [], avisos: [] };
}

/** Lo mismo con varias lecturas (un correo puede traer más de un PDF); sin claves repetidas. */
export function juntar(lecturas: Lectura[]): Lectura {
  const vistas = new Set<string>();
  const operaciones = lecturas.flatMap(l => l.operaciones).filter(o => !vistas.has(o.clave) && vistas.add(o.clave));
  return { fuente: lecturas.find(l => l.fuente)?.fuente ?? null, operaciones, avisos: lecturas.flatMap(l => l.avisos) };
}

/**
 * ¿Es esta compra la misma que ya hay en la cartera guardada (anotada a mano o por el bot)? Mismo ticker y fecha, y
 * cantidad y precio casi iguales: a mano suelen anotarse con menos decimales. Así el bot no duplica lo ya registrado.
 */
export function yaRegistrada(o: Operacion, lotes: { ticker: string; cantidad: number; precio_compra: number; purchase_date: string | null }[]): boolean {
  if (o.lado !== 'COMPRAR') return false;
  const cerca = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
  return lotes.some(l => l.ticker === o.ticker && l.purchase_date === o.fecha && cerca(l.cantidad, o.cantidad, 0.01) && cerca(l.precio_compra, o.precio, 0.01));
}

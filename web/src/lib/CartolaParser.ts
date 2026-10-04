// Lector de cartolas de brokers (100% en el navegador).
// - Racional US (DriveWealth): confirmaciones por operación (Buy/Sell; las ventas traen cantidad negativa).
// - Racional Chile (Vector Capital): ledger mensual con foto de la cartera + detalle de transacciones.
// - Fintual: compras y dividendos.

const PATRON_US_TRADE = /\b([A-Z]{1,5})\b(?:(?!\b(?:Buy|BUY|buy|Sell|SELL|sell|Compra|COMPRA|compra|Venta|VENTA|venta)\b).){1,100}?\b(Buy|BUY|buy|Sell|SELL|sell|Compra|COMPRA|compra|Venta|VENTA|venta)\b(?:\s+\d{1,2}:\d{2}:\d{2}\s+[APMpm]{2})?\s+(-?[\d\.,]+)\s+([\d\.,]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/g;
const PATRON_US_DIVIDEND = /\b([A-Z]{1,5})\b(?:(?!\b(?:Cash Dividend|CDIV|CASH DIVIDEND)\b).){1,100}?\b(Cash Dividend|CDIV|CASH DIVIDEND)\b\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d\.,]+)/g;
// Fecha op, fecha liq, [COMPRA|VENTA] ACCIONES|FONDOS ..., instrumento, moneda, cantidad, $ precio (redondeado), $ monto
const PATRON_CL_TRADE = /(\d{2}-\d{2}-\d{4})\s+\d{2}-\d{2}-\d{4}\s+(?:(COMPRA|VENTA|Compra|Venta)\s+)?(?:ACCIONES|FONDOS|Acciones|Fondos)(?:(?!\b(?:CLP|USD)\b).){1,100}?\s+([A-Z0-9\-]{2,10})\s+(CLP|USD)\s+([\d\.,]+)\s*\$\s*([\d\.,]+)(?:\s*\$\s*([\d\.,]+))?/g;
// Fila de "Cartera de Inversiones": nemotécnico, moneda, precio compra, valor compra, nominales, precio actual, valor actual, variación, % var
const PATRON_CL_POSICION = /\b([A-Z][A-Z0-9\-]{1,14})\s+(CLP|USD)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+(-?[\d\.,]+)\s+(-?[\d\.,]+)/g;
const PATRON_CL_FECHA_CORTE = /Estado de Cuenta al\s+[A-ZÁÉÍÓÚÑ]+,\s+(\d{1,2}) DE ([A-ZÁÉÍÓÚÑ]+) DE (\d{4})/i;
const PATRON_FINTUAL_COMPRA = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]{2,10})\s+(?:ETF|Acciones|Fondo)(?:(?!\bUS\s+\$\b).){1,100}?US\s+\$\s*([\d,]+)\s+([\d,]+)/g;
const PATRON_FINTUAL_DIVIDEND = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]{2,10})\s+(?:ETF|Acciones|Fondo)(?:(?!\bUS\s+\$\b).){1,100}?US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)/g;

const MESES: Record<string, string> = {
  ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
  JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12'
};

const TICKER_ALIASES: Record<string, string> = {
  'BCHILE': 'CHILE',
  'SANTANDER': 'BSANTANDER',
  'SQMB': 'SQM-B',
  'ANDINAB': 'ANDINA-B',
  'AGUASA': 'AGUAS-A'
};

function parseNumberFintual(val: string) {
  if (!val) return 0;
  return parseFloat(val.replace(/\./g, '').replace(/,/g, '.'));
}

function parseNumberRacional(val: string) {
  if (!val) return 0;
  return parseFloat(val.replace(/,/g, ''));
}

function parseDate(val: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  if (/^\d{2}-\d{2}-\d{4}$/.test(val)) {
    const parts = val.split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
    const parts = val.split('/');
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return new Date().toISOString().split('T')[0];
}

// Normaliza un nemotécnico chileno: fusiones, alias y sufijo .SN de Yahoo
function normalizarTickerCL(raw: string, moneda: 'USD' | 'CLP', cantidad: number, precio: number) {
  let ticker = raw.toUpperCase();
  // Fusión CFMDIVO -> CFMITNIPSA (Ratio: 0.384122446)
  if (ticker === 'CFMDIVO') {
    const ratio = 0.384122446;
    ticker = 'CFMITNIPSA';
    cantidad = cantidad * ratio;
    precio = precio / ratio;
  }
  if (TICKER_ALIASES[ticker]) ticker = TICKER_ALIASES[ticker];
  if (moneda === 'CLP' && !ticker.endsWith('.SN')) ticker += '.SN';
  return { ticker, cantidad, precio };
}

export type Fuente = 'DRIVEWEALTH' | 'VECTOR' | 'FINTUAL';

export interface Operacion {
  Fecha: string;
  Archivo: string;
  Ticker: string;
  Tipo: 'COMPRA' | 'VENTA' | 'DIVIDENDO';
  Precio: number;
  Cantidad: number;
  Moneda: 'USD' | 'CLP';
  Fuente: Fuente;
}

// Foto de la cartera que traen algunos estados de cuenta (Vector): la verdad del broker a esa fecha
export interface FotoCartera {
  fuente: Fuente;
  fecha: string;
  posiciones: { ticker: string; cantidad: number; precio_compra: number; moneda: 'USD' | 'CLP' }[];
}

export interface ResultadoCartola {
  broker: string;
  file_name: string;
  data: Operacion[];
  foto?: FotoCartera;
  sinTexto?: boolean; // PDF escaneado (imagen): no se puede leer sin OCR
}

export async function parsePdfToCartola(file: File): Promise<ResultadoCartola> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => ('str' in item ? item.str : ''));
      text += strings.join(" ") + " ";
    }

    return parseCartolaText(text, file.name);
  } catch (err) {
    console.error("PDF parse error:", err);
    throw new Error(`Error procesando ${file.name} en el navegador.`);
  }
}

// Interpreta el texto ya extraído de una cartola. Función pura (testeable sin navegador).
export function parseCartolaText(text: string, fileName: string): ResultadoCartola {
  const lower = text.toLowerCase();
  if (text.trim().length < 50) {
    return { broker: 'Desconocido', file_name: fileName, data: [], sinTexto: true };
  }

  let broker = "Desconocido";
  if (lower.includes('fintual')) broker = "Fintual";
  else if (lower.includes('drivewealth') || lower.includes('alpaca') || lower.includes('racional') || lower.includes('vector capital')) broker = "Racional";

  const data: Operacion[] = [];
  let foto: FotoCartera | undefined;

  if (broker === 'Fintual') {
    for (const m of text.matchAll(PATRON_FINTUAL_DIVIDEND)) {
      data.push({ Fecha: parseDate(m[1]), Archivo: fileName, Ticker: m[3].toUpperCase(), Tipo: 'DIVIDENDO', Precio: parseNumberFintual(m[6]), Cantidad: 1.0, Moneda: 'USD', Fuente: 'FINTUAL' });
    }
    for (const m of text.matchAll(PATRON_FINTUAL_COMPRA)) {
      data.push({ Fecha: parseDate(m[1]), Archivo: fileName, Ticker: m[3].toUpperCase(), Tipo: 'COMPRA', Precio: parseNumberFintual(m[4]), Cantidad: parseNumberFintual(m[5]), Moneda: 'USD', Fuente: 'FINTUAL' });
    }
  } else if (broker === 'Racional') {
    // 1. Confirmaciones US (DriveWealth)
    for (const m of text.matchAll(PATRON_US_TRADE)) {
      const ticker = m[1].toUpperCase();
      // Las ventas vienen con cantidad negativa (ej: -0.12345678)
      let cantidad = Math.abs(parseNumberRacional(m[3]));
      let precio = parseNumberRacional(m[4]);
      const fecha = parseDate(m[5]);

      // Ajuste por Stock Split de HDV (5:1) ocurrido el 29 de Abril de 2026
      if (ticker === 'HDV' && fecha < '2026-04-29') {
        cantidad = cantidad * 5;
        precio = precio / 5;
      }

      const esCompra = ['BUY', 'COMPRA'].includes(m[2].toUpperCase());
      data.push({ Fecha: fecha, Archivo: fileName, Ticker: ticker, Tipo: esCompra ? 'COMPRA' : 'VENTA', Precio: precio, Cantidad: cantidad, Moneda: 'USD', Fuente: 'DRIVEWEALTH' });
    }

    for (const m of text.matchAll(PATRON_US_DIVIDEND)) {
      data.push({ Fecha: parseDate(m[3]), Archivo: fileName, Ticker: m[1].toUpperCase(), Tipo: 'DIVIDENDO', Precio: parseNumberRacional(m[4]), Cantidad: 1.0, Moneda: 'USD', Fuente: 'DRIVEWEALTH' });
    }

    // 2. Transacciones locales (Vector Capital)
    for (const m of text.matchAll(PATRON_CL_TRADE)) {
      const moneda = m[4].toUpperCase() === 'USD' ? 'USD' : 'CLP';
      const cantidadRaw = parseNumberFintual(m[5]);
      // El precio impreso viene redondeado: si está el monto, el precio real es monto / cantidad
      const monto = m[7] ? parseNumberFintual(m[7]) : 0;
      const precioRaw = monto > 0 && cantidadRaw > 0 ? monto / cantidadRaw : parseNumberFintual(m[6]);
      const { ticker, cantidad, precio } = normalizarTickerCL(m[3], moneda, cantidadRaw, precioRaw);
      const tipo = m[2] && m[2].toUpperCase() === 'VENTA' ? 'VENTA' : 'COMPRA';
      data.push({ Fecha: parseDate(m[1]), Archivo: fileName, Ticker: ticker, Tipo: tipo, Precio: precio, Cantidad: cantidad, Moneda: moneda, Fuente: 'VECTOR' });
    }

    // 3. Foto de la cartera (Vector): sección "Cartera de Inversiones"
    const fechaMatch = text.match(PATRON_CL_FECHA_CORTE);
    const inicio = text.indexOf('Cartera de Inversiones');
    if (fechaMatch && inicio >= 0 && MESES[fechaMatch[2].toUpperCase()]) {
      const fin = text.indexOf('Detalle de Movimiento', inicio);
      const seccion = text.slice(inicio, fin > inicio ? fin : undefined);
      const posiciones: FotoCartera['posiciones'] = [];
      for (const m of seccion.matchAll(PATRON_CL_POSICION)) {
        const moneda = m[2] === 'USD' ? 'USD' : 'CLP';
        const { ticker, cantidad, precio } = normalizarTickerCL(m[1], moneda, parseNumberFintual(m[5]), parseNumberFintual(m[3]));
        if (cantidad > 0) posiciones.push({ ticker, cantidad, precio_compra: precio, moneda });
      }
      const fecha = `${fechaMatch[3]}-${MESES[fechaMatch[2].toUpperCase()]}-${fechaMatch[1].padStart(2, '0')}`;
      // Una foto vacía también es información (cartera sin posiciones a esa fecha)
      foto = { fuente: 'VECTOR', fecha, posiciones };
    }
  }

  return { broker, file_name: fileName, data, foto };
}

export interface PosicionConsolidada {
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date: string;
}

// Consolida todas las cartolas subidas en posiciones actuales.
// - Si una fuente trae foto de cartera, se usa la más reciente y solo se aplican transacciones posteriores.
// - El resto se reconstruye sumando compras y restando ventas (costo promedio ponderado).
// - Una operación idéntica que aparece en otro archivo (PDF duplicado) se cuenta una sola vez.
export function consolidarCartolas(resultados: ResultadoCartola[]): { posiciones: PosicionConsolidada[]; duplicadas: number } {
  // Foto más reciente por fuente
  const fotos = new Map<Fuente, FotoCartera>();
  for (const r of resultados) {
    if (r.foto && (!fotos.has(r.foto.fuente) || r.foto.fecha > fotos.get(r.foto.fuente)!.fecha)) {
      fotos.set(r.foto.fuente, r.foto);
    }
  }

  // Deduplicar operaciones entre archivos distintos
  const vistas = new Map<string, string>(); // clave -> archivo donde apareció primero
  const operaciones: Operacion[] = [];
  let duplicadas = 0;
  for (const r of resultados) {
    for (const o of r.data) {
      if (o.Tipo === 'DIVIDENDO') continue;
      const clave = [o.Fuente, o.Fecha, o.Ticker, o.Tipo, o.Cantidad.toFixed(8), o.Precio.toFixed(6)].join('|');
      const archivo = vistas.get(clave);
      if (archivo !== undefined && archivo !== o.Archivo) { duplicadas++; continue; }
      vistas.set(clave, o.Archivo);
      operaciones.push(o);
    }
  }

  // Fecha de primera compra conocida por ticker (para gráficos y dividendos desde la compra)
  const primeraCompra = new Map<string, string>();
  for (const o of operaciones) {
    if (o.Tipo === 'COMPRA' && (!primeraCompra.has(o.Ticker) || o.Fecha < primeraCompra.get(o.Ticker)!)) {
      primeraCompra.set(o.Ticker, o.Fecha);
    }
  }

  const pos = new Map<string, { cantidad: number; costo: number; moneda: 'USD' | 'CLP'; fecha: string }>();
  for (const foto of fotos.values()) {
    for (const p of foto.posiciones) {
      pos.set(p.ticker, { cantidad: p.cantidad, costo: p.cantidad * p.precio_compra, moneda: p.moneda, fecha: primeraCompra.get(p.ticker) ?? foto.fecha });
    }
  }

  const ordenadas = operaciones
    .filter(o => { const foto = fotos.get(o.Fuente); return !foto || o.Fecha > foto.fecha; })
    .sort((a, b) => a.Fecha.localeCompare(b.Fecha));

  for (const o of ordenadas) {
    const actual = pos.get(o.Ticker) ?? { cantidad: 0, costo: 0, moneda: o.Moneda, fecha: o.Fecha };
    if (o.Tipo === 'COMPRA') {
      if (actual.cantidad <= 1e-9) actual.fecha = o.Fecha;
      actual.cantidad += o.Cantidad;
      actual.costo += o.Cantidad * o.Precio;
    } else {
      // Venta: el costo promedio de lo que queda no cambia
      const promedio = actual.cantidad > 0 ? actual.costo / actual.cantidad : 0;
      actual.cantidad = Math.max(0, actual.cantidad - o.Cantidad);
      actual.costo = promedio * actual.cantidad;
    }
    pos.set(o.Ticker, actual);
  }

  const posiciones = Array.from(pos.entries())
    .filter(([, p]) => p.cantidad > 1e-6)
    .map(([ticker, p]) => ({
      ticker,
      cantidad: Number(p.cantidad.toFixed(8)),
      precio_compra: p.costo / p.cantidad,
      moneda: p.moneda,
      purchase_date: p.fecha,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { posiciones, duplicadas };
}

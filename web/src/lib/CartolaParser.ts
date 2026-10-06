// Lector de cartolas de brokers. Corre 100% en el navegador (los PDFs no salen del computador) y el
// script scripts/revisar-cartolas.mjs usa exactamente el mismo código para revisar las cartolas reales.
//
// Cada cartola se convierte en movimientos con fecha (compras, ventas, dividendos, retenciones,
// comisiones, aportes, retiros, splits y canjes) más la foto de la cartera que informa el broker a la
// fecha de corte, que sirve para comprobar que los movimientos cuadran. Formatos soportados:
// - Racional USD: estado de cuenta mensual de DriveWealth (Stmt_RCNL_...).
// - Racional CLP y Zesty: estado de cuenta mensual de Vector Capital (completo o resumen de 1 página).
// - BTG Pactual: estado de cuenta mensual (o parcial a una fecha).
// - XTB: cartola mensual.
// - Fintual: certificado de transacciones en acciones y ETFs (acumulado desde el inicio).

export type Moneda = 'USD' | 'CLP';

export type TipoMovimiento =
  | 'COMPRA' | 'VENTA'
  | 'DIVIDENDO'   // monto bruto recibido
  | 'IMPUESTO'    // retención de impuestos (monto negativo)
  | 'COMISION'    // cobro (negativo) o reverso de un cobro (positivo)
  | 'INTERES'     // ej. préstamo de valores
  | 'APORTE' | 'RETIRO'
  | 'SPLIT'       // cambia la cantidad sin mover caja (cantidad con signo)
  | 'CANJE'       // sale un instrumento y entra otro, sin mover caja (cantidad con signo)
  // Solo los genera el libro (LibroInversiones.ts) al cuadrar las cartolas:
  | 'SALDO_INICIAL' // posición o caja que ya existía antes de la primera cartola
  | 'NO_INFORMADO'; // diferencia que la cartola no detalla (ej. cartola resumida de 1 página)

export interface Movimiento {
  cuenta: string;
  fecha: string;              // fecha de la operación (YYYY-MM-DD)
  fechaLiquidacion?: string;  // cuándo se movió la caja, si es distinta
  tipo: TipoMovimiento;
  ticker?: string;            // nemotécnico tal como lo informa el broker (sin sufijo .SN)
  cantidad?: number;          // positiva, salvo en SPLIT/CANJE (con signo)
  precio?: number;
  monto: number;              // efecto en la caja de la cuenta, con signo (una compra es negativa)
  moneda: Moneda;
  detalle: string;            // glosa original de la cartola
  archivo: string;
  implicito?: boolean;        // deducido (no viene como línea propia en la cartola)
  estimado?: boolean;         // calculado con datos externos (ej. dividendo por acción de Yahoo): no es cifra del broker
  montoIncluido?: number;     // gasto ya descontado en otra línea (ej. comisión dentro del monto de una venta)
  monedaActivo?: Moneda;      // moneda del precio cuando el activo cotiza en otra moneda que la caja (XTB: acciones en USD, caja en CLP)
}

export interface PosicionFoto {
  ticker: string;
  cantidad: number;
  costo?: number;         // costo total según el broker
  precio?: number;        // precio de mercado a la fecha de corte
  valor?: number;         // valor de mercado a la fecha de corte
  moneda: Moneda;
}

// Lo que el broker dice que había en la cuenta a la fecha de corte
export interface FotoCartera {
  fecha: string;
  posiciones: PosicionFoto[];
  caja?: number;
  valorTotal?: number;        // patrimonio total de la cuenta (posiciones + caja)
  valorInicial?: number;      // patrimonio al inicio del período, si la cartola lo informa
  cajaInicial?: number;
  completa: boolean;          // false si la cartola solo lista las mayores inversiones
  cajaPorOperacion?: boolean; // la caja refleja las operaciones al día de operación (no al de liquidación)
}

export type TipoDocumento = 'MENSUAL' | 'PARCIAL' | 'RESUMEN' | 'CERTIFICADO';

export interface ResultadoCartola {
  archivo: string;
  broker: string;
  cuenta: string;          // ej. "Racional USD", "Racional CLP", "Zesty", "BTG Pactual", "XTB", "Fintual"
  numeroCuenta?: string;
  moneda: Moneda;          // moneda de la caja de la cuenta
  tipoDoc: TipoDocumento;
  desde?: string;
  hasta?: string;
  movimientos: Movimiento[];
  foto?: FotoCartera;
  dolar?: number;          // dólar observado que informa la cartola a la fecha de corte
  avisos: string[];
  sinTexto?: boolean;      // PDF escaneado: no se puede leer sin OCR
  conClave?: boolean;      // PDF protegido y sin la clave correcta
  desconocido?: boolean;   // formato no soportado
}

// --- Extracción de texto -------------------------------------------------------------------------
// Solo la parte de pdf.js que usamos, para que sirva igual con pdfjs-dist en el navegador y en Node.
interface PdfItem { str: string; transform: number[] }
interface PdfPagina {
  getViewport(opciones: { scale: number }): { transform: number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
}
export interface PdfDocumento { numPages: number; getPage(n: number): Promise<PdfPagina> }

// Producto de dos matrices afines de PDF [a, b, c, d, e, f] (igual que pdfjs Util.transform)
const componer = (m: number[], n: number[]) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Reconstruye las líneas de cada página agrupando el texto por altura y ordenándolo de izquierda a derecha.
// Las coordenadas se pasan a las de la página tal como se ve (las de BTG vienen rotadas 90°), y cada
// texto se ubica en su columna (~4 puntos por carácter): las columnas quedan separadas por 2+ espacios.
export async function textoDePdf(doc: PdfDocumento): Promise<string> {
  const paginas: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 }).transform;
    const items = (await pagina.getTextContent()).items
      .filter((i): i is PdfItem => typeof (i as PdfItem).str === 'string' && (i as PdfItem).str.trim() !== '')
      .map(i => {
        const t = componer(vista, i.transform);
        return { str: i.str, x: t[4], y: t[5] };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const lineas: { y: number; items: { str: string; x: number }[] }[] = [];
    for (const it of items) {
      const ultima = lineas[lineas.length - 1];
      if (ultima && Math.abs(it.y - ultima.y) <= 2) ultima.items.push(it);
      else lineas.push({ y: it.y, items: [it] });
    }
    const render = lineas.map(l => {
      let out = '';
      for (const it of l.items.sort((a, b) => a.x - b.x)) {
        out = out.padEnd(Math.max(out.length + 1, Math.round(it.x / 4))) + it.str;
      }
      return out.trim();
    });
    paginas.push(`===== Página ${n} de ${doc.numPages} =====\n${render.join('\n')}`);
  }
  return paginas.join('\n\n');
}

// Cartola de un PDF que no se pudo abrir por tener clave
export const cartolaConClave = (archivo: string, conClaveDada: boolean): ResultadoCartola => ({
  archivo, broker: 'Desconocido', cuenta: 'Desconocido', moneda: 'CLP', tipoDoc: 'MENSUAL', movimientos: [], conClave: true,
  avisos: [conClaveDada ? 'la clave ingresada no abre este PDF.' : 'el PDF tiene clave: ingrésala para poder leerlo.'],
});

// `clave`: la de los PDF protegidos (BTG y XTB suelen venir con clave). No sale del navegador.
export async function parsePdfToCartola(file: File, clave?: string): Promise<ResultadoCartola> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), password: clave || undefined }).promise;
    return parseCartolaText(await textoDePdf(pdf), file.name);
  } catch (err) {
    if ((err as { name?: string })?.name === 'PasswordException') return cartolaConClave(file.name, !!clave);
    console.error('PDF parse error:', err);
    throw new Error(`Error procesando ${file.name} en el navegador.`);
  }
}

// --- Utilidades ------------------------------------------------------------------------------------

// "1.234.567,89" -> 1234567.89
const numCL = (s: string) => parseFloat(s.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
// "1,234.56" / "(9.88)" -> 1234.56 / -9.88
const numUS = (s: string) => {
  const limpio = s.replace(/[$\s,]/g, '');
  const neg = /^\(.*\)$/.test(limpio) || limpio.startsWith('-');
  const v = parseFloat(limpio.replace(/[()\-]/g, ''));
  return neg ? -v : v;
};
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
// XTB escribe las cantidades a veces con coma ("1,00000") y a veces con punto ("1.00000")
const numXTB = (s: string) => (s.includes(',') ? numCL(s) : parseFloat(s));

const MESES: Record<string, string> = {
  ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06', JULIO: '07',
  AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12',
};
const MESES_EN: Record<string, string> = {
  JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04', MAY: '05', JUNE: '06', JULY: '07',
  AUGUST: '08', SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12',
};
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const mesES = (nombre: string) => MESES[sinTildes(nombre).toUpperCase()];
const fechaDMY = (s: string) => { const [d, m, y] = s.split(/[-./]/); return `${y}-${m}-${d}`; };
const fechaMDY = (s: string) => { const [m, d, y] = s.split('/'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };
const finDeMes = (anio: string, mes: string) => {
  const dia = new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate();
  return `${anio}-${mes}-${String(dia).padStart(2, '0')}`;
};
const esFinDeMes = (fecha: string) => fecha === finDeMes(fecha.slice(0, 4), fecha.slice(5, 7));

// Líneas entre la primera que cumple `inicio` y la siguiente que cumple `fin`
function seccion(lineas: string[], inicio: RegExp, fin?: RegExp): string[] {
  const i = lineas.findIndex(l => inicio.test(l));
  if (i < 0) return [];
  const f = fin ? lineas.findIndex((l, k) => k > i && fin.test(l)) : -1;
  return lineas.slice(i + 1, f > i ? f : undefined);
}

// --- Detección del formato ------------------------------------------------------------------------

export function parseCartolaText(texto: string, archivo: string): ResultadoCartola {
  const base = (broker: string, extra: Partial<ResultadoCartola> = {}): ResultadoCartola => ({
    archivo, broker, cuenta: broker, moneda: 'CLP', tipoDoc: 'MENSUAL', movimientos: [], avisos: [], ...extra,
  });
  if (texto.replace(/=+ Página \d+ de \d+ =+/g, '').replace(/\s/g, '').length < 50) {
    return base('Desconocido', { sinTexto: true });
  }
  const lineas = texto.split('\n').map(l => l.trim());

  if (/DriveWealth/i.test(texto) && /Account Statement/.test(texto)) return parseDriveWealth(lineas, archivo);
  if (/Vector Capital/i.test(texto)) return parseVector(texto, lineas, archivo);
  if (/btg\s*pactual/i.test(texto)) return parseBTG(texto, lineas, archivo);
  if (/XTB Agente de Valores/i.test(texto)) return parseXTB(texto, lineas, archivo);
  if (/Fintual Administradora/i.test(texto)) return parseFintual(texto, lineas, archivo);

  const r = base('Desconocido', { desconocido: true });
  if (/Confirmation/i.test(texto) && /DriveWealth|Racional/i.test(texto)) {
    r.broker = 'Racional';
    r.avisos.push('Es una confirmación de operación: sube las cartolas mensuales de Racional (ya incluyen todas las operaciones). Se omitió para no contar dos veces.');
  }
  return r;
}

// --- Racional USD (DriveWealth) -------------------------------------------------------------------

// Tipos de actividad de DriveWealth que no mueven nada de la cuenta del cliente:
// JNLS = acciones prestadas/devueltas (préstamo de valores), XTRF = traspaso interno entre subcuentas.
const DW_INTERNOS = new Set(['JNLS', 'XTRF']);

function parseDriveWealth(lineas: string[], archivo: string): ResultadoCartola {
  const texto = lineas.join('\n');
  const r: ResultadoCartola = {
    archivo, broker: 'Racional', cuenta: 'Racional USD', moneda: 'USD', tipoDoc: 'MENSUAL', movimientos: [], avisos: [],
  };
  r.numeroCuenta = texto.match(/Account Number:\s*([A-Z0-9-]+)/)?.[1];
  const periodo = texto.match(/([A-Z][a-z]+) (\d{2}), (\d{4}) - ([A-Z][a-z]+) (\d{2}), (\d{4})/);
  if (periodo) {
    r.desde = `${periodo[3]}-${MESES_EN[periodo[1].toUpperCase()]}-${periodo[2]}`;
    r.hasta = `${periodo[6]}-${MESES_EN[periodo[4].toUpperCase()]}-${periodo[5]}`;
  }

  // ACTIVITY (la SWEEP ACTIVITY es solo la caja yendo y viniendo del banco: no se considera)
  for (const l of seccion(lineas, /^ACTIVITY$/, /^SWEEP ACTIVITY$/)) {
    const m = l.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+USD\s+([A-Z]+)\s+(.*)$/);
    if (!m) continue;
    const [, fOp, fLiq, tipo, resto] = m;
    const fecha = fechaMDY(fOp);
    const fechaLiquidacion = fechaMDY(fLiq);
    const ticker = resto.match(/^([A-Z][A-Z0-9.]*)\s+-\s/)?.[1];
    const numeros = [...resto.matchAll(/(?:^|\s)(\(?-?[\d,]*\.?\d+\)?)(?=\s|$)/g)].map(x => numUS(x[1]));
    const monto = numeros[numeros.length - 1] ?? 0;
    const mov = (extra: Partial<Movimiento> & Pick<Movimiento, 'tipo'>): Movimiento => ({
      cuenta: r.cuenta, fecha, fechaLiquidacion, monto, moneda: 'USD', detalle: resto.replace(/\s{2,}/g, ' '), archivo, ...extra,
    });

    if (DW_INTERNOS.has(tipo)) continue;
    if (tipo === 'BUY' || tipo === 'SELL') {
      const cantidad = Math.abs(numeros[numeros.length - 3]);
      const precio = numeros[numeros.length - 2];
      r.movimientos.push(mov({ tipo: tipo === 'BUY' ? 'COMPRA' : 'VENTA', ticker, cantidad, precio }));
    } else if (tipo === 'DIV' || tipo === 'DIVM') {
      const porAccion = resto.match(/DIV:[A-Z.]+\(([\d.]+)\/sh\)/)?.[1];
      r.movimientos.push(mov({ tipo: 'DIVIDENDO', ticker, precio: porAccion ? parseFloat(porAccion) : undefined }));
    } else if (tipo === 'DIVNRA' || tipo === 'INTNRA') {
      if (monto !== 0) r.movimientos.push(mov({ tipo: 'IMPUESTO', ticker: tipo === 'DIVNRA' ? ticker : undefined }));
    } else if (tipo === 'SLIP' || tipo === 'INT') {
      if (monto !== 0) r.movimientos.push(mov({ tipo: 'INTERES', ticker: undefined }));
    } else if (tipo === 'SSP') {
      // Split: se entregan las acciones antiguas y se reciben las nuevas (ej. HDV 1->5)
      const cantidad = numeros[numeros.length - 3];
      r.movimientos.push(mov({ tipo: 'SPLIT', ticker, cantidad, precio: numeros[numeros.length - 2], monto: 0 }));
    } else if (tipo === 'JNLC') {
      // Abonos de Racional a la cuenta (INSTANT_FUNDING). Las consolidaciones internas de caja se anulan entre sí.
      if (/Consolidation/i.test(resto)) continue;
      r.movimientos.push(mov({ tipo: monto >= 0 ? 'APORTE' : 'RETIRO', ticker: undefined }));
    } else {
      r.avisos.push(`Actividad "${tipo}" del ${fecha} no reconocida (${resto.slice(0, 60)}…), monto ${monto}: revisar.`);
    }
  }

  // HOLDINGS: posiciones y bank sweep (caja) al cierre
  const posiciones: PosicionFoto[] = [];
  let caja = 0;
  for (const l of seccion(lineas, /^HOLDINGS$/, /^ACTIVITY$/)) {
    const m = l.match(/\s([A-Z][A-Z0-9.]{0,9})\s+([\d,]*\.?\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\(?[\d,]+\.\d{2}\)?)\s+[A-Z]$/);
    if (!m) continue;
    if (m[1] === 'DWBDS') { caja += numUS(m[2]); continue; } // cuenta corriente (bank sweep)
    posiciones.push({ ticker: m[1], cantidad: numUS(m[2]), costo: numUS(m[4]), precio: numUS(m[5]), valor: numUS(m[6]), moneda: 'USD' });
  }
  const efectivo = texto.match(/Cash & Cash Equivalents\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/);
  const inicial = texto.match(/Beginning Account Value\s+\$([\d,]+\.\d{2})/);
  const final = texto.match(/Ending Account Value\s+\$([\d,]+\.\d{2})/);
  if (r.hasta) {
    r.foto = {
      fecha: r.hasta, posiciones, completa: true, cajaPorOperacion: true,
      caja: efectivo ? numUS(efectivo[2]) : caja,
      cajaInicial: efectivo ? numUS(efectivo[1]) : undefined,
      valorTotal: final ? numUS(final[1]) : undefined,
      valorInicial: inicial ? numUS(inicial[1]) : undefined,
    };
  }
  return r;
}

// --- Vector Capital (Racional CLP, Zesty) ---------------------------------------------------------

// Asesor que aparece en la cartola de Vector -> nombre de la cuenta para el usuario
const ASESORES_VECTOR: Record<string, string> = { RACIONAL: 'Racional CLP', TREID: 'Zesty' };

function parseVector(texto: string, lineas: string[], archivo: string): ResultadoCartola {
  const numero = texto.match(/Número:\s*(\d{6,9}\/\d{1,3})/)?.[1];
  const asesor = texto.match(/Asesor:\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+)/)?.[1] ?? '';
  const cuenta = ASESORES_VECTOR[sinTildes(asesor).toUpperCase()] ?? `Vector ${numero ?? ''}`.trim();
  const r: ResultadoCartola = {
    archivo, broker: cuenta === 'Zesty' ? 'Zesty' : cuenta.startsWith('Racional') ? 'Racional' : 'Vector Capital',
    cuenta, numeroCuenta: numero, moneda: 'CLP', tipoDoc: 'MENSUAL', movimientos: [], avisos: [],
  };
  const corte = texto.match(/(?:LUNES|MARTES|MI[EÉ]RCOLES|JUEVES|VIERNES|S[AÁ]BADO|DOMINGO),\s+(\d{1,2}) DE ([A-ZÁÉÍÓÚ]+) DE (\d{4})/);
  if (corte && mesES(corte[2])) {
    r.hasta = `${corte[3]}-${mesES(corte[2])}-${corte[1].padStart(2, '0')}`;
    r.desde = `${r.hasta.slice(0, 8)}01`;
  }
  // Valores de referencia del día de corte: UF, dólar y euro
  const referencia = texto.match(/\$\s?[\d.]+,\d{2}\s+\$\s?([\d.]+,\d{2})\s+\$\s?[\d.]+,\d{2}\s*\n\s*DE REFERENCIA/);
  if (referencia) r.dolar = numCL(referencia[1]);
  // El informe de 1 página ("Mayores Inversiones") no trae el detalle de movimientos
  const resumen = /Mayores Inversiones/.test(texto) && !/Detalle de Movimientos Mensuales/.test(texto);
  if (resumen) r.tipoDoc = 'RESUMEN';

  // Foto de la cartera
  const posiciones: PosicionFoto[] = [];
  if (resumen) {
    for (const m of texto.matchAll(/\b([A-Z][A-Z0-9-]{1,14})\s+(CLP|USD)\s+([\d.]+,\d{4})\s+\$\s?([\d.,]+)\s+\$\s?([\d.,]+)\s+\$\s?([\d.]+)\s*$/gm)) {
      const cantidad = numCL(m[3]);
      posiciones.push({ ticker: m[1], cantidad, costo: cantidad * numCL(m[4]), precio: numCL(m[5]), valor: numCL(m[6]), moneda: m[2] as Moneda });
    }
  } else {
    for (const l of seccion(lineas, /^Cartera de Inversiones$/, /^Detalle de Movimiento/)) {
      const m = l.match(/^([A-Z][A-Z0-9-]{1,14})\s+(CLP|USD)\s+([\d.,]+)\s+([\d.]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d,]+)$/);
      if (m) posiciones.push({ ticker: m[1], cantidad: numCL(m[5]), costo: numCL(m[4]), precio: numCL(m[6]), valor: numCL(m[7]), moneda: m[2] as Moneda });
    }
  }
  const patrimonio = texto.match(/Patrimonio Actual\s+\$\s?([\d.]+)/) ?? texto.match(/([\d.]+)\s+Patrimonio Actual CLP/);
  const caja = texto.match(/^Caja\s+[\d,]+\s*%\s+\$\s?([\d.]+)/m);
  const saldoInicial = texto.match(/Saldo Inicial\s+\$\s?([\d.]+)/);
  if (r.hasta) {
    const valorTotal = patrimonio ? numCL(patrimonio[1]) : undefined;
    const cajaFinal = caja ? numCL(caja[1]) : undefined;
    // El resumen lista solo las mayores inversiones: está completo si suman el patrimonio
    const suma = posiciones.reduce((s, p) => s + (p.valor ?? 0), 0) + (cajaFinal ?? 0);
    const completa = !resumen || (valorTotal !== undefined && Math.abs(suma - valorTotal) <= posiciones.length + 1);
    r.foto = {
      fecha: r.hasta, posiciones, completa, caja: cajaFinal, valorTotal,
      valorInicial: saldoInicial ? numCL(saldoInicial[1]) : undefined,
    };
    if (!completa) r.avisos.push('El resumen no lista todas las inversiones (las mostradas no suman el patrimonio).');
  }
  const enCartera = new Set(posiciones.map(p => p.ticker));

  // Detalle de Transacciones (compras, ventas y canjes de títulos)
  for (const l of lineas) {
    const m = l.match(/^(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})\s+(?:(COMPRA|VENTA)\s+)?(ACCIONES|FONDOS)(?:\s+CB)?\s+([A-Z][A-Z0-9-]*)\s+(CLP|USD)\s+([\d.,]+)\s+\$\s?([\d.,]+)\s+\$\s?([\d.,]+)$/);
    if (!m) continue;
    const [, fOp, fLiq, operacion, , ticker, moneda, cant, , montoTxt] = m;
    const cantidad = numCL(cant);
    const montoOp = numCL(montoTxt);
    const comun = {
      cuenta: r.cuenta, fecha: fechaDMY(fOp), fechaLiquidacion: fechaDMY(fLiq), ticker, moneda: moneda as Moneda,
      precio: montoOp / cantidad, archivo, detalle: l.replace(/\s{2,}/g, ' '),
    };
    if (operacion) {
      // El precio impreso viene redondeado: el real es monto / cantidad
      r.movimientos.push({ ...comun, tipo: operacion === 'COMPRA' ? 'COMPRA' : 'VENTA', cantidad, monto: operacion === 'COMPRA' ? -montoOp : montoOp });
    } else {
      // Movimiento de títulos sin compra/venta: canje (ej. fusión de fondos). Entra si quedó en la cartera.
      r.movimientos.push({ ...comun, tipo: 'CANJE', cantidad: enCartera.has(ticker) ? cantidad : -cantidad, monto: 0, detalle: `${comun.detalle} (valorizado en $${montoOp.toLocaleString('es-CL')})` });
    }
  }

  // Detalle de Movimientos Mensuales (caja): dividendos, comisiones, aportes y retiros
  let saldo: number | undefined;
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})\s+(\d+\/\d+)\s+(Cargo|Abono)\s+(.+?)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+(-?[\d.]+,\d{2})$/);
    if (!m) continue;
    const [, fMov, fLiq, , , glosa, cargo, abono, saldoTxt] = m;
    const monto = numCL(abono) - numCL(cargo);
    const saldoLinea = numCL(saldoTxt);
    if (saldo !== undefined && Math.abs(saldo + monto - saldoLinea) > 1) {
      r.avisos.push(`El saldo de caja no cuadra en la línea del ${fMov} (${glosa}): puede faltar un movimiento.`);
    }
    saldo = saldoLinea;
    // La glosa puede seguir en la línea siguiente (ej. "SUBYACENTES FALABELLA MALLPLAZA")
    const siguiente = lineas[i + 1] && !/^\d{2}-\d{2}-\d{4}/.test(lineas[i + 1]) && !/^Página/.test(lineas[i + 1]) ? ` ${lineas[i + 1]}` : '';
    const detalle = `${glosa}${siguiente}`.replace(/\s{2,}/g, ' ');
    const mov: Movimiento = { cuenta: r.cuenta, fecha: fechaDMY(fMov), fechaLiquidacion: fechaDMY(fLiq), tipo: 'APORTE', monto, moneda: 'CLP', detalle, archivo };

    if (/^(COMPRA|VENTA) (ACCIONES|FONDOS)/.test(glosa)) continue; // la operación viene en Detalle de Transacciones
    const div = glosa.match(/^DIV;(\d{2}-\d{2}-\d{4});([A-Z][A-Z0-9-]*)(?:;(\d+(?:,\d+)?))?/);
    if (div) r.movimientos.push({ ...mov, tipo: 'DIVIDENDO', ticker: div[2], precio: div[3] ? numCL(div[3]) : undefined });
    else if (/COMISI[OÓ]N/i.test(glosa)) r.movimientos.push({ ...mov, tipo: 'COMISION' });
    else if (/Anulaci[oó]n de Factura/i.test(glosa)) r.movimientos.push({ ...mov, tipo: 'COMISION', detalle: `${detalle} (reverso de un cobro)` });
    else if (/ajuste decimales/i.test(glosa)) r.movimientos.push({ ...mov, tipo: 'COMISION', detalle: `${detalle} (redondeo de la comisión)` });
    else if (/RETIRO|RESCATE|GIRO/i.test(glosa) || monto < 0) r.movimientos.push({ ...mov, tipo: 'RETIRO' });
    else r.movimientos.push(mov); // abonos: transferencias del cliente / de la app
  }
  return r;
}

// --- BTG Pactual -----------------------------------------------------------------------------------

// Fondos de BTG que en algunas tablas aparecen solo por nombre
const FONDOS_BTG: Record<string, string> = { 'FM ITAU ETF IT NOW S&P IPSA': 'CFMITNIPSA' };

function parseBTG(texto: string, lineas: string[], archivo: string): ResultadoCartola {
  const r: ResultadoCartola = { archivo, broker: 'BTG Pactual', cuenta: 'BTG Pactual', moneda: 'CLP', tipoDoc: 'MENSUAL', movimientos: [], avisos: [] };
  r.numeroCuenta = texto.match(/N° Cuenta\s+(\d+)/)?.[1];
  const dolar = texto.match(/\bUSD\s+\$\s?([\d.]+,\d{2})/);
  if (dolar) r.dolar = numCL(dolar[1]);
  const corte = texto.match(/actualizado\s+al\s+(\d{1,2}) de ([A-Za-zÁÉÍÓÚáéíóú]+) de (\d{4})/i);
  if (corte && mesES(corte[2])) {
    r.hasta = `${corte[3]}-${mesES(corte[2])}-${corte[1].padStart(2, '0')}`;
    r.desde = `${r.hasta.slice(0, 8)}01`;
    if (!esFinDeMes(r.hasta)) r.tipoDoc = 'PARCIAL';
  }

  // Nemotécnico de cada fondo según el anexo de custodia (no viene en las cartolas parciales)
  const nemoPorNombre: Record<string, string> = { ...FONDOS_BTG };
  for (const l of lineas) {
    const m = l.match(/^(.+?)\s+([A-Z][A-Z0-9-]{1,14})\s+DCV\s+\S+\s+([\d.]+(?:,\d+)?)\s+([\d.,]+)\s+(CLP|USD)\s+([\d.]+)$/);
    if (m) nemoPorNombre[m[1].toUpperCase()] = m[2];
  }
  const nemo = (instrumento: string): string | undefined => {
    const nombre = instrumento.replace(/\s+(Unica|Única|Serie \S+)$/i, '').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9-]{1,14}$/.test(nombre)) return nombre;
    return nemoPorNombre[nombre] ?? Object.entries(nemoPorNombre).find(([k]) => nombre.startsWith(k))?.[1];
  };

  // Foto de la cartera: tablas "Detalle Inversiones" (acciones por nemotécnico, fondos por nombre)
  // con cantidad, precio de compra, precio actual y valorización
  const posiciones: PosicionFoto[] = [];
  for (const l of lineas) {
    const accion = l.match(/^([A-Z][A-Z0-9-]{1,14})\s+([\d.]+(?:,\d+)?)\s+\$\s?([\d.,]+)\s+\$\s?([\d.,]+)\s+-?[\d,]+\s*%\s+\$\s?([\d.]+)\s+[\d,]+\s*%$/);
    const fondo = l.match(/^(.+?)\s+(?:Unica|Única|Serie \S+)\s+([\d.]+,\d{4})\s+\$\s?([\d.,]+)\s+\$\s?([\d.,]+)\s+-?[\d,]+\s*%\s+\$\s?([\d.]+)\s+[\d,]+\s*%$/);
    const m = accion ?? fondo;
    if (!m) continue;
    const ticker = accion ? accion[1] : nemo(m[1]);
    if (!ticker) { r.avisos.push(`Fondo "${m[1]}" sin nemotécnico conocido: no se incluyó en la foto de la cartera.`); continue; }
    const cantidad = numCL(m[2]);
    posiciones.push({ ticker, cantidad, costo: cantidad * numCL(m[3]), precio: numCL(m[4]), valor: numCL(m[5]), moneda: 'CLP' });
  }

  // Operaciones según la custodia (fecha de operación, liquidación, cantidad y precio)
  const operaciones: Movimiento[] = [];
  for (const l of seccion(lineas, /Cartola De Movimientos De Custodia/i)) {
    const m = l.match(/^(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})\s+(Compra|Venta)\s+(.+?)\s+\S+\s+([\d.]+,\d{4})\s+([\d.]+,\d{2,4})$/);
    if (!m) continue;
    const ticker = nemo(m[4]);
    if (!ticker) { r.avisos.push(`Instrumento "${m[4]}" sin nemotécnico conocido en la custodia del ${m[1]}.`); continue; }
    const cantidad = numCL(m[5]);
    const precio = numCL(m[6]);
    operaciones.push({
      cuenta: r.cuenta, fecha: fechaDMY(m[1]), fechaLiquidacion: fechaDMY(m[2]), tipo: m[3] === 'Compra' ? 'COMPRA' : 'VENTA',
      ticker, cantidad, precio, monto: (m[3] === 'Compra' ? -1 : 1) * cantidad * precio, moneda: 'CLP', detalle: l.replace(/\s{2,}/g, ' '), archivo,
    });
  }

  // Movimientos de caja: contado (ya liquidados) y compromisos futuros (operaciones por liquidar)
  let bloque = '';
  for (const l of lineas) {
    if (/Cartola de Movimientos Contado/i.test(l)) bloque = 'contado';
    else if (/Cartola de Compromisos Futuros/i.test(l)) bloque = 'compromisos';
    else if (/Cartola De Movimientos De Custodia|Anexo/i.test(l)) bloque = '';
    if (!bloque) continue;
    const m = l.match(/^(\d{2}-\d{2}-\d{4})\s+(\d{2}-\d{2}-\d{4})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(.*?)\s*\$\s?(-?[\d.]+)\s+\$\s?(-?[\d.]+)$/);
    if (!m) continue;
    const [, fMov, fPago, tipo, resto, montoTxt] = m;
    const monto = numCL(montoTxt);
    const instrumento = resto.split(/\s+Inv\.\s/)[0].trim();
    const unidades = resto.match(/([\d.]+,\d{4})\s+([\d.]+,\d{2,4})\s*$/);
    const base: Movimiento = {
      cuenta: r.cuenta, fecha: fechaDMY(fMov), fechaLiquidacion: fechaDMY(fPago), tipo: 'APORTE', monto, moneda: 'CLP',
      detalle: `${tipo} ${resto}`.replace(/\s{2,}/g, ' '), archivo,
    };
    if (/^Dividendo$/i.test(tipo)) {
      const ticker = nemo(instrumento);
      if (!ticker) r.avisos.push(`Dividendo del ${fMov} de "${instrumento}" sin nemotécnico conocido.`);
      r.movimientos.push({ ...base, tipo: 'DIVIDENDO', ticker, precio: unidades ? numCL(unidades[2]) : undefined });
    } else if (/^(Compra|Venta)$/i.test(tipo)) {
      const ticker = nemo(instrumento);
      const op = operaciones.find(o => o.ticker === ticker && o.fecha === base.fecha && (!unidades || Math.abs((o.cantidad ?? 0) - numCL(unidades[1])) < 1e-6));
      if (op) { op.monto = monto; continue; } // la custodia ya trae la operación: se completa con el monto real
      if (!ticker || !unidades) { r.avisos.push(`${tipo} del ${fMov} de "${instrumento}" no se pudo interpretar.`); continue; }
      const cantidad = numCL(unidades[1]);
      operaciones.push({ ...base, tipo: /Compra/i.test(tipo) ? 'COMPRA' : 'VENTA', ticker, cantidad, precio: numCL(unidades[2]) });
    } else if (/^(Giro|Retiro|Rescate)$/i.test(tipo)) {
      r.movimientos.push({ ...base, tipo: 'RETIRO' });
    } else if (/^(Abono|Aporte|Dep[oó]sito)$/i.test(tipo)) {
      r.movimientos.push(base);
    } else if (/Comisi|Derecho|Gasto|IVA/i.test(tipo)) {
      r.movimientos.push({ ...base, tipo: 'COMISION' });
    } else {
      r.avisos.push(`Movimiento "${tipo}" del ${fMov} (${monto}) no reconocido: revisar.`);
    }
  }
  // Gastos de cada operación (comisión, derechos e IVA): diferencia entre cantidad x precio y lo liquidado
  for (const op of operaciones) {
    r.movimientos.push(op);
    const bruto = (op.cantidad ?? 0) * (op.precio ?? 0);
    const gastos = op.tipo === 'VENTA' ? bruto - op.monto : -op.monto - bruto;
    if (gastos > 0.5) {
      // La comisión ya está descontada del monto de la operación: aquí solo se informa (monto 0 en caja)
      r.movimientos.push({ ...op, tipo: 'COMISION', cantidad: undefined, precio: undefined, monto: 0, implicito: true, montoIncluido: -redondear(gastos, 0),
        detalle: `Gastos de la ${op.tipo.toLowerCase()} de ${op.ticker} (comisión + derechos + IVA): $${Math.round(gastos).toLocaleString('es-CL')}, incluidos en el monto liquidado` });
    }
  }

  const cajaContado = texto.match(/^Caja Contado\s+\$\s?([\d.]+)\s+[\d,]+%\s+\$\s?([\d.]+)/m);
  const totales = texto.match(/^Total Inversiones\s+\$\s?([\d.]+)\s+[\d.,]+ USD\s+\$\s?([\d.]+)/m);
  if (r.hasta) {
    r.foto = {
      fecha: r.hasta, completa: true, posiciones,
      caja: cajaContado ? numCL(cajaContado[2]) : undefined,
      cajaInicial: cajaContado ? numCL(cajaContado[1]) : undefined,
      valorTotal: totales ? numCL(totales[2]) : undefined,
      valorInicial: totales ? numCL(totales[1]) : undefined,
    };
  }
  return r;
}

// --- XTB -------------------------------------------------------------------------------------------

function parseXTB(texto: string, lineas: string[], archivo: string): ResultadoCartola {
  const r: ResultadoCartola = { archivo, broker: 'XTB', cuenta: 'XTB', moneda: 'CLP', tipoDoc: 'MENSUAL', movimientos: [], avisos: [] };
  const mes = texto.match(/Cartola Mensual\s+([a-záéíóú]+)\s+(\d{4})/i);
  if (mes && mesES(mes[1])) {
    r.desde = `${mes[2]}-${mesES(mes[1])}-01`;
    r.hasta = finDeMes(mes[2], mesES(mes[1]));
  }
  const cuenta = texto.match(/(\d{6,10})\s+(CLP|USD)\s+[\d.]+-[\dkK]\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/);
  if (cuenta) { r.numeroCuenta = cuenta[1]; r.moneda = cuenta[2] as Moneda; }
  const efectivo = texto.match(/Balance de efectivo al final del periodo\s*\n\s*(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/);

  // Órdenes ejecutadas (compras y ventas, enteras o fraccionarias): de aquí sale el ticker de cada operación,
  // porque la línea de caja solo dice "OPEN BUY 0.0386 @ 279.17"
  const ordenes: { ticker: string; moneda: Moneda; volumen: number; fecha: string; precio: number }[] = [];
  for (const m of texto.matchAll(/^\d+\s+\d{6,}\s+([A-Z0-9]+)\.[A-Z]{2}\s+.+?\s+(USD|CLP)\s+\S+\s+(\d+(?:[.,]\d+)?)\s+\w+\s+(\d{2}-\d{2}-\d{4})\s+(\d+(?:[.,]\d+)?)/gm)) {
    ordenes.push({ ticker: m[1], moneda: m[2] as Moneda, volumen: numXTB(m[3]), fecha: fechaDMY(m[4]), precio: numXTB(m[5]) });
  }

  let suma = 0;
  const dividendos: Movimiento[] = [];
  for (const l of lineas) {
    const m = l.match(/^\d+\s+(\d{2}\.\d{2}\.\d{4})\s+([A-Za-z][A-Za-z ]*?)\s+(-?[\d.]*\d,\d{2})\s+(CLP|USD)\s*(.*)$/);
    if (!m) continue;
    const [, f, tipoTxt, montoTxt, moneda, comentario] = m;
    const t = tipoTxt.toLowerCase();
    // Las compras vienen con monto positivo aunque sacan plata de la caja
    const monto = t.includes('purchase') ? -Math.abs(numCL(montoTxt)) : t.includes('sale') ? Math.abs(numCL(montoTxt)) : numCL(montoTxt);
    suma += monto;
    const ticker = comentario.match(/^([A-Z0-9]+)\.[A-Z]{2}\b/)?.[1];
    const base: Movimiento = { cuenta: r.cuenta, fecha: fechaDMY(f), tipo: 'APORTE', monto, moneda: moneda as Moneda, detalle: `${tipoTxt} ${comentario}`.trim(), archivo, ticker };
    const orden = comentario.match(/(?:OPEN|CLOSE)\s+(BUY|SELL)\s+([\d.]+)\s+@\s+([\d.]+)/);
    if (orden && (t.includes('purchase') || t.includes('sale'))) {
      const cantidad = parseFloat(orden[2]);
      const precio = parseFloat(orden[3]);
      const o = ordenes.find(x => x.fecha === base.fecha && Math.abs(x.volumen - cantidad) < 1e-6) ?? ordenes.find(x => Math.abs(x.volumen - cantidad) < 1e-6);
      if (!o) { r.avisos.push(`Operación del ${f} (${comentario}) sin instrumento identificable: revisar a mano.`); continue; }
      r.movimientos.push({ ...base, tipo: orden[1] === 'BUY' ? 'COMPRA' : 'VENTA', ticker: o.ticker, cantidad, precio, monedaActivo: o.moneda });
    } else if (t.includes('dividend')) {
      const d: Movimiento = { ...base, tipo: 'DIVIDENDO' };
      dividendos.push(d);
      r.movimientos.push(d);
    }
    else if (t.includes('tax') || t.includes('withholding')) r.movimientos.push({ ...base, tipo: 'IMPUESTO' });
    else if (t.includes('commission') || t.includes('fee')) r.movimientos.push({ ...base, tipo: 'COMISION' });
    else if (t.includes('deposit')) r.movimientos.push({ ...base, ticker: undefined });
    else if (t.includes('withdraw')) r.movimientos.push({ ...base, tipo: 'RETIRO', ticker: undefined });
    else r.avisos.push(`Operación XTB "${tipoTxt}" del ${f} (${comentario}) no soportada todavía: revisar a mano.`);
  }

  // XTB descuenta la retención de impuestos de los dividendos sin listarla: se deduce del saldo de caja
  if (efectivo && r.hasta) {
    const inicio = numCL(efectivo[1]);
    const fin = numCL(efectivo[2]);
    const diferencia = redondear(fin - inicio - suma);
    if (Math.abs(diferencia) >= 0.01) {
      const bruto = dividendos.reduce((s, d) => s + d.monto, 0);
      const tasa = bruto > 0 ? -diferencia / bruto : 0;
      if (diferencia < 0 && bruto > 0 && (Math.abs(tasa - 0.3) < 0.005 || Math.abs(tasa - 0.15) < 0.005)) {
        let resto = diferencia;
        dividendos.forEach((d, i) => {
          const monto = i === dividendos.length - 1 ? redondear(resto) : redondear(-d.monto * tasa);
          resto -= monto;
          r.movimientos.push({ cuenta: r.cuenta, fecha: d.fecha, tipo: 'IMPUESTO', monto, moneda: r.moneda, archivo, implicito: true, ticker: d.ticker,
            detalle: `Retención del ${Math.round(tasa * 100)}% sobre el dividendo de ${d.ticker}: la cartola no la detalla, se deduce del saldo de caja` });
        });
      } else {
        r.avisos.push(`La caja cambió ${diferencia} ${r.moneda} más de lo que explican los movimientos listados.`);
      }
    }
  }

  // Custodia (acciones completas y derechos fraccionados)
  const posiciones: PosicionFoto[] = [];
  for (const m of texto.matchAll(/^\d+\s+([A-Z0-9]+)\.[A-Z]{2}\s+.+?\s+[A-Z]{2}[A-Z0-9]{9}\d\s+.+?\s+(\d+(?:[.,]\d+)?)\s+([\d.]+)\s+(USD|CLP)$/gm)) {
    const cantidad = numXTB(m[2]);
    const valor = parseFloat(m[3]);
    const previa = posiciones.find(p => p.ticker === m[1]);
    if (previa) { previa.cantidad += cantidad; previa.valor = (previa.valor ?? 0) + valor; }
    else posiciones.push({ ticker: m[1], cantidad, valor, precio: valor / cantidad, moneda: m[4] as Moneda });
  }
  const valores = cuenta ? { inicial: numCL(cuenta[3]), final: numCL(cuenta[4]) } : undefined;
  if (r.hasta) {
    r.foto = {
      fecha: r.hasta, posiciones, completa: true,
      caja: efectivo ? numCL(efectivo[2]) : undefined, cajaInicial: efectivo ? numCL(efectivo[1]) : undefined,
      valorTotal: valores?.final, valorInicial: valores?.inicial,
    };
  }
  return r;
}

// --- Fintual ---------------------------------------------------------------------------------------
// Certificado acumulado. Las celdas vienen partidas en varias líneas (la fecha "2025-" arriba y "01-27"
// abajo, el monto "US $" arriba y "100,00" abajo), por eso se lee la sección como un solo texto corrido.

function parseFintual(texto: string, lineas: string[], archivo: string): ResultadoCartola {
  const r: ResultadoCartola = { archivo, broker: 'Fintual', cuenta: 'Fintual', moneda: 'USD', tipoDoc: 'CERTIFICADO', movimientos: [], avisos: [] };
  const emision = texto.match(/Con fecha (\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i);
  if (emision && mesES(emision[2])) r.hasta = `${emision[3]}-${mesES(emision[2])}-${emision[1].padStart(2, '0')}`;

  const corrido = (desde: RegExp, hasta: RegExp) => seccion(lineas, desde, hasta)
    .filter(l => !/^(=+ Página|Símbolo|Fecha|Activo\s)/.test(l))
    .join(' ').replace(/\s+/g, ' ');
  const compras = corrido(/^Compra de activos$/, /^Venta de activos$/);
  const ventas = corrido(/^Venta de activos$/, /^Dividendos recibidos$/);
  const dividendos = corrido(/^Dividendos recibidos$/, /^Este certificado/);
  const comun = { cuenta: r.cuenta, moneda: 'USD' as Moneda, archivo };

  // Compra: "2025- [US $] Nombre TICKER ETF|Acciones Mercado [US $ 12,34] 0,123456789 01-27 [100,00]"
  for (const m of compras.matchAll(/(\d{4})-\s+(?:US \$\s+)?(.+?)\s+([A-Z]{1,5})\s+(ETF|Acciones)\s+Mercado\s+(?:US \$\s+([\d.]+,\d{2})\s+)?(\d+,\d+)\s+(\d{2}-\d{2})(?:\s+([\d.]+,\d{2})(?!\d))?/g)) {
    const monto = numCL(m[5] ?? m[8] ?? '');
    const cantidad = numCL(m[6]);
    if (!Number.isFinite(monto)) { r.avisos.push(`Compra de ${m[3]} del ${m[1]}-${m[7]} sin monto legible.`); continue; }
    r.movimientos.push({ ...comun, fecha: `${m[1]}-${m[7]}`, tipo: 'COMPRA', ticker: m[3], cantidad, precio: monto / cantidad, monto: -monto, detalle: `Compra ${m[2]} (${m[3]})` });
  }
  // Venta: "2025-07- Nombre TICKER ETF Mercado US $ 12,34 0,012345678 28"
  for (const m of ventas.matchAll(/(\d{4})-(\d{2})-\s+(.+?)\s+([A-Z]{1,5})\s+(ETF|Acciones)\s+Mercado\s+US \$\s+([\d.]+,\d{2})\s+(\d+,\d+)\s+(\d{2})\b/g)) {
    const monto = numCL(m[6]);
    const cantidad = numCL(m[7]);
    r.movimientos.push({ ...comun, fecha: `${m[1]}-${m[2]}-${m[8]}`, tipo: 'VENTA', ticker: m[4], cantidad, precio: monto / cantidad, monto, detalle: `Venta ${m[3]} (${m[4]})` });
  }
  // Dividendo: "2025- US $ US $ Nombre TICKER ETF US $ 0,02 03-25 0,17 0,15" (impuesto, fecha, bruto, neto).
  // Si el nombre es largo se reparte antes de "US $ US $" y después de la fecha (ej. TSM).
  for (const m of dividendos.matchAll(/(\d{4})-\s+(.*?)\s*US \$\s+US \$\s+(.*?)\s*\b([A-Z]{1,5})\s+(ETF|Acciones)\s+US \$\s+([\d.]+,\d{2})\s+(\d{2}-\d{2})\s+(?:(\D*?)\s+)?([\d.]+,\d{2})\s+([\d.]+,\d{2})/g)) {
    const ticker = m[4];
    const nombre = [m[2], m[3], m[8]].filter(Boolean).join(' ').trim();
    const fecha = `${m[1]}-${m[7]}`;
    const impuesto = numCL(m[6]);
    const bruto = numCL(m[9]);
    const neto = numCL(m[10]);
    if (Math.abs(bruto - impuesto - neto) > 0.011) r.avisos.push(`Dividendo de ${ticker} del ${fecha}: bruto ${bruto} - impuesto ${impuesto} no da el neto ${neto}.`);
    r.movimientos.push({ ...comun, fecha, tipo: 'DIVIDENDO', ticker, monto: bruto, detalle: `Dividendo ${nombre} (${ticker})` });
    if (impuesto > 0) r.movimientos.push({ ...comun, fecha, tipo: 'IMPUESTO', ticker, monto: -impuesto, detalle: `Impuesto retenido al dividendo de ${ticker}` });
  }
  const fechas = r.movimientos.map(x => x.fecha).sort();
  r.desde = fechas[0];

  // Control: cuántas filas tiene cada tabla (cada fila empieza con el año de la fecha)
  const filas = (s: string) => (s.match(/\b20\d{2}-/g) ?? []).length;
  const leidas = (t: TipoMovimiento) => r.movimientos.filter(x => x.tipo === t).length;
  if (filas(compras) !== leidas('COMPRA')) r.avisos.push(`Fintual: se leyeron ${leidas('COMPRA')} de ${filas(compras)} compras.`);
  if (filas(ventas) !== leidas('VENTA')) r.avisos.push(`Fintual: se leyeron ${leidas('VENTA')} de ${filas(ventas)} ventas.`);
  if (filas(dividendos) !== leidas('DIVIDENDO')) r.avisos.push(`Fintual: se leyeron ${leidas('DIVIDENDO')} de ${filas(dividendos)} dividendos.`);
  return r;
}

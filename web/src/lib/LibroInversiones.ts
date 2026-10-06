// Libro de inversiones: junta lo que leyó CartolaParser de todas las cartolas y lo deja auditado.
// - Descarta cartolas repetidas y movimientos que aparecen en dos cartolas (ej. una venta que BTG informa
//   como compromiso un mes y como liquidada el siguiente).
// - Detecta meses sin cartola y cuentas cuya historia empieza antes de la primera cartola.
// - Cuadra cada cartola contra la anterior: la foto de la cartera y la caja que informa el broker deben
//   explicarse con los movimientos del período. Lo que no se explica queda a la vista como NO_INFORMADO.
// - Calcula posiciones (costo promedio, fecha de compra), ganancia realizada, dividendos, comisiones y
//   cuánto vas ganando por cuenta (aportes vs valor actual, con TIR anual).
// Sin dependencias de runtime: lo usa la página y el script scripts/revisar-cartolas.mjs.
import type { FotoCartera, Moneda, Movimiento, ResultadoCartola, TipoMovimiento } from './CartolaParser';

export interface MovimientoLibro extends Movimiento { id: number }

export interface Alerta {
  nivel: 'error' | 'faltante' | 'aviso' | 'info';
  cuenta?: string;
  texto: string;
}

export interface Duplicado {
  tipo: 'archivo' | 'movimiento';
  cuenta: string;
  texto: string;
  archivos: string[];
}

export interface Conciliacion {
  cuenta: string;
  fecha: string;
  archivo: string;
  ok: boolean;
  diferencias: string[];
  estimado?: boolean; // la caja se cuadró con dividendos y comisión estimados (cartola resumida)
}

export interface PosicionCuenta {
  cuenta: string;
  ticker: string;
  moneda: Moneda;
  cantidad: number;
  costo?: number;                 // costo total (promedio ponderado); undefined si el broker no lo informa
  fechaCompra: string;            // desde cuándo se tiene la posición actual
  fechaCompraAproximada: boolean; // la posición ya existía antes de la primera cartola
  compras: { fecha: string; cantidad: number; precio: number }[];
  dividendos: number;             // brutos cobrados por este activo en esta cuenta
  monedaDividendos: Moneda;       // XTB paga en pesos los dividendos de acciones en dólares
  precio?: number;                // precio de mercado según la última cartola
  valor?: number;
  fechaPrecio?: string;
}

export interface ResumenCuenta {
  cuenta: string;
  broker: string;
  moneda: Moneda;
  cartolas: number;
  desde?: string;
  hasta?: string;
  capitalInicial: number;     // lo que ya había antes de la primera cartola (no documentado)
  fechaCapitalInicial?: string;
  aportes: number;
  aportesImplicitos: number;  // deducidos (Fintual no informa los depósitos)
  retiros: number;
  dividendos: number;
  impuestos: number;          // retenciones (negativo)
  intereses: number;
  comisiones: number;         // cobros netos de reversos (negativo)
  comisionesIncluidas: number;// gastos ya descontados del monto de compras/ventas (negativo, informativo)
  noInformado: number;        // cambios de caja que las cartolas no detallan
  gananciaRealizada: number;  // ventas: lo recibido menos el costo promedio de lo vendido
  costoPosiciones: number;
  caja?: number;
  valorActual?: number;       // patrimonio según la última cartola
  fechaValor?: string;
  ganancia?: number;          // valor actual + retiros - aportes - capital inicial
  rentabilidad?: number;      // ganancia / (aportes + capital inicial)
  tir?: number;               // tasa interna de retorno anual, según las fechas de cada aporte y retiro
}

// Mes en que el broker solo entregó un resumen y la caja cambió sin detalle
export interface PeriodoSinDetalle {
  cuenta: string;
  desde: string;
  hasta: string;
  tickers: string[];   // tickers de Yahoo de lo que había en la cuenta, para buscar sus dividendos
  explicado: boolean;  // se pudo desglosar en dividendos y comisión estimados
}

// Dividendos por acción de fuentes externas (Yahoo), por ticker de Yahoo: fecha ex-dividendo y monto
export type DividendosExternos = Record<string, { fecha: string; monto: number }[]>;

// Qué meses tiene cada cuenta (para ver de un vistazo qué cartolas faltan)
export type EstadoMes = 'completa' | 'resumen' | 'parcial' | 'falta' | 'certificado';
export interface CoberturaCuenta {
  cuenta: string;
  meses: { mes: string; estado: EstadoMes; archivo?: string }[];
}

export interface LibroInversiones {
  movimientos: MovimientoLibro[];
  sinDetalle: PeriodoSinDetalle[];
  cobertura: CoberturaCuenta[];
  cuentas: ResumenCuenta[];
  posiciones: PosicionCuenta[];
  alertas: Alerta[];
  duplicados: Duplicado[];
  conciliaciones: Conciliacion[];
  dolar?: { valor: number; fecha: string };
  generado: string;
}

const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (yyyymm: string) => `${NOMBRES_MES[Number(yyyymm.slice(5, 7)) - 1]} ${yyyymm.slice(0, 4)}`;
const fechaCorta = (f: string) => `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}`;
const siguienteMes = (yyyymm: string) => {
  const [y, m] = yyyymm.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const mesesEntre = (desde: string, hasta: string) => {
  const out: string[] = [];
  for (let m = desde; m <= hasta; m = siguienteMes(m)) out.push(m);
  return out;
};
const diaAnterior = (f: string) => new Date(Date.parse(`${f}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// "-$1.484" / "US$12,50" (sin "-0" cuando el monto se redondea a cero)
export const formatoMonto = (n: number, moneda: Moneda) => {
  const negativo = n < 0 && Math.abs(n) >= (moneda === 'CLP' ? 0.5 : 0.005);
  const abs = Math.abs(n);
  return `${negativo ? '-' : ''}${moneda === 'CLP'
    ? `$${Math.round(abs).toLocaleString('es-CL')}`
    : `US$${abs.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}`;
};
const fmtCant = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 8 });

// Tolerancias para decir que dos cifras "cuadran" (redondeos de las cartolas)
const TOL_CANTIDAD = 1e-6;
const tolCaja = (moneda: Moneda) => (moneda === 'CLP' ? 1.5 : 0.015);

const claveMovimiento = (m: Movimiento) =>
  [m.cuenta, m.fecha, m.tipo, m.ticker ?? '', m.cantidad?.toFixed(6) ?? '', m.monto.toFixed(2), m.montoIncluido ?? ''].join('|');

// Fecha que cuenta para la caja de una foto: Vector y BTG mueven la caja al liquidar, DriveWealth al operar.
// Las posiciones siempre cambian el día de la operación.
const fechaCaja = (m: Movimiento, foto: FotoCartera) => (foto.cajaPorOperacion ? m.fecha : m.fechaLiquidacion ?? m.fecha);
const mueveTitulos = (t: TipoMovimiento) => ['COMPRA', 'VENTA', 'SPLIT', 'CANJE', 'SALDO_INICIAL', 'NO_INFORMADO'].includes(t);
const cantidadConSigno = (m: Movimiento) => {
  if (m.cantidad === undefined) return 0;
  if (m.tipo === 'VENTA') return -m.cantidad;
  return m.cantidad; // COMPRA y SALDO_INICIAL positivas; SPLIT, CANJE y NO_INFORMADO ya traen signo
};

// Tasa interna de retorno anual (XIRR). Flujos negativos = plata que entra a la cuenta.
export function tir(flujos: { fecha: string; monto: number }[]): number | undefined {
  if (flujos.length < 2 || !flujos.some(f => f.monto < 0) || !flujos.some(f => f.monto > 0)) return undefined;
  const t0 = Date.parse(flujos[0].fecha);
  const dias = (f: string) => (Date.parse(f) - t0) / 86400000;
  // Con menos de un año no se anualiza (una ganancia de 3 meses "anualizada" exagera)
  if (Math.max(...flujos.map(f => dias(f.fecha))) < 365) return undefined;
  const vpn = (r: number) => flujos.reduce((s, f) => s + f.monto / Math.pow(1 + r, dias(f.fecha) / 365), 0);
  let lo = -0.99, hi = 10;
  if (vpn(lo) * vpn(hi) > 0) return undefined;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (vpn(lo) * vpn(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function construirLibro(
  resultados: ResultadoCartola[],
  hoy = new Date().toISOString().slice(0, 10),
  dividendosExternos: DividendosExternos = {},
): LibroInversiones {
  const alertas: Alerta[] = [];
  const duplicados: Duplicado[] = [];
  const conciliaciones: Conciliacion[] = [];

  // 1. Archivos que no se pudieron leer o no se reconocen
  for (const r of resultados) {
    if (r.sinTexto) alertas.push({ nivel: 'error', texto: `${r.archivo}: el PDF no tiene texto (parece escaneado). No se pudo leer.` });
    else if (r.conClave) alertas.push({ nivel: 'error', texto: `${r.archivo}: ${r.avisos[0]}` });
    else if (r.desconocido) alertas.push({ nivel: 'error', texto: `${r.archivo}: ${r.avisos[0] ?? 'formato de cartola no reconocido; se omitió.'}` });
  }

  // 2. Cartolas repetidas: misma cuenta y mismo período (aunque el archivo se llame distinto)
  const docs: ResultadoCartola[] = [];
  const porPeriodo = new Map<string, ResultadoCartola>();
  for (const r of resultados.filter(x => !x.sinTexto && !x.desconocido && !x.conClave)) {
    const clave = `${r.cuenta}|${r.tipoDoc}|${r.desde ?? ''}|${r.hasta ?? ''}`;
    const previa = porPeriodo.get(clave);
    if (previa) {
      duplicados.push({ tipo: 'archivo', cuenta: r.cuenta, archivos: [previa.archivo, r.archivo],
        texto: `"${r.archivo}" es la misma cartola que "${previa.archivo}" (${r.cuenta}, ${r.hasta ? nombreMes(r.hasta.slice(0, 7)) : 'mismo período'}). Se usó una sola.` });
      continue;
    }
    porPeriodo.set(clave, r);
    docs.push(r);
  }
  docs.sort((a, b) => a.cuenta.localeCompare(b.cuenta) || (a.hasta ?? '').localeCompare(b.hasta ?? ''));
  for (const r of docs) for (const a of r.avisos) alertas.push({ nivel: 'aviso', cuenta: r.cuenta, texto: `${r.archivo}: ${a}` });

  // 3. Movimientos repetidos entre cartolas distintas. Dentro de una misma cartola una línea repetida es
  //    real (ej. dos compras iguales el mismo día), por eso por cada clave se acepta el máximo de veces que
  //    aparece en una sola cartola.
  const aceptadas = new Map<string, { n: number; archivo: string }>();
  let movimientos: Movimiento[] = [];
  for (const r of docs) {
    const enEste = new Map<string, number>();
    for (const m of r.movimientos) {
      const clave = claveMovimiento(m);
      const n = (enEste.get(clave) ?? 0) + 1;
      enEste.set(clave, n);
      const previa = aceptadas.get(clave);
      if (previa && previa.archivo !== r.archivo && n <= previa.n) {
        if (!m.implicito) {
          duplicados.push({ tipo: 'movimiento', cuenta: m.cuenta, archivos: [previa.archivo, r.archivo],
            texto: `${m.tipo} ${m.ticker ?? ''} del ${fechaCorta(m.fecha)} por ${formatoMonto(m.monto, m.moneda)} aparece en "${previa.archivo}" y en "${r.archivo}": se contó una vez.`.replace(/\s+/g, ' ') });
        }
        continue;
      }
      aceptadas.set(clave, { n: Math.max(n, previa?.n ?? 0), archivo: previa?.archivo ?? r.archivo });
      movimientos.push(m);
    }
  }

  // Dividendo por acción de cada pago visto en cualquier cuenta (sirve para estimar los meses sin detalle:
  // un mismo fondo paga lo mismo por cuota en BTG que en Vector)
  const pagosPorAccion = new Map<string, { fecha: string; porAccion: number; cuenta: string }[]>();
  for (const m of movimientos) {
    if (m.tipo !== 'DIVIDENDO' || !m.ticker || !m.precio) continue;
    const lista = pagosPorAccion.get(m.ticker) ?? [];
    if (!lista.some(x => x.fecha === m.fecha && Math.abs(x.porAccion - m.precio!) < 1e-6)) lista.push({ fecha: m.fecha, porAccion: m.precio, cuenta: m.cuenta });
    pagosPorAccion.set(m.ticker, lista);
  }
  const sinDetalle: PeriodoSinDetalle[] = [];
  const cobertura: CoberturaCuenta[] = [];

  // 4. Por cuenta: cobertura, faltantes y cuadratura contra las fotos de cada cartola
  const cuentas = [...new Set(docs.map(d => d.cuenta))];
  const sinteticos: Movimiento[] = [];
  const capitalInicial = new Map<string, { monto: number; fecha: string }>();
  const mesActual = hoy.slice(0, 7);
  const ultimoMesCerrado = (() => { const [y, m] = mesActual.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();

  for (const cuenta of cuentas) {
    const docsCuenta = docs.filter(d => d.cuenta === cuenta);
    const moneda = docsCuenta[0].moneda;
    const movsCuenta = movimientos.filter(m => m.cuenta === cuenta);

    // Meses sin cartola
    const mensuales = docsCuenta.filter(d => d.tipoDoc !== 'CERTIFICADO' && d.hasta);
    const certificado = docsCuenta.find(d => d.tipoDoc === 'CERTIFICADO' && d.desde && d.hasta);
    if (certificado) {
      cobertura.push({ cuenta, meses: mesesEntre(certificado.desde!.slice(0, 7), certificado.hasta!.slice(0, 7)).map(mes => ({ mes, estado: 'certificado', archivo: certificado.archivo })) });
    }
    if (mensuales.length > 0) {
      const meses = new Set(mensuales.map(d => d.hasta!.slice(0, 7)));
      const orden = [...meses].sort();
      const hastaMes = orden[orden.length - 1] > ultimoMesCerrado ? orden[orden.length - 1] : ultimoMesCerrado;
      cobertura.push({
        cuenta,
        meses: mesesEntre(orden[0], hastaMes).map(mes => {
          const delMes = mensuales.filter(d => d.hasta!.startsWith(mes));
          const doc = delMes.find(d => d.tipoDoc === 'MENSUAL') ?? delMes.find(d => d.tipoDoc === 'RESUMEN') ?? delMes[0];
          const estado: EstadoMes = !doc ? 'falta' : doc.tipoDoc === 'RESUMEN' ? 'resumen' : doc.tipoDoc === 'PARCIAL' ? 'parcial' : 'completa';
          return { mes, estado, archivo: doc?.archivo };
        }),
      });
      const faltan = mesesEntre(orden[0], orden[orden.length - 1]).filter(m => !meses.has(m));
      for (const m of faltan) alertas.push({ nivel: 'faltante', cuenta, texto: `${cuenta}: falta la cartola de ${nombreMes(m)}.` });
      const ultimo = orden[orden.length - 1];
      if (ultimo < ultimoMesCerrado) {
        const pendientes = mesesEntre(siguienteMes(ultimo), ultimoMesCerrado);
        alertas.push({ nivel: 'faltante', cuenta, texto: `${cuenta}: la última cartola es de ${nombreMes(ultimo)}; faltan ${pendientes.length === 1 ? `la de ${nombreMes(pendientes[0])}` : `las de ${nombreMes(pendientes[0])} a ${nombreMes(pendientes[pendientes.length - 1])}`}.` });
      }
    }

    // Cuadratura período a período
    const conFoto = docsCuenta.filter(d => d.foto).sort((a, b) => a.foto!.fecha.localeCompare(b.foto!.fecha));
    let anterior: { foto: FotoCartera; doc: ResultadoCartola } | undefined;
    for (const doc of conFoto) {
      const foto = doc.foto!;
      const desde = anterior?.foto.fecha ?? '0000-00-00';
      const enPeriodoTitulos = (m: Movimiento) => m.fecha > desde && m.fecha <= foto.fecha;
      const enPeriodoCaja = (m: Movimiento) => { const f = fechaCaja(m, foto); return f > desde && f <= foto.fecha; };
      const delPeriodo = [...movsCuenta, ...sinteticos.filter(s => s.cuenta === cuenta)];
      const diferencias: string[] = [];
      let cajaEstimada = false;
      const huecoPrevio = anterior ? mesesEntre(siguienteMes(anterior.foto.fecha.slice(0, 7)), foto.fecha.slice(0, 7)).length > 1 : false;
      // Primera cartola: lo que no explican los movimientos ya estaba antes, salvo que la cuenta haya partido el mes en cero
      const motivo = !anterior ? (foto.valorInicial === 0 ? 'entrada' : 'inicial') : doc.tipoDoc === 'RESUMEN' ? 'resumen' : huecoPrevio ? 'hueco' : 'error';
      const fechaAjuste = motivo === 'inicial' ? diaAnterior(doc.desde ?? foto.fecha) : foto.fecha;

      // Títulos
      const tickers = new Set([...foto.posiciones.map(p => p.ticker), ...(anterior?.foto.posiciones.map(p => p.ticker) ?? []),
        ...delPeriodo.filter(m => m.ticker && mueveTitulos(m.tipo) && enPeriodoTitulos(m)).map(m => m.ticker!)]);
      for (const ticker of tickers) {
        const enFoto = foto.posiciones.find(p => p.ticker === ticker);
        if (!enFoto && !foto.completa) continue; // el resumen no lista todo
        const antes = anterior?.foto.posiciones.find(p => p.ticker === ticker)?.cantidad ?? 0;
        const flujo = delPeriodo.filter(m => m.ticker === ticker && mueveTitulos(m.tipo) && enPeriodoTitulos(m)).reduce((s, m) => s + cantidadConSigno(m), 0);
        const ahora = enFoto?.cantidad ?? 0;
        const diff = ahora - antes - flujo;
        if (Math.abs(diff) <= TOL_CANTIDAD) continue;
        const pos = enFoto ?? anterior?.foto.posiciones.find(p => p.ticker === ticker);
        if (motivo === 'inicial') {
          const costo = enFoto?.costo !== undefined ? enFoto.costo * (diff / enFoto.cantidad) : undefined;
          sinteticos.push({ cuenta, fecha: fechaAjuste, tipo: 'SALDO_INICIAL', ticker, cantidad: diff, precio: costo !== undefined ? costo / diff : enFoto?.precio,
            monto: 0, moneda: pos?.moneda ?? moneda, archivo: doc.archivo, implicito: true,
            detalle: `${fmtCant(diff)} ${ticker} que ya estaban en la cuenta antes del ${fechaCorta(doc.desde ?? foto.fecha)}${costo === undefined ? ' (costo de compra no informado)' : ''}` });
        } else if (motivo === 'entrada' && diff > 0) {
          sinteticos.push({ cuenta, fecha: fechaAjuste, tipo: 'NO_INFORMADO', ticker, cantidad: diff, precio: 0, monto: 0, moneda: pos?.moneda ?? moneda,
            archivo: doc.archivo, implicito: true, detalle: `Entraron ${fmtCant(diff)} ${ticker} sin compra ni cargo en la caja (probable acción de regalo): costo $0` });
          alertas.push({ nivel: 'aviso', cuenta, texto: `${cuenta} ${nombreMes(foto.fecha.slice(0, 7))}: aparecieron ${fmtCant(diff)} ${ticker} sin ninguna compra ni cargo en la caja, y la cuenta empezó el mes en $0. Lo más probable es que sea una acción de regalo (promoción de bienvenida): quedó registrada con costo $0.` });
        } else {
          diferencias.push(`${ticker}: la cartola informa ${fmtCant(ahora)} pero los movimientos llevan a ${fmtCant(antes + flujo)} (diferencia ${fmtCant(diff)}).`);
          sinteticos.push({ cuenta, fecha: fechaAjuste, tipo: 'NO_INFORMADO', ticker, cantidad: diff, precio: enFoto?.precio, monto: 0, moneda: pos?.moneda ?? moneda,
            archivo: doc.archivo, implicito: true, detalle: `Diferencia de ${fmtCant(diff)} ${ticker} sin movimiento que la explique` });
        }
      }

      // Caja
      if (foto.caja !== undefined) {
        const antes = anterior?.foto.caja ?? 0;
        const flujo = delPeriodo.filter(enPeriodoCaja).reduce((s, m) => s + m.monto, 0);
        const diff = foto.caja - antes - flujo;
        if (Math.abs(diff) > tolCaja(moneda)) {
          if (motivo === 'inicial') {
            sinteticos.push({ cuenta, fecha: fechaAjuste, tipo: 'SALDO_INICIAL', monto: diff, moneda, archivo: doc.archivo, implicito: true,
              detalle: `Caja que ya había antes del ${fechaCorta(doc.desde ?? foto.fecha)}` });
          } else {
            const mes = nombreMes(foto.fecha.slice(0, 7));
            const txt = motivo === 'resumen'
              ? `${cuenta} ${mes}: el broker solo entrega un resumen de 1 página, sin el detalle de movimientos. La caja ${diff > 0 ? 'subió' : 'bajó'} ${formatoMonto(Math.abs(diff), moneda)} en el mes (dividendos menos comisiones, normalmente): quedó registrado como "sin detalle".`
              : motivo === 'hueco'
                ? `${cuenta}: entre ${fechaCorta(anterior!.foto.fecha)} y ${fechaCorta(foto.fecha)} la caja cambió ${formatoMonto(diff, moneda)} sin movimientos que lo expliquen (falta una cartola).`
                : motivo === 'entrada'
                  ? `${cuenta} ${mes}: la caja cambió ${formatoMonto(diff, moneda)} sin movimientos que lo expliquen.`
                  : '';
            diferencias.push(`Caja: la cartola informa ${formatoMonto(foto.caja, moneda)} pero los movimientos llevan a ${formatoMonto(antes + flujo, moneda)}.`);
            const estimacion = motivo === 'resumen' && anterior
              ? estimarMesSinDetalle(cuenta, anterior.foto, foto, diff, movsCuenta, pagosPorAccion, dividendosExternos, doc.archivo)
              : undefined;
            if (motivo === 'resumen' && anterior) {
              sinDetalle.push({ cuenta, desde: anterior.foto.fecha, hasta: foto.fecha, explicado: !!estimacion,
                tickers: anterior.foto.posiciones.map(p => tickerYahoo(p.ticker, p.moneda)) });
            }
            if (estimacion) {
              diferencias.pop(); // la diferencia de caja quedó explicada
              cajaEstimada = true;
              sinteticos.push(...estimacion.movimientos);
              alertas.push({ nivel: 'info', cuenta, texto: `${cuenta} ${nombreMes(foto.fecha.slice(0, 7))}: el broker solo entrega un resumen de 1 página. La caja ${diff > 0 ? 'subió' : 'bajó'} ${formatoMonto(Math.abs(diff), moneda)} y se explica con ${estimacion.resumen}. Quedaron como movimientos estimados.` });
            } else {
              if (txt) alertas.push({ nivel: motivo === 'hueco' ? 'faltante' : 'aviso', cuenta, texto: txt });
              sinteticos.push({ cuenta, fecha: fechaAjuste, tipo: 'NO_INFORMADO', monto: diff, moneda, archivo: doc.archivo, implicito: true,
                detalle: motivo === 'resumen' ? `Movimientos de caja de ${nombreMes(foto.fecha.slice(0, 7))} no detallados (cartola resumida)` : 'Diferencia de caja sin movimiento que la explique' });
            }
          }
        }
      }
      if (motivo !== 'inicial' && motivo !== 'entrada') conciliaciones.push({ cuenta, fecha: foto.fecha, archivo: doc.archivo, ok: diferencias.length === 0, diferencias, estimado: cajaEstimada });
      if (diferencias.length > 0 && motivo === 'error') {
        alertas.push({ nivel: 'error', cuenta, texto: `${cuenta} al ${fechaCorta(foto.fecha)} no cuadra: ${diferencias.join(' ')}` });
      }
      anterior = { foto, doc };
    }

    // Historia anterior a la primera cartola
    const iniciales = sinteticos.filter(s => s.cuenta === cuenta && s.tipo === 'SALDO_INICIAL');
    if (iniciales.length > 0) {
      const primera = conFoto[0];
      const conTitulos = iniciales.filter(s => s.ticker);
      const valorInicial = primera.foto!.valorInicial;
      const monto = valorInicial ?? iniciales.reduce((s, m) => s + (m.ticker ? (m.cantidad ?? 0) * (m.precio ?? 0) : m.monto), 0);
      capitalInicial.set(cuenta, { monto, fecha: iniciales[0].fecha });
      if (conTitulos.length > 0) {
        alertas.push({ nivel: 'faltante', cuenta, texto: `${cuenta}: la primera cartola es de ${nombreMes(primera.foto!.fecha.slice(0, 7))} pero la cuenta ya tenía ${conTitulos.map(s => `${fmtCant(s.cantidad ?? 0)} ${s.ticker}`).join(', ')}. Faltan las cartolas anteriores (las de cuando compraste): sin ellas no se sabe la fecha de compra.` });
      } else {
        alertas.push({ nivel: 'info', cuenta, texto: `${cuenta}: al inicio de la primera cartola ya había ${formatoMonto(monto, moneda)} en caja (depósito anterior a ${nombreMes(primera.foto!.fecha.slice(0, 7))}).` });
      }
    }
  }

  // Fintual no informa los depósitos: cada compra que no alcanza con la caja disponible se pagó con un aporte
  for (const cuenta of cuentas) {
    if (!docs.some(d => d.cuenta === cuenta && d.tipoDoc === 'CERTIFICADO')) continue;
    let caja = 0;
    const movs = movimientos.filter(m => m.cuenta === cuenta).sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
    for (const m of movs) {
      caja += m.monto;
      if (caja < -0.005) {
        sinteticos.push({ cuenta, fecha: m.fecha, tipo: 'APORTE', monto: Math.round(-caja * 100) / 100, moneda: m.moneda, archivo: m.archivo, implicito: true,
          detalle: 'Aporte deducido: la cartola no informa depósitos, pero esta compra no alcanzaba con la caja disponible' });
        caja = 0;
      }
    }
  }

  movimientos = [...movimientos, ...sinteticos];
  const ordenTipo: Record<TipoMovimiento, number> = { SALDO_INICIAL: 0, APORTE: 1, DIVIDENDO: 2, IMPUESTO: 3, INTERES: 4, VENTA: 5, CANJE: 6, SPLIT: 7, COMPRA: 8, COMISION: 9, RETIRO: 10, NO_INFORMADO: 11 };
  const libroMovs: MovimientoLibro[] = movimientos
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.fecha.localeCompare(b.m.fecha) || ordenTipo[a.m.tipo] - ordenTipo[b.m.tipo] || a.i - b.i)
    .map(({ m }, id) => ({ ...m, id }));

  // 5. Posiciones: costo promedio ponderado y fecha desde la que se tiene cada posición
  type Estado = Omit<PosicionCuenta, 'costo'> & { costo: number; costoConocido: boolean };
  const estados = new Map<string, Estado>();
  const realizada = new Map<string, number>();
  const canjes: { cuenta: string; fecha: string; costo: number; conocido: boolean; fechaCompra: string; aprox: boolean }[] = [];
  const estado = (m: Movimiento): Estado => {
    const k = `${m.cuenta}|${m.ticker}`;
    let e = estados.get(k);
    if (!e) {
      e = { cuenta: m.cuenta, ticker: m.ticker!, moneda: m.monedaActivo ?? m.moneda, cantidad: 0, costo: 0, costoConocido: true, fechaCompra: m.fecha, fechaCompraAproximada: false, compras: [], dividendos: 0, monedaDividendos: m.moneda };
      estados.set(k, e);
    }
    return e;
  };
  for (const m of libroMovs) {
    if (!m.ticker) continue;
    const e = estado(m);
    const abrir = (fecha: string, aprox: boolean) => { if (e.cantidad <= TOL_CANTIDAD) { e.fechaCompra = fecha; e.fechaCompraAproximada = aprox; e.compras = []; e.costo = 0; e.costoConocido = true; } };
    switch (m.tipo) {
      case 'COMPRA': {
        abrir(m.fecha, false);
        const otraMoneda = !!m.monedaActivo && m.monedaActivo !== m.moneda;
        const costo = m.monto !== 0 && !otraMoneda ? -m.monto : (m.cantidad ?? 0) * (m.precio ?? 0);
        e.cantidad += m.cantidad ?? 0;
        e.costo += costo;
        e.compras.push({ fecha: m.fecha, cantidad: m.cantidad ?? 0, precio: costo / (m.cantidad || 1) });
        break;
      }
      case 'SALDO_INICIAL': {
        abrir(m.fecha, true);
        e.cantidad += m.cantidad ?? 0;
        if (m.precio === undefined || /no informado/.test(m.detalle)) e.costoConocido = false;
        e.costo += (m.cantidad ?? 0) * (m.precio ?? 0);
        break;
      }
      case 'VENTA': {
        const cantidad = Math.min(m.cantidad ?? 0, e.cantidad);
        const promedio = e.cantidad > 0 ? e.costo / e.cantidad : 0;
        const otraMoneda = !!m.monedaActivo && m.monedaActivo !== m.moneda;
        const recibido = m.monto !== 0 && !otraMoneda ? m.monto : (m.cantidad ?? 0) * (m.precio ?? 0);
        if (e.costoConocido) realizada.set(m.cuenta, (realizada.get(m.cuenta) ?? 0) + recibido - promedio * cantidad);
        e.cantidad -= cantidad;
        e.costo -= promedio * cantidad;
        if (e.cantidad <= TOL_CANTIDAD) { e.cantidad = 0; e.costo = 0; }
        break;
      }
      case 'SPLIT':
        e.cantidad += m.cantidad ?? 0;
        break;
      case 'CANJE': {
        if ((m.cantidad ?? 0) < 0) {
          // Sale: su costo y su fecha de compra pasan al instrumento que entra
          canjes.push({ cuenta: m.cuenta, fecha: m.fecha, costo: e.costo, conocido: e.costoConocido, fechaCompra: e.fechaCompra, aprox: e.fechaCompraAproximada });
          e.cantidad = 0;
          e.costo = 0;
        } else {
          const origen = canjes.findIndex(c => c.cuenta === m.cuenta && Math.abs(Date.parse(c.fecha) - Date.parse(m.fecha)) <= 15 * 86400000);
          if (origen >= 0) {
            const c = canjes.splice(origen, 1)[0];
            abrir(c.fechaCompra, c.aprox);
            e.costo += c.costo;
            e.costoConocido = c.conocido;
          } else {
            abrir(m.fecha, false);
            e.costo += (m.cantidad ?? 0) * (m.precio ?? 0);
          }
          e.cantidad += m.cantidad ?? 0;
        }
        break;
      }
      case 'NO_INFORMADO':
        if (m.cantidad && m.cantidad > 0) abrir(m.fecha, true);
        if (m.cantidad) {
          const promedio = e.cantidad > 0 ? e.costo / e.cantidad : m.precio ?? 0;
          e.cantidad += m.cantidad;
          e.costo += m.cantidad * promedio;
        }
        break;
      case 'DIVIDENDO':
        e.dividendos += m.monto;
        e.monedaDividendos = m.moneda;
        break;
      default:
        break;
    }
  }

  // Precio de mercado según la última foto de cada cuenta
  const ultimaFoto = new Map<string, FotoCartera>();
  for (const d of docs) if (d.foto && (!ultimaFoto.has(d.cuenta) || d.foto.fecha > ultimaFoto.get(d.cuenta)!.fecha)) ultimaFoto.set(d.cuenta, d.foto);
  const posiciones: PosicionCuenta[] = [...estados.values()]
    .filter(e => e.cantidad > TOL_CANTIDAD)
    .map(e => {
      const p = ultimaFoto.get(e.cuenta)?.posiciones.find(x => x.ticker === e.ticker);
      const { costoConocido, ...resto } = e;
      return {
        ...resto,
        cantidad: Number(e.cantidad.toFixed(8)),
        costo: costoConocido ? e.costo : undefined,
        precio: p?.precio,
        valor: p?.precio !== undefined ? p.precio * e.cantidad : undefined,
        fechaPrecio: p ? ultimaFoto.get(e.cuenta)!.fecha : undefined,
      };
    })
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta) || a.ticker.localeCompare(b.ticker));

  // 6. Resumen por cuenta
  const resumenes: ResumenCuenta[] = cuentas.map(cuenta => {
    const docsCuenta = docs.filter(d => d.cuenta === cuenta);
    const moneda = docsCuenta[0].moneda;
    const movs = libroMovs.filter(m => m.cuenta === cuenta);
    const suma = (t: TipoMovimiento, filtro: (m: Movimiento) => boolean = () => true) => movs.filter(m => m.tipo === t && filtro(m)).reduce((s, m) => s + m.monto, 0);
    const foto = ultimaFoto.get(cuenta);
    const ini = capitalInicial.get(cuenta);
    const aportes = suma('APORTE');
    const retiros = -suma('RETIRO');
    const posCuenta = posiciones.filter(p => p.cuenta === cuenta);
    const fechas = [...docsCuenta.map(d => d.desde), ...movs.map(m => m.fecha)].filter((f): f is string => !!f).sort();
    const r: ResumenCuenta = {
      cuenta, moneda, broker: docsCuenta[0].broker, cartolas: docsCuenta.length,
      desde: fechas[0], hasta: [...docsCuenta.map(d => d.hasta ?? '')].sort().pop(),
      capitalInicial: ini?.monto ?? 0, fechaCapitalInicial: ini?.fecha,
      aportes, aportesImplicitos: suma('APORTE', m => !!m.implicito), retiros,
      dividendos: suma('DIVIDENDO'), impuestos: suma('IMPUESTO'), intereses: suma('INTERES'),
      comisiones: suma('COMISION'), comisionesIncluidas: movs.filter(m => m.tipo === 'COMISION').reduce((s, m) => s + (m.montoIncluido ?? 0), 0),
      noInformado: suma('NO_INFORMADO'), gananciaRealizada: realizada.get(cuenta) ?? 0,
      costoPosiciones: posCuenta.reduce((s, p) => s + (p.costo ?? 0), 0),
      caja: foto?.caja, valorActual: foto?.valorTotal, fechaValor: foto?.fecha,
    };
    if (r.valorActual !== undefined) {
      const invertido = r.aportes + r.capitalInicial;
      r.ganancia = r.valorActual + r.retiros - invertido;
      r.rentabilidad = invertido > 0 ? r.ganancia / invertido : undefined;
      const flujos = [
        ...(ini ? [{ fecha: ini.fecha, monto: -ini.monto }] : []),
        ...movs.filter(m => m.tipo === 'APORTE' || m.tipo === 'RETIRO').map(m => ({ fecha: m.fecha, monto: -m.monto })),
        { fecha: r.fechaValor!, monto: r.valorActual },
      ].sort((a, b) => a.fecha.localeCompare(b.fecha));
      r.tir = tir(flujos);
    }
    return r;
  });

  const conDolar = docs.filter(d => d.dolar && d.hasta).sort((a, b) => b.hasta!.localeCompare(a.hasta!))[0];
  return {
    movimientos: libroMovs, cuentas: resumenes, posiciones, duplicados, conciliaciones, sinDetalle, cobertura,
    alertas: alertas.sort((a, b) => ['error', 'faltante', 'aviso', 'info'].indexOf(a.nivel) - ['error', 'faltante', 'aviso', 'info'].indexOf(b.nivel)),
    dolar: conDolar ? { valor: conDolar.dolar!, fecha: conDolar.hasta! } : undefined,
    generado: hoy,
  };
}

// Desglosa el cambio de caja de un mes con cartola resumida: dividendos de lo que había en la cuenta (por
// acción, según otra cartola del mismo instrumento o según Yahoo) y, lo que sobra, la comisión del mes.
// Solo se acepta si lo que sobra se parece a una comisión normal de la cuenta; si no, no se estima nada.
function estimarMesSinDetalle(
  cuenta: string, inicio: FotoCartera, fin: FotoCartera, diferencia: number, movsCuenta: Movimiento[],
  pagosPorAccion: Map<string, { fecha: string; porAccion: number; cuenta: string }[]>, externos: DividendosExternos, archivo: string,
): { movimientos: Movimiento[]; resumen: string } | undefined {
  const moneda = movsCuenta[0]?.moneda ?? 'CLP';
  const dividendos: Movimiento[] = [];
  for (const p of inicio.posiciones) {
    // Pagos vistos en otra cartola (exactos) o, si no hay, eventos de Yahoo (fecha ex-dividendo)
    const propios = (pagosPorAccion.get(p.ticker) ?? []).filter(x => x.cuenta !== cuenta && x.fecha > inicio.fecha && x.fecha <= fin.fecha);
    const yahoo = (externos[tickerYahoo(p.ticker, p.moneda)] ?? [])
      .filter(x => x.fecha > diaAnterior(diaAnterior(inicio.fecha)) && x.fecha <= diaAnterior(diaAnterior(fin.fecha)))
      .map(x => ({ fecha: x.fecha, porAccion: x.monto, cuenta: 'Yahoo Finance' }));
    for (const pago of propios.length > 0 ? propios : yahoo) {
      const monto = Math.round(p.cantidad * pago.porAccion);
      if (monto <= 0) continue;
      dividendos.push({ cuenta, fecha: pago.fecha, tipo: 'DIVIDENDO', ticker: p.ticker, precio: pago.porAccion, monto, moneda, archivo, implicito: true, estimado: true,
        detalle: `Estimado: ${fmtCant(p.cantidad)} × ${pago.porAccion.toLocaleString('es-CL', { maximumFractionDigits: 6 })} por acción (${pago.cuenta === 'Yahoo Finance' ? 'dividendo informado por Yahoo Finance' : `mismo pago en tu cuenta ${pago.cuenta}`}); la cartola resumida no lo detalla` });
    }
  }
  const comision = diferencia - dividendos.reduce((s, d) => s + d.monto, 0);
  const cobros = movsCuenta.filter(m => m.tipo === 'COMISION' && m.monto < 0 && /MENSUAL/i.test(m.detalle)).map(m => -m.monto);
  const tipica = cobros.length > 0 ? cobros.reduce((s, c) => s + c, 0) / cobros.length : undefined;
  if (comision > tolCaja(moneda) || (tipica !== undefined ? -comision > 2.5 * tipica : true)) return undefined;
  const movimientos = [...dividendos];
  if (-comision > tolCaja(moneda)) {
    movimientos.push({ cuenta, fecha: fin.fecha, tipo: 'COMISION', monto: Math.round(comision), moneda, archivo, implicito: true, estimado: true,
      detalle: `Estimado: comisión del mes (lo que queda de la diferencia de caja después de los dividendos)${tipica ? `; la comisión mensual promedio de la cuenta es ${formatoMonto(tipica, moneda)}` : ''}` });
  }
  const porTicker = new Map<string, number>();
  for (const d of dividendos) porTicker.set(d.ticker!, (porTicker.get(d.ticker!) ?? 0) + d.monto);
  const partes = [...porTicker].map(([t, m]) => `dividendos de ${t} (${formatoMonto(m, moneda)})`);
  if (-comision > tolCaja(moneda)) partes.push(`${partes.length ? 'menos ' : ''}la comisión del mes (${formatoMonto(-comision, moneda)})`);
  return { movimientos, resumen: partes.join(', ').replace(/, (menos [^,]+)$/, ' $1') };
}

// --- Para el portafolio de la app (precios de Yahoo) ------------------------------------------------

const ALIAS_YAHOO: Record<string, string> = { BCHILE: 'CHILE', SANTANDER: 'BSANTANDER', SQMB: 'SQM-B', ANDINAB: 'ANDINA-B', AGUASA: 'AGUAS-A' };

// Ticker de Yahoo de un activo: las acciones y fondos chilenos llevan el sufijo .SN
export const tickerYahoo = (ticker: string, moneda: Moneda) => {
  const base = ALIAS_YAHOO[ticker] ?? ticker;
  return moneda === 'CLP' ? `${base}.SN` : base;
};

export interface ValorHoy {
  cuenta: string;
  fecha: string;
  valor: number;
  caja: number;
  ganancia: number;
  rentabilidad?: number;
  tir?: number;
  sinPrecio: string[];   // activos sin precio: quedan valorizados al costo
}

// Valoriza cada cuenta a hoy: posiciones x precio actual (Yahoo) + la caja de la última cartola.
// `precios` viene por ticker de Yahoo; `dolar` son pesos por dólar (para posiciones en USD de cuentas en CLP).
export function valorizarHoy(libro: LibroInversiones, precios: Record<string, number>, dolar: number | undefined, hoy: string): ValorHoy[] {
  return libro.cuentas.map(c => {
    const movs = libro.movimientos.filter(m => m.cuenta === c.cuenta);
    const caja = c.caja ?? movs.reduce((s, m) => s + m.monto, 0);
    const sinPrecio: string[] = [];
    let valor = caja;
    for (const p of libro.posiciones.filter(x => x.cuenta === c.cuenta)) {
      const precio = precios[tickerYahoo(p.ticker, p.moneda)];
      let v = precio !== undefined ? precio * p.cantidad : p.valor ?? p.costo ?? 0;
      if (precio === undefined) sinPrecio.push(p.ticker);
      if (p.moneda !== c.moneda) v = p.moneda === 'USD' ? v * (dolar ?? NaN) : v / (dolar ?? NaN);
      valor += v;
    }
    const ganancia = valor + c.retiros - c.aportes - c.capitalInicial;
    const invertido = c.aportes + c.capitalInicial;
    const flujos = [
      ...(c.fechaCapitalInicial ? [{ fecha: c.fechaCapitalInicial, monto: -c.capitalInicial }] : []),
      ...movs.filter(m => m.tipo === 'APORTE' || m.tipo === 'RETIRO').map(m => ({ fecha: m.fecha, monto: -m.monto })),
      { fecha: hoy, monto: valor },
    ].sort((a, b) => a.fecha.localeCompare(b.fecha));
    return { cuenta: c.cuenta, fecha: hoy, valor, caja, ganancia, rentabilidad: invertido > 0 ? ganancia / invertido : undefined, tir: tir(flujos), sinPrecio };
  });
}

export interface PosicionPortafolio {
  ticker: string;           // ticker de Yahoo (acciones chilenas con sufijo .SN)
  cantidad: number;
  precio_compra: number;
  moneda: Moneda;
  purchase_date: string;
  cuentas: string[];
  costoEstimado: boolean;   // el broker no informó el costo: se usó el precio de mercado de la cartola
  fechaAproximada: boolean; // la posición es anterior a la primera cartola
}

// Suma las posiciones de todas las cuentas por activo (un mismo activo puede estar en varios brokers)
export function posicionesParaPortafolio(libro: LibroInversiones): PosicionPortafolio[] {
  const out = new Map<string, PosicionPortafolio & { costoTotal: number }>();
  for (const p of libro.posiciones) {
    const ticker = tickerYahoo(p.ticker, p.moneda);
    const costoEstimado = p.costo === undefined;
    const costo = p.costo ?? (p.precio ?? 0) * p.cantidad;
    const previa = out.get(ticker);
    if (previa) {
      previa.cantidad += p.cantidad;
      previa.costoTotal += costo;
      previa.precio_compra = previa.costoTotal / previa.cantidad;
      previa.cuentas.push(p.cuenta);
      previa.costoEstimado ||= costoEstimado;
      if (p.fechaCompra < previa.purchase_date) { previa.purchase_date = p.fechaCompra; previa.fechaAproximada = p.fechaCompraAproximada; }
    } else {
      out.set(ticker, { ticker, cantidad: p.cantidad, costoTotal: costo, precio_compra: costo / p.cantidad, moneda: p.moneda,
        purchase_date: p.fechaCompra, cuentas: [p.cuenta], costoEstimado, fechaAproximada: p.fechaCompraAproximada });
    }
  }
  return [...out.values()]
    .map(({ costoTotal, ...p }) => ({ ...p, cantidad: Number(p.cantidad.toFixed(8)), precio_compra: costoTotal / p.cantidad }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

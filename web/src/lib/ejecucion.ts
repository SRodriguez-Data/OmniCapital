// Registrar en la cartera guardada una orden ya ejecutada en la corredora, para que la app y el agente vean lo que de
// verdad hay. Una compra es un lote nuevo (con su precio y fecha); una venta descuenta de los lotes más antiguos
// primero. Sin dependencias de servidor: la usan la API (cartera en la cuenta) y el navegador (cartera de cartola).

export interface Lote {
  id: string;
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date: string | null;
}

export type Ejecucion =
  | { ticker: string; lado: 'VENDER'; cantidad: number }
  | { ticker: string; lado: 'COMPRAR'; cantidad: number; precio: number; moneda: 'USD' | 'CLP'; fecha: string };

export interface Cambios {
  actualizar: { id: string; cantidad: number }[];
  borrar: string[];
  insertar: Omit<Lote, 'id'>[];
}

const TICKER = /^[A-Z0-9.^=\-]{1,20}$/;
const TOLERANCIA = 1e-4; // fracciones: vender 0,1234 de 0,12345 es venderlo todo
const redondear = (x: number) => Math.round(x * 1e8) / 1e8;

export const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

export function leerEjecucion(x: unknown): Ejecucion | { error: string } {
  const e = (x ?? {}) as Record<string, unknown>;
  const ticker = typeof e.ticker === 'string' ? e.ticker.trim().toUpperCase() : '';
  const cantidad = Number(e.cantidad);
  if (!TICKER.test(ticker)) return { error: 'Ticker inválido.' };
  if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1e9) return { error: 'La cantidad debe ser un número mayor a 0.' };
  if (e.lado === 'VENDER') return { ticker, lado: 'VENDER', cantidad };
  if (e.lado !== 'COMPRAR') return { error: 'La orden debe ser de compra o de venta.' };
  const precio = Number(e.precio);
  if (!Number.isFinite(precio) || precio <= 0 || precio > 1e9) return { error: 'El precio debe ser un número mayor a 0.' };
  if (e.moneda !== 'USD' && e.moneda !== 'CLP') return { error: 'La moneda debe ser USD o CLP.' };
  if (ticker.endsWith('.SN') !== (e.moneda === 'CLP')) return { error: `${ticker} cotiza en ${ticker.endsWith('.SN') ? 'pesos' : 'dólares'}.` };
  if (e.moneda === 'CLP' && !Number.isInteger(cantidad)) return { error: 'Las acciones chilenas se compran enteras.' };
  const fecha = typeof e.fecha === 'string' ? e.fecha : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) || fecha > hoyEnChile()) {
    return { error: 'La fecha debe ser válida y no futura.' };
  }
  return { ticker, lado: 'COMPRAR', cantidad, precio, moneda: e.moneda, fecha };
}

export function cambiosPorEjecucion(lotes: Lote[], e: Ejecucion): Cambios | { error: string } {
  const propios = lotes.filter(l => l.ticker === e.ticker && l.cantidad > 0);
  if (e.lado === 'COMPRAR') {
    if (propios.some(l => l.moneda !== e.moneda)) return { error: `${e.ticker} está guardado en ${propios[0].moneda}: revisa la moneda.` };
    return {
      actualizar: [],
      borrar: [],
      insertar: [{ ticker: e.ticker, cantidad: e.cantidad, precio_compra: e.precio, moneda: e.moneda, purchase_date: e.fecha }],
    };
  }
  const total = propios.reduce((s, l) => s + l.cantidad, 0);
  if (!propios.length) return { error: `No tienes ${e.ticker} en tu cartera guardada.` };
  if (e.cantidad > total + TOLERANCIA) return { error: `Vendes ${e.cantidad} de ${e.ticker}, pero tu cartera guardada tiene ${redondear(total)}.` };
  // Los lotes sin fecha cuentan como los más antiguos
  const orden = [...propios].sort((a, b) => (a.purchase_date ?? '').localeCompare(b.purchase_date ?? ''));
  let resta = e.cantidad >= total - TOLERANCIA ? total : e.cantidad;
  const cambios: Cambios = { actualizar: [], borrar: [], insertar: [] };
  for (const l of orden) {
    if (resta <= 0) break;
    const sale = Math.min(resta, l.cantidad);
    resta = redondear(resta - sale);
    const queda = redondear(l.cantidad - sale);
    if (queda <= TOLERANCIA) cambios.borrar.push(l.id);
    else cambios.actualizar.push({ id: l.id, cantidad: queda });
  }
  return cambios;
}

// Para la cartera que vive en el navegador (modo cartola)
export function aplicarCambios<T extends Lote>(lotes: T[], c: Cambios, nuevoId: () => string): T[] {
  const nuevas = new Map(c.actualizar.map(x => [x.id, x.cantidad]));
  const fuera = new Set(c.borrar);
  return [
    ...lotes.filter(l => !fuera.has(l.id)).map(l => (nuevas.has(l.id) ? { ...l, cantidad: nuevas.get(l.id)! } : l)),
    ...c.insertar.map(x => ({ ...x, id: nuevoId(), purchase_date: x.purchase_date ?? '' }) as unknown as T),
  ];
}

// Protección ante caídas: el semáforo de cada mercado y la ganancia máxima que llegó a tener cada posición.
// Cálculos puros (sin datos de red), para usarlos igual en el asesor, el rebalanceo, el agente y las pruebas.
//
// Semáforo: un índice pasa a rojo cuando cierra más de 2% bajo su media de 200 días y vuelve a verde cuando cierra más
// de 2% sobre ella (la banda evita cambiar de color por ruido). Es la regla que mide tendencia_mercado.py en décadas de
// historia: no adivina el máximo, pero dejó las peores caídas en menos de la mitad, a cambio de algo de rentabilidad.

export const MEDIA_SEMAFORO = 200;
export const BANDA_SEMAFORO = 0.02;

export type ClaveMercado = 'eeuu' | 'tecnologia' | 'chile';

export interface Semaforo {
  clave: ClaveMercado;
  nombre: string;
  ticker: string;
  estado: 'verde' | 'rojo';
  fecha: string; // del último cierre
  precio: number;
  media: number;
  distancia: number; // precio / media - 1
  cambiaEn: number; // cierre que cambia el color (con la media de hoy)
  distanciaCambio: number; // cambiaEn / precio - 1
  desde: string | null; // cuándo tomó el color actual (null: antes de la historia disponible)
  caidaDesdeMaximo: number; // desde el máximo de 12 meses, positiva
}

/** Recorre la historia con la regla de la banda para saber el color de hoy y desde cuándo lo tiene. */
export function semaforo(clave: ClaveMercado, nombre: string, ticker: string, fechas: string[], cierres: number[]): Semaforo | null {
  const n = Math.min(fechas.length, cierres.length);
  if (n < MEDIA_SEMAFORO + 20) return null;
  let suma = 0;
  let verde = true;
  let desde: string | null = null;
  for (let i = 0; i < n; i++) {
    suma += cierres[i];
    if (i >= MEDIA_SEMAFORO) suma -= cierres[i - MEDIA_SEMAFORO];
    if (i < MEDIA_SEMAFORO - 1) continue;
    const media = suma / MEDIA_SEMAFORO;
    if (verde && cierres[i] < (1 - BANDA_SEMAFORO) * media) { verde = false; desde = fechas[i]; }
    else if (!verde && cierres[i] > (1 + BANDA_SEMAFORO) * media) { verde = true; desde = fechas[i]; }
  }
  const precio = cierres[n - 1];
  const media = suma / MEDIA_SEMAFORO;
  const cambiaEn = (verde ? 1 - BANDA_SEMAFORO : 1 + BANDA_SEMAFORO) * media;
  const maximo = Math.max(...cierres.slice(Math.max(0, n - 252), n));
  return {
    clave, nombre, ticker, estado: verde ? 'verde' : 'rojo', fecha: fechas[n - 1], precio, media,
    distancia: precio / media - 1, cambiaEn, distanciaCambio: cambiaEn / precio - 1, desde,
    caidaDesdeMaximo: maximo > 0 ? Math.max(0, 1 - precio / maximo) : 0,
  };
}

// --- Ganancia que se va ----------------------------------------------------------------------------------------------

export interface PicoGanancia {
  monto: number; // la mayor ganancia que llegó a tener lo que tienes hoy, en la moneda del activo (sin dividendos)
  pct: number; // sobre lo invertido en ese momento
  fecha: string;
  hoy: number; // la ganancia de hoy, en la moneda del activo
  hoyPct: number;
  devuelto: number; // parte de la ganancia máxima que ya se perdió (1 = toda; más de 1 = además hay pérdida)
}

/**
 * La mayor ganancia que tuvo la posición desde la primera compra, contando cada compra desde su fecha. Sin la fecha de
 * alguna compra no se puede saber (devuelve null).
 */
export function picoGanancia(
  lotes: { cantidad: number; precio: number; fecha?: string | null }[],
  fechas: string[],
  cierres: number[],
  precioHoy: number,
): PicoGanancia | null {
  if (!lotes.length || lotes.some(l => !l.fecha) || !(precioHoy > 0)) return null;
  const orden = [...lotes].sort((a, b) => a.fecha!.localeCompare(b.fecha!));
  const primera = orden[0].fecha!;
  let pico: { monto: number; pct: number; fecha: string } | null = null;
  let k = 0;
  let cantidad = 0;
  let costo = 0;
  for (let i = 0; i < Math.min(fechas.length, cierres.length); i++) {
    if (fechas[i] < primera) continue;
    while (k < orden.length && orden[k].fecha! <= fechas[i]) {
      cantidad += orden[k].cantidad;
      costo += orden[k].cantidad * orden[k].precio;
      k++;
    }
    const monto = cantidad * cierres[i] - costo;
    if (costo > 0 && (!pico || monto > pico.monto)) pico = { monto, pct: monto / costo, fecha: fechas[i] };
  }
  const costoTotal = lotes.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const hoy = lotes.reduce((s, l) => s + l.cantidad, 0) * precioHoy - costoTotal;
  if (!pico || costoTotal <= 0) return null;
  if (hoy > pico.monto) pico = { monto: hoy, pct: hoy / costoTotal, fecha: fechas[Math.min(fechas.length, cierres.length) - 1] ?? pico.fecha };
  return { ...pico, hoy, hoyPct: hoy / costoTotal, devuelto: pico.monto > 0 ? (pico.monto - hoy) / pico.monto : 0 };
}

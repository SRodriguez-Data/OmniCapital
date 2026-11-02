import mercadoMedido from '@/data/evidencia_mercado.json';
import { fmtMoney, type AdvisorReport, type AssetReport } from './advisor';
import { evidencia, mercadoDe } from './evidencia';
import type { Proteccion } from './perfil';
import type { ClaveMercado, Semaforo } from './proteccion';

// Avisos de la cartera: lo que conviene mirar antes de que una caída avance, con lo que se midió de cada regla.
//   - Semáforo de cada mercado (EE.UU., tecnología, Chile): rojo = el índice cayó bajo su tendencia. Es la única regla
//     de "salir antes" que protegió en décadas de historia (tendencia_mercado.py), y se avisa también cuando está cerca.
//   - Ganancia que se va: una posición que llegó a ganar bastante y ya devolvió la mitad o más.
//   - Máximos: por qué llegar al máximo del año no es un aviso de venta (lo midió el laboratorio).
// Los usan el rebalanceo (lib/rebalanceo.ts), la pestaña Avisos y el agente de Telegram.

export interface Aviso {
  id: string; // estable mientras la situación no cambie: el agente avisa solo los nuevos
  nivel: 'alerta' | 'atencion' | 'info';
  tipo: 'mercado' | 'ganancia' | 'maximos';
  titulo: string;
  detalle: string;
  queHacer: string;
  evidencia: string | null;
  tickers: string[];
}

export const CERCA_SEMAFORO = 0.03; // a menos de 3% de cambiar de color
export const PICO_MINIMO = 0.15; // una ganancia de 15% o más sobre lo invertido
export const DEVUELTO_MINIMO = 0.5; // que ya devolvió la mitad o más
const PICO_MINIMO_CARTERA = 0.002; // y que haya valido algo para la cartera (0,2% de su valor)
const MAXIMO_52S = -0.02;

// Fondos de tecnología: siguen al Nasdaq-100 más que al S&P 500
const FONDOS_TECNOLOGIA = new Set(['QQQ', 'QQQM', 'FTEC', 'VGT', 'XLK', 'IYW', 'SMH', 'SOXX', 'TQQQ']);
const SECTORES_TECNOLOGIA = new Set(['Tecnología', 'Comunicaciones']);

/** Los mercados cuyo semáforo manda sobre un activo: Chile; EE.UU.; y además tecnología si es una tecnológica. */
export function mercadosDe(a: Pick<AssetReport, 'ticker' | 'moneda' | 'sector' | 'diversificado'>): ClaveMercado[] {
  if (a.moneda === 'CLP') return ['chile'];
  const tecnologia = FONDOS_TECNOLOGIA.has(a.ticker) || (!a.diversificado && SECTORES_TECNOLOGIA.has(a.sector ?? ''));
  return tecnologia ? ['eeuu', 'tecnologia'] : ['eeuu'];
}

/** El semáforo en rojo que manda sobre el activo, si hay uno. */
export function semaforoRojoDe(a: Pick<AssetReport, 'ticker' | 'moneda' | 'sector' | 'diversificado'>, semaforos: Semaforo[]): Semaforo | null {
  const suyos = mercadosDe(a);
  return semaforos.find(s => s.estado === 'rojo' && suyos.includes(s.clave)) ?? null;
}

// Una regla que el laboratorio todavía no midió (o con muy pocos casos) no se cita
const medida = (texto: string) => !/muy pocos casos|no se pudo medir/.test(texto);
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')}%`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;
const fecha = (iso: string) => iso.split('-').reverse().join('-');
const sinSufijo = (t: string) => t.replace(/\.SN$/, '');
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
/** Nivel del semáforo: el IPSA se sigue con su fondo (en pesos); los de EE.UU. son índices (en puntos). */
export const fmtNivel = (s: Pick<Semaforo, 'clave'>, x: number) => (s.clave === 'chile'
  ? fmtMoney(x, 'CLP')
  : `${Math.round(x).toLocaleString('es-CL')} puntos`);
const QUE_SIGUE: Record<ClaveMercado, string> = {
  eeuu: 'el S&P 500', tecnologia: 'el Nasdaq-100', chile: 'el fondo It Now IPSA',
};

// --- Lo medido -------------------------------------------------------------------------------------------------------

interface Tramo { retorno_anual: number; peor_caida: number; peor_anio: number; sharpe: number | null }
interface IndiceMedido {
  nombre: string; detalle: string; desde: string; hasta: string; mantener: Tramo; regla: Tramo;
  cambios_por_anio: number; variantes: { probadas: number; protegen_en_ambas_mitades: number };
}
const MEDIDO = mercadoMedido as unknown as { indices: Partial<Record<ClaveMercado, IndiceMedido>> };

/** Lo que midió tendencia_mercado.py para el semáforo de ese mercado, en una frase. */
export function evidenciaSemaforo(clave: ClaveMercado): string | null {
  const m = MEDIDO.indices[clave];
  if (!m) return null;
  const robusta = m.variantes.protegen_en_ambas_mitades === m.variantes.probadas
    ? ` La protección se repitió en las ${m.variantes.probadas} variantes probadas (otras medias y bandas) y en cada mitad de la historia.`
    : '';
  return `Medido desde ${m.desde.slice(0, 4)} en el ${m.nombre}: salir en rojo y volver en verde dejó la peor caída en ${pct(m.regla.peor_caida, 0)} en vez de ${pct(m.mantener.peor_caida, 0)}, `
    + `con ${pct(m.regla.retorno_anual)} al año en vez de ${pct(m.mantener.retorno_anual)} (cambia de color ${String(m.cambios_por_anio).replace('.', ',')} veces al año y algunas son falsas alarmas).${robusta} `
    + 'Es un seguro: no adivina el máximo, sale después de la primera parte de la caída y evita la mayor parte de las grandes.';
}

/** Lo medido que explica cada aviso, para mostrarlo aunque hoy no haya aviso de ese tipo. */
export function mediciones(): { semaforos: Partial<Record<ClaveMercado, string>>; maximos: string[]; devolucion: string[] } {
  const semaforos: Partial<Record<ClaveMercado, string>> = {};
  for (const c of ['eeuu', 'tecnologia', 'chile'] as const) {
    const t = evidenciaSemaforo(c);
    if (t) semaforos[c] = t;
  }
  const regla = (clave: 'maximo_52s' | 'devolvio_mitad', describe: (m: string) => string) => (['EE.UU.', 'Chile'] as const)
    .map(m => evidencia(clave, m, -1, describe(m === 'Chile' ? 'chilena' : 'de EE.UU.')).texto)
    .filter(medida);
  return {
    semaforos,
    maximos: regla('maximo_52s', m => `Vender una acción ${m} porque llegó a su máximo de 52 semanas`),
    devolucion: regla('devolvio_mitad', m => `Vender una acción ${m} que subió 30% o más en el año y devolvió la mitad de esa subida`),
  };
}

// --- Avisos ----------------------------------------------------------------------------------------------------------

export function avisosCartera(
  report: Pick<AdvisorReport, 'posiciones' | 'mercado' | 'resumen' | 'usdClp'>,
  { proteccion = 'avisar', vendidas = new Map() }: { proteccion?: Proteccion; vendidas?: Map<string, { todo: boolean }> } = {},
): Aviso[] {
  const avisos: Aviso[] = [];
  const semaforos = report.mercado?.semaforos ?? [];
  const pos = report.posiciones.filter(a => a.cantidad > 0);
  const V = report.resumen.valorCLP;

  // 1. Mercados en rojo o cerca de cambiar
  for (const s of semaforos) {
    const suyas = pos.filter(a => mercadosDe(a).includes(s.clave));
    const peso = suyas.reduce((x, a) => x + a.peso, 0);
    if (peso <= 0) continue;
    const nombres = suyas.map(a => sinSufijo(a.ticker));
    const enCartera = `Tienes ${pct(peso, 0)} de tu patrimonio en este mercado (${nombres.length > 4 ? `${nombres.slice(0, 4).join(', ')} y otras` : lista(nombres)}).`;
    const nivel = `${fmtNivel(s, s.cambiaEn)} (${signed(s.distanciaCambio)})`;
    if (s.estado === 'rojo') {
      avisos.push({
        id: `rojo:${s.clave}:${s.desde ?? 'antes'}`, nivel: 'alerta', tipo: 'mercado', tickers: suyas.map(a => a.ticker),
        titulo: `${s.nombre}: zona roja`,
        detalle: `${QUE_SIGUE[s.clave][0].toUpperCase()}${QUE_SIGUE[s.clave].slice(1)} cerró ${pct(-s.distancia)} bajo su media de 200 días${s.desde ? ` (en rojo desde el ${fecha(s.desde)})` : ''} y está ${pct(s.caidaDesdeMaximo)} bajo su máximo del año. ${enCartera} Vuelve a verde si cierra sobre ${nivel}.`,
        queHacer: proteccion === 'avisar'
          ? 'Se sigue comprando: tu aporte del mes entra igual, más barato, y lo que tienes se mantiene. A 10 años o más, dejar de comprar en rojo costó rentabilidad. Si prefieres protegerte de una caída grande, elige "vender la mitad" o "vender todo" en Protección ante caídas, en tu perfil.'
          : `El rebalanceo deja de comprar ahí, vende ${proteccion === 'mitad' ? 'la mitad de' : 'todo'} lo que tienes en este mercado y lo deja en un refugio (depósito o fondo money market) hasta que vuelva a verde; ahí te avisa para volver a entrar.`,
        evidencia: evidenciaSemaforo(s.clave),
      });
    } else if (s.distanciaCambio >= -CERCA_SEMAFORO) {
      avisos.push({
        id: `cerca:${s.clave}`, nivel: 'atencion', tipo: 'mercado', tickers: suyas.map(a => a.ticker),
        titulo: `${s.nombre}: cerca de la zona roja`,
        detalle: `Pasa a rojo si ${QUE_SIGUE[s.clave]} cierra bajo ${nivel}. Hoy está ${pct(s.distancia)} sobre su media de 200 días y ${pct(s.caidaDesdeMaximo)} bajo su máximo del año. ${enCartera}`,
        queHacer: `Todavía nada: es un aviso previo para que no te pille de sorpresa. Si cruza, ${proteccion === 'avisar' ? 'se sigue comprando (elegiste solo avisar)' : `el rebalanceo deja de comprar ahí y vende ${proteccion === 'mitad' ? 'la mitad' : 'todo'}`}, y te aviso.`,
        evidencia: evidenciaSemaforo(s.clave),
      });
    }
  }

  // 2. Ganancias que se van
  for (const a of pos) {
    const p = a.pico;
    if (!p || p.pct < PICO_MINIMO || p.devuelto < DEVUELTO_MINIMO) continue;
    const picoCLP = a.moneda === 'USD' ? p.monto * report.usdClp : p.monto;
    if (picoCLP < PICO_MINIMO_CARTERA * V) continue;
    const rojo = semaforoRojoDe(a, semaforos);
    const vendida = vendidas.get(a.ticker);
    const ev = !a.diversificado && a.tipo === 'accion'
      ? evidencia('devolvio_mitad', mercadoDe(a.moneda), -1, 'Vender una acción que subió 30% o más en el año y devolvió la mitad de esa subida')
      : null;
    const hoy = p.hoy >= 0 ? `hoy ganas ${fmtMoney(p.hoy, a.moneda)} (${signed(p.hoyPct)})` : `hoy pierdes ${fmtMoney(-p.hoy, a.moneda)} (${signed(p.hoyPct)})`;
    const queHacer = vendida
      ? `El plan de hoy ya la vende${vendida.todo ? ' completa' : ' en parte'}.`
      : rojo
        ? `Su mercado está en zona roja: sigue el aviso de ${rojo.nombre}.`
        : a.diversificado
          ? 'Es un fondo: lo que decide es el semáforo de su mercado, hoy en verde. Mantener.'
          : ev?.decide
            ? 'Lo medido apoya vender: en su mercado, las acciones así siguieron rindiendo menos que el resto.'
            : `Lo medido no apoya venderla solo por esto. Lo que protege es el semáforo de su mercado (hoy en verde) y el tamaño de la posición (pesa ${pct(a.peso)} de tu cartera). Si la vendes, que sea porque pesa más de lo que aceptas perder o porque cambió tu razón para tenerla, no por el precio.`;
    avisos.push({
      id: `ganancia:${a.ticker}:${p.fecha}`, nivel: 'atencion', tipo: 'ganancia', tickers: [a.ticker],
      titulo: `${sinSufijo(a.ticker)}: ${p.devuelto >= 1 ? 'devolvió toda su ganancia' : `devolvió ${pct(p.devuelto, 0)} de su ganancia`}`,
      detalle: `Llegaste a ganar ${fmtMoney(p.monto, a.moneda)} (${signed(p.pct)}) el ${fecha(p.fecha)}; ${hoy}, sin contar dividendos.`,
      queHacer,
      evidencia: ev && medida(ev.texto) ? ev.texto : null,
    });
  }

  // 3. En su máximo del año: la pregunta de "¿vendo arriba?"
  const enMaximo = pos.filter(a => a.distMaximo52s !== null && a.distMaximo52s >= MAXIMO_52S && !vendidas.get(a.ticker)?.todo);
  if (enMaximo.length) {
    const mercados = [...new Set(enMaximo.map(a => mercadoDe(a.moneda)))];
    const textos = mercados.map(m => evidencia('maximo_52s', m, -1, `Vender una acción ${m === 'Chile' ? 'chilena' : 'de EE.UU.'} porque llegó a su máximo de 52 semanas`))
      .filter(e => medida(e.texto));
    avisos.push({
      id: `maximos:${enMaximo.map(a => a.ticker).sort().join(',')}`, nivel: 'info', tipo: 'maximos', tickers: enMaximo.map(a => a.ticker),
      titulo: `En su máximo del año: ${lista(enMaximo.map(a => sinSufijo(a.ticker)))}`,
      detalle: 'Llegar al máximo no avisa que viene una baja. Vender caro con fundamento es otra cosa: recortar cuando una posición pasa su peso máximo (el plan te da ese precio en "Precios que vigilo") o cuando su mercado pasa a rojo.',
      queHacer: 'Mantener: no vender solo porque está arriba.',
      evidencia: textos.length ? textos.map(e => e.texto).join(' ') : null,
    });
  }

  const orden = { alerta: 0, atencion: 1, info: 2 };
  return avisos.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
}

import mercadoMedido from '@/data/evidencia_mercado.json';
import { LIMITE_ACCION, LIMITE_SECTOR, fmtMoney, type Accion } from './advisor';
import { semaforoRojoDe } from './avisos';
import { evidenciaMetodo, type Mercado } from './evidenciaMetodos';
import type { IdeaTop, IdeasDelBot } from './ideas';
import type { NivelRiesgo, Proteccion } from './perfil';
import type { Semaforo } from './proteccion';

// Dónde invertir plata nueva (el aporte del mes, o lo que deja un rebalanceo): núcleo + Top medido.
//   - Núcleo: el índice completo de cada mercado (VOO en EE.UU., el fondo It Now IPSA en Chile), todos los meses,
//     caiga o suba. En décadas de historia, dejar de comprar cuando el mercado está en rojo bajó la rentabilidad.
//   - Top: las ideas del bot, que son la única ventaja que el laboratorio midió como sólida para la cartera completa
//     (EE.UU.: utilidad respaldada por caja; Chile: momentum). Cada mes van a las que menos tienes, así la cartera del
//     método se arma en pocos meses sin pagar una comisión por cada una de las 20 todos los meses.
// Cuánto va al Top depende del perfil: un inversionista agresivo pone más donde hay ventaja medida.
// Lo único que frena una compra es lo que tiene base: tu máximo en Chile, un sector o una empresa sobre su límite,
// una señal de venta con evidencia, o la protección ante caídas si tú la elegiste.

export const SATELITE: Record<NivelRiesgo, number> = { agresivo: 0.6, moderado: 0.3, conservador: 0 };
export const NUCLEO: Record<Mercado, { ticker: string; nombre: string }> = {
  'EE.UU.': { ticker: 'VOO', nombre: 'Vanguard S&P 500 ETF' },
  Chile: { ticker: 'CFMITNIPSA.SN', nombre: 'It Now IPSA (fondo del IPSA)' },
};
const MARGEN = 0.02;
const MIN_ORDEN = 10000; // bajo $10.000 una orden no vale la comisión
const MIN_ORDEN_TOP = 30000; // cada idea del Top entra con un monto que importe
const MAX_TOP = 6; // por mercado y por vez
const HOLGURA_LIMITE = 0.005; // el precio límite queda 0,5% peor que el último: se ejecuta, pero sin regalar el precio
const DIAS_PRECIO_ESCANEO = 7;

export type Lado = 'VENDER' | 'COMPRAR';

export function precioLimite(precio: number, moneda: 'USD' | 'CLP', lado: Lado): number {
  const x = precio * (lado === 'VENDER' ? 1 - HOLGURA_LIMITE : 1 + HOLGURA_LIMITE);
  // Pesos enteros desde $1.000 (múltiplo de cualquier tick de la bolsa); bajo eso, centavos
  const paso = moneda === 'CLP' && precio >= 1000 ? 1 : 0.01;
  const pasos = lado === 'VENDER' ? Math.floor(x / paso + 1e-9) : Math.ceil(x / paso - 1e-9);
  return Number((pasos * paso).toFixed(2));
}

export interface OrdenAporte {
  ticker: string;
  nombre?: string;
  moneda: 'USD' | 'CLP';
  mercado: Mercado;
  papel: 'nucleo' | 'top';
  puesto?: number; // en la lista del Top
  sector?: string;
  cantidad: number;
  precio: number;
  limite: number;
  montoCLP: number;
  tienesCLP: number; // lo que ya tienes de este activo
  enRojo: boolean; // su mercado está bajo su tendencia: se compra igual, más barato
  proximosResultados: string | null;
  motivo: string;
}

export interface PlanAporte {
  montoCLP: number;
  nivel: NivelRiesgo;
  satelite: number;
  chileCLP: number;
  eeuuCLP: number;
  ordenes: OrdenAporte[];
  invertidoCLP: number;
  sinInvertirCLP: number;
  descartadas: { ticker: string; motivo: string }[];
  evidencia: { top: Partial<Record<Mercado, string>>; nucleo: string | null };
  notas: string[];
  resumen: string;
}

export interface EntradaAporte {
  montoCLP: number;
  usdClp: number;
  valorCLP: number; // la cartera antes de este aporte
  chileCLP: number; // lo que tienes en Chile (contando lo que hay dentro de tus fondos)
  posiciones: { ticker: string; valorCLP: number; accion?: Accion; pesoEfectivo?: number }[];
  sectores: { nombre: string; peso: number }[]; // mirando dentro de los fondos, sobre valorCLP
  ideas: IdeasDelBot | null;
  precios: Map<string, { price: number; name?: string; time?: string }>;
  nivel: NivelRiesgo;
  metaChile: number;
  semaforos: Semaforo[];
  proteccion: Proteccion;
  bloqueados?: Map<string, string>; // ticker → por qué no se compra (se vende en el rebalanceo, un evento grave…)
  sinChile?: string | null; // por qué no se compra nada en Chile esta vez (el rebalanceo lo está reduciendo)
  fraccionar?: boolean;
  hoy?: string; // YYYY-MM-DD, para saber si un precio del escaneo está al día
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')}%`;
const signo = (x: number) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;
const sinSufijo = (t: string) => t.replace(/\.SN$/, '');

interface IndiceMedido { nombre: string; desde: string; mantener: { retorno_anual: number; peor_caida: number }; regla: { retorno_anual: number; peor_caida: number } }
const MEDIDO = mercadoMedido as unknown as { indices: Partial<Record<'eeuu' | 'tecnologia' | 'chile', IndiceMedido>> };

/** Lo que midió el laboratorio de cada método del Top, en una frase. */
export function evidenciaTop(mercado: Mercado): string | null {
  const ev = evidenciaMetodo(mercado === 'Chile' ? 'momentum_chile' : 'calidad_eeuu');
  const c = ev?.cartera;
  const e = c?.ponderaciones[c.elegida];
  if (!ev || !e) return null;
  const regla = mercado === 'Chile'
    ? 'las 5 acciones del IPSA que más subieron en 12 meses (sin el último), pesadas por su volatilidad'
    : 'las 20 acciones del S&P 500 con la utilidad más respaldada por caja de su sector';
  return `Comprar ${regla} y renovarlas cada mes rindió ${pct(e.retorno_anual)} al año en ${ev.anios}, ${signo(e.exceso_anual)} al año sobre el promedio de su mercado (evidencia ${ev.nivel}). Peor caída: ${pct(e.peor_caida, 0)}.`;
}

/** Por qué el núcleo se compra todos los meses, caiga o suba. */
export function evidenciaNucleo(): string | null {
  const m = MEDIDO.indices.eeuu;
  if (!m) return null;
  return `En el ${m.nombre} desde ${m.desde.slice(0, 4)}, quedarse invertido rindió ${pct(m.mantener.retorno_anual)} al año; salir cada vez que se ponía en rojo, ${pct(m.regla.retorno_anual)}. Esa salida evita caídas grandes, pero a 10 años o más cuesta rentabilidad: por eso el núcleo se compra todos los meses.`;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export function planAporte(e: EntradaAporte): PlanAporte {
  const { usdClp, valorCLP: V, nivel, metaChile, semaforos, proteccion } = e;
  const monto = Math.max(0, e.montoCLP);
  const fraccionar = e.fraccionar ?? true;
  const hoy = e.hoy ?? new Date().toISOString().slice(0, 10);
  const satelite = SATELITE[nivel];
  const tengo = new Map(e.posiciones.map(p => [p.ticker, p]));
  const descartadas: PlanAporte['descartadas'] = [];
  const notas: string[] = [];
  const protege = proteccion !== 'avisar';
  const bloqueo = (t: string) => e.bloqueados?.get(t) ?? null;

  // Precio al día: el en vivo, o el del escaneo si tiene menos de una semana
  const precioDe = (t: string, idea?: IdeaTop): { precio: number; nombre?: string } | null => {
    const q = e.precios.get(t);
    if (q && q.price > 0 && (!q.time || diasEntre(q.time, hoy) <= DIAS_PRECIO_ESCANEO)) return { precio: q.price, nombre: q.name };
    if (idea?.precio && idea.fechaPrecio && diasEntre(idea.fechaPrecio, hoy) <= DIAS_PRECIO_ESCANEO) return { precio: idea.precio };
    return null;
  };
  const aCLP = (moneda: 'USD' | 'CLP', n: number) => (moneda === 'USD' ? n * usdClp : n);
  const rojoDe = (ticker: string, moneda: 'USD' | 'CLP', sector: string | undefined, diversificado: boolean) =>
    semaforoRojoDe({ ticker, moneda, sector, diversificado }, semaforos);

  // 1. Cuánto va a Chile: lo que cabe bajo tu máximo, en la proporción de tu meta; si está lleno, nada
  const espacioChile = Math.max(0, (metaChile - MARGEN) * (V + monto) - e.chileCLP);
  const chileRojo = protege ? semaforos.find(s => s.clave === 'chile' && s.estado === 'rojo') : undefined;
  let chileCLP = chileRojo || e.sinChile ? 0 : Math.min(espacioChile, monto * metaChile);
  if (chileCLP < MIN_ORDEN) chileCLP = 0;
  const pesoChile = V > 0 ? e.chileCLP / V : 0;
  if (monto > 0 && chileCLP === 0) {
    notas.push(e.sinChile ? e.sinChile : chileRojo
      ? 'La bolsa chilena está en rojo y elegiste protegerte: este aporte va completo a EE.UU. hasta que vuelva a verde.'
      : `Chile ya es ${pct(pesoChile, 0)} de tu patrimonio (tu máximo es ${pct(metaChile, 0)}): este aporte va completo a EE.UU. Así tu cartera depende menos de una sola economía.`);
  }
  const eeuuCLP = monto - chileCLP;

  const ordenes: OrdenAporte[] = [];
  const enRojo = new Set<string>(); // nombres de los mercados en rojo donde se compra igual
  let sobra = 0;

  const sectorLleno = (s?: string) => !!s && (e.sectores.find(x => x.nombre === s)?.peso ?? 0) >= LIMITE_SECTOR - MARGEN;
  const motivoNo = (i: IdeaTop): string | null => {
    const b = bloqueo(i.ticker);
    if (b) return b;
    const p = tengo.get(i.ticker);
    if (p?.accion === 'REDUCIR') return 'Tiene una señal de venta con evidencia en tu cartera: no se suma.';
    if ((p?.pesoEfectivo ?? 0) >= LIMITE_ACCION - MARGEN) return `Ya pesa ${pct(p!.pesoEfectivo!, 0)} de tu patrimonio, cerca del máximo de ${pct(LIMITE_ACCION, 0)} por empresa.`;
    if (sectorLleno(i.sector)) return `${i.sector} ya pesa ${pct(e.sectores.find(x => x.nombre === i.sector)!.peso, 0)} de tu patrimonio (máximo ${pct(LIMITE_SECTOR, 0)}): no se suma más de ese sector.`;
    const rojo = protege ? rojoDe(i.ticker, i.moneda, i.sector, false) : null;
    if (rojo) return `${rojo.nombre} está en rojo y elegiste protegerte: no se compra ahí hasta que vuelva a verde.`;
    if (!precioDe(i.ticker, i)) return 'Sin precio al día.';
    return null;
  };

  const comprar = (t: string, moneda: 'USD' | 'CLP', mercado: Mercado, papel: OrdenAporte['papel'], clp: number,
    extra: { nombre?: string; puesto?: number; sector?: string; proximos?: string | null; motivo: string; precio: number; diversificado: boolean }): number => {
    const precioCLP = aCLP(moneda, extra.precio);
    const fraccional = fraccionar && moneda === 'USD';
    const cantidad = fraccional ? Math.floor((clp / precioCLP) * 10000) / 10000 : Math.floor(clp / precioCLP);
    const montoCLP = cantidad * precioCLP;
    if (cantidad <= 0 || montoCLP < MIN_ORDEN) return 0;
    const ya = ordenes.find(o => o.ticker === t);
    if (ya) {
      ya.cantidad = Math.round((ya.cantidad + cantidad) * 10000) / 10000;
      ya.montoCLP += montoCLP;
      return montoCLP;
    }
    const rojo = rojoDe(t, moneda, extra.sector, extra.diversificado);
    if (rojo) enRojo.add(rojo.nombre);
    ordenes.push({
      ticker: t, nombre: extra.nombre, moneda, mercado, papel, puesto: extra.puesto, sector: extra.sector,
      cantidad, precio: extra.precio, limite: precioLimite(extra.precio, moneda, 'COMPRAR'), montoCLP,
      tienesCLP: tengo.get(t)?.valorCLP ?? 0, enRojo: !!rojo,
      proximosResultados: extra.proximos ?? null, motivo: extra.motivo,
    });
    return montoCLP;
  };

  for (const mercado of ['EE.UU.', 'Chile'] as const) {
    const presupuesto = mercado === 'Chile' ? chileCLP : eeuuCLP;
    if (presupuesto <= 0) continue;
    const moneda = mercado === 'Chile' ? 'CLP' : 'USD';
    let paraTop = presupuesto * satelite;

    // 2. Top: las ideas que menos tienes primero (a igualdad, las primeras de la lista)
    const lista = (mercado === 'Chile' ? e.ideas?.cl : e.ideas?.us) ?? [];
    const elegibles: IdeaTop[] = [];
    for (const i of lista) {
      const no = motivoNo(i);
      if (no) descartadas.push({ ticker: i.ticker, motivo: no });
      else elegibles.push(i);
    }
    elegibles.sort((a, b) => (tengo.get(a.ticker)?.valorCLP ?? 0) - (tengo.get(b.ticker)?.valorCLP ?? 0) || a.puesto - b.puesto);
    if (paraTop > 0 && !lista.length) notas.push(`No hay ideas del Top ${mercado} al día: esa parte va al índice.`);
    let k = Math.min(MAX_TOP, elegibles.length, Math.floor(paraTop / MIN_ORDEN_TOP));
    if (paraTop > 0 && lista.length && k === 0) {
      notas.push(elegibles.length
        ? `Con ${fmtMoney(paraTop, 'CLP')} para el Top ${mercado} no alcanza una orden de ${fmtMoney(MIN_ORDEN_TOP, 'CLP')}: este mes va al índice y el Top entra cuando el monto lo permita.`
        : `Ninguna idea del Top ${mercado} se puede comprar hoy (ver descartadas): esa parte va al índice.`);
    }
    // Chile se compra en acciones enteras: una idea cuya acción cuesta más que su parte cede su lugar a la siguiente
    let usadoTop = 0;
    let candidatas = elegibles;
    while (k > 0) {
      const set = candidatas.slice(0, k);
      const suma = set.reduce((s, i) => s + (mercado === 'Chile' ? i.peso : 1), 0);
      const caras = set.filter(i => aCLP(moneda, precioDe(i.ticker, i)!.precio) > paraTop * (mercado === 'Chile' ? i.peso : 1) / suma);
      if (moneda === 'CLP' && caras.length) {
        for (const i of caras) descartadas.push({ ticker: i.ticker, motivo: `Una acción cuesta ${fmtMoney(precioDe(i.ticker, i)!.precio, 'CLP')}, más que su parte de este aporte: entra en un mes con más monto.` });
        candidatas = candidatas.filter(i => !caras.includes(i));
        k = Math.min(k, candidatas.length);
        continue;
      }
      for (const i of set) {
        const px = precioDe(i.ticker, i)!;
        const parte = paraTop * (mercado === 'Chile' ? i.peso : 1) / suma;
        const tiene = tengo.get(i.ticker)?.valorCLP ?? 0;
        const detalle = mercado === 'Chile'
          ? `momentum ${i.momentum !== null ? signo(i.momentum) : 's/d'} en 12 meses`
          : `utilidad respaldada por caja${i.percentilSector !== null && i.percentilSector >= 0.999 ? ', la mejor de su sector' : ''}`;
        usadoTop += comprar(i.ticker, moneda, mercado, 'top', parte, {
          nombre: px.nombre, puesto: i.puesto, sector: i.sector, proximos: i.proximosResultados, precio: px.precio, diversificado: false,
          motivo: `#${i.puesto} del Top ${mercado}${i.sector ? ` · ${i.sector}` : ''} · ${detalle} · ${tiene > 0 ? `ya tienes ${fmtMoney(tiene, 'CLP')}` : 'aún no la tienes'}.`,
        });
      }
      break;
    }
    paraTop = usadoTop;

    // 3. Núcleo: el resto del presupuesto de este mercado, al índice completo
    const n = NUCLEO[mercado];
    const pxN = precioDe(n.ticker);
    const bN = bloqueo(n.ticker);
    const rojoN = rojoDe(n.ticker, moneda, undefined, true);
    const paraNucleo = presupuesto - paraTop;
    let usadoN = 0;
    if (bN) descartadas.push({ ticker: n.ticker, motivo: bN });
    else if (protege && rojoN) descartadas.push({ ticker: n.ticker, motivo: `${rojoN.nombre} está en rojo y elegiste protegerte: no se compra ahí hasta que vuelva a verde.` });
    else if (!pxN) descartadas.push({ ticker: n.ticker, motivo: 'Sin precio al día.' });
    else if (paraNucleo >= MIN_ORDEN) {
      usadoN = comprar(n.ticker, moneda, mercado, 'nucleo', paraNucleo, {
        nombre: pxN.nombre ?? n.nombre, precio: pxN.precio, diversificado: true,
        motivo: `Núcleo: ${mercado === 'Chile' ? 'el IPSA completo' : 'las 500 empresas del S&P 500'} en una sola compra, todos los meses${rojoN ? ', y hoy más barato: su mercado está en rojo' : ''}.`,
      });
      if (!usadoN && moneda === 'USD' && !fraccionar) {
        notas.push(`Una acción de ${n.ticker} cuesta ${fmtMoney(pxN.precio, 'USD')}: sin fracciones no alcanza este mes. Junta dos o tres aportes, o usa un fondo del S&P 500 de precio más bajo.`);
      }
    }
    sobra += presupuesto - paraTop - usadoN;
  }

  // Lo que quedó por redondeo (acciones chilenas enteras) se suma al índice de EE.UU., que se compra en fracciones
  const usd = ordenes.find(o => o.papel === 'nucleo' && o.moneda === 'USD');
  if (usd && fraccionar && sobra > 1) {
    const extra = Math.floor((sobra / aCLP('USD', usd.precio)) * 10000) / 10000;
    if (extra > 0) {
      usd.cantidad = Math.round((usd.cantidad + extra) * 10000) / 10000;
      usd.montoCLP += extra * aCLP('USD', usd.precio);
      sobra -= extra * aCLP('USD', usd.precio);
    }
  }

  const rojos = [...enRojo];
  if (rojos.length && !protege) {
    notas.push(`${rojos.join(' y ')} ${rojos.length > 1 ? 'están' : 'está'} en rojo (bajo su media de 200 días). Se compra igual, más barato: a 10 años o más, dejar de comprar en rojo costó rentabilidad. Si prefieres protegerte, cámbialo en tu perfil.`);
  }
  const resultados = ordenes.filter(o => o.proximosResultados && diasEntre(hoy, o.proximosResultados) >= 0 && diasEntre(hoy, o.proximosResultados) <= 7);
  if (resultados.length) {
    notas.push(`Entrega${resultados.length > 1 ? 'n' : ''} resultados esta semana: ${resultados.map(o => `${sinSufijo(o.ticker)} (${o.proximosResultados!.slice(8, 10)}-${o.proximosResultados!.slice(5, 7)})`).join(', ')}. El precio puede moverse fuerte ese día; el método no espera resultados para comprar.`);
  }
  if (satelite === 0 && monto > 0) notas.push('Tu perfil es conservador: todo el aporte va al índice. Si quieres sumar las ideas del Top, revisa tu perfil.');

  const invertidoCLP = ordenes.reduce((s, o) => s + o.montoCLP, 0);
  const top = ordenes.filter(o => o.papel === 'top');
  const resumen = !ordenes.length
    ? 'No hay compras posibles con este monto hoy.'
    : `${fmtMoney(invertidoCLP, 'CLP')}: ${ordenes.filter(o => o.papel === 'nucleo').map(o => `${sinSufijo(o.ticker)} ${fmtMoney(o.montoCLP, 'CLP')}`).join(' + ') || 'sin índice'}${top.length ? ` + Top: ${top.map(o => sinSufijo(o.ticker)).join(', ')}` : ''}.`;

  return {
    montoCLP: monto, nivel, satelite, chileCLP, eeuuCLP,
    ordenes: ordenes.sort((a, b) => (a.papel === b.papel ? b.montoCLP - a.montoCLP : a.papel === 'nucleo' ? -1 : 1)),
    invertidoCLP, sinInvertirCLP: Math.max(0, monto - invertidoCLP),
    descartadas: descartadas.filter((d, i, arr) => arr.findIndex(x => x.ticker === d.ticker) === i),
    evidencia: { top: { 'EE.UU.': evidenciaTop('EE.UU.') ?? undefined, Chile: evidenciaTop('Chile') ?? undefined }, nucleo: evidenciaNucleo() },
    notas, resumen,
  };
}

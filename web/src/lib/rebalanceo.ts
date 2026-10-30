import { LIMITE_SECTOR, fmtMoney, limiteDe, type AdvisorReport, type AssetReport, type RiskModel } from './advisor';
import { evidencia, mercadoDe } from './evidencia';
import { FONDOS_CHILE } from './fundamentals';
import { planPurchases } from './optimizer';
import { META_CHILE_DEFECTO } from './perfil';
import { supabase } from './supabase';

// Rebalanceo completo de la cartera: vende lo que las reglas del asesor dicen que sobra y reinvierte lo obtenido con el
// optimizador de compras. Se vende solo por cuatro razones, en este orden:
//   1. Señal REDUCIR con evidencia significativa en su mercado (se vende todo).
//   2. Una empresa o fondo sobre su máximo prudente (20% / 40%, contando lo que hay dentro de tus fondos).
//   3. Un sector sobre 35% del patrimonio (contando los fondos).
//   4. Chile sobre la meta del inversionista (60% si no eligió otra).
// En 2 a 4 se vende hasta quedar 2 puntos dentro del límite, para que un vaivén del precio no obligue a vender de nuevo,
// recortando primero las posiciones más grandes (menos órdenes y menos concentración). Lo vendido no se recompra en el
// mismo grupo que se está reduciendo. Además entrega, para cada activo, los precios en que cambiaría la decisión: lo
// que vigila el agente que avisa por Telegram (scripts/agente-cartera.ts).

const MARGEN = 0.02;
const HOLGURA_LIMITE = 0.005; // el precio límite queda 0,5% peor que el último: se ejecuta, pero sin regalar el precio
const MIN_VENTA_CLP = 10000;
const MIN_VENTA_PCT = 0.005;
const ALZA_MAXIMA_NIVEL = 0.5; // un nivel de recorte que exige subir más de 50% no se informa

export type Lado = 'VENDER' | 'COMPRAR';

export interface OrdenRebalanceo {
  ticker: string;
  nombre?: string;
  lado: Lado;
  origen: 'EN_CARTERA' | 'OPORTUNIDAD';
  moneda: 'USD' | 'CLP';
  cantidad: number;
  todo: boolean; // vende la posición completa
  precio: number; // último precio, en la moneda del activo
  limite: number; // precio límite sugerido para la orden
  montoCLP: number;
  pesoAntes: number;
  pesoDespues: number;
  motivo: string;
}

export interface NivelPrecio {
  ticker: string;
  moneda: 'USD' | 'CLP';
  precio: number;
  tipo: 'venta_tendencia' | 'recorte_concentracion';
  nivel: number;
  distancia: number; // nivel / precio - 1
  texto: string;
}

export interface Postura {
  ticker: string;
  nombre?: string;
  moneda: 'USD' | 'CLP';
  precio: number;
  peso: number;
  accion: 'VENDER' | 'VENDER PARTE' | 'COMPRAR' | 'MANTENER';
  accionAsesor: AssetReport['accion'];
  motivo: string;
}

export interface Foto {
  chile: number;
  sector: { nombre: string; peso: number } | null;
}

export interface PlanRebalanceo {
  generado: string;
  usdClp: number;
  valorCLP: number;
  metaChile: number;
  ventas: OrdenRebalanceo[];
  compras: OrdenRebalanceo[];
  ventasCLP: number;
  comprasCLP: number;
  aporteCLP: number;
  sinInvertirCLP: number;
  motivoSinInvertir: string | null;
  antes: Foto;
  despues: Foto;
  niveles: NivelPrecio[];
  posturas: Postura[];
  excluidosCompra: { ticker: string; motivo: string }[];
  notas: string[];
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
// Un precio con la precisión con que cotiza: centavos bajo $1.000 (fmtMoney redondea los pesos)
export const fmtPrecio = (n: number, moneda: 'USD' | 'CLP') => (moneda === 'CLP' && n < 1000
  ? `$${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : fmtMoney(n, moneda));
const SIN_SECTOR = new Set(['Fondos sin detalle', 'Sin clasificar']);

// Tres ideas de EE.UU. y dos de Chile del último escaneo del bot, cada lista por su propio criterio
interface Candidato { ticker?: unknown; score?: unknown }
export async function oportunidadesDelBot(nUs = 3, nCl = 2): Promise<string[]> {
  const { data } = await supabase
    .from('analisis_ia')
    .select('us:candidatos_json->us, cl:candidatos_json->cl')
    .order('fecha', { ascending: false })
    .limit(1);
  const mejores = (lista: unknown, n: number) => ((Array.isArray(lista) ? lista : []) as Candidato[])
    .filter((c): c is { ticker: string; score: number } => typeof c?.ticker === 'string' && typeof c?.score === 'number')
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(c => c.ticker.toUpperCase());
  const fila = data?.[0] as { us?: unknown; cl?: unknown } | undefined;
  return [...mejores(fila?.us, nUs), ...mejores(fila?.cl, nCl)];
}

export function precioLimite(precio: number, moneda: 'USD' | 'CLP', lado: Lado): number {
  const x = precio * (lado === 'VENDER' ? 1 - HOLGURA_LIMITE : 1 + HOLGURA_LIMITE);
  // Pesos enteros desde $1.000 (múltiplo de cualquier tick de la bolsa); bajo eso, centavos
  const paso = moneda === 'CLP' && precio >= 1000 ? 1 : 0.01;
  const pasos = lado === 'VENDER' ? Math.floor(x / paso + 1e-9) : Math.ceil(x / paso - 1e-9);
  return Number((pasos * paso).toFixed(2));
}

// Reduce los valores más altos hasta un nivel común, hasta juntar `monto` (o lo que haya)
function recortarArriba(valores: { ticker: string; valor: number }[], monto: number): Map<string, number> {
  const orden = valores.filter(v => v.valor > 0).sort((a, b) => b.valor - a.valor);
  const cortes = new Map<string, number>();
  if (monto <= 0 || !orden.length) return cortes;
  let nivel = 0;
  let acumulado = 0;
  for (let k = 0; k < orden.length; k++) {
    const siguiente = orden[k + 1]?.valor ?? 0;
    const capacidad = (orden[k].valor - siguiente) * (k + 1);
    if (acumulado + capacidad >= monto) {
      nivel = orden[k].valor - (monto - acumulado) / (k + 1);
      break;
    }
    acumulado += capacidad;
  }
  for (const v of orden) if (v.valor > nivel) cortes.set(v.ticker, v.valor - nivel);
  return cortes;
}

export function planRebalanceo(
  report: AdvisorReport,
  modelo: RiskModel,
  { metaChile = META_CHILE_DEFECTO, aporteCLP = 0, fraccionar = true }: { metaChile?: number; aporteCLP?: number; fraccionar?: boolean } = {},
): PlanRebalanceo {
  const V = report.resumen.valorCLP;
  const usdClp = report.usdClp;
  const pos = report.posiciones;
  const aCLP = (a: { moneda: 'USD' | 'CLP' }, n: number) => (a.moneda === 'USD' ? n * usdClp : n);
  const operable = (a: AssetReport) => a.conDatos && a.cantidad > 0 && a.precio > 0;
  const individual = (a: AssetReport) => operable(a) && !a.diversificado;
  const sectorDe = (a: AssetReport) => a.sector ?? FONDOS_CHILE[a.ticker]?.sector ?? 'Sin clasificar'; // como en la exposición

  // --- Ventas, en pesos -------------------------------------------------------------------------------------------
  const venta = new Map<string, { clp: number; motivos: string[]; evidencia: boolean }>();
  const vendidoCLP = (t: string) => venta.get(t)?.clp ?? 0;
  const vender = (a: AssetReport, clp: number, motivo: string, porEvidencia = false) => {
    const x = venta.get(a.ticker) ?? { clp: 0, motivos: [], evidencia: false };
    const monto = Math.min(clp, a.valorCLP - x.clp);
    if (monto <= 1) return;
    x.clp += monto;
    x.evidencia ||= porEvidencia;
    if (!x.motivos.includes(motivo)) x.motivos.push(motivo);
    venta.set(a.ticker, x);
  };

  // 1. Señal REDUCIR por evidencia (no por concentración, que se trata en 2)
  for (const a of pos) {
    if (operable(a) && a.accion === 'REDUCIR' && a.riesgo.veredicto !== 'excedido') {
      vender(a, a.valorCLP, (a.motivos[0] ?? 'Señal REDUCIR del asesor.').replace(/\.$/, ''), true);
    }
  }
  // 2. Concentración en una empresa o fondo
  for (const a of pos) {
    if (!operable(a) || a.riesgo.veredicto !== 'excedido') continue;
    const limite = limiteDe(a);
    vender(a, (a.pesoEfectivo - (limite - MARGEN)) * V,
      `Pesa ${pct(a.pesoEfectivo)} de tu patrimonio${a.pesoEfectivo > a.peso + 0.005 ? ' contando tus fondos' : ''}, sobre el máximo de ${pct(limite, 0)}`);
  }
  // 3. Sectores sobre el límite
  const sectoresAntes = report.exposicion.sectores.filter(s => !SIN_SECTOR.has(s.nombre));
  const sectorTras = (nombre: string) => {
    const s = sectoresAntes.find(x => x.nombre === nombre);
    if (!s) return 0;
    return s.peso - pos.filter(a => !a.diversificado && sectorDe(a) === nombre).reduce((acc, a) => acc + vendidoCLP(a.ticker), 0) / V;
  };
  const sectoresReducidos = new Set<string>();
  for (const s of sectoresAntes) {
    if (s.peso <= LIMITE_SECTOR) continue;
    sectoresReducidos.add(s.nombre);
    const exceso = (sectorTras(s.nombre) - (LIMITE_SECTOR - MARGEN)) * V;
    const del = pos.filter(a => individual(a) && sectorDe(a) === s.nombre);
    const cortes = recortarArriba(del.map(a => ({ ticker: a.ticker, valor: a.valorCLP - vendidoCLP(a.ticker) })), exceso);
    for (const a of del) {
      const c = cortes.get(a.ticker);
      if (c) vender(a, c, `${s.nombre} pesa ${pct(s.peso, 0)} de tu patrimonio contando tus fondos, sobre el máximo de ${pct(LIMITE_SECTOR, 0)}`);
    }
  }
  // 4. Chile sobre la meta: se recortan las acciones y fondos chilenos individuales; el fondo del IPSA, que es la forma
  //    diversificada de tener Chile, se mantiene
  const chileAntes = report.exposicion.regiones.find(r => r.nombre === 'Chile')?.peso ?? 0;
  const chileTras = () => chileAntes - pos.filter(a => a.moneda === 'CLP').reduce((acc, a) => acc + vendidoCLP(a.ticker), 0) / V;
  if (chileAntes > metaChile) {
    const exceso = (chileTras() - (metaChile - MARGEN)) * V;
    const chilenas = pos.filter(a => individual(a) && a.moneda === 'CLP');
    const cortes = recortarArriba(chilenas.map(a => ({ ticker: a.ticker, valor: a.valorCLP - vendidoCLP(a.ticker) })), exceso);
    for (const a of chilenas) {
      const c = cortes.get(a.ticker);
      if (c) vender(a, c, `Chile es ${pct(chileAntes, 0)} de tu patrimonio y tu meta es hasta ${pct(metaChile, 0)}`);
    }
  }

  // A unidades: acciones chilenas enteras; en EE.UU. fracciones si el corredor las acepta. Las ventas parciales chicas
  // no valen la comisión; las de una señal con evidencia se hacen igual.
  const minVenta = Math.max(MIN_VENTA_CLP, MIN_VENTA_PCT * V);
  const ventas: OrdenRebalanceo[] = [];
  for (const a of pos) {
    const v = venta.get(a.ticker);
    if (!v) continue;
    const precioCLP = aCLP(a, a.precio);
    const fraccional = fraccionar && a.moneda === 'USD';
    let cantidad = fraccional ? Math.floor((v.clp / precioCLP) * 10000) / 10000 : Math.round(v.clp / precioCLP);
    const todo = cantidad >= a.cantidad * 0.98;
    if (todo) cantidad = a.cantidad;
    if (cantidad <= 0 || (!todo && !v.evidencia && cantidad * precioCLP < minVenta)) {
      venta.delete(a.ticker);
      continue;
    }
    const montoCLP = cantidad * precioCLP;
    ventas.push({
      ticker: a.ticker, nombre: a.nombre, lado: 'VENDER', origen: 'EN_CARTERA', moneda: a.moneda,
      cantidad, todo, precio: a.precio, limite: precioLimite(a.precio, a.moneda, 'VENDER'), montoCLP,
      pesoAntes: a.peso, pesoDespues: 0, motivo: `${v.motivos.join('. ')}.`,
    });
  }
  const vendidas = new Map(ventas.map(o => [o.ticker, o]));
  const ventasCLP = ventas.reduce((s, o) => s + o.montoCLP, 0);

  // --- Compras con lo vendido (y el aporte, si hay) ---------------------------------------------------------------
  const tras = pos.map(a => {
    const o = vendidas.get(a.ticker);
    if (!o) return a;
    const valorCLP = Math.max(0, a.valorCLP - o.montoCLP);
    return { ...a, cantidad: Math.max(0, a.cantidad - o.cantidad), valorCLP, peso: V > 0 ? valorCLP / V : 0 };
  });
  const chileDespuesVentas = V > 0 ? tras.filter(a => a.moneda === 'CLP').reduce((s, a) => s + a.valorCLP, 0) / V : 0;
  const chileLleno = chileDespuesVentas >= metaChile - MARGEN;
  const sectorLleno = (nombre: string) => sectoresReducidos.has(nombre) || (sectoresAntes.find(s => s.nombre === nombre)?.peso ?? 0) >= LIMITE_SECTOR - MARGEN;
  const excluir = (a: AssetReport): string | null => {
    if (vendidas.has(a.ticker)) return 'Se vende en este rebalanceo.';
    if (a.moneda === 'CLP' && chileLleno) return `Chile queda en ${pct(chileDespuesVentas, 0)} de tu patrimonio (meta hasta ${pct(metaChile, 0)}): lo vendido se invierte fuera de Chile.`;
    if (!a.diversificado && sectorLleno(sectorDe(a))) return `${sectorDe(a)} ya está en su máximo de ${pct(LIMITE_SECTOR, 0)}: no se suma más de ese sector.`;
    // Lo vendido no va a posiciones sin respaldo para crecer (la paridad de riesgo sola llenaría las más chicas)
    if (a.accion !== 'AUMENTAR') return `Su señal es ${a.accion}: el rebalanceo solo compra lo que tiene señal AUMENTAR.`;
    return null;
  };
  const presupuesto = ventasCLP + Math.max(0, aporteCLP);
  const reportTras: AdvisorReport = { ...report, posiciones: tras, resumen: { ...report.resumen, valorCLP: V - ventasCLP } };
  const planCompra = presupuesto > 0
    ? planPurchases(reportTras, modelo, presupuesto, 'CLP', { fraccionar, excluir })
    : { recommendations: [], totalCost: 0, sinAsignar: 0, motivoSinAsignar: null, excluidos: [] };

  const porTicker = new Map([...pos, ...report.candidatos].map(a => [a.ticker, a]));
  const compradoCLP = new Map(planCompra.recommendations.map(o => [o.ticker, o.expectedCost]));
  const totalDespues = V + Math.max(0, aporteCLP);
  const valorFinal = (t: string) => (porTicker.get(t)?.valorCLP ?? 0) - (vendidas.get(t)?.montoCLP ?? 0) + (compradoCLP.get(t) ?? 0);
  const compras: OrdenRebalanceo[] = planCompra.recommendations.map(o => {
    const a = porTicker.get(o.ticker)!;
    return {
      ticker: o.ticker, nombre: o.nombre, lado: 'COMPRAR', origen: o.origen, moneda: a.moneda,
      cantidad: o.sharesToBuy, todo: false, precio: a.precio, limite: precioLimite(a.precio, a.moneda, 'COMPRAR'),
      montoCLP: o.expectedCost, pesoAntes: a.peso, pesoDespues: valorFinal(o.ticker) / totalDespues, motivo: o.rationale,
    };
  });
  for (const o of ventas) o.pesoDespues = valorFinal(o.ticker) / totalDespues;
  const comprasCLP = compras.reduce((s, o) => s + o.montoCLP, 0);

  // --- Antes y después --------------------------------------------------------------------------------------------
  const sectorMayor = sectoresAntes[0] ?? null;
  const despuesSector = sectorMayor
    ? (sectorMayor.peso * V
      - pos.filter(a => !a.diversificado && sectorDe(a) === sectorMayor.nombre).reduce((s, a) => s + (vendidas.get(a.ticker)?.montoCLP ?? 0), 0)
      + compras.filter(o => { const a = porTicker.get(o.ticker); return a && !a.diversificado && sectorDe(a) === sectorMayor.nombre; }).reduce((s, o) => s + o.montoCLP, 0)) / totalDespues
    : 0;
  const chileDespues = (chileAntes * V - ventas.filter(o => o.moneda === 'CLP').reduce((s, o) => s + o.montoCLP, 0)
    + compras.filter(o => o.moneda === 'CLP').reduce((s, o) => s + o.montoCLP, 0)) / totalDespues;

  // --- Niveles de precio que cambian la decisión ------------------------------------------------------------------
  const niveles: NivelPrecio[] = [];
  for (const a of pos) {
    const o = vendidas.get(a.ticker);
    if (!operable(a) || o?.todo) continue;
    const mercado = mercadoDe(a.moneda);
    // Tendencia: solo donde el laboratorio midió que el veredicto bajista anticipa peores retornos (hoy, Chile).
    // El momentum 12-1 no incluye el último mes, así que el precio de hoy solo mueve la parte de la media de 200 días.
    const ev = evidencia('veredicto_bajista', mercado, -1, 'Tendencia y momentum en contra');
    if (!a.diversificado && a.tipo === 'accion' && ev.decide && a.sma200 && a.momentum !== null && a.momentum <= 0.05) {
      const nivel = (a.momentum < -0.05 ? 1.03 : 0.97) * a.sma200;
      if (a.precio > nivel) {
        niveles.push({
          ticker: a.ticker, moneda: a.moneda, precio: a.precio, tipo: 'venta_tendencia', nivel, distancia: nivel / a.precio - 1,
          texto: `Vender si cierra bajo ${fmtPrecio(nivel, a.moneda)} (${pct(nivel / a.precio - 1)}): ahí su tendencia pasa a bajista${a.momentum < -0.05 ? ' (su momentum de 12 meses ya es negativo)' : ''}, y en ${mercado} las acciones así rindieron menos que su mercado (evidencia sólida).`,
        });
      }
    }
    // Concentración: el precio al que pasaría su máximo prudente (contando lo que hay dentro de tus fondos)
    const w = a.pesoEfectivo;
    const limite = limiteDe(a);
    if (!o && w > 0 && w < limite) {
      const alza = (limite * (1 - w)) / (w * (1 - limite)) - 1;
      if (alza <= ALZA_MAXIMA_NIVEL) {
        const nivel = a.precio * (1 + alza);
        niveles.push({
          ticker: a.ticker, moneda: a.moneda, precio: a.precio, tipo: 'recorte_concentracion', nivel, distancia: alza,
          texto: `Recortar si sube sobre ${fmtPrecio(nivel, a.moneda)} (+${pct(alza)}): ahí pasaría el máximo de ${pct(limite, 0)} de tu patrimonio${a.diversificado ? ' para un fondo' : ' para una empresa'}.`,
        });
      }
    }
  }
  niveles.sort((x, y) => Math.abs(x.distancia) - Math.abs(y.distancia));

  // --- Postura por activo -----------------------------------------------------------------------------------------
  const compradas = new Map(compras.map(o => [o.ticker, o]));
  const posturas: Postura[] = pos.map(a => {
    const v = vendidas.get(a.ticker);
    const c = compradas.get(a.ticker);
    return {
      ticker: a.ticker, nombre: a.nombre, moneda: a.moneda, precio: a.precio, peso: a.peso, accionAsesor: a.accion,
      accion: v ? (v.todo ? 'VENDER' : 'VENDER PARTE') : c ? 'COMPRAR' : 'MANTENER',
      motivo: v?.motivo ?? c?.motivo ?? a.motivos[0] ?? '',
    };
  });

  // --- Notas ------------------------------------------------------------------------------------------------------
  const notas: string[] = [];
  if (ventas.length || compras.length) {
    notas.push('Usa órdenes límite al precio indicado (0,5% bajo el último para vender y sobre él para comprar): se ejecutan, pero si el precio salta no vendes muy barato ni compras muy caro. La bolsa de Santiago opera de 9:30 a 16:00 y la de Nueva York de 9:30 a 16:00 hora de Nueva York.');
  }
  if (ventas.some(o => o.moneda === 'CLP') && compras.some(o => o.moneda === 'USD')) {
    notas.push('Lo que vendes en Chile queda en pesos: para comprar lo de EE.UU. hay que pasarlo a dólares en tu corredora, lo que tiene un costo de cambio. Primero vende y después compra.');
  }
  if (ventas.length) notas.push('Vender con ganancia puede pagar impuesto a la renta y cada orden puede cobrar comisión: revisa tu caso antes de ejecutar.');
  if (ventas.length || compras.length) notas.push('Cuando una orden se ejecute, regístrala con su botón Registrar (lo que de verdad se hizo): tu cartera guardada se actualiza y el agente la revisa así.');
  const chicas = pos.filter(a => a.peso < 0.01 && !vendidas.has(a.ticker));
  if (chicas.length >= 3) notas.push(`Opcional: ${chicas.map(a => a.ticker).join(', ')} pesan menos de 1% cada una. Venderlas simplifica la cartera, pero no cambia su riesgo; por eso no están en el plan.`);
  if (!ventas.length && !compras.length) notas.push('Tu cartera está dentro de sus límites y ninguna posición tiene una señal de venta con evidencia: no hay nada que rebalancear hoy.');

  const sinInvertirCLP = Math.max(0, presupuesto - comprasCLP);
  return {
    generado: report.generado,
    usdClp,
    valorCLP: V,
    metaChile,
    ventas: ventas.sort((x, y) => y.montoCLP - x.montoCLP),
    compras,
    ventasCLP,
    comprasCLP,
    aporteCLP: Math.max(0, aporteCLP),
    sinInvertirCLP,
    motivoSinInvertir: sinInvertirCLP > Math.max(MIN_VENTA_CLP, 0.01 * presupuesto) ? planCompra.motivoSinAsignar : null,
    antes: { chile: chileAntes, sector: sectorMayor ? { nombre: sectorMayor.nombre, peso: sectorMayor.peso } : null },
    despues: { chile: chileDespues, sector: sectorMayor ? { nombre: sectorMayor.nombre, peso: despuesSector } : null },
    niveles,
    posturas,
    excluidosCompra: planCompra.excluidos.filter(e => !vendidas.has(e.ticker)),
    notas,
  };
}

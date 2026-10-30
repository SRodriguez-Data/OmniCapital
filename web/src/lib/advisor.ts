import {
  alignedReturns, annualVol, correlation, dimsonBeta, dot, expectedShortfall, historicalVaR, ledoitWolfConstantCorrelation,
  matVec, maxDrawdown, momentum, neweyWestCov, neweyWestVariance, periodReturn, returns, rsi as rsiOf, shrinkCov, sma,
  valueOn, volatilityStop, TRADING_DAYS,
} from './quant';
import {
  BENCH_CL, BENCH_GLOBAL, BENCH_US, FX_TICKER, dailyHistory, dolarObservado, liveQuotes, riskFreeRateClp,
  type DailyHistory, type LiveQuote,
} from './marketData';
import { ETF_CONOCIDOS, FONDOS_CHILE, fundamentales, type Fundamentales, type TipoActivo } from './fundamentals';
import { contextoMercado, type ContextoMercado } from './mercado';
import { adecuacion, metaChileDe, type Adecuacion, type PerfilInversionista } from './perfil';
import { evidencia, mercadoDe, type Evidencia, type Mercado } from './evidencia';
import { supabase } from './supabase';

// Motor de recomendaciones: todas las cifras salen de datos reales (precios ajustados por dividendos,
// fundamentales y consenso de analistas de Yahoo Finance) y las decisiones de reglas explícitas en cuatro
// pilares: técnico, fundamental, riesgo dentro de la cartera y contexto de mercado. La IA solo redacta.

export interface HoldingInput {
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date?: string | null;
}

export type Accion = 'AUMENTAR' | 'MANTENER' | 'REDUCIR';
export type Conviccion = 'alta' | 'media' | 'baja';

export interface Pilar<V extends string> {
  veredicto: V;
  motivos: string[];
}
export type VeredictoTecnico = 'alcista' | 'neutral' | 'bajista' | 'quiebre' | 'sin datos';
export type VeredictoFundamental = 'favorable' | 'neutral' | 'débil' | 'sin datos';
export type VeredictoRiesgo = 'holgado' | 'cerca del límite' | 'excedido';

export interface AssetReport {
  ticker: string;
  nombre?: string;
  tipo: TipoActivo;
  sector?: string;
  moneda: 'USD' | 'CLP';
  cantidad: number;
  costoPromedio: number;
  precio: number;
  valorCLP: number;
  peso: number;
  pesoEfectivo: number; // incluye lo que tienes de esta empresa dentro de tus fondos
  pnl: number | null; // en la moneda del activo
  ret1y: number | null; // incluye dividendos
  ret3y: number | null; // anual, incluye dividendos
  momentum: number | null; // 12-1 (o 6-1 con menos historia)
  momentumMeses: 12 | 6 | null;
  vol: number | null;
  maxDD: number | null;
  beta: number | null;
  benchmark: string;
  rsi: number | null;
  sma200: number | null;
  distSma200: number | null;
  stop: number | null;
  stopDist: number | null;
  stopActivado: boolean; // dos cierres seguidos bajo el stop
  diversificado: boolean;
  aporteRiesgo: number | null; // fracción del riesgo total del portafolio
  fundamentales: Fundamentales | null;
  tecnico: Pilar<VeredictoTecnico>;
  fundamental: Pilar<VeredictoFundamental>;
  riesgo: Pilar<VeredictoRiesgo>;
  accion: Accion;
  conviccion: Conviccion;
  puntaje: number;
  motivos: string[]; // los que deciden la acción
  evidencia: Evidencia[]; // lo que midió el laboratorio sobre las reglas que aplican a este activo
  conDatos: boolean;
  gemeloDe?: string; // activo casi idéntico de mayor peso donde conviene concentrar las compras
}

export interface Hallazgo {
  nivel: 'alerta' | 'atencion' | 'ok';
  titulo: string;
  detalle: string;
}

export interface Exposicion {
  regiones: { nombre: string; peso: number }[];
  sectores: { nombre: string; peso: number; via: string[] }[];
  empresas: { ticker: string; directo: number; viaFondos: number; total: number; fondos: string[] }[];
  notas: string[];
}

export interface PortfolioSummary {
  valorCLP: number;
  costoCLP: number;
  pnlCLP: number;
  pnlPct: number | null;
  pesoUSD: number;
  // Riesgo y retorno con los pesos actuales, en pesos chilenos y con dividendos
  vol: number | null;
  maxDD: number | null;
  ret1y: number | null;
  retAnualVentana: number | null; // rentabilidad anual en toda la ventana de riesgo
  sharpe: number | null;
  var95: number | null; // pérdida diaria como fracción
  var95CLP: number | null;
  es95: number | null;
  es95CLP: number | null;
  diversificacion: number | null; // suma de riesgos individuales / riesgo del portafolio
  posicionesEfectivas: number | null; // número de apuestas independientes según su aporte al riesgo
  riesgoCambiario: number | null; // parte del riesgo que viene del dólar
  cobertura: number; // parte del valor con historial confiable para medir riesgo
  ventanaAnios: number; // años de historia usados para el riesgo
  encogimiento: number | null; // intensidad de Ledoit-Wolf aplicada a la covarianza
  sinFechaUSD: { posiciones: number; peso: number };
  indice: { nombre: string; ret1y: number; diferencia: number | null; trackingError: number | null } | null;
  perfil: string | null;
  diasHistoria: number;
}

export interface AdvisorReport {
  generado: string;
  usdClp: number;
  tasaLibreRiesgo: number;
  resumen: PortfolioSummary;
  mercado: ContextoMercado | null;
  exposicion: Exposicion;
  estrategia: string[];
  hallazgos: Hallazgo[];
  posiciones: AssetReport[];
  candidatos: AssetReport[];
  avisosDatos: string[];
  perfilInversionista: (Adecuacion & { perfil: PerfilInversionista }) | null;
}

// Covarianza anual en pesos de los activos con historial completo (portafolio y candidatos)
export interface RiskModel {
  tickers: string[];
  cov: number[][];
}

export const LIMITE_ACCION = 0.2; // peso máximo prudente de una empresa individual (contando lo que hay dentro de tus fondos)
export const LIMITE_FONDO = 0.4; // y de un fondo diversificado
export const LIMITE_SECTOR = 0.35;
export const limiteDe = (a: { diversificado: boolean }) => (a.diversificado ? LIMITE_FONDO : LIMITE_ACCION);
const GEMELOS_CORR = 0.9;
// Los ETF apalancados o inversos no son diversificación de largo plazo
const APALANCADO = /\b(2x|3x|leveraged|inverse|bear|bull|ultrapro|ultrashort)\b|\bProShares Ultra\b/i;
const APALANCADOS = new Set(['TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXL', 'SPXS', 'SPXU', 'TNA', 'TZA', 'LABU', 'LABD', 'FNGU', 'UVXY', 'SVXY']);

// Fondos globales: parte aproximada en EE.UU. (el resto, otros países)
const PESO_EEUU_FONDOS: Record<string, number> = { VT: 0.62, ACWI: 0.63, VXUS: 0, VEA: 0, VWO: 0, IEMG: 0, EEM: 0, EFA: 0, IEFA: 0, ECH: 0 };
const PAISES: Record<string, string> = { 'United States': 'EE.UU.', Chile: 'Chile' };
// Composición referencial y aproximada del IPSA (Yahoo no informa lo que tiene el ETF It Now IPSA), para ver
// cuánto tienes de cada empresa y sector chileno contando lo que hay dentro del fondo
const IPSA_EMPRESAS: Record<string, number> = {
  'CHILE.SN': 0.10, 'SQM-B.SN': 0.09, 'BSANTANDER.SN': 0.08, 'LTM.SN': 0.07, 'FALABELLA.SN': 0.06, 'CENCOSUD.SN': 0.05,
  'COPEC.SN': 0.05, 'BCI.SN': 0.05, 'ENELCHILE.SN': 0.04, 'ITAUCL.SN': 0.03, 'CMPC.SN': 0.03, 'QUINENCO.SN': 0.03,
  'ENELAM.SN': 0.03, 'PARAUCO.SN': 0.03, 'MALLPLAZA.SN': 0.03, 'IAM.SN': 0.01, 'ILC.SN': 0.01,
};
const IPSA_SECTORES: Record<string, number> = {
  Financiero: 0.27, Materiales: 0.135, 'Servicios básicos': 0.13, Industrial: 0.12, 'Consumo básico': 0.115,
  Inmobiliario: 0.085, 'Consumo discrecional': 0.075, Energía: 0.05, Comunicaciones: 0.015, Tecnología: 0.005,
};
// Mercado de referencia para comparar valoraciones si Yahoo no responde
const PER_REFERENCIA = { CLP: 12, USD: 22 };

const DAY_MS = 24 * 60 * 60 * 1000;
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${pct(x)}`;
export const fmtMoney = (n: number, moneda: 'USD' | 'CLP') => moneda === 'CLP'
  ? `$${Math.round(n).toLocaleString('es-CL')}`
  : `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Position {
  ticker: string;
  moneda: 'USD' | 'CLP';
  cantidad: number;
  costoNativo: number;
  lotes: { cantidad: number; precio: number; fecha?: string | null }[];
}

function groupByTicker(items: HoldingInput[]): Position[] {
  const map = new Map<string, Position>();
  for (const i of items) {
    const p = map.get(i.ticker) ?? { ticker: i.ticker, moneda: i.moneda, cantidad: 0, costoNativo: 0, lotes: [] };
    p.cantidad += i.cantidad;
    p.costoNativo += i.cantidad * i.precio_compra;
    p.lotes.push({ cantidad: i.cantidad, precio: i.precio_compra, fecha: i.purchase_date });
    map.set(i.ticker, p);
  }
  return [...map.values()];
}

// --- Pilares ---------------------------------------------------------------------------------------

interface DatosTecnicos {
  conDatos: boolean;
  sinDatosMotivo?: string;
  distSma200: number | null;
  momentum: number | null;
  momentumMeses: 12 | 6 | null;
  rsi: number | null;
  stop: number | null;
  stopActivado: boolean;
  moneda: 'USD' | 'CLP';
}

// Tendencia con banda de ±3% sobre la media de 200 días (evita cambiar de opinión por ruido) y momentum 12-1,
// ambos con precios ajustados por dividendos. El RSI se describe junto con lo que midió el laboratorio.
function pilarTecnico(t: DatosTecnicos, mercado: Mercado): { pilar: Pilar<VeredictoTecnico>; evid: Evidencia[] } {
  if (!t.conDatos) return { pilar: { veredicto: 'sin datos', motivos: [t.sinDatosMotivo ?? 'No hay historial de precios suficiente para evaluar la tendencia.'] }, evid: [] };
  const motivos: string[] = [];
  const evid: Evidencia[] = [];
  let votos = 0;
  if (t.distSma200 !== null) {
    if (t.distSma200 > 0.03) { votos++; motivos.push(`Cotiza ${pct(t.distSma200)} sobre su media de 200 días: tendencia de largo plazo alcista.`); }
    else if (t.distSma200 < -0.03) { votos--; motivos.push(`Cotiza ${pct(-t.distSma200)} bajo su media de 200 días: tendencia de largo plazo bajista.`); }
    else motivos.push(`Cotiza junto a su media de 200 días (${signed(t.distSma200)}): sin tendencia definida.`);
  }
  if (t.momentum !== null) {
    if (t.momentum > 0.05) votos++;
    else if (t.momentum < -0.05) votos--;
    motivos.push(`Momentum ${t.momentumMeses}-1 meses (con dividendos): ${signed(t.momentum)}.`);
  }
  if (t.rsi !== null && t.rsi < 30) {
    motivos.push(`RSI ${t.rsi.toFixed(0)}: caída fuerte de corto plazo.`);
    if (t.distSma200 !== null && t.distSma200 > 0.03) evid.push(evidencia('rsi30_alcista', mercado, 1, 'Comprar con RSI bajo 30 en tendencia alcista'));
    else if (t.distSma200 !== null && t.distSma200 < -0.03) evid.push(evidencia('rsi30_bajista', mercado, 1, 'Comprar con RSI bajo 30 en tendencia bajista'));
  } else if (t.rsi !== null && t.rsi > 70) {
    motivos.push(`RSI ${t.rsi.toFixed(0)}: subió fuerte en el corto plazo.`);
    evid.push(evidencia('rsi70', mercado, -1, 'RSI sobre 70 como aviso de una baja'));
  }
  if (t.stopActivado && t.stop !== null) {
    motivos.push(`Cerró dos días seguidos bajo su stop de volatilidad (${fmtMoney(t.stop, t.moneda)}): cayó desde su máximo del último mes más de 2 desviaciones estándar mensuales.`);
    return { pilar: { veredicto: 'quiebre', motivos }, evid };
  }
  return { pilar: { veredicto: votos >= 1 ? 'alcista' : votos <= -1 ? 'bajista' : 'neutral', motivos }, evid };
}

// Lo que midió el laboratorio sobre el veredicto técnico en el mercado del activo
function evidenciaVeredicto(v: VeredictoTecnico, mercado: Mercado): Evidencia | null {
  if (v === 'alcista') return evidencia('veredicto_alcista', mercado, 1, 'Tendencia y momentum a favor');
  if (v === 'bajista') return evidencia('veredicto_bajista', mercado, -1, 'Tendencia y momentum en contra');
  if (v === 'quiebre') return evidencia('stop_roto', mercado, -1, 'Romper el stop de volatilidad');
  return null;
}

// Valoración frente a su mercado, rentabilidad, crecimiento, salud del dividendo y consenso de analistas.
function pilarFundamental(f: Fundamentales | null, tipo: TipoActivo, perMercado: number, moneda: 'USD' | 'CLP'): Pilar<VeredictoFundamental> {
  if (!f) return { veredicto: 'sin datos', motivos: ['Yahoo Finance no tiene datos fundamentales de este activo.'] };
  const motivos: string[] = [];
  let puntos = 0;
  let datos = 0;
  const mercado = moneda === 'CLP' ? 'la bolsa chilena' : 'el S&P 500';

  if (tipo === 'accion') {
    if (f.per !== undefined) {
      datos++;
      const rel = f.per / perMercado;
      if (rel < 0.8) { puntos++; motivos.push(`Barata frente a ${mercado}: PER ${f.per.toFixed(1)} vs. ${perMercado.toFixed(1)}.`); }
      else if (rel > 1.6 && (f.crecimientoUtilidad ?? 0) < 0.2) { puntos--; motivos.push(`Cara frente a ${mercado} (PER ${f.per.toFixed(1)} vs. ${perMercado.toFixed(1)}) sin un crecimiento que lo justifique.`); }
      else motivos.push(`PER ${f.per.toFixed(1)} vs. ${perMercado.toFixed(1)} de ${mercado}${rel > 1.6 ? ': exigente, pero con utilidades creciendo fuerte' : ': valoración razonable'}.`);
      if (f.perForward !== undefined && f.perForward < f.per * 0.85) motivos.push(`El PER esperado (${f.perForward.toFixed(1)}) es menor: el mercado espera que las utilidades crezcan.`);
      else if (f.perForward !== undefined && f.perForward > f.per * 1.15) motivos.push(`El PER esperado (${f.perForward.toFixed(1)}) es mayor: se esperan utilidades más bajas.`);
    }
    if (f.roe !== undefined) {
      datos++;
      if (f.roe >= 0.15) { puntos++; motivos.push(`Rentable: ROE de ${pct(f.roe)}${f.pvl !== undefined ? ` con P/VL ${f.pvl.toFixed(1)}` : ''}.`); }
      else if (f.roe < 0.07) { puntos--; motivos.push(`Baja rentabilidad: ROE de ${pct(f.roe)}.`); }
      else motivos.push(`ROE de ${pct(f.roe)}: rentabilidad normal.`);
    }
    if (f.deudaPatrimonio !== undefined && f.sector !== 'Financiero' && f.deudaPatrimonio > 2) {
      puntos--;
      motivos.push(`Endeudada: deuda de ${f.deudaPatrimonio.toFixed(1)} veces su patrimonio.`);
    }
    if (f.crecimientoUtilidad !== undefined) {
      datos++;
      if (f.crecimientoUtilidad >= 0.1) { puntos++; motivos.push(`Utilidades creciendo ${signed(f.crecimientoUtilidad)} anual (último trimestre).`); }
      else if (f.crecimientoUtilidad <= -0.15) { puntos--; motivos.push(`Utilidades cayendo ${signed(f.crecimientoUtilidad)} anual (último trimestre).`); }
    }
    if (f.analistas) {
      datos++;
      const a = f.analistas;
      const positiva = /compra/.test(a.recomendacion);
      const negativa = /venta|bajo el mercado/.test(a.recomendacion);
      if (a.potencial >= 0.15 && !negativa) puntos++;
      else if (a.potencial <= -0.05 || negativa) puntos--;
      motivos.push(`${a.n} analistas: ${a.recomendacion}, precio objetivo promedio ${fmtMoney(a.objetivo, moneda)} (${signed(a.potencial)} de potencial)${positiva && a.potencial < 0.05 ? ', aunque ya está cerca del objetivo' : ''}.`);
    }
    if (f.payout !== undefined && f.payout > 1) {
      puntos--;
      motivos.push(`Reparte en dividendos ${pct(f.payout, 0)} de su utilidad: el dividendo podría bajar.`);
    } else if (f.dividendYield !== undefined && f.dividendYield >= 0.04) {
      motivos.push(`Dividendo de ${pct(f.dividendYield)} anual${f.payout !== undefined ? ` (reparte ${pct(f.payout, 0)} de la utilidad)` : ''}.`);
    }
  } else if (tipo === 'etf') {
    if (f.gastoAnual !== undefined) {
      datos++;
      if (f.gastoAnual <= 0.002) { puntos++; motivos.push(`Costo anual muy bajo (${pct(f.gastoAnual, 2)}).`); }
      else if (f.gastoAnual > 0.0075) { puntos--; motivos.push(`Costo anual alto (${pct(f.gastoAnual, 2)}): existen fondos equivalentes más baratos.`); }
      else motivos.push(`Costo anual ${pct(f.gastoAnual, 2)}.`);
    }
    if (f.per !== undefined) {
      datos++;
      const rel = f.per / perMercado;
      motivos.push(`PER de lo que tiene el fondo: ${f.per.toFixed(1)} (${rel > 1.3 ? `exigente frente a ${perMercado.toFixed(1)} de ${mercado}` : rel < 0.8 ? `barato frente a ${perMercado.toFixed(1)} de ${mercado}` : `similar a ${perMercado.toFixed(1)} de ${mercado}`}).`);
    }
    const sectores = Object.entries(f.sectores ?? {}).sort((a, b) => b[1] - a[1]);
    if (sectores[0] && sectores[0][1] > 0.4) motivos.push(`Concentrado: ${pct(sectores[0][1], 0)} en ${sectores[0][0]}.`);
    if (f.dividendYield !== undefined && f.dividendYield > 0.025) motivos.push(`Dividendo de ${pct(f.dividendYield)} anual.`);
  } else {
    motivos.push('Fondo de inversión: Yahoo no informa sus estados financieros; revisa su valor cuota y valor libro en la CMF.');
  }

  if (datos < 2 && tipo !== 'etf') return { veredicto: 'sin datos', motivos: motivos.length ? motivos : ['Datos fundamentales insuficientes.'] };
  const veredicto: VeredictoFundamental = tipo === 'etf'
    ? (puntos >= 1 ? 'favorable' : puntos <= -1 ? 'débil' : 'neutral')
    : (puntos >= 2 ? 'favorable' : puntos <= -2 ? 'débil' : 'neutral');
  return { veredicto, motivos };
}

interface Decision { accion: Accion; conviccion: Conviccion; puntaje: number; motivos: string[] }

// Calidad de utilidades de las acciones del S&P 500 (la calcula el bot con la SEC: flujo de caja menos pago en
// acciones, sobre la utilidad, frente a su sector). p = percentil en su sector, pa = reparte más que su utilidad
type CalidadEeuu = Record<string, { c: number; p: number; pa: boolean }>;
let calidadCache: { at: number; datos: CalidadEeuu } | null = null;
async function calidadEeuu(): Promise<CalidadEeuu> {
  if (calidadCache && Date.now() - calidadCache.at < 6 * 60 * 60 * 1000) return calidadCache.datos;
  try {
    const { data, error } = await supabase.from('analisis_ia').select('calidad:candidatos_json->calidad_us').order('fecha', { ascending: false }).limit(1);
    if (error) throw error;
    const datos = ((data?.[0] as { calidad?: CalidadEeuu } | undefined)?.calidad ?? {}) as CalidadEeuu;
    calidadCache = { at: Date.now(), datos };
    return datos;
  } catch (e) {
    console.warn('Sin calidad de utilidades:', e instanceof Error ? e.message.slice(0, 120) : e);
    return {};
  }
}

// Combina los pilares en una acción. La regla de riesgo manda (no se compra lo que ya pesa demasiado).
// El precio solo decide cuando el laboratorio de evidencia midió que esa señal anticipó retornos en el mercado
// del activo (`evTecnica.decide`); si no, se informa, pero la acción sale de los fundamentales y del riesgo.
function decidir(a: {
  diversificado: boolean; tipo: TipoActivo; peso: number; pesoEfectivo: number; distSma200: number | null; vol: number | null; pnl: number | null;
  tecnico: Pilar<VeredictoTecnico>; fundamental: Pilar<VeredictoFundamental>; riesgo: Pilar<VeredictoRiesgo>;
  evTecnica: Evidencia | null; evEstirado: Evidencia | null; evFundamentales: Evidencia[];
}): Decision {
  const tMedido = a.tecnico.veredicto, f = a.fundamental.veredicto, r = a.riesgo.veredicto;
  const motivos: string[] = [];
  // El veredicto técnico que cuenta para decidir: sin evidencia en este mercado, como si fuera neutral
  const pesaTecnico = a.evTecnica?.decide ?? false;
  const t: VeredictoTecnico = tMedido === 'sin datos' || pesaTecnico ? tMedido : 'neutral';
  let puntaje = (t === 'alcista' ? 1 : t === 'bajista' ? -1 : t === 'quiebre' ? -2 : 0) + (f === 'favorable' ? 1 : f === 'débil' ? -1 : 0);
  const estirado = a.distSma200 !== null && a.distSma200 > 0.25;
  const estiradoFrena = estirado && (a.evEstirado?.decide ?? false);

  if (tMedido === 'sin datos') return { accion: 'MANTENER', conviccion: 'baja', puntaje: 0, motivos: ['Sin precios confiables al día: no se recomienda comprar ni vender hasta tener datos.'] };
  if (r === 'excedido') {
    return { accion: 'REDUCIR', conviccion: 'alta', puntaje, motivos: [`Pesa ${pct(a.pesoEfectivo)} de tu patrimonio${a.pesoEfectivo > a.peso + 0.005 ? ' contando lo que tienes dentro de tus fondos' : ''}, sobre el máximo prudente de ${pct(limiteDe(a), 0)}: conviene rebalancear.`] };
  }

  let accion: Accion = 'MANTENER';
  let conviccion: Conviccion = 'media';
  if (a.diversificado) {
    // En un fondo diversificado decide su costo, no el momento: no se midió que esperar mejore el resultado
    if (f !== 'débil') {
      accion = 'AUMENTAR';
      conviccion = r === 'holgado' && f === 'favorable' ? 'alta' : 'media';
      motivos.push(`Fondo diversificado${f === 'favorable' ? ' y de bajo costo' : ''}: buen lugar para tus próximos aportes. Su tendencia no se usa para decidir: no hay evidencia de que esperar un mejor momento mejore el resultado, y aportar con regularidad evita depender de él.`);
      if (tMedido === 'bajista' || tMedido === 'quiebre') motivos.push('Viene cayendo: para un aporte periódico, eso significa comprar más barato.');
    } else {
      motivos.push('Costo anual alto: para tus próximos aportes conviene un fondo equivalente más barato.');
    }
  } else {
    // Solo las señales con evidencia significativa (sólida) en este mercado deciden, 2 puntos cada una; las demás se informan
    const senales = [a.evTecnica, ...a.evFundamentales].filter((e): e is Evidencia => e !== null && e.decide);
    const fuerza = (e: Evidencia) => 2 * e.signo;
    const total = senales.reduce((acc, e) => acc + fuerza(e), 0);
    const aFavor = senales.filter(e => e.signo > 0).map(e => `${e.etiqueta.toLowerCase()} (${e.nivel})`);
    const enContra = senales.filter(e => e.signo < 0).map(e => `${e.etiqueta.toLowerCase()} (${e.nivel})`);
    puntaje = total;
    if (!senales.length) {
      motivos.push('Ninguna de sus señales tiene evidencia significativa en 10 años en este mercado: no hay base para aumentar ni para vender. Para aportes nuevos, un fondo diversificado tiene mejor respaldo.');
    } else {
      if (aFavor.length) motivos.push(`Con evidencia a favor: ${aFavor.join('; ')}.`);
      if (enContra.length) motivos.push(`Con evidencia en contra: ${enContra.join('; ')}.`);
    }
    if (total >= 2) { accion = 'AUMENTAR'; conviccion = total >= 3 && r === 'holgado' ? 'alta' : 'media'; }
    else if (total <= -2) { accion = 'REDUCIR'; conviccion = total <= -3 ? 'alta' : 'media'; }

    if (accion === 'AUMENTAR' && tMedido === 'quiebre') {
      accion = 'MANTENER'; conviccion = 'media';
      motivos.push('Rompió su stop de volatilidad: espera que se estabilice y revisa si hay una noticia que lo explique antes de aumentar.');
    } else if (tMedido === 'quiebre' && !pesaTecnico) {
      motivos.push('Rompió su stop de volatilidad, pero en 10 años eso no anticipó peores retornos en este mercado: no es razón para vender por sí solo; revisa si cambió la razón por la que la compraste.');
    }
    if (accion === 'AUMENTAR' && estiradoFrena) {
      accion = 'MANTENER'; conviccion = 'media';
      motivos.push(`Está ${pct(a.distSma200!)} sobre su media de 200 días, muy estirado: mejor esperar un retroceso para aumentar.`);
    }
    if (accion === 'AUMENTAR' && f === 'débil') {
      conviccion = 'baja';
      motivos.push('Sus fundamentales clásicos (PER, ROE, deuda, crecimiento) son débiles, aunque en 10 años ese veredicto no anticipó retornos: aumenta con montos pequeños.');
    }
  }
  if (accion === 'AUMENTAR' && estirado && !estiradoFrena && !a.diversificado) {
    motivos.push(`Está ${pct(a.distSma200!)} sobre su media de 200 días; en 10 años las acciones así de estiradas no rindieron menos que su mercado, pero si compras, hazlo en partes.`);
  }

  if (accion === 'AUMENTAR' && r === 'cerca del límite') {
    accion = 'MANTENER';
    motivos.push(`Ya pesa ${pct(a.pesoEfectivo)} de tu patrimonio, cerca del máximo de ${pct(limiteDe(a), 0)}: no conviene concentrarse más.`);
  }
  if (accion === 'AUMENTAR' && a.vol !== null && a.vol > 0.6) motivos.push(`Volatilidad muy alta (${pct(a.vol, 0)} anual): si aumentas, hazlo con montos pequeños.`);
  if (a.pnl !== null && a.pnl > 0.5 && accion !== 'AUMENTAR') motivos.push(`Acumula ${signed(a.pnl)} desde tu compra: tomar parte de la ganancia es razonable si quieres rebalancear.`);
  else if (a.pnl !== null && a.pnl < -0.25 && accion !== 'AUMENTAR') motivos.push(`Pierde ${pct(-a.pnl)} desde tu compra: revisa si la razón por la que lo compraste sigue vigente.`);
  return { accion, conviccion, puntaje, motivos };
}

// --- Informe ---------------------------------------------------------------------------------------

// `candidatos`: tickers fuera del portafolio que se evalúan con las mismas reglas (peso 0), sin entrar
// en las métricas del portafolio. Los usa el optimizador, que además recibe el modelo de riesgo.
export async function buildAdvisorReport(
  items: HoldingInput[],
  candidatos: string[] = [],
  inversionista: PerfilInversionista | null = null,
): Promise<AdvisorReport & { modelo: RiskModel }> {
  const positions = groupByTicker(items);
  const extras: Position[] = [...new Set(candidatos)]
    .filter(t => !positions.some(p => p.ticker === t))
    .map(t => ({ ticker: t, moneda: t.endsWith('.SN') ? 'CLP' : 'USD', cantidad: 0, costoNativo: 0, lotes: [] }));
  const tickers = [...positions, ...extras].map(p => p.ticker);
  const avisosDatos: string[] = [];

  // El dólar se pide desde la compra más antigua, para valorizar el costo de cada lote en pesos
  const oldest = items.map(i => i.purchase_date).filter((d): d is string => !!d).sort()[0];
  const fxDays = Math.max(3 * 365 + 10, oldest ? Math.min(15 * 365, Math.ceil((Date.now() - new Date(oldest).getTime()) / DAY_MS) + 10) : 0);
  const DIAS_HISTORIA = 3 * 365 + 10; // tres años: riesgo más estable que con uno solo

  const [histories, fx, benchUS, benchCL, benchGlobal, quotes, rf, dolar, fund, mercado, calidad] = await Promise.all([
    Promise.all(tickers.map(t => dailyHistory(t, DIAS_HISTORIA))),
    dailyHistory(FX_TICKER, fxDays),
    dailyHistory(BENCH_US, DIAS_HISTORIA),
    dailyHistory(BENCH_CL, DIAS_HISTORIA),
    dailyHistory(BENCH_GLOBAL, DIAS_HISTORIA),
    liveQuotes(tickers),
    riskFreeRateClp(),
    dolarObservado(),
    fundamentales([...tickers, BENCH_CL, 'VOO']).catch(() => new Map<string, Fundamentales>()),
    contextoMercado().catch(() => null),
    calidadEeuu(),
  ]);
  const usdClp = dolar ?? fx?.closes.at(-1) ?? null;
  if (!usdClp) throw new Error('No se pudo obtener el tipo de cambio del dólar.');
  if (quotes.size === 0 && tickers.length > 0) avisosDatos.push('Yahoo no entregó cotizaciones en vivo: se usaron los últimos cierres conocidos.');
  if (fund.size === 0) avisosDatos.push('Yahoo no entregó datos fundamentales: las decisiones usan solo precios y riesgo.');
  if (!dolar) avisosDatos.push('El dólar observado no estuvo disponible: se usó el último cierre de Yahoo.');

  const perMercado = {
    CLP: fund.get(BENCH_CL)?.per ?? PER_REFERENCIA.CLP,
    USD: fund.get('VOO')?.per ?? PER_REFERENCIA.USD,
  };
  const histOf = new Map<string, DailyHistory | null>(tickers.map((t, i) => [t, histories[i]]));
  const fxAt = (fecha?: string | null) => (fecha && fx ? valueOn(fx.series, fx.dates, fecha) : undefined) ?? usdClp;

  // Tipo de activo: fondos chilenos conocidos, Yahoo (quoteType o fundamentales) o la lista de ETFs conocidos.
  // Así un ETF no pasa a tratarse como acción individual si la cotización de Yahoo falla.
  const tipoDe = (ticker: string, q?: LiveQuote): TipoActivo =>
    FONDOS_CHILE[ticker]?.tipo ?? fund.get(ticker)?.tipo
    ?? (q?.quoteType === 'ETF' || q?.quoteType === 'MUTUALFUND' || ETF_CONOCIDOS.has(ticker) ? 'etf' : 'accion');

  // 1. Valorización y costo en pesos (el costo en dólares usa el dólar del día de compra, si se conoce)
  const base = positions.map(p => {
    const h = histOf.get(p.ticker) ?? null;
    const q = quotes.get(p.ticker);
    // Moneda real del activo según Yahoo: un ticker chileno cargado como USD se valorizaría 900 veces más
    const monedaReal = q?.currency === 'USD' || q?.currency === 'CLP' ? q.currency : p.moneda;
    if (monedaReal !== p.moneda) avisosDatos.push(`${p.ticker} está cargado en ${p.moneda} pero cotiza en ${monedaReal}: se valorizó en ${monedaReal}. Corrige la moneda en tu portafolio.`);
    const pos = { ...p, moneda: monedaReal };
    // Una cotización más antigua que el último cierre del historial no se usa
    const cotizacionVigente = q && (!q.time || !h || q.time >= h.dates.at(-1)!);
    const precio = (cotizacionVigente ? q?.price : undefined) ?? h?.closes.at(-1) ?? q?.price ?? p.costoNativo / p.cantidad;
    if (!q && !h) avisosDatos.push(`${p.ticker}: sin precio de mercado, se valorizó a su costo.`);
    const valorNativo = p.cantidad * precio;
    const aCLP = (monto: number, fecha?: string | null) => (monedaReal === 'USD' ? monto * fxAt(fecha) : monto);
    return {
      p: pos, h, q, precio,
      valorCLP: monedaReal === 'USD' ? valorNativo * usdClp : valorNativo,
      costoCLP: p.lotes.reduce((s, l) => s + aCLP(l.cantidad * l.precio, l.fecha), 0),
      sinFecha: monedaReal === 'USD' && p.lotes.some(l => !l.fecha),
    };
  });
  const totalCLP = base.reduce((s, b) => s + b.valorCLP, 0);
  const costoTotalCLP = base.reduce((s, b) => s + b.costoCLP, 0);

  // 2. Exposición mirando dentro de los fondos: cuánto tienes de cada empresa, sector y región
  const pesoDe = new Map(base.map(b => [b.p.ticker, totalCLP > 0 ? b.valorCLP / totalCLP : 0]));
  const exposicion = calcularExposicion(base.map(b => ({ ticker: b.p.ticker, moneda: b.p.moneda, peso: pesoDe.get(b.p.ticker)!, tipo: tipoDe(b.p.ticker, b.q) })), fund);
  const efectivo = new Map(exposicion.empresas.map(e => [e.ticker, e.total]));

  // 3. Métricas y decisión por activo
  const assess = (p: Position, h: DailyHistory | null, q: LiveQuote | undefined, precio: number, valorCLP: number): AssetReport => {
    const closes = h?.adj ?? []; // con dividendos
    const year = closes.slice(-(TRADING_DAYS + 1));
    const conDatos = !!h && h.fresh && !h.frozen && closes.length >= 60;
    const sinDatosMotivo = !h || closes.length < 60
      ? undefined
      : `Sus precios no están al día (último dato confiable: ${h.dates.at(-1)}); no se evalúa hasta tener datos frescos.`;
    const stopCalc = conDatos ? volatilityStop(closes) : null;
    const n = closes.length;
    // Confirmación: dos cierres seguidos bajo el stop (o el último cierre y el precio de hoy, si es distinto)
    const stopActivado = !!stopCalc && closes[n - 1] < stopCalc.stop && (closes[n - 2] < stopCalc.stop || (precio < stopCalc.stop && precio !== closes[n - 1]));
    const benchTicker = p.moneda === 'CLP' ? BENCH_CL : BENCH_US;
    const bench = p.moneda === 'CLP' ? benchCL : benchUS;
    let beta: number | null = null;
    if (p.ticker === benchTicker) beta = 1;
    else if (h && bench && conDatos) {
      const cutoff = h.dates[Math.max(0, h.dates.length - TRADING_DAYS - 1)];
      beta = dimsonBeta(...alignedReturns(new Map([...h.adjSeries].filter(([d]) => d >= cutoff)), bench.adjSeries));
    }
    const costoPromedio = p.cantidad > 0 ? p.costoNativo / p.cantidad : 0;
    const sma200 = sma(closes, 200);
    const mom = momentum(closes);
    const f = fund.get(p.ticker) ?? null;
    const nombre = q?.name ?? f?.nombre;
    const tipo = tipoDe(p.ticker, q);
    const apalancado = APALANCADOS.has(p.ticker) || (!!nombre && APALANCADO.test(nombre));
    const diversificado = tipo === 'etf' && !apalancado;
    const distSma200 = sma200 ? precio / sma200 - 1 : null;
    const rsi = rsiOf(closes.slice(-250));
    const anios3 = Math.min(3, (n - 1) / TRADING_DAYS);
    const ret3y = anios3 >= 2 && closes[0] > 0 ? (closes[n - 1] / closes[0]) ** (1 / anios3) - 1 : null;
    const peso = totalCLP > 0 ? valorCLP / totalCLP : 0;
    const pesoEfectivo = diversificado ? peso : Math.max(peso, efectivo.get(p.ticker) ?? peso);
    const vol = annualVol(returns(year));
    const pnl = costoPromedio > 0 ? precio / costoPromedio - 1 : null;

    const mercado = mercadoDe(p.moneda);
    const { pilar: tecnico, evid: evidRsi } = pilarTecnico({ conDatos, sinDatosMotivo, distSma200, momentum: mom?.valor ?? null, momentumMeses: mom?.meses ?? null, rsi, stop: stopCalc?.stop ?? null, stopActivado, moneda: p.moneda }, mercado);
    // El laboratorio mide acciones: en un fondo diversificado el momento no decide
    const evTecnica = diversificado ? null : evidenciaVeredicto(tecnico.veredicto, mercado);
    const evEstirado = !diversificado && distSma200 !== null && distSma200 > 0.25 ? evidencia('estirado', mercado, -1, 'Comprar más de 25% sobre su media de 200 días') : null;
    const fundamental = pilarFundamental(f, tipo, perMercado[p.moneda], p.moneda);
    const limite = diversificado ? LIMITE_FONDO : LIMITE_ACCION;
    const riesgo: Pilar<VeredictoRiesgo> = {
      veredicto: pesoEfectivo > limite ? 'excedido' : pesoEfectivo > 0.75 * limite ? 'cerca del límite' : 'holgado',
      motivos: [`Pesa ${pct(peso)} de tu patrimonio${pesoEfectivo > peso + 0.005 ? ` (${pct(pesoEfectivo)} contando lo que tienes dentro de tus fondos)` : ''}; máximo prudente ${pct(limite, 0)}${diversificado ? ' para un fondo diversificado' : ' para una sola empresa'}.`],
    };
    if (vol !== null) riesgo.motivos.push(`Volatilidad ${pct(vol, 0)} anual${beta !== null ? `, beta ${beta.toFixed(2)} vs. ${benchTicker === BENCH_CL ? 'IPSA' : 'S&P 500'}` : ''}.`);
    // Fundamentales con lo que midió el laboratorio: veredicto clásico, calidad de utilidades (SEC) y dividendo
    const evFundamentales: Evidencia[] = [];
    if (!diversificado && tipo === 'accion') {
      if (fundamental.veredicto === 'favorable') evFundamentales.push(evidencia('fundamental_favorable', mercado, 1, 'Veredicto fundamental favorable'));
      else if (fundamental.veredicto === 'débil') evFundamentales.push(evidencia('fundamental_debil', mercado, -1, 'Veredicto fundamental débil'));
      const q = mercado === 'EE.UU.' ? calidad[p.ticker] : undefined;
      if (q && q.p >= 0.8) evFundamentales.push(evidencia('calidad_alta', mercado, 1, 'Utilidad respaldada por caja, en el 20% superior de su sector'));
      else if (q && q.p <= 0.2) evFundamentales.push(evidencia('calidad_baja', mercado, -1, 'Utilidad poco respaldada por caja, en el 20% inferior de su sector'));
      if ((f?.payout ?? 0) > 1 || q?.pa) evFundamentales.push(evidencia('payout_alto', mercado, -1, 'Reparte en dividendos más que su utilidad'));
    }
    const decision = decidir({ diversificado, tipo, peso, pesoEfectivo, distSma200, vol, pnl, tecnico, fundamental, riesgo, evTecnica, evEstirado, evFundamentales });
    const evid = diversificado ? [] : [evTecnica, ...evFundamentales, evEstirado, ...evidRsi].filter((e): e is Evidencia => e !== null);

    return {
      ticker: p.ticker, nombre, tipo, sector: f?.sector ?? (tipo === 'etf' ? f?.categoria : undefined),
      moneda: p.moneda, cantidad: p.cantidad, costoPromedio, precio, valorCLP, peso, pesoEfectivo, pnl,
      ret1y: periodReturn(closes, TRADING_DAYS), ret3y,
      momentum: mom?.valor ?? null, momentumMeses: mom?.meses ?? null,
      vol, maxDD: conDatos ? maxDrawdown(year) : null, beta,
      benchmark: benchTicker === BENCH_CL ? 'IPSA' : 'S&P 500',
      rsi, sma200, distSma200,
      stop: stopCalc?.stop ?? null, stopDist: stopCalc ? stopCalc.stop / precio - 1 : null, stopActivado,
      diversificado, aporteRiesgo: null, fundamentales: f,
      tecnico, fundamental, riesgo, ...decision, evidencia: evid, conDatos,
    };
  };
  const posiciones = base.map(b => assess(b.p, b.h, b.q, b.precio, b.valorCLP));
  posiciones.sort((a, b) => b.valorCLP - a.valorCLP);
  const evaluados = extras
    .map(p => {
      const h = histOf.get(p.ticker) ?? null;
      const precio = quotes.get(p.ticker)?.price ?? h?.closes.at(-1);
      return precio ? assess(p, h, quotes.get(p.ticker), precio, 0) : null;
    })
    .filter((a): a is AssetReport => a !== null);

  // 4. Modelo de riesgo en pesos y con dividendos. Se usa la ventana más larga (3, 2 o 1 año) en la que los
  //    activos con historial cubran al menos el 90% del valor; el resto se informa como no cubierto.
  let ventanaAnios = 1;
  let cutoff = '';
  let cubiertos: AssetReport[] = [];
  for (const anios of [3, 2, 1]) {
    const c = new Date(Date.now() - anios * 365 * DAY_MS).toISOString().slice(0, 10);
    const cubre = (a: AssetReport) => a.conDatos && (histOf.get(a.ticker)?.dates[0] ?? '9999') <= addDays(c, 10);
    const cub = posiciones.filter(cubre);
    const valor = cub.reduce((s, a) => s + a.valorCLP, 0);
    if (anios === 1 || (totalCLP > 0 && valor / totalCLP >= 0.9)) {
      ventanaAnios = anios; cutoff = c; cubiertos = cub;
      break;
    }
  }
  const cubreVentana = (a: AssetReport) => a.conDatos && (histOf.get(a.ticker)?.dates[0] ?? '9999') <= addDays(cutoff, 10);
  const candidatosCubiertos = evaluados.filter(cubreVentana);
  const universo = [...cubiertos, ...candidatosCubiertos];
  const calendar = [...new Set(universo.flatMap(a => histOf.get(a.ticker)!.dates))].filter(d => d >= cutoff).sort();

  const valorCubierto = cubiertos.reduce((s, a) => s + a.valorCLP, 0);
  const w = cubiertos.map(a => (valorCubierto > 0 ? a.valorCLP / valorCubierto : 0));
  const usdCubierto = cubiertos.reduce((s, a, i) => s + (a.moneda === 'USD' ? w[i] : 0), 0);

  // Retornos diarios locales de cada activo (precio arrastrado en los feriados de su bolsa) y del dólar
  const localReturns = (h: DailyHistory) => returns(calendar.map(d => valueOn(h.adjSeries, h.dates, d) ?? h.adj[0]));
  const fxReturns = returns(calendar.map(d => fxAt(d)));
  const localByTicker = new Map(universo.map(a => [a.ticker, localReturns(histOf.get(a.ticker)!)]));
  const clpReturns = (a: AssetReport) => {
    const r = localByTicker.get(a.ticker)!;
    return a.moneda === 'USD' ? r.map((x, t) => (1 + x) * (1 + fxReturns[t]) - 1) : r;
  };
  const T = calendar.length - 1;
  const span = calendar.length > 1 ? (new Date(calendar[T]).getTime() - new Date(calendar[0]).getTime()) / DAY_MS : 0;
  const periodsPerYear = span > 0 ? T * 365 / span : TRADING_DAYS;

  let vol: number | null = null, ret1y: number | null = null, retAnualVentana: number | null = null, maxDD: number | null = null;
  let var95: number | null = null, es95: number | null = null, diversificacion: number | null = null;
  let posicionesEfectivas: number | null = null, riesgoCambiario: number | null = null, encogimiento: number | null = null;
  let indice: PortfolioSummary['indice'] = null;
  let modelo: RiskModel = { tickers: [], cov: [] };

  if (T >= 60 && cubiertos.length > 0) {
    const clpByTicker = new Map(universo.map(a => [a.ticker, clpReturns(a)]));
    const portfolio = Array.from({ length: T }, (_, t) => cubiertos.reduce((s, a, i) => s + w[i] * clpByTicker.get(a.ticker)![t], 0));
    vol = Math.sqrt(neweyWestVariance(portfolio) * periodsPerYear);
    const index = [1];
    portfolio.forEach(r => index.push(index[index.length - 1] * (1 + r)));
    retAnualVentana = index[index.length - 1] ** (365 / Math.max(span, 1)) - 1;
    const desdeUnAnio = calendar.findIndex(d => d >= addDays(new Date().toISOString().slice(0, 10), -365));
    ret1y = desdeUnAnio >= 0 ? index[index.length - 1] / index[desdeUnAnio] - 1 : null;
    maxDD = maxDrawdown(index);
    var95 = historicalVaR(portfolio);
    es95 = expectedShortfall(portfolio);

    // Descomposición del riesgo: cada activo en su moneda + el dólar como factor propio
    const factors = Array.from({ length: T }, (_, t) => [...cubiertos.map(a => localByTicker.get(a.ticker)![t]), fxReturns[t]]);
    const exposures = [...w, usdCubierto];
    const covF = neweyWestCov(factors);
    const m = matVec(covF, exposures);
    const variance = dot(exposures, m);
    if (variance > 0) {
      const rc = exposures.map((e, j) => e * m[j] / variance);
      cubiertos.forEach((a, i) => { a.aporteRiesgo = rc[i]; });
      riesgoCambiario = rc[rc.length - 1];
      const rcActivos = rc.slice(0, -1);
      const totalRc = rcActivos.reduce((s, x) => s + x, 0);
      posicionesEfectivas = totalRc > 0 ? 1 / rcActivos.reduce((s, x) => s + (x / totalRc) ** 2, 0) : null;
    }

    // Matriz en pesos para el optimizador (portafolio + candidatos), encogida con Ledoit-Wolf
    const clpMatrix = Array.from({ length: T }, (_, t) => universo.map(a => clpByTicker.get(a.ticker)![t]));
    const lw = ledoitWolfConstantCorrelation(clpMatrix);
    encogimiento = lw.intensidad;
    const covClp = shrinkCov(neweyWestCov(clpMatrix), lw.intensidad, lw.correlacionMedia).map(row => row.map(x => x * periodsPerYear));
    modelo = { tickers: universo.map(a => a.ticker), cov: covClp };
    if (vol > 0) {
      const sumaIndividual = cubiertos.reduce((s, _, i) => s + w[i] * Math.sqrt(Math.max(covClp[i][i], 0)), 0);
      diversificacion = sumaIndividual / vol;
    }

    // Índice equivalente: IPSA y acciones globales en pesos, con tu misma mezcla de monedas (último año)
    const global = benchGlobal ?? benchUS;
    if (benchCL && global && benchCL.fresh && desdeUnAnio >= 0) {
      const rCl = localReturns(benchCL);
      const rGl = localReturns(global).map((x, t) => (1 + x) * (1 + fxReturns[t]) - 1);
      const bench = rCl.map((x, t) => (1 - usdCubierto) * x + usdCubierto * rGl[t]).slice(desdeUnAnio);
      const propio = portfolio.slice(desdeUnAnio);
      const retB = bench.reduce((acc, r) => acc * (1 + r), 1) - 1;
      indice = {
        nombre: `${pct(1 - usdCubierto, 0)} IPSA + ${pct(usdCubierto, 0)} ${global === benchGlobal ? 'acciones globales (ACWI)' : 'S&P 500'} en pesos`,
        ret1y: retB,
        diferencia: ret1y !== null ? ret1y - retB : null,
        trackingError: Math.sqrt(neweyWestVariance(propio.map((r, t) => r - bench[t])) * periodsPerYear),
      };
    } else if (benchCL && !benchCL.fresh) {
      avisosDatos.push('El precio del ETF del IPSA no está al día: no se compara con el índice.');
    }
  }

  // 5. Grupos de activos casi idénticos (último año; incluye candidatos del escáner contra lo que ya tienes).
  //    Cada miembro debe parecerse al activo principal del grupo, no solo a un intermediario.
  const corte1y = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
  const yearSeries = new Map([...posiciones, ...evaluados].filter(a => a.conDatos).map(a => [
    a.ticker, new Map([...histOf.get(a.ticker)!.adjSeries].filter(([d]) => d >= corte1y)),
  ]));
  const conSerie = [...yearSeries.keys()];
  const corrDe = new Map<string, number>();
  const pares: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < conSerie.length; i++) {
    for (let j = i + 1; j < conSerie.length; j++) {
      const corr = correlation(...alignedReturns(yearSeries.get(conSerie[i])!, yearSeries.get(conSerie[j])!));
      if (corr === null) continue;
      corrDe.set(`${conSerie[i]}|${conSerie[j]}`, corr);
      corrDe.set(`${conSerie[j]}|${conSerie[i]}`, corr);
      if (corr >= GEMELOS_CORR) pares.push({ a: conSerie[i], b: conSerie[j], corr });
    }
  }
  const byTicker = new Map([...posiciones, ...evaluados].map(a => [a.ticker, a]));
  const enCartera = [...posiciones].sort((x, y) => y.peso - x.peso);
  const asignado = new Set<string>();
  for (const principal of enCartera) {
    if (asignado.has(principal.ticker) || !principal.conDatos) continue;
    for (const t of conSerie) {
      if (t === principal.ticker || asignado.has(t)) continue;
      const corr = corrDe.get(`${t}|${principal.ticker}`);
      if (corr === undefined || corr < GEMELOS_CORR) continue;
      const a = byTicker.get(t)!;
      if (a.cantidad > 0 && a.peso > principal.peso) continue;
      asignado.add(t);
      a.gemeloDe = principal.ticker;
      if (a.cantidad > 0 && a.accion === 'AUMENTAR') {
        a.accion = 'MANTENER';
        a.conviccion = 'media';
        a.motivos.push(`Se mueve casi igual que ${principal.ticker} (correlación ${corr.toFixed(2)}): si vas a aumentar, concentra la compra en ${principal.ticker}.`);
      } else if (a.cantidad === 0) {
        a.motivos.push(`Se mueve casi igual que ${principal.ticker}, que ya tienes (correlación ${corr.toFixed(2)}): no agrega diversificación.`);
      }
    }
  }

  // 6. Un activo que aporta mucho más riesgo que su peso no debería crecer
  for (const a of posiciones) {
    if (a.accion === 'AUMENTAR' && a.aporteRiesgo !== null && a.aporteRiesgo > 0.15 && a.aporteRiesgo > 2 * a.peso) {
      a.accion = 'MANTENER';
      a.conviccion = 'media';
      a.motivos.push(`Pesa ${pct(a.peso)} pero aporta ${pct(a.aporteRiesgo)} del riesgo total: aumentarlo desbalancearía el portafolio.`);
    }
    if (a.aporteRiesgo !== null) a.riesgo.motivos.push(`Aporta ${pct(a.aporteRiesgo)} del riesgo total de tu cartera.`);
  }
  // 7. Coherencia con la cartera completa: una compra no puede empeorar lo que el plan pide corregir
  const frenar = (a: AssetReport, motivo: string) => {
    if (a.accion !== 'AUMENTAR') return;
    a.accion = 'MANTENER';
    a.conviccion = 'media';
    a.motivos.push(motivo);
  };
  const pesoSector = new Map(exposicion.sectores.map(s => [s.nombre, s.peso]));
  const pesoChile = exposicion.regiones.find(x => x.nombre === 'Chile')?.peso ?? 0;
  for (const a of posiciones) {
    // Sector: el de la empresa o, si es un fondo sectorial (más de 60% en un sector), ese sector
    const sectoresFondo = Object.entries(a.fundamentales?.sectores ?? {}).sort((x, y) => y[1] - x[1]);
    const sector = !a.diversificado ? a.sector : sectoresFondo[0] && sectoresFondo[0][1] > 0.6 ? sectoresFondo[0][0] : undefined;
    const ps = sector ? pesoSector.get(sector) ?? 0 : 0;
    if (sector && ps > LIMITE_SECTOR) frenar(a, `El sector ${sector} ya pesa ${pct(ps, 0)} de tu patrimonio contando tus fondos: aumentar aquí concentra más el riesgo.`);
    if (a.moneda === 'CLP' && pesoChile > 0.6) frenar(a, `Ya tienes ${pct(pesoChile, 0)} de tu patrimonio en Chile: los próximos aportes rinden más en diversificación fuera de Chile.`);
  }
  // De dos posiciones que se mueven casi igual, solo se aumenta la más grande
  for (const p of pares) {
    const a = byTicker.get(p.a)!, b = byTicker.get(p.b)!;
    if (a.cantidad === 0 || b.cantidad === 0) continue;
    const [chica, grande] = a.peso < b.peso ? [a, b] : [b, a];
    // Si el más grande a su vez se parece a otro mayor, las compras van a ese
    const destino = grande.gemeloDe ?? grande.ticker;
    frenar(chica, `Se mueve casi igual que ${grande.ticker} (correlación ${p.corr.toFixed(2)}): si vas a aumentar, concentra la compra en ${destino}.`);
  }
  // En un mercado defensivo no se suman activos de alto riesgo
  if (mercado?.regimen === 'defensivo') {
    for (const a of posiciones) {
      if (!a.diversificado && (a.beta ?? 1) > 1.2) frenar(a, `El mercado está en modo defensivo y este activo amplifica sus movimientos (beta ${a.beta!.toFixed(2)}): espera que mejore antes de aumentar.`);
    }
  }
  // 8. Perfil del inversionista: plazo y tolerancia a caídas, que la cartera no muestra por sí sola
  const ajuste = inversionista ? adecuacion(inversionista) : null;
  if (inversionista && ajuste) {
    for (const a of posiciones) {
      if (inversionista.horizonte === 'menos_1') {
        frenar(a, 'Necesitas este dinero en menos de un año: en ese plazo la bolsa puede estar abajo justo cuando lo necesites. Lo que vayas a usar pronto va mejor en ahorro sin riesgo.');
      } else if (ajuste.plazoCorto && !a.diversificado) {
        frenar(a, 'Necesitas este dinero en 1 a 3 años: para ese plazo no conviene aumentar acciones individuales; si aportas, que sea en fondos diversificados o renta fija.');
      }
      if (vol !== null && vol > ajuste.volMaxima && a.vol !== null && a.vol > vol) {
        frenar(a, `Tu cartera ya es más volátil (${pct(vol)} anual) de lo que corresponde a tu perfil ${ajuste.nivel} (hasta ${pct(ajuste.volMaxima, 0)}), y este activo lo es aún más (${pct(a.vol, 0)}): aumentarlo te aleja de tu perfil.`);
      }
      if (inversionista.experiencia === 'principiante' && a.accion === 'AUMENTAR' && !a.diversificado) {
        a.motivos.push('Como estás empezando, conviene que la mayor parte de tus aportes vaya a fondos diversificados y que las acciones individuales sean montos pequeños.');
      }
    }
  }

  const perfil = vol === null ? null : vol < 0.08 ? 'conservador' : vol < 0.15 ? 'moderado' : vol < 0.22 ? 'moderado-agresivo' : 'agresivo';
  const sinFecha = base.filter(b => b.sinFecha);

  const resumen: PortfolioSummary = {
    valorCLP: totalCLP,
    costoCLP: costoTotalCLP,
    pnlCLP: totalCLP - costoTotalCLP,
    pnlPct: costoTotalCLP > 0 ? totalCLP / costoTotalCLP - 1 : null,
    pesoUSD: totalCLP > 0 ? posiciones.filter(a => a.moneda === 'USD').reduce((s, a) => s + a.peso, 0) : 0,
    vol, maxDD, ret1y, retAnualVentana,
    sharpe: vol && retAnualVentana !== null ? (retAnualVentana - rf) / vol : null,
    var95,
    var95CLP: var95 !== null ? var95 * valorCubierto : null,
    es95,
    es95CLP: es95 !== null ? es95 * valorCubierto : null,
    diversificacion, posicionesEfectivas, riesgoCambiario,
    cobertura: totalCLP > 0 ? valorCubierto / totalCLP : 0,
    ventanaAnios, encogimiento,
    sinFechaUSD: { posiciones: sinFecha.length, peso: totalCLP > 0 ? sinFecha.reduce((s, b) => s + b.valorCLP, 0) / totalCLP : 0 },
    indice, perfil,
    diasHistoria: calendar.length,
  };

  const gemelosEnCartera = pares.filter(p => byTicker.get(p.a)!.cantidad > 0 && byTicker.get(p.b)!.cantidad > 0);
  return {
    generado: new Date().toISOString(),
    usdClp,
    tasaLibreRiesgo: rf,
    resumen,
    mercado,
    exposicion,
    estrategia: planEstrategico(resumen, posiciones, exposicion, mercado, gemelosEnCartera, inversionista, ajuste),
    hallazgos: buildFindings(resumen, posiciones, exposicion, gemelosEnCartera, rf, mercado, inversionista, ajuste),
    posiciones,
    candidatos: evaluados,
    avisosDatos,
    perfilInversionista: inversionista && ajuste ? { ...ajuste, perfil: inversionista } : null,
    modelo,
  };
}

function addDays(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// --- Exposición con transparencia (look-through) ------------------------------------------------------

function calcularExposicion(
  pos: { ticker: string; moneda: 'USD' | 'CLP'; peso: number; tipo: TipoActivo }[],
  fund: Map<string, Fundamentales>,
): Exposicion {
  const regiones = new Map<string, number>();
  const sectores = new Map<string, { peso: number; via: Set<string> }>();
  const empresas = new Map<string, { directo: number; viaFondos: number; fondos: Set<string> }>();
  const notas = new Set<string>();
  const sumar = <T>(m: Map<string, T>, k: string, f: (x: T | undefined) => T) => m.set(k, f(m.get(k)));
  const sumaSector = (nombre: string, peso: number, via: string) =>
    sumar(sectores, nombre, x => ({ peso: (x?.peso ?? 0) + peso, via: (x?.via ?? new Set<string>()).add(via) }));
  const sumaEmpresa = (ticker: string, directo: number, indirecto: number, fondo?: string) =>
    sumar(empresas, ticker, x => {
      const fondos = x?.fondos ?? new Set<string>();
      if (fondo) fondos.add(fondo);
      return { directo: (x?.directo ?? 0) + directo, viaFondos: (x?.viaFondos ?? 0) + indirecto, fondos };
    });

  for (const p of pos) {
    const f = fund.get(p.ticker);
    // Región
    if (p.moneda === 'CLP') sumar(regiones, 'Chile', x => (x ?? 0) + p.peso);
    else if (p.tipo === 'etf' && PESO_EEUU_FONDOS[p.ticker] !== undefined) {
      const us = PESO_EEUU_FONDOS[p.ticker];
      sumar(regiones, 'EE.UU.', x => (x ?? 0) + p.peso * us);
      sumar(regiones, 'Resto del mundo', x => (x ?? 0) + p.peso * (1 - us));
      notas.add('La parte de EE.UU. dentro de los fondos globales (VT, ACWI) es aproximada.');
    } else {
      const pais = f?.tipo === 'accion' ? f.pais : undefined;
      sumar(regiones, pais && !PAISES[pais] ? 'Resto del mundo' : 'EE.UU.', x => (x ?? 0) + p.peso);
    }
    // Sectores y empresas
    if (p.ticker === 'CFMITNIPSA.SN' || p.ticker === 'CFIETFIPSA1.SN') {
      for (const [s, w] of Object.entries(IPSA_SECTORES)) sumaSector(s, p.peso * w, p.ticker);
      for (const [t, w] of Object.entries(IPSA_EMPRESAS)) sumaEmpresa(t, 0, p.peso * w, p.ticker);
      notas.add('Lo que tiene el fondo del IPSA se estima con una composición referencial del índice (aproximada).');
    } else if (p.tipo === 'etf' && f?.sectores) {
      const total = Object.values(f.sectores).reduce((s, w) => s + w, 0) || 1;
      for (const [s, w] of Object.entries(f.sectores)) sumaSector(s, p.peso * w / total, p.ticker);
      for (const h of f.principales ?? []) sumaEmpresa(h.ticker, 0, p.peso * h.peso, p.ticker);
    } else if (p.tipo === 'etf') {
      sumaSector('Fondos sin detalle', p.peso, p.ticker);
    } else {
      sumaSector(f?.sector ?? FONDOS_CHILE[p.ticker]?.sector ?? 'Sin clasificar', p.peso, p.ticker);
    }
    if (p.tipo !== 'etf') sumaEmpresa(p.ticker, p.peso, 0);
  }
  return {
    regiones: [...regiones].map(([nombre, peso]) => ({ nombre, peso })).sort((a, b) => b.peso - a.peso),
    sectores: [...sectores].map(([nombre, x]) => ({ nombre, peso: x.peso, via: [...x.via] })).sort((a, b) => b.peso - a.peso),
    empresas: [...empresas].map(([ticker, x]) => ({ ticker, directo: x.directo, viaFondos: x.viaFondos, total: x.directo + x.viaFondos, fondos: [...x.fondos] }))
      .sort((a, b) => b.total - a.total),
    notas: [...notas],
  };
}

// --- Plan estratégico (reglas) ---------------------------------------------------------------------

function planEstrategico(
  r: PortfolioSummary, pos: AssetReport[], ex: Exposicion, mercado: ContextoMercado | null, gemelos: { a: string; b: string; corr: number }[],
  perfil: PerfilInversionista | null, ajuste: Adecuacion | null,
): string[] {
  const plan: string[] = [];
  // Lo que va antes de cualquier compra: deudas caras, colchón y plazo
  if (perfil && ajuste) {
    if (perfil.deudaCara) plan.push('Antes de invertir más, paga tus deudas caras (tarjetas, líneas de crédito, créditos de consumo): sus intereses superan lo que razonablemente rinde la bolsa, así que pagarlas es la inversión más rentable y sin riesgo.');
    if (perfil.fondoEmergencia !== 'si') plan.push(`${perfil.fondoEmergencia === 'no' ? 'Arma' : 'Completa'} primero un fondo de emergencia de 3 a 6 meses de gastos en algo líquido y sin riesgo (cuenta de ahorro, depósito a plazo o fondo money market): así una emergencia no te obliga a vender en medio de una caída.`);
    if (perfil.horizonte === 'menos_1') {
      plan.push('Necesitas este dinero en menos de un año: lo que vayas a usar en ese plazo debería estar fuera de la bolsa (depósito a plazo o fondo money market). Empieza por lo que tiene señal REDUCIR y considera comisiones e impuestos al vender.');
    } else if (ajuste.plazoCorto) {
      plan.push('Necesitas este dinero en 1 a 3 años, un plazo corto para la bolsa: ve pasando gradualmente a renta fija lo que vas a necesitar y deja los aportes nuevos en fondos diversificados.');
    }
    if (r.vol !== null && r.vol > ajuste.volMaxima) {
      plan.push(`Tu cartera tiene una volatilidad de ${pct(r.vol)} anual, más de lo que corresponde a tu perfil ${ajuste.nivel} (hasta ${pct(ajuste.volMaxima, 0)}): dirige los próximos aportes a fondos diversificados${ajuste.nivel === 'conservador' ? ' y a renta fija' : ''} en vez de a las acciones más volátiles.`);
    }
    if (r.maxDD !== null && r.maxDD > ajuste.caidaTolerable) {
      plan.push(`Con tus pesos actuales, en los últimos ${r.ventanaAnios} años tu cartera habría caído hasta ${pct(r.maxDD, 0)} desde un máximo, más de lo que dices tolerar (${pct(ajuste.caidaTolerable, 0)}). Si una caída así te llevaría a vender, conviene bajar el riesgo ahora y no en medio de la caída.`);
    }
    if (perfil.objetivo === 'preservar') plan.push('Tu objetivo es cuidar lo que tienes: una cartera de acciones puede caer 30% o más en una crisis. Una parte en renta fija (depósitos, fondos de deuda) amortigua esas caídas.');
  }
  const antesDeComprar = plan.length > 0;
  if (mercado) {
    plan.push(mercado.regimen === 'favorable'
      ? 'Contexto favorable: mantén tu exposición y aprovecha los retrocesos para aportar en lo que tiene señal AUMENTAR.'
      : mercado.regimen === 'defensivo'
        ? 'Contexto defensivo: prioriza proteger. No sumes activos de alto riesgo, respeta los stops y aporta de a poco, preferentemente en fondos diversificados.'
        : 'Contexto mixto: sé selectivo. Aporta en partes (por ejemplo, en 2 o 3 meses) y prioriza fondos diversificados y empresas con buenos fundamentales.');
  }
  const reducir = pos.filter(a => a.accion === 'REDUCIR');
  if (reducir.length) plan.push(`Revisa primero ${reducir.map(a => `${a.ticker} (${a.motivos[0]?.replace(/(:|\.(\s|$))[\s\S]*$/, '').toLowerCase()})`).join('; ')}: ${reducir.length > 1 ? 'tienen' : 'tiene'} señal REDUCIR.`);
  const sector = ex.sectores[0];
  if (sector && sector.peso > LIMITE_SECTOR && sector.nombre !== 'Fondos sin detalle') {
    plan.push(`${sector.nombre} pesa ${pct(sector.peso, 0)} de tu patrimonio contando lo que hay dentro de tus fondos: no sumes más de ese sector y dirige los próximos aportes a otros.`);
  }
  const chile = ex.regiones.find(x => x.nombre === 'Chile')?.peso ?? 0;
  const meta = metaChileDe(perfil);
  if (chile > meta) {
    plan.push(`${pct(chile, 0)} de tu patrimonio está en Chile${perfil?.metaChile ? `, sobre tu meta de ${pct(meta, 0)}` : ''}: para que tu cartera dependa menos de una sola economía, dirige los próximos aportes a fondos globales${perfil?.metaChile ? '' : ' hasta acercarte a la mitad fuera de Chile'}. El rebalanceo de la Calculadora te dice qué vender para volver a ${pct(meta, 0)}.`);
  } else if (chile < 0.2 && chile > 0) {
    plan.push(`Solo ${pct(chile, 0)} está en Chile: si tus gastos son en pesos, tener algo más en activos locales reduce el riesgo cambiario.`);
  }
  const aumentar = pos.filter(a => a.accion === 'AUMENTAR').sort((a, b) => (a.conviccion === 'alta' ? 0 : a.conviccion === 'media' ? 1 : 2) - (b.conviccion === 'alta' ? 0 : b.conviccion === 'media' ? 1 : 2) || b.puntaje - a.puntaje);
  if (aumentar.length) plan.push(`Para tus próximos aportes, en orden de convicción: ${aumentar.slice(0, 5).map(a => `${a.ticker} (${a.conviccion})`).join(', ')}.`);
  if (perfil?.aporteMensual && aumentar.length) {
    const destinos = aumentar.slice(0, 3);
    plan.push(`${antesDeComprar ? 'Una vez resuelto lo anterior, tu' : 'Tu'} aporte de ${fmtMoney(perfil.aporteMensual, 'CLP')} al mes puede ir a ${destinos.map(a => a.ticker).join(', ')}${destinos.length > 1 ? ` (unos ${fmtMoney(perfil.aporteMensual / destinos.length, 'CLP')} en cada uno, o uno distinto cada mes para pagar menos comisiones)` : ''}. El plan de compra con nuevo capital lo calcula en detalle.`);
  }
  if (gemelos.length) {
    const top = [...gemelos].sort((a, b) => b.corr - a.corr).slice(0, 3);
    plan.push(`Simplifica: ${top.map(p => `${p.a} y ${p.b}`).join('; ')} se mueven casi igual. Concentra las compras en uno de cada par.`);
  }
  const chicas = pos.filter(a => a.peso < 0.01);
  if (chicas.length >= 3) plan.push(`Tienes ${chicas.length} posiciones de menos de 1% (${chicas.map(a => a.ticker).join(', ')}): aportan poco al resultado. O las llevas a un tamaño que importe o las juntas en tus posiciones principales (ojo con comisiones e impuestos al vender).`);
  const caros = pos.filter(a => a.tipo === 'etf' && (a.fundamentales?.gastoAnual ?? 0) > 0.0075);
  if (caros.length) plan.push(`Revisa el costo de ${caros.map(a => `${a.ticker} (${pct(a.fundamentales!.gastoAnual!, 2)} anual)`).join(', ')}: hay fondos equivalentes más baratos.`);
  const dividendoRiesgo = pos.filter(a => (a.fundamentales?.payout ?? 0) > 1);
  if (dividendoRiesgo.length) plan.push(`${dividendoRiesgo.map(a => a.ticker).join(', ')} reparte${dividendoRiesgo.length > 1 ? 'n' : ''} más dividendos de lo que gana${dividendoRiesgo.length > 1 ? 'n' : ''}: no cuentes con ese dividendo a futuro.`);
  if (!perfil && r.perfil === 'agresivo') plan.push('Tu cartera es de perfil agresivo (volatilidad sobre 22% anual): asegúrate de tener un fondo de emergencia aparte, fuera de la bolsa.');
  return plan;
}

// --- Hallazgos -------------------------------------------------------------------------------------

function buildFindings(
  r: PortfolioSummary, pos: AssetReport[], ex: Exposicion, gemelos: { a: string; b: string; corr: number }[], rf: number, mercado: ContextoMercado | null,
  perfil: PerfilInversionista | null, ajuste: Adecuacion | null,
): Hallazgo[] {
  const out: Hallazgo[] = [];

  if (perfil && ajuste) {
    const masVolatil = r.vol !== null && r.vol > ajuste.volMaxima;
    const caeMas = r.maxDD !== null && r.maxDD > ajuste.caidaTolerable;
    const partes = [`Para un perfil ${ajuste.nivel}, lo razonable es una volatilidad de hasta ${pct(ajuste.volMaxima, 0)} anual y caídas que no superen lo que dices tolerar (${pct(ajuste.caidaTolerable, 0)}).`];
    if (r.vol !== null) partes.push(`Tu cartera: volatilidad de ${pct(r.vol)}${r.maxDD !== null ? ` y una caída máxima de ${pct(r.maxDD, 0)} en los últimos ${r.ventanaAnios} años` : ''}.`);
    if (ajuste.plazoCorto) partes.push('Además necesitas el dinero antes de 3 años, un plazo corto para la bolsa.');
    const desalineado = masVolatil || caeMas || ajuste.plazoCorto;
    out.push({
      nivel: desalineado ? 'alerta' : 'ok',
      titulo: desalineado ? `Tu cartera tiene más riesgo del que corresponde a tu perfil ${ajuste.nivel}` : `Tu cartera calza con tu perfil ${ajuste.nivel}`,
      detalle: partes.join(' '),
    });
  }

  if (mercado) {
    out.push({ nivel: mercado.regimen === 'favorable' ? 'ok' : mercado.regimen === 'defensivo' ? 'alerta' : 'atencion', titulo: mercado.titulo, detalle: mercado.lecturas.slice(0, 3).join(' ') });
  }

  const stops = pos.filter(a => a.stopActivado);
  if (stops.length) {
    out.push({
      nivel: 'alerta',
      titulo: `${stops.length === 1 ? 'Un activo cerró' : `${stops.length} activos cerraron`} dos días bajo su stop de volatilidad: ${stops.map(a => a.ticker).join(', ')}`,
      detalle: 'Cayeron desde su máximo del último mes más de 2 desviaciones estándar mensuales (precios ajustados por dividendos). Revisa si hay una noticia de fondo antes de decidir.',
    });
  }

  const concentrados = pos.filter(a => a.riesgo.veredicto === 'excedido');
  const mayor = [...pos].sort((a, b) => b.pesoEfectivo - a.pesoEfectivo)[0];
  if (concentrados.length) {
    out.push({
      nivel: 'alerta',
      titulo: `Concentración: ${concentrados.map(a => `${a.ticker} (${pct(a.pesoEfectivo)})`).join(', ')}`,
      detalle: `Una mala noticia en un solo activo golpearía todo tu patrimonio. Lo prudente es que ninguna empresa pese más de ${pct(LIMITE_ACCION, 0)} (contando lo que tienes dentro de tus fondos) ni un fondo más de ${pct(LIMITE_FONDO, 0)}.`,
    });
  } else if (mayor) {
    out.push({
      nivel: 'ok',
      titulo: `Sin concentraciones excesivas en un solo activo (la mayor es ${mayor.ticker} con ${pct(mayor.pesoEfectivo)})`,
      detalle: r.posicionesEfectivas !== null
        ? `Por su aporte al riesgo, tu portafolio equivale a ${r.posicionesEfectivas.toFixed(1)} apuestas independientes${r.diversificacion !== null ? ` y la diversificación reduce tu riesgo ${r.diversificacion.toFixed(2)} veces respecto de sumar el de cada activo` : ''}.`
        : 'No hay historial suficiente para medir cómo se reparte el riesgo.',
    });
  }

  const sector = ex.sectores[0];
  if (sector && sector.peso > LIMITE_SECTOR && sector.nombre !== 'Fondos sin detalle') {
    out.push({
      nivel: 'atencion',
      titulo: `Sector concentrado: ${sector.nombre} pesa ${pct(sector.peso, 0)} contando lo que hay dentro de tus fondos`,
      detalle: `Viene de ${sector.via.join(', ')}. Las empresas de un mismo sector caen juntas ante la misma noticia (tasas, regulación, ciclo): lo prudente es que ningún sector pase de ${pct(LIMITE_SECTOR, 0)}.`,
    });
  }
  const chile = ex.regiones.find(x => x.nombre === 'Chile')?.peso ?? 0;
  if (chile > metaChileDe(perfil)) {
    out.push({
      nivel: 'atencion',
      titulo: `${pct(chile, 0)} de tu patrimonio depende de Chile`,
      detalle: `Regiones: ${ex.regiones.map(x => `${x.nombre} ${pct(x.peso, 0)}`).join(', ')}. Chile es menos del 1% de la bolsa mundial; concentrarse en un solo país suma riesgo sin sumar rentabilidad esperada.`,
    });
  }

  const desbalanceados = pos.filter(a => a.aporteRiesgo !== null && a.aporteRiesgo > 0.15 && a.aporteRiesgo > 2 * a.peso);
  if (desbalanceados.length) {
    out.push({
      nivel: 'atencion',
      titulo: `Riesgo concentrado: ${desbalanceados.map(a => `${a.ticker} pesa ${pct(a.peso)} y aporta ${pct(a.aporteRiesgo!)} del riesgo`).join('; ')}`,
      detalle: 'Su volatilidad y su relación con el resto hacen que dominen las subidas y bajadas de tu cartera, aunque su peso parezca moderado.',
    });
  }

  const debiles = pos.filter(a => a.fundamental.veredicto === 'débil');
  if (debiles.length) {
    out.push({
      nivel: 'atencion',
      titulo: `Fundamentales débiles: ${debiles.map(a => a.ticker).join(', ')}`,
      detalle: debiles.map(a => `${a.ticker}: ${a.fundamental.motivos.slice(0, 2).join(' ')}`).join(' '),
    });
  }

  if (r.vol !== null) {
    const partes = [`Volatilidad anual de ${pct(r.vol)} medida en pesos (últimos ${r.ventanaAnios} año${r.ventanaAnios > 1 ? 's' : ''}).`];
    if (r.maxDD !== null) partes.push(`Con tus pesos actuales, en ese período habría caído hasta ${pct(r.maxDD)} desde un máximo.`);
    if (r.var95CLP !== null && r.es95CLP !== null) {
      partes.push(`En 1 de cada 20 días podrías perder más de ${fmtMoney(r.var95CLP, 'CLP')}; en esos días malos, la pérdida promedio es ${fmtMoney(r.es95CLP, 'CLP')}.`);
    }
    out.push({ nivel: r.vol > 0.22 ? 'atencion' : 'ok', titulo: `Perfil de riesgo ${r.perfil}`, detalle: partes.join(' ') });
  }

  if (r.ret1y !== null) {
    const bajoTasa = r.ret1y < rf;
    const vsIndice = r.indice && r.indice.diferencia !== null
      ? ` Frente a un índice con tu misma mezcla de monedas (${r.indice.nombre}), que rindió ${signed(r.indice.ret1y)}, tu cartera ${r.indice.diferencia >= 0 ? 'le ganó' : 'quedó atrás'} por ${pct(Math.abs(r.indice.diferencia))}.`
      : '';
    out.push({
      nivel: bajoTasa || (r.indice?.diferencia ?? 0) < -0.03 ? 'atencion' : 'ok',
      titulo: `Con tus pesos actuales, los últimos 12 meses habrían rendido ${signed(r.ret1y)} en pesos (con dividendos)`,
      detalle: (bajoTasa
        ? `Menos que la tasa libre de riesgo (TPM ${pct(rf)}): un depósito a plazo habría rendido más con menos riesgo.`
        : `${pct(r.ret1y - rf)} sobre la tasa libre de riesgo (TPM ${pct(rf)}).`) + vsIndice
        + ` Es una simulación con tus posiciones de hoy${r.retAnualVentana !== null && r.ventanaAnios > 1 ? `; en ${r.ventanaAnios} años habría rendido ${signed(r.retAnualVentana)} anual` : ''}.`,
    });
  }

  if (gemelos.length) {
    const top = [...gemelos].sort((a, b) => b.corr - a.corr).slice(0, 4);
    out.push({
      nivel: 'atencion',
      titulo: `Posiciones que se mueven casi igual: ${top.map(p => `${p.a}–${p.b} (${p.corr.toFixed(2)})`).join(', ')}`,
      detalle: 'Tener ambas no agrega diversificación. Podrías quedarte con una de cada par y simplificar tu cartera.',
    });
  }

  const sinDatos = pos.filter(a => !a.conDatos);
  if (sinDatos.length || r.cobertura < 0.999) {
    out.push({
      nivel: 'atencion',
      titulo: sinDatos.length
        ? `Sin precios confiables al día: ${sinDatos.map(a => a.ticker).join(', ')}`
        : `El riesgo se mide sobre el ${pct(r.cobertura, 0)} del portafolio`,
      detalle: `Las métricas de riesgo cubren el ${pct(r.cobertura, 0)} del valor (activos con ${r.ventanaAnios} año${r.ventanaAnios > 1 ? 's' : ''} de precios al día). Lo que no tiene datos confiables no recibe recomendaciones de compra o venta.`,
    });
  }

  if (r.sinFechaUSD.posiciones > 0) {
    out.push({
      nivel: 'atencion',
      titulo: `${r.sinFechaUSD.posiciones} posiciones en dólares no tienen fecha de compra`,
      detalle: `Su costo se pasa a pesos con el dólar de hoy, así que el resultado en pesos no incluye la ganancia o pérdida por tipo de cambio de ese ${pct(r.sinFechaUSD.peso, 0)} del portafolio. Al importar las cartolas con su historial de movimientos esto se corrige.`,
    });
  }

  const orden = { alerta: 0, atencion: 1, ok: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

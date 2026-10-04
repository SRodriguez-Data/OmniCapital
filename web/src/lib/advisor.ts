import {
  alignedReturns, annualVol, correlation, dimsonBeta, dot, expectedShortfall, historicalVaR, matVec,
  maxDrawdown, momentum, neweyWestCov, neweyWestVariance, periodReturn, returns, rsi as rsiOf, sma,
  valueOn, volatilityStop, TRADING_DAYS,
} from './quant';
import {
  BENCH_CL, BENCH_GLOBAL, BENCH_US, FX_TICKER, dailyHistory, dolarObservado, liveQuotes, riskFreeRateClp,
  type DailyHistory, type LiveQuote,
} from './marketData';

// Motor de recomendaciones: todas las cifras salen de precios reales y las decisiones de reglas
// explícitas. La IA solo redacta la explicación a partir de este informe.

export interface HoldingInput {
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date?: string | null;
}

export type Accion = 'AUMENTAR' | 'MANTENER' | 'REDUCIR';

export interface AssetReport {
  ticker: string;
  nombre?: string;
  moneda: 'USD' | 'CLP';
  cantidad: number;
  costoPromedio: number;
  precio: number;
  valorCLP: number;
  peso: number;
  pnl: number | null; // en la moneda del activo
  ret1y: number | null;
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
  accion: Accion;
  puntaje: number;
  motivos: string[];
  conDatos: boolean;
  gemeloDe?: string; // activo casi idéntico de mayor peso donde conviene concentrar las compras
}

export interface Hallazgo {
  nivel: 'alerta' | 'atencion' | 'ok';
  titulo: string;
  detalle: string;
}

export interface PortfolioSummary {
  valorCLP: number;
  costoCLP: number;
  pnlCLP: number;
  pnlPct: number | null;
  pesoUSD: number;
  // Riesgo y retorno de los últimos 12 meses con los pesos actuales, en pesos chilenos
  vol: number | null;
  maxDD: number | null;
  ret1y: number | null;
  sharpe: number | null;
  var95: number | null; // pérdida diaria como fracción
  var95CLP: number | null;
  es95: number | null;
  es95CLP: number | null;
  diversificacion: number | null; // suma de riesgos individuales / riesgo del portafolio
  posicionesEfectivas: number | null; // número de apuestas independientes según su aporte al riesgo
  riesgoCambiario: number | null; // parte del riesgo que viene del dólar
  cobertura: number; // parte del valor con historial confiable para medir riesgo
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
  hallazgos: Hallazgo[];
  posiciones: AssetReport[];
  candidatos: AssetReport[];
}

// Covarianza anual en pesos de los activos con historial completo (portafolio y candidatos)
export interface RiskModel {
  tickers: string[];
  cov: number[][];
}

export const LIMITE_ACCION = 0.2; // peso máximo prudente de una empresa individual
export const LIMITE_FONDO = 0.4; // y de un fondo diversificado
export const limiteDe = (a: { diversificado: boolean }) => (a.diversificado ? LIMITE_FONDO : LIMITE_ACCION);
const GEMELOS_CORR = 0.9;
// Fondos chilenos que replican un índice amplio (Yahoo los marca como EQUITY)
const FONDOS_INDICE = new Set(['CFMITNIPSA.SN', 'CFIETFIPSA1.SN']);
// Los ETF apalancados o inversos no son diversificación de largo plazo
const APALANCADO = /\b(2x|3x|ultra|leveraged|inverse|short|bear|bull)\b/i;
const APALANCADOS = new Set(['TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXL', 'SPXS', 'SPXU', 'TNA', 'TZA', 'LABU', 'LABD', 'FNGU', 'UVXY', 'SVXY']);

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

type Metrics = Omit<AssetReport, 'accion' | 'puntaje' | 'motivos' | 'aporteRiesgo' | 'gemeloDe'> & { sinDatosMotivo?: string };

function decide(a: Metrics): Pick<AssetReport, 'accion' | 'puntaje' | 'motivos'> {
  if (!a.conDatos) {
    return { accion: 'MANTENER', puntaje: 0, motivos: [a.sinDatosMotivo ?? 'No hay historial de precios suficiente para evaluarlo; se mantiene sin cambios.'] };
  }

  const motivos: string[] = [];
  let pts = 0;

  // Tendencia: precio contra su media de 200 días
  if (a.distSma200 !== null) {
    if (a.distSma200 >= 0) { pts++; motivos.push(`Cotiza ${pct(a.distSma200)} sobre su media de 200 días: tendencia de largo plazo alcista.`); }
    else { pts--; motivos.push(`Cotiza ${pct(-a.distSma200)} bajo su media de 200 días: tendencia de largo plazo bajista.`); }
  }
  // Momentum 12-1: el factor de impulso más documentado (excluye el último mes, que tiende a revertirse)
  if (a.momentum !== null) {
    if (a.momentum > 0) pts++; else pts--;
    motivos.push(`Momentum ${a.momentumMeses}-1 meses: ${signed(a.momentum)} (${a.momentum > 0 ? 'a favor' : 'en contra'}).`);
  }
  if (a.rsi !== null) {
    if (a.rsi < 30) {
      if (a.distSma200 !== null && a.distSma200 >= 0) { pts++; motivos.push(`RSI ${a.rsi.toFixed(0)}: caída de corto plazo dentro de una tendencia alcista, buen momento para comprar.`); }
      else motivos.push(`RSI ${a.rsi.toFixed(0)}: sobrevendido, pero con tendencia bajista; conviene esperar que se estabilice antes de comprar.`);
    } else if (a.rsi > 70) {
      pts--;
      motivos.push(`RSI ${a.rsi.toFixed(0)}: sobrecomprado, con riesgo de corrección de corto plazo.`);
    }
  }
  if (a.stopActivado && a.stop !== null) {
    pts -= 2;
    motivos.push(`Cerró dos días seguidos bajo su stop de volatilidad (${fmtMoney(a.stop, a.moneda)}): cayó desde su máximo del último mes más de 2 desviaciones estándar mensuales.`);
  }

  let accion: Accion = pts >= 2 ? 'AUMENTAR' : pts <= -2 || a.stopActivado ? 'REDUCIR' : 'MANTENER';

  if (accion === 'AUMENTAR' && a.distSma200 !== null && a.distSma200 > 0.25) {
    accion = 'MANTENER';
    motivos.push(`Está ${pct(a.distSma200)} sobre su media de 200 días, muy estirado: mejor esperar un retroceso para aumentar.`);
  }
  if (accion === 'REDUCIR' && a.diversificado && a.peso <= LIMITE_FONDO) {
    accion = 'MANTENER';
    motivos.push('Es un fondo diversificado de largo plazo: una mala racha del mercado no es motivo suficiente para vender.');
  }

  const limite = limiteDe(a);
  if (a.peso > limite) {
    accion = 'REDUCIR';
    motivos.push(`Pesa ${pct(a.peso)} del portafolio, sobre el máximo prudente de ${pct(limite, 0)}: conviene rebalancear.`);
  } else if (accion === 'AUMENTAR' && a.peso > 0.75 * limite) {
    accion = 'MANTENER';
    motivos.push(`Ya pesa ${pct(a.peso)} del portafolio, cerca del máximo de ${pct(limite, 0)}: no conviene concentrarse más.`);
  }

  if (accion === 'AUMENTAR' && a.vol !== null && a.vol > 0.6) {
    motivos.push(`Volatilidad muy alta (${pct(a.vol, 0)} anual): si aumentas, hazlo con montos pequeños.`);
  }
  if (a.pnl !== null && a.pnl > 0.5) {
    motivos.push(`Acumula ${signed(a.pnl)} desde tu compra${accion !== 'AUMENTAR' ? '; tomar parte de la ganancia es razonable' : ''}.`);
  } else if (a.pnl !== null && a.pnl < -0.25 && accion !== 'AUMENTAR') {
    motivos.push(`Pierde ${pct(-a.pnl)} desde tu compra: revisa si la razón por la que lo compraste sigue vigente.`);
  }

  return { accion, puntaje: pts, motivos };
}

// `candidatos`: tickers fuera del portafolio que se evalúan con las mismas reglas (peso 0), sin entrar
// en las métricas del portafolio. Los usa el optimizador, que además recibe el modelo de riesgo.
export async function buildAdvisorReport(
  items: HoldingInput[],
  candidatos: string[] = [],
): Promise<AdvisorReport & { modelo: RiskModel }> {
  const positions = groupByTicker(items);
  const extras: Position[] = [...new Set(candidatos)]
    .filter(t => !positions.some(p => p.ticker === t))
    .map(t => ({ ticker: t, moneda: t.endsWith('.SN') ? 'CLP' : 'USD', cantidad: 0, costoNativo: 0, lotes: [] }));
  const tickers = [...positions, ...extras].map(p => p.ticker);

  // El dólar se pide desde la compra más antigua, para valorizar el costo de cada lote en pesos
  const oldest = items.map(i => i.purchase_date).filter((d): d is string => !!d).sort()[0];
  const fxDays = oldest ? Math.min(15 * 365, Math.max(400, Math.ceil((Date.now() - new Date(oldest).getTime()) / DAY_MS) + 10)) : 400;

  const [histories, fx, benchUS, benchCL, benchGlobal, quotes, rf, dolar] = await Promise.all([
    Promise.all(tickers.map(t => dailyHistory(t))),
    dailyHistory(FX_TICKER, fxDays),
    dailyHistory(BENCH_US),
    dailyHistory(BENCH_CL),
    dailyHistory(BENCH_GLOBAL),
    liveQuotes(tickers),
    riskFreeRateClp(),
    dolarObservado(),
  ]);
  const usdClp = dolar ?? fx?.closes.at(-1) ?? null;
  if (!usdClp) throw new Error('No se pudo obtener el tipo de cambio del dólar.');

  const histOf = new Map<string, DailyHistory | null>(tickers.map((t, i) => [t, histories[i]]));
  const fxAt = (fecha?: string | null) => (fecha && fx ? valueOn(fx.series, fx.dates, fecha) : undefined) ?? usdClp;

  // 1. Valorización y costo en pesos (el costo en dólares usa el dólar del día de compra, si se conoce)
  const base = positions.map(p => {
    const h = histOf.get(p.ticker) ?? null;
    const q = quotes.get(p.ticker);
    const precio = q?.price ?? h?.closes.at(-1) ?? p.costoNativo / p.cantidad;
    const valorNativo = p.cantidad * precio;
    const aCLP = (monto: number, fecha?: string | null) => (p.moneda === 'USD' ? monto * fxAt(fecha) : monto);
    return {
      p, h, q, precio,
      valorCLP: p.moneda === 'USD' ? valorNativo * usdClp : valorNativo,
      costoCLP: p.lotes.reduce((s, l) => s + aCLP(l.cantidad * l.precio, l.fecha), 0),
      sinFecha: p.moneda === 'USD' && p.lotes.some(l => !l.fecha),
    };
  });
  const totalCLP = base.reduce((s, b) => s + b.valorCLP, 0);
  const costoTotalCLP = base.reduce((s, b) => s + b.costoCLP, 0);

  // 2. Métricas y decisión por activo
  const assess = (p: Position, h: DailyHistory | null, q: LiveQuote | undefined, precio: number, valorCLP: number): AssetReport => {
    const closes = h?.closes ?? [];
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
      beta = dimsonBeta(...alignedReturns(new Map([...h.series].filter(([d]) => d >= cutoff)), bench.series));
    }
    const costoPromedio = p.cantidad > 0 ? p.costoNativo / p.cantidad : 0;
    const sma200 = sma(closes, 200);
    const mom = momentum(closes);
    const nombre = q?.name;
    const apalancado = APALANCADOS.has(p.ticker) || (!!nombre && APALANCADO.test(nombre));

    const metrics: Metrics = {
      ticker: p.ticker,
      nombre,
      moneda: p.moneda,
      cantidad: p.cantidad,
      costoPromedio,
      precio,
      valorCLP,
      peso: totalCLP > 0 ? valorCLP / totalCLP : 0,
      pnl: costoPromedio > 0 ? precio / costoPromedio - 1 : null,
      ret1y: periodReturn(closes, TRADING_DAYS),
      momentum: mom?.valor ?? null,
      momentumMeses: mom?.meses ?? null,
      vol: annualVol(returns(year)),
      maxDD: conDatos ? maxDrawdown(year) : null,
      beta,
      benchmark: benchTicker === BENCH_CL ? 'IPSA' : 'S&P 500',
      rsi: rsiOf(closes.slice(-250)),
      sma200,
      distSma200: sma200 ? precio / sma200 - 1 : null,
      stop: stopCalc?.stop ?? null,
      stopDist: stopCalc ? stopCalc.stop / precio - 1 : null,
      stopActivado,
      diversificado: !apalancado && (q?.quoteType === 'ETF' || q?.quoteType === 'MUTUALFUND' || FONDOS_INDICE.has(p.ticker)),
      conDatos,
      sinDatosMotivo,
    };
    const { sinDatosMotivo: _omit, ...rest } = metrics;
    void _omit;
    return { ...rest, aporteRiesgo: null, ...decide(metrics) };
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

  // 3. Modelo de riesgo en pesos del último año. Solo entran activos con historial fresco que cubra el
  //    año completo; el resto se informa como no cubierto (antes se trataban como si no tuvieran riesgo).
  const cutoff = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
  const cubre = (a: AssetReport) => a.conDatos && (histOf.get(a.ticker)?.dates[0] ?? '9999') <= addDays(cutoff, 10);
  const cubiertos = posiciones.filter(cubre);
  const candidatosCubiertos = evaluados.filter(cubre);
  const universo = [...cubiertos, ...candidatosCubiertos];
  const calendar = [...new Set(universo.flatMap(a => histOf.get(a.ticker)!.dates))].filter(d => d >= cutoff).sort();

  const valorCubierto = cubiertos.reduce((s, a) => s + a.valorCLP, 0);
  const w = cubiertos.map(a => (valorCubierto > 0 ? a.valorCLP / valorCubierto : 0));
  const usdCubierto = cubiertos.reduce((s, a, i) => s + (a.moneda === 'USD' ? w[i] : 0), 0);

  // Retornos diarios locales de cada activo (precio arrastrado en los feriados de su bolsa) y del dólar
  const localReturns = (h: DailyHistory) => returns(calendar.map(d => valueOn(h.series, h.dates, d) ?? h.closes[0]));
  const fxReturns = returns(calendar.map(d => fxAt(d)));
  const localByTicker = new Map(universo.map(a => [a.ticker, localReturns(histOf.get(a.ticker)!)]));
  const clpReturns = (a: AssetReport) => {
    const r = localByTicker.get(a.ticker)!;
    return a.moneda === 'USD' ? r.map((x, t) => (1 + x) * (1 + fxReturns[t]) - 1) : r;
  };
  const T = calendar.length - 1;
  const span = calendar.length > 1 ? (new Date(calendar[T]).getTime() - new Date(calendar[0]).getTime()) / DAY_MS : 0;
  const periodsPerYear = span > 0 ? T * 365 / span : TRADING_DAYS;

  let vol: number | null = null, ret1y: number | null = null, maxDD: number | null = null;
  let var95: number | null = null, es95: number | null = null, diversificacion: number | null = null;
  let posicionesEfectivas: number | null = null, riesgoCambiario: number | null = null;
  let indice: PortfolioSummary['indice'] = null;
  let modelo: RiskModel = { tickers: [], cov: [] };

  if (T >= 60 && cubiertos.length > 0) {
    const clpByTicker = new Map(universo.map(a => [a.ticker, clpReturns(a)]));
    const portfolio = Array.from({ length: T }, (_, t) => cubiertos.reduce((s, a, i) => s + w[i] * clpByTicker.get(a.ticker)![t], 0));
    vol = Math.sqrt(neweyWestVariance(portfolio) * periodsPerYear);
    const index = [1];
    portfolio.forEach(r => index.push(index[index.length - 1] * (1 + r)));
    ret1y = index[index.length - 1] - 1;
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

    // Matriz en pesos para el optimizador (portafolio + candidatos)
    const clpMatrix = Array.from({ length: T }, (_, t) => universo.map(a => clpByTicker.get(a.ticker)![t]));
    const covClp = neweyWestCov(clpMatrix).map(row => row.map(x => x * periodsPerYear));
    modelo = { tickers: universo.map(a => a.ticker), cov: covClp };
    if (vol > 0) {
      const sumaIndividual = cubiertos.reduce((s, _, i) => s + w[i] * Math.sqrt(Math.max(covClp[i][i], 0)), 0);
      diversificacion = sumaIndividual / vol;
    }

    // Índice equivalente: IPSA y acciones globales en pesos, con tu misma mezcla de monedas
    const global = benchGlobal ?? benchUS;
    if (benchCL && global) {
      const rCl = localReturns(benchCL);
      const rGl = localReturns(global).map((x, t) => (1 + x) * (1 + fxReturns[t]) - 1);
      const bench = rCl.map((x, t) => (1 - usdCubierto) * x + usdCubierto * rGl[t]);
      const retB = bench.reduce((acc, r) => acc * (1 + r), 1) - 1;
      indice = {
        nombre: `${pct(1 - usdCubierto, 0)} IPSA + ${pct(usdCubierto, 0)} ${global === benchGlobal ? 'acciones globales (ACWI)' : 'S&P 500'} en pesos`,
        ret1y: retB,
        diferencia: ret1y - retB,
        trackingError: Math.sqrt(neweyWestVariance(portfolio.map((r, t) => r - bench[t])) * periodsPerYear),
      };
    }
  }

  // 4. Grupos de activos casi idénticos (incluye candidatos del escáner contra lo que ya tienes)
  const yearSeries = new Map([...posiciones, ...evaluados].filter(a => a.conDatos).map(a => [
    a.ticker, new Map([...histOf.get(a.ticker)!.series].filter(([d]) => d >= cutoff)),
  ]));
  const conSerie = [...yearSeries.keys()];
  const pares: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < conSerie.length; i++) {
    for (let j = i + 1; j < conSerie.length; j++) {
      const corr = correlation(...alignedReturns(yearSeries.get(conSerie[i])!, yearSeries.get(conSerie[j])!));
      if (corr !== null && corr >= GEMELOS_CORR) pares.push({ a: conSerie[i], b: conSerie[j], corr });
    }
  }
  const byTicker = new Map([...posiciones, ...evaluados].map(a => [a.ticker, a]));
  const grupo = new Map<string, string>(conSerie.map(t => [t, t]));
  const raiz = (t: string): string => (grupo.get(t) === t ? t : raiz(grupo.get(t)!));
  pares.forEach(p => grupo.set(raiz(p.a), raiz(p.b)));
  const grupos = new Map<string, string[]>();
  conSerie.forEach(t => grupos.set(raiz(t), [...(grupos.get(raiz(t)) ?? []), t]));
  for (const miembros of grupos.values()) {
    if (miembros.length < 2) continue;
    const enCartera = miembros.map(t => byTicker.get(t)!).filter(a => a.cantidad > 0).sort((x, y) => y.peso - x.peso);
    const principal = enCartera[0];
    if (!principal) continue;
    for (const t of miembros) {
      const a = byTicker.get(t)!;
      if (a === principal) continue;
      a.gemeloDe = principal.ticker;
      const corr = pares.find(p => (p.a === t && p.b === principal.ticker) || (p.b === t && p.a === principal.ticker))?.corr;
      const parecido = corr ? `correlación ${corr.toFixed(2)}` : 'mismo grupo de activos casi idénticos';
      if (a.cantidad > 0 && a.accion === 'AUMENTAR') {
        a.accion = 'MANTENER';
        a.motivos.push(`Se mueve casi igual que ${principal.ticker} (${parecido}): si vas a aumentar, concentra la compra en ${principal.ticker}.`);
      } else if (a.cantidad === 0) {
        a.motivos.push(`Se mueve casi igual que ${principal.ticker}, que ya tienes (${parecido}): no agrega diversificación.`);
      }
    }
  }

  // 5. Un activo que aporta mucho más riesgo que su peso no debería crecer
  for (const a of posiciones) {
    if (a.accion === 'AUMENTAR' && a.aporteRiesgo !== null && a.aporteRiesgo > 0.15 && a.aporteRiesgo > 2 * a.peso) {
      a.accion = 'MANTENER';
      a.motivos.push(`Pesa ${pct(a.peso)} pero aporta ${pct(a.aporteRiesgo)} del riesgo total: aumentarlo desbalancearía el portafolio.`);
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
    vol,
    maxDD,
    ret1y,
    sharpe: vol && ret1y !== null ? (ret1y - rf) / vol : null,
    var95,
    var95CLP: var95 !== null ? var95 * valorCubierto : null,
    es95,
    es95CLP: es95 !== null ? es95 * valorCubierto : null,
    diversificacion,
    posicionesEfectivas,
    riesgoCambiario,
    cobertura: totalCLP > 0 ? valorCubierto / totalCLP : 0,
    sinFechaUSD: { posiciones: sinFecha.length, peso: totalCLP > 0 ? sinFecha.reduce((s, b) => s + b.valorCLP, 0) / totalCLP : 0 },
    indice,
    perfil,
    diasHistoria: calendar.length,
  };

  return {
    generado: new Date().toISOString(),
    usdClp,
    tasaLibreRiesgo: rf,
    resumen,
    hallazgos: buildFindings(resumen, posiciones, pares.filter(p => byTicker.get(p.a)!.cantidad > 0 && byTicker.get(p.b)!.cantidad > 0), rf),
    posiciones,
    candidatos: evaluados,
    modelo,
  };
}

function addDays(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function buildFindings(r: PortfolioSummary, pos: AssetReport[], gemelos: { a: string; b: string; corr: number }[], rf: number): Hallazgo[] {
  const out: Hallazgo[] = [];

  const stops = pos.filter(a => a.stopActivado);
  if (stops.length) {
    out.push({
      nivel: 'alerta',
      titulo: `${stops.length === 1 ? 'Un activo cerró' : `${stops.length} activos cerraron`} dos días bajo su stop de volatilidad: ${stops.map(a => a.ticker).join(', ')}`,
      detalle: 'Cayeron desde su máximo del último mes más de 2 desviaciones estándar mensuales. Revisa si hay una noticia de fondo antes de decidir mantenerlos.',
    });
  }

  const concentrados = pos.filter(a => a.peso > limiteDe(a));
  const mayor = pos[0];
  if (concentrados.length) {
    out.push({
      nivel: 'alerta',
      titulo: `Concentración: ${concentrados.map(a => `${a.ticker} (${pct(a.peso)})`).join(', ')}`,
      detalle: `Una mala noticia en un solo activo golpearía todo tu patrimonio. Lo prudente es que ninguna empresa pese más de ${pct(LIMITE_ACCION, 0)} ni un fondo más de ${pct(LIMITE_FONDO, 0)}.`,
    });
  } else if (mayor) {
    out.push({
      nivel: 'ok',
      titulo: `Sin concentraciones excesivas (la mayor es ${mayor.ticker} con ${pct(mayor.peso)})`,
      detalle: r.posicionesEfectivas !== null
        ? `Por su aporte al riesgo, tu portafolio equivale a ${r.posicionesEfectivas.toFixed(1)} apuestas independientes${r.diversificacion !== null ? ` y la diversificación reduce tu riesgo ${r.diversificacion.toFixed(2)} veces respecto de sumar el de cada activo` : ''}.`
        : 'No hay historial suficiente para medir cómo se reparte el riesgo.',
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

  // Riesgo por mercado: las acciones de un mismo país se mueven juntas, así que su riesgo pesa más que su valor
  const riesgoChile = pos.filter(a => a.moneda === 'CLP').reduce((s, a) => s + (a.aporteRiesgo ?? 0), 0);
  const pesoChile = 1 - r.pesoUSD;
  if (r.posicionesEfectivas !== null && riesgoChile > 0.5 && riesgoChile > pesoChile + 0.1) {
    out.push({
      nivel: 'atencion',
      titulo: `Chile explica ${pct(riesgoChile, 0)} del riesgo con ${pct(pesoChile, 0)} del valor`,
      detalle: 'Tus acciones chilenas se mueven muy juntas (bancos y el IPSA): agregar más nombres locales casi no reduce el riesgo. Lo que más diversifica es sumar activos globales.',
    });
  } else if (r.posicionesEfectivas !== null && riesgoChile < 0.5 && 1 - riesgoChile > r.pesoUSD + 0.1) {
    out.push({
      nivel: 'atencion',
      titulo: `Tus activos en dólares explican ${pct(1 - riesgoChile, 0)} del riesgo con ${pct(r.pesoUSD, 0)} del valor`,
      detalle: 'Las acciones de EE.UU. (y el tipo de cambio) dominan las subidas y bajadas de tu cartera más de lo que sugiere su peso.',
    });
  }

  if (r.pesoUSD < 0.2) {
    out.push({
      nivel: 'atencion',
      titulo: `Casi todo está en pesos chilenos (${pct(1 - r.pesoUSD, 0)} en CLP)`,
      detalle: 'Tu patrimonio depende de la economía chilena y del peso. Sumar fondos globales en dólares reduce ese riesgo país.',
    });
  } else if (r.pesoUSD > 0.8) {
    out.push({
      nivel: 'atencion',
      titulo: `${pct(r.pesoUSD, 0)} está en dólares`,
      detalle: 'Si el dólar baja, tu portafolio medido en pesos cae aunque las acciones suban. Algo de exposición a Chile equilibra ese riesgo.',
    });
  } else {
    out.push({
      nivel: 'ok',
      titulo: `Monedas equilibradas: ${pct(r.pesoUSD, 0)} USD / ${pct(1 - r.pesoUSD, 0)} CLP`,
      detalle: r.riesgoCambiario !== null
        ? `El tipo de cambio explica ${pct(Math.max(0, r.riesgoCambiario), 0)} del riesgo de tu cartera; ${r.riesgoCambiario < 0 ? 'de hecho, el dólar la amortigua porque suele subir cuando las acciones caen.' : 'el resto viene de las acciones.'}`
        : 'La mezcla de pesos y dólares amortigua los movimientos del tipo de cambio.',
    });
  }

  if (r.vol !== null) {
    const partes = [`Volatilidad anual de ${pct(r.vol)} medida en pesos.`];
    if (r.maxDD !== null) partes.push(`Con tus pesos actuales, en el último año habría caído hasta ${pct(r.maxDD)} desde un máximo.`);
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
      titulo: `Con tus pesos actuales, los últimos 12 meses habrían rendido ${signed(r.ret1y)} en pesos`,
      detalle: (bajoTasa
        ? `Menos que la tasa libre de riesgo (TPM ${pct(rf)}): un depósito a plazo habría rendido más con menos riesgo.`
        : `${pct(r.ret1y - rf)} sobre la tasa libre de riesgo (TPM ${pct(rf)}).`) + vsIndice
        + ' Es una simulación con tus posiciones de hoy: no incluye compras, ventas ni dividendos del período.',
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

  const chicas = pos.filter(a => a.peso < 0.01);
  if (chicas.length >= 3) {
    out.push({
      nivel: 'atencion',
      titulo: `${chicas.length} posiciones pesan menos de 1% cada una: ${chicas.map(a => a.ticker).join(', ')}`,
      detalle: 'Aportan muy poco al resultado total y complican el seguimiento: o las llevas a un tamaño que importe (si su recomendación es AUMENTAR) o las vendes y sumas ese dinero a tus posiciones principales.',
    });
  }

  const sinDatos = pos.filter(a => !a.conDatos);
  if (sinDatos.length || r.cobertura < 0.999) {
    out.push({
      nivel: 'atencion',
      titulo: sinDatos.length
        ? `Sin precios confiables al día: ${sinDatos.map(a => a.ticker).join(', ')}`
        : `El riesgo se mide sobre el ${pct(r.cobertura, 0)} del portafolio`,
      detalle: `Las métricas de riesgo cubren el ${pct(r.cobertura, 0)} del valor (activos con un año completo de precios al día). Lo que no tiene datos confiables no recibe recomendaciones de compra o venta.`,
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

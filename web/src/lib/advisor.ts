import {
  alignedReturns, annualVol, volatilityStop, correlation, beta as betaOf, historicalVaR,
  maxDrawdown, periodReturn, returns, rsi as rsiOf, sma, valueOn, TRADING_DAYS,
} from './quant';
import {
  BENCH_CL, BENCH_US, FX_TICKER, dailyHistory, liveQuotes, riskFreeRateClp, usdClpToday,
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
  ret6m: number | null;
  ret1y: number | null;
  vol: number | null;
  maxDD: number | null;
  beta: number | null;
  benchmark: string;
  rsi: number | null;
  sma50: number | null;
  sma200: number | null;
  distMax52: number | null;
  stop: number | null;
  stopDist: number | null;
  stopActivado: boolean;
  diversificado: boolean;
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
  vol: number | null;
  maxDD: number | null;
  ret1y: number | null;
  sharpe: number | null;
  var95: number | null; // pérdida diaria como fracción
  var95CLP: number | null;
  posicionesEfectivas: number;
  mayorPeso: { ticker: string; peso: number } | null;
  correlacionMedia: number | null;
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

export const PESO_MAXIMO = 0.25;
const PESO_ALTO = 0.15;
const PESO_MAXIMO_FONDO = 0.5;
// Fondos chilenos que replican un índice amplio (Yahoo los marca como EQUITY)
const FONDOS_INDICE = new Set(['CFMITNIPSA.SN', 'CFIETFIPSA1.SN']);

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

function decide(a: Omit<AssetReport, 'accion' | 'puntaje' | 'motivos'>): Pick<AssetReport, 'accion' | 'puntaje' | 'motivos'> {
  if (!a.conDatos) {
    return { accion: 'MANTENER', puntaje: 0, motivos: ['No hay historial de precios suficiente para evaluarlo; se mantiene sin cambios.'] };
  }

  const motivos: string[] = [];
  let pts = 0;
  const sobre200 = a.sma200 !== null ? a.precio / a.sma200 - 1 : null;

  if (sobre200 !== null) {
    if (sobre200 >= 0) { pts++; motivos.push(`Cotiza ${pct(sobre200)} sobre su media de 200 días: tendencia de largo plazo alcista.`); }
    else { pts--; motivos.push(`Cotiza ${pct(-sobre200)} bajo su media de 200 días: tendencia de largo plazo bajista.`); }
  }
  if (a.sma50 !== null && a.sma200 !== null) {
    if (a.sma50 >= a.sma200) { pts++; motivos.push('Su media de 50 días está sobre la de 200: el impulso de mediano plazo acompaña.'); }
    else { pts--; motivos.push('Su media de 50 días está bajo la de 200: el impulso de mediano plazo es negativo.'); }
  }
  if (a.ret6m !== null) {
    if (a.ret6m > 0.02) pts++;
    else if (a.ret6m < -0.02) pts--;
    motivos.push(`Rentabilidad de los últimos 6 meses: ${signed(a.ret6m)}.`);
  }
  if (a.rsi !== null) {
    if (a.rsi < 30) {
      if (sobre200 !== null && sobre200 >= 0) { pts++; motivos.push(`RSI ${a.rsi.toFixed(0)}: caída de corto plazo dentro de una tendencia alcista, buen momento para comprar.`); }
      else motivos.push(`RSI ${a.rsi.toFixed(0)}: sobrevendido, pero con tendencia bajista; conviene esperar que se estabilice antes de comprar.`);
    } else if (a.rsi > 70) {
      pts--;
      motivos.push(`RSI ${a.rsi.toFixed(0)}: sobrecomprado, con riesgo de corrección de corto plazo.`);
    }
  }
  if (a.stopActivado && a.stop !== null) {
    pts -= 2;
    motivos.push(`El precio perforó su stop de volatilidad (${fmtMoney(a.stop, a.moneda)}): cayó desde su máximo del último mes más de lo que este activo cae en 19 de cada 20 meses.`);
  }

  let accion: Accion = pts >= 3 ? 'AUMENTAR' : pts <= -3 || a.stopActivado ? 'REDUCIR' : 'MANTENER';

  if (accion === 'AUMENTAR' && sobre200 !== null && sobre200 > 0.25) {
    accion = 'MANTENER';
    motivos.push(`Está ${pct(sobre200)} sobre su media de 200 días, muy estirado: mejor esperar un retroceso para aumentar.`);
  }
  if (accion === 'REDUCIR' && a.diversificado && a.peso <= PESO_MAXIMO_FONDO) {
    accion = 'MANTENER';
    motivos.push('Es un fondo diversificado de largo plazo: una mala racha del mercado no es motivo suficiente para vender.');
  }

  const limite = a.diversificado ? PESO_MAXIMO_FONDO : PESO_MAXIMO;
  if (a.peso > limite) {
    accion = 'REDUCIR';
    motivos.push(`Pesa ${pct(a.peso)} del portafolio, sobre el máximo prudente de ${pct(limite, 0)}: conviene rebalancear.`);
  } else if (accion === 'AUMENTAR' && !a.diversificado && a.peso > PESO_ALTO) {
    accion = 'MANTENER';
    motivos.push(`Ya pesa ${pct(a.peso)} del portafolio: no conviene concentrarse más en una sola empresa.`);
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

// `candidatos`: tickers fuera del portafolio que se evalúan con las mismas reglas (peso 0),
// sin entrar en las métricas del portafolio. Los usa el optimizador.
export async function buildAdvisorReport(items: HoldingInput[], candidatos: string[] = []): Promise<AdvisorReport> {
  const positions = groupByTicker(items);
  const extras: Position[] = [...new Set(candidatos)]
    .filter(t => !positions.some(p => p.ticker === t))
    .map(t => ({ ticker: t, moneda: t.endsWith('.SN') ? 'CLP' : 'USD', cantidad: 0, costoNativo: 0, lotes: [] }));
  const tickers = [...positions, ...extras].map(p => p.ticker);

  // El dólar se pide desde la compra más antigua, para valorizar el costo de cada lote en pesos
  const oldest = items.map(i => i.purchase_date).filter((d): d is string => !!d).sort()[0];
  const fxDays = oldest ? Math.min(15 * 365, Math.max(400, Math.ceil((Date.now() - new Date(oldest).getTime()) / 86400000) + 10)) : 400;

  const [histories, fx, benchUS, benchCL, quotes, rf] = await Promise.all([
    Promise.all(tickers.map(t => dailyHistory(t))),
    dailyHistory(FX_TICKER, fxDays),
    dailyHistory(BENCH_US),
    dailyHistory(BENCH_CL),
    liveQuotes(tickers),
    riskFreeRateClp(),
  ]);
  const usdClp = await usdClpToday(fx);
  if (!usdClp) throw new Error('No se pudo obtener el tipo de cambio del dólar.');

  const histOf = new Map<string, DailyHistory | null>(tickers.map((t, i) => [t, histories[i]]));
  const fxAt = (fecha?: string | null) => (fecha && fx ? valueOn(fx.series, fx.dates, fecha) : undefined) ?? usdClp;

  // 1. Valorización y costo en pesos (el costo de los activos en dólares usa el dólar del día de compra)
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
    };
  });
  const totalCLP = base.reduce((s, b) => s + b.valorCLP, 0);
  const costoTotalCLP = base.reduce((s, b) => s + b.costoCLP, 0);

  // 2. Métricas y decisión por activo
  const assess = (p: Position, h: DailyHistory | null, q: LiveQuote | undefined, precio: number, valorCLP: number): AssetReport => {
    const closes = h?.closes ?? [];
    const year = closes.slice(-(TRADING_DAYS + 1));
    const conDatos = closes.length >= 60;
    const stopCalc = conDatos ? volatilityStop(closes) : null;
    const benchTicker = p.moneda === 'CLP' ? BENCH_CL : BENCH_US;
    const bench = p.moneda === 'CLP' ? benchCL : benchUS;
    let beta: number | null = null;
    if (p.ticker === benchTicker) beta = 1;
    else if (h && bench && conDatos) {
      const cutoff = h.dates[Math.max(0, h.dates.length - TRADING_DAYS - 1)];
      const recent = new Map([...h.series].filter(([d]) => d >= cutoff));
      beta = betaOf(...alignedReturns(recent, bench.series));
    }
    const costoPromedio = p.cantidad > 0 ? p.costoNativo / p.cantidad : 0;

    const metrics = {
      ticker: p.ticker,
      nombre: q?.name,
      moneda: p.moneda,
      cantidad: p.cantidad,
      costoPromedio,
      precio,
      valorCLP,
      peso: totalCLP > 0 ? valorCLP / totalCLP : 0,
      pnl: costoPromedio > 0 ? precio / costoPromedio - 1 : null,
      ret6m: periodReturn(closes, 126),
      ret1y: periodReturn(closes, TRADING_DAYS),
      vol: annualVol(returns(year)),
      maxDD: conDatos ? maxDrawdown(year) : null,
      beta,
      benchmark: benchTicker === BENCH_CL ? 'IPSA' : 'S&P 500',
      rsi: rsiOf(closes.slice(-250)),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      distMax52: year.length ? precio / Math.max(...year) - 1 : null,
      stop: stopCalc?.stop ?? null,
      stopDist: stopCalc ? stopCalc.stop / precio - 1 : null,
      stopActivado: stopCalc ? precio < stopCalc.stop : false,
      diversificado: q?.quoteType === 'ETF' || q?.quoteType === 'MUTUALFUND' || FONDOS_INDICE.has(p.ticker),
      conDatos,
    };
    return { ...metrics, ...decide(metrics) };
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

  // 3. Riesgo del portafolio: serie diaria en pesos del último año con las cantidades actuales
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const calendar = [...new Set(base.flatMap(b => b.h?.dates ?? []))].filter(d => d >= cutoff).sort();
  const values: number[] = [];
  if (calendar.length > 30) {
    for (const date of calendar) {
      let v = 0;
      for (const b of base) {
        const px = b.h ? valueOn(b.h.series, b.h.dates, date) ?? b.h.closes[0] : b.precio;
        v += b.p.cantidad * px * (b.p.moneda === 'USD' ? fxAt(date) : 1);
      }
      values.push(v);
    }
  }
  const portRets = returns(values);
  const vol = annualVol(portRets);
  const ret1y = values.length > 1 ? values[values.length - 1] / values[0] - 1 : null;
  const var95 = historicalVaR(portRets);
  const sharpe = vol && ret1y !== null ? (ret1y - rf) / vol : null;

  // 4. Concentración y correlaciones (en moneda local, para medir parecido entre negocios)
  const hhi = posiciones.reduce((s, a) => s + a.peso ** 2, 0);
  const pesoUSD = totalCLP > 0 ? posiciones.filter(a => a.moneda === 'USD').reduce((s, a) => s + a.peso, 0) : 0;
  const pares: { a: string; b: string; corr: number }[] = [];
  const ultimoAno = posiciones
    .filter(a => a.conDatos && histOf.get(a.ticker))
    .map(a => ({ ticker: a.ticker, series: new Map([...histOf.get(a.ticker)!.series].filter(([d]) => d >= cutoff)) }));
  for (let i = 0; i < ultimoAno.length; i++) {
    for (let j = i + 1; j < ultimoAno.length; j++) {
      const corr = correlation(...alignedReturns(ultimoAno[i].series, ultimoAno[j].series));
      if (corr !== null) pares.push({ a: ultimoAno[i].ticker, b: ultimoAno[j].ticker, corr });
    }
  }
  const correlacionMedia = pares.length ? pares.reduce((s, x) => s + x.corr, 0) / pares.length : null;
  const mayor = posiciones[0] ? { ticker: posiciones[0].ticker, peso: posiciones[0].peso } : null;

  // Coherencia: si dos activos casi gemelos salen para AUMENTAR, la compra se concentra en el de
  // mayor peso; aumentar ambos no agrega diversificación
  const byTicker = new Map(posiciones.map(a => [a.ticker, a]));
  const gemelos: { gemelo: AssetReport; principal: AssetReport; corr: number }[] = [];
  for (const par of [...pares].filter(x => x.corr >= 0.9).sort((x, y) => y.corr - x.corr)) {
    const a = byTicker.get(par.a)!, b = byTicker.get(par.b)!;
    if (a.accion !== 'AUMENTAR' || b.accion !== 'AUMENTAR' || a.gemeloDe || b.gemeloDe) continue;
    const [principal, gemelo] = a.peso >= b.peso ? [a, b] : [b, a];
    gemelo.gemeloDe = principal.ticker;
    gemelos.push({ gemelo, principal, corr: par.corr });
  }
  // Una cadena FTEC → QQQ → VOO se resuelve al final: la compra va al primero que no es gemelo de otro
  const raiz = (a: AssetReport): AssetReport => (a.gemeloDe ? raiz(byTicker.get(a.gemeloDe)!) : a);
  for (const { gemelo, principal, corr } of gemelos) {
    const destino = raiz(principal);
    gemelo.accion = 'MANTENER';
    gemelo.gemeloDe = destino.ticker;
    gemelo.motivos.push(`Se mueve casi igual que ${principal.ticker} (correlación ${corr.toFixed(2)}): si vas a aumentar, concentra la compra en ${destino.ticker}.`);
  }

  const perfil = vol === null ? null : vol < 0.08 ? 'conservador' : vol < 0.15 ? 'moderado' : vol < 0.22 ? 'moderado-agresivo' : 'agresivo';

  const resumen: PortfolioSummary = {
    valorCLP: totalCLP,
    costoCLP: costoTotalCLP,
    pnlCLP: totalCLP - costoTotalCLP,
    pnlPct: costoTotalCLP > 0 ? totalCLP / costoTotalCLP - 1 : null,
    pesoUSD,
    vol,
    maxDD: maxDrawdown(values),
    ret1y,
    sharpe,
    var95,
    var95CLP: var95 !== null ? var95 * totalCLP : null,
    posicionesEfectivas: hhi > 0 ? 1 / hhi : 0,
    mayorPeso: mayor,
    correlacionMedia,
    perfil,
    diasHistoria: values.length,
  };

  return {
    generado: new Date().toISOString(),
    usdClp,
    tasaLibreRiesgo: rf,
    resumen,
    hallazgos: buildFindings(resumen, posiciones, pares, rf),
    posiciones,
    candidatos: evaluados,
  };
}

function buildFindings(r: PortfolioSummary, pos: AssetReport[], pares: { a: string; b: string; corr: number }[], rf: number): Hallazgo[] {
  const out: Hallazgo[] = [];

  const stops = pos.filter(a => a.stopActivado);
  if (stops.length) {
    out.push({
      nivel: 'alerta',
      titulo: `${stops.length === 1 ? 'Un activo perforó' : `${stops.length} activos perforaron`} su stop de volatilidad: ${stops.map(a => a.ticker).join(', ')}`,
      detalle: 'Cayeron desde su máximo del último mes más de lo que caen en 19 de cada 20 meses. Revisa si hay una noticia de fondo antes de decidir mantenerlos.',
    });
  }

  const concentrados = pos.filter(a => a.peso > (a.diversificado ? PESO_MAXIMO_FONDO : PESO_MAXIMO));
  if (concentrados.length) {
    out.push({
      nivel: 'alerta',
      titulo: `Concentración: ${concentrados.map(a => `${a.ticker} (${pct(a.peso)})`).join(', ')}`,
      detalle: `Una mala noticia en un solo activo golpearía todo tu patrimonio. Lo prudente es que ninguna empresa individual pese más de ${pct(PESO_MAXIMO, 0)}.`,
    });
  } else if (r.mayorPeso) {
    out.push({
      nivel: 'ok',
      titulo: `Sin concentraciones excesivas (la mayor es ${r.mayorPeso.ticker} con ${pct(r.mayorPeso.peso)})`,
      detalle: `Tu portafolio equivale a ${r.posicionesEfectivas.toFixed(1)} posiciones de igual tamaño.`,
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
      detalle: 'La mezcla de pesos y dólares amortigua los movimientos del tipo de cambio.',
    });
  }

  if (r.vol !== null) {
    const partes = [`Volatilidad anual de ${pct(r.vol)}.`];
    if (r.maxDD !== null) partes.push(`En el último año, tu cartera actual llegó a caer ${pct(r.maxDD)} desde un máximo.`);
    if (r.var95CLP !== null && r.var95 !== null) partes.push(`En un día malo (1 de cada 20) podrías perder cerca de ${fmtMoney(r.var95CLP, 'CLP')} (${pct(r.var95)}).`);
    out.push({ nivel: r.vol > 0.22 ? 'atencion' : 'ok', titulo: `Perfil de riesgo ${r.perfil}`, detalle: partes.join(' ') });
  }

  if (r.ret1y !== null) {
    const bajoTasa = r.ret1y < rf;
    out.push({
      nivel: bajoTasa ? 'atencion' : 'ok',
      titulo: `Con tus posiciones actuales, los últimos 12 meses habrían rendido ${signed(r.ret1y)} en pesos`,
      detalle: bajoTasa
        ? `Menos que la tasa libre de riesgo (TPM ${pct(rf)}): un depósito a plazo habría rendido más con menos riesgo.`
        : `Sobre la tasa libre de riesgo (TPM ${pct(rf)}).${r.sharpe !== null ? ` Índice de Sharpe ${r.sharpe.toFixed(2)} (sobre 1 es muy bueno, bajo 0,5 es pobre).` : ''}`,
    });
  }

  const gemelos = pares.filter(p => p.corr >= 0.9).sort((a, b) => b.corr - a.corr).slice(0, 4);
  if (gemelos.length) {
    out.push({
      nivel: 'atencion',
      titulo: `Posiciones que se mueven casi igual: ${gemelos.map(p => `${p.a}–${p.b} (${p.corr.toFixed(2)})`).join(', ')}`,
      detalle: 'Tener ambas no agrega diversificación. Podrías quedarte con una de cada par y simplificar tu cartera.',
    });
  } else if (r.correlacionMedia !== null && r.correlacionMedia < 0.35) {
    out.push({
      nivel: 'ok',
      titulo: `Buena diversificación (correlación media ${r.correlacionMedia.toFixed(2)})`,
      detalle: 'Tus activos no suelen moverse todos juntos, lo que suaviza las caídas.',
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
  if (sinDatos.length) {
    out.push({
      nivel: 'atencion',
      titulo: `Sin historial suficiente: ${sinDatos.map(a => a.ticker).join(', ')}`,
      detalle: 'No se pudieron calcular sus indicadores; se excluyen de las recomendaciones de compra o venta.',
    });
  }

  const orden = { alerta: 0, atencion: 1, ok: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

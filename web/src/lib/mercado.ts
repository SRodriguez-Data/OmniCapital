import { BENCH_CL, BENCH_GLOBAL, BENCH_US, FX_TICKER, dailyHistory, riskFreeRateClp, type DailyHistory } from './marketData';
import { momentum, sma } from './quant';

// Contexto de mercado con reglas explícitas: tendencia de los grandes índices (precio sobre su media de 200 días
// y momentum 12-1), nivel de miedo (VIX contra sus últimos 3 años), dólar, cobre y tasas.

export interface Indicador {
  nombre: string;
  ticker: string;
  valor: number;
  unidad: '' | '%' | 'CLP' | 'USD';
  distSma200: number | null;
  momentum: number | null;     // 12-1
  cambio3m: number | null;
  caidaDesdeMaximo: number | null; // desde el máximo de 12 meses
  tendencia: 'alcista' | 'bajista' | 'lateral' | null;
}

export interface ContextoMercado {
  regimen: 'favorable' | 'cauteloso' | 'defensivo';
  titulo: string;
  lecturas: string[];
  indicadores: Indicador[];
  vixPercentil: number | null;
  tpm: number;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${pct(x)}`;

function indicador(nombre: string, ticker: string, h: DailyHistory | null, unidad: Indicador['unidad']): Indicador | null {
  if (!h || h.closes.length < 60) return null;
  const serie = h.adj; // ajustada por dividendos (en índices y tasas coincide con el cierre)
  const valor = h.closes.at(-1)!;
  const media = sma(serie, 200);
  const dist = media ? serie.at(-1)! / media - 1 : null;
  const mom = momentum(serie)?.valor ?? null;
  const n = serie.length;
  const cambio3m = n > 63 ? serie[n - 1] / serie[n - 64] - 1 : null;
  const ultimoAnio = serie.slice(-253);
  const max = Math.max(...ultimoAnio);
  const tendencia = dist === null ? null : dist > 0.02 && (mom ?? 0) >= 0 ? 'alcista' : dist < -0.02 && (mom ?? 0) <= 0 ? 'bajista' : 'lateral';
  return { nombre, ticker, valor, unidad, distSma200: dist, momentum: mom, cambio3m, caidaDesdeMaximo: max > 0 ? 1 - serie.at(-1)! / max : null, tendencia };
}

let cache: { at: number; data: ContextoMercado } | null = null;

export async function contextoMercado(): Promise<ContextoMercado | null> {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.data;
  const [sp, ipsa, global, vix, fx, cobre, tasa10, tpm] = await Promise.all([
    dailyHistory(BENCH_US, 3 * 365), dailyHistory(BENCH_CL, 3 * 365), dailyHistory(BENCH_GLOBAL, 3 * 365),
    dailyHistory('^VIX', 3 * 365), dailyHistory(FX_TICKER, 3 * 365), dailyHistory('HG=F', 3 * 365), dailyHistory('^TNX', 3 * 365),
    riskFreeRateClp(),
  ]);
  const indicadores = [
    indicador('S&P 500', BENCH_US, sp, ''),
    indicador('IPSA (ETF It Now)', BENCH_CL, ipsa, 'CLP'),
    indicador('Acciones globales (ACWI)', BENCH_GLOBAL, global, 'USD'),
    indicador('Dólar', FX_TICKER, fx, 'CLP'),
    indicador('Cobre', 'HG=F', cobre, 'USD'),
    indicador('Tasa bono EE.UU. 10 años', '^TNX', tasa10, '%'),
  ].filter((x): x is Indicador => x !== null);
  const bolsas = indicadores.filter(i => [BENCH_US, BENCH_CL, BENCH_GLOBAL].includes(i.ticker));
  if (bolsas.length === 0) return null;

  const vixNivel = vix?.closes.at(-1) ?? null;
  const vixPercentil = vix && vixNivel !== null ? vix.closes.filter(c => c <= vixNivel).length / vix.closes.length : null;
  const alcistas = bolsas.filter(b => b.tendencia === 'alcista').length;
  const bajistas = bolsas.filter(b => b.tendencia === 'bajista').length;

  const regimen: ContextoMercado['regimen'] = bajistas >= 2 || (vixNivel ?? 0) > 35 ? 'defensivo'
    : alcistas === bolsas.length && (vixNivel ?? 0) <= 25 ? 'favorable' : 'cauteloso';

  const lecturas: string[] = [];
  for (const b of bolsas) {
    if (b.distSma200 === null) continue;
    lecturas.push(`${b.nombre}: ${b.tendencia === 'alcista' ? 'tendencia alcista' : b.tendencia === 'bajista' ? 'tendencia bajista' : 'sin tendencia clara'} (${signed(b.distSma200)} vs. su media de 200 días${b.momentum !== null ? `, momentum 12-1 ${signed(b.momentum)}` : ''}${b.caidaDesdeMaximo !== null && b.caidaDesdeMaximo > 0.05 ? `, ${pct(b.caidaDesdeMaximo)} bajo su máximo del año` : ''}).`);
  }
  if (vixNivel !== null) {
    const estado = vixNivel < 15 ? 'calma' : vixNivel <= 25 ? 'normal' : vixNivel <= 35 ? 'tensión' : 'pánico';
    lecturas.push(`VIX ${vixNivel.toFixed(1)} (${estado}${vixPercentil !== null ? `; más alto que el ${pct(vixPercentil, 0)} de los días de los últimos 3 años` : ''}).`);
  }
  const dolar = indicadores.find(i => i.ticker === FX_TICKER);
  if (dolar?.cambio3m != null) {
    lecturas.push(`Dólar $${dolar.valor.toFixed(0)}: ${dolar.cambio3m >= 0 ? 'sube' : 'baja'} ${pct(Math.abs(dolar.cambio3m))} en 3 meses (${dolar.cambio3m >= 0 ? 'favorece' : 'resta a'} tus activos en dólares medidos en pesos).`);
  }
  const cu = indicadores.find(i => i.ticker === 'HG=F');
  if (cu?.cambio3m != null) lecturas.push(`Cobre US$${cu.valor.toFixed(2)}/lb: ${signed(cu.cambio3m)} en 3 meses (relevante para la economía y la bolsa chilena).`);
  const t10 = indicadores.find(i => i.ticker === '^TNX');
  lecturas.push(`TPM del Banco Central ${pct(tpm, 2)}${t10 ? `; bono EE.UU. a 10 años ${t10.valor.toFixed(2)}%` : ''}.`);

  const titulo = regimen === 'favorable'
    ? 'Mercado favorable: las bolsas están en tendencia alcista y el miedo es bajo'
    : regimen === 'defensivo'
      ? 'Mercado defensivo: las bolsas están en tendencia bajista o hay pánico'
      : 'Mercado mixto: las tendencias no están alineadas';
  const data: ContextoMercado = { regimen, titulo, lecturas, indicadores, vixPercentil, tpm };
  cache = { at: Date.now(), data };
  return data;
}

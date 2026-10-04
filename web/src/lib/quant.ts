// Matemática de portafolio sin dependencias externas. Todas las funciones reciben series
// ordenadas de la más antigua a la más reciente y devuelven null si no hay datos suficientes.

export const TRADING_DAYS = 252;

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Desviación estándar muestral
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function returns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) out.push(series[i] / series[i - 1] - 1);
  }
  return out;
}

export function annualVol(rets: number[]): number | null {
  return rets.length >= 20 ? std(rets) * Math.sqrt(TRADING_DAYS) : null;
}

// Mayor caída desde un máximo previo, como fracción positiva (0.25 = -25%)
export function maxDrawdown(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}

// Rentabilidad entre hace `sessions` ruedas y hoy
export function periodReturn(closes: number[], sessions: number): number | null {
  if (closes.length <= sessions) return null;
  const start = closes[closes.length - 1 - sessions];
  return start > 0 ? closes[closes.length - 1] / start - 1 : null;
}

export function sma(closes: number[], n: number): number | null {
  return closes.length >= n ? mean(closes.slice(-n)) : null;
}

// RSI de Wilder
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

// Stop de volatilidad: máximo de cierre del último mes menos 2 desviaciones estándar mensuales
// (una caída así ocurre ~1 de cada 20 meses). Usa cierres porque Yahoo no trae máximos y mínimos
// intradía confiables para las acciones chilenas. La distancia al máximo queda entre 5% y 35%.
export function volatilityStop(closes: number[], lookback = 22, sigmas = 2): { stop: number; caidaMax: number } | null {
  if (closes.length < 127) return null;
  const sdMensual = std(returns(closes.slice(-127))) * Math.sqrt(21);
  const caidaMax = Math.min(0.35, Math.max(0.05, sigmas * sdMensual));
  const high = Math.max(...closes.slice(-lookback));
  return { stop: high * (1 - caidaMax), caidaMax };
}

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const sa = std(a.slice(0, n));
  const sb = std(b.slice(0, n));
  return sa > 0 && sb > 0 ? covariance(a, b) / (sa * sb) : null;
}

export function beta(asset: number[], bench: number[]): number | null {
  const n = Math.min(asset.length, bench.length);
  if (n < 20) return null;
  const vb = std(bench.slice(0, n)) ** 2;
  return vb > 0 ? covariance(asset, bench) / vb : null;
}

// VaR histórico: la pérdida diaria que solo se supera el (1 - conf) de los días
export function historicalVaR(rets: number[], conf = 0.95): number | null {
  if (rets.length < 50) return null;
  const sorted = [...rets].sort((a, b) => a - b);
  const idx = Math.floor((1 - conf) * sorted.length);
  return Math.max(0, -sorted[idx]);
}

// Serie de cierres por fecha (YYYY-MM-DD)
export type DatedSeries = Map<string, number>;

// Retornos diarios de dos series en las fechas que ambas comparten
export function alignedReturns(a: DatedSeries, b: DatedSeries): [number[], number[]] {
  const dates = [...a.keys()].filter(d => b.has(d)).sort();
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a0 = a.get(dates[i - 1])!, a1 = a.get(dates[i])!;
    const b0 = b.get(dates[i - 1])!, b1 = b.get(dates[i])!;
    if (a0 > 0 && b0 > 0) {
      ra.push(a1 / a0 - 1);
      rb.push(b1 / b0 - 1);
    }
  }
  return [ra, rb];
}

// Valor de una serie en una fecha, o el último conocido antes de ella
export function valueOn(series: DatedSeries, sortedDates: string[], date: string): number | undefined {
  if (series.has(date)) return series.get(date);
  let lo = 0, hi = sortedDates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 ? series.get(sortedDates[found]) : undefined;
}

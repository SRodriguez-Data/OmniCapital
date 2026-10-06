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

// Volatilidad anual de un activo que cotiza en una sola bolsa
export function annualVol(rets: number[], periodsPerYear = TRADING_DAYS): number | null {
  return rets.length >= 20 ? std(rets) * Math.sqrt(periodsPerYear) : null;
}

// Varianza de largo plazo de Newey-West (pesos de Bartlett). Corrige la autocorrelación que generan
// los cierres asincrónicos: el peso chileno reacciona al día siguiente a lo que hizo Wall Street,
// así que la varianza diaria simple no escala bien a un año.
export function neweyWestVariance(rets: number[], lags = 2): number {
  const n = rets.length;
  if (n < 3) return 0;
  const m = mean(rets);
  const x = rets.map(r => r - m);
  const gamma = (k: number) => {
    let s = 0;
    for (let t = k; t < n; t++) s += x[t] * x[t - k];
    return s / n;
  };
  let v = gamma(0);
  for (let k = 1; k <= lags; k++) v += 2 * (1 - k / (lags + 1)) * gamma(k);
  return Math.max(v, 0);
}

// Matriz de covarianza diaria de Newey-West (T observaciones × N series), semidefinida positiva
export function neweyWestCov(matrix: number[][], lags = 2): number[][] {
  const T = matrix.length;
  const N = T ? matrix[0].length : 0;
  const means = Array.from({ length: N }, (_, j) => mean(matrix.map(row => row[j])));
  const X = matrix.map(row => row.map((v, j) => v - means[j]));
  const cov = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let k = 0; k <= lags; k++) {
    const w = k === 0 ? 1 : 1 - k / (lags + 1);
    for (let t = k; t < T; t++) {
      const a = X[t], b = X[t - k];
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const g = a[i] * b[j] / T;
          cov[i][j] += k === 0 ? g : w * g;
          if (k > 0) cov[j][i] += w * g;
        }
      }
    }
  }
  return cov;
}

// Intensidad óptima de Ledoit-Wolf (2004) para encoger la covarianza muestral hacia el modelo de correlación
// constante. Con muchos activos y pocos datos la matriz muestral exagera diferencias que son ruido; el
// encogimiento las modera. Devuelve el factor (0 = muestral pura, 1 = correlación constante) y la correlación media.
export function ledoitWolfConstantCorrelation(matrix: number[][]): { intensidad: number; correlacionMedia: number } {
  const T = matrix.length;
  const N = T ? matrix[0].length : 0;
  if (T < 30 || N < 2) return { intensidad: 0, correlacionMedia: 0 };
  const means = Array.from({ length: N }, (_, j) => mean(matrix.map(row => row[j])));
  const X = matrix.map(row => row.map((v, j) => v - means[j]));
  const S = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (const x of X) for (let i = 0; i < N; i++) for (let j = i; j < N; j++) S[i][j] += x[i] * x[j] / T;
  for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) S[i][j] = S[j][i];
  const sd = S.map((r, i) => Math.sqrt(Math.max(r[i], 1e-18)));
  let sumCorr = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j) sumCorr += S[i][j] / (sd[i] * sd[j]);
  const rbar = sumCorr / (N * (N - 1));

  // pi = suma de varianzas asintóticas de cada elemento de S; rho = covarianza entre S y el objetivo; gamma = distancia al objetivo
  let pi = 0, rho = 0, gamma = 0;
  const thetaII = Array.from({ length: N }, () => new Array<number>(N).fill(0)); // theta_ii,ij
  for (const x of X) {
    for (let i = 0; i < N; i++) {
      const a = x[i] * x[i] - S[i][i];
      for (let j = 0; j < N; j++) {
        const y = x[i] * x[j] - S[i][j];
        pi += y * y / T;
        thetaII[i][j] += a * y / T;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    rho += thetaII[i][i];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      rho += (rbar / 2) * ((sd[j] / sd[i]) * thetaII[i][j] + (sd[i] / sd[j]) * thetaII[j][i]);
      const f = rbar * sd[i] * sd[j];
      gamma += (f - S[i][j]) ** 2;
    }
  }
  const kappa = gamma > 0 ? (pi - rho) / gamma : 0;
  return { intensidad: Math.max(0, Math.min(1, kappa / T)), correlacionMedia: rbar };
}

// Encoge una covarianza hacia la de correlación constante con la intensidad dada
export function shrinkCov(cov: number[][], intensidad: number, correlacionMedia: number): number[][] {
  const sd = cov.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
  return cov.map((row, i) => row.map((s, j) => (i === j ? s : (1 - intensidad) * s + intensidad * correlacionMedia * sd[i] * sd[j])));
}

export function matVec(m: number[][], v: number[]): number[] {
  return m.map(row => row.reduce((s, x, j) => s + x * v[j], 0));
}

export function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
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

// Momentum 12-1: rentabilidad de los últimos 12 meses sin el último mes (que tiende a revertirse).
// Con menos historia usa 6-1.
export function momentum(closes: number[]): { valor: number; meses: 12 | 6 } | null {
  const n = closes.length;
  for (const [lookback, meses] of [[TRADING_DAYS, 12], [126, 6]] as const) {
    if (n > lookback) {
      const start = closes[n - 1 - lookback];
      const end = closes[n - 1 - 21];
      if (start > 0) return { valor: end / start - 1, meses };
    }
  }
  return null;
}

export function sma(closes: number[], n: number): number | null {
  return closes.length >= n ? mean(closes.slice(-n)) : null;
}

// RSI de Wilder. Una serie sin movimiento es neutral (50), no sobrecomprada.
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
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

// Stop de volatilidad: máximo de cierre del último mes menos 2 desviaciones estándar mensuales.
// Usa cierres porque Yahoo no trae máximos y mínimos intradía confiables para las acciones chilenas.
// La distancia al máximo queda entre 5% y 35%.
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

// Beta de Dimson (rezagos -1, 0 y +1): no subestima la beta de activos poco transados o que cierran
// a distinta hora que su índice
export function dimsonBeta(asset: number[], bench: number[]): number | null {
  const n = Math.min(asset.length, bench.length);
  if (n < 30) return null;
  const a = asset.slice(0, n), b = bench.slice(0, n);
  const vb = std(b) ** 2;
  if (vb <= 0) return null;
  const lead = covariance(a.slice(0, n - 1), b.slice(1)); // índice al día siguiente
  const lag = covariance(a.slice(1), b.slice(0, n - 1)); // índice el día anterior
  return (covariance(a, b) + lead + lag) / vb;
}

// VaR histórico: la pérdida diaria que solo se supera el (1 - conf) de los días
export function historicalVaR(rets: number[], conf = 0.95): number | null {
  if (rets.length < 50) return null;
  const sorted = [...rets].sort((a, b) => a - b);
  return Math.max(0, -sorted[Math.floor((1 - conf) * sorted.length)]);
}

// Expected shortfall (CVaR): la pérdida promedio en ese (1 - conf) de peores días
export function expectedShortfall(rets: number[], conf = 0.95): number | null {
  if (rets.length < 50) return null;
  const sorted = [...rets].sort((a, b) => a - b);
  const tail = sorted.slice(0, Math.max(1, Math.floor((1 - conf) * sorted.length)));
  return Math.max(0, -mean(tail));
}

// Reparte pesos proporcionales a `raw` sin pasar ningún tope. Si los topes suman menos de 1, lo que
// no cabe queda sin asignar (no se le carga al activo con más espacio).
export function capWeights(raw: number[], caps: number[]): { weights: number[]; unallocated: number } {
  const n = raw.length;
  const weights = new Array<number>(n).fill(0);
  const fixed = new Array<boolean>(n).fill(false);
  for (let iter = 0; iter <= n; iter++) {
    const remaining = 1 - weights.reduce((s, w, i) => s + (fixed[i] ? w : 0), 0);
    const free = raw.map((r, i) => (!fixed[i] && r > 0 ? i : -1)).filter(i => i >= 0);
    const sumRaw = free.reduce((s, i) => s + raw[i], 0);
    if (sumRaw <= 0 || remaining <= 1e-12) break;
    const over = free.filter(i => remaining * raw[i] / sumRaw > caps[i]);
    if (over.length === 0) {
      free.forEach(i => { weights[i] = remaining * raw[i] / sumRaw; });
      break;
    }
    over.forEach(i => { weights[i] = caps[i]; fixed[i] = true; });
  }
  return { weights, unallocated: Math.max(0, 1 - weights.reduce((s, w) => s + w, 0)) };
}

// Pesos de paridad de riesgo (cada activo aporta lo mismo al riesgo total) por iteración de punto fijo
export function riskParityWeights(cov: number[][], iterations = 300): number[] {
  const n = cov.length;
  if (n === 0) return [];
  let w = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < iterations; it++) {
    const m = matVec(cov, w);
    const variance = dot(w, m);
    if (variance <= 0) break;
    const next = w.map((wi, i) => (m[i] > 0 ? wi * Math.sqrt(variance / (n * wi * m[i])) : wi));
    const total = next.reduce((s, x) => s + x, 0);
    const normalized = next.map(x => x / total);
    const change = normalized.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
    w = normalized;
    if (change < 1e-10) break;
  }
  return w;
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

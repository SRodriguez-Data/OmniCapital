import YahooFinance from 'yahoo-finance2';
import { supabase } from './supabase';
import type { DatedSeries } from './quant';

// Datos de mercado compartidos por las rutas de análisis (solo runtime Node).
export const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
  versionCheck: false,
});

export const FX_TICKER = 'CLP=X'; // pesos chilenos por dólar
export const BENCH_US = '^GSPC';
// Yahoo no publica el IPSA (^IPSA) desde hace tiempo; el ETF It Now IPSA lo replica en CLP
export const BENCH_CL = 'CFMITNIPSA.SN';
// Acciones globales (MSCI ACWI) para el índice de comparación en pesos
export const BENCH_GLOBAL = 'ACWI';

export interface Dividendo { date: string; amount: number }

export interface DailyHistory {
  ticker: string;
  dates: string[]; // ordenadas, YYYY-MM-DD en la zona horaria de la bolsa
  closes: number[]; // cierres tal como se transaron (para valorizar)
  series: DatedSeries;
  // Cierres ajustados por dividendos (rentabilidad total): el último coincide con el real y los anteriores
  // se rebajan en cada pago, así la caída del día ex-dividendo no parece una pérdida ni un quiebre de tendencia
  adj: number[];
  adjSeries: DatedSeries;
  dividends: Dividendo[];
  dividendsKnown: boolean; // false si no se pudo consultar el historial de dividendos
  source: 'yahoo' | 'supabase';
  fresh: boolean; // el último cierre tiene menos de una semana
  frozen: boolean; // los últimos cierres son idénticos (dato congelado)
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YAHOO_TIMEOUT_MS = 8000;

// Corta la espera de una promesa y libera el temporizador al terminar
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// La señal también cuenta el tiempo en la cola de la librería: cuando Yahoo limita (HTTP 429) los
// trabajos vencidos fallan al instante en vez de ocupar la cola por minutos
export const yahooRequest = () => ({ fetchOptions: { signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) } });

// Fecha del cierre en la zona horaria de la bolsa: Yahoo marca el dólar a la medianoche de Londres
// (23:00 UTC del día anterior en horario de verano) y con toISOString quedaba un día corrido
function dayFormatter(timeZone?: string): (d: Date) => string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    return d => fmt.format(d);
  } catch {
    return d => d.toISOString().slice(0, 10);
  }
}

// Ajuste por dividendos hacia atrás: cada pago D con fecha ex-dividendo d multiplica los cierres anteriores
// a d por (1 - D / cierre del día previo), como hace cualquier serie de "adjusted close"
export function ajustarPorDividendos(dates: string[], closes: number[], dividends: Dividendo[]): number[] {
  const adj = [...closes];
  let factor = 1;
  const pagos = [...dividends].sort((a, b) => b.date.localeCompare(a.date));
  let k = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    adj[i] = closes[i] * factor;
    // Pagos cuya fecha ex-dividendo cae justo después de este cierre
    while (k < pagos.length && pagos[k].date > dates[i]) {
      const D = pagos[k].amount;
      if (i < closes.length - 1 && D > 0 && D < closes[i] * 0.5) factor *= 1 - D / closes[i];
      k++;
    }
    adj[i] = closes[i] * factor;
  }
  return adj;
}

function build(ticker: string, rows: { date: string; close: number }[], source: DailyHistory['source'], dividends: Dividendo[] = [], dividendsKnown = false): DailyHistory | null {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;
  const closes = dates.map(d => byDate.get(d)!);
  const adj = ajustarPorDividendos(dates, closes, dividends);
  const tail = closes.slice(-6);
  return {
    ticker, dates, closes, series: byDate, source,
    adj, adjSeries: new Map(dates.map((d, i) => [d, adj[i]])), dividends, dividendsKnown,
    fresh: Date.now() - new Date(dates[dates.length - 1]).getTime() < 7 * DAY_MS,
    frozen: tail.length === 6 && tail.every(c => c === tail[0]),
  };
}

const conDividendos = (h: DailyHistory, dividends: Dividendo[], known: boolean): DailyHistory =>
  build(h.ticker, h.dates.map((d, i) => ({ date: d, close: h.closes[i] })), h.source, dividends, known) ?? h;

// Dividendos pagados (fecha ex-dividendo y monto por acción), en la moneda del activo
async function yahooDividends(ticker: string, days: number): Promise<Dividendo[]> {
  const period1 = new Date(Date.now() - days * DAY_MS);
  const chart = await withTimeout(
    yahooFinance.chart(ticker, { period1, interval: '1mo', events: 'div' }, yahooRequest()),
    YAHOO_TIMEOUT_MS + 1000, `Yahoo dividendos ${ticker}`,
  );
  const toDay = dayFormatter(chart.meta.exchangeTimezoneName);
  return (chart.events?.dividends ?? []).map(d => ({ date: toDay(new Date(d.date)), amount: d.amount }));
}

async function fromYahoo(ticker: string, days: number): Promise<DailyHistory | null> {
  const period1 = new Date(Date.now() - days * DAY_MS);
  const chart = await withTimeout(
    yahooFinance.chart(ticker, { period1, interval: '1d' }, yahooRequest()),
    YAHOO_TIMEOUT_MS + 1000, `Yahoo ${ticker}`,
  );
  const toDay = dayFormatter(chart.meta.exchangeTimezoneName);
  const dividends = (chart.events?.dividends ?? []).map(d => ({ date: toDay(new Date(d.date)), amount: d.amount }));
  return build(ticker, chart.quotes
    .filter(q => q.date && q.close !== null && q.close !== undefined)
    .map(q => ({ date: toDay(new Date(q.date)), close: q.close as number })), 'yahoo', dividends, true);
}

// El minero diario (GitHub Actions) guarda los cierres en precios_historicos desde 2021
async function fromSupabase(ticker: string, days: number): Promise<DailyHistory | null> {
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  const PAGE = 1000; // máximo de filas por consulta en Supabase
  const rows: { date: string; close: number }[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase
      .from('precios_historicos')
      .select('date, close')
      .eq('ticker', ticker)
      .gte('date', since)
      .order('date', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []).map(r => ({ date: String(r.date).slice(0, 10), close: Number(r.close) })));
    if (!data || data.length < PAGE) break;
  }
  return build(ticker, rows, 'supabase');
}

const usable = (h: DailyHistory) => h.closes.length >= 30 && h.fresh && !h.frozen;

// Caché por instancia con tope de tamaño. Cada ticker se descarga en una ventana fija (2, 5 o 15 años)
// y las consultas más cortas se recortan en memoria, para no repetir descargas ni llenar la memoria.
const WINDOWS = [2 * 365 + 10, 5 * 365 + 10, 15 * 365];
const MAX_ENTRIES = 250;
const TTL_OK = 60 * 60 * 1000;
const TTL_FAIL = 2 * 60 * 1000; // un fallo pasajero (429) no se arrastra por una hora
const cache = new Map<string, { at: number; ttl: number; data: DailyHistory | null }>();
const inFlight = new Map<string, Promise<DailyHistory | null>>();

function cacheGet(key: string): DailyHistory | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key); // se reinserta al final: los menos usados quedan primero
  cache.set(key, hit);
  return hit.data;
}

function cacheSet(key: string, data: DailyHistory | null) {
  cache.set(key, { at: Date.now(), ttl: data && usable(data) ? TTL_OK : TTL_FAIL, data });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

function slice(h: DailyHistory, days: number): DailyHistory {
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  const start = h.dates.findIndex(d => d >= since);
  if (start <= 0) return h;
  const dates = h.dates.slice(start);
  const adj = h.adj.slice(start);
  return {
    ...h, dates, closes: h.closes.slice(start), series: new Map(dates.map(d => [d, h.series.get(d)!])),
    adj, adjSeries: new Map(dates.map((d, i) => [d, adj[i]])), dividends: h.dividends.filter(x => x.date >= dates[0]),
  };
}

async function load(ticker: string, window: number): Promise<DailyHistory | null> {
  // Chile: primero la base del minero (Yahoo congela el historial chileno); resto: primero Yahoo
  const sources = ticker.endsWith('.SN') ? [fromSupabase, fromYahoo] : [fromYahoo, fromSupabase];
  let best: DailyHistory | null = null;
  for (const source of sources) {
    try {
      const h = await source(ticker, window);
      if (h && usable(h)) { best = h; break; }
      if (h && (!best || (best.frozen && !h.frozen) || (!best.fresh && h.fresh) || h.closes.length > best.closes.length)) best = h;
    } catch (e) {
      console.warn(`Sin historia de ${ticker} en ${source.name}:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  // Los cierres del minero no traen los dividendos: se piden a Yahoo para ajustar la serie
  if (best && !best.dividendsKnown && !ticker.startsWith('^') && !ticker.includes('=')) {
    try {
      best = conDividendos(best, await yahooDividends(ticker, window), true);
    } catch (e) {
      console.warn(`Sin dividendos de ${ticker}:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  return best;
}

// Cierres diarios de los últimos `days` días corridos. Si ninguna fuente está al día, devuelve la mejor
// disponible marcada con `fresh`/`frozen` para que quien la use decida si confiar en ella.
export async function dailyHistory(ticker: string, days = 400): Promise<DailyHistory | null> {
  const window = WINDOWS.find(w => w >= days) ?? WINDOWS[WINDOWS.length - 1];
  for (const w of WINDOWS.filter(x => x >= window)) {
    const hit = cacheGet(`${ticker}:${w}`);
    if (hit !== undefined) return hit ? slice(hit, days) : null;
  }
  const key = `${ticker}:${window}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = load(ticker, window).then(data => {
      cacheSet(key, data);
      return data;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const data = await pending;
  return data ? slice(data, days) : null;
}

export interface LiveQuote {
  price: number;
  currency?: string;
  name?: string;
  quoteType?: string;
  time?: string; // fecha (YYYY-MM-DD) de la cotización, para descartar precios atrasados
}

// Precio actual de varios tickers en una sola llamada
export async function liveQuotes(tickers: string[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  if (tickers.length === 0) return out;
  try {
    const quotes = await withTimeout(
      yahooFinance.quote(tickers, { return: 'array' }, yahooRequest()),
      YAHOO_TIMEOUT_MS + 1000, 'Yahoo quote',
    );
    for (const q of quotes) {
      const price = q.regularMarketPrice || q.regularMarketPreviousClose;
      if (q.symbol && price && price > 0) {
        const time = q.regularMarketTime ? new Date(q.regularMarketTime).toISOString().slice(0, 10) : undefined;
        out.set(q.symbol, { price, currency: q.currency, name: q.longName || q.shortName, quoteType: q.quoteType, time });
      }
    }
  } catch (e) {
    console.warn('Yahoo quote falló:', e instanceof Error ? e.message.slice(0, 120) : e);
  }
  return out;
}

async function mindicador(code: string): Promise<number | null> {
  try {
    const res = await fetch(`https://mindicador.cl/api/${code}`, {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 3600 },
    } as RequestInit);
    if (!res.ok) return null;
    const valor = Number((await res.json())?.serie?.[0]?.valor);
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  } catch {
    return null;
  }
}

// Tasa de Política Monetaria del Banco Central como tasa libre de riesgo en pesos (fracción anual)
export async function riskFreeRateClp(): Promise<number> {
  const tpm = await mindicador('tpm');
  return tpm ? tpm / 100 : 0.045;
}

// Dólar observado de hoy según el Banco Central (null si mindicador.cl no responde)
export async function dolarObservado(): Promise<number | null> {
  return mindicador('dolar');
}

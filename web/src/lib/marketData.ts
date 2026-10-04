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

export interface DailyHistory {
  ticker: string;
  dates: string[]; // ordenadas, YYYY-MM-DD
  closes: number[];
  series: DatedSeries;
  source: 'yahoo' | 'supabase';
}

const historyCache = new Map<string, { at: number; data: DailyHistory | null }>();
const HISTORY_TTL = 60 * 60 * 1000;

// Cuando Yahoo limita las consultas (HTTP 429) la librería reintenta durante minutos:
// se corta antes y se usa el respaldo, para que la página nunca quede esperando
const YAHOO_TIMEOUT_MS = 8000;
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000}s`)), ms)),
  ]);
}

function build(ticker: string, rows: { date: string; close: number }[], source: DailyHistory['source']): DailyHistory | null {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;
  return { ticker, dates, closes: dates.map(d => byDate.get(d)!), series: byDate, source };
}

async function fromYahoo(ticker: string, days: number): Promise<DailyHistory | null> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const chart = await withTimeout(yahooFinance.chart(ticker, { period1, interval: '1d' }), YAHOO_TIMEOUT_MS, `Yahoo ${ticker}`);
  return build(ticker, chart.quotes
    .filter(q => q.date && q.close !== null && q.close !== undefined)
    .map(q => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close as number })), 'yahoo');
}

// El minero diario (GitHub Actions) guarda los cierres en precios_historicos desde 2021
async function fromSupabase(ticker: string, days: number): Promise<DailyHistory | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

// Yahoo a veces congela el historial de las acciones chilenas (el mismo cierre durante semanas)
function isStale(h: DailyHistory): boolean {
  const last = h.closes.slice(-8);
  return last.length === 8 && last.every(c => c === last[0]);
}

function usable(h: DailyHistory): boolean {
  return h.closes.length >= 30 && !isStale(h);
}

// Cierres diarios de los últimos `days` días corridos, con caché de 1 hora por instancia.
// Chile: primero la base del minero (Yahoo trae datos congelados); resto: primero Yahoo.
export async function dailyHistory(ticker: string, days = 400): Promise<DailyHistory | null> {
  const key = `${ticker}:${days}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.at < HISTORY_TTL) return cached.data;

  const sources = ticker.endsWith('.SN') ? [fromSupabase, fromYahoo] : [fromYahoo, fromSupabase];
  let best: DailyHistory | null = null;
  for (const source of sources) {
    try {
      const h = await source(ticker, days);
      if (h && usable(h)) { best = h; break; }
      if (h && (!best || h.closes.length > best.closes.length)) best = h;
    } catch (e) {
      console.warn(`Sin historia de ${ticker} en ${source.name}:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  historyCache.set(key, { at: Date.now(), data: best });
  return best;
}

export interface LiveQuote {
  price: number;
  currency?: string;
  name?: string;
  quoteType?: string;
}

// Precio actual de varios tickers en una sola llamada
export async function liveQuotes(tickers: string[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  if (tickers.length === 0) return out;
  try {
    const quotes = await withTimeout(yahooFinance.quote(tickers, { return: 'array' }), YAHOO_TIMEOUT_MS, 'Yahoo quote');
    for (const q of quotes) {
      const price = q.regularMarketPrice || q.regularMarketPreviousClose;
      if (q.symbol && price && price > 0) {
        out.set(q.symbol, { price, currency: q.currency, name: q.longName || q.shortName, quoteType: q.quoteType });
      }
    }
  } catch (e) {
    console.warn('Yahoo quote falló:', e instanceof Error ? e.message.slice(0, 120) : e);
  }
  return out;
}

async function mindicador(code: string): Promise<number | null> {
  try {
    const res = await fetch(`https://mindicador.cl/api/${code}`, { next: { revalidate: 3600 } } as RequestInit);
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

// Dólar observado de hoy (Banco Central). Si falla, el último cierre de Yahoo.
export async function usdClpToday(fx?: DailyHistory | null): Promise<number | null> {
  return (await mindicador('dolar')) ?? fx?.closes.at(-1) ?? null;
}

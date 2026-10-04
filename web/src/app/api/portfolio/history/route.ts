import { NextResponse } from 'next/server';
import { dailyHistory, FX_TICKER } from '@/lib/marketData';
import { TICKER_RE, validDate } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

const MAX_TICKERS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const round = (x: number) => Math.round(x * 10000) / 10000;

// Cierre diario de cada ticker y dólar (CLP por USD) de cada día, desde la compra más antigua
// (mínimo 2 años, máximo 10), en formato de columnas: { dates, fx, series: { TICKER: [...] } }.
// Los feriados de cada bolsa arrastran el último cierre conocido.
export async function POST(request: Request) {
  if (!rateLimit(request, 'history', 40)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ dates: [], fx: [], series: {} });
    }

    const tickers = Array.from(new Set(items.map((i: { ticker: unknown }) => String(i.ticker).trim().toUpperCase())));
    if (tickers.length > MAX_TICKERS || tickers.some(t => !TICKER_RE.test(t))) {
      return NextResponse.json({ error: `Tickers inválidos (máximo ${MAX_TICKERS})` }, { status: 400 });
    }

    const oldest = items.map((i: { purchase_date?: unknown }) => validDate(i.purchase_date)).filter(Boolean).sort()[0] as string | undefined;
    const sinceOldest = oldest ? Math.ceil((Date.now() - new Date(oldest).getTime()) / DAY_MS) : 0;
    const days = Math.min(10 * 365, Math.max(2 * 365, sinceOldest) + 5);

    const [histories, fx] = await Promise.all([
      Promise.all(tickers.map(t => dailyHistory(t, days))),
      dailyHistory(FX_TICKER, days),
    ]);

    const dates = Array.from(new Set(histories.flatMap(h => h?.dates ?? []))).sort();
    const series: Record<string, (number | null)[]> = {};
    tickers.forEach((t, i) => {
      let last: number | null = null;
      series[t] = dates.map(d => {
        const close = histories[i]?.series.get(d);
        if (close !== undefined) last = round(close);
        return last;
      });
    });
    let lastFx: number | null = null;
    const fxColumn = dates.map(d => {
      const v = fx?.series.get(d);
      if (v !== undefined) lastFx = round(v);
      return lastFx;
    });

    return NextResponse.json({ dates, fx: fxColumn, series });
  } catch (error) {
    console.error('Error in global history:', error);
    return NextResponse.json({ error: 'No se pudo obtener el historial de precios' }, { status: 500 });
  }
}

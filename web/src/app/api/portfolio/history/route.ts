import { NextResponse } from 'next/server';
import { dailyHistory, FX_TICKER } from '@/lib/marketData';
import { TICKER_RE } from '@/lib/validation';

const MAX_TICKERS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Devuelve el cierre diario de cada ticker y el dólar (CLP por USD) de cada día, desde la compra más
// antigua (mínimo 2 años, máximo 10).
// El valor del portafolio se calcula en el cliente (necesita fechas de compra y cantidades).
export async function POST(request: Request) {
  try {
    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = Array.from(new Set(items.map((i: { ticker: unknown }) => String(i.ticker).trim().toUpperCase())));
    if (tickers.length > MAX_TICKERS || tickers.some(t => !TICKER_RE.test(t))) {
      return NextResponse.json({ error: `Tickers inválidos (máximo ${MAX_TICKERS})` }, { status: 400 });
    }

    const purchaseDates = items
      .map((i: { purchase_date?: unknown }) => i.purchase_date)
      .filter((d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    const sinceOldest = purchaseDates.length ? Math.ceil((Date.now() - new Date(purchaseDates[0]).getTime()) / DAY_MS) : 0;
    const days = Math.min(10 * 365, Math.max(2 * 365, sinceOldest) + 5);

    const [histories, fx] = await Promise.all([
      Promise.all(tickers.map(t => dailyHistory(t, days))),
      dailyHistory(FX_TICKER, days),
    ]);

    const allDates = new Set<string>();
    histories.forEach(h => h?.dates.forEach(d => allDates.add(d)));
    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) {
      return NextResponse.json([]);
    }

    // Se arrastra el último precio conocido en los feriados de cada mercado
    const last: Record<string, number> = {};
    let lastFx: number | undefined;
    const portfolioHistory = sortedDates.map(date => {
      const prices: Record<string, number> = {};
      tickers.forEach((t, i) => {
        const close = histories[i]?.series.get(date);
        if (close !== undefined) last[t] = close;
        if (last[t] !== undefined) prices[t] = last[t];
      });
      lastFx = fx?.series.get(date) ?? lastFx;
      return { date, prices, fx: lastFx ?? null };
    });

    return NextResponse.json(portfolioHistory);
  } catch (error) {
    console.error('Error in global history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

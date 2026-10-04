import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

// Cache simple en memoria para evitar saturar Yahoo Finance
const historyCache = new Map<string, { timestamp: number, data: { date: Date; close: number | null }[] }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora
const MAX_TICKERS = 60;

// Devuelve el precio de cierre diario de cada ticker de los últimos 2 años.
// El valor del portafolio se calcula en el cliente (necesita fechas de compra y tipo de cambio).
export async function POST(request: Request) {
  try {
    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = Array.from(new Set(items.map((i: { ticker: unknown }) => String(i.ticker))));
    if (tickers.length > MAX_TICKERS) {
      return NextResponse.json({ error: `Máximo ${MAX_TICKERS} activos` }, { status: 400 });
    }

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const period1 = startDate.toISOString().split('T')[0];

    const pricesByDate: Record<string, Record<string, number>> = {};
    const allDates = new Set<string>();

    await Promise.all(tickers.map(async (ticker) => {
      try {
        const cacheKey = `${ticker}-${period1}`;
        let historical: { date: Date; close: number | null }[] = [];

        const cached = historyCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          historical = cached.data;
        } else {
          const res = await yahooFinance.chart(ticker, { period1, interval: '1d' });
          historical = res.quotes;
          historyCache.set(cacheKey, { timestamp: Date.now(), data: historical });
        }

        historical.forEach((row) => {
          if (!row.date || row.close === null || row.close === undefined) return;
          const d = new Date(row.date).toISOString().split('T')[0];
          allDates.add(d);
          if (!pricesByDate[d]) pricesByDate[d] = {};
          pricesByDate[d][ticker] = row.close;
        });
      } catch (err) {
        console.error(`Error fetching history for ${ticker}:`, err);
      }
    }));

    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) {
      return NextResponse.json([]);
    }

    const lastKnownPrice: Record<string, number> = {};
    for (const date of sortedDates) {
      for (const ticker of tickers) {
        if (pricesByDate[date][ticker] !== undefined) {
          lastKnownPrice[ticker] = pricesByDate[date][ticker];
        } else if (lastKnownPrice[ticker] !== undefined) {
          pricesByDate[date][ticker] = lastKnownPrice[ticker];
        }
      }
    }

    const portfolioHistory = sortedDates.map(date => ({ date, prices: pricesByDate[date] }));

    return NextResponse.json(portfolioHistory);
  } catch (error) {
    console.error('Error in global history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// Cache simple en memoria para evitar saturar Yahoo Finance
const historyCache = new Map<string, { timestamp: number, data: any[] }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

export async function POST(request: Request) {
  try {
    const { items, usdClpRate } = await request.json();
    
    if (!items || items.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = Array.from(new Set(items.map((i: any) => String(i.ticker)))) as string[];
    
    // Obtener fecha de inicio (1 año atrás) para el histórico
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const period1 = startDate.toISOString().split('T')[0];

    const pricesByDate: Record<string, Record<string, number>> = {};
    const allDates = new Set<string>();

    await Promise.all(tickers.map(async (ticker) => {
      try {
        const cacheKey = `${ticker}-${period1}`;
        let historical: any[] = [];
        
        const cached = historyCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          historical = cached.data;
        } else {
          historical = await yahooFinance.historical(ticker, { period1, interval: '1d' });
          historyCache.set(cacheKey, { timestamp: Date.now(), data: historical });
        }

        historical.forEach((row: any) => {
          const d = row.date.toISOString().split('T')[0];
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

    const portfolioHistory = [];
    for (const date of sortedDates) {
      let totalValueCLP = 0;
      
      for (const item of items) {
        // Al graficar, asumimos la tenencia actual a lo largo del tiempo
        const price = pricesByDate[date][item.ticker] || item.precio_compra;
        const rate = item.moneda === 'CLP' ? 1 : (usdClpRate || 930);
        totalValueCLP += item.cantidad * price * rate;
      }

      if (totalValueCLP > 0) {
        portfolioHistory.push({
          date,
          totalValue: totalValueCLP,
          prices: { ...pricesByDate[date] }
        });
      }
    }

    return NextResponse.json(portfolioHistory);
  } catch (error) {
    console.error('Error in global history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

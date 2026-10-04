import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { supabase } from '@/lib/supabase';
import { MAX_ITEMS, TICKER_RE } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');

  if (!symbolsParam) {
    return NextResponse.json({ error: 'Faltan tickers' }, { status: 400 });
  }

  const symbols = Array.from(new Set(symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (symbols.length > MAX_ITEMS || symbols.some(s => !TICKER_RE.test(s))) {
    return NextResponse.json({ error: `Tickers inválidos (máximo ${MAX_ITEMS})` }, { status: 400 });
  }

  try {
    const prices: Record<string, number> = {};
    
    // Ejecutar Yahoo Finance con un Timeout generoso para evitar cold starts en Vercel
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Yahoo Timeout")), 9000));
    const quotes = await Promise.race([
      yahooFinance.quote(symbols, { return: 'array' }),
      timeoutPromise
    ]);

    for (const quote of quotes) {
      if (!quote?.symbol) continue;
      const price = quote.regularMarketPrice || quote.regularMarketPreviousClose || quote.postMarketPrice || quote.preMarketPrice;

      if (price) {
        prices[quote.symbol] = price;
        continue;
      }
      // Sin precio en la cotización: último cierre de los últimos 5 días
      try {
        const chart = await yahooFinance.chart(quote.symbol, { period1: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), interval: '1d' });
        const last = chart.quotes.filter(q => q.close !== null && q.close !== undefined).at(-1);
        if (last?.close) prices[quote.symbol] = last.close;
      } catch {
        console.error(`Historical fallback failed for ${quote.symbol}`);
      }
    }

    // Fallback parcial si faltaron algunos
    const missingSymbols = symbols.filter(s => !prices[s]);
    if (missingSymbols.length > 0) {
      Object.assign(prices, await latestClosesFromDb(missingSymbols));
    }

    return NextResponse.json(prices);

  } catch (error) {
    console.error('Live Prices Error (yahoo-finance2):', error);

    // Fallo catastrófico de Yahoo: rescatar todo desde el data warehouse del bot en Supabase
    try {
      return NextResponse.json(await latestClosesFromDb(symbols));
    } catch {
      return NextResponse.json({ error: 'Fallo interno en Yahoo y DB' }, { status: 500 });
    }
  }
}

// Último cierre conocido de cada ticker en precios_historicos (lo llena el minero diario)
async function latestClosesFromDb(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const { data } = await supabase
    .from('precios_historicos')
    .select('ticker, close')
    .in('ticker', tickers)
    .order('date', { ascending: false });

  for (const row of data || []) {
    if (prices[row.ticker] === undefined && row.close) prices[row.ticker] = row.close;
  }
  return prices;
}

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
    const timeoutPromise = new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error("Yahoo Timeout")), 9000));
    const results = await Promise.race([
      yahooFinance.quote(symbols),
      timeoutPromise
    ]);
    const quotes: any[] = Array.isArray(results) ? results : [results];

    for (const quote of quotes) {
      if (quote && quote.symbol) {
        let price = quote.regularMarketPrice || quote.regularMarketPreviousClose || quote.postMarketPrice || quote.preMarketPrice;
        
        if (price) {
          prices[quote.symbol] = price;
        } else {
          try {
            const queryOptions = { period1: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) };
            const hist = (await yahooFinance.historical(quote.symbol, queryOptions)) as any[];
            if (hist && hist.length > 0) {
              prices[quote.symbol] = hist[hist.length - 1].close;
            }
          } catch (e) {
            console.error(`Historical fallback failed for ${quote.symbol}`);
          }
        }
      }
    }

    // Fallback parcial si faltaron algunos
    const missingSymbols = symbols.filter(s => !prices[s]);
    if (missingSymbols.length > 0) {
      const { data } = await supabase
        .from('precios_historicos')
        .select('ticker, close')
        .in('ticker', missingSymbols)
        .order('date', { ascending: false });
        
      if (data) {
        const found = new Set();
        for (const row of data) {
          if (!found.has(row.ticker)) {
            prices[row.ticker] = row.close;
            found.add(row.ticker);
          }
        }
      }
    }

    return NextResponse.json(prices);

  } catch (error) {
    console.error('Live Prices Error (yahoo-finance2):', error);
    
    // Fallo catastrófico de Yahoo: rescatar todo desde Supabase
    try {
      const prices: Record<string, number> = {};
      const { data } = await supabase
        .from('precios_historicos')
        .select('ticker, close')
        .in('ticker', symbols)
        .order('date', { ascending: false });
        
      if (data) {
        const found = new Set();
        for (const row of data) {
          if (!found.has(row.ticker)) {
            prices[row.ticker] = row.close;
            found.add(row.ticker);
          }
        }
      }
      return NextResponse.json(prices);
    } catch(dbError) {
      return NextResponse.json({ error: 'Fallo interno en Yahoo y DB' }, { status: 500 });
    }
  }
}

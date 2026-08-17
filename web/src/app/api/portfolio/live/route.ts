import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');

  if (!symbolsParam) {
    return NextResponse.json({ error: 'Faltan tickers' }, { status: 400 });
  }

  const symbols = symbolsParam.split(',').map(s => s.trim());

  try {
    const prices: Record<string, number> = {};
    
    // We can use quote to get the live market prices. 
    // yahooFinance2 supports array of symbols.
    const results = await yahooFinance.quote(symbols);
    
    // results can be a single object or an array depending on how many symbols were found
    const quotes: any[] = Array.isArray(results) ? results : [results];

    for (const quote of quotes) {
      if (quote && quote.symbol) {
        let price = quote.regularMarketPrice || quote.regularMarketPreviousClose || quote.postMarketPrice || quote.preMarketPrice;
        
        if (price) {
          prices[quote.symbol] = price;
        } else {
          // Último recurso: Historial de 5 días
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

    // Ultimate Fallback: if any symbol is still missing, fetch from Supabase
    const missingSymbols = symbols.filter(s => !prices[s]);
    if (missingSymbols.length > 0) {
      const { data } = await supabase
        .from('precios_historicos')
        .select('ticker, close')
        .in('ticker', missingSymbols)
        .order('date', { ascending: false });
        
      if (data) {
        // Since it returns multiple dates, we just take the first one found per ticker
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
    return NextResponse.json({ error: 'Fallo interno en Yahoo Finance' }, { status: 500 });
  }
}

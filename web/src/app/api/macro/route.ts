import { NextResponse } from 'next/server';
import { yahooFinance, withTimeout } from '@/lib/marketData';

export async function GET() {
  try {
    const tickers = ['^VIX', '^TNX', 'HG=F', 'CL=F', '^GSPC'];
    
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const quote = await withTimeout(yahooFinance.quote(ticker), 8000, `Yahoo ${ticker}`);
          return {
            symbol: ticker,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChange || 0,
            changePercent: quote.regularMarketChangePercent || 0,
            name: quote.shortName || ticker,
          };
        } catch (e) {
          console.error(`Error fetching macro for ${ticker}:`, e);
          return null;
        }
      })
    );

    const validResults = results.filter(r => r !== null);
    
    // Format names for UI
    const nameMap: Record<string, string> = {
      '^VIX': 'VIX (Miedo)',
      '^TNX': 'Bono US 10Y',
      'HG=F': 'Cobre (COMEX)',
      'CL=F': 'Petróleo WTI',
      '^GSPC': 'S&P 500'
    };

    const formattedResults = validResults.map(r => ({
      ...r,
      displayName: nameMap[r!.symbol] || r!.name
    }));

    return NextResponse.json(formattedResults);

  } catch (err: unknown) {
    console.error('API Macro Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { yahooFinance, withTimeout, yahooRequest } from '@/lib/marketData';

const NOMBRES: Record<string, string> = {
  '^VIX': 'VIX (Miedo)',
  '^TNX': 'Bono US 10Y',
  'HG=F': 'Cobre (COMEX)',
  'CL=F': 'Petróleo WTI',
  '^GSPC': 'S&P 500',
};

// Indicadores de la barra superior en una sola consulta; la CDN la comparte entre usuarios por 5 minutos
export async function GET() {
  try {
    const tickers = Object.keys(NOMBRES);
    const quotes = await withTimeout(yahooFinance.quote(tickers, { return: 'array' }, yahooRequest()), 9000, 'Yahoo macro');
    const results = tickers
      .map(symbol => quotes.find(q => q.symbol === symbol))
      .filter((q): q is NonNullable<typeof q> => !!q && !!q.regularMarketPrice)
      .map(q => ({
        symbol: q.symbol,
        price: q.regularMarketPrice || 0,
        change: q.regularMarketChange || 0,
        changePercent: q.regularMarketChangePercent || 0,
        name: q.shortName || q.symbol,
        displayName: NOMBRES[q.symbol] || q.shortName || q.symbol,
      }));
    return NextResponse.json(results, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } });
  } catch (err: unknown) {
    console.error('API Macro Error:', err);
    return NextResponse.json({ error: 'Indicadores no disponibles' }, { status: 502 });
  }
}

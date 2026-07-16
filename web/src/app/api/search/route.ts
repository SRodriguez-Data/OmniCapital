import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      }
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Fallo al buscar en Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const quotes = data?.quotes || [];

    // Filter only equities, etfs, mutual funds
    const results = quotes
      .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND')
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname,
        exchange: q.exchDisp
      }));

    return NextResponse.json(results);

  } catch (error) {
    console.error('API Search Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

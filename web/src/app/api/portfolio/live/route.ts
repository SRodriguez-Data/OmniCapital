import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols');

  if (!symbols) {
    return NextResponse.json({ error: 'Faltan tickers' }, { status: 400 });
  }

  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 } // Cache por 60 segundos
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Fallo al obtener datos de Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const results = data?.quoteResponse?.result;

    if (!results) {
      return NextResponse.json({ error: 'Formato de respuesta inválido de Yahoo Finance' }, { status: 500 });
    }

    const prices: Record<string, number> = {};
    for (const quote of results) {
      prices[quote.symbol] = quote.regularMarketPrice;
    }

    return NextResponse.json(prices);

  } catch (error) {
    console.error('Live Prices Error:', error);
    return NextResponse.json({ error: 'Fallo interno' }, { status: 500 });
  }
}

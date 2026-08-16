import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');
  const purchaseDate = searchParams.get('purchase_date');

  if (!ticker || !purchaseDate) {
    return NextResponse.json({ error: 'Ticker y purchase_date son obligatorios' }, { status: 400 });
  }

  try {
    const pDate = new Date(purchaseDate);
    const period1 = Math.floor(pDate.getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      next: { revalidate: 3600 } // Cache por 1 hora
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Fallo al obtener datos de Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      return NextResponse.json({ error: 'Sin datos históricos para este periodo' }, { status: 404 });
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const history = timestamps.map((ts: number, i: number) => {
      const date = new Date(ts * 1000).toISOString().split('T')[0];
      const price = closes[i];
      return { date, price };
    }).filter((item: any) => item.price !== null);

    return NextResponse.json(history);

  } catch (error) {
    console.error('Asset History Error:', error);
    return NextResponse.json({ error: 'Fallo interno al procesar los datos' }, { status: 500 });
  }
}

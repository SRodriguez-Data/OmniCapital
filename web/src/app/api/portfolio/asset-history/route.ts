import { NextResponse } from 'next/server';
import { dailyHistory } from '@/lib/marketData';
import { TICKER_RE } from '@/lib/validation';

const DAY_MS = 24 * 60 * 60 * 1000;

// Cierres diarios desde la fecha de compra (o de los últimos 2 años si no se conoce)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.trim().toUpperCase() || '';
  const purchaseDate = searchParams.get('purchase_date');

  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 });
  }

  const since = purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) ? purchaseDate : null;
  const days = since ? Math.max(30, Math.ceil((Date.now() - new Date(since).getTime()) / DAY_MS) + 5) : 2 * 365;

  try {
    const history = await dailyHistory(ticker, Math.min(days, 15 * 365));
    if (!history) {
      return NextResponse.json({ error: 'Sin datos históricos para este periodo' }, { status: 404 });
    }
    return NextResponse.json(history.dates
      .filter(d => !since || d >= since)
      .map(date => ({ date, price: history.series.get(date)! })));
  } catch (error) {
    console.error('Asset History Error:', error);
    return NextResponse.json({ error: 'Fallo interno al procesar los datos' }, { status: 500 });
  }
}

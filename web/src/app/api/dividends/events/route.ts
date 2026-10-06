import { NextResponse } from 'next/server';
import { yahooFinance, withTimeout, yahooRequest } from '@/lib/marketData';
import { MAX_ITEMS, TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Dividendos pagados por acción (fecha ex-dividendo y monto) de cada ticker desde una fecha.
// Lo usa el libro de cartolas para estimar los dividendos de los meses con cartola resumida.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = Array.from(new Set((searchParams.get('symbols') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  const desde = searchParams.get('desde') ?? '';

  if (symbols.length === 0 || symbols.length > MAX_ITEMS || symbols.some(s => !TICKER_RE.test(s))) {
    return NextResponse.json({ error: `Tickers inválidos (máximo ${MAX_ITEMS})` }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || Number.isNaN(Date.parse(desde))) {
    return NextResponse.json({ error: 'Fecha "desde" inválida' }, { status: 400 });
  }
  if (!rateLimit(request, 'dividend-events', 30)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const eventos: Record<string, { fecha: string; monto: number }[]> = {};
  await Promise.all(symbols.map(async symbol => {
    try {
      const chart = await withTimeout(yahooFinance.chart(symbol, { period1: desde, interval: '1d', events: 'div' }, yahooRequest()), 10000, `Yahoo ${symbol}`);
      eventos[symbol] = (chart.events?.dividends ?? []).map(d => ({ fecha: new Date(d.date).toISOString().slice(0, 10), monto: d.amount }));
    } catch (e) {
      console.error(`Dividendos de ${symbol}:`, e);
    }
  }));
  return NextResponse.json(eventos);
}

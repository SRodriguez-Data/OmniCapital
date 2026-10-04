import { NextResponse } from 'next/server';
import { dailyHistory, liveQuotes } from '@/lib/marketData';
import { MAX_ITEMS, TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Precio actual de cada ticker: cotización en vivo de Yahoo y, si falta, el último cierre confiable
// (base del minero para Chile, Yahoo para el resto)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');

  if (!symbolsParam) {
    return NextResponse.json({ error: 'Faltan tickers' }, { status: 400 });
  }
  if (!rateLimit(request, 'live', 120)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const symbols = Array.from(new Set(symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (symbols.length > MAX_ITEMS || symbols.some(s => !TICKER_RE.test(s))) {
    return NextResponse.json({ error: `Tickers inválidos (máximo ${MAX_ITEMS})` }, { status: 400 });
  }

  const prices: Record<string, number> = {};
  const quotes = await liveQuotes(symbols);
  for (const [symbol, q] of quotes) prices[symbol] = q.price;

  const missing = symbols.filter(s => prices[s] === undefined);
  const histories = await Promise.all(missing.map(s => dailyHistory(s, 30)));
  missing.forEach((s, i) => {
    const last = histories[i]?.closes.at(-1);
    if (last) prices[s] = last;
  });

  return NextResponse.json(prices);
}

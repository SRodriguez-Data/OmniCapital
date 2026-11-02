import { NextResponse } from 'next/server';
import { fundamentales } from '@/lib/fundamentals';
import { ideasDelBot } from '@/lib/ideas';
import { liveQuotes } from '@/lib/marketData';
import { noticias } from '@/lib/news';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { TICKER_RE } from '@/lib/validation';

export const maxDuration = 60;

const MAX_CARTERA = 10;

// Las oportunidades del día: cada idea del Top (EE.UU. y Chile) con su precio al día, el consenso de los analistas,
// sus múltiplos y sus titulares, más los titulares de tus posiciones principales. Los titulares y el consenso informan;
// lo que decide la compra es el método medido (lib/aporte.ts).
export async function POST(request: Request) {
  if (!rateLimit(request, 'oportunidades', 10)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { cartera?: unknown } | null;
  const cartera = (Array.isArray(body?.cartera) ? body.cartera : [])
    .filter((x): x is { ticker: string; nombre?: string } => typeof x?.ticker === 'string' && TICKER_RE.test(x.ticker))
    .slice(0, MAX_CARTERA)
    .map(x => ({ ticker: x.ticker.toUpperCase(), nombre: typeof x.nombre === 'string' ? x.nombre.slice(0, 120) : undefined }));

  try {
    const ideas = await ideasDelBot();
    if (!ideas) return NextResponse.json({ fecha: null, ideas: [], noticias: {} });
    const lista = [...ideas.us, ...ideas.cl];
    const tickers = lista.map(i => i.ticker);
    const [precios, fund] = await Promise.all([
      liveQuotes(tickers),
      fundamentales(tickers).catch(() => new Map()),
    ]);
    const conNombre = lista.map(i => ({ ...i, nombre: precios.get(i.ticker)?.name ?? fund.get(i.ticker)?.nombre }));
    const titulares = await noticias([
      ...conNombre.map(i => ({ ticker: i.ticker, nombre: i.nombre })),
      ...cartera.filter(c => !tickers.includes(c.ticker)),
    ], 6).catch(() => ({}));
    return NextResponse.json({
      fecha: ideas.fecha,
      ideas: conNombre.map(i => {
        const f = fund.get(i.ticker);
        const q = precios.get(i.ticker);
        return {
          ...i,
          precioHoy: q?.price ?? i.precio, fechaPrecioHoy: q?.time ?? i.fechaPrecio,
          analistas: f?.analistas ?? null, perForward: f?.perForward ?? null, dividendYield: f?.dividendYield ?? null,
          roe: f?.roe ?? null, margen: f?.margen ?? null, crecimientoVentas: f?.crecimientoVentas ?? null,
        };
      }),
      noticias: titulares,
    });
  } catch (err) {
    console.error('Error en oportunidades:', err);
    return NextResponse.json({ error: 'No se pudieron leer las oportunidades. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }
}

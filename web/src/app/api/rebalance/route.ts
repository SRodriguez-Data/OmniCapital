import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';
import { SchemaType, type ResponseSchema } from '@google/generative-ai';
import { genAI, generateText, aiError } from '@/lib/ai';
import { parsePortfolioItems } from '@/lib/validation';
import { fetchUsdClp } from '@/lib/fx';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

type Currency = 'USD' | 'CLP';

interface Candidate { ticker: string; price: number; score: number; rsi?: number; bollinger_lower?: number }

interface Asset {
  ticker: string;
  origen: 'EN_CARTERA' | 'OPORTUNIDAD';
  precio: number; // en la moneda del presupuesto
  pesoActual?: number;
  score?: number;
  rsi?: number;
}

// La IA solo decide cuántas acciones y por qué; los costos los calcula el servidor
const responseSchema: ResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      ticker: { type: SchemaType.STRING },
      sharesToBuy: { type: SchemaType.INTEGER },
      rationale: { type: SchemaType.STRING },
    },
    required: ['ticker', 'sharesToBuy', 'rationale'],
  },
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const budget = Number(body?.budget);
    const currency: Currency = body?.currency === 'CLP' ? 'CLP' : 'USD';

    if (!Number.isFinite(budget) || budget <= 0) {
      return NextResponse.json({ error: 'Monto de inversión inválido' }, { status: 400 });
    }
    if (!genAI) {
      return NextResponse.json({ error: 'Falta GEMINI_API_KEY para el optimizador de IA' }, { status: 500 });
    }
    if (!rateLimit(request, 'rebalance', 15)) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
    const parsed = parsePortfolioItems(body?.items);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { items } = parsed;

    // 1. Top 5 oportunidades del último escaneo del bot
    const { data: iaData } = await supabase
      .from('analisis_ia')
      .select('candidatos_json')
      .order('fecha', { ascending: false })
      .limit(1);

    const candidatos: Candidate[] = [
      ...(iaData?.[0]?.candidatos_json?.us || []),
      ...(iaData?.[0]?.candidatos_json?.cl || []),
    ];
    const externas = candidatos
      .filter(c => typeof c?.ticker === 'string')
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 2. Precios actuales reales de todo el universo invertible, en una sola llamada
    const portfolioTickers = Array.from(new Set(items.map(i => i.ticker)));
    const universe = Array.from(new Set([...portfolioTickers, ...externas.map(c => c.ticker)]));
    const [quotesRaw, usdClp] = await Promise.all([
      yahooFinance.quote(universe, { return: 'array' }).catch(() => []),
      fetchUsdClp(),
    ]);
    const quotes = Array.isArray(quotesRaw) ? quotesRaw : [];

    // Convierte un precio a la moneda del presupuesto. Sin dólar del día no mezclamos monedas.
    const toBudget = (price: number, from: string | undefined): number | null => {
      if (from === currency) return price;
      if (!usdClp) return null;
      if (from === 'USD' && currency === 'CLP') return price * usdClp;
      if (from === 'CLP' && currency === 'USD') return price / usdClp;
      return null; // otras monedas (EUR, etc.) quedan fuera
    };

    const priceOf = new Map<string, number>();
    for (const q of quotes) {
      const p = q.regularMarketPrice;
      if (!q.symbol || !p || p <= 0) continue;
      const converted = toBudget(p, q.currency);
      if (converted) priceOf.set(q.symbol, converted);
    }

    // 3. Universo con precios válidos y pesos actuales del portafolio
    const valorActual = (t: string) => items
      .filter(i => i.ticker === t)
      .reduce((s, i) => s + i.cantidad * (priceOf.get(t) ?? 0), 0);
    const totalCartera = portfolioTickers.reduce((s, t) => s + valorActual(t), 0);

    const assets: Asset[] = [];
    for (const t of portfolioTickers) {
      const precio = priceOf.get(t);
      if (precio) assets.push({ ticker: t, origen: 'EN_CARTERA', precio, pesoActual: totalCartera > 0 ? valorActual(t) / totalCartera * 100 : undefined });
    }
    for (const c of externas) {
      const precio = priceOf.get(c.ticker);
      if (precio && !portfolioTickers.includes(c.ticker)) {
        assets.push({ ticker: c.ticker, origen: 'OPORTUNIDAD', precio, score: c.score, rsi: c.rsi });
      }
    }
    if (assets.length === 0) {
      return NextResponse.json({ error: 'No se pudieron obtener precios actuales para calcular la asignación.' }, { status: 502 });
    }

    const fmt = (n: number) => currency === 'CLP' ? `$${Math.round(n).toLocaleString('es-CL')} CLP` : `$${n.toFixed(2)} USD`;
    const lineas = assets.map(a => {
      const extra = a.origen === 'EN_CARTERA'
        ? (a.pesoActual !== undefined ? `peso actual ${a.pesoActual.toFixed(1)}%` : '')
        : `oportunidad del escáner (score ${a.score?.toFixed(1)}${a.rsi ? `, RSI ${a.rsi.toFixed(1)}` : ''})`;
      return `- ${a.ticker} [${a.origen}] precio ${fmt(a.precio)} ${extra}`;
    }).join('\n');

    const prompt = `Eres un portfolio manager cuantitativo. El cliente tiene ${fmt(budget)} de capital nuevo para invertir HOY.

Activos disponibles (precios actuales ya convertidos a ${currency}):
${lineas}

Decide cuántas acciones ENTERAS ("sharesToBuy") comprar de cada activo.
- Mejora la diversificación: si el portafolio está concentrado, prioriza las OPORTUNIDADES del escáner o los activos con menor peso.
- La suma de sharesToBuy × precio NO debe superar ${fmt(budget)}. Intenta usar la mayor parte del presupuesto.
- Solo puedes usar los tickers listados. Omite los activos donde no compres nada.
- "rationale": una o dos frases concretas de por qué ese activo y esa cantidad.`;

    const { text } = await generateText({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    });

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      console.error('Failed to parse Gemini JSON:', text);
      return NextResponse.json({ error: 'La IA devolvió un formato inválido' }, { status: 502 });
    }

    // 4. Validación: tickers permitidos, enteros, costos con precios reales y nunca sobre el presupuesto
    const byTicker = new Map(assets.map(a => [a.ticker, a]));
    let restante = budget;
    const recommendations = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const asset = byTicker.get(String(r?.ticker).toUpperCase());
      if (!asset) continue;
      byTicker.delete(asset.ticker); // un activo una sola vez
      const shares = Math.min(Math.max(0, Math.floor(Number(r.sharesToBuy) || 0)), Math.floor(restante / asset.precio));
      if (shares <= 0) continue;
      const expectedCost = shares * asset.precio;
      restante -= expectedCost;
      recommendations.push({
        ticker: asset.ticker,
        origen: asset.origen,
        sharesToBuy: shares,
        price: asset.precio,
        expectedCost,
        rationale: typeof r.rationale === 'string' ? r.rationale : '',
      });
    }

    return NextResponse.json({
      recommendations,
      currency,
      budget,
      totalCost: budget - restante,
      usdClp,
    });

  } catch (err: unknown) {
    console.error('API Rebalance Error:', err);
    const { message, status } = aiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

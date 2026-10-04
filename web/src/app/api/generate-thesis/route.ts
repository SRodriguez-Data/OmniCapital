import { NextResponse } from 'next/server';
import { aiConfigured, generateText, aiError } from '@/lib/ai';
import { TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

const num = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : 'N/A');

export async function POST(req: Request) {
  try {
    if (!aiConfigured) {
      return NextResponse.json(
        { error: 'No hay un proveedor de IA configurado en el servidor.' },
        { status: 500 }
      );
    }

    if (!rateLimit(req, 'thesis', 30)) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const body = await req.json();
    const { price, rsi, ema200, pe, div_str, deuda, portfolio } = body;
    const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';

    if (!TICKER_RE.test(ticker)) {
      return NextResponse.json(
        { error: 'Falta el Ticker en la solicitud.' },
        { status: 400 }
      );
    }

    const portafolioContext = typeof portfolio === 'string' && portfolio.trim()
      ? `El portafolio actual del usuario contiene: [${portfolio.slice(0, 1000)}].`
      : "El usuario no tiene activos en su portafolio aún.";

    // distancia_ema200 viene del bot como fracción (-0.09 = 9% bajo la EMA200)
    const emaDist = typeof ema200 === 'number' && Number.isFinite(ema200) ? `${(ema200 * 100).toFixed(1)}%` : 'N/A';

    const prompt = `Actúa como el Director de Estrategia de un Fondo Cuantitativo. Genera una tesis de inversión para la oportunidad detectada en ${ticker}.
${portafolioContext}

Datos de ${ticker}: Precio actual: ${num(price)}, RSI(14): ${num(rsi, 1)}, Distancia a la EMA200: ${emaDist}, P/E: ${String(pe ?? 'N/A').slice(0, 20)}, Dividend Yield: ${String(div_str ?? 'N/A').slice(0, 20)}, Deuda/Equity: ${String(deuda ?? 'N/A').slice(0, 20)}.

Tu respuesta debe ser quirúrgica y estrictamente en 3 viñetas markdown:
1. 🎯 Catalizador de Valor (Analiza P/E, dividendos y deuda).
2. 📊 Estructura Técnica (Analiza el RSI y la distancia a la EMA200).
3. 🔗 Sinergia con Portafolio (Analiza OBLIGATORIAMENTE cómo ${ticker} beneficia o diversifica el portafolio actual del usuario. Si el usuario ya lo tiene, explica si acumular más tiene sentido).
Usa solo los datos entregados; si un dato es N/A, dilo en vez de inventarlo.`;

    const { text } = await generateText(prompt, { speed: 'fast', timeoutMs: 25000 });
    return NextResponse.json({ thesis: text });
  } catch (error: unknown) {
    console.error('Error generando tesis con IA:', error);
    const { message, status } = aiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

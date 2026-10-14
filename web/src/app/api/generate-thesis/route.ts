import { NextResponse } from 'next/server';
import { aiConfigured, generateText, aiError } from '@/lib/ai';
import { TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

const num = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : 'sin dato');

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
    const { price, pe, div_str, deuda, sector, resultados, criterio, portfolio } = body;
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

    // Los textos llegan ya explicados desde la web (p. ej. "75% del patrimonio · calculada del balance al ...")
    const texto = (v: unknown, max = 220) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : 'sin dato');
    const contexto = [
      typeof sector === 'string' && sector.trim() ? `Sector: ${texto(sector, 120)}.` : '',
      typeof resultados === 'string' && resultados.trim() ? `Publica sus resultados trimestrales el ${texto(resultados, 60)}.` : '',
    ].filter(Boolean).join(' ');

    const prompt = `Actúa como el Director de Estrategia de un Fondo Cuantitativo. Genera una tesis de inversión para la idea seleccionada en ${ticker}.
${portafolioContext}

Datos de ${ticker}: Precio actual: ${num(price)}, P/E: ${texto(pe)}, Dividend Yield: ${texto(div_str, 40)}, Deuda/Patrimonio: ${texto(deuda)}.
${contexto}

${typeof criterio === 'string' && criterio.trim() ? `Criterio con que el sistema la eligió (medido en 10 años de datos): ${texto(criterio, 600)}
` : ''}
Tu respuesta debe ser quirúrgica y estrictamente en 3 viñetas markdown:
1. 🎯 Por qué está en la lista (explica el criterio en palabras simples y qué podría hacer que deje de cumplirse).
2. ⚖️ Valoración y riesgos (Analiza P/E, dividendos y deuda; si publica resultados en los próximos días, advierte que ese día el precio puede moverse fuerte).
3. 🔗 Sinergia con Portafolio (Analiza OBLIGATORIAMENTE cómo ${ticker} beneficia o diversifica el portafolio actual del usuario. Si el usuario ya lo tiene, explica si acumular más tiene sentido).
Usa solo los datos entregados, con sus unidades; si un dato no aplica o falta, explica por qué en vez de inventarlo.`;

    const { text } = await generateText(prompt, { speed: 'fast', timeoutMs: 25000 });
    return NextResponse.json({ thesis: text });
  } catch (error: unknown) {
    console.error('Error generando tesis con IA:', error);
    const { message, status } = aiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { SchemaType, type ResponseSchema } from '@google/generative-ai';
import { genAI, MODELS_FAST, generateText, aiError } from '@/lib/ai';
import { parsePortfolioItems } from '@/lib/validation';

export const runtime = 'edge';

const ACCIONES = ['🟢 BUY', '🟡 HOLD', '🔴 SELL'];

// Gemini queda obligado a devolver exactamente esta forma
const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    diagnostico: { type: SchemaType.STRING },
    recomendaciones: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          ticker: { type: SchemaType.STRING },
          accion: { type: SchemaType.STRING, format: 'enum', enum: ACCIONES },
          stop_loss: { type: SchemaType.STRING },
          analisis: { type: SchemaType.STRING },
        },
        required: ['ticker', 'accion', 'stop_loss', 'analisis'],
      },
    },
  },
  required: ['diagnostico', 'recomendaciones'],
};

interface Recomendacion { ticker: string; accion: string; stop_loss: string; analisis: string }

export async function POST(req: Request) {
  try {
    if (!genAI) {
      return NextResponse.json({ error: 'API Key de Gemini no configurada.' }, { status: 500 });
    }

    const body = await req.json();
    const parsed = parsePortfolioItems(body?.items);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { items } = parsed;
    const usdClp = Number(body?.usdClp) > 0 ? Number(body.usdClp) : null;

    // Valorizar cada posición con su precio actual (si el cliente lo trae) y consolidar en CLP
    const rows = items.map(i => {
      const precio = i.precio_actual ?? i.precio_compra;
      const valor = i.cantidad * precio;
      const valorCLP = i.moneda === 'CLP' ? valor : usdClp ? valor * usdClp : null;
      const pnl = i.precio_compra > 0 && i.precio_actual ? (i.precio_actual / i.precio_compra - 1) * 100 : null;
      return { ...i, precio, valorCLP, pnl };
    });
    const totalCLP = rows.every(r => r.valorCLP !== null)
      ? rows.reduce((s, r) => s + (r.valorCLP as number), 0)
      : null;

    const fmt = (n: number, moneda: string) => moneda === 'CLP'
      ? `$${Math.round(n).toLocaleString('es-CL')} CLP`
      : `$${n.toFixed(2)} USD`;

    const posiciones = rows.map(r => {
      const peso = totalCLP && r.valorCLP !== null ? ` | peso ${(r.valorCLP / totalCLP * 100).toFixed(1)}%` : '';
      const pnl = r.pnl !== null ? ` | P&L ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(1)}%` : '';
      return `- ${r.ticker}: ${r.cantidad} acciones | compra ${fmt(r.precio_compra, r.moneda)} | actual ${fmt(r.precio, r.moneda)}${pnl}${peso}`;
    }).join('\n');

    const prompt = `Eres el economista jefe de un family office chileno y analizas un portafolio real de un cliente.
${totalCLP ? `Valor total: $${Math.round(totalCLP).toLocaleString('es-CL')} CLP${usdClp ? ` (dólar a $${usdClp.toFixed(2)})` : ''}.` : ''}

Posiciones:
${posiciones}

Instrucciones:
- Basa tu análisis en estos datos y en tu conocimiento general de cada empresa, sector y país. NO inventes valores de RSI, MACD, soportes ni resistencias: no tienes esos datos.
- "diagnostico": concentración por sector, país y moneda; los 2-3 riesgos principales; y una sugerencia concreta de diversificación o cobertura. Máximo 100 palabras.
- "recomendaciones": exactamente una por cada ticker listado, en el mismo orden.
  - "accion": una de ${ACCIONES.join(', ')}.
  - "stop_loss": un precio concreto en la moneda del activo, por debajo del precio actual, con su distancia porcentual. Ej: "$95.20 USD (-8%)".
  - "analisis": entre 40 y 70 palabras, justificando la acción con el P&L, el peso en el portafolio y los fundamentos del negocio.`;

    const { text, model } = await generateText({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }, MODELS_FAST);

    let data: { diagnostico?: unknown; recomendaciones?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      console.error('Gemini JSON Parse Error:', text);
      return NextResponse.json({ error: 'La IA devolvió una respuesta inválida. Intenta de nuevo.' }, { status: 502 });
    }

    // Solo aceptamos recomendaciones bien formadas y para tickers que el usuario realmente tiene
    const tickers = new Set(items.map(i => i.ticker));
    const recomendaciones = (Array.isArray(data.recomendaciones) ? data.recomendaciones : [])
      .filter((r): r is Recomendacion =>
        typeof r?.ticker === 'string' && tickers.has(r.ticker.toUpperCase()) &&
        typeof r.accion === 'string' && typeof r.stop_loss === 'string' && typeof r.analisis === 'string')
      .map(r => ({ ...r, ticker: r.ticker.toUpperCase() }));

    if (typeof data.diagnostico !== 'string' || !data.diagnostico.trim() || recomendaciones.length === 0) {
      return NextResponse.json({ error: 'La IA devolvió un análisis incompleto. Intenta de nuevo.' }, { status: 502 });
    }

    return NextResponse.json({
      diagnostico: data.diagnostico,
      recomendaciones,
      generado: new Date().toISOString(),
      modelo: model,
    });
  } catch (error: unknown) {
    console.error('Error generating AI analysis:', error);
    const { message, status } = aiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

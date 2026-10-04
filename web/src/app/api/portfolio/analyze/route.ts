import { NextResponse } from 'next/server';
import { aiConfigured, generateText, aiError, type JsonSchema } from '@/lib/ai';
import { parsePortfolioItems, type PortfolioInput } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

export const runtime = 'edge';

const ACCIONES = ['🟢 BUY', '🟡 HOLD', '🔴 SELL'];

// La IA queda obligada a devolver exactamente esta forma
const responseSchema: JsonSchema = {
  type: 'object',
  properties: {
    diagnostico: { type: 'string' },
    recomendaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          accion: { type: 'string', enum: ACCIONES },
          stop_loss: { type: 'string' },
          analisis: { type: 'string' },
        },
        required: ['ticker', 'accion', 'stop_loss', 'analisis'],
        additionalProperties: false,
      },
    },
  },
  required: ['diagnostico', 'recomendaciones'],
  additionalProperties: false,
};

interface Recomendacion { ticker: string; accion: string; stop_loss: string; analisis: string }

export async function POST(req: Request) {
  if (!aiConfigured) {
    return NextResponse.json({ error: 'No hay un proveedor de IA configurado en el servidor.' }, { status: 500 });
  }
  if (!rateLimit(req, 'analyze', 15)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: { items?: unknown; usdClp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = parsePortfolioItems(body?.items);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const usdClp = Number(body?.usdClp) > 0 ? Number(body.usdClp) : null;

  // Edge exige empezar a responder antes de 25s, y el análisis puede tardar más.
  // Mientras la IA trabaja enviamos espacios: el espacio inicial es JSON válido, así que el
  // cliente sigue usando res.json(). Como el status ya salió (200), los errores van en { error }.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(' ')), 5000);
      try {
        const result = await analizar(parsed.items, usdClp);
        controller.enqueue(encoder.encode(JSON.stringify(result)));
      } catch (error: unknown) {
        console.error('Error generating AI analysis:', error);
        controller.enqueue(encoder.encode(JSON.stringify({ error: aiError(error).message })));
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function analizar(items: PortfolioInput[], usdClp: number | null) {
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

  const { text, model } = await generateText(prompt, { schema: responseSchema, speed: 'fast' });

  let data: { diagnostico?: unknown; recomendaciones?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    console.error('AI JSON Parse Error:', text.slice(0, 500));
    throw new Error('La IA devolvió una respuesta inválida.');
  }

  // Solo aceptamos recomendaciones bien formadas y para tickers que el usuario realmente tiene
  const tickers = new Set(items.map(i => i.ticker));
  const recomendaciones = (Array.isArray(data.recomendaciones) ? data.recomendaciones : [])
    .filter((r): r is Recomendacion =>
      typeof r?.ticker === 'string' && tickers.has(r.ticker.toUpperCase()) &&
      typeof r.accion === 'string' && typeof r.stop_loss === 'string' && typeof r.analisis === 'string')
    .map(r => ({ ...r, ticker: r.ticker.toUpperCase() }));

  if (typeof data.diagnostico !== 'string' || !data.diagnostico.trim() || recomendaciones.length === 0) {
    throw new Error('La IA devolvió un análisis incompleto.');
  }

  return {
    diagnostico: data.diagnostico,
    recomendaciones,
    generado: new Date().toISOString(),
    modelo: model,
  };
}

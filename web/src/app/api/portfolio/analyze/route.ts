import { NextResponse } from 'next/server';
import { aiConfigured } from '@/lib/ai';
import { parsePortfolioItems } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { buildAdvisorReport } from '@/lib/advisor';

// Node (no Edge): necesita yahoo-finance2. Descarga 3 años de precios, dividendos, fundamentales y contexto de
// mercado de todos los activos; la primera vez en una instancia nueva puede tardar más de un minuto.
export const maxDuration = 120;

// Devuelve el informe calculado. La redacción con IA va aparte (/api/portfolio/redaccion), para que el
// informe aparezca apenas están los números y la IA tenga su propio tiempo.
export async function POST(req: Request) {
  const started = Date.now();
  if (!rateLimit(req, 'analyze', 15)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = parsePortfolioItems(body?.items);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { modelo: _modelo, ...report } = await buildAdvisorReport(parsed.items);
    void _modelo; // la matriz de riesgo es para el optimizador, no para el navegador
    console.log(`Informe de ${parsed.items.length} activos calculado en ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return NextResponse.json({
      ...report,
      // Mientras llega la redacción, el diagnóstico es el plan calculado con reglas
      diagnostico: report.estrategia.slice(0, 3).join(' '),
      posiciones: report.posiciones.map(p => ({ ...p, comentarioIa: '' })),
      modelo: null,
      avisoIa: aiConfigured ? null : 'La IA no está configurada; se muestra el análisis calculado.',
      redaccionPendiente: aiConfigured,
    });
  } catch (error) {
    console.error('Error construyendo el informe:', error);
    return NextResponse.json({ error: 'No se pudieron obtener los datos de mercado. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }
}

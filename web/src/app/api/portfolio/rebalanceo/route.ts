import { NextResponse } from 'next/server';
import { parsePortfolioItems } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { buildAdvisorReport } from '@/lib/advisor';
import { METAS_CHILE, META_CHILE_DEFECTO } from '@/lib/perfil';
import { oportunidadesDelBot, planRebalanceo } from '@/lib/rebalanceo';

export const maxDuration = 60;

const MAX_APORTE = 1e12;

// Rebalanceo completo: qué vender, qué comprar con lo obtenido y a qué precio, más los precios que cambiarían la
// decisión. Es el mismo cálculo que hace cada día el agente que avisa por Telegram (scripts/agente-cartera.ts).
export async function POST(request: Request) {
  if (!rateLimit(request, 'rebalanceo', 15)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  let body: { items?: unknown; metaChile?: unknown; aporte?: unknown; fraccionar?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = parsePortfolioItems(body?.items);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const meta = Number(body?.metaChile);
  const metaChile = (METAS_CHILE as readonly number[]).includes(meta) ? meta : META_CHILE_DEFECTO;
  const aporte = body?.aporte === undefined || body?.aporte === '' ? 0 : Number(body.aporte);
  if (!Number.isFinite(aporte) || aporte < 0 || aporte > MAX_APORTE) {
    return NextResponse.json({ error: 'Aporte inválido.' }, { status: 400 });
  }

  try {
    const oportunidades = await oportunidadesDelBot().catch(() => []);
    const { modelo, ...report } = await buildAdvisorReport(parsed.items, oportunidades);
    return NextResponse.json(planRebalanceo(report, modelo, { metaChile, aporteCLP: aporte, fraccionar: body?.fraccionar !== false }));
  } catch (err) {
    console.error('Error calculando el rebalanceo:', err);
    return NextResponse.json({ error: 'No se pudieron obtener los datos de mercado. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }
}

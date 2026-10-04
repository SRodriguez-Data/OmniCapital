import { NextResponse } from 'next/server';
import { aiConfigured, generateText, aiError, type JsonSchema } from '@/lib/ai';
import { parsePortfolioItems } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { buildAdvisorReport, fmtMoney, type AdvisorReport } from '@/lib/advisor';

// Node (no Edge): necesita yahoo-finance2 para el historial de precios
export const maxDuration = 60;

const AI_TIMEOUT_MS = 35000;

// La IA solo redacta: no decide acciones ni inventa cifras
const responseSchema: JsonSchema = {
  type: 'object',
  properties: {
    diagnostico: { type: 'string' },
    posiciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ticker: { type: 'string' }, analisis: { type: 'string' } },
        required: ['ticker', 'analisis'],
        additionalProperties: false,
      },
    },
  },
  required: ['diagnostico', 'posiciones'],
  additionalProperties: false,
};

const pct = (x: number | null, digits = 1) => (x === null ? 'N/D' : `${(x * 100).toFixed(digits)}%`);

export async function POST(req: Request) {
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

  let report: AdvisorReport;
  try {
    const raw = body.items as { purchase_date?: unknown }[];
    report = await buildAdvisorReport(parsed.items.map((i, idx) => ({
      ...i,
      purchase_date: typeof raw[idx]?.purchase_date === 'string' ? raw[idx].purchase_date as string : null,
    })));
  } catch (error) {
    console.error('Error construyendo el informe:', error);
    return NextResponse.json({ error: 'No se pudieron obtener los precios de mercado. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }

  // Texto por defecto, armado con las mismas reglas: la pestaña funciona aunque la IA no responda
  let diagnostico = report.hallazgos.slice(0, 3).map(h => `${h.titulo}. ${h.detalle}`).join(' ');
  const analisis = new Map(report.posiciones.map(p => [p.ticker, p.motivos.join(' ')]));
  let modelo: string | null = null;
  let avisoIa: string | null = null;

  if (aiConfigured) {
    try {
      const { text, model } = await Promise.race([
        generateText(buildPrompt(report), { schema: responseSchema, speed: 'fast' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS)),
      ]);
      const data = JSON.parse(text);
      if (typeof data?.diagnostico === 'string' && data.diagnostico.trim()) diagnostico = data.diagnostico.trim();
      for (const p of Array.isArray(data?.posiciones) ? data.posiciones : []) {
        const t = typeof p?.ticker === 'string' ? p.ticker.toUpperCase() : '';
        if (analisis.has(t) && typeof p.analisis === 'string' && p.analisis.trim()) analisis.set(t, p.analisis.trim());
      }
      modelo = model;
    } catch (error) {
      console.error('IA no disponible para el diagnóstico:', error);
      avisoIa = `${aiError(error).message} Se muestra el análisis calculado sin redacción de IA.`;
    }
  } else {
    avisoIa = 'La IA no está configurada; se muestra el análisis calculado.';
  }

  return NextResponse.json({
    ...report,
    diagnostico,
    posiciones: report.posiciones.map(p => ({ ...p, analisis: analisis.get(p.ticker) ?? '' })),
    modelo,
    avisoIa,
  });
}

function buildPrompt(r: AdvisorReport): string {
  const s = r.resumen;
  const lineas = r.posiciones.map(p => [
    `- ${p.ticker}${p.nombre ? ` (${p.nombre})` : ''}: DECISIÓN ${p.accion}`,
    `peso ${pct(p.peso)}`,
    `P&L desde compra ${pct(p.pnl)}`,
    `6m ${pct(p.ret6m)}`,
    `12m ${pct(p.ret1y)}`,
    `volatilidad ${pct(p.vol, 0)}`,
    `beta vs ${p.benchmark} ${p.beta?.toFixed(2) ?? 'N/D'}`,
    `RSI ${p.rsi?.toFixed(0) ?? 'N/D'}`,
    `stop ${p.stop !== null ? `${fmtMoney(p.stop, p.moneda)} (${pct(p.stopDist)})` : 'N/D'}`,
    `motivos: ${p.motivos.join(' ')}`,
  ].join(' | ')).join('\n');

  return `Eres un asesor de inversiones chileno que explica a un cliente no experto el informe de su portafolio.
Todas las cifras y decisiones ya fueron calculadas con precios reales. Tu trabajo es SOLO redactarlas con claridad.

Portafolio: valor ${fmtMoney(s.valorCLP, 'CLP')} CLP, resultado desde la compra ${pct(s.pnlPct)}, ${pct(s.pesoUSD, 0)} en dólares.
Riesgo (últimos 12 meses con las posiciones actuales): volatilidad ${pct(s.vol)}, caída máxima ${pct(s.maxDD)}, rentabilidad ${pct(s.ret1y)}, Sharpe ${s.sharpe?.toFixed(2) ?? 'N/D'}, perfil ${s.perfil ?? 'N/D'}. Tasa libre de riesgo (TPM) ${pct(r.tasaLibreRiesgo)}.
Hallazgos:
${r.hallazgos.map(h => `- [${h.nivel}] ${h.titulo}. ${h.detalle}`).join('\n')}

Posiciones:
${lineas}

Reglas:
- No cambies ninguna DECISIÓN ni inventes cifras, noticias, precios objetivo ni indicadores que no estén arriba.
- Español de Chile, claro y directo, sin jerga innecesaria.
- "diagnostico": 90 a 130 palabras. Qué tan sano está el portafolio, sus 2 o 3 problemas principales y qué haría primero.
- "posiciones": una por cada ticker, en el mismo orden. "analisis": 35 a 60 palabras que expliquen la decisión con los números de sus motivos y digan qué haría el cliente en concreto.`;
}

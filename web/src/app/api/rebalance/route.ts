import { NextResponse } from 'next/server';
import { aiConfigured, generateText } from '@/lib/ai';
import { parsePortfolioItems } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { supabase } from '@/lib/supabase';
import { buildAdvisorReport, fmtMoney } from '@/lib/advisor';
import { planPurchases } from '@/lib/optimizer';

export const maxDuration = 60;

const AI_TIMEOUT_MS = 20000;
const MAX_BUDGET = 1e12;

interface Candidate { ticker?: unknown; score?: unknown }

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const budget = Number(body?.budget);
    const currency: 'USD' | 'CLP' = body?.currency === 'CLP' ? 'CLP' : 'USD';
    const fraccionar = body?.fraccionar !== false;

    if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET) {
      return NextResponse.json({ error: 'Monto de inversión inválido' }, { status: 400 });
    }
    if (!rateLimit(request, 'rebalance', 15)) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
    const parsed = parsePortfolioItems(body?.items);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Las 5 mejores oportunidades del último escaneo del bot, evaluadas con las mismas reglas
    const { data: iaData } = await supabase
      .from('analisis_ia')
      .select('candidatos_json')
      .order('fecha', { ascending: false })
      .limit(1);
    const scan: Candidate[] = [...(iaData?.[0]?.candidatos_json?.us || []), ...(iaData?.[0]?.candidatos_json?.cl || [])];
    const oportunidades = scan
      .filter((c): c is { ticker: string; score: number } => typeof c?.ticker === 'string' && typeof c?.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(c => c.ticker.toUpperCase());

    const { modelo: riesgo, ...report } = await buildAdvisorReport(parsed.items, oportunidades);
    const plan = planPurchases(report, riesgo, budget, currency, { fraccionar });

    let resumen: string | null = null;
    let modelo: string | null = null;
    if (aiConfigured && plan.recommendations.length > 0) {
      try {
        const ordenes = plan.recommendations.map(o =>
          `- ${o.ticker} (${o.origen === 'OPORTUNIDAD' ? 'nueva' : 'ya en cartera'}, señal ${o.accion}): ${fmtMoney(o.expectedCost, currency)}, peso ${(o.pesoAntes * 100).toFixed(1)}% → ${(o.pesoDespues * 100).toFixed(1)}%`).join('\n');
        const prompt = `Eres un asesor de inversiones chileno. Explica en 2 o 3 frases simples, a un cliente no experto, qué hace este plan de compra con ${fmtMoney(budget, currency)} ${currency} y con qué criterio se armó. No inventes cifras, no cambies el plan y no prometas resultados.
Plan:
${ordenes}
${plan.excluidos.length ? `No se compran: ${plan.excluidos.map(e => `${e.ticker} (${e.motivo})`).join('; ')}` : ''}
${plan.motivoSinAsignar ? `Queda sin asignar ${fmtMoney(plan.sinAsignar, currency)}: ${plan.motivoSinAsignar}` : ''}
Criterio: paridad de riesgo (cada activo aporta lo mismo al riesgo total del portafolio, medido en pesos), un poco más de peso a las señales AUMENTAR, máximo 20% por empresa y 40% por fondo, y solo se completa lo que está bajo su objetivo.`;
        const r = await generateText(prompt, { speed: 'fast', timeoutMs: AI_TIMEOUT_MS });
        resumen = r.text.trim();
        modelo = r.model;
      } catch (e) {
        console.warn('Resumen de IA no disponible para el optimizador:', e instanceof Error ? e.message.slice(0, 120) : e);
      }
    }

    return NextResponse.json({
      ...plan,
      currency,
      budget,
      usdClp: report.usdClp,
      resumen,
      modelo,
    });

  } catch (err: unknown) {
    console.error('API Rebalance Error:', err);
    return NextResponse.json({ error: 'No se pudo calcular la asignación con precios de mercado. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }
}

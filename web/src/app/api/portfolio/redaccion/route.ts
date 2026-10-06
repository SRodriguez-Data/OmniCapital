import { NextResponse } from 'next/server';
import { aiConfigured } from '@/lib/ai';
import { MAX_ITEMS, TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { redactar } from '@/lib/redaccion';
import type { AdvisorReport } from '@/lib/advisor';

export const maxDuration = 60;

// Tamaño máximo del informe que se acepta para redactar (el de 60 activos pesa ~200 KB)
const MAX_BYTES = 400_000;
const ACCIONES = new Set(['AUMENTAR', 'MANTENER', 'REDUCIR']);

// Redacta con IA el informe que calculó /api/portfolio/analyze. El navegador devuelve ese mismo informe;
// se revisa su forma y tamaño para que la ruta no sirva para mandarle cualquier texto a la IA.
export async function POST(req: Request) {
  if (!rateLimit(req, 'redaccion', 15)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  if (!aiConfigured) {
    return NextResponse.json({ diagnostico: null, comentarios: {}, modelo: null, avisoIa: 'La IA no está configurada; se muestra el análisis calculado.' });
  }
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'Informe demasiado grande.' }, { status: 413 });

  let informe: AdvisorReport;
  try {
    informe = JSON.parse(raw)?.informe;
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const pos = informe?.posiciones;
  const valido = Array.isArray(pos) && pos.length > 0 && pos.length <= MAX_ITEMS
    && pos.every(p => typeof p?.ticker === 'string' && TICKER_RE.test(p.ticker) && ACCIONES.has(p.accion)
      && Array.isArray(p.motivos) && p.tecnico && p.fundamental && p.riesgo)
    && informe.resumen && informe.exposicion && Array.isArray(informe.hallazgos) && Array.isArray(informe.estrategia)
    && (!informe.perfilInversionista || ['conservador', 'moderado', 'agresivo'].includes(informe.perfilInversionista.nivel));
  if (!valido) return NextResponse.json({ error: 'Informe inválido.' }, { status: 400 });

  return NextResponse.json(await redactar(informe, 50000));
}

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { asesorDelDia } from '@/lib/asesor';
import { eventosSec, type EventoSec } from '@/lib/eventos';
import { parsePerfil } from '@/lib/perfil';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { parsePortfolioItems } from '@/lib/validation';

export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const MAX_MONTO = 1e11;

// Hechos relevantes de la SEC: los que dejó el agente diario en tu fila de agente_cartera (la lee tu sesión: solo ves
// la tuya). Si este servidor tiene su propio contacto para la SEC, los consulta en el momento.
async function eventosDe(token: string, tickers: string[]): Promise<{ porTicker: Record<string, EventoSec[]>; fecha: string } | null> {
  const contacto = (process.env.SEC_CONTACTO ?? '').trim();
  if (contacto) {
    const porTicker = await eventosSec(tickers, contacto).catch(() => null);
    if (porTicker) return { porTicker, fecha: new Date().toISOString().slice(0, 10) };
  }
  if (!token) return null;
  const db = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data } = await db.from('agente_cartera').select('datos->eventos').maybeSingle();
  const e = (data as { eventos?: { porTicker?: Record<string, EventoSec[]>; fecha?: string } | null } | null)?.eventos;
  return e?.porTicker && e.fecha ? { porTicker: e.porTicker, fecha: e.fecha } : null;
}

// El asesor del día (lib/asesor.ts): qué comprar con tu aporte, qué ajustar y por qué, con los hechos relevantes de tus
// empresas. Es el mismo cálculo que hace cada mañana el agente que te avisa.
export async function POST(request: Request) {
  if (!rateLimit(request, 'asesor', 20)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  let body: { items?: unknown; perfil?: unknown; monto?: unknown; fraccionar?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = parsePortfolioItems(body?.items);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const monto = body?.monto === undefined || body?.monto === null || body?.monto === '' ? null : Number(body.monto);
  if (monto !== null && (!Number.isFinite(monto) || monto < 0 || monto > MAX_MONTO)) {
    return NextResponse.json({ error: 'Monto inválido.' }, { status: 400 });
  }
  const perfil = parsePerfil(body?.perfil);
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');

  try {
    const eventos = await eventosDe(token, parsed.items.map(i => i.ticker)).catch(() => null);
    const { asesor, report } = await asesorDelDia(parsed.items, perfil, { montoCLP: monto, fraccionar: body?.fraccionar !== false, eventos: eventos?.porTicker ?? null });
    return NextResponse.json({
      asesor,
      eventos,
      mercado: report.mercado,
      resumen: { valorCLP: report.resumen.valorCLP, pnlCLP: report.resumen.pnlCLP, pnlPct: report.resumen.pnlPct, usdClp: report.usdClp },
      posiciones: report.posiciones.map(a => ({ ticker: a.ticker, nombre: a.nombre, valorCLP: a.valorCLP, peso: a.peso, moneda: a.moneda, accion: a.accion })),
      avisosDatos: report.avisosDatos,
    });
  } catch (err) {
    console.error('Error calculando el asesor:', err);
    return NextResponse.json({ error: 'No se pudieron obtener los datos de mercado. Intenta de nuevo en unos minutos.' }, { status: 502 });
  }
}

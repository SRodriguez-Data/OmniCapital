import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { asesorDelDia } from '@/lib/asesor';
import { conEventosAnteriores, eventosSecRevisados, type EventoSec } from '@/lib/eventos';
import { parsePerfil } from '@/lib/perfil';
import { rateLimit, sesionVerificada, tokenDe, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { parsePortfolioItems } from '@/lib/validation';

export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const MAX_MONTO = 1e11;

// Hechos relevantes de la SEC: los que dejó el agente diario en tu fila de agente_cartera (la lee tu sesión: solo ves
// la tuya). Si este servidor tiene su propio contacto para la SEC, los consulta en el momento, pero solo para una
// sesión verificada (un visitante anónimo no gasta consultas a la SEC con ese contacto) y recordando cada empresa unas
// horas en esta instancia.
const SEC_TTL = 3 * 60 * 60 * 1000;
const secCache = new Map<string, { at: number; evs: EventoSec[] }>();

async function eventosDe(token: string, tickers: string[], usuario: string | null): Promise<{ porTicker: Record<string, EventoSec[]>; fecha: string; sinRevisar?: string[] } | null> {
  const contacto = (process.env.SEC_CONTACTO ?? '').trim();
  if (contacto && usuario) {
    const ahora = Date.now();
    const lista = [...new Set(tickers.map(t => t.toUpperCase()))].filter(t => !t.endsWith('.SN'));
    const faltan = lista.filter(t => !(ahora - (secCache.get(t)?.at ?? 0) < SEC_TTL));
    const nuevos = faltan.length ? await eventosSecRevisados(faltan, contacto).catch(() => null) : { porTicker: {}, sinRevisar: [] };
    if (nuevos) {
      if (secCache.size > 1000) secCache.clear();
      // Una empresa cuya consulta falló no se recuerda como "sin hechos": se vuelve a consultar la próxima vez
      for (const t of faltan) if (!nuevos.sinRevisar.includes(t)) secCache.set(t, { at: ahora, evs: nuevos.porTicker[t] ?? [] });
      const porTicker: Record<string, EventoSec[]> = {};
      for (const t of lista) {
        const evs = secCache.get(t)?.evs;
        if (evs?.length) porTicker[t] = evs;
      }
      // Las que no se pudieron consultar no se dan por revisadas: vale lo que dejó el agente (un freno grave no se
      // levanta porque falló la consulta) y el asesor lo avisa
      const sinRevisar = nuevos.sinRevisar;
      const anteriores = sinRevisar.length ? (await delAgente(token).catch(() => null))?.porTicker : null;
      return { porTicker: conEventosAnteriores({ porTicker, sinRevisar }, anteriores), fecha: new Date().toISOString().slice(0, 10), sinRevisar };
    }
  }
  return delAgente(token);
}

async function delAgente(token: string): Promise<{ porTicker: Record<string, EventoSec[]>; fecha: string } | null> {
  if (!token) return null;
  const db = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data } = await db.from('agente_cartera').select('datos->eventos').maybeSingle();
  const e = (data as { eventos?: { porTicker?: Record<string, EventoSec[]>; fecha?: string } | null } | null)?.eventos;
  return e?.porTicker && e.fecha ? { porTicker: e.porTicker, fecha: e.fecha } : null;
}

// El asesor del día (lib/asesor.ts): qué comprar con tu aporte, qué ajustar y por qué, con los hechos relevantes de tus
// empresas. Es el mismo cálculo que hace cada mañana el agente que te avisa.
export async function POST(request: Request) {
  const usuario = await sesionVerificada(request);
  if (!rateLimit(request, 'asesor', 20, undefined, { usuario })) {
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
  const token = tokenDe(request);

  try {
    const eventos = await eventosDe(token, parsed.items.map(i => i.ticker), usuario).catch(() => null);
    const { asesor, report } = await asesorDelDia(parsed.items, perfil, { montoCLP: monto, fraccionar: body?.fraccionar !== false, eventos: eventos?.porTicker ?? null, eventosSinRevisar: eventos?.sinRevisar ?? [] });
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

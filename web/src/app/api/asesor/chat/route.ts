import { NextResponse } from 'next/server';
import { aiConfigured, aiError } from '@/lib/ai';
import { responderChat, type MensajeChat } from '@/lib/chat';
import { parsePerfil } from '@/lib/perfil';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { parsePortfolioItems } from '@/lib/validation';

export const maxDuration = 60;

const MAX_MENSAJES = 14;
const MAX_TEXTO = 2000;

// Chat con el asesor: Gemini conversa y el motor pone las cifras (lib/chat.ts).
export async function POST(request: Request) {
  if (!aiConfigured) return NextResponse.json({ error: 'El chat no está disponible: falta la clave de la IA.' }, { status: 503 });
  if (!rateLimit(request, 'chat', 40)) return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  const body = await request.json().catch(() => null) as { mensajes?: unknown; contexto?: unknown; items?: unknown; perfil?: unknown } | null;
  const mensajes = (Array.isArray(body?.mensajes) ? body.mensajes : [])
    .filter((m): m is MensajeChat => (m?.rol === 'usuario' || m?.rol === 'asesor') && typeof m?.texto === 'string' && m.texto.trim().length > 0)
    .slice(-MAX_MENSAJES)
    .map(m => ({ rol: m.rol, texto: m.texto.slice(0, MAX_TEXTO) }));
  if (!mensajes.length || mensajes.at(-1)!.rol !== 'usuario') return NextResponse.json({ error: 'Escribe tu pregunta.' }, { status: 400 });
  const parsed = parsePortfolioItems(body?.items ?? []);
  const items = 'error' in parsed ? [] : parsed.items;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 50000);
  try {
    const r = await responderChat(mensajes, body?.contexto, items, parsePerfil(body?.perfil), controller.signal);
    return NextResponse.json(r);
  } catch (e) {
    if (controller.signal.aborted) return NextResponse.json({ error: 'El asesor tardó demasiado. Intenta de nuevo.' }, { status: 504 });
    const { message, status } = aiError(e);
    console.error('Chat del asesor:', e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timer);
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { leerSuscripcion } from '@/lib/push';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Guarda (POST) o quita (DELETE) la suscripción de este navegador a los avisos del asesor. Corre con la sesión del
// usuario: las reglas de la base (RLS) solo le dejan tocar las suyas.
async function conSesion(request: Request) {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const db = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await db.auth.getUser(token);
  return user ? { db, user } : null;
}

const FALTA_TABLA = 'Falta crear la tabla de avisos en la base: corre supabase/push_suscripciones.sql en el editor SQL de Supabase.';

export async function POST(request: Request) {
  if (!rateLimit(request, 'push', 20)) return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  const s = await conSesion(request);
  if (!s) return NextResponse.json({ error: 'Inicia sesión con tu cuenta para recibir avisos en el celular.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { suscripcion?: unknown; dispositivo?: unknown } | null;
  const sub = leerSuscripcion(body?.suscripcion);
  if ('error' in sub) return NextResponse.json({ error: sub.error }, { status: 400 });
  const dispositivo = typeof body?.dispositivo === 'string' ? body.dispositivo.slice(0, 80) : null;
  const { error } = await s.db.from('push_suscripciones').upsert({ ...sub, user_id: s.user.id, dispositivo }, { onConflict: 'endpoint' });
  if (error) {
    const falta = error.code === 'PGRST205' || error.code === '42P01';
    return NextResponse.json({ error: falta ? FALTA_TABLA : `No se pudo guardar: ${error.message}` }, { status: falta ? 503 : 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const s = await conSesion(request);
  if (!s) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'Falta el endpoint.' }, { status: 400 });
  const { error } = await s.db.from('push_suscripciones').delete().eq('endpoint', body.endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

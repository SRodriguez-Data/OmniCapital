import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { leerEjecucion } from '@/lib/ejecucion';
import { registrarEjecucion } from '@/lib/ejecucionBase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Registra en la cartera guardada una orden ya ejecutada en la corredora. Corre con la sesión del usuario: las reglas
// de la base (RLS) solo le dejan leer y cambiar sus propias filas.
export async function POST(request: Request) {
  if (!rateLimit(request, 'ejecucion', 30)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Inicia sesión para guardar operaciones.' }, { status: 401 });
  const db = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Tu sesión expiró: vuelve a entrar.' }, { status: 401 });

  const e = leerEjecucion(await request.json().catch(() => null));
  if ('error' in e) return NextResponse.json({ error: e.error }, { status: 400 });

  const r = await registrarEjecucion(db, user.id, e);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado });
  return NextResponse.json(r);
}

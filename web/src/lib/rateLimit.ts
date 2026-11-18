import { createClient } from '@supabase/supabase-js';

// Límite simple de solicitudes, en memoria de cada instancia (Node o Edge). No es un rate limiter distribuido: cada
// instancia nueva de Vercel parte de cero, así que frena el abuso básico pero no garantiza la cuota diaria de Gemini.
//
// - Cada quien (su IP, o su cuenta si la sesión está verificada) tiene su propio límite por ventana.
// - Las rutas que gastan Gemini pasan además `ia`: un tope para TODOS los visitantes sin sesión juntos, por ventana y
//   por día. Las cuentas verificadas no entran en ese tope: el tráfico anónimo no puede dejar sin IA a quien inició sesión.
// - Las rutas que no gastan Gemini no tienen tope común: nadie puede bloquearle a otro guardar una operación.
const hits = new Map<string, number[]>();
const VENTANA = 10 * 60 * 1000;
const DIA = 24 * 60 * 60 * 1000;

export interface TopeIa {
  anonimos: number; // solicitudes sin sesión, entre todos, por ventana
  anonimosDia: number; // y por día
}

export interface OpcionesLimite {
  usuario?: string | null; // id de la cuenta, solo si la sesión se verificó (sesionVerificada)
  ia?: TopeIa;
}

const ipDe = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'anon';

export function rateLimit(req: Request, scope: string, limit: number, windowMs = VENTANA, { usuario = null, ia }: OpcionesLimite = {}): boolean {
  const key = `${scope}:${usuario ? `u:${usuario}` : ipDe(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  hits.set(key, recent);
  if (recent.length >= limit) return false;

  const anonKey = `${scope}:*`;
  let anonimos: number[] | null = null;
  if (ia && !usuario) {
    anonimos = (hits.get(anonKey) || []).filter(t => now - t < DIA);
    hits.set(anonKey, anonimos);
    if (anonimos.length >= ia.anonimosDia || anonimos.filter(t => now - t < windowMs).length >= ia.anonimos) return false;
  }
  recent.push(now);
  anonimos?.push(now);

  // Limpieza ocasional para que el mapa no crezca sin límite
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (!times.some(t => now - t < DIA)) hits.delete(k);
    }
  }
  return true;
}

export const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes de IA desde tu conexión. Espera unos minutos e intenta de nuevo.';
export const RATE_LIMIT_ESCRITURA = 'Demasiados cambios seguidos. Espera unos minutos e intenta de nuevo.';

// --- Sesión verificada ------------------------------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const sesiones = new Map<string, { usuario: string | null; hasta: number }>();
const SESION_OK = 5 * 60 * 1000;
const SESION_MALA = 60 * 1000; // un token inválido no se vuelve a consultar por un minuto

/** El token de la cabecera Authorization, solo si tiene forma de sesión (no "Bearer undefined" ni texto cualquiera). */
export function tokenDe(req: Request): string {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) && token.length < 4096 ? token : '';
}

/** Id de la cuenta si la solicitud trae una sesión que Supabase reconoce; si no, null. La respuesta se recuerda unos
 *  minutos en esta instancia para no consultar a Supabase en cada solicitud. */
export async function sesionVerificada(req: Request): Promise<string | null> {
  const token = tokenDe(req);
  if (!token || !supabaseUrl || !supabaseKey) return null;
  const now = Date.now();
  const hit = sesiones.get(token);
  if (hit && hit.hasta > now) return hit.usuario;
  let usuario: string | null = null;
  try {
    const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    usuario = (await db.auth.getUser(token)).data.user?.id ?? null;
  } catch {
    usuario = null;
  }
  if (sesiones.size > 500) {
    for (const [k, v] of sesiones) if (v.hasta <= now) sesiones.delete(k);
    if (sesiones.size > 500) sesiones.clear();
  }
  sesiones.set(token, { usuario, hasta: now + (usuario ? SESION_OK : SESION_MALA) });
  return usuario;
}

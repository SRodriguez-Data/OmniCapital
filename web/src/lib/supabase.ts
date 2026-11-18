import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Cabeceras para llamar a una ruta propia con la sesión del navegador. Con sesión, las rutas que usan IA dan a la
 *  cuenta su propio cupo (el de visitantes sin cuenta es chico y compartido); sin sesión van sin ella. */
export async function cabecerasConSesion(extra: Record<string, string> = { 'Content-Type': 'application/json' }) {
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  return session ? { ...extra, Authorization: `Bearer ${session.access_token}` } : extra;
}

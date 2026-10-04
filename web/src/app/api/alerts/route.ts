import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Alertas de mercado generadas por el bot (compartidas por todos los usuarios).
// El estado "leída" se guarda en el navegador de cada usuario, no en la base de datos.
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('alertas_mercado')
      .select('id, ticker, tipo, precio_actual, mensaje, fecha_creacion')
      .order('fecha_creacion', { ascending: false })
      .limit(50);

    if (error) {
      // Si la tabla no existe aún, devolvemos array vacío para no romper la UI
      if (error.code === '42P01') {
        return NextResponse.json([]);
      }
      throw error;
    }

    return NextResponse.json(data || []);
  } catch (err: unknown) {
    console.error('API Alerts GET Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}

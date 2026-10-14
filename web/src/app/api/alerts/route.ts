import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Alertas de mercado generadas por el bot (compartidas por todos los usuarios): una acción que entra o sale de las
// ideas con evidencia. Las del método anterior (BUY_ZONE, por sobreventa) no se muestran.
// El estado "leída" se guarda en el navegador de cada usuario, no en la base de datos.
const TIPOS = ['ENTRA_LISTA', 'SALE_LISTA'];
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('alertas_mercado')
      .select('id, ticker, tipo, precio_actual, mensaje, fecha_creacion')
      .in('tipo', TIPOS)
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

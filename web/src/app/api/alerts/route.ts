import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('alertas_mercado')
      .select('*')
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
  } catch (err: any) {
    console.error('API Alerts GET Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('alertas_mercado')
      .update({ leido: true })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('API Alerts POST Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

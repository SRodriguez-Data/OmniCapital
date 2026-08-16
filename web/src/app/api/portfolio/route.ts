import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Missing Supabase env variables in Next.js");
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
    global: { headers: { Authorization: authHeader || '' } }
  });

  const { data, error } = await supabase
    .from('mi_portafolio')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
      global: { headers: { Authorization: authHeader || '' } }
    });

    const body = await request.json();
    const { ticker, cantidad, precio_compra, moneda, purchase_date } = body;

    if (!ticker || !cantidad || !precio_compra || !moneda || !purchase_date) {
      return NextResponse.json({ error: 'Missing required fields including purchase_date' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('mi_portafolio')
      .insert([
        { ticker: ticker.toUpperCase(), cantidad, precio_compra, moneda, purchase_date }
      ])
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data[0]);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  const authHeader = request.headers.get('Authorization');
  const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
    global: { headers: { Authorization: authHeader || '' } }
  });

  const { error } = await supabase
    .from('mi_portafolio')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

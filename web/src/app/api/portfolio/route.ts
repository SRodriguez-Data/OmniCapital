import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TICKER_RE } from '@/lib/validation';

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
    const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
    const cantidad = Number(body.cantidad);
    const precio_compra = Number(body.precio_compra);
    const { moneda, purchase_date } = body;

    if (!TICKER_RE.test(ticker)) {
      return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio_compra) || precio_compra <= 0) {
      return NextResponse.json({ error: 'Cantidad y precio de compra deben ser números mayores a 0' }, { status: 400 });
    }
    if (moneda !== 'USD' && moneda !== 'CLP') {
      return NextResponse.json({ error: 'La moneda debe ser USD o CLP' }, { status: 400 });
    }
    if (typeof purchase_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(purchase_date) || purchase_date > new Date().toISOString().split('T')[0]) {
      return NextResponse.json({ error: 'Fecha de compra inválida (no puede ser futura)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('mi_portafolio')
      .insert([
        { ticker, cantidad, precio_compra, moneda, purchase_date }
      ])
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data[0]);
  } catch {
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

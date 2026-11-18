import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, tokenDe, RATE_LIMIT_ESCRITURA } from '@/lib/rateLimit';
import { TICKER_RE } from '@/lib/validation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Missing Supabase env variables in Next.js");
}

// La cartera guardada es de una cuenta: sin sesión no hay nada que leer ni cambiar (los modos demo y cartola viven en
// el navegador y no llaman a esta ruta). Las reglas de la base (RLS) dejan a cada cuenta solo sus filas.
const SIN_SESION = 'Inicia sesión para ver y guardar tu portafolio.';
// Guardar una cartola reemplaza hasta 60 posiciones (un borrado y una inserción por cada una)
const MAX_ESCRITURAS = 300;

function conSesion(request: Request) {
  const token = tokenDe(request);
  if (!token) return null;
  return createClient(supabaseUrl || '', supabaseKey || '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

// Una sesión vencida o inválida la rechaza la base (PGRST301 y similares): es un 401, no un error interno
const estadoDe = (error: { code?: string; message?: string }) => (/^PGRST30[0-3]$/.test(error.code ?? '') || /jwt/i.test(error.message ?? '') ? 401 : 500);
const fallo = (que: string, error: { code?: string; message?: string }) => {
  const estado = estadoDe(error);
  if (estado === 500) console.error(`Portafolio (${que}):`, error.code, error.message);
  return NextResponse.json({ error: estado === 401 ? 'Tu sesión expiró: vuelve a entrar.' : `No se pudo ${que} tu portafolio. Intenta de nuevo en unos minutos.` }, { status: estado });
};

export async function GET(request: Request) {
  const supabase = conSesion(request);
  if (!supabase) return NextResponse.json({ error: SIN_SESION }, { status: 401 });

  const { data, error } = await supabase
    .from('mi_portafolio')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) return fallo('leer', error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = conSesion(request);
  if (!supabase) return NextResponse.json({ error: SIN_SESION }, { status: 401 });
  if (!rateLimit(request, 'portfolio-escribir', MAX_ESCRITURAS)) {
    return NextResponse.json({ error: RATE_LIMIT_ESCRITURA }, { status: 429 });
  }
  try {
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

    if (error) return fallo('guardar en', error);
    return NextResponse.json(data[0]);
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'Falta el identificador de la posición.' }, { status: 400 });
  }
  const supabase = conSesion(request);
  if (!supabase) return NextResponse.json({ error: SIN_SESION }, { status: 401 });
  if (!rateLimit(request, 'portfolio-escribir', MAX_ESCRITURAS)) {
    return NextResponse.json({ error: RATE_LIMIT_ESCRITURA }, { status: 429 });
  }

  const { data, error } = await supabase
    .from('mi_portafolio')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    // Un id con otra forma (por ejemplo, una fila local de cartola) no existe en la base
    if (error.code === '22P02') return NextResponse.json({ error: 'Esa posición no está en tu portafolio guardado.' }, { status: 404 });
    return fallo('cambiar', error);
  }
  // Las reglas de la base no dejan borrar filas ajenas: cero filas es "no existe", no un éxito
  if (!data?.length) return NextResponse.json({ error: 'Esa posición no está en tu portafolio guardado.' }, { status: 404 });

  return NextResponse.json({ success: true });
}

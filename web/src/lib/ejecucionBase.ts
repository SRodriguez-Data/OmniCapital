import type { SupabaseClient } from '@supabase/supabase-js';
import { cambiosPorEjecucion, type Ejecucion, type Lote } from './ejecucion';

// Aplica en mi_portafolio una orden ya ejecutada (lib/ejecucion.ts decide qué cambia). `db` trae la sesión del usuario:
// las reglas de la base (RLS) solo le dejan tocar sus filas. Cada cambio se comprueba; si la base no aplica uno, se
// devuelve qué faltó en vez de darlo por guardado.

export type Resultado = { ok: true; insertadas: number; modificadas: number; borradas: number } | { ok: false; error: string; estado: number };

export async function registrarEjecucion(db: SupabaseClient, userId: string, e: Ejecucion): Promise<Resultado> {
  const { data: lotes, error: errLectura } = await db
    .from('mi_portafolio')
    .select('id, ticker, cantidad, precio_compra, moneda, purchase_date')
    .eq('ticker', e.ticker)
    .eq('user_id', userId);
  if (errLectura) return { ok: false, error: 'No se pudo leer tu cartera. Intenta de nuevo.', estado: 502 };
  const filas = (lotes ?? []).map(l => ({ ...l, id: String(l.id), cantidad: Number(l.cantidad), precio_compra: Number(l.precio_compra) })) as Lote[];
  const cambios = cambiosPorEjecucion(filas, e);
  if ('error' in cambios) return { ok: false, error: cambios.error, estado: 400 };

  const fallo = (detalle: string): Resultado => ({ ok: false, error: `${detalle} Revisa tu cartera en la pestaña Portafolio.`, estado: 502 });
  for (const fila of cambios.insertar) {
    const { data, error } = await db.from('mi_portafolio').insert({ ...fila, user_id: userId }).select('id');
    if (error || data?.length !== 1) return fallo('No se pudo guardar la compra.');
  }
  for (const { id, cantidad } of cambios.actualizar) {
    const { data, error } = await db.from('mi_portafolio').update({ cantidad }).eq('id', id).select('id');
    if (!error && data?.length === 1) continue;
    // Si la base no permite modificar filas, se reemplaza el lote: primero el nuevo y después se borra el viejo
    const viejo = filas.find(l => l.id === id)!;
    const { data: nuevo, error: errNuevo } = await db.from('mi_portafolio')
      .insert({ ticker: viejo.ticker, cantidad, precio_compra: viejo.precio_compra, moneda: viejo.moneda, purchase_date: viejo.purchase_date, user_id: userId })
      .select('id');
    if (errNuevo || nuevo?.length !== 1) return fallo('No se pudo descontar la venta.');
    const { data: borrado, error: errBorrado } = await db.from('mi_portafolio').delete().eq('id', id).select('id');
    if (errBorrado || borrado?.length !== 1) {
      await db.from('mi_portafolio').delete().eq('id', nuevo[0].id);
      return fallo('No se pudo descontar la venta.');
    }
  }
  for (const id of cambios.borrar) {
    const { data, error } = await db.from('mi_portafolio').delete().eq('id', id).select('id');
    if (error || data?.length !== 1) return fallo('No se pudo descontar toda la venta.');
  }
  return { ok: true, insertadas: cambios.insertar.length, modificadas: cambios.actualizar.length, borradas: cambios.borrar.length };
}

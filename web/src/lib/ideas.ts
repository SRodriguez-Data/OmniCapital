import { sectorEnEspanol } from './fundamentals';
import type { Mercado } from './evidenciaMetodos';
import { supabase } from './supabase';

// Las ideas del último escaneo del bot (quantum_trader_serverless.py, método v2), tal como las guarda en analisis_ia:
// las 20 acciones de EE.UU. con la utilidad más respaldada por caja de cada sector y las 5 chilenas de mayor momentum,
// cada una con el peso que le da el método medido (igual en EE.UU., inverso a la volatilidad en Chile).

export interface IdeaTop {
  ticker: string;
  mercado: Mercado;
  moneda: 'USD' | 'CLP';
  puesto: number; // 1 = la primera de su lista
  peso: number; // dentro de la cartera del método
  sector?: string; // en español, como en la exposición de la cartera
  industria?: string;
  precio: number | null; // del escaneo
  fechaPrecio: string | null;
  per: number | null;
  dividendo: string | null;
  proximosResultados: string | null;
  calidad: number | null; // EE.UU.: (flujo de caja − pago en acciones − utilidad) / activos
  percentilSector: number | null; // EE.UU.: 1 = la mejor de su sector
  momentum: number | null; // Chile: alza de 12 meses sin el último
}

export interface IdeasDelBot {
  fecha: string;
  us: IdeaTop[];
  cl: IdeaTop[];
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const txt = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

function leer(lista: unknown, mercado: Mercado): IdeaTop[] {
  if (!Array.isArray(lista)) return [];
  const ideas: IdeaTop[] = [];
  for (const c of lista as Record<string, unknown>[]) {
    const ticker = txt(c?.ticker)?.toUpperCase();
    if (!ticker) continue;
    ideas.push({
      ticker, mercado, moneda: mercado === 'Chile' ? 'CLP' : 'USD', puesto: ideas.length + 1,
      peso: num(c.peso) ?? 0,
      sector: sectorEnEspanol(txt(c.sector) ?? undefined),
      industria: txt(c.industria) ?? undefined,
      precio: num(c.price), fechaPrecio: txt(c.fecha_precio),
      per: num(c.pe), dividendo: txt(c.div_str), proximosResultados: txt(c.proximos_resultados),
      calidad: num(c.calidad), percentilSector: num(c.percentil_sector), momentum: num(c.momentum),
    });
  }
  // Sin pesos del método (escaneos viejos), partes iguales
  const suma = ideas.reduce((s, i) => s + i.peso, 0);
  for (const i of ideas) i.peso = suma > 0 ? i.peso / suma : 1 / ideas.length;
  return ideas;
}

let cache: { at: number; datos: IdeasDelBot | null } | null = null;

export async function ideasDelBot(): Promise<IdeasDelBot | null> {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.datos;
  const { data, error } = await supabase
    .from('analisis_ia')
    .select('fecha, us:candidatos_json->us, cl:candidatos_json->cl')
    .order('fecha', { ascending: false })
    .limit(1);
  if (error) throw new Error(`No se pudieron leer las ideas del bot: ${error.message}`);
  const fila = data?.[0] as { fecha?: string; us?: unknown; cl?: unknown } | undefined;
  const datos = fila ? { fecha: String(fila.fecha ?? '').slice(0, 10), us: leer(fila.us, 'EE.UU.'), cl: leer(fila.cl, 'Chile') } : null;
  cache = { at: Date.now(), datos };
  return datos;
}

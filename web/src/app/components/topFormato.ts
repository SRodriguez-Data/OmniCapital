// Formato de los datos del Top (los guarda el bot en analisis_ia.candidatos_json). Cada dato dice de dónde sale
// o por qué no aplica: nunca un "N/A" sin explicación.

export interface Candidato {
  ticker: string;
  price: number;
  score: number | null;
  pe?: string | number;
  pe_nota?: 'estimado' | 'perdidas' | 'reit' | 'sin dato' | null;
  div_str?: string;
  deuda?: string | number | null;   // deuda / patrimonio en %
  deuda_fuente?: string | null;     // 'yahoo' o 'balance AAAA-MM-DD' (calculada del balance)
  deuda_nota?: 'etf' | 'patrimonio negativo' | 'sin dato' | null;
  patrimonio_activos?: number | null; // solo bancos y aseguradoras, en %
  tipo?: 'accion' | 'etf';
  sector?: string | null;
  industria?: string | null;
  proximos_resultados?: string | null; // AAAA-MM-DD
  fecha_precio?: string;
  calidad?: number;           // (flujo de caja - pago en acciones - utilidad) / activos
  percentil_sector?: number;
  sector_gics?: string;
  cierre_fiscal?: string;
  momentum?: number;          // retorno con dividendos de hace 12 meses a hace 1 mes
  peso?: number;              // fracción de la cartera de su lista (cartera.py: la ponderación medida para el método)
}

export function normalizeYield(divStr?: string): string {
  const value = parseFloat(String(divStr ?? '').replace('%', ''));
  if (!Number.isFinite(value)) return 'Sin dato en Yahoo';
  if (value === 0) return '0% (no reparte)';
  // Por si un dividendo llega multiplicado dos veces por 100 ("346.00%" en vez de 3,46%), como en escaneos antiguos
  return `${(value > 25 ? value / 100 : value).toFixed(2)}%`;
}

export const fechaCorta = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });

export function textoPE(c: Candidato): string {
  if (c.pe_nota === 'reit') return 'No aplica (REIT: se valora por su flujo, no por la utilidad contable)';
  const pe = typeof c.pe === 'number' ? c.pe : parseFloat(String(c.pe));
  if (Number.isFinite(pe) && pe > 0) return `${pe.toFixed(1)}${c.pe_nota === 'estimado' ? ' (sobre utilidad estimada)' : ''}`;
  if (c.pe_nota === 'perdidas') return 'Negativo (la empresa tiene pérdidas)';
  return 'Sin dato en Yahoo';
}

export function textoDeuda(c: Candidato): string {
  if (c.deuda_nota === 'etf' || c.tipo === 'etf') return 'No aplica (ETF)';
  if (c.deuda_nota === 'patrimonio negativo') return 'Patrimonio negativo (recompró más acciones de lo que acumuló)';
  const d = typeof c.deuda === 'number' ? c.deuda : parseFloat(String(c.deuda));
  // Escaneos anteriores guardaban 0 cuando Yahoo no informaba la deuda: ese 0 no significa "sin deuda"
  if (!Number.isFinite(d) || (d === 0 && !c.deuda_fuente)) return 'Sin dato en Yahoo';
  const partes = [d > 0 && d < 1 ? 'Menos de 1% del patrimonio' : `${Math.round(d)}% del patrimonio`];
  if (c.deuda_fuente?.startsWith('balance ')) partes.push(`calculada del balance al ${fechaCorta(c.deuda_fuente.slice(8))}`);
  if (typeof c.patrimonio_activos === 'number') partes.push(`en un banco la deuda es parte del negocio: su patrimonio es ${c.patrimonio_activos.toFixed(1)}% de sus activos`);
  return partes.join(' · ');
}

export function textoResultados(iso?: string | null): { texto: string; pronto: boolean } | null {
  if (!iso) return null;
  // Días de calendario contados desde la fecha local de quien mira, no desde la hora UTC
  const hoy = new Date();
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dias = Math.round((Date.UTC(a, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
  if (dias < 0) return null;
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
  return { texto: `${fechaCorta(iso)} (${cuando})`, pronto: dias <= 7 };
}

// Sectores de Yahoo y de GICS (Wikipedia) en español
export const SECTOR: Record<string, string> = {
  'Financial Services': 'Financiero', Healthcare: 'Salud', 'Real Estate': 'Inmobiliario', Industrials: 'Industrial',
  'Consumer Defensive': 'Consumo básico', 'Consumer Cyclical': 'Consumo discrecional', Technology: 'Tecnología',
  'Communication Services': 'Comunicaciones', Utilities: 'Servicios básicos', Energy: 'Energía', 'Basic Materials': 'Materiales',
  'Information Technology': 'Tecnología', 'Health Care': 'Salud', Financials: 'Financiero', 'Consumer Discretionary': 'Consumo discrecional',
  'Consumer Staples': 'Consumo básico', Materials: 'Materiales',
};

export const pctSigno = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

// Calificación de las ideas que el Top ya mostró (la calcula el bot con los escaneos guardados)
export interface Resumen { ideas: number; exceso_promedio: number; mediana: number; acierto: number }
export interface HistorialMetodo {
  desde: string; hasta: string; escaneos: number; excluidas_precio_congelado: number;
  un_mes: Record<'EE.UU.' | 'Chile', Resumen | null>;
  a_la_fecha: Record<'EE.UU.' | 'Chile', Resumen | null>;
}
// El bot guarda el historial del método actual y del anterior por separado
export interface Historiales { metodo?: string; desde_metodo_actual?: string | null; actual?: HistorialMetodo | null; anterior?: HistorialMetodo | null }

const MINIMO_IDEAS = 20;
const INDICE_NOMBRE = { 'EE.UU.': 'S&P 500', Chile: 'el ETF del IPSA' } as const;

export function lineaHistorial(h: HistorialMetodo, m: 'EE.UU.' | 'Chile'): string {
  const r1 = h.un_mes[m], rh = h.a_la_fecha[m];
  const [r, plazo] = r1 && r1.ideas >= MINIMO_IDEAS ? [r1, 'un mes después'] : rh && rh.ideas >= MINIMO_IDEAS ? [rh, 'hasta hoy'] : [null, ''];
  if (!r) return `${m}: todavía muy pocas ideas medibles para sacar conclusiones.`;
  return `${m}: ${r.ideas} ideas, ${plazo}: ${pctSigno(r.exceso_promedio)} frente a ${INDICE_NOMBRE[m]} en promedio (la típica ${pctSigno(r.mediana)}); le ganaron ${(r.acierto * 100).toFixed(0)}% de las veces.`;
}

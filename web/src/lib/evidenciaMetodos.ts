import datos from '@/data/evidencia_metodos.json';

// Lo que midió el laboratorio (evidencia.py) sobre los métodos del Top. Es lo único de la evidencia que descarga
// el navegador; las reglas del asesor están en evidencia.ts y solo se usan en el servidor.

export type Mercado = 'EE.UU.' | 'Chile';
export type Nivel = 'sólida' | 'débil' | 'sin evidencia' | 'en contra';
export type ClaveMetodo = 'calidad_eeuu' | 'momentum_chile';
export type Ponderacion = 'igual' | 'inversa_volatilidad' | 'minima_varianza';

// Cómo se reparte la cartera de cada método (cartera.py en la raíz del repo)
export const NOMBRE_PONDERACION: Record<Ponderacion, string> = {
  igual: 'Partes iguales',
  inversa_volatilidad: 'Inversa a la volatilidad',
  minima_varianza: 'Mínima varianza (Markowitz)',
};

// Una cartera rebalanceada cada mes, con una ponderación: resultados anuales
export interface ResumenCartera {
  retorno_anual: number; volatilidad_anual: number; sharpe: number | null; peor_caida: number;
  exceso_anual: number; exceso_t: number | null;
}
interface Cartera {
  elegida: Ponderacion; meses: number;
  ponderaciones: Record<Ponderacion, ResumenCartera & { mitades: Record<string, ResumenCartera> }>;
}
interface Metodo {
  nombre: string; mercado: Mercado; n: number;
  '3m': {
    exceso_promedio: number | null; t: number | null; acierto: number | null; casos: number; meses_positivos: number;
    mitades?: Record<string, { desde: string; hasta: string; exceso_promedio: number; t: number }>;
  };
  cartera?: Cartera | null;
}
interface Datos {
  calculado: string;
  muestra: Partial<Record<Mercado, { desde: string; hasta: string }>>;
  sesgos: string[];
  base: Record<Mercado, { '3m': { acierto: number | null } }>;
  metodos: Partial<Record<ClaveMetodo, Metodo>>;
  variantes_chile?: Record<string, { nombre: string; t: number | null; exceso_promedio: number | null }>;
}
const D = datos as unknown as Datos;

export const anioEvidencia = (muestra: Datos['muestra'] = D.muestra) => {
  const m = muestra['EE.UU.'] ?? muestra.Chile;
  return m ? `${m.desde.slice(0, 4)}–${m.hasta.slice(0, 4)}` : '';
};

export const sesgosEvidencia = () => D.sesgos;

const nivelDe = (exceso: number, t: number, mitades: number[]): Nivel =>
  exceso <= 0 || Math.abs(t) < 1 ? 'sin evidencia' : t >= 2 && mitades.every(v => v > 0) ? 'sólida' : 'débil';

/** La evidencia de un método del Top. Se mide sobre la cartera tal como se opera: las N elegidas, rebalanceada cada
 *  mes con la ponderación que eligió el laboratorio, frente al promedio de su mercado. Sólida: t de 2 o más y ganando
 *  en cada mitad de la historia. Sin esa medición (archivo anterior), con el exceso a 3 meses de cada elegida. */
export function evidenciaMetodo(clave: ClaveMetodo) {
  const m = D.metodos[clave];
  const x = m?.['3m'];
  const base = m ? D.base[m.mercado]?.['3m']?.acierto : null;
  if (!m || !x || x.exceso_promedio === null || x.t === null || x.acierto === null || base == null) return null;
  const c = m.cartera;
  const elegida = c ? c.ponderaciones[c.elegida] : null;
  const medida = elegida && elegida.exceso_t !== null
    ? { exceso: elegida.exceso_anual, t: elegida.exceso_t, mitades: Object.values(elegida.mitades).map(v => v.exceso_anual) }
    : { exceso: x.exceso_promedio, t: x.t, mitades: Object.values(x.mitades ?? {}).map(v => v.exceso_promedio) };
  return {
    nombre: m.nombre, n: m.n, mercado: m.mercado, nivel: nivelDe(medida.exceso, medida.t, medida.mitades), t: medida.t,
    // La medición de cada elegida a 3 meses, como dato complementario
    exceso3m: x.exceso_promedio, mesesPositivos: x.meses_positivos, mitades3m: Object.values(x.mitades ?? {}),
    cartera: c ?? null, anios: anioEvidencia(),
    variantes: clave === 'momentum_chile' ? Object.values(D.variantes_chile ?? {}) : [],
  };
}

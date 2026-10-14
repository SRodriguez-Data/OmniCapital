import datos from '@/data/evidencia_metodos.json';

// Lo que midió el laboratorio (evidencia.py) sobre los métodos del Top. Es lo único de la evidencia que descarga
// el navegador; las reglas del asesor están en evidencia.ts y solo se usan en el servidor.

export type Mercado = 'EE.UU.' | 'Chile';
export type Nivel = 'sólida' | 'débil' | 'sin evidencia' | 'en contra';
export type ClaveMetodo = 'calidad_eeuu' | 'momentum_chile';

interface Metodo {
  nombre: string; mercado: Mercado; n: number;
  '3m': {
    exceso_promedio: number | null; t: number | null; acierto: number | null; casos: number; meses_positivos: number;
    mitades?: Record<string, { desde: string; hasta: string; exceso_promedio: number; t: number }>;
  };
}
interface Datos {
  calculado: string;
  muestra: Partial<Record<Mercado, { desde: string; hasta: string }>>;
  sesgos: string[];
  base: Record<Mercado, { '3m': { acierto: number | null } }>;
  metodos: Partial<Record<ClaveMetodo, Metodo>>;
}
const D = datos as unknown as Datos;

export const anioEvidencia = (muestra: Datos['muestra'] = D.muestra) => {
  const m = muestra['EE.UU.'] ?? muestra.Chile;
  return m ? `${m.desde.slice(0, 4)}–${m.hasta.slice(0, 4)}` : '';
};

export const sesgosEvidencia = () => D.sesgos;

/** Exceso a 3 meses de un método del Top, su fuerza y cada mitad de la muestra. */
export function evidenciaMetodo(clave: ClaveMetodo) {
  const m = D.metodos[clave];
  const x = m?.['3m'];
  const base = m ? D.base[m.mercado]?.['3m']?.acierto : null;
  if (!m || !x || x.exceso_promedio === null || x.t === null || x.acierto === null || base == null) return null;
  const fuerza = Math.abs(x.t);
  const mitades = Object.values(x.mitades ?? {});
  const nivel: Nivel = x.exceso_promedio <= 0 || fuerza < 1 ? 'sin evidencia' : fuerza >= 2 && mitades.every(v => v.exceso_promedio > 0) ? 'sólida' : 'débil';
  return {
    nombre: m.nombre, n: m.n, mercado: m.mercado, nivel, exceso: x.exceso_promedio, t: x.t, acierto: x.acierto, base,
    mesesPositivos: x.meses_positivos, mitades, anios: anioEvidencia(),
  };
}

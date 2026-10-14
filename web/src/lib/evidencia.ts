import datos from '@/data/evidencia_reglas.json';
import { anioEvidencia as anios, type Mercado, type Nivel } from './evidenciaMetodos';

// Lo que midió el laboratorio de evidencia (evidencia.py en la raíz del repo): cuánto rindieron frente a su
// mercado, en los 3 meses siguientes, las acciones en que se cumplía cada regla del asesor durante 10 años.
// Una regla solo decide si su evidencia va en la dirección que la regla supone; si no, se muestra como dato.
// Solo lo usa el servidor (el asesor); el navegador descarga nada más evidenciaMetodos.ts.

export type { Mercado, Nivel };
export type ClaveRegla =
  | 'veredicto_alcista' | 'veredicto_bajista' | 'stop_roto' | 'estirado' | 'rsi30_alcista' | 'rsi30_bajista'
  | 'rsi70' | 'momentum_positivo' | 'momentum_negativo' | 'tendencia_alcista' | 'tendencia_bajista'
  | 'calidad_alta' | 'calidad_baja' | 'payout_alto' | 'fundamental_favorable' | 'fundamental_debil';

interface Medicion { exceso_promedio: number | null; t: number | null; acierto: number | null; casos: number }
type PorHorizonte = Partial<Record<'3m' | '6m', Medicion>>;
interface Datos {
  calculado: string;
  base: Record<Mercado, { '3m': { acierto: number | null } }>;
  reglas: Record<string, { nombre: string } & Partial<Record<Mercado, PorHorizonte>>>;
  muestra: Partial<Record<Mercado, { desde: string; hasta: string }>>;
}
const D = datos as unknown as Datos;

export interface Evidencia {
  regla: ClaveRegla;
  nivel: Nivel;
  decide: boolean; // la evidencia acompaña a la regla: puede pesar en la acción
  signo: 1 | -1;   // lo que la regla supone: +1 rinde más que su mercado, -1 rinde menos
  etiqueta: string;
  texto: string;
}

export const mercadoDe = (moneda: 'USD' | 'CLP'): Mercado => (moneda === 'CLP' ? 'Chile' : 'EE.UU.');
const DE_MERCADO: Record<Mercado, string> = { 'EE.UU.': 'acciones de EE.UU.', Chile: 'acciones chilenas' };

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const miles = (n: number) => n.toLocaleString('es-CL');

const anioEvidencia = () => anios(D.muestra);

/** `signo`: +1 si la regla supone que esas acciones rinden más que su mercado, -1 si supone que rinden menos. */
export function evidencia(regla: ClaveRegla, mercado: Mercado, signo: 1 | -1, describe: string): Evidencia {
  const m3 = D.reglas[regla]?.[mercado]?.['3m'];
  const m6 = D.reglas[regla]?.[mercado]?.['6m'];
  const base = D.base[mercado]?.['3m']?.acierto;
  const sin = (texto: string): Evidencia => ({ regla, nivel: 'sin evidencia', decide: false, signo, etiqueta: describe, texto });
  // Medida en otro mercado pero no en este (fundamentales: solo hay historia gratuita de EE.UU.)
  if (D.reglas[regla] && !D.reglas[regla][mercado]) {
    return sin(`${describe}: no se pudo medir en ${DE_MERCADO[mercado]} (no hay estados financieros históricos gratuitos); no se usa para decidir.`);
  }
  if (!m3 || m3.exceso_promedio === null || m3.t === null || m3.acierto === null || base == null || m3.casos < 30) {
    return sin(`${describe}: en ${anioEvidencia()} hubo muy pocos casos en ${DE_MERCADO[mercado]} para medirla; no se usa para decidir.`);
  }
  const dir = Math.sign(m3.exceso_promedio);
  // El promedio, el plazo de 6 meses y la tasa de acierto deben apuntar al mismo lado: un promedio inflado por
  // unos pocos rebotes enormes (con aciertos bajo lo normal) no cuenta como evidencia
  const coherente = (m6?.exceso_promedio == null || Math.sign(m6.exceso_promedio) === dir) && Math.sign(m3.acierto - base) === dir;
  const fuerza = Math.abs(m3.t);
  const medida: Nivel = !coherente || fuerza < 1 ? 'sin evidencia' : fuerza >= 2 ? 'sólida' : 'débil';
  const nivel: Nivel = medida !== 'sin evidencia' && dir !== signo ? 'en contra' : medida;
  const cierre = {
    'sólida': 'Evidencia sólida.',
    'débil': 'Evidencia débil: pesa poco en la decisión.',
    'sin evidencia': 'No anticipó nada de forma confiable: no se usa para decidir.',
    'en contra': 'La evidencia va en contra de lo que supone la regla: no se usa para decidir.',
  }[nivel];
  return {
    regla, nivel, decide: nivel === 'sólida' || nivel === 'débil', signo, etiqueta: describe,
    texto: `${describe}: en ${anioEvidencia()}, las ${DE_MERCADO[mercado]} en esa situación rindieron ${signed(m3.exceso_promedio)} frente a su mercado en los 3 meses siguientes y le ganaron ${pct(m3.acierto, 0)} de las veces (una cualquiera: ${pct(base, 0)}; ${miles(m3.casos)} casos). ${cierre}`,
  };
}

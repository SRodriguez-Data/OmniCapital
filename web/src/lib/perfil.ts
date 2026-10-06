// Perfil del inversionista: lo que la cartera no muestra por sí sola (cuándo necesitas la plata, cuánta caída
// aguantas, si tienes un colchón aparte). Lo usan el formulario (navegador) y el asesor (servidor).

export type Horizonte = 'menos_1' | '1_3' | '3_5' | '5_10' | 'mas_10';
export type Objetivo = 'preservar' | 'ingresos' | 'crecimiento';
export type ReaccionCaida = 'vender_todo' | 'vender_parte' | 'mantener' | 'comprar_mas';
export type FondoEmergencia = 'si' | 'parcial' | 'no';
export type Experiencia = 'principiante' | 'intermedia' | 'avanzada';
export type NivelRiesgo = 'conservador' | 'moderado' | 'agresivo';

export interface PerfilInversionista {
  horizonte: Horizonte;
  objetivo: Objetivo;
  reaccionCaida: ReaccionCaida;
  fondoEmergencia: FondoEmergencia;
  deudaCara: boolean;
  experiencia: Experiencia;
  aporteMensual: number | null; // en pesos
}

type Opciones<T extends string> = { valor: T; texto: string }[];

export const PREGUNTAS: {
  horizonte: Opciones<Horizonte>;
  objetivo: Opciones<Objetivo>;
  reaccionCaida: Opciones<ReaccionCaida>;
  fondoEmergencia: Opciones<FondoEmergencia>;
  experiencia: Opciones<Experiencia>;
} = {
  horizonte: [
    { valor: 'menos_1', texto: 'En menos de 1 año' },
    { valor: '1_3', texto: 'Entre 1 y 3 años' },
    { valor: '3_5', texto: 'Entre 3 y 5 años' },
    { valor: '5_10', texto: 'Entre 5 y 10 años' },
    { valor: 'mas_10', texto: 'En más de 10 años' },
  ],
  objetivo: [
    { valor: 'preservar', texto: 'Cuidar lo que tengo (que no pierda valor)' },
    { valor: 'ingresos', texto: 'Recibir ingresos (dividendos)' },
    { valor: 'crecimiento', texto: 'Que crezca a largo plazo' },
  ],
  reaccionCaida: [
    { valor: 'vender_todo', texto: 'Vendería todo para no perder más' },
    { valor: 'vender_parte', texto: 'Vendería una parte' },
    { valor: 'mantener', texto: 'Esperaría sin vender' },
    { valor: 'comprar_mas', texto: 'Compraría más aprovechando el precio' },
  ],
  fondoEmergencia: [
    { valor: 'si', texto: 'Sí, de 3 a 6 meses de gastos o más' },
    { valor: 'parcial', texto: 'Algo, menos de 3 meses' },
    { valor: 'no', texto: 'No' },
  ],
  experiencia: [
    { valor: 'principiante', texto: 'Estoy empezando' },
    { valor: 'intermedia', texto: 'Algunos años, entiendo lo básico' },
    { valor: 'avanzada', texto: 'Mucha, sigo el mercado de cerca' },
  ],
};

const valido = <T extends string>(opciones: Opciones<T>, x: unknown): x is T => opciones.some(o => o.valor === x);

// Valida lo que llega del navegador o de la base: cualquier campo inválido descarta el perfil completo
export function parsePerfil(x: unknown): PerfilInversionista | null {
  if (!x || typeof x !== 'object') return null;
  const p = x as Record<string, unknown>;
  if (!valido(PREGUNTAS.horizonte, p.horizonte) || !valido(PREGUNTAS.objetivo, p.objetivo)
    || !valido(PREGUNTAS.reaccionCaida, p.reaccionCaida) || !valido(PREGUNTAS.fondoEmergencia, p.fondoEmergencia)
    || !valido(PREGUNTAS.experiencia, p.experiencia) || typeof p.deudaCara !== 'boolean') return null;
  const aporte = Number(p.aporteMensual);
  return {
    horizonte: p.horizonte, objetivo: p.objetivo, reaccionCaida: p.reaccionCaida, fondoEmergencia: p.fondoEmergencia,
    experiencia: p.experiencia, deudaCara: p.deudaCara,
    aporteMensual: p.aporteMensual !== null && p.aporteMensual !== '' && Number.isFinite(aporte) && aporte > 0 && aporte < 1e10 ? Math.round(aporte) : null,
  };
}

export interface Adecuacion {
  nivel: NivelRiesgo;
  volMaxima: number;      // volatilidad anual razonable para el perfil
  caidaTolerable: number; // caída desde el máximo que dijo poder aguantar
  plazoCorto: boolean;    // necesita la plata antes de 3 años
}

const PUNTOS = {
  horizonte: { menos_1: 0, '1_3': 1, '3_5': 2, '5_10': 3, mas_10: 4 },
  reaccionCaida: { vender_todo: 0, vender_parte: 1, mantener: 2, comprar_mas: 3 },
  objetivo: { preservar: 0, ingresos: 1, crecimiento: 2 },
  experiencia: { principiante: 0, intermedia: 0.5, avanzada: 1 },
} as const;
const ORDEN: NivelRiesgo[] = ['conservador', 'moderado', 'agresivo'];
export const VOL_MAXIMA: Record<NivelRiesgo, number> = { conservador: 0.1, moderado: 0.16, agresivo: 0.25 };
const CAIDA: Record<ReaccionCaida, number> = { vender_todo: 0.1, vender_parte: 0.2, mantener: 0.35, comprar_mas: 0.5 };

// Nivel de riesgo que corresponde al perfil. El plazo y la reacción ante caídas ponen un techo: alguien que
// necesita la plata en dos años o que vendería todo en una caída no es agresivo aunque sume puntos por objetivo.
export function adecuacion(p: PerfilInversionista): Adecuacion {
  const puntos = PUNTOS.horizonte[p.horizonte] + PUNTOS.reaccionCaida[p.reaccionCaida] + PUNTOS.objetivo[p.objetivo] + PUNTOS.experiencia[p.experiencia];
  let nivel: NivelRiesgo = puntos <= 4 ? 'conservador' : puntos <= 7 ? 'moderado' : 'agresivo';
  const techo: NivelRiesgo = p.horizonte === 'menos_1' || p.horizonte === '1_3' || p.reaccionCaida === 'vender_todo'
    ? 'conservador' : p.reaccionCaida === 'vender_parte' || p.horizonte === '3_5' ? 'moderado' : 'agresivo';
  if (ORDEN.indexOf(nivel) > ORDEN.indexOf(techo)) nivel = techo;
  return {
    nivel,
    volMaxima: VOL_MAXIMA[nivel],
    caidaTolerable: CAIDA[p.reaccionCaida],
    plazoCorto: p.horizonte === 'menos_1' || p.horizonte === '1_3',
  };
}

export const textoDe = <K extends keyof typeof PREGUNTAS>(pregunta: K, valor: string) =>
  (PREGUNTAS[pregunta] as Opciones<string>).find(o => o.valor === valor)?.texto ?? valor;

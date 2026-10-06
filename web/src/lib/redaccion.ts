import { generateText, aiError, type JsonSchema } from './ai';
import { fmtMoney, type AdvisorReport, type AssetReport } from './advisor';

// Redacción del informe con IA. Va en una llamada aparte del cálculo: así el informe aparece apenas están los
// números y la IA tiene su propio tiempo aunque la descarga de datos haya sido lenta. La IA solo redacta:
// todo lo que escribe se contrasta con las cifras y decisiones calculadas.

export interface Redaccion {
  diagnostico: string | null;
  comentarios: Record<string, string>;
  modelo: string | null;
  avisoIa: string | null;
}

const responseSchema: JsonSchema = {
  type: 'object',
  properties: {
    diagnostico: { type: 'string' },
    posiciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ticker: { type: 'string' }, comentario: { type: 'string' } },
        required: ['ticker', 'comentario'],
        additionalProperties: false,
      },
    },
  },
  required: ['diagnostico', 'posiciones'],
  additionalProperties: false,
};

const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? 'N/D' : `${(x * 100).toFixed(digits)}%`);

export async function redactar(r: AdvisorReport, timeoutMs: number): Promise<Redaccion> {
  const { prompt, cifras } = buildPrompt(r);
  try {
    const { text, model } = await generateText(prompt, { schema: responseSchema, speed: 'fast', timeoutMs });
    const data = JSON.parse(text);
    const general = cifras.get('*') ?? [];
    const descartados: string[] = [];
    let diagnostico: string | null = null;
    if (typeof data?.diagnostico === 'string' && data.diagnostico.trim()) {
      const d = data.diagnostico.trim();
      if (cifrasValidas(d, [...general, ...[...cifras.values()].flat()])) diagnostico = d;
      else descartados.push('diagnóstico');
    }
    const comentarios: Record<string, string> = {};
    for (const p of Array.isArray(data?.posiciones) ? data.posiciones : []) {
      const t = typeof p?.ticker === 'string' ? p.ticker.toUpperCase() : '';
      const pos = r.posiciones.find(x => x.ticker === t);
      if (!pos || typeof p.comentario !== 'string' || !p.comentario.trim()) continue;
      const c = p.comentario.trim();
      if (accionConsistente(c, pos) && cifrasValidas(c, [...(cifras.get(t) ?? []), ...general])) comentarios[t] = c;
      else descartados.push(t);
    }
    if (descartados.length) console.warn('Textos de IA descartados por cifras o acciones que no calzan:', descartados.join(', '));
    return { diagnostico, comentarios, modelo: model, avisoIa: null };
  } catch (error) {
    console.error('IA no disponible para el diagnóstico:', error);
    return { diagnostico: null, comentarios: {}, modelo: null, avisoIa: `${aiError(error).message} Se muestra el análisis calculado sin redacción de IA.` };
  }
}

// La IA no puede contradecir la acción calculada
function accionConsistente(texto: string, p: AssetReport): boolean {
  const mencionadas = (texto.match(/\b(AUMENTAR|MANTENER|REDUCIR)\b/g) ?? []);
  return mencionadas.every(a => a === p.accion);
}

// Cada porcentaje que escribe la IA debe estar en los datos que recibió (con tolerancia de redondeo)
function cifrasValidas(texto: string, permitidas: number[]): boolean {
  const escritas = [...texto.matchAll(/(-?\d+(?:[.,]\d+)?)\s?%/g)].map(m => Math.abs(parseFloat(m[1].replace(',', '.'))));
  return escritas.every(x => permitidas.some(y => Math.abs(x - Math.abs(y)) <= 0.11 || (Number.isInteger(x) && Math.abs(x - Math.abs(y)) < 0.51)));
}

const numerosDe = (s: string) => [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));

function lineaFundamental(p: AssetReport): string {
  const f = p.fundamentales;
  if (!f) return 'sin datos fundamentales';
  const partes: string[] = [];
  if (f.per !== undefined) partes.push(`PER ${f.per.toFixed(1)}`);
  if (f.perForward !== undefined) partes.push(`PER esperado ${f.perForward.toFixed(1)}`);
  if (f.pvl !== undefined) partes.push(`P/VL ${f.pvl.toFixed(1)}`);
  if (f.roe !== undefined) partes.push(`ROE ${pct(f.roe)}`);
  if (f.margen !== undefined) partes.push(`margen ${pct(f.margen)}`);
  if (f.crecimientoUtilidad !== undefined) partes.push(`crec. utilidad ${pct(f.crecimientoUtilidad)}`);
  if (f.dividendYield !== undefined) partes.push(`dividendo ${pct(f.dividendYield)}`);
  if (f.payout !== undefined) partes.push(`payout ${pct(f.payout, 0)}`);
  if (f.analistas) partes.push(`${f.analistas.n} analistas: ${f.analistas.recomendacion}, objetivo ${fmtMoney(f.analistas.objetivo, p.moneda)} (potencial ${pct(f.analistas.potencial)})`);
  if (f.gastoAnual !== undefined) partes.push(`costo anual ${pct(f.gastoAnual, 2)}`);
  return partes.join(', ') || 'sin datos fundamentales';
}

function buildPrompt(r: AdvisorReport): { prompt: string; cifras: Map<string, number[]> } {
  const s = r.resumen;
  const cifras = new Map<string, number[]>();
  const lineas = r.posiciones.map(p => {
    const linea = [
      `- ${p.ticker}${p.nombre ? ` (${p.nombre})` : ''} [${p.tipo}${p.sector ? `, ${p.sector}` : ''}]: DECISIÓN ${p.accion} (convicción ${p.conviccion})`,
      `peso ${pct(p.peso)}${p.pesoEfectivo > p.peso + 0.005 ? ` (${pct(p.pesoEfectivo)} contando fondos)` : ''}`,
      `P&L desde compra ${pct(p.pnl)}`,
      `12m con dividendos ${pct(p.ret1y)}`,
      `3 años anual ${pct(p.ret3y)}`,
      `volatilidad ${pct(p.vol, 0)}`,
      `aporte al riesgo ${pct(p.aporteRiesgo)}`,
      `técnico ${p.tecnico.veredicto}: ${p.tecnico.motivos.join(' ')}`,
      `fundamental ${p.fundamental.veredicto} (${lineaFundamental(p)}): ${p.fundamental.motivos.join(' ')}`,
      `riesgo ${p.riesgo.veredicto}: ${p.riesgo.motivos.join(' ')}`,
      `motivos de la decisión: ${p.motivos.join(' ')}`,
    ].join(' | ');
    cifras.set(p.ticker, numerosDe(linea));
    return linea;
  }).join('\n');

  const ex = r.exposicion;
  const general = [
    `Portafolio: valor ${fmtMoney(s.valorCLP, 'CLP')} CLP, resultado desde la compra ${pct(s.pnlPct)}, ${pct(s.pesoUSD, 0)} en dólares.`,
    `Riesgo en pesos (simulación con los pesos actuales, ${s.ventanaAnios} años, con dividendos): volatilidad ${pct(s.vol)}, caída máxima ${pct(s.maxDD)}, 12 meses ${pct(s.ret1y)}, anual en la ventana ${pct(s.retAnualVentana)}, perfil ${s.perfil ?? 'N/D'}, parte del riesgo que viene del dólar ${pct(s.riesgoCambiario, 0)}. TPM ${pct(r.tasaLibreRiesgo)}.${s.indice ? ` Índice equivalente (${s.indice.nombre}): ${pct(s.indice.ret1y)}.` : ''}`,
    `Regiones: ${ex.regiones.map(x => `${x.nombre} ${pct(x.peso, 0)}`).join(', ')}. Sectores (contando lo que hay dentro de los fondos): ${ex.sectores.slice(0, 6).map(x => `${x.nombre} ${pct(x.peso, 0)}`).join(', ')}.`,
    r.mercado ? `Contexto de mercado (${r.mercado.regimen}): ${r.mercado.titulo}. ${r.mercado.lecturas.join(' ')}` : 'Contexto de mercado no disponible.',
  ].join('\n');
  cifras.set('*', numerosDe(general + r.hallazgos.map(h => ` ${h.titulo} ${h.detalle}`).join('') + r.estrategia.join(' ')));

  const prompt = `Eres un asesor de inversiones chileno, técnico y estratégico, que explica a su cliente el informe de su portafolio.
Todas las cifras, veredictos y decisiones ya fueron calculados con datos reales (precios ajustados por dividendos, fundamentales y consenso de analistas de Yahoo Finance, contexto de mercado). Tu trabajo es SOLO explicarlos con criterio profesional.

${general}

Hallazgos:
${r.hallazgos.map(h => `- [${h.nivel}] ${h.titulo}. ${h.detalle}`).join('\n')}

Plan estratégico calculado:
${r.estrategia.map(e => `- ${e}`).join('\n')}

Posiciones (técnico | fundamental | riesgo | decisión):
${lineas}

Reglas:
- No cambies ninguna DECISIÓN ni la contradigas. No inventes cifras, noticias, precios objetivo ni indicadores: usa solo los números de arriba, escritos igual.
- Español de Chile, claro y directo, sin jerga innecesaria; si usas un término técnico (PER, ROE, momentum), explícalo en pocas palabras.
- "diagnostico": 150 a 220 palabras. Primero el contexto de mercado en una frase, luego qué tan sano está el portafolio (diversificación por país y sector, riesgo), sus 2 o 3 problemas principales y el orden de los pasos del plan.
- "posiciones": una por cada ticker, en el mismo orden. "comentario": 40 a 70 palabras que conecten los pilares (técnico, fundamental y riesgo) y expliquen por qué la decisión tiene sentido y qué haría el cliente en concreto.`;
  return { prompt, cifras };
}

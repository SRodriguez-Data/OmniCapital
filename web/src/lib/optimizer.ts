import type { AdvisorReport, AssetReport } from './advisor';

// Reparte capital nuevo sin vender nada: calcula un peso objetivo por activo según su riesgo
// (menos volatilidad, más peso) y su señal, y compra solo lo que está bajo ese objetivo.

export interface Orden {
  ticker: string;
  nombre?: string;
  origen: 'EN_CARTERA' | 'OPORTUNIDAD';
  accion: AssetReport['accion'];
  moneda: 'USD' | 'CLP';
  sharesToBuy: number;
  price: number; // en la moneda del presupuesto
  expectedCost: number;
  pesoAntes: number;
  pesoDespues: number;
  pesoObjetivo: number;
  rationale: string;
}

export interface Plan {
  recommendations: Orden[];
  totalCost: number;
  excluidos: { ticker: string; motivo: string }[];
}

const MULTIPLICADOR = { AUMENTAR: 1.5, MANTENER: 1, REDUCIR: 0 } as const;
const TOPE = 0.2; // peso máximo de una empresa individual dentro de lo que se compra
const TOPE_FONDO = 0.4;
const MIN_ORDEN = 0.03; // órdenes bajo el 3% del presupuesto no valen la comisión
const MAX_ORDENES = 8;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Normaliza pesos respetando topes: lo que excede un tope se reparte entre los demás
function capWeights(raw: number[], caps: number[]): number[] {
  let w = raw.map(x => x / raw.reduce((s, y) => s + y, 0));
  for (let iter = 0; iter < 20; iter++) {
    const capped = w.map((x, i) => x >= caps[i]);
    const excess = w.reduce((s, x, i) => s + Math.max(0, x - caps[i]), 0);
    if (excess < 1e-9) break;
    const freeSum = w.reduce((s, x, i) => s + (capped[i] ? 0 : x), 0);
    if (freeSum <= 0) break;
    w = w.map((x, i) => (capped[i] ? caps[i] : x + excess * x / freeSum));
  }
  return w;
}

export function planPurchases(
  report: AdvisorReport,
  budget: number,
  currency: 'USD' | 'CLP',
  { fraccionar }: { fraccionar: boolean },
): Plan {
  const usdClp = report.usdClp;
  const toCLP = (n: number, moneda: 'USD' | 'CLP') => (moneda === 'USD' ? n * usdClp : n);
  const fromCLP = (n: number) => (currency === 'USD' ? n / usdClp : n);
  const budgetCLP = toCLP(budget, currency);

  const excluidos: Plan['excluidos'] = [];
  const universo: (AssetReport & { origen: Orden['origen'] })[] = [];
  for (const a of report.posiciones) {
    if (!a.conDatos || a.vol === null) excluidos.push({ ticker: a.ticker, motivo: 'Sin historial suficiente para medir su riesgo.' });
    else if (a.accion === 'REDUCIR') excluidos.push({ ticker: a.ticker, motivo: 'Su recomendación es REDUCIR: no conviene comprar más.' });
    else if (a.stopActivado) excluidos.push({ ticker: a.ticker, motivo: 'Perforó su stop de volatilidad: espera a que se estabilice antes de comprar más.' });
    else if (a.puntaje < 0) excluidos.push({ ticker: a.ticker, motivo: 'Sus señales de tendencia son negativas: mejor esperar a que se estabilice antes de comprar más.' });
    else if (a.gemeloDe) excluidos.push({ ticker: a.ticker, motivo: `Se mueve casi igual que ${a.gemeloDe}: la compra se concentra en ${a.gemeloDe}.` });
    else universo.push({ ...a, origen: 'EN_CARTERA' });
  }
  // Las oportunidades del escáner solo entran si sus propias señales no son negativas
  for (const c of report.candidatos) {
    if (c.conDatos && c.vol !== null && c.accion !== 'REDUCIR' && c.puntaje >= 0 && !c.stopActivado) universo.push({ ...c, origen: 'OPORTUNIDAD' });
  }
  if (universo.length === 0) return { recommendations: [], totalCost: 0, excluidos };

  // 1. Peso objetivo: inverso de la volatilidad, potenciado por la señal y con topes de concentración
  const w = capWeights(
    universo.map(a => MULTIPLICADOR[a.accion] / Math.max(a.vol!, 0.05)),
    universo.map(a => (a.diversificado ? TOPE_FONDO : TOPE)),
  );
  const totalUniverso = universo.reduce((s, a) => s + a.valorCLP, 0) + budgetCLP;
  const objetivo = w.map(x => x * totalUniverso);
  const deficit = universo.map((a, i) => Math.max(0, objetivo[i] - a.valorCLP));
  const sumDeficit = deficit.reduce((s, x) => s + x, 0);

  // 2. El presupuesto se reparte según lo que le falta a cada uno para llegar a su objetivo
  let asignado = sumDeficit >= budgetCLP
    ? deficit.map(d => budgetCLP * d / sumDeficit)
    : deficit.map((d, i) => d + (budgetCLP - sumDeficit) * w[i]);

  const elegidos = asignado
    .map((x, i) => ({ i, x }))
    .filter(({ x }) => x >= MIN_ORDEN * budgetCLP)
    .sort((a, b) => b.x - a.x)
    .slice(0, MAX_ORDENES)
    .map(({ i }) => i);
  const sumElegidos = elegidos.reduce((s, i) => s + asignado[i], 0);
  asignado = asignado.map((x, i) => (elegidos.includes(i) && sumElegidos > 0 ? budgetCLP * x / sumElegidos : 0));

  // 3. A unidades: acciones chilenas enteras; en EE.UU. se permiten fracciones si el corredor las acepta
  const precioCLP = universo.map(a => toCLP(a.precio, a.moneda));
  const fraccional = universo.map(a => fraccionar && a.moneda === 'USD');
  const unidades = universo.map((_, i) => {
    const n = asignado[i] / precioCLP[i];
    return fraccional[i] ? Math.floor(n * 10000) / 10000 : Math.floor(n);
  });

  // 4. Lo que sobra por redondeo se usa en el activo que sigue más lejos de su objetivo
  let restante = budgetCLP - unidades.reduce((s, u, i) => s + u * precioCLP[i], 0);
  const falta = (i: number) => objetivo[i] - universo[i].valorCLP - unidades[i] * precioCLP[i];
  for (let guard = 0; guard < 500; guard++) {
    const candidatos = elegidos
      .filter(i => (fraccional[i] ? restante >= precioCLP[i] * 0.0001 : precioCLP[i] <= restante))
      .sort((a, b) => falta(b) - falta(a));
    const i = candidatos[0];
    if (i === undefined) break;
    const extra = fraccional[i] ? Math.floor((restante / precioCLP[i]) * 10000) / 10000 : 1;
    if (extra <= 0) break;
    unidades[i] += extra;
    restante -= extra * precioCLP[i];
  }

  const totalCartera = report.resumen.valorCLP;
  const totalCost = unidades.reduce((s, u, i) => s + u * precioCLP[i], 0);
  const recommendations: Orden[] = universo
    .map((a, i): Orden | null => {
      if (unidades[i] <= 0) return null;
      const costo = unidades[i] * precioCLP[i];
      const pesoAntes = totalCartera > 0 ? a.valorCLP / totalCartera : 0;
      const pesoDespues = (a.valorCLP + costo) / (totalCartera + totalCost);
      const pesoObjetivo = objetivo[i] / (totalCartera + budgetCLP);
      const senal = a.motivos[0] ? ` ${a.motivos[0]}` : '';
      return {
        ticker: a.ticker,
        nombre: a.nombre,
        origen: a.origen,
        accion: a.accion,
        moneda: a.moneda,
        sharesToBuy: Math.round(unidades[i] * 10000) / 10000,
        price: fromCLP(precioCLP[i]),
        expectedCost: fromCLP(costo),
        pesoAntes,
        pesoDespues,
        pesoObjetivo,
        rationale: a.origen === 'OPORTUNIDAD'
          ? `Nueva posición del escáner diario, señal ${a.accion}.${senal} Volatilidad ${pct(a.vol!)}: entra con ${pct(pesoDespues)} del portafolio.`
          : `Señal ${a.accion}.${senal} Peso ${pct(pesoAntes)} → ${pct(pesoDespues)} (objetivo ${pct(pesoObjetivo)}, según su volatilidad de ${pct(a.vol!)}).`,
      };
    })
    .filter((o): o is Orden => o !== null)
    .sort((a, b) => b.expectedCost - a.expectedCost);

  return { recommendations, totalCost: fromCLP(totalCost), excluidos };
}

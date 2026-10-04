import { limiteDe, type AdvisorReport, type AssetReport, type RiskModel } from './advisor';
import { capWeights, riskParityWeights } from './quant';

// Reparte capital nuevo sin vender nada. El peso objetivo de cada activo sale de la paridad de riesgo
// (cada activo aporta lo mismo al riesgo total, usando la covarianza completa en pesos), inclinada por
// su señal y con topes de concentración sobre el portafolio entero. Solo se compra lo que está bajo
// su objetivo; si sobra dinero, queda explícitamente sin asignar.

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
  sinAsignar: number;
  motivoSinAsignar: string | null;
  excluidos: { ticker: string; motivo: string }[];
}

const INCLINACION = { AUMENTAR: 1.25, MANTENER: 1, REDUCIR: 1 } as const;
const TOPE_NUEVA = 0.05; // una posición nueva parte con poco peso
const MIN_ORDEN_PCT = 0.03; // órdenes bajo el 3% del presupuesto...
const MIN_ORDEN_CLP = 10000; // ...o bajo $10.000 no valen el trámite
const MAX_ORDENES = 8;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function motivoExclusion(a: AssetReport, esCandidato: boolean): string | null {
  if (!a.conDatos || a.vol === null) return 'Sin precios confiables al día para medir su riesgo.';
  if (a.accion === 'REDUCIR') return 'Su recomendación es REDUCIR: no conviene comprar más.';
  if (a.stopActivado) return 'Cerró bajo su stop de volatilidad: espera a que se estabilice antes de comprar más.';
  if (a.puntaje < 0) return 'Sus señales de tendencia son negativas: mejor esperar a que se estabilice antes de comprar más.';
  if (a.gemeloDe) return esCandidato
    ? `Se mueve casi igual que ${a.gemeloDe}, que ya tienes: no agrega diversificación.`
    : `Se mueve casi igual que ${a.gemeloDe}: la compra se concentra en ${a.gemeloDe}.`;
  return null;
}

export function planPurchases(
  report: AdvisorReport,
  modelo: RiskModel,
  budget: number,
  currency: 'USD' | 'CLP',
  { fraccionar }: { fraccionar: boolean },
): Plan {
  const usdClp = report.usdClp;
  const toCLP = (n: number, moneda: 'USD' | 'CLP') => (moneda === 'USD' ? n * usdClp : n);
  const fromCLP = (n: number) => (currency === 'USD' ? n / usdClp : n);
  const budgetCLP = toCLP(budget, currency);
  const totalCartera = report.resumen.valorCLP;
  const totalDespues = totalCartera + budgetCLP;

  const excluidos: Plan['excluidos'] = [];
  const index = new Map(modelo.tickers.map((t, i) => [t, i]));
  const todos = [
    ...report.posiciones.map(a => ({ a, origen: 'EN_CARTERA' as const })),
    ...report.candidatos.filter(c => index.has(c.ticker)).map(a => ({ a, origen: 'OPORTUNIDAD' as const })),
  ];
  for (const a of report.posiciones) {
    const motivo = motivoExclusion(a, false)
      ?? (index.has(a.ticker) ? null : 'Tiene menos de un año de precios: no se puede medir su riesgo para fijarle un objetivo.');
    if (motivo) excluidos.push({ ticker: a.ticker, motivo });
  }

  // 1. Objetivos de paridad de riesgo sobre todo lo que tiene modelo de riesgo (incluye lo que no se
  //    compra, para que su espacio cuente), inclinados por la señal y con topes sobre el total
  const enModelo = todos.filter(({ a, origen }) => index.has(a.ticker) && (origen === 'EN_CARTERA' || !motivoExclusion(a, true)));
  const elegible = (x: { a: AssetReport; origen: string }) => !motivoExclusion(x.a, x.origen === 'OPORTUNIDAD');
  if (!enModelo.some(elegible)) {
    return { recommendations: [], totalCost: 0, sinAsignar: budget, motivoSinAsignar: 'Ningún activo cumple hoy las condiciones para comprar.', excluidos };
  }
  const ids = enModelo.map(({ a }) => index.get(a.ticker)!);
  const cov = ids.map(i => ids.map(j => modelo.cov[i][j]));
  const paridad = riskParityWeights(cov);
  const { weights } = capWeights(
    paridad.map((p, k) => p * INCLINACION[enModelo[k].a.accion]),
    enModelo.map(({ a, origen }) => (origen === 'OPORTUNIDAD' ? TOPE_NUEVA : limiteDe(a))),
  );

  // La parte del portafolio sin modelo de riesgo (sin datos) se mantiene: el objetivo reparte el resto
  const valorFuera = report.posiciones.filter(a => !index.has(a.ticker)).reduce((s, a) => s + a.valorCLP, 0);
  const objetivo = weights.map(w => w * (totalDespues - valorFuera));
  const tope = enModelo.map(({ a, origen }) => (origen === 'OPORTUNIDAD' ? TOPE_NUEVA : limiteDe(a)) * totalDespues);
  const valor = (k: number) => enModelo[k].a.valorCLP;

  // Reparte `monto` en proporción a `peso` sin pasar la capacidad de cada uno; devuelve lo que no cupo
  const llenar = (monto: number, ks: number[], peso: (k: number) => number, capacidad: (k: number) => number, asig: number[]) => {
    let abiertos = ks.filter(k => capacidad(k) > 1 && peso(k) > 0);
    while (monto > 1 && abiertos.length) {
      const sumP = abiertos.reduce((s, k) => s + peso(k), 0);
      let usado = 0;
      for (const k of abiertos) {
        const parte = Math.min(capacidad(k), monto * peso(k) / sumP);
        asig[k] += parte;
        usado += parte;
      }
      monto -= usado;
      abiertos = abiertos.filter(k => capacidad(k) > 1);
      if (usado < 1e-6) break;
    }
    return monto;
  };
  // 2. Primero se completa lo que le falta a cada uno para su objetivo; lo que sobre se reparte según los
  //    pesos objetivo, siempre bajo el tope de concentración. Si ni así cabe, queda sin asignar.
  const repartir = (ks: number[]) => {
    const asig = new Array<number>(enModelo.length).fill(0);
    const deficit = (k: number) => objetivo[k] - valor(k) - asig[k];
    const resto = llenar(budgetCLP, ks, deficit, deficit, asig);
    llenar(resto, ks, k => weights[k], k => tope[k] - valor(k) - asig[k], asig);
    return asig;
  };

  // Órdenes chicas (no valen el trámite) o de más se sacan de a una, para que su dinero se concentre en el resto
  const minOrden = Math.max(MIN_ORDEN_PCT * budgetCLP, MIN_ORDEN_CLP);
  let activos = enModelo.map((_, k) => k).filter(k => elegible(enModelo[k]) && tope[k] > valor(k));
  let asignado = repartir(activos);
  while (activos.length) {
    const menor = activos.reduce((m, k) => (asignado[k] < asignado[m] ? k : m), activos[0]);
    if (asignado[menor] >= minOrden && activos.length <= MAX_ORDENES) break;
    activos = activos.filter(k => k !== menor);
    asignado = repartir(activos);
  }

  // 3. A unidades: acciones chilenas enteras; en EE.UU. fracciones si el corredor las acepta
  const precioCLP = enModelo.map(({ a }) => toCLP(a.precio, a.moneda));
  const fraccional = enModelo.map(({ a }) => fraccionar && a.moneda === 'USD');
  const unidades = asignado.map((x, k) => {
    const n = x / precioCLP[k];
    return fraccional[k] ? Math.floor(n * 10000) / 10000 : Math.floor(n);
  });

  // 4. Lo que sobró por redondeo va al activo más lejos de su objetivo, sin pasar su tope por más de media acción
  let restante = budgetCLP - unidades.reduce((s, u, k) => s + u * precioCLP[k], 0);
  const comprado = (k: number) => unidades[k] * precioCLP[k];
  const espacio = (k: number) => tope[k] - valor(k) - comprado(k);
  for (let guard = 0; guard < 500; guard++) {
    const k = activos
      .filter(i => (fraccional[i]
        ? espacio(i) > 1 && restante > precioCLP[i] * 0.0001
        : precioCLP[i] <= restante && espacio(i) >= precioCLP[i] / 2))
      .sort((x, y) => (objetivo[y] - valor(y) - comprado(y)) - (objetivo[x] - valor(x) - comprado(x)))[0];
    if (k === undefined) break;
    const extra = fraccional[k] ? Math.floor((Math.min(restante, espacio(k)) / precioCLP[k]) * 10000) / 10000 : 1;
    if (extra <= 0) break;
    unidades[k] += extra;
    restante -= extra * precioCLP[k];
  }

  const totalCost = unidades.reduce((s, u, k) => s + u * precioCLP[k], 0);
  const recommendations = enModelo
    .map(({ a, origen }, k): Orden | null => {
      if (unidades[k] <= 0) return null;
      const costo = unidades[k] * precioCLP[k];
      const pesoAntes = totalCartera > 0 ? a.valorCLP / totalCartera : 0;
      const pesoDespues = (a.valorCLP + costo) / (totalCartera + totalCost);
      const pesoObjetivo = objetivo[k] / totalDespues;
      const senal = a.motivos[0] ? ` ${a.motivos[0]}` : '';
      return {
        ticker: a.ticker,
        nombre: a.nombre,
        origen,
        accion: a.accion,
        moneda: a.moneda,
        sharesToBuy: Math.round(unidades[k] * 10000) / 10000,
        price: fromCLP(precioCLP[k]),
        expectedCost: fromCLP(costo),
        pesoAntes,
        pesoDespues,
        pesoObjetivo,
        rationale: origen === 'OPORTUNIDAD'
          ? `Nueva posición del escáner diario, señal ${a.accion}.${senal} Entra con ${pct(pesoDespues)} (tope inicial ${pct(TOPE_NUEVA)}).`
          : `Señal ${a.accion}.${senal} Peso ${pct(pesoAntes)} → ${pct(pesoDespues)}; su objetivo por paridad de riesgo es ${pct(pesoObjetivo)}.`,
      };
    })
    .filter((o): o is Orden => o !== null)
    .sort((x, y) => y.expectedCost - x.expectedCost);

  const sinAsignarCLP = budgetCLP - totalCost;
  const sinAsignar = fromCLP(sinAsignarCLP);
  let motivoSinAsignar: string | null = null;
  if (sinAsignarCLP > Math.max(minOrden, 0.01 * budgetCLP)) {
    motivoSinAsignar = recommendations.length === 0
      ? 'El monto no alcanza para una orden que valga la pena en los activos que hoy conviene comprar.'
      : `Invertir más en estos activos pasaría los topes de concentración (20% por empresa, 40% por fondo, 5% en una posición nueva) o exigiría más de ${MAX_ORDENES} órdenes: el resto puede esperar en efectivo o en un fondo money market.`;
  }

  return { recommendations, totalCost: fromCLP(totalCost), sinAsignar, motivoSinAsignar, excluidos };
}

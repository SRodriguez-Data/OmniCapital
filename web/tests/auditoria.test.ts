// Pruebas de lo corregido tras la auditoría de noviembre de 2026: cada una es un caso en que el asesor recomendaba mal.
//   npx tsx --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDICES_NUCLEO, limiteDe, type AdvisorReport, type AssetReport, type RiskModel } from '../src/lib/advisor';
import { NUCLEO, diaHabilAnterior, planAporte, type EntradaAporte } from '../src/lib/aporte';
import { aporteDelMes, compradoEnElMes, veredictoDe } from '../src/lib/asesor';
import { avisosCartera } from '../src/lib/avisos';
import { conEventosAnteriores, type EventoSec } from '../src/lib/eventos';
import type { IdeaTop, IdeasDelBot } from '../src/lib/ideas';
import { lotesParaPortafolio, type LibroInversiones, type PosicionCuenta } from '../src/lib/LibroInversiones';
import type { Semaforo } from '../src/lib/proteccion';
import { COSTO_REINVERSION, netoDeVentas, planRebalanceo, type PlanRebalanceo } from '../src/lib/rebalanceo';

const HOY = '2026-11-18'; // miércoles
const V = 10_000_000;
const idea = (ticker: string, puesto: number, x: Partial<IdeaTop> = {}): IdeaTop => ({
  ticker, mercado: 'EE.UU.', moneda: 'USD', puesto, peso: 0.05, sector: 'Salud', precio: 100, fechaPrecio: HOY, per: 15,
  dividendo: null, proximosResultados: null, calidad: 0.1, percentilSector: 1, momentum: null, ...x,
});
const IDEAS: IdeasDelBot = { fecha: HOY, us: ['AAA', 'BBB', 'CCC'].map((t, i) => idea(t, i + 1)), cl: [] };
const luz = (clave: Semaforo['clave'], estado: Semaforo['estado'] = 'verde'): Semaforo => ({
  clave, nombre: clave, ticker: 'X', estado, fecha: HOY, precio: 100, media: 100, distancia: 0, cambiaEn: 100, distanciaCambio: 0, desde: null, caidaDesdeMaximo: 0,
});
const LUCES = [luz('eeuu'), luz('tecnologia'), luz('chile')];
function entrada(x: Partial<EntradaAporte> = {}): EntradaAporte {
  return {
    montoCLP: 300_000, usdClp: 1000, valorCLP: V, chileCLP: 6_000_000, posiciones: [], sectores: [], ideas: IDEAS,
    precios: new Map([['VOO', { price: 600, time: HOY }], ['CFMITNIPSA.SN', { price: 5000, time: HOY }]]),
    nivel: 'moderado', metaChile: 0.6, semaforos: LUCES, proteccion: 'avisar', hoy: HOY, ...x,
  };
}
const monto = (p: ReturnType<typeof planAporte>, t: string) => p.ordenes.find(o => o.ticker === t)?.montoCLP ?? 0;
const sinPlan = { ventas: [], compras: [], sinVender: null } as unknown as PlanRebalanceo;

// --- 1. El aporte del mes no se recomienda dos veces ----------------------------------------------------------------

test('aporte del mes: las compras registradas este mes se descuentan; con el mes hecho, el veredicto lo dice', () => {
  const lotes = [
    { cantidad: 0.1, precio_compra: 600, moneda: 'USD' as const, purchase_date: '2026-11-03' }, // $60.000
    { cantidad: 20, precio_compra: 2000, moneda: 'CLP' as const, purchase_date: '2026-11-03' }, // $40.000
    { cantidad: 5, precio_compra: 600, moneda: 'USD' as const, purchase_date: '2026-10-05' }, // otro mes
    { cantidad: 5, precio_compra: 600, moneda: 'USD' as const, purchase_date: null }, // sin fecha
  ];
  assert.equal(compradoEnElMes(lotes, '2026-11', 1000), 100_000);
  assert.deepEqual(aporteDelMes(150_000, lotes, '2026-11', 1000), { mes: '2026-11', mensualCLP: 150_000, invertidoCLP: 100_000, pendienteCLP: 50_000 });
  // Lo que falta no alcanza para una orden: el mes está hecho
  assert.equal(aporteDelMes(105_000, lotes, '2026-11', 1000)!.pendienteCLP, 0);
  assert.equal(aporteDelMes(150_000, lotes, '2026-12', 1000)!.pendienteCLP, 150_000, 'un mes nuevo parte de cero');
  assert.equal(aporteDelMes(null, lotes, '2026-11', 1000), null);

  const hecho = veredictoDe(null, sinPlan, { mes: '2026-11', mensualCLP: 100_000, invertidoCLP: 100_000, pendienteCLP: 0 });
  assert.equal(hecho.accion, 'MANTENER');
  assert.match(hecho.detalle, /Tu aporte de este mes ya está invertido/);
  assert.doesNotMatch(hecho.detalle, /Indica tu aporte mensual/);
  // Con parte del aporte pendiente, la compra dice que es lo que falta
  const falta = veredictoDe(planAporte(entrada({ montoCLP: 50_000 })), sinPlan, { mes: '2026-11', mensualCLP: 150_000, invertidoCLP: 100_000, pendienteCLP: 50_000 });
  assert.equal(falta.accion, 'COMPRAR');
  assert.match(falta.detalle, /ya registraste compras por \$100\.000/);
});

// --- 3. Ninguna compra deja algo sobre su máximo --------------------------------------------------------------------

test('el índice del núcleo no tiene tope propio: con VOO en 39,8% o en 70% el aporte entra completo', () => {
  const voo = (peso: number) => [{ ticker: 'VOO', valorCLP: peso * V, pesoEfectivo: peso }];
  for (const peso of [0.2, 0.398, 0.7]) {
    const p = planAporte(entrada({ posiciones: voo(peso), ideas: null }));
    assert.ok(monto(p, 'VOO') > 0 && p.sinInvertirCLP < 1000, `con VOO en ${peso} queda ${p.sinInvertirCLP} sin invertir`);
    assert.ok(!p.descartadas.some(d => d.ticker === 'VOO'));
  }
  // Los índices sin tope son exactamente los del núcleo; cualquier otro fondo conserva su 40% y una empresa su 20%
  assert.deepEqual([...INDICES_NUCLEO].sort(), Object.values(NUCLEO).map(n => n.ticker).sort());
  assert.equal(limiteDe({ diversificado: true, ticker: 'VT' }), 0.4);
  assert.equal(limiteDe({ diversificado: false, ticker: 'AAPL' }), 0.2);
  assert.equal(limiteDe({ diversificado: true, ticker: 'VOO' }), 1);
});

test('el Top no deja un sector sobre 33% (35% − 2) ni una empresa sobre 18%: lo que no entra va al índice', () => {
  // Salud pesa 32% y Chile está lleno: de $3.000.000, el 60% ($1.800.000) iría a tres ideas de Salud, pero solo cabe
  // hasta 33% de los 13 millones
  const p = planAporte(entrada({ montoCLP: 3_000_000, nivel: 'agresivo', chileCLP: 7_600_000, sectores: [{ nombre: 'Salud', peso: 0.32 }] }));
  const top = p.ordenes.filter(o => o.papel === 'top').reduce((s, o) => s + o.montoCLP, 0);
  assert.ok((0.32 * V + top) / (V + 3_000_000) <= 0.33 + 1e-9, `Salud queda en ${(0.32 * V + top) / (V + 3_000_000)}`);
  assert.ok(top > 0 && top < 1_800_000 - 1000);
  assert.ok(monto(p, 'VOO') > 1_200_000 + 1000 && p.sinInvertirCLP < 1000, 'lo que no entró al Top fue al índice');
  // Una idea que ya pesa 17,5% recibe solo lo que cabe hasta 18%
  const q = planAporte(entrada({ montoCLP: 3_000_000, posiciones: [{ ticker: 'AAA', valorCLP: 0.175 * V, pesoEfectivo: 0.175 }], ideas: { ...IDEAS, us: [idea('AAA', 1)] } }));
  assert.ok((0.175 * V + monto(q, 'AAA')) / (V + 3_000_000) <= 0.18 + 1e-9);
});

// --- 7. Protección sin dato del semáforo ----------------------------------------------------------------------------

test('con protección elegida, un semáforo sin dato no es verde: no se compra ahí y se dice', () => {
  const sinChile = planAporte(entrada({ chileCLP: 2_000_000, proteccion: 'todo', semaforos: [luz('eeuu'), luz('tecnologia')] }));
  assert.ok(!sinChile.ordenes.some(o => o.moneda === 'CLP'));
  assert.ok(sinChile.notas.some(n => /no hay dato del semáforo de la bolsa chilena/.test(n)));
  const sinEeuu = planAporte(entrada({ proteccion: 'mitad', semaforos: [luz('chile')] }));
  assert.equal(sinEeuu.ordenes.length, 0);
  assert.ok(sinEeuu.descartadas.some(d => d.ticker === 'VOO' && /no hay dato del semáforo/.test(d.motivo)));
  // Solo avisar: se compra igual, como siempre
  assert.ok(monto(planAporte(entrada({ semaforos: [] })), 'VOO') > 0);
});

test('el aviso de ganancia devuelta no dice "en verde" si hoy no hay semáforo', () => {
  const pos = { ticker: 'AAA', tipo: 'accion', moneda: 'USD', cantidad: 10, peso: 0.1, valorCLP: 1_000_000, diversificado: false, sector: 'Salud', distMaximo52s: -0.2,
    pico: { monto: 1000, pct: 0.5, fecha: '2026-06-01', hoy: 100, hoyPct: 0.05, devuelto: 0.9 } } as unknown as AssetReport;
  const informe = (semaforos: Semaforo[]) => ({ posiciones: [pos], mercado: { semaforos }, resumen: { valorCLP: V }, usdClp: 1000 }) as unknown as AdvisorReport;
  assert.match(avisosCartera(informe([])).find(a => a.tipo === 'ganancia')!.queHacer, /hoy sin dato/);
  assert.match(avisosCartera(informe(LUCES)).find(a => a.tipo === 'ganancia')!.queHacer, /hoy en verde/);
});

// --- 8. El precio que se vigila es el que de verdad cambia la decisión ----------------------------------------------

test('el nivel de venta por tendencia solo se informa si cruzarlo cambia la decisión', () => {
  const accion = (x: Partial<AssetReport>): AssetReport => ({
    ticker: 'UNA.SN', tipo: 'accion', moneda: 'CLP', cantidad: 1000, costoPromedio: 1000, precio: 1000, valorCLP: 1_000_000, peso: 0.1, pesoEfectivo: 0.1,
    momentum: 0, momentumMeses: 12, sma200: 1000, distSma200: 0, stop: 900, stopDist: -0.1, stopActivado: false, diversificado: false,
    distMaximo52s: -0.1, pico: null, riesgo: { veredicto: 'holgado', motivos: [] }, accion: 'MANTENER', motivos: ['m.'], evidencia: [], conDatos: true, ...x,
  }) as AssetReport;
  const niveles = (x: Partial<AssetReport>) => {
    const report = { generado: `${HOY}T12:00:00Z`, usdClp: 1000, resumen: { valorCLP: V }, mercado: { semaforos: LUCES },
      exposicion: { regiones: [{ nombre: 'Chile', peso: 0.1 }], sectores: [], empresas: [], notas: [] }, posiciones: [accion(x)], candidatos: [], avisosDatos: [] } as unknown as AdvisorReport;
    return planRebalanceo(report, { tickers: [], cov: [] } as RiskModel).niveles.filter(n => n.tipo === 'venta_tendencia');
  };
  // Nivel en 970 (3% bajo la media) y stop en 900: el nivel vale, y el texto avisa del caso del stop
  assert.equal(niveles({}).length, 1);
  assert.match(niveles({})[0].texto, /stop de volatilidad/);
  // El stop está sobre el nivel: al cruzarlo quedaría en "quiebre", que no se midió como venta. No se promete esa venta
  assert.equal(niveles({ stop: 980 }).length, 0);
  // Momentum de 6 meses o precios sin dividendos: la tendencia no decide, no hay nivel
  assert.equal(niveles({ momentumMeses: 6 }).length, 0);
  assert.equal(niveles({ tecnicoNoDecide: 'Hoy no se pudieron leer sus dividendos.' }).length, 0);
});

// --- 10. Las compras no gastan más de lo que deja la venta ----------------------------------------------------------

test('lo vendido se reinvierte con un descuento por comisiones, cambio y margen de las órdenes', () => {
  assert.equal(COSTO_REINVERSION, 0.015);
  assert.equal(netoDeVentas(1_000_000), 985_000);
  assert.equal(netoDeVentas(-5), 0);
});

// --- 15. Precios de la última sesión --------------------------------------------------------------------------------

test('un precio sirve si es de la última sesión; uno más viejo no, y uno sin fecha tampoco', () => {
  assert.equal(diaHabilAnterior('2026-11-18'), '2026-11-17');
  assert.equal(diaHabilAnterior('2026-11-16'), '2026-11-13', 'antes del lunes está el viernes');
  const con = (time: string | undefined, hoy = HOY) => planAporte(entrada({ ideas: null, hoy, precios: new Map([['VOO', { price: 600, time }]]), chileCLP: 6_000_000 }));
  // De ayer: vale, sin advertencia
  assert.ok(monto(con('2026-11-17'), 'VOO') > 0);
  assert.ok(!con('2026-11-17').notas.some(n => /última sesión/.test(n)));
  // El viernes visto un lunes: vale, sin advertencia
  assert.ok(monto(con('2026-11-13', '2026-11-16'), 'VOO') > 0);
  assert.ok(!con('2026-11-13', '2026-11-16').notas.some(n => /última sesión/.test(n)));
  // De hace tres días hábiles (feriado de por medio): se usa, pero se dice de qué día es
  const atrasado = con('2026-11-14');
  assert.ok(monto(atrasado, 'VOO') > 0);
  assert.equal(atrasado.ordenes[0].fechaPrecio, '2026-11-14');
  assert.ok(atrasado.notas.some(n => /VOO \(14-11\)/.test(n) && /Revisa el precio de hoy/.test(n)));
  // De hace una semana o sin fecha: no hay precio al día, y el veredicto no es "no hagas nada"
  for (const p of [con('2026-11-11'), con(undefined)]) {
    assert.equal(p.ordenes.length, 0);
    assert.ok(p.descartadas.some(d => d.ticker === 'VOO' && d.motivo === 'Sin precio al día.'));
    assert.equal(veredictoDe(p, sinPlan).titulo, 'Hoy no pude calcular tu compra');
  }
});

// --- 14. La cartola se exporta con cada compra como un lote ---------------------------------------------------------

test('cartola a portafolio: cada compra es un lote; lo vendido sale de las más antiguas; lo que no cuadra queda en uno', () => {
  const pos = (x: Partial<PosicionCuenta>): PosicionCuenta => ({
    cuenta: 'XTB', ticker: 'VOO', moneda: 'USD', cantidad: 10, costo: 2800, fechaCompra: '2025-01-02', fechaCompraAproximada: false,
    compras: [{ fecha: '2025-01-02', cantidad: 1, precio: 100 }, { fecha: '2026-01-02', cantidad: 9, precio: 300 }], dividendos: 0, monedaDividendos: 'USD', ...x,
  });
  const lotes = (p: PosicionCuenta) => lotesParaPortafolio({ posiciones: [p] } as LibroInversiones).map(l => [l.purchase_date, l.cantidad, l.precio_compra]);
  assert.deepEqual(lotes(pos({})), [['2025-01-02', 1, 100], ['2026-01-02', 9, 300]]);
  // Se vendieron 3: sale la compra más antigua completa y 2 de la siguiente
  assert.deepEqual(lotes(pos({ cantidad: 7, costo: 1960 })), [['2026-01-02', 7, 300]]);
  // Había 5 antes de la primera cartola (costo 500 según el libro): quedan como un lote de fecha aproximada
  const previo = pos({ cantidad: 15, costo: 3300, fechaCompra: '2024-06-30', fechaCompraAproximada: true });
  assert.deepEqual(lotes(previo), [['2024-06-30', 5, 100], ['2025-01-02', 1, 100], ['2026-01-02', 9, 300]]);
  // Un split (20 acciones con compras por 10) o un costo no informado no se pueden repartir: un solo lote, como antes
  assert.deepEqual(lotes(pos({ cantidad: 20 })), [['2025-01-02', 20, 140]]);
  assert.equal(lotes(pos({ costo: undefined, precio: 500 })).length, 1);
});

// --- SEC: una consulta que falla no se da por revisada --------------------------------------------------------------

test('hechos relevantes: la empresa que no se pudo consultar conserva lo que se sabía de ella', () => {
  const grave: EventoSec = { ticker: 'AAA', fecha: '2026-11-10', items: ['4.02'], titulo: 'Sus estados financieros anteriores ya no son confiables', gravedad: 'grave', url: 'u' };
  const info: EventoSec = { ...grave, ticker: 'BBB', items: ['2.02'], titulo: 'Publicó resultados', gravedad: 'info' };
  const r = conEventosAnteriores({ porTicker: { BBB: [info] }, sinRevisar: ['AAA', 'CCC'] }, { AAA: [grave], BBB: [grave] });
  assert.deepEqual(r, { AAA: [grave], BBB: [info] }, 'AAA mantiene su freno; BBB, que sí se consultó, queda con lo de hoy');
  assert.deepEqual(conEventosAnteriores({ porTicker: {}, sinRevisar: ['AAA'] }, null), {});
});

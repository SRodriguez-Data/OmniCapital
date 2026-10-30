// Pruebas de lo que mueve plata en la cartera real: el plan de rebalanceo y el registro de órdenes ejecutadas.
//   npx tsx --test tests/*.test.ts      (también corren en agente_cartera.yml antes de cada revisión)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdvisorReport, AssetReport, RiskModel } from '../src/lib/advisor';
import { aplicarCambios, cambiosPorEjecucion, leerEjecucion, type Cambios, type Lote } from '../src/lib/ejecucion';
import { planRebalanceo, precioLimite } from '../src/lib/rebalanceo';

const lote = (id: string, cantidad: number, fecha: string | null, ticker = 'CHILE.SN'): Lote =>
  ({ id, ticker, cantidad, precio_compra: 150, moneda: ticker.endsWith('.SN') ? 'CLP' : 'USD', purchase_date: fecha });
const cambios = (r: Cambios | { error: string }): Cambios => {
  if ('error' in r) assert.fail(r.error);
  return r;
};

test('una venta descuenta de los lotes más antiguos primero', () => {
  const c = cambios(cambiosPorEjecucion(
    [lote('b', 100, '2026-01-10'), lote('a', 50, '2025-05-01'), lote('x', 9, null, 'VOO')],
    { ticker: 'CHILE.SN', lado: 'VENDER', cantidad: 80 },
  ));
  assert.deepEqual(c, { actualizar: [{ id: 'b', cantidad: 70 }], borrar: ['a'], insertar: [] });
});

test('un lote sin fecha cuenta como el más antiguo', () => {
  const c = cambios(cambiosPorEjecucion([lote('nuevo', 10, '2026-01-01'), lote('viejo', 10, null)], { ticker: 'CHILE.SN', lado: 'VENDER', cantidad: 5 }));
  assert.deepEqual(c.actualizar, [{ id: 'viejo', cantidad: 5 }]);
});

test('vender lo que queda (con redondeo de fracciones) borra la posición', () => {
  const c = cambios(cambiosPorEjecucion([lote('v', 0.36885431, '2025-01-21', 'VOO')], { ticker: 'VOO', lado: 'VENDER', cantidad: 0.3688 }));
  assert.deepEqual(c, { actualizar: [], borrar: ['v'], insertar: [] });
});

test('no deja vender más de lo que hay ni lo que no hay', () => {
  assert.ok('error' in cambiosPorEjecucion([lote('a', 10, '2025-01-01')], { ticker: 'CHILE.SN', lado: 'VENDER', cantidad: 11 }));
  assert.ok('error' in cambiosPorEjecucion([lote('a', 10, '2025-01-01')], { ticker: 'IAM.SN', lado: 'VENDER', cantidad: 1 }));
});

test('una compra es un lote nuevo con su precio y fecha', () => {
  const c = cambios(cambiosPorEjecucion([], { ticker: 'HDV', lado: 'COMPRAR', cantidad: 7.33, precio: 31.02, moneda: 'USD', fecha: '2026-10-30' }));
  assert.deepEqual(c.insertar, [{ ticker: 'HDV', cantidad: 7.33, precio_compra: 31.02, moneda: 'USD', purchase_date: '2026-10-30' }]);
  assert.ok('error' in cambiosPorEjecucion([lote('a', 1, null, 'HDV')].map(l => ({ ...l, moneda: 'CLP' as const })),
    { ticker: 'HDV', lado: 'COMPRAR', cantidad: 1, precio: 30, moneda: 'USD', fecha: '2026-10-30' }));
});

test('valida lo que llega del navegador', () => {
  assert.ok('error' in leerEjecucion({ ticker: 'CHILE.SN', lado: 'COMPRAR', cantidad: 1.5, precio: 180, moneda: 'CLP', fecha: '2026-10-01' }));
  assert.ok('error' in leerEjecucion({ ticker: 'CHILE.SN', lado: 'COMPRAR', cantidad: 10, precio: 180, moneda: 'USD', fecha: '2026-10-01' }));
  assert.ok('error' in leerEjecucion({ ticker: 'VOO', lado: 'COMPRAR', cantidad: 1, precio: 600, moneda: 'USD', fecha: '2999-01-01' }));
  assert.ok('error' in leerEjecucion({ ticker: 'VOO', lado: 'REGALAR', cantidad: 1 }));
  assert.ok('error' in leerEjecucion({ ticker: 'VOO', lado: 'VENDER', cantidad: -1 }));
  assert.deepEqual(leerEjecucion({ ticker: ' voo ', lado: 'VENDER', cantidad: '0.5' }), { ticker: 'VOO', lado: 'VENDER', cantidad: 0.5 });
});

test('aplicar los cambios a una cartera local', () => {
  const r = aplicarCambios([lote('a', 50, '2025-01-01'), lote('b', 100, '2026-01-01')],
    { actualizar: [{ id: 'b', cantidad: 70 }], borrar: ['a'], insertar: [{ ticker: 'HDV', cantidad: 2, precio_compra: 31, moneda: 'USD', purchase_date: '2026-10-30' }] }, () => 'n1');
  assert.deepEqual(r.map(l => [l.id, l.cantidad]), [['b', 70], ['n1', 2]]);
});

test('el precio límite queda 0,5% peor y en un tick válido', () => {
  assert.equal(precioLimite(184.52, 'CLP', 'VENDER'), 183.59);
  assert.equal(precioLimite(23437, 'CLP', 'VENDER'), 23319);
  assert.equal(precioLimite(23437, 'CLP', 'COMPRAR'), 23555);
  assert.equal(precioLimite(697.25, 'USD', 'COMPRAR'), 700.74);
});

// --- Plan completo sobre una cartera inventada --------------------------------------------------------------------

const V = 10_000_000;
function activo(ticker: string, peso: number, x: Partial<AssetReport>): AssetReport {
  const moneda = ticker.endsWith('.SN') ? 'CLP' : 'USD';
  const precio = moneda === 'CLP' ? 1000 : 100;
  const valorCLP = peso * V;
  return {
    ticker, tipo: 'accion', moneda, cantidad: valorCLP / (moneda === 'USD' ? precio * 1000 : precio), costoPromedio: precio, precio, valorCLP,
    peso, pesoEfectivo: peso, pnl: 0, ret1y: 0, ret3y: 0, momentum: 0.2, momentumMeses: 12, vol: 0.2, maxDD: 0.1, beta: 1,
    benchmark: 'IPSA', rsi: 50, sma200: precio * 0.9, distSma200: 0.1, stop: null, stopDist: null, stopActivado: false,
    diversificado: false, aporteRiesgo: null, fundamentales: null,
    tecnico: { veredicto: 'alcista', motivos: [] }, fundamental: { veredicto: 'neutral', motivos: [] },
    riesgo: { veredicto: 'holgado', motivos: [] }, accion: 'MANTENER', conviccion: 'media', puntaje: 0,
    motivos: ['Motivo de prueba.'], evidencia: [], conDatos: true, ...x,
  } as AssetReport;
}

function cartera(): { report: AdvisorReport; modelo: RiskModel } {
  const posiciones = [
    activo('BANCO.SN', 0.4, { sector: 'Financiero', riesgo: { veredicto: 'excedido', motivos: [] }, accion: 'REDUCIR' }),
    activo('MALA.SN', 0.05, { sector: 'Industrial', accion: 'REDUCIR', motivos: ['Con evidencia en contra: tendencia y momentum en contra (sólida).'] }),
    activo('IPSA.SN', 0.25, { tipo: 'etf', diversificado: true }),
    activo('VOO', 0.3, { tipo: 'etf', diversificado: true, accion: 'AUMENTAR', vol: 0.15 }),
  ];
  const report = {
    generado: '2026-10-30T12:00:00Z', usdClp: 1000, tasaLibreRiesgo: 0.05,
    resumen: { valorCLP: V } as AdvisorReport['resumen'],
    mercado: null,
    exposicion: {
      regiones: [{ nombre: 'Chile', peso: 0.7 }, { nombre: 'EE.UU.', peso: 0.3 }],
      sectores: [{ nombre: 'Financiero', peso: 0.47, via: ['BANCO.SN', 'IPSA.SN'] }, { nombre: 'Industrial', peso: 0.05, via: ['MALA.SN'] }],
      empresas: [], notas: [],
    },
    estrategia: [], hallazgos: [], posiciones, candidatos: [], avisosDatos: [], perfilInversionista: null,
  } as AdvisorReport;
  const vols = posiciones.map(a => a.vol ?? 0.2);
  return { report, modelo: { tickers: posiciones.map(a => a.ticker), cov: vols.map((vi, i) => vols.map((vj, j) => (i === j ? vi * vj : 0.3 * vi * vj))) } };
}

test('rebalanceo: vende la señal con evidencia completa y la concentración hasta 2 puntos dentro del límite', () => {
  const { report, modelo } = cartera();
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6 });
  const venta = new Map(plan.ventas.map(o => [o.ticker, o]));
  assert.equal(venta.get('MALA.SN')?.todo, true);
  // BANCO pesa 40% (máximo 20%): se vende hasta 18%
  assert.ok(Math.abs(venta.get('BANCO.SN')!.pesoDespues - 0.18) < 0.001, `BANCO queda en ${venta.get('BANCO.SN')!.pesoDespues}`);
  assert.ok(!venta.has('IPSA.SN') && !venta.has('VOO'), 'no vende fondos ni lo que no tiene razón');
  assert.ok(plan.despues.chile <= 0.6 + 1e-9, `Chile queda en ${plan.despues.chile}`);
});

test('rebalanceo: lo vendido solo compra AUMENTAR, sin pasar el máximo de un fondo, y lo que no cabe queda sin invertir', () => {
  const { report, modelo } = cartera();
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6 });
  assert.deepEqual(plan.compras.map(o => o.ticker), ['VOO']);
  assert.ok(plan.compras[0].pesoDespues <= 0.4 + 1e-6, `VOO queda en ${plan.compras[0].pesoDespues}`);
  assert.ok(Math.abs(plan.ventasCLP - plan.comprasCLP - plan.sinInvertirCLP) < 1, 'lo vendido se compra o queda sin invertir');
  assert.ok(plan.sinInvertirCLP > 0 && plan.motivoSinInvertir, 'avisa lo que queda sin invertir');
  assert.ok(plan.compras.every(o => o.limite >= o.precio) && plan.ventas.every(o => o.limite <= o.precio));
});

test('rebalanceo: con una meta de Chile más baja recorta las acciones chilenas, no el fondo del IPSA', () => {
  const { report, modelo } = cartera();
  const plan = planRebalanceo(report, modelo, { metaChile: 0.4 });
  assert.ok(plan.despues.chile <= 0.4 + 1e-9, `Chile queda en ${plan.despues.chile}`);
  assert.ok(!plan.ventas.some(o => o.ticker === 'IPSA.SN'));
});

test('rebalanceo: una cartera dentro de sus límites no se toca', () => {
  const { report, modelo } = cartera();
  report.posiciones = [activo('VOO', 0.35, { tipo: 'etf', diversificado: true }), activo('VT', 0.35, { tipo: 'etf', diversificado: true }), activo('CHILE.SN', 0.3, { sector: 'Financiero' })];
  report.exposicion = { regiones: [{ nombre: 'Chile', peso: 0.3 }], sectores: [{ nombre: 'Financiero', peso: 0.3, via: [] }], empresas: [], notas: [] };
  modelo.tickers = report.posiciones.map(a => a.ticker);
  modelo.cov = modelo.cov.slice(0, 3).map(f => f.slice(0, 3));
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6 });
  assert.equal(plan.ventas.length + plan.compras.length, 0);
});

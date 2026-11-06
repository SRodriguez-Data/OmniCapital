// Pruebas del aporte del mes (núcleo + Top medido) y de cómo el rebalanceo reinvierte con él.
//   npx tsx --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdvisorReport, AssetReport, RiskModel } from '../src/lib/advisor';
import { planAporte, type EntradaAporte } from '../src/lib/aporte';
import type { IdeaTop, IdeasDelBot } from '../src/lib/ideas';
import type { Semaforo } from '../src/lib/proteccion';
import { veredictoDe } from '../src/lib/asesor';
import { planRebalanceo, plataNuevaDe } from '../src/lib/rebalanceo';

const HOY = '2026-11-02';
const idea = (ticker: string, puesto: number, x: Partial<IdeaTop> = {}): IdeaTop => {
  const chile = ticker.endsWith('.SN');
  return {
    ticker, mercado: chile ? 'Chile' : 'EE.UU.', moneda: chile ? 'CLP' : 'USD', puesto, peso: chile ? 0.2 : 0.05,
    sector: 'Salud', precio: chile ? 2000 : 100, fechaPrecio: HOY, per: 15, dividendo: '1%', proximosResultados: null,
    calidad: 0.1, percentilSector: 1, momentum: chile ? 0.3 : null, ...x,
  };
};
const IDEAS: IdeasDelBot = {
  fecha: HOY,
  us: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'].map((t, i) => idea(t, i + 1)),
  cl: [idea('UNO.SN', 1, { sector: 'Materiales' }), idea('CARA.SN', 2, { precio: 60000, sector: 'Materiales' }), idea('DOS.SN', 3, { sector: 'Materiales' })],
};
const luz = (clave: Semaforo['clave'], estado: Semaforo['estado']): Semaforo => ({
  clave, nombre: { eeuu: 'Bolsa de EE.UU. (S&P 500)', tecnologia: 'Tecnología (Nasdaq-100)', chile: 'Bolsa chilena (IPSA)' }[clave],
  ticker: 'X', estado, fecha: HOY, precio: 100, media: 100, distancia: 0, cambiaEn: 100, distanciaCambio: 0, desde: null, caidaDesdeMaximo: 0.1,
});

function entrada(x: Partial<EntradaAporte> = {}): EntradaAporte {
  const precios = new Map<string, { price: number; time?: string }>([['VOO', { price: 600, time: HOY }], ['CFMITNIPSA.SN', { price: 5000, time: HOY }]]);
  return {
    montoCLP: 150000, usdClp: 1000, valorCLP: 4_000_000, chileCLP: 2_700_000, posiciones: [], sectores: [],
    ideas: IDEAS, precios, nivel: 'agresivo', metaChile: 0.6, semaforos: [luz('eeuu', 'verde'), luz('chile', 'verde')],
    proteccion: 'avisar', hoy: HOY, ...x,
  };
}
const monto = (p: ReturnType<typeof planAporte>, t: string) => p.ordenes.find(o => o.ticker === t)?.montoCLP ?? 0;

test('agresivo con Chile sobre su máximo: todo a EE.UU., 60% al Top en dos ideas y el resto al S&P 500', () => {
  const p = planAporte(entrada());
  assert.equal(p.chileCLP, 0);
  assert.deepEqual(p.ordenes.filter(o => o.papel === 'top').map(o => o.ticker), ['AAA', 'BBB']);
  for (const t of ['AAA', 'BBB']) assert.ok(Math.abs(monto(p, t) - 45000) < 1, `${t}: ${monto(p, t)}`);
  assert.ok(Math.abs(monto(p, 'VOO') - 60000) < 1);
  assert.ok(p.sinInvertirCLP < 1, 'se invierte todo (fracciones en EE.UU.)');
  assert.ok(p.ordenes.every(o => o.limite > o.precio));
  assert.ok(p.notas.some(n => /va completo a EE\.UU\./.test(n)));
});

test('el Top rota: primero las ideas que no tienes, a igualdad la primera de la lista', () => {
  const p = planAporte(entrada({ posiciones: [{ ticker: 'AAA', valorCLP: 50000 }, { ticker: 'BBB', valorCLP: 10000 }] }));
  assert.deepEqual(p.ordenes.filter(o => o.papel === 'top').map(o => o.ticker).sort(), ['CCC', 'DDD']);
});

test('no compra lo que tiene una razón con base: venta con evidencia, sector lleno, bloqueado', () => {
  const ideas: IdeasDelBot = { ...IDEAS, us: [idea('AAA', 1), idea('BBB', 2, { sector: 'Financiero' }), idea('CCC', 3), idea('DDD', 4), idea('EEE', 5)] };
  const p = planAporte(entrada({
    ideas,
    posiciones: [{ ticker: 'AAA', valorCLP: 20000, accion: 'REDUCIR' }],
    sectores: [{ nombre: 'Financiero', peso: 0.39 }],
    bloqueados: new Map([['CCC', 'Se vende en el rebalanceo de hoy.']]),
  }));
  assert.deepEqual(p.ordenes.filter(o => o.papel === 'top').map(o => o.ticker).sort(), ['DDD', 'EEE']);
  assert.deepEqual(p.descartadas.map(d => d.ticker).sort(), ['AAA', 'BBB', 'CCC']);
});

test('con espacio en Chile: su parte va en acciones enteras y la acción más cara que su parte cede el lugar', () => {
  const p = planAporte(entrada({ montoCLP: 300000, chileCLP: 1_000_000 }));
  assert.ok(Math.abs(p.chileCLP - 180000) < 1, `Chile recibe ${p.chileCLP}`);
  const cl = p.ordenes.filter(o => o.moneda === 'CLP');
  assert.ok(cl.every(o => Number.isInteger(o.cantidad)));
  assert.ok(!cl.some(o => o.ticker === 'CARA.SN') && p.descartadas.some(d => d.ticker === 'CARA.SN'));
  assert.deepEqual(cl.filter(o => o.papel === 'top').map(o => o.ticker).sort(), ['DOS.SN', 'UNO.SN']);
  assert.ok(p.ordenes.some(o => o.ticker === 'CFMITNIPSA.SN'));
  assert.ok(p.sinInvertirCLP < 100, `lo que sobra de redondear Chile va al S&P 500 en fracciones (quedan ${p.sinInvertirCLP})`);
});

test('mercado en rojo, solo avisar: se compra igual y se dice; con protección no se compra ahí', () => {
  const rojo = entrada({ semaforos: [luz('eeuu', 'rojo'), luz('chile', 'verde')] });
  const p = planAporte(rojo);
  assert.ok(p.ordenes.length === 3 && p.ordenes.every(o => o.enRojo));
  assert.ok(p.notas.some(n => /Se compra igual/.test(n)));
  const q = planAporte({ ...rojo, proteccion: 'todo' });
  assert.equal(q.ordenes.length, 0);
  assert.ok(q.sinInvertirCLP === 150000 && q.descartadas.some(d => d.ticker === 'VOO'));
});

test('montos chicos van al índice; un perfil conservador, solo al índice', () => {
  const chico = planAporte(entrada({ montoCLP: 40000 }));
  assert.deepEqual(chico.ordenes.map(o => o.ticker), ['VOO']);
  assert.ok(chico.notas.some(n => /no alcanza una orden/.test(n)));
  const cons = planAporte(entrada({ nivel: 'conservador' }));
  assert.deepEqual(cons.ordenes.map(o => o.ticker), ['VOO']);
  assert.ok(Math.abs(cons.invertidoCLP - 150000) < 1);
});

// --- El rebalanceo reinvierte como el aporte ------------------------------------------------------------------------

const V = 10_000_000;
function activo(ticker: string, peso: number, x: Partial<AssetReport> = {}): AssetReport {
  const moneda = ticker.endsWith('.SN') ? 'CLP' : 'USD';
  const precio = moneda === 'CLP' ? 1000 : 100;
  const valorCLP = peso * V;
  return {
    ticker, tipo: 'accion', moneda, cantidad: valorCLP / (moneda === 'USD' ? precio * 1000 : precio), costoPromedio: precio, precio, valorCLP,
    peso, pesoEfectivo: peso, pnl: 0, ret1y: 0, ret3y: 0, momentum: 0.2, momentumMeses: 12, vol: 0.2, maxDD: 0.1, beta: 1,
    benchmark: 'IPSA', rsi: 50, sma200: precio * 0.9, distSma200: 0.1, stop: null, stopDist: null, stopActivado: false,
    distMaximo52s: -0.1, pico: null, diversificado: false, aporteRiesgo: null, fundamentales: null,
    tecnico: { veredicto: 'alcista', motivos: [] }, fundamental: { veredicto: 'neutral', motivos: [] },
    riesgo: { veredicto: 'holgado', motivos: [] }, accion: 'MANTENER', conviccion: 'media', puntaje: 0,
    motivos: ['Motivo de prueba.'], evidencia: [], conDatos: true, ...x,
  } as AssetReport;
}

test('rebalanceo agresivo: lo vendido va a núcleo + Top, nunca de vuelta a Chile mientras se reduce', () => {
  const posiciones = [
    activo('BANCO.SN', 0.4, { sector: 'Financiero', riesgo: { veredicto: 'excedido', motivos: [] }, accion: 'REDUCIR' }),
    activo('IPSA.SN', 0.3, { tipo: 'etf', diversificado: true }),
    activo('VOO', 0.3, { tipo: 'etf', diversificado: true, accion: 'AUMENTAR', vol: 0.15 }),
  ];
  const report = {
    generado: `${HOY}T12:00:00Z`, usdClp: 1000, tasaLibreRiesgo: 0.05, resumen: { valorCLP: V } as AdvisorReport['resumen'],
    mercado: { semaforos: [luz('chile', 'rojo'), luz('eeuu', 'verde')] } as AdvisorReport['mercado'],
    exposicion: { regiones: [{ nombre: 'Chile', peso: 0.7 }], sectores: [{ nombre: 'Financiero', peso: 0.45, via: [] }], empresas: [], notas: [] },
    estrategia: [], hallazgos: [], posiciones, candidatos: [], avisosDatos: [], perfilInversionista: null,
  } as AdvisorReport;
  const modelo: RiskModel = { tickers: posiciones.map(a => a.ticker), cov: posiciones.map((_, i) => posiciones.map((__, j) => (i === j ? 0.04 : 0.01))) };
  const precios = new Map([['VOO', { price: 600, time: HOY }], ['CFMITNIPSA.SN', { price: 5000, time: HOY }]]);
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6, nivel: 'agresivo', ideas: IDEAS, precios });
  assert.equal(plan.reinversion, 'nucleo_top');
  assert.ok(plan.ventas.some(o => o.ticker === 'BANCO.SN'));
  assert.ok(!plan.compras.some(o => o.moneda === 'CLP'), 'no recompra en Chile');
  assert.ok(plan.compras.some(o => o.ticker === 'VOO') && plan.compras.some(o => o.ticker === 'AAA'));
  const top = plan.compras.filter(o => o.ticker !== 'VOO').reduce((s, o) => s + o.montoCLP, 0);
  assert.ok(Math.abs(top / plan.comprasCLP - 0.6) < 0.02, `Top recibe ${top / plan.comprasCLP}`);
  assert.ok(plan.evidenciaCompras?.top['EE.UU.']);
});

// --- Una sola decisión ----------------------------------------------------------------------------------------------

function carteraSobreElLimite(accion: AssetReport['accion'] = 'MANTENER') {
  const posiciones = [
    activo('BANCO.SN', 0.3, { sector: 'Financiero' }),
    activo('MALA.SN', 0.05, { sector: 'Industrial', accion, motivos: ['Con evidencia en contra: tendencia y momentum en contra (sólida).'] }),
    activo('IPSA.SN', 0.33, { tipo: 'etf', diversificado: true }),
    activo('VOO', 0.32, { tipo: 'etf', diversificado: true }),
  ];
  const report = {
    generado: `${HOY}T12:00:00Z`, usdClp: 1000, tasaLibreRiesgo: 0.05, resumen: { valorCLP: V } as AdvisorReport['resumen'],
    mercado: { semaforos: [luz('chile', 'verde'), luz('eeuu', 'verde')] } as AdvisorReport['mercado'],
    exposicion: { regiones: [{ nombre: 'Chile', peso: 0.68 }], sectores: [{ nombre: 'Financiero', peso: 0.4, via: [] }], empresas: [], notas: [] },
    estrategia: [], hallazgos: [], posiciones, candidatos: [], avisosDatos: [], perfilInversionista: null,
  } as AdvisorReport;
  const modelo: RiskModel = { tickers: posiciones.map(a => a.ticker), cov: posiciones.map((_, i) => posiciones.map((__, j) => (i === j ? 0.04 : 0.01))) };
  return { report, modelo };
}

test('la plata nueva cuenta: los límites que corrige sola no se venden; sin ella, sí', () => {
  const { report, modelo } = carteraSobreElLimite();
  const sinAporte = planRebalanceo(report, modelo, { metaChile: 0.6 });
  assert.ok(sinAporte.ventas.some(o => o.ticker === 'BANCO.SN'));
  assert.equal(sinAporte.sinVender, null);
  const poca = planRebalanceo(report, modelo, { metaChile: 0.6, plataNueva: plataNuevaDe(50000) });
  assert.ok(poca.ventas.length > 0, 'seis meses de un aporte chico no corrigen el límite');
  const conAporte = planRebalanceo(report, modelo, { metaChile: 0.6, plataNueva: plataNuevaDe(500000) });
  assert.equal(conAporte.ventas.length, 0);
  assert.ok(/No vendas para bajar Financiero ni Chile/.test(conAporte.sinVender ?? ''), conAporte.sinVender ?? '');
});

test('la señal de venta con evidencia se vende igual, aunque haya plata nueva', () => {
  const { report, modelo } = carteraSobreElLimite('REDUCIR');
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6, plataNueva: plataNuevaDe(500000), reinvertir: false });
  assert.deepEqual(plan.ventas.map(o => o.ticker), ['MALA.SN']);
  assert.equal(plan.compras.length, 0, 'lo vendido lo invierte quien llama, junto con el aporte');
});

test('el veredicto es una sola decisión: primero vender, después comprar, con título y porqué', () => {
  const { report, modelo } = carteraSobreElLimite('REDUCIR');
  const plan = planRebalanceo(report, modelo, { metaChile: 0.6, plataNueva: plataNuevaDe(500000), reinvertir: false });
  const aporte = planAporte(entrada({ montoCLP: 150000 + plan.ventasCLP }));
  const v = veredictoDe(aporte, plan);
  assert.equal(v.accion, 'VENDER Y COMPRAR');
  assert.equal(v.pasos[0].lado, 'VENDER');
  assert.ok(v.pasos.slice(1).every(p => p.lado === 'COMPRAR') && v.pasos.length === 1 + aporte.ordenes.length);
  assert.ok(v.titulo.startsWith('Vende MALA y compra VOO'), v.titulo);
  assert.ok(veredictoDe(null, { ...plan, ventas: plan.ventas.map(o => ({ ...o, todo: false })) }).titulo.endsWith('(parte)'));
  assert.ok(/MALA se vende: tendencia y momentum en contra/.test(v.detalle), v.detalle);
  assert.ok(/No vendas para bajar/.test(v.detalle), v.detalle);

  const limpio = { ...plan, ventas: [], ventasCLP: 0, sinVender: null };
  const compra = veredictoDe(planAporte(entrada()), limpio);
  assert.equal(compra.accion, 'COMPRAR');
  assert.equal(compra.pasos.length, 3, 'con $150.000 son el índice y dos ideas');
  assert.equal(veredictoDe(null, limpio).accion, 'MANTENER');
});

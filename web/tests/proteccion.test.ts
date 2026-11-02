// Pruebas de la protección ante caídas: el semáforo de mercado, la ganancia que se va y lo que el rebalanceo hace con
// un mercado en rojo.   npx tsx --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdvisorReport, AssetReport, RiskModel } from '../src/lib/advisor';
import { avisosCartera, mercadosDe } from '../src/lib/avisos';
import { picoGanancia, semaforo, type Semaforo } from '../src/lib/proteccion';
import { planRebalanceo } from '../src/lib/rebalanceo';

const fechas = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));

test('semáforo: verde en tendencia, rojo al caer más de 2% bajo la media y la banda evita cambiar por ruido', () => {
  const sube = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
  const v = semaforo('eeuu', 'S&P', '^GSPC', fechas(300), sube)!;
  assert.equal(v.estado, 'verde');
  assert.ok(v.cambiaEn < v.precio && Math.abs(v.cambiaEn / v.media - 0.98) < 1e-9);

  // Cae 20%: queda bajo 0,98 × media → rojo, y se sabe desde cuándo
  const cae = [...sube, ...Array.from({ length: 40 }, (_, i) => 130 - i * 0.8)];
  const r = semaforo('eeuu', 'S&P', '^GSPC', fechas(cae.length), cae)!;
  assert.equal(r.estado, 'rojo');
  assert.ok(r.desde && r.desde > fechas(300)[299]);
  assert.ok(r.cambiaEn > r.media, 'vuelve a verde recién sobre 1,02 × media');

  // Vuelve justo sobre la media (dentro de la banda): sigue en rojo
  const rebota = [...cae, ...Array.from({ length: 5 }, () => r.media * 1.005)];
  assert.equal(semaforo('eeuu', 'S&P', '^GSPC', fechas(rebota.length), rebota)!.estado, 'rojo');
  assert.equal(semaforo('eeuu', 'S&P', '^GSPC', fechas(100), sube.slice(0, 100)), null, 'sin 200 días no hay semáforo');
});

test('ganancia que se va: el máximo cuenta cada compra desde su fecha', () => {
  const f = ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01'];
  const c = [100, 150, 120, 90];
  // GOOGL: compró 1 a 100, llegó a ganar 50 y hoy pierde 10
  const p = picoGanancia([{ cantidad: 1, precio: 100, fecha: '2025-01-01' }], f, c, 90)!;
  assert.equal(p.monto, 50);
  assert.equal(p.fecha, '2025-02-01');
  assert.equal(p.hoy, -10);
  assert.ok(Math.abs(p.devuelto - 1.2) < 1e-9);
  // La segunda compra (a 120, en marzo) no cuenta en la ganancia de febrero
  const q = picoGanancia([{ cantidad: 1, precio: 100, fecha: '2025-01-01' }, { cantidad: 1, precio: 120, fecha: '2025-03-01' }], f, c, 90)!;
  assert.equal(q.monto, 50);
  assert.equal(q.hoy, -40);
  assert.equal(picoGanancia([{ cantidad: 1, precio: 100, fecha: null }], f, c, 90), null, 'sin fecha no se sabe');
});

// --- Cartera inventada ----------------------------------------------------------------------------------------------

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
const luz = (clave: Semaforo['clave'], estado: Semaforo['estado']): Semaforo => ({
  clave, nombre: { eeuu: 'Bolsa de EE.UU. (S&P 500)', tecnologia: 'Tecnología (Nasdaq-100)', chile: 'Bolsa chilena (IPSA)' }[clave],
  ticker: 'X', estado, fecha: '2026-10-30', precio: 100, media: estado === 'rojo' ? 105 : 95, distancia: estado === 'rojo' ? -0.05 : 0.05,
  cambiaEn: estado === 'rojo' ? 107.1 : 93.1, distanciaCambio: estado === 'rojo' ? 0.071 : -0.069, desde: '2026-10-12', caidaDesdeMaximo: 0.1,
});

function cartera(semaforos: Semaforo[]): { report: AdvisorReport; modelo: RiskModel } {
  const posiciones = [
    activo('CHILE.SN', 0.3, { sector: 'Financiero' }),
    activo('IPSA.SN', 0.3, { tipo: 'etf', diversificado: true }),
    activo('VOO', 0.2, { tipo: 'etf', diversificado: true, accion: 'AUMENTAR', vol: 0.15 }),
    activo('BCI.SN', 0.2, { sector: 'Financiero', accion: 'AUMENTAR' }),
  ];
  const report = {
    generado: '2026-10-30T12:00:00Z', usdClp: 1000, tasaLibreRiesgo: 0.05,
    resumen: { valorCLP: V } as AdvisorReport['resumen'],
    mercado: { semaforos } as AdvisorReport['mercado'],
    exposicion: {
      regiones: [{ nombre: 'Chile', peso: 0.8 }, { nombre: 'EE.UU.', peso: 0.2 }],
      sectores: [{ nombre: 'Financiero', peso: 0.3, via: [] }], empresas: [], notas: [],
    },
    estrategia: [], hallazgos: [], posiciones, candidatos: [], avisosDatos: [], perfilInversionista: null,
  } as AdvisorReport;
  const vols = posiciones.map(a => a.vol ?? 0.2);
  return { report, modelo: { tickers: posiciones.map(a => a.ticker), cov: vols.map((vi, i) => vols.map((vj, j) => (i === j ? vi * vj : 0.3 * vi * vj))) } };
}

test('las tecnológicas siguen también al Nasdaq-100; Chile, al IPSA', () => {
  assert.deepEqual(mercadosDe(activo('GOOGL', 0.1, { sector: 'Comunicaciones' })), ['eeuu', 'tecnologia']);
  assert.deepEqual(mercadosDe(activo('QQQ', 0.1, { diversificado: true, sector: 'Large Growth' })), ['eeuu', 'tecnologia']);
  assert.deepEqual(mercadosDe(activo('JNJ', 0.1, { sector: 'Salud' })), ['eeuu']);
  assert.deepEqual(mercadosDe(activo('CHILE.SN', 0.1)), ['chile']);
});

test('mercado en rojo, solo avisar: no vende por eso, no compra ahí y avisa con lo medido', () => {
  const { report, modelo } = cartera([luz('chile', 'rojo'), luz('eeuu', 'verde')]);
  const plan = planRebalanceo(report, modelo, { metaChile: 0.9, aporteCLP: 1_000_000 });
  assert.equal(plan.ventas.length, 0);
  assert.ok(!plan.compras.some(o => o.moneda === 'CLP'), 'no compra BCI aunque tenga señal AUMENTAR');
  assert.ok(plan.excluidosCompra.some(e => e.ticker === 'BCI.SN' && /zona roja/.test(e.motivo)));
  assert.equal(plan.refugioCLP, 0);
  const rojo = plan.avisos.find(a => a.id.startsWith('rojo:chile'));
  assert.ok(rojo && rojo.nivel === 'alerta' && rojo.evidencia, 'avisa la zona roja con la evidencia medida');
});

test('mercado en rojo con protección: vende la mitad (o todo) de ese mercado y lo deja en refugio', () => {
  const { report, modelo } = cartera([luz('chile', 'rojo'), luz('eeuu', 'verde')]);
  const mitad = planRebalanceo(report, modelo, { metaChile: 0.9, proteccion: 'mitad' });
  assert.deepEqual(mitad.ventas.map(o => o.ticker).sort(), ['BCI.SN', 'CHILE.SN', 'IPSA.SN']);
  assert.ok(Math.abs(mitad.ventasCLP - 0.4 * V) < 0.01 * V, `vende la mitad de 80%: ${mitad.ventasCLP}`);
  assert.ok(Math.abs(mitad.refugioCLP - mitad.ventasCLP) < 1, 'todo lo vendido por protección va a refugio');
  assert.equal(mitad.compras.length, 0, 'no se reinvierte en bolsa');
  const todo = planRebalanceo(report, modelo, { metaChile: 0.9, proteccion: 'todo' });
  assert.ok(todo.ventas.every(o => o.todo) && todo.ventas.length === 3);
  assert.ok(!todo.ventas.some(o => o.ticker === 'VOO'), 'EE.UU. está en verde: no se toca');
});

test('aviso de ganancia devuelta y de máximos', () => {
  const { report } = cartera([luz('eeuu', 'verde')]);
  report.posiciones = [
    activo('GOOGL', 0.1, { sector: 'Comunicaciones', pico: { monto: 46, pct: 0.27, fecha: '2026-05-13', hoy: -21, hoyPct: -0.12, devuelto: 1.45 } }),
    activo('NVDA', 0.1, { pico: { monto: 70, pct: 0.72, fecha: '2026-10-06', hoy: 46, hoyPct: 0.48, devuelto: 0.34 } }),
    activo('SCHD', 0.1, { tipo: 'etf', diversificado: true, distMaximo52s: 0 }),
  ];
  const avisos = avisosCartera(report);
  const g = avisos.find(a => a.tipo === 'ganancia');
  assert.ok(g && g.tickers[0] === 'GOOGL' && /toda su ganancia/.test(g.titulo));
  assert.ok(!avisos.some(a => a.tickers.includes('NVDA') && a.tipo === 'ganancia'), 'NVDA devolvió solo un tercio');
  assert.ok(avisos.some(a => a.tipo === 'maximos' && a.tickers.includes('SCHD') && a.nivel === 'info'));
});

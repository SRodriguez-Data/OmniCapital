// Pruebas de los hechos relevantes (8-K de la SEC): cómo se clasifican y cuándo frenan una compra.
//   npx tsx --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventoDe, frenosPorEventos } from '../src/lib/eventos';

test('un 8-K toma el título de su ítem más grave y enlaza al documento', () => {
  const e = eventoDe('XYZ', 12345, '2026-10-20', '2.02,4.02,9.01', '0001234567-26-000001', 'xyz-8k.htm')!;
  assert.equal(e.gravedad, 'grave');
  assert.match(e.titulo, /^Sus estados financieros anteriores ya no son confiables; además: publicó resultados$/);
  assert.equal(e.url, 'https://www.sec.gov/Archives/edgar/data/12345/000123456726000001/xyz-8k.htm');
  assert.deepEqual(e.items, ['2.02', '4.02']);
});

test('un 8-K solo con anexos no es un evento; los resultados son informativos', () => {
  assert.equal(eventoDe('XYZ', 1, '2026-10-20', '9.01', 'a', 'b'), null);
  assert.equal(eventoDe('XYZ', 1, '2026-10-20', '2.02,9.01', 'a', 'b')!.gravedad, 'info');
  assert.equal(eventoDe('XYZ', 1, '2026-10-20', '5.02', 'a', 'b')!.gravedad, 'atencion');
});

test('un evento grave frena las compras por 30 días; uno de atención, no', () => {
  const grave = eventoDe('MALA', 1, '2026-10-20', '1.03', 'a', 'b')!;
  const atencion = eventoDe('OTRA', 2, '2026-10-30', '5.02', 'a', 'b')!;
  const frenos = frenosPorEventos({ MALA: [grave], OTRA: [atencion] }, '2026-11-02');
  assert.deepEqual([...frenos.keys()], ['MALA']);
  assert.match(frenos.get('MALA')!, /20-10-2026/);
  assert.equal(frenosPorEventos({ MALA: [grave] }, '2026-12-01').size, 0, 'pasado un mes ya no frena');
});

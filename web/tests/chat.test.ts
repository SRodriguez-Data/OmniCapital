import test from 'node:test';
import assert from 'node:assert/strict';
import { sinRespaldo } from '../src/lib/chat';
import { rateLimit } from '../src/lib/rateLimit';

// Lo que el motor entregó (contexto + herramientas), como llega serializado
const FUENTES = JSON.stringify({
  pasos: [{ accion: 'COMPRAR', ticker: 'VOO', monto_clp: 350000, cantidad: 0.61, precio_limite: 612.4, moneda: 'USD' },
    { accion: 'VENDER', ticker: 'IAM.SN', monto_clp: 176000, cantidad: 200, precio_limite: 880, moneda: 'CLP' }],
}) + '\nTengo $500.000 extra, ¿qué compro?';

test('una respuesta con los pasos del motor no se marca', () => {
  const r = sinRespaldo('1. **Compra VOO** 0,61 · hasta US$ 612,40 · ≈$350.000\n2. **Vende IAM** 200 · no menos de $880 · ≈$176.000\nCon tus $500 mil: el PER y el ROE no deciden.', FUENTES);
  assert.deepEqual(r, { tickers: [], montos: [] });
});

test('un ticker que se manda a comprar y no está en los datos se marca', () => {
  const r = sinRespaldo('Compra **XYZQ** ahora y vende VOO.', FUENTES);
  assert.deepEqual(r.tickers, ['XYZQ']);
});

test('un ticker chileno inventado se marca aunque no venga con una orden', () => {
  assert.deepEqual(sinRespaldo('FALSA.SN se ve bien.', FUENTES).tickers, ['FALSA.SN']);
});

test('una sigla suelta o una palabra en mayúsculas no es un ticker', () => {
  assert.deepEqual(sinRespaldo('NO vendas: el IPSA y el VIX no cambian la decisión. Compra SOLO lo del plan.', FUENTES).tickers, []);
});

test('un monto que no sale de los datos se marca; uno redondeado, no', () => {
  assert.deepEqual(sinRespaldo('Compra VOO hasta US$ 45,10.', FUENTES).montos, ['US$ 45,10'.replace('US', '')]);
  assert.deepEqual(sinRespaldo('Compra VOO por unos $350 mil.', FUENTES).montos, []);
});

test('el tope de visitantes sin sesión no alcanza a las cuentas verificadas', () => {
  const pedir = (ip: string, usuario: string | null) =>
    rateLimit(new Request('http://x', { headers: { 'x-forwarded-for': ip } }), 'prueba-ia', 5, undefined, { usuario, ia: { anonimos: 3, anonimosDia: 4 } });
  assert.deepEqual(['1', '2', '3', '4'].map(ip => pedir(ip, null)), [true, true, true, false]);
  assert.equal(pedir('9', 'cuenta-1'), true); // el anónimo agotó su cupo común, la cuenta no
  for (let k = 0; k < 4; k++) pedir('9', 'cuenta-1');
  assert.equal(pedir('9', 'cuenta-1'), false); // pero tiene su propio límite
  assert.equal(pedir('9', 'cuenta-2'), true);
});

test('sin tope común, una IP no bloquea a otra', () => {
  const pedir = (ip: string) => rateLimit(new Request('http://x', { headers: { 'x-forwarded-for': ip } }), 'prueba-escritura', 2);
  assert.deepEqual([pedir('a'), pedir('a'), pedir('a'), pedir('b')], [true, true, false, true]);
});

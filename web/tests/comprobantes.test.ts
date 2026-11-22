import test from 'node:test';
import assert from 'node:assert/strict';
import { leerComprobante, juntar, yaRegistrada, numeroCl } from '../src/lib/comprobantes';

const XTB = `===== Página 1 de 2 =====
Confirmación de órdenes ejecutadas en 9/11/2026
Órdenes de compra ejecutadas en intrumentos OMI (Acciones y ETFs) (1)
1        2927768860            APA.US                Apache Corp           KNEM                                            1,0000    9/11/2026             buy limit                      44,21000              44,21000     Cash Stocks          USD                            974.1400                -228,34                   0,00              -228,34
16:01:27
===== Página 2 de 2 =====
Órdenes de compra de Acciones Fraccionadas ejecutadas (1)
1        2927768860            Apache Corp           APA.US                XTB                                             0,1693    9/11/2026             buy limit                     44,21000              7,48       Cash Stocks          USD                            974.1400                -228,34                   0,00              -228,34
Órdenes de venta ejecutadas (1)
1        2940000001            VOO.US                Vanguard, DIST,       XTB                                             0,0500    13/11/2026            sell market                   700,00000              35,00000     ETFs                 USD                           1001.7000                 100,00                   0,00              100,00
`;

const VECTOR = `R.U.T.: 76.513.680-6
Vector Capital Corredores De Bolsa SPA
GIRO: Corredor de Bolsa                                             FACTURA ELECTRONICA
N° 2988118
LAS CONDES, 04 de Noviembre del 2026
DOCUMENTO                                 PRECIO / U    CANTIDAD     DESCUENTO      COMPRA         VENTA
VENTA RV IAM                                                               880,01           98                                    86.241
VENTA ACCIONES CB IAM
COMPRA RV SQM-B                                                            1.250,5           2             2.501
SUB TOTAL(1) :                     $ 95.042`;

const ALPACA = `Alpaca Securities LLC
ORDER ID:        9ddca248-42ce-4cf3-8950-3e2e1f293bee
SYMBOL:        VOO
buy                         0.000412735 USD                         702.630000                 -0.29                           -0.29                              Oct 01, 2026
ORDER ID:        aaaaaaaa-42ce-4cf3-8950-3e2e1f293bee
SYMBOL:        TSM
sell                         1.5 USD                         200.000000                 -0.29                           -0.29                              Oct 03, 2026`;

test('XTB: compras enteras y fraccionadas de la misma orden se leen por separado, y la venta también', () => {
  const l = leerComprobante(XTB);
  assert.equal(l.fuente, 'XTB');
  assert.deepEqual(l.avisos, []);
  assert.equal(l.operaciones.length, 3);
  assert.deepEqual(l.operaciones.map(o => [o.ticker, o.lado, o.cantidad, o.precio, o.fecha]), [
    ['APA', 'COMPRAR', 1, 44.21, '2026-11-09'],
    ['APA', 'COMPRAR', 0.1693, 44.21, '2026-11-09'],
    ['VOO', 'VENDER', 0.05, 700, '2026-11-13'],
  ]);
  assert.equal(new Set(l.operaciones.map(o => o.clave)).size, 3);
  assert.equal(juntar([l, l]).operaciones.length, 3, 'el mismo comprobante dos veces no duplica');
});

test('Vector: ventas y compras chilenas, con precios que llevan punto de miles', () => {
  const l = leerComprobante(VECTOR);
  assert.equal(l.fuente, 'Vector');
  assert.deepEqual(l.operaciones.map(o => [o.ticker, o.lado, o.cantidad, o.precio, o.moneda, o.fecha]), [
    ['IAM.SN', 'VENDER', 98, 880.01, 'CLP', '2026-11-04'],
    ['SQM-B.SN', 'COMPRAR', 2, 1250.5, 'CLP', '2026-11-04'],
  ]);
});

test('Vector: una factura de comisión no es una operación', () => {
  const l = leerComprobante(VECTOR.replace(/\n(VENTA|COMPRA) RV.*\n?/g, '\n').replace('VENTA ACCIONES CB IAM\n', '') + '\nCOMISION MENSUAL   1.249   1   1.249');
  assert.equal(l.fuente, 'Vector');
  assert.deepEqual(l.operaciones, []);
  assert.deepEqual(l.avisos, []);
});

test('Alpaca (Fintual): compra fraccionada y venta', () => {
  const l = leerComprobante(ALPACA);
  assert.deepEqual(l.operaciones.map(o => [o.ticker, o.lado, o.cantidad, o.precio, o.fecha]), [
    ['VOO', 'COMPRAR', 0.000412735, 702.63, '2026-10-01'],
    ['TSM', 'VENDER', 1.5, 200, '2026-10-03'],
  ]);
});

test('lo que no es una operación se ignora, y lo ilegible avisa en vez de adivinar', () => {
  assert.deepEqual(leerComprobante('Cartola mensual de octubre. Dividendo recibido.'), { fuente: null, operaciones: [], avisos: [] });
  const raro = leerComprobante('Confirmación de órdenes ejecutadas en 9/11/2026\nÓrdenes de compra ejecutadas\n1  2927768860  XYZ.PL  algo raro');
  assert.equal(raro.operaciones.length, 0);
  assert.equal(raro.avisos.length, 1);
  const otroMercado = leerComprobante('Confirmación de órdenes ejecutadas\nÓrdenes de compra ejecutadas\n1  2927768860  SAP.DE  X  KNEM  1,0000  9/11/2026  buy limit  10,00000  10,0  Stocks EUR');
  assert.match(otroMercado.avisos[0], /no registra/);
});

test('una compra ya anotada (a mano, con otros decimales) no se vuelve a registrar; una venta nunca se da por repetida', () => {
  const [compra] = leerComprobante(XTB).operaciones;
  const lote = (cantidad: number, precio: number, fecha: string) => ({ ticker: 'APA', cantidad, precio_compra: precio, purchase_date: fecha });
  assert.equal(yaRegistrada(compra, [lote(1, 44.21, '2026-11-09')]), true);
  assert.equal(yaRegistrada(compra, [lote(1.0001, 44.2101, '2026-11-09')]), true);
  assert.equal(yaRegistrada(compra, [lote(1, 44.21, '2026-11-10')]), false);
  assert.equal(yaRegistrada(compra, [lote(3, 44.21, '2026-11-09')]), false);
  assert.equal(yaRegistrada(leerComprobante(XTB).operaciones[2], [lote(1, 700, '2026-11-13')]), false);
});

test('numeroCl entiende el formato chileno', () => {
  assert.equal(numeroCl('1.234,56'), 1234.56);
  assert.equal(numeroCl('86.241'), 86241);
  assert.equal(numeroCl('0,1074'), 0.1074);
});

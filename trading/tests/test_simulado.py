"""Pruebas de la cuenta simulada de la Bolsa de Santiago (core/simulado.py), de su corrida completa y del feed de la
bolsa (bolsa_chile.py), sin red.

    python -m unittest discover -s trading/tests -t .
"""
import copy
import logging
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import bolsa_chile
from bolsa_chile import Cotizacion
from trading.core.simulado import COMISION, CAPITAL_INICIAL, BrokerSimulado, precio_de_ejecucion
from trading.main import Corrida
from trading.tests.test_corrida import SupabaseFalso

logging.disable(logging.CRITICAL)
SANTIAGO = ZoneInfo('America/Santiago')
AHORA = datetime(2026, 10, 23, 11, 0, tzinfo=SANTIAGO)   # viernes, con la bolsa abierta
CL = [{'ticker': t, 'price': 1000.0} for t in ('AAA.SN', 'BBB.SN', 'CCC.SN', 'DDD.SN', 'EEE.SN')]
RANKING = [{'ticker': t, 'momentum': 0.5 - i / 10} for i, t in enumerate(['AAA.SN', 'BBB.SN', 'CCC.SN', 'DDD.SN', 'EEE.SN', 'FFF.SN', 'GGG.SN', 'HHH.SN'])]


def cot(ticker, precio=1000.0, compra=999.0, venta=1001.0, en_sesion=True, hora=AHORA):
    return Cotizacion(ticker, precio, hora, compra, venta, 1e6, precio, en_sesion)


class Feed:
    """Imita bolsa_chile.cotizaciones con precios fijos por ticker."""
    def __init__(self, precios=None, en_sesion=True, hora=AHORA):
        self.precios, self.en_sesion, self.hora = dict(precios or {}), en_sesion, hora
        self.pedidos = []

    def __call__(self, tickers):
        self.pedidos.append(list(tickers))
        return {t: cot(t, self.precios.get(t, 1000.0), self.precios.get(t, 1000.0) - 1, self.precios.get(t, 1000.0) + 1,
                       self.en_sesion, self.hora) for t in tickers}


def supabase_chile(cl=CL, ranking=RANKING, estado=None, fp='2026-10-22'):
    sb = SupabaseFalso(escaneo_fp=fp)
    sb.tablas['analisis_ia'][0].update({'cl': cl, 'ranking': ranking})
    sb.tablas['paper_trading_cl'] = [{'datos': estado}] if estado else []
    return sb


class Ejecucion(unittest.TestCase):
    def test_compra_a_la_punta_de_venta_y_vende_a_la_de_compra(self):
        c = cot('X', 1000, 995, 1004)
        self.assertEqual(precio_de_ejecucion(c, 'compra'), 1004)
        self.assertEqual(precio_de_ejecucion(c, 'venta'), 995)

    def test_sin_punta_confiable_usa_el_ultimo_precio_con_desliz(self):
        c = cot('X', 1000, 900, None)
        self.assertAlmostEqual(precio_de_ejecucion(c, 'compra'), 1002)
        self.assertAlmostEqual(precio_de_ejecucion(c, 'venta'), 998)

    def test_compra_acciones_enteras_y_paga_comision(self):
        b = BrokerSimulado(None, cotizar=Feed({'AAA.SN': 3000}), ahora=AHORA)
        o = b.comprar('AAA.SN', 100_000, 'topcl', 'reb')
        self.assertEqual(o.filled_qty, 33)  # 33 × 3001 × 1,003 = 99.330; 34 ya no alcanza
        pagado = 33 * 3001 * (1 + COMISION)
        self.assertAlmostEqual(b.datos['efectivo'], CAPITAL_INICIAL - pagado, places=4)
        self.assertAlmostEqual(b.posiciones()['AAA.SN'].costo_promedio, pagado / 33)

    def test_vender_todo_cierra_la_posicion_y_cobra_comision(self):
        b = BrokerSimulado(None, cotizar=Feed({'AAA.SN': 3000}), ahora=AHORA)
        b.comprar('AAA.SN', 100_000, 'topcl', 'reb')
        efectivo = b.datos['efectivo']
        b.vender('AAA.SN', 1000, 'topcl', 'cam')  # pide más de las que hay: vende solo las 33
        self.assertNotIn('AAA.SN', b.datos['posiciones'])
        self.assertAlmostEqual(b.datos['efectivo'], efectivo + 33 * 2999 * (1 - COMISION), places=4)
        self.assertEqual([o.side for o in b.ordenes(datetime(2026, 1, 1, tzinfo=timezone.utc), 'topcl')], ['buy', 'sell'])

    def test_el_monto_no_alcanza_para_una_accion(self):
        b = BrokerSimulado(None, cotizar=Feed({'AAA.SN': 50_000}), ahora=AHORA)
        with self.assertRaises(ValueError):
            b.comprar('AAA.SN', 10_000, 'topcl', 'reb')


class Reloj(unittest.TestCase):
    def test_abierta_si_la_referencia_transo_hoy_en_sesion(self):
        self.assertTrue(BrokerSimulado(None, cotizar=Feed(), ahora=AHORA).reloj().abierto)

    def test_feriado_o_antes_del_primer_precio_del_dia_se_ve_cerrada(self):
        ayer = datetime(2026, 10, 22, 16, 0, tzinfo=SANTIAGO)
        self.assertFalse(BrokerSimulado(None, cotizar=Feed(hora=ayer), ahora=AHORA).reloj().abierto)

    def test_sin_feed_se_ve_cerrada(self):
        def caido(_):
            raise ConnectionError('sin red')
        self.assertFalse(BrokerSimulado(None, cotizar=caido, ahora=AHORA).reloj().abierto)


class Libro(unittest.TestCase):
    def test_el_patrimonio_queda_en_el_dia_del_ultimo_precio(self):
        # Antes de la apertura el último precio es el cierre de ayer: el patrimonio se anota en el día de ayer
        ayer = datetime(2026, 10, 22, 16, 0, tzinfo=SANTIAGO)
        temprano = datetime(2026, 10, 23, 8, 0, tzinfo=SANTIAGO)
        b = BrokerSimulado(None, cotizar=Feed(hora=ayer), ahora=temprano)
        self.assertEqual(b.libro()['historial'], [['2026-10-22', float(CAPITAL_INICIAL)]])

    def test_el_freno_compara_con_el_ultimo_dia_anterior(self):
        libro = BrokerSimulado(None, cotizar=Feed(), ahora=AHORA).libro()
        libro['historial'] = [['2026-10-21', 11_000_000.0], ['2026-10-22', 10_500_000.0], ['2026-10-23', 1.0]]
        cuenta = BrokerSimulado(libro, cotizar=Feed(), ahora=AHORA).cuenta()
        self.assertEqual(cuenta.patrimonio_ayer, 10_500_000.0)

    def test_sin_cotizacion_valora_con_el_ultimo_precio_conocido(self):
        b = BrokerSimulado(None, cotizar=Feed({'AAA.SN': 2000}), ahora=AHORA)
        b.comprar('AAA.SN', 100_000, 'topcl', 'reb')
        libro = b.libro()
        sin_precio = BrokerSimulado(libro, cotizar=lambda t: {}, ahora=AHORA)
        self.assertEqual(sin_precio.posiciones()['AAA.SN'].precio, 2000)


class CorridaChile(unittest.TestCase):
    def correr(self, sb, feed, libro=None, ahora=AHORA):
        # Copia: el libro guardado de la corrida anterior no debe cambiar con esta
        c = Corrida(BrokerSimulado(copy.deepcopy(libro), cotizar=feed, ahora=ahora), sb, True, mercado='chile')
        return c.correr(), c

    def test_primera_corrida_compra_las_5_a_partes_iguales_y_guarda_el_libro(self):
        sb = supabase_chile()
        codigo, c = self.correr(sb, Feed())
        self.assertEqual(codigo, 0)
        datos = sb.guardadas[-1]['datos']
        self.assertEqual(sb.guardadas[-1]['tabla'], 'paper_trading_cl')
        self.assertEqual(sorted(datos['libro']['posiciones']), [c['ticker'] for c in CL])
        # 20% de 10 millones menos la reserva ($1.990.000), en acciones enteras a $1.001 más la comisión
        self.assertTrue(all(p['cantidad'] == 1982 for p in datos['libro']['posiciones'].values()))
        self.assertEqual(datos['rebalanceo']['mes'], '2026-10')
        self.assertEqual((datos['mercado'], datos['moneda'], datos['indice']), ('chile', 'CLP', 'IPSA'))
        self.assertGreater(datos['libro']['efectivo'], 0)

    def test_entre_rebalanceos_vende_la_que_sale_del_margen_y_compra_la_que_entra(self):
        sb = supabase_chile()
        self.correr(sb, Feed())
        libro = sb.guardadas[-1]['datos']['libro']
        # Al día siguiente EEE.SN cae al puesto 9 (fuera de las primeras 7) y entra FFF.SN
        nuevo = ['AAA.SN', 'BBB.SN', 'CCC.SN', 'DDD.SN', 'FFF.SN', 'GGG.SN', 'HHH.SN', 'III.SN', 'EEE.SN']
        sb2 = supabase_chile(cl=[{'ticker': t, 'price': 1000.0} for t in nuevo[:5]],
                             ranking=[{'ticker': t, 'momentum': 0} for t in nuevo], estado=sb.guardadas[-1]['datos'])
        codigo, _ = self.correr(sb2, Feed(), libro=libro)
        self.assertEqual(codigo, 0)
        datos = sb2.guardadas[-1]['datos']
        self.assertEqual(sorted(datos['libro']['posiciones']), ['AAA.SN', 'BBB.SN', 'CCC.SN', 'DDD.SN', 'FFF.SN'])
        cambio = [e for e in datos['eventos'] if e['tipo'] == 'cambio']
        self.assertEqual(len(cambio), 1)
        self.assertIn('EEE.SN (salió de la lista y de las primeras 7 del ranking)', cambio[0]['texto'])
        self.assertIn('FFF.SN (entró a la lista)', cambio[0]['texto'])

    def test_la_que_baja_un_poco_en_el_ranking_se_mantiene(self):
        sb = supabase_chile()
        self.correr(sb, Feed())
        libro = sb.guardadas[-1]['datos']['libro']
        # EEE.SN baja al puesto 6: sigue entre las primeras 7, así que no se vende ni se compra FFF.SN
        nuevo = ['AAA.SN', 'BBB.SN', 'CCC.SN', 'DDD.SN', 'FFF.SN', 'EEE.SN', 'GGG.SN']
        sb2 = supabase_chile(cl=[{'ticker': t, 'price': 1000.0} for t in nuevo[:5]],
                             ranking=[{'ticker': t, 'momentum': 0} for t in nuevo], estado=sb.guardadas[-1]['datos'])
        self.correr(sb2, Feed(), libro=libro)
        self.assertEqual(len(sb2.guardadas[-1]['datos']['libro']['ordenes']), 5)

    def test_bolsa_cerrada_no_opera_pero_guarda_el_libro(self):
        sb = supabase_chile()
        ayer = datetime(2026, 10, 22, 16, 0, tzinfo=SANTIAGO)
        codigo, _ = self.correr(sb, Feed(hora=ayer), ahora=datetime(2026, 10, 23, 8, 0, tzinfo=SANTIAGO))
        self.assertEqual(codigo, 0)
        datos = sb.guardadas[-1]['datos']
        self.assertEqual(datos['libro']['ordenes'], [])
        self.assertEqual(datos['libro']['historial'], [['2026-10-22', float(CAPITAL_INICIAL)]])


class FeedDeLaBolsa(unittest.TestCase):
    def test_separa_los_mensajes_de_un_paquete(self):
        paquete = '~m~4~m~~h~1~m~17~m~{"m":"x","p":[1]}'
        self.assertEqual(bolsa_chile.separar(paquete), ['~h~1', '{"m":"x","p":[1]}'])

    def test_simbolo_de_yahoo_a_la_bolsa(self):
        self.assertEqual(bolsa_chile.simbolo('SQM-B.SN'), 'BCS:SQM_B')
        self.assertEqual(bolsa_chile.simbolo('CHILE.SN'), 'BCS:CHILE')

    def test_velas_con_fecha_de_santiago_y_volumen_entero(self):
        # 2026-10-22 12:05 UTC es 09:05 en Santiago; el volumen ajustado por un aumento de capital trae decimales
        hora = lambda d: datetime(2026, 10, d, 12, 5, tzinfo=timezone.utc).timestamp()
        df = bolsa_chile.tabla({1: [hora(22), 10, 11, 9, 10.5, 1234.6], 0: [hora(21), 9, 10, 8, 9.5]})
        self.assertEqual(df['date'].tolist(), ['2026-10-21', '2026-10-22'])
        self.assertEqual(df['volume'].tolist(), [0, 1235])


if __name__ == '__main__':
    unittest.main()

"""Pruebas de la cuenta real de Chile operada a mano (core/manual.py): avisos por Telegram, respuestas del dueño y
corridas completas, sin red.

    python -m unittest discover -s trading/tests -t .
"""
import copy
import logging
import unittest
from datetime import date, datetime

from trading.core.manual import BrokerManual, leer_respuesta
from trading.core.simulado import COMISION
from trading.main import Corrida
from trading.tests.test_simulado import AHORA, CL, SANTIAGO, Feed, supabase_chile

logging.disable(logging.CRITICAL)
DUENO = '42'
MANANA = datetime(2026, 10, 26, 11, 0, tzinfo=SANTIAGO)   # el lunes siguiente


class TelegramFalso:
    """Imita trading.core.telegram.Telegram: guarda lo enviado y entrega las respuestas que se le cargan."""
    def __init__(self):
        self.chat = DUENO
        self.enviados: list[dict] = []
        self.editados: dict[int, str] = {}
        self.respuestas: list[dict] = []
        self.pedidas_desde: list[int] = []

    def enviar(self, texto, botones=None, responde_a=None):
        self.enviados.append({'texto': texto, 'botones': botones, 'responde_a': responde_a})
        return 1000 + len(self.enviados)

    def editar(self, mensaje, texto):
        self.editados[mensaje] = texto

    def contestar(self, consulta, texto):
        pass

    def novedades(self, desde):
        self.pedidas_desde.append(desde)
        return [u for u in self.respuestas if u['update_id'] >= desde]

    def es_del_dueno(self, u):
        origen = (u.get('callback_query') or {}).get('from') or (u.get('message') or {}).get('chat') or {}
        return str(origen.get('id', '')) == self.chat

    # Respuestas del dueño
    def toca(self, dato, de=DUENO):
        self.respuestas.append({'update_id': len(self.respuestas) + 1, 'callback_query': {'id': 'q', 'from': {'id': int(de)}, 'data': dato}})

    def responde(self, mensaje, texto):
        self.respuestas.append({'update_id': len(self.respuestas) + 1, 'message': {
            'message_id': 5000 + len(self.respuestas), 'chat': {'id': int(DUENO)}, 'text': texto, 'reply_to_message': {'message_id': mensaje}}})

    def escribe(self, texto):
        self.respuestas.append({'update_id': len(self.respuestas) + 1, 'message': {'message_id': 1, 'chat': {'id': int(DUENO)}, 'text': texto}})


def corrida(sb, tg, libro=None, capital=1_000_000, ahora=AHORA, feed=None):
    broker = BrokerManual(copy.deepcopy(libro), capital, tg, cotizar=feed or Feed(), ahora=ahora)
    broker.procesar_respuestas()
    c = Corrida(broker, sb, True, dueno='u-1', mercado='chile')
    return c.correr(), c


def guardado(sb):
    return sb.guardadas[-1]['datos']


class Avisos(unittest.TestCase):
    def test_primera_corrida_avisa_las_compras_y_no_anota_nada(self):
        sb, tg = supabase_chile(), TelegramFalso()
        codigo, _ = corrida(sb, tg)
        self.assertEqual(codigo, 0)
        datos = guardado(sb)
        self.assertEqual(sb.guardadas[-1]['tabla'], 'real_trading_cl')
        self.assertEqual(sb.guardadas[-1]['user_id'], 'u-1')
        self.assertEqual(len(tg.enviados), 5)
        self.assertIn('COMPRA 198 AAA', tg.enviados[0]['texto'])   # 20% de $995.000 a $1.001 más comisión
        self.assertEqual([b[0] for b in tg.enviados[0]['botones']], ['✅ Hecha', '❌ No la haré'])
        self.assertEqual(datos['libro']['posiciones'], {})
        self.assertEqual(datos['libro']['efectivo'], 1_000_000)
        self.assertEqual(len(datos['libro']['pendientes']), 5)
        self.assertTrue(all(o['estado'] == 'pendiente' for o in datos['ordenes']))
        self.assertEqual(datos['rebalanceo']['mes'], '2026-10')

    def test_no_compromete_mas_efectivo_del_que_hay(self):
        sb, tg = supabase_chile(), TelegramFalso()
        corrida(sb, tg)
        comprometido = sum(p['cantidad'] * p['precio'] * (1 + COMISION) for p in guardado(sb)['libro']['pendientes'])
        self.assertLessEqual(comprometido, 1_000_000)

    def test_con_ordenes_sin_respuesta_no_avisa_nada_nuevo(self):
        sb, tg = supabase_chile(), TelegramFalso()
        corrida(sb, tg)
        sb2 = supabase_chile(estado=guardado(sb))
        codigo, _ = corrida(sb2, tg, libro=guardado(sb)['libro'])
        self.assertEqual(codigo, 0)
        self.assertEqual(len(tg.enviados), 5)
        self.assertEqual(len(guardado(sb2)['libro']['pendientes']), 5)

    def test_al_dia_siguiente_recuerda_lo_pendiente_una_vez(self):
        sb, tg = supabase_chile(), TelegramFalso()
        corrida(sb, tg)
        libro = guardado(sb)['libro']
        for _ in range(2):
            sb = supabase_chile(estado=guardado(sb), fp='2026-10-23')
            corrida(sb, tg, libro=libro, ahora=MANANA, feed=Feed(hora=MANANA))
            libro = guardado(sb)['libro']
        recordatorios = [e for e in tg.enviados if e['texto'].startswith('⏰')]
        self.assertEqual(len(recordatorios), 5)
        self.assertEqual(recordatorios[0]['responde_a'], 1001)


class Respuestas(unittest.TestCase):
    def setUp(self):
        self.sb, self.tg = supabase_chile(), TelegramFalso()
        corrida(self.sb, self.tg)
        self.libro = guardado(self.sb)['libro']
        self.aaa = next(p for p in self.libro['pendientes'] if p['ticker'] == 'AAA.SN')

    def siguiente(self):
        sb = supabase_chile(estado=guardado(self.sb))
        codigo, c = corrida(sb, self.tg, libro=self.libro)
        return codigo, guardado(sb), c

    def test_hecha_anota_la_compra_al_precio_del_aviso(self):
        self.tg.toca(f'ok:{self.aaa["id"]}')
        _, datos, _ = self.siguiente()
        pos = datos['libro']['posiciones']['AAA.SN']
        self.assertEqual(pos['cantidad'], self.aaa['cantidad'])
        self.assertAlmostEqual(datos['libro']['efectivo'], 1_000_000 - self.aaa['cantidad'] * self.aaa['precio'] * (1 + COMISION), places=2)
        self.assertEqual(len(datos['libro']['pendientes']), 4)
        self.assertIn('Anotada', self.tg.editados[self.aaa['mensaje']])
        self.assertTrue(any(e['tipo'] == 'hecha' for e in datos['eventos']))
        self.assertEqual(self.tg.pedidas_desde[-1], 0)
        self.assertEqual(datos['libro']['telegram'], 2)   # la próxima lectura confirma esta respuesta

    def test_responder_con_cantidad_y_precio_anota_lo_que_se_hizo(self):
        self.tg.responde(self.aaa['mensaje'], '150 a $1.010')
        _, datos, _ = self.siguiente()
        pos = datos['libro']['posiciones']['AAA.SN']
        self.assertEqual(pos['cantidad'], 150)
        self.assertAlmostEqual(pos['costo'], 1010 * (1 + COMISION))

    def test_no_la_hare_la_descarta_y_no_se_vuelve_a_pedir_ese_dia(self):
        for p in self.libro['pendientes']:
            self.tg.toca(f'ok:{p["id"]}' if p is not self.aaa else f'no:{p["id"]}')
        codigo, datos, _ = self.siguiente()
        self.assertEqual(codigo, 0)
        self.assertNotIn('AAA.SN', datos['libro']['posiciones'])
        self.assertEqual(datos['libro']['pendientes'], [])
        self.assertIn('Descartada', self.tg.editados[self.aaa['mensaje']])
        self.assertEqual(len(self.tg.enviados), 5)   # AAA no se volvió a avisar

    def test_al_dia_siguiente_lo_descartado_se_vuelve_a_pedir(self):
        for p in self.libro['pendientes']:
            self.tg.toca(f'ok:{p["id"]}' if p is not self.aaa else f'no:{p["id"]}')
        _, datos, _ = self.siguiente()
        sb = supabase_chile(estado=datos, fp='2026-10-23')
        corrida(sb, self.tg, libro=datos['libro'], ahora=MANANA, feed=Feed(hora=MANANA))
        self.assertIn('COMPRA', self.tg.enviados[-1]['texto'])
        self.assertIn('AAA', self.tg.enviados[-1]['texto'])

    def test_ignora_a_quien_no_es_el_dueno(self):
        self.tg.toca(f'ok:{self.aaa["id"]}', de='999')
        _, datos, _ = self.siguiente()
        self.assertEqual(datos['libro']['posiciones'], {})
        self.assertEqual(len(datos['libro']['pendientes']), 5)

    def test_un_toque_repetido_no_anota_dos_veces(self):
        self.tg.toca(f'ok:{self.aaa["id"]}')
        self.tg.toca(f'ok:{self.aaa["id"]}')
        _, datos, _ = self.siguiente()
        self.assertEqual(datos['libro']['posiciones']['AAA.SN']['cantidad'], self.aaa['cantidad'])

    def test_cartera_responde_con_lo_que_hay(self):
        self.tg.toca(f'ok:{self.aaa["id"]}')
        self.tg.escribe('/cartera')
        self.siguiente()
        self.assertIn(f'AAA: {self.aaa["cantidad"]} acciones', self.tg.enviados[-1]['texto'])
        self.assertIn('Pendiente: COMPRA', self.tg.enviados[-1]['texto'])

    def test_respuesta_que_no_se_entiende_pide_el_formato(self):
        self.tg.responde(self.aaa['mensaje'], 'listo')
        _, datos, _ = self.siguiente()
        self.assertEqual(len(datos['libro']['pendientes']), 5)
        self.assertIn('No te entendí', self.tg.enviados[-1]['texto'])


class VentasPrimero(unittest.TestCase):
    def test_confirmadas_las_ventas_avisa_las_compras(self):
        # La cartera tiene ZZZ.SN, que no está en la lista ni en el ranking: primero se avisa solo su venta
        tg = TelegramFalso()
        libro = BrokerManual(None, 1_000_000, tg, cotizar=Feed(), ahora=AHORA).datos
        libro['posiciones'] = {'ZZZ.SN': {'cantidad': 900, 'costo': 1000.0, 'precio': 1000.0}}
        libro['efectivo'] = 100_000.0
        sb = supabase_chile(estado={'rebalanceo': {'mes': '2026-10'}})
        corrida(sb, tg, libro=libro)
        self.assertEqual(len(tg.enviados), 1)
        self.assertIn('VENDE 900 ZZZ', tg.enviados[0]['texto'])
        venta = guardado(sb)['libro']['pendientes'][0]
        tg.toca(f'ok:{venta["id"]}')
        sb2 = supabase_chile(estado=guardado(sb))
        corrida(sb2, tg, libro=guardado(sb)['libro'])
        self.assertNotIn('ZZZ.SN', guardado(sb2)['libro']['posiciones'])
        self.assertEqual(sum('COMPRA' in e['texto'] for e in tg.enviados), 5)


class Capital(unittest.TestCase):
    def test_subir_el_capital_es_un_aporte_que_no_cuenta_como_ganancia(self):
        b = BrokerManual(None, 1_000_000, TelegramFalso(), cotizar=Feed(), ahora=AHORA)
        b.datos['historial'] = [['2026-10-22', 1_000_000.0]]
        b = BrokerManual(b.datos, 1_500_000, TelegramFalso(), cotizar=Feed(), ahora=AHORA)
        self.assertEqual(b.datos['efectivo'], 1_500_000)
        self.assertEqual(b.eventos[0]['tipo'], 'aporte')
        b.libro()
        self.assertEqual([round(v) for _, v in b.historial(date(2026, 10, 1))], [1_000_000, 1_000_000])
        cuenta = b.cuenta()
        self.assertEqual(cuenta.patrimonio, cuenta.patrimonio_ayer)   # el aporte no activa ni evita el freno diario

    def test_bajar_el_capital_retira_solo_del_efectivo(self):
        b = BrokerManual(None, 1_000_000, TelegramFalso(), cotizar=Feed(), ahora=AHORA)
        b.datos['efectivo'] = 200_000.0
        b = BrokerManual(b.datos, 500_000, TelegramFalso(), cotizar=Feed(), ahora=AHORA)
        self.assertEqual(b.datos['efectivo'], 0)
        self.assertEqual(b.datos['capital'], 800_000)


class Lectura(unittest.TestCase):
    def test_lee_cantidad_y_precio_a_la_chilena(self):
        self.assertEqual(leer_respuesta('17 23650'), (17, 23650))
        self.assertEqual(leer_respuesta('17 a $23.650'), (17, 23650))
        self.assertEqual(leer_respuesta('17, 23.650,5'), (17, 23650.5))
        self.assertEqual(leer_respuesta('0 1'), (0, 1))
        self.assertIsNone(leer_respuesta('listo'))
        self.assertIsNone(leer_respuesta('17'))
        self.assertIsNone(leer_respuesta('1.5 23650'))


if __name__ == '__main__':
    unittest.main()

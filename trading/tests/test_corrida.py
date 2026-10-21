"""Pruebas de una corrida completa (trading/main.py) contra un broker y un Supabase de mentira, sin red.

    python -m unittest discover -s trading/tests -t .
"""
import logging
import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace

from trading.core.broker import Cuenta, Posicion, Reloj
from trading.main import Corrida

HOY = date(2026, 10, 21)
logging.disable(logging.CRITICAL)  # los logs de cada corrida no aportan aquí
IDEAS = [{'ticker': t, 'price': 100.0} for t in 'AAA BBB CCC DDD EEE FFF GGG HHH III JJJ KKK LLL MMM NNN OOO PPP QQQ RRR SSS BRK-B'.split()]


class Consulta:
    """Imita la cadena de supabase-py (table().select().eq().order().limit().execute())."""
    def __init__(self, base, tabla):
        self.base, self.tabla = base, tabla

    def __getattr__(self, _):
        return lambda *a, **k: self

    def upsert(self, fila):
        self.base.guardadas.append(fila)
        self.base.tablas['paper_trading'] = [fila]
        return self

    def execute(self):
        return SimpleNamespace(data=self.base.tablas.get(self.tabla, []))


class SupabaseFalso:
    def __init__(self, escaneo_fp='2026-10-20', ideas=IDEAS, estado=None):
        self.guardadas = []
        self.tablas = {
            'analisis_ia': [{'fecha': f'{escaneo_fp}T09:00:00+00:00', 'metodo': 'v2', 'fp': escaneo_fp, 'us': ideas}],
            'precios_historicos': [],
            'paper_trading': [{'datos': estado}] if estado else [],
        }

    def table(self, nombre):
        return Consulta(self, nombre)


class BrokerFalso:
    def __init__(self, efectivo=100_000.0, posiciones=None, ayer=None, abierto=True):
        self.efectivo = efectivo
        self.pos = dict(posiciones or {})
        self.ayer = ayer
        self.abierto = abierto
        self.enviadas = []

    def reloj(self):
        ahora = datetime(2026, 10, 21, 11, 30, tzinfo=timezone.utc)
        return Reloj(self.abierto, ahora, ahora, ahora)

    def cuenta(self):
        patrimonio = self.efectivo + sum(p.valor for p in self.pos.values())
        return Cuenta('PA123', 'ACTIVE', patrimonio, self.ayer or patrimonio, self.efectivo, False, None)

    def posiciones(self):
        return dict(self.pos)

    def ordenes(self, desde, prefijo, abiertas=False):
        return [] if abiertas else list(self.enviadas)

    def activo(self, simbolo):
        return True, True

    def _orden(self, simbolo, lado, cantidad, motivo):
        o = SimpleNamespace(id=len(self.enviadas), symbol=simbolo, side=SimpleNamespace(value=lado), status='filled',
                            client_order_id=f'topv2-{motivo}-20261021-{simbolo}-x', filled_qty=cantidad, filled_avg_price=100.0,
                            notional=None, filled_at=datetime(2026, 10, 21, 15, tzinfo=timezone.utc), submitted_at=None, created_at=None)
        self.enviadas.append(o)
        return o

    def comprar(self, simbolo, monto, prefijo, motivo, precio_ref=None):
        self.efectivo -= monto
        p = self.pos.get(simbolo)
        valor = (p.valor if p else 0) + monto
        self.pos[simbolo] = Posicion(simbolo, valor / 100, valor, 100.0, 100.0, 0.0)
        return self._orden(simbolo, 'buy', monto / 100, motivo)

    def vender(self, simbolo, cantidad, prefijo, motivo):
        p = self.pos[simbolo]
        self.efectivo += cantidad * p.precio
        if cantidad >= p.cantidad:
            del self.pos[simbolo]
        else:
            self.pos[simbolo] = Posicion(simbolo, p.cantidad - cantidad, (p.cantidad - cantidad) * p.precio, p.costo_promedio, p.precio, p.ganancia_pct)
        return self._orden(simbolo, 'sell', cantidad, motivo)

    def esperar(self, ordenes, segundos=90):
        return ordenes

    def historial(self, desde):
        return []


def correr(broker, supabase, enviar=True):
    c = Corrida(broker, supabase, enviar)
    return c.correr(), c


class CorridaCompleta(unittest.TestCase):
    def test_primera_corrida_compra_las_20_a_partes_iguales_y_marca_el_mes(self):
        b, sb = BrokerFalso(), SupabaseFalso()
        codigo, _ = correr(b, sb)
        self.assertEqual(codigo, 0)
        compras = [o for o in b.enviadas if o.side.value == 'buy']
        self.assertEqual(len(compras), 20)
        self.assertIn('BRK.B', b.pos)  # símbolo de Yahoo traducido al de Alpaca
        self.assertTrue(all(abs(p.valor - 4975) < 1 for p in b.pos.values()))  # 5% menos la reserva de efectivo
        self.assertGreaterEqual(b.efectivo, 0)
        self.assertEqual(sb.guardadas[-1]['datos']['rebalanceo']['mes'], '2026-10')

    def test_segunda_corrida_del_mes_no_opera(self):
        b, sb = BrokerFalso(), SupabaseFalso()
        correr(b, sb)
        enviadas = len(b.enviadas)
        correr(b, sb)
        self.assertEqual(len(b.enviadas), enviadas)

    def test_freno_diario_no_compra_pero_ejecuta_el_stop(self):
        caida = Posicion('XXX', 10, 650.0, 100.0, 65.0, -0.35)
        b = BrokerFalso(efectivo=96_000.0, posiciones={'XXX': caida}, ayer=100_000.0)
        sb = SupabaseFalso()
        correr(b, sb)
        self.assertEqual([(o.symbol, o.side.value) for o in b.enviadas], [('XXX', 'sell')])
        self.assertIsNone(sb.guardadas[-1]['datos']['rebalanceo'])
        self.assertEqual({e['tipo'] for e in sb.guardadas[-1]['datos']['eventos']}, {'freno', 'stop'})

    def test_escaneo_viejo_no_rebalancea(self):
        b, sb = BrokerFalso(), SupabaseFalso(escaneo_fp='2026-10-10')
        correr(b, sb)
        self.assertEqual(b.enviadas, [])
        self.assertEqual(sb.guardadas[-1]['datos']['eventos'][-1]['tipo'], 'espera')

    def test_bolsa_cerrada_no_envia_y_deja_el_rebalanceo_pendiente(self):
        b, sb = BrokerFalso(abierto=False), SupabaseFalso()
        correr(b, sb)
        self.assertEqual(b.enviadas, [])
        self.assertEqual(sb.guardadas[-1]['datos']['proximo_rebalanceo'], HOY.isoformat())

    def test_modo_revision_no_envia_ni_guarda(self):
        b, sb = BrokerFalso(), SupabaseFalso()
        correr(b, sb, enviar=False)
        self.assertEqual((b.enviadas, sb.guardadas), ([], []))

    def test_rebalanceo_del_mes_siguiente_cambia_solo_lo_necesario(self):
        b = BrokerFalso(efectivo=500.0, posiciones={t['ticker'].replace('-', '.'): Posicion(t['ticker'].replace('-', '.'), 49.75, 4975.0, 100.0, 100.0, 0.0) for t in IDEAS})
        nuevas = IDEAS[1:] + [{'ticker': 'ZZZ', 'price': 100.0}]
        sb = SupabaseFalso(ideas=nuevas, estado={'rebalanceo': {'mes': '2026-09'}})
        correr(b, sb)
        self.assertEqual(sorted((o.symbol, o.side.value) for o in b.enviadas), [('AAA', 'sell'), ('ZZZ', 'buy')])


if __name__ == '__main__':
    unittest.main()

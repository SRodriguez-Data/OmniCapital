"""Pruebas del plan de órdenes y del control de riesgo (sin red).

    python -m unittest discover -s trading/tests -t .
"""
import unittest
from datetime import date

from trading.core import risk
from trading.core.broker import Cuenta, Posicion
from trading.core.plan import planificar
from trading.main import proximo_rebalanceo
from trading.strategies.top_calidad import simbolo_alpaca


def pos(simbolo, valor, precio=100.0, ganancia=0.0):
    return Posicion(simbolo, valor / precio, valor, precio, precio, ganancia)


def cuenta(patrimonio, ayer, efectivo=0.0, bloqueada=False):
    return Cuenta('PA0000', 'ACTIVE', patrimonio, ayer, efectivo, bloqueada, None)


class Plan(unittest.TestCase):
    def test_desde_efectivo_compra_todo_a_partes_iguales(self):
        ordenes = planificar({'A': 0.5, 'B': 0.5}, {}, 1000)
        self.assertEqual([(o.simbolo, o.lado, o.monto) for o in ordenes], [('A', 'compra', 500), ('B', 'compra', 500)])

    def test_vende_lo_que_salio_y_compra_lo_que_entro(self):
        ordenes = planificar({'A': 0.5, 'C': 0.5}, {'A': pos('A', 500), 'B': pos('B', 500)}, 1000)
        self.assertEqual([(o.simbolo, o.lado) for o in ordenes], [('B', 'venta'), ('C', 'compra')])
        self.assertAlmostEqual(ordenes[0].cantidad, 5)

    def test_diferencias_chicas_no_se_operan(self):
        self.assertEqual(planificar({'A': 0.5, 'B': 0.5}, {'A': pos('A', 503), 'B': pos('B', 497)}, 1000), [])

    def test_recorta_lo_que_subio_de_mas(self):
        ordenes = planificar({'A': 0.5, 'B': 0.5}, {'A': pos('A', 700), 'B': pos('B', 300)}, 1000)
        venta = next(o for o in ordenes if o.lado == 'venta')
        self.assertEqual(venta.simbolo, 'A')
        self.assertAlmostEqual(venta.cantidad, 2)

    def test_sin_fracciones_vende_acciones_enteras(self):
        ordenes = planificar({'A': 0.5}, {'A': pos('A', 750, precio=100)}, 1000, fraccionable=lambda s: False)
        self.assertEqual(ordenes[0].cantidad, 2)


class Riesgo(unittest.TestCase):
    limites = risk.Limites()

    def test_freno_diario(self):
        self.assertIsNotNone(risk.freno_diario(cuenta(97, 100), self.limites))
        self.assertIsNone(risk.freno_diario(cuenta(97.5, 100), self.limites))

    def test_stop_loss(self):
        stops = risk.stops({'A': pos('A', 70, ganancia=-0.31), 'B': pos('B', 80, ganancia=-0.2)}, self.limites)
        self.assertEqual([o.simbolo for o in stops], ['A'])

    def test_peso_maximo(self):
        self.assertEqual(risk.limitar_pesos({'A': 0.1, 'B': 0.05}, self.limites), {'A': 0.06, 'B': 0.05})

    def test_compras_no_superan_el_efectivo_ni_el_peso_maximo(self):
        compras = planificar({'A': 0.5, 'B': 0.5}, {}, 1000)
        ajustadas = risk.ajustar_compras(compras, efectivo=1000, patrimonio=1000, posiciones={}, limites=self.limites)
        self.assertTrue(all(o.monto <= 60 for o in ajustadas))
        ajustadas = risk.ajustar_compras(compras, efectivo=50, patrimonio=1000, posiciones={}, limites=self.limites)
        self.assertLessEqual(sum(o.monto for o in ajustadas), 50 - 0.005 * 1000 + 1e-9)
        self.assertEqual([o.monto for o in compras], [500, 500])  # no modifica las originales

    def test_sin_efectivo_no_compra(self):
        compras = planificar({'A': 1.0}, {}, 1000)
        self.assertEqual(risk.ajustar_compras(compras, 0, 1000, {}, self.limites), [])

    def test_no_vende_mas_de_lo_que_hay_ni_dos_veces(self):
        posiciones = {'A': pos('A', 500)}
        stop = risk.stops({'A': pos('A', 500, ganancia=-0.4)}, self.limites)
        ventas = risk.ajustar_ventas(stop + planificar({}, posiciones, 1000) + planificar({}, {'Z': pos('Z', 10)}, 1000), posiciones)
        self.assertEqual([(o.simbolo, o.motivo) for o in ventas], [('A', 'stop')])

    def test_cuenta_bloqueada(self):
        self.assertIsNotNone(risk.bloqueo(cuenta(100, 100, bloqueada=True)))


class Calendario(unittest.TestCase):
    def test_proximo_rebalanceo_salta_el_fin_de_semana(self):
        self.assertEqual(proximo_rebalanceo(date(2026, 10, 21)), date(2026, 11, 2))
        self.assertEqual(proximo_rebalanceo(date(2026, 12, 15)), date(2027, 1, 1))

    def test_simbolos_de_yahoo_a_alpaca(self):
        self.assertEqual(simbolo_alpaca('BRK-B'), 'BRK.B')


if __name__ == '__main__':
    unittest.main()

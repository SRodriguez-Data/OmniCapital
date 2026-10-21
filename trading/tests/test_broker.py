"""Pruebas de las barreras entre la cuenta de paper y la real, y de la curva sin depósitos (sin red).

    python -m unittest discover -s trading/tests -t .
"""
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from alpaca.common.enums import BaseURL

from trading.core.broker import Broker, ErrorConfiguracion, indice
from trading.main import tope_real


def cuenta_alpaca(numero):
    return SimpleNamespace(account_number=numero, status='ACTIVE', equity='1000', last_equity='1000', cash='1000',
                           trading_blocked=False, account_blocked=False, trade_suspended_by_user=False, created_at=None)


def dias(n):
    # Medianoche de Nueva York (04:00 UTC en horario de verano) de n días seguidos desde el 1 de octubre de 2026
    return [int(datetime(2026, 10, 1 + k, 4, tzinfo=timezone.utc).timestamp()) for k in range(n)]


class Claves(unittest.TestCase):
    def test_paper_apunta_al_servidor_de_paper(self):
        self.assertEqual(Broker(clave='PKX', secreto='s').cliente._base_url, BaseURL.TRADING_PAPER)

    def test_real_apunta_al_servidor_real(self):
        self.assertEqual(Broker(real=True, clave='AKX', secreto='s').cliente._base_url, BaseURL.TRADING_LIVE)

    def test_clave_de_paper_no_sirve_para_la_cuenta_real(self):
        with self.assertRaises(ErrorConfiguracion):
            Broker(real=True, clave='PKX', secreto='s')

    def test_clave_real_no_sirve_para_la_simulacion(self):
        with self.assertRaises(ErrorConfiguracion):
            Broker(clave='AKX', secreto='s')

    def test_cada_modo_lee_sus_propias_variables(self):
        with mock.patch.dict(os.environ, {'ALPACA_API_KEY': 'PKX', 'ALPACA_SECRET_KEY': 's'}, clear=True):
            with self.assertRaisesRegex(ErrorConfiguracion, 'ALPACA_REAL_API_KEY'):
                Broker(real=True)

    def test_secreto_y_clave_intercambiados(self):
        with self.assertRaises(ErrorConfiguracion):
            Broker(real=True, clave='s', secreto='AKX')


class CuentaDelModo(unittest.TestCase):
    def test_modo_real_rechaza_una_cuenta_de_paper(self):
        b = Broker(real=True, clave='AKX', secreto='s')
        b.cliente = SimpleNamespace(get_account=lambda: cuenta_alpaca('PA123'))
        with self.assertRaises(ErrorConfiguracion):
            b.cuenta()

    def test_modo_paper_rechaza_una_cuenta_real(self):
        b = Broker(clave='PKX', secreto='s')
        b.cliente = SimpleNamespace(get_account=lambda: cuenta_alpaca('9XA123'))
        with self.assertRaises(ErrorConfiguracion):
            b.cuenta()

    def test_modo_real_acepta_la_cuenta_real(self):
        b = Broker(real=True, clave='AKX', secreto='s')
        b.cliente = SimpleNamespace(get_account=lambda: cuenta_alpaca('9XA123'))
        self.assertEqual(b.cuenta().patrimonio, 1000)


class Tope(unittest.TestCase):
    def test_dolares_enteros(self):
        with mock.patch.dict(os.environ, {'ALPACA_REAL_TOPE_USD': '500'}):
            self.assertEqual(tope_real(), 500)

    def test_sin_tope_o_con_formato_ambiguo_no_opera(self):
        for valor in ('', '0', '1.000', '1,000', '-5', 'quinientos'):
            with mock.patch.dict(os.environ, {'ALPACA_REAL_TOPE_USD': valor}), self.assertRaises(ErrorConfiguracion):
                tope_real()


class CurvaSinDepositos(unittest.TestCase):
    def test_sin_flujos_es_el_patrimonio(self):
        self.assertEqual([round(v, 6) for _, v in indice(dias(3), [100, 110, 99], {})], [100, 110, 99])

    def test_un_deposito_no_es_ganancia_ni_un_retiro_perdida(self):
        # 0 → depósito de 500 → sube 2% → depósito de 500 → retiro de 200 (venga con signo negativo o positivo)
        for retiro in (-200, 200):
            puntos = indice(dias(5), [0, 500, 510, 1010, 810], {'CSD': [0, 500, 0, 500, 0], 'CSW': [0, 0, 0, 0, retiro]})
            self.assertEqual([round(v, 6) for _, v in puntos], [0, 500, 510, 510, 510])

    def test_fechas_en_el_dia_de_nueva_york(self):
        self.assertEqual([f for f, _ in indice(dias(2), [1, 1], {})], ['2026-10-01', '2026-10-02'])


if __name__ == '__main__':
    unittest.main()

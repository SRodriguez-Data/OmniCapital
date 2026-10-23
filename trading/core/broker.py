"""Conexión con Alpaca: la cuenta de paper (dinero ficticio) o, con `real=True`, la de dinero real.

Cada modo tiene sus propias claves y su servidor, fijado aquí: con las claves de paper no se llega a la cuenta real ni
al revés, y se rechaza la cuenta que no corresponde al modo. Las claves se leen del entorno (.env en local, secrets
en GitHub Actions) y nunca se escriben en los logs.
"""
import logging
import math
import os
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from alpaca.common.enums import BaseURL, Sort
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, QueryOrderStatus, TimeInForce
from alpaca.trading.requests import GetOrdersRequest, GetPortfolioHistoryRequest, MarketOrderRequest

# Estados en que una orden ya no cambia
FINALES = {'filled', 'canceled', 'expired', 'rejected', 'done_for_day', 'stopped', 'suspended'}


# Variables de entorno con las claves de cada modo (real: True/False)
CLAVES = {False: ('ALPACA_API_KEY', 'ALPACA_SECRET_KEY'), True: ('ALPACA_REAL_API_KEY', 'ALPACA_REAL_SECRET_KEY')}
# Alpaca numera las claves de paper PK... y las de dinero real AK...
PREFIJO = {False: 'PK', True: 'AK'}
# Depósitos, retiros y traspasos: mueven el patrimonio sin ser ganancia ni pérdida
FLUJOS = 'CSD,CSW,JNLC'


class ErrorConfiguracion(RuntimeError):
    """Faltan claves, están mal puestas o la cuenta no es la del modo pedido: no se opera."""


@dataclass
class Cuenta:
    numero: str
    estado: str
    patrimonio: float        # efectivo + valor de las posiciones
    patrimonio_ayer: float   # el patrimonio al cierre anterior
    efectivo: float
    bloqueada: bool
    creada: datetime | None


@dataclass
class Posicion:
    simbolo: str
    cantidad: float
    valor: float
    costo_promedio: float
    precio: float
    ganancia_pct: float      # frente al costo promedio, -0.3 = -30%


@dataclass
class Reloj:
    abierto: bool
    ahora: datetime          # hora de Nueva York
    proxima_apertura: datetime
    proximo_cierre: datetime


def estado(orden) -> str:
    return str(getattr(orden.status, 'value', orden.status))


def _num(x) -> float:
    return float(x) if x not in (None, '') else 0.0


class Broker:
    moneda = 'USD'

    def __init__(self, real: bool = False, clave: str | None = None, secreto: str | None = None):
        self.real = real
        var_clave, var_secreto = CLAVES[real]
        prefijo = PREFIJO[real]
        clave = (clave if clave is not None else os.getenv(var_clave, '')).strip()
        secreto = (secreto if secreto is not None else os.getenv(var_secreto, '')).strip()
        if not clave or not secreto:
            raise ErrorConfiguracion(f'Faltan {var_clave} y {var_secreto} (en .env o en los secrets de GitHub).')
        if clave.startswith('http') or secreto.startswith('http'):
            raise ErrorConfiguracion(f'Una de las claves es una URL: {var_clave} lleva el Key ID (empieza con {prefijo}) y '
                                     f'{var_secreto} el Secret. La URL no hace falta, el código fija la del servidor.')
        if secreto.startswith(prefijo):
            raise ErrorConfiguracion(f'{var_secreto} tiene el Key ID ({prefijo}...): ahí va el Secret, y el Key ID en {var_clave}.')
        if clave.startswith(PREFIJO[not real]):
            raise ErrorConfiguracion(
                f'{var_clave} es una clave de paper (PK...): para dinero real va una AK... de la vista Live del panel de Alpaca.'
                if real else f'{var_clave} es una clave de dinero real (AK...): la simulación usa una de paper (PK...).')
        self.cliente = TradingClient(clave, secreto, paper=not real)
        servidor = BaseURL.TRADING_LIVE if real else BaseURL.TRADING_PAPER
        if self.cliente._base_url != servidor:
            raise ErrorConfiguracion(f'El cliente no apunta al servidor esperado ({self.cliente._base_url}, no {servidor.value}).')
        self._activos: dict[str, tuple[bool, bool]] = {}

    # --- Lectura ---------------------------------------------------------------------------------------------

    def cuenta(self) -> Cuenta:
        a = self.cliente.get_account()
        # Las cuentas de paper de Alpaca se numeran PA...: cada modo opera solo la suya
        if str(a.account_number or '').startswith('PA') == self.real:
            raise ErrorConfiguracion('La cuenta es de paper, no la de dinero real: no se opera.' if self.real
                                     else 'La cuenta no es de paper trading: no se opera.')
        return Cuenta(
            numero=a.account_number, estado=str(getattr(a.status, 'value', a.status)),
            patrimonio=_num(a.equity), patrimonio_ayer=_num(a.last_equity), efectivo=_num(a.cash),
            bloqueada=bool(a.trading_blocked or a.account_blocked or a.trade_suspended_by_user),
            creada=a.created_at,
        )

    def posiciones(self) -> dict[str, Posicion]:
        return {
            p.symbol: Posicion(simbolo=p.symbol, cantidad=_num(p.qty), valor=_num(p.market_value),
                               costo_promedio=_num(p.avg_entry_price), precio=_num(p.current_price),
                               ganancia_pct=_num(p.unrealized_plpc))
            for p in self.cliente.get_all_positions()
        }

    def reloj(self) -> Reloj:
        r = self.cliente.get_clock()
        return Reloj(abierto=bool(r.is_open), ahora=r.timestamp, proxima_apertura=r.next_open, proximo_cierre=r.next_close)

    def activo(self, simbolo: str) -> tuple[bool, bool]:
        """(se puede operar, admite fracciones de acción)."""
        if simbolo not in self._activos:
            try:
                a = self.cliente.get_asset(simbolo)
                self._activos[simbolo] = (bool(a.tradable) and str(getattr(a.status, 'value', a.status)) == 'active', bool(a.fractionable))
            except Exception as e:
                logging.warning(f'{simbolo}: Alpaca no lo reconoce ({str(e)[:80]})')
                self._activos[simbolo] = (False, False)
        return self._activos[simbolo]

    def ordenes(self, desde: datetime, prefijo: str, abiertas: bool = False) -> list:
        """Órdenes propias (su client_order_id empieza con `prefijo`) creadas desde `desde`, de la más antigua a la más nueva."""
        todas, despues = [], desde
        while True:
            lote = self.cliente.get_orders(GetOrdersRequest(
                status=QueryOrderStatus.OPEN if abiertas else QueryOrderStatus.ALL,
                after=despues, direction=Sort.ASC, limit=500, nested=False))
            todas += lote
            if len(lote) < 500:
                break
            despues = lote[-1].submitted_at
        # Dos páginas pueden repetir una orden enviada en el mismo instante que la última de la página anterior
        unicas = {o.id: o for o in todas if (o.client_order_id or '').startswith(prefijo + '-')}
        return list(unicas.values())

    def historial(self, desde: date) -> list[tuple[str, float]]:
        """Valor de la cartera al cierre de cada día desde `desde`, sin contar depósitos ni retiros como ganancia (ver
        `indice`). Sin depósitos ni retiros, es el patrimonio."""
        h = self.cliente.get_portfolio_history(GetPortfolioHistoryRequest(
            timeframe='1D', start=datetime.combine(desde, datetime.min.time(), tzinfo=timezone.utc), cashflow_types=FLUJOS))
        return indice(h.timestamp or [], h.equity or [], h.cashflow or {})

    # --- Órdenes ---------------------------------------------------------------------------------------------

    def _id(self, prefijo: str, motivo: str, simbolo: str) -> str:
        # client_order_id: hasta 48 caracteres y único; con él se reconocen las órdenes propias
        return f'{prefijo}-{motivo}-{datetime.now(timezone.utc):%Y%m%d}-{simbolo}-{uuid.uuid4().hex[:6]}'[:48]

    def comprar(self, simbolo: str, monto: float, prefijo: str, motivo: str, precio_ref: float | None = None):
        """Compra a mercado por un monto en US$. Sin fracciones, compra las acciones enteras que alcancen."""
        operable, fraccionable = self.activo(simbolo)
        if not operable:
            raise ValueError(f'{simbolo} no se puede operar en Alpaca')
        if fraccionable:
            pedido = MarketOrderRequest(symbol=simbolo, notional=math.floor(monto * 100) / 100, side=OrderSide.BUY,
                                        time_in_force=TimeInForce.DAY, client_order_id=self._id(prefijo, motivo, simbolo))
        else:
            acciones = math.floor(monto / precio_ref) if precio_ref else 0
            if acciones < 1:
                raise ValueError(f'{simbolo} no admite fracciones y el monto no alcanza para una acción')
            pedido = MarketOrderRequest(symbol=simbolo, qty=acciones, side=OrderSide.BUY,
                                        time_in_force=TimeInForce.DAY, client_order_id=self._id(prefijo, motivo, simbolo))
        return self.cliente.submit_order(pedido)

    def vender(self, simbolo: str, cantidad: float, prefijo: str, motivo: str):
        """Vende a mercado una cantidad de acciones (nunca más de las que hay: no se venden acciones prestadas)."""
        _, fraccionable = self.activo(simbolo)
        cantidad = round(cantidad, 9) if fraccionable else math.floor(cantidad)
        if cantidad <= 0:
            raise ValueError(f'{simbolo}: nada que vender')
        return self.cliente.submit_order(MarketOrderRequest(
            symbol=simbolo, qty=cantidad, side=OrderSide.SELL, time_in_force=TimeInForce.DAY,
            client_order_id=self._id(prefijo, motivo, simbolo)))

    def cancelar(self, orden_id) -> None:
        self.cliente.cancel_order_by_id(orden_id)

    def esperar(self, ordenes: list, segundos: int = 90) -> list:
        """Espera a que las órdenes se completen. Devuelve su último estado; las que no terminan siguen vivas hasta el cierre."""
        pendientes = {o.id: o for o in ordenes}
        listas = {}
        limite = time.monotonic() + segundos
        while pendientes and time.monotonic() < limite:
            time.sleep(2)
            for oid in list(pendientes):
                o = self.cliente.get_order_by_id(oid)
                if estado(o) in FINALES:
                    del pendientes[oid]
                    listas[oid] = o
        return list(listas.values()) + [self.cliente.get_order_by_id(oid) for oid in pendientes]


def indice(fechas: list[int], patrimonio: list, flujos: dict[str, list]) -> list[tuple[str, float]]:
    """Encadena lo que rindió la cuenta cada día: (patrimonio de hoy − lo depositado hoy) / patrimonio de ayer. Así un
    depósito no aparece como ganancia ni un retiro como pérdida."""
    neto = [0.0] * len(fechas)
    for tipo, montos in flujos.items():
        if len(montos or []) != len(fechas):
            continue
        for k, m in enumerate(montos):
            # Un depósito siempre suma y un retiro siempre resta, venga con el signo que venga
            neto[k] += abs(_num(m)) if tipo == 'CSD' else -abs(_num(m)) if tipo == 'CSW' else _num(m)
    puntos, valor, previo = [], None, None
    for t, e, f in zip(fechas, patrimonio, neto):
        if e is None:
            continue
        e = float(e)
        if valor and previo and previo > 0:
            valor *= (e - f) / previo
        else:
            valor = e   # primer día, o la cuenta estaba vacía: se parte del patrimonio
        previo = e
        # Cada punto diario lleva la medianoche de Nueva York: en UTC sigue siendo el mismo día
        puntos.append((datetime.fromtimestamp(t, tz=timezone.utc).strftime('%Y-%m-%d'), valor))
    return puntos


def inicio_de_mes(hoy: date) -> datetime:
    """Medianoche UTC del primer día del mes (en Nueva York aún es el día anterior, con la bolsa cerrada)."""
    return datetime(hoy.year, hoy.month, 1, tzinfo=timezone.utc)


def hace(dias: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=dias)

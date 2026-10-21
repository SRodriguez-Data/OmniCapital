"""Conexión con Alpaca en modo paper (dinero ficticio).

No existe un modo real: el cliente se crea siempre contra el servidor de paper y se rechaza cualquier cuenta que no
sea de paper, así que este código no puede mover dinero de verdad. Las claves se leen del entorno (.env en local,
secrets en GitHub Actions) y nunca se escriben en los logs.
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


class ErrorConfiguracion(RuntimeError):
    """Faltan claves, están mal puestas o la cuenta no es de paper: no se opera."""


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
    def __init__(self, clave: str | None = None, secreto: str | None = None):
        clave = (clave if clave is not None else os.getenv('ALPACA_API_KEY', '')).strip()
        secreto = (secreto if secreto is not None else os.getenv('ALPACA_SECRET_KEY', '')).strip()
        if not clave or not secreto:
            raise ErrorConfiguracion('Faltan ALPACA_API_KEY y ALPACA_SECRET_KEY (en .env o en los secrets de GitHub).')
        if clave.startswith('http') or secreto.startswith('http'):
            raise ErrorConfiguracion('Una de las claves es una URL: ALPACA_API_KEY lleva el Key ID (empieza con PK) y '
                                     'ALPACA_SECRET_KEY el Secret. La URL no hace falta, el código fija la de paper.')
        if secreto.startswith('PK'):
            raise ErrorConfiguracion('ALPACA_SECRET_KEY tiene el Key ID (PK...): ahí va el Secret, y el Key ID en ALPACA_API_KEY.')
        self.cliente = TradingClient(clave, secreto, paper=True)
        if self.cliente._base_url != BaseURL.TRADING_PAPER:
            raise ErrorConfiguracion(f'El cliente no apunta al servidor de paper ({self.cliente._base_url}).')
        self._activos: dict[str, tuple[bool, bool]] = {}

    # --- Lectura ---------------------------------------------------------------------------------------------

    def cuenta(self) -> Cuenta:
        a = self.cliente.get_account()
        # Las cuentas de paper de Alpaca se numeran PA...; una de dinero real no pasa de aquí
        if not str(a.account_number or '').startswith('PA'):
            raise ErrorConfiguracion('La cuenta no es de paper trading: no se opera.')
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
        """Patrimonio al cierre de cada día desde `desde`."""
        h = self.cliente.get_portfolio_history(GetPortfolioHistoryRequest(
            timeframe='1D', start=datetime.combine(desde, datetime.min.time(), tzinfo=timezone.utc)))
        # Cada punto diario lleva la medianoche de Nueva York: en UTC sigue siendo el mismo día
        return [(datetime.fromtimestamp(t, tz=timezone.utc).strftime('%Y-%m-%d'), float(e))
                for t, e in zip(h.timestamp or [], h.equity or []) if e is not None]

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


def inicio_de_mes(hoy: date) -> datetime:
    """Medianoche UTC del primer día del mes (en Nueva York aún es el día anterior, con la bolsa cerrada)."""
    return datetime(hoy.year, hoy.month, 1, tzinfo=timezone.utc)


def hace(dias: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=dias)

"""Cuenta simulada en la Bolsa de Santiago. Alpaca no opera acciones chilenas, así que el libro de la cuenta
(efectivo, acciones, órdenes y patrimonio de cada día) lo lleva este módulo y se guarda en Supabase con el estado de
la cartera (registro.py). Tiene la misma interfaz que el Broker de Alpaca: la corrida no distingue uno de otro.

Cada orden se llena al instante con la cotización de la bolsa (bolsa_chile.py), como una orden a mercado: se compra
a la mejor punta de venta y se vende a la mejor de compra, y cada operación paga COMISION. Solo acciones enteras.
"""
import math
import uuid
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import bolsa_chile

from .broker import Cuenta, Posicion, Reloj

CAPITAL_INICIAL = 10_000_000   # pesos
COMISION = 0.003               # por operación: lo que cobra un corredor online en Chile (alrededor de 0,25%) más IVA
DESLIZ = 0.002                 # sin una punta confiable, se paga esto sobre el último precio
PUNTA_MAXIMA = 0.02            # una punta más lejos que esto del último precio es de un libro muy delgado: no se usa
APERTURA, CIERRE = time(9, 30), time(16, 0)
SANTIAGO = ZoneInfo(bolsa_chile.ZONA)


def libro_nuevo(ahora: datetime) -> dict:
    return {'capital_inicial': CAPITAL_INICIAL, 'creada': ahora.astimezone(timezone.utc).isoformat(timespec='seconds'),
            'efectivo': float(CAPITAL_INICIAL), 'posiciones': {}, 'ordenes': [], 'historial': []}


def orden(o: dict) -> SimpleNamespace:
    """Una orden del libro con los campos de una orden de Alpaca que usan la corrida y el registro."""
    hora = datetime.fromisoformat(o['hora'])
    return SimpleNamespace(id=o['id'], symbol=o['ticker'], side=o['lado'], status='filled', client_order_id=o['client_order_id'],
                           filled_qty=o['cantidad'], filled_avg_price=o['precio'], notional=None, comision=o['comision'],
                           filled_at=hora, submitted_at=hora, created_at=hora)


def precio_de_ejecucion(c: bolsa_chile.Cotizacion, lado: str) -> float:
    """Compra a la punta de venta y vende a la de compra. Si esa punta falta o está muy lejos del último precio, se
    usa el último precio con un desliz en contra."""
    punta = c.venta if lado == 'compra' else c.compra
    if punta and abs(punta / c.precio - 1) <= PUNTA_MAXIMA:
        return punta
    return c.precio * (1 + DESLIZ if lado == 'compra' else 1 - DESLIZ)


class BrokerSimulado:
    real = False
    moneda = 'CLP'

    def __init__(self, libro: dict | None, cotizar=bolsa_chile.cotizaciones, ahora: datetime | None = None):
        self.ahora = (ahora or datetime.now(timezone.utc)).astimezone(SANTIAGO)
        self.datos = libro or libro_nuevo(self.ahora)
        self.cotizar = cotizar
        self.cot: dict[str, bolsa_chile.Cotizacion] = {}
        self.preparar([bolsa_chile.REFERENCIA, *self.datos['posiciones']])

    # --- Cotizaciones --------------------------------------------------------------------------------------

    def preparar(self, tickers: list[str]) -> None:
        """Pide de una vez las cotizaciones que faltan (una conexión por grupo, no una por acción)."""
        faltan = [t for t in dict.fromkeys(tickers) if t not in self.cot]
        if faltan:
            try:
                self.cot.update(self.cotizar(faltan))
            except Exception:
                pass   # sin feed la bolsa se ve cerrada y la cartera se valora con los últimos precios conocidos

    def _cotizacion(self, simbolo: str) -> bolsa_chile.Cotizacion | None:
        self.preparar([simbolo])
        return self.cot.get(simbolo)

    def _precio(self, simbolo: str) -> float:
        c = self.cot.get(simbolo)
        return c.precio if c else float(self.datos['posiciones'][simbolo].get('precio') or self.datos['posiciones'][simbolo]['costo'])

    # --- Lectura -------------------------------------------------------------------------------------------

    def reloj(self) -> Reloj:
        """Abierta si la bolsa está en sesión y la acción de referencia ya transó hoy (en un feriado no transa)."""
        ref = self.cot.get(bolsa_chile.REFERENCIA)
        hoy = self.ahora.date()
        abierto = bool(ref and ref.en_sesion and ref.hora.date() == hoy)
        apertura = datetime.combine(hoy, APERTURA, tzinfo=SANTIAGO)
        if self.ahora >= apertura or hoy.weekday() >= 5:
            d = hoy + timedelta(days=1)
            while d.weekday() >= 5:
                d += timedelta(days=1)
            apertura = datetime.combine(d, APERTURA, tzinfo=SANTIAGO)
        return Reloj(abierto, self.ahora, apertura, datetime.combine(hoy, CIERRE, tzinfo=SANTIAGO))

    def cuenta(self) -> Cuenta:
        patrimonio = self.datos['efectivo'] + sum(p.valor for p in self.posiciones().values())
        hoy = self.ahora.date().isoformat()
        previos = [v for f, v in self.datos['historial'] if f < hoy]
        return Cuenta(numero='SIM-CL', estado='ACTIVE', patrimonio=patrimonio, patrimonio_ayer=previos[-1] if previos else patrimonio,
                      efectivo=self.datos['efectivo'], bloqueada=False, creada=datetime.fromisoformat(self.datos['creada']))

    def posiciones(self) -> dict[str, Posicion]:
        salida = {}
        for s, p in self.datos['posiciones'].items():
            precio = self._precio(s)
            salida[s] = Posicion(simbolo=s, cantidad=p['cantidad'], valor=p['cantidad'] * precio, costo_promedio=p['costo'],
                                 precio=precio, ganancia_pct=precio / p['costo'] - 1 if p['costo'] else 0.0)
        return salida

    def activo(self, simbolo: str) -> tuple[bool, bool]:
        """(se puede operar, admite fracciones): en Chile solo acciones enteras."""
        return self._cotizacion(simbolo) is not None, False

    def ordenes(self, desde: datetime, prefijo: str, abiertas: bool = False) -> list:
        if abiertas:
            return []   # se llenan al instante
        return [orden(o) for o in self.datos['ordenes']
                if datetime.fromisoformat(o['hora']) >= desde and o['client_order_id'].startswith(prefijo + '-')]

    def historial(self, desde: date) -> list[tuple[str, float]]:
        return [(f, v) for f, v in self.datos['historial'] if f >= desde.isoformat()]

    def libro(self) -> dict:
        """El libro para guardar, con el patrimonio del día del último precio. Antes de la apertura ese día es el
        anterior: así su valor queda con los precios de cierre."""
        ref = self.cot.get(bolsa_chile.REFERENCIA)
        for s, p in self.datos['posiciones'].items():
            p['precio'] = self._precio(s)
        if ref:
            fecha = ref.hora.date().isoformat()
            patrimonio = round(self.datos['efectivo'] + sum(p['cantidad'] * p['precio'] for p in self.datos['posiciones'].values()), 2)
            historial = [h for h in self.datos['historial'] if h[0] != fecha] + [[fecha, patrimonio]]
            self.datos['historial'] = sorted(historial)
        return self.datos

    # --- Órdenes -------------------------------------------------------------------------------------------

    def _registrar(self, simbolo: str, lado: str, cantidad: int, precio: float, comision: float, prefijo: str, motivo: str):
        hora = datetime.now(timezone.utc)
        o = {'id': uuid.uuid4().hex, 'client_order_id': f'{prefijo}-{motivo}-{hora:%Y%m%d}-{simbolo}-{uuid.uuid4().hex[:6]}'[:48],
             'ticker': simbolo, 'lado': 'buy' if lado == 'compra' else 'sell', 'cantidad': cantidad, 'precio': round(precio, 4),
             'comision': round(comision, 2), 'hora': hora.isoformat(timespec='seconds')}
        self.datos['ordenes'].append(o)
        return orden(o)

    def comprar(self, simbolo: str, monto: float, prefijo: str, motivo: str, precio_ref: float | None = None):
        """Compra las acciones enteras que alcanzan con `monto` pesos, comisión incluida."""
        c = self._cotizacion(simbolo)
        if c is None:
            raise ValueError(f'{simbolo} no tiene cotización en la Bolsa de Santiago')
        precio = precio_de_ejecucion(c, 'compra')
        cantidad = math.floor(min(monto, self.datos['efectivo']) / (precio * (1 + COMISION)))
        if cantidad < 1:
            raise ValueError(f'{simbolo}: el monto no alcanza para una acción')
        comision = cantidad * precio * COMISION
        total = cantidad * precio + comision
        p = self.datos['posiciones'].get(simbolo) or {'cantidad': 0, 'costo': 0.0}
        # El costo de cada acción incluye la comisión: es lo que de verdad se pagó
        p = {'cantidad': p['cantidad'] + cantidad, 'costo': (p['cantidad'] * p['costo'] + total) / (p['cantidad'] + cantidad),
             'precio': c.precio}
        self.datos['posiciones'][simbolo] = p
        self.datos['efectivo'] -= total
        return self._registrar(simbolo, 'compra', cantidad, precio, comision, prefijo, motivo)

    def vender(self, simbolo: str, cantidad: float, prefijo: str, motivo: str):
        p = self.datos['posiciones'].get(simbolo)
        cantidad = min(math.floor(cantidad), p['cantidad'] if p else 0)
        if cantidad <= 0:
            raise ValueError(f'{simbolo}: nada que vender')
        c = self._cotizacion(simbolo)
        if c is None:
            raise ValueError(f'{simbolo} no tiene cotización en la Bolsa de Santiago')
        precio = precio_de_ejecucion(c, 'venta')
        comision = cantidad * precio * COMISION
        self.datos['efectivo'] += cantidad * precio - comision
        if cantidad >= p['cantidad']:
            del self.datos['posiciones'][simbolo]
        else:
            p['cantidad'] -= cantidad
        return self._registrar(simbolo, 'venta', cantidad, precio, comision, prefijo, motivo)

    def cancelar(self, orden_id) -> None:
        pass

    def esperar(self, ordenes: list, segundos: int = 90) -> list:
        return ordenes

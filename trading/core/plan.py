"""De la cartera objetivo (peso por acción) a las órdenes: qué vender y qué comprar para llegar a ella.

Funciones puras, sin llamadas a la API: se prueban en trading/tests.
"""
import math
from dataclasses import dataclass
from typing import Callable

from .broker import Posicion


@dataclass
class Orden:
    simbolo: str
    lado: str                 # 'compra' o 'venta'
    monto: float              # US$ aproximados
    motivo: str               # 'reb' (rebalanceo) o 'stop'; va en el client_order_id
    cantidad: float = 0.0     # ventas: acciones exactas a vender
    detalle: str = ''         # explicación para el registro


def planificar(pesos: dict[str, float], posiciones: dict[str, Posicion], patrimonio: float, banda: float = 0.005,
               fraccionable: Callable[[str], bool] = lambda s: True) -> list[Orden]:
    """Órdenes para llevar la cartera a `pesos` (fracción del patrimonio por símbolo). Una diferencia menor a `banda`
    del patrimonio no se opera: moverla costaría más de lo que cambia. Primero las ventas, después las compras."""
    ventas, compras = [], []
    for s, p in posiciones.items():
        if s not in pesos:
            ventas.append(Orden(s, 'venta', p.valor, 'reb', cantidad=p.cantidad, detalle='salió de la lista'))
            continue
        exceso = p.valor - pesos[s] * patrimonio
        if exceso > banda * patrimonio and p.precio > 0:
            cantidad = exceso / p.precio
            cantidad = math.floor(cantidad * 1e6) / 1e6 if fraccionable(s) else math.floor(cantidad)
            if cantidad > 0:
                ventas.append(Orden(s, 'venta', cantidad * p.precio, 'reb', cantidad=min(cantidad, p.cantidad),
                                    detalle='subió sobre su peso objetivo'))
    for s, w in pesos.items():
        actual = posiciones[s].valor if s in posiciones else 0.0
        falta = w * patrimonio - actual
        if falta > banda * patrimonio:
            compras.append(Orden(s, 'compra', falta, 'reb', detalle='entró a la lista' if s not in posiciones else 'bajo su peso objetivo'))
    return ventas + compras

"""Control de riesgo. Se aplica a toda orden antes de enviarla, sea cual sea la estrategia.

- Ninguna acción pasa de `peso_maximo` del patrimonio (en Chile la lista es de 5 acciones: cada una pesa 20%).
- Freno diario: si el patrimonio cae `perdida_diaria_maxima` frente al cierre anterior, ese día no se compra nada.
- Stop loss: una acción que cae `stop_loss` bajo su costo promedio se vende. Es un freno para catástrofes, no parte
  del método medido, por eso está lejos.
- Sin margen ni ventas en corto: las compras no gastan más que el efectivo disponible y las ventas no superan las
  acciones que hay.
"""
from dataclasses import dataclass, replace

from .broker import Cuenta, Posicion
from .plan import Orden


@dataclass(frozen=True)
class Limites:
    peso_maximo: float = 0.06
    perdida_diaria_maxima: float = 0.03
    stop_loss: float = 0.30
    orden_minima: float = 1.0        # Alpaca no acepta órdenes de menos de US$1
    reserva_efectivo: float = 0.005  # queda en caja para que una compra a mercado no falle por centavos
    max_ordenes: int = 60            # más que eso en una corrida es señal de un error, no de un rebalanceo


# La cuenta simulada de la Bolsa de Santiago: 5 acciones de 20% y montos en pesos
LIMITES_CHILE = Limites(peso_maximo=0.21, orden_minima=10_000)


def bloqueo(cuenta: Cuenta) -> str | None:
    if cuenta.bloqueada:
        return f'Alpaca tiene la cuenta bloqueada para operar (estado {cuenta.estado}).'
    if cuenta.patrimonio <= 0:
        return 'La cuenta no tiene patrimonio.'
    return None


def freno_diario(cuenta: Cuenta, limites: Limites) -> str | None:
    if cuenta.patrimonio_ayer <= 0:
        return None
    cambio = cuenta.patrimonio / cuenta.patrimonio_ayer - 1
    if cambio <= -limites.perdida_diaria_maxima:
        return (f'Freno diario: el patrimonio cae {cambio:.1%} frente al cierre anterior (límite '
                f'-{limites.perdida_diaria_maxima:.0%}). Hoy no se compra; solo se ejecutan los stops.')
    return None


def stops(posiciones: dict[str, Posicion], limites: Limites) -> list[Orden]:
    return [Orden(s, 'venta', p.valor, 'stop', cantidad=p.cantidad,
                  detalle=f'cayó {p.ganancia_pct:.1%} bajo su costo (stop en -{limites.stop_loss:.0%})')
            for s, p in posiciones.items() if p.ganancia_pct <= -limites.stop_loss]


def limitar_pesos(pesos: dict[str, float], limites: Limites) -> dict[str, float]:
    """Ninguna acción sobre el peso máximo; lo que sobra queda en efectivo, no se reparte."""
    return {s: min(w, limites.peso_maximo) for s, w in pesos.items() if w > 0}


def ajustar_ventas(ventas: list[Orden], posiciones: dict[str, Posicion]) -> list[Orden]:
    """Nunca vender más acciones de las que hay, ni dos veces la misma (un stop ya cubre la venta total)."""
    vistas, salida = set(), []
    for o in ventas:
        p = posiciones.get(o.simbolo)
        if p is None or o.simbolo in vistas:
            continue
        cantidad = min(o.cantidad, p.cantidad)
        if cantidad > 0:
            vistas.add(o.simbolo)
            salida.append(replace(o, cantidad=cantidad))
    return salida


def ajustar_compras(compras: list[Orden], efectivo: float, patrimonio: float, posiciones: dict[str, Posicion],
                    limites: Limites) -> list[Orden]:
    """Recorta cada compra al peso máximo y el total al efectivo disponible (sin margen). Descarta montos ínfimos."""
    recortadas = []
    for o in compras:
        actual = posiciones[o.simbolo].valor if o.simbolo in posiciones else 0.0
        recortadas.append(replace(o, monto=max(0.0, min(o.monto, limites.peso_maximo * patrimonio - actual))))
    disponible = max(0.0, efectivo - limites.reserva_efectivo * patrimonio)
    total = sum(o.monto for o in recortadas)
    escala = min(1.0, disponible / total) if total > 0 else 0.0
    return [replace(o, monto=o.monto * escala) for o in recortadas if o.monto * escala >= limites.orden_minima]

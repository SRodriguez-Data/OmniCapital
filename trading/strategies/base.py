"""Interfaz de las estrategias: cada una solo dice qué cartera quiere tener. Cuándo operar, el control de riesgo y el
envío de órdenes son comunes (trading/main.py)."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date

METODO = 'v2'
# Entre rebalanceos, una acción que sale de la lista se mantiene mientras siga entre las primeras MARGEN × N del
# ranking: un cambio menor de puesto no obliga a vender hoy y volver a comprar mañana
MARGEN = 1.5


@dataclass
class Objetivo:
    pesos: dict[str, float]                  # fracción del patrimonio por símbolo, en el orden del ranking
    descripcion: str                         # de dónde sale la lista, para el registro
    problema: str | None = None              # si hay uno, no se compra ni se vende por la lista (los stops siguen)
    precios: dict[str, float] = field(default_factory=dict)  # precio de referencia (acciones sin fracciones)
    mantener: set[str] = field(default_factory=set)          # las que se pueden mantener entre rebalanceos


class Estrategia(ABC):
    nombre: str    # prefijo de sus órdenes (client_order_id), letras y números
    titulo: str

    @abstractmethod
    def objetivo(self, hoy: date) -> Objetivo:
        ...


def ultimo_escaneo(supabase, campos: str, hoy: date, dias_maximos: int) -> tuple[dict | None, str]:
    """El último escaneo del Top (analisis_ia) con `campos` de candidatos_json, si es del método actual y con precios
    de hace no más de `dias_maximos` días. Devuelve (fila, problema); sin problema, la fila trae 'precios_del'."""
    filas = (supabase.table('analisis_ia')
             .select(f'fecha, metodo:candidatos_json->metodo, fp:candidatos_json->fecha_precios, {campos}')
             .order('fecha', desc=True).limit(1).execute().data or [])
    if not filas:
        return None, 'No hay ningún escaneo del Top guardado.'
    f = filas[0]
    if f.get('metodo') != METODO:
        return None, f'El último escaneo es del método {f.get("metodo")!r}, no del {METODO}.'
    precios_del = (f.get('fp') or f['fecha'])[:10]
    antiguedad = (hoy - date.fromisoformat(precios_del)).days
    if antiguedad > dias_maximos:
        return None, f'El último escaneo usa precios del {precios_del} ({antiguedad} días): se espera uno al día.'
    return {**f, 'precios_del': precios_del}, ''

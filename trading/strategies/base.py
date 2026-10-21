"""Interfaz de las estrategias: cada una solo dice qué cartera quiere tener. Cuándo rebalancear, el control de
riesgo y el envío de órdenes son comunes (trading/main.py)."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date


@dataclass
class Objetivo:
    pesos: dict[str, float]                  # fracción del patrimonio por símbolo de Alpaca
    descripcion: str                         # de dónde sale la lista, para el registro
    problema: str | None = None              # si hay uno, no se rebalancea y se mantiene la cartera actual
    precios: dict[str, float] = field(default_factory=dict)  # precio de referencia (acciones sin fracciones)


class Estrategia(ABC):
    nombre: str    # prefijo de sus órdenes en Alpaca (client_order_id), letras y números
    titulo: str

    @abstractmethod
    def objetivo(self, hoy: date) -> Objetivo:
        ...

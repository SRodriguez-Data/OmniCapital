"""Top v2 de EE.UU.: las acciones del S&P 500 con la utilidad más respaldada por caja de su sector, a partes iguales.

Es el único método que, medido en 10 años sin mirar el futuro, le ganó al mercado con evidencia sólida
(evidencia.py, METODOS['calidad_eeuu']). La lista la elige cada día el bot (quantum_trader_serverless.py) y queda en
analisis_ia; aquí solo se lee, para que la simulación opere exactamente lo que muestra la web.
"""
from datetime import date

from .base import Estrategia, Objetivo

METODO = 'v2'


def simbolo_alpaca(ticker: str) -> str:
    # Yahoo escribe BRK-B; Alpaca, BRK.B
    return ticker.replace('-', '.')


class TopCalidad(Estrategia):
    nombre = 'topv2'
    titulo = 'Top v2 EE.UU.: utilidad respaldada por caja, a partes iguales'

    def __init__(self, supabase, minimo_ideas: int = 15, dias_maximos: int = 5):
        self.supabase = supabase
        self.minimo_ideas = minimo_ideas
        self.dias_maximos = dias_maximos

    def objetivo(self, hoy: date) -> Objetivo:
        filas = (self.supabase.table('analisis_ia')
                 .select('fecha, metodo:candidatos_json->metodo, fp:candidatos_json->fecha_precios, us:candidatos_json->us')
                 .order('fecha', desc=True).limit(1).execute().data or [])
        if not filas:
            return Objetivo({}, '', problema='No hay ningún escaneo del Top guardado.')
        f = filas[0]
        if f.get('metodo') != METODO:
            return Objetivo({}, '', problema=f'El último escaneo es del método {f.get("metodo")!r}, no del {METODO}.')
        precios_del = (f.get('fp') or f['fecha'])[:10]
        antiguedad = (hoy - date.fromisoformat(precios_del)).days
        if antiguedad > self.dias_maximos:
            return Objetivo({}, '', problema=f'El último escaneo usa precios del {precios_del} ({antiguedad} días): '
                                               'se espera uno al día antes de rebalancear.')
        ideas = f.get('us') or []
        if len(ideas) < self.minimo_ideas:
            return Objetivo({}, '', problema=f'El escaneo trae {len(ideas)} ideas de EE.UU. (mínimo {self.minimo_ideas}).')
        simbolos = [simbolo_alpaca(c['ticker']) for c in ideas]
        return Objetivo(
            pesos={s: 1 / len(simbolos) for s in simbolos},
            descripcion=f'{len(simbolos)} ideas del escaneo con precios del {precios_del}',
            precios={simbolo_alpaca(c['ticker']): float(c['price']) for c in ideas if c.get('price')},
        )

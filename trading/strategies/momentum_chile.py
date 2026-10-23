"""Top v2 de Chile: las acciones chilenas con mayor alza de los últimos 12 meses sin el último (con dividendos), a
partes iguales. Es el método momentum_chile de evidencia.py. Como en EE.UU., la lista la elige el bot cada día y aquí
solo se lee; se opera en la cuenta simulada de la Bolsa de Santiago (core/simulado.py)."""
from datetime import date

from .base import MARGEN, Estrategia, Objetivo, ultimo_escaneo


class MomentumChile(Estrategia):
    nombre = 'topcl'
    titulo = 'Top v2 Chile: mayor alza de 12 meses (sin el último mes), a partes iguales'

    def __init__(self, supabase, minimo_ideas: int = 3, dias_maximos: int = 5):
        self.supabase = supabase
        self.minimo_ideas = minimo_ideas
        self.dias_maximos = dias_maximos

    def objetivo(self, hoy: date) -> Objetivo:
        f, problema = ultimo_escaneo(self.supabase, 'cl:candidatos_json->cl, ranking:candidatos_json->ranking_cl',
                                     hoy, self.dias_maximos)
        if problema:
            return Objetivo({}, '', problema=problema)
        ideas = f.get('cl') or []
        if len(ideas) < self.minimo_ideas:
            return Objetivo({}, '', problema=f'El escaneo trae {len(ideas)} ideas de Chile (mínimo {self.minimo_ideas}).')
        tickers = [c['ticker'] for c in ideas]
        ranking = [r['ticker'] for r in (f.get('ranking') or [])] or tickers
        return Objetivo(
            pesos={t: 1 / len(tickers) for t in tickers},
            descripcion=f'{len(tickers)} ideas del escaneo con precios del {f["precios_del"]}',
            precios={c['ticker']: float(c['price']) for c in ideas if c.get('price')},
            mantener=set(tickers) | set(ranking[:int(len(tickers) * MARGEN)]),
        )

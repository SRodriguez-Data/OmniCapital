"""Top v2 de EE.UU.: las acciones del S&P 500 con la utilidad más respaldada por caja de su sector, con el peso que
el escaneo le da a cada una (la ponderación que mejor midió el laboratorio, cartera.py).

Es el único método que, medido en 10 años sin mirar el futuro, le ganó al mercado con evidencia sólida
(evidencia.py, METODOS['calidad_eeuu']). La lista la elige cada día el bot (quantum_trader_serverless.py) y queda en
analisis_ia; aquí solo se lee, para que la simulación opere exactamente lo que muestra la web.
"""
from datetime import date

from .base import MARGEN, Estrategia, Objetivo, pesos_de, ultimo_escaneo


def simbolo_alpaca(ticker: str) -> str:
    # Yahoo escribe BRK-B; Alpaca, BRK.B
    return ticker.replace('-', '.')


class TopCalidad(Estrategia):
    nombre = 'topv2'
    titulo = 'Top v2 EE.UU.: utilidad respaldada por caja'

    def __init__(self, supabase, minimo_ideas: int = 15, dias_maximos: int = 5):
        self.supabase = supabase
        self.minimo_ideas = minimo_ideas
        self.dias_maximos = dias_maximos

    def objetivo(self, hoy: date) -> Objetivo:
        f, problema = ultimo_escaneo(self.supabase, 'us:candidatos_json->us, calidad:candidatos_json->calidad_us, '
                                     'sin:candidatos_json->sin_evidencia', hoy, self.dias_maximos)
        if problema:
            return Objetivo({}, '', problema=problema)
        if motivo := (f.get('sin') or {}).get('us'):
            return Objetivo({}, f'el método perdió su evidencia significativa ({motivo})')
        ideas = f.get('us') or []
        if len(ideas) < self.minimo_ideas:
            return Objetivo({}, '', problema=f'El escaneo trae {len(ideas)} ideas de EE.UU. (mínimo {self.minimo_ideas}).')
        simbolos = [simbolo_alpaca(c['ticker']) for c in ideas]
        # El ranking completo es el de la calidad de todas las evaluadas, con el mismo orden con que el bot elige
        tabla = f.get('calidad') or {}
        ranking = sorted((t for t, x in tabla.items() if not x.get('pa')), key=lambda t: (-tabla[t]['p'], -tabla[t]['c']))
        return Objetivo(
            pesos=pesos_de(ideas, simbolo_alpaca),
            descripcion=f'{len(simbolos)} ideas del escaneo con precios del {f["precios_del"]}',
            precios={simbolo_alpaca(c['ticker']): float(c['price']) for c in ideas if c.get('price')},
            mantener=set(simbolos) | {simbolo_alpaca(t) for t in ranking[:int(len(simbolos) * MARGEN)]},
        )

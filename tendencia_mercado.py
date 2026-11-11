"""Semáforo de mercado: cuánto protegió, en décadas de historia, salir del índice cuando cae bajo su tendencia.

La regla (la misma que muestra la web en lib/semaforo.ts): un índice pasa a rojo cuando cierra más de 2% bajo su media
de 200 días y vuelve a verde cuando cierra más de 2% sobre ella; la banda evita entrar y salir por ruido. Rojo = fuera
del índice (en letras del Tesoro de EE.UU.), verde = dentro. Se opera al cierre del día siguiente a la señal, como
haría alguien que recibe el aviso en la mañana.

Se compara con quedarse siempre invertido: rentabilidad anual, peor caída, peor año, Sharpe y cuántas veces al año
cambia. Y, para no elegir parámetros a la medida de la historia, se repite con medias de 150, 200 y 250 días y bandas
de 0% a 3%: la regla vale si la protección aparece en todas las variantes y en cada mitad de la historia.

Datos gratuitos y sus límites: S&P 500 con dividendos (^SP500TR, desde 1988); Nasdaq-100 (^NDX, desde 1985) e IPSA
(Bolsa de Santiago, desde 1994) sin dividendos, por lo que se suma un dividendo aproximado (0,7% y 3% anual). La caja
del IPSA usa la tasa del Tesoro de EE.UU., menor que la chilena: eso juega en contra de la regla.

Uso: python tendencia_mercado.py [--web web/src/data]
"""
import argparse
import json
import logging
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

import bolsa_chile

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MEDIA, BANDA = 200, 0.02
INDICES = {
    "eeuu": {"nombre": "S&P 500", "fuente": "^SP500TR", "desde": "1988-01-01", "dividendo": 0.0,
             "detalle": "S&P 500 con dividendos"},
    "tecnologia": {"nombre": "Nasdaq-100", "fuente": "^NDX", "desde": "1985-01-01", "dividendo": 0.007,
                   "detalle": "Nasdaq-100 más un dividendo aproximado de 0,7% anual"},
    "chile": {"nombre": "IPSA", "fuente": "SP_IPSA.SN", "desde": None, "dividendo": 0.03,
              "detalle": "IPSA de la Bolsa de Santiago más un dividendo aproximado de 3% anual"},
}


def yahoo(ticker: str, desde: str) -> pd.Series:
    df = yf.download(ticker, start=desde, auto_adjust=True, progress=False)
    s = df["Close"].squeeze().dropna()
    s.index = pd.to_datetime(s.index).tz_localize(None)
    return s


def ipsa() -> pd.Series:
    datos = bolsa_chile.diarias(["SP_IPSA.SN"], barras=9000, ajuste="splits")
    if not datos:
        raise RuntimeError("La Bolsa de Santiago no entregó el IPSA.")
    df = next(iter(datos.values()))
    return df.set_index(pd.to_datetime(df["date"]))["close"].astype(float)


def dentro(p: pd.Series, media: int, banda: float) -> pd.Series:
    """1 = verde (invertido), 0 = rojo, con la banda de entrada y salida. Antes de tener la media, invertido."""
    sma = p.rolling(media).mean().to_numpy()
    estado, salida = 1, []
    for x, m in zip(p.to_numpy(), sma):
        if not np.isnan(m):
            if estado and x < (1 - banda) * m:
                estado = 0
            elif not estado and x > (1 + banda) * m:
                estado = 1
        salida.append(estado)
    return pd.Series(salida, index=p.index, dtype=float)


def metricas(r: pd.Series, tasa: pd.Series) -> dict:
    """`tasa`: retorno diario de la caja. El Sharpe se mide sobre ella: si no, el tiempo que la regla pasa en caja
    contaría como rentabilidad sin riesgo y la haría ver mejor de lo que es."""
    valor = (1 + r).cumprod()
    anios = len(r) / 252
    anual = (1 + r).groupby(r.index.year).prod() - 1
    vol = r.std() * np.sqrt(252)
    return {"retorno_anual": round(float(valor.iloc[-1] ** (1 / anios) - 1), 4),
            "peor_caida": round(float((valor / valor.cummax() - 1).min()), 4),
            "peor_anio": round(float(anual.min()), 4),
            "sharpe": round(float((r - tasa.reindex(r.index).fillna(0)).mean() * 252 / vol), 2) if vol else None}


def medir(p: pd.Series, dividendo: float, caja: pd.Series, media: int = MEDIA, banda: float = BANDA) -> dict:
    r = p.pct_change().fillna(0) + dividendo / 252
    tasa = caja.reindex(p.index).ffill().fillna(0) / 252
    # Señal con el cierre de hoy, orden con el cierre de mañana: el retorno de pasado mañana ya es con la decisión
    w = dentro(p, media, banda).shift(2).fillna(1)
    inicio = p.index[media]
    regla, mantener, w = (w * r + (1 - w) * tasa)[inicio:], r[inicio:], w[inicio:]
    mitad = regla.index[len(regla) // 2]
    tramo = lambda a, b: {"desde": f"{a.index[0]:%Y-%m-%d}", "hasta": f"{a.index[-1]:%Y-%m-%d}",
                          "mantener": metricas(b, tasa), "regla": metricas(a, tasa)}
    return {
        "desde": f"{regla.index[0]:%Y-%m-%d}", "hasta": f"{regla.index[-1]:%Y-%m-%d}",
        "mantener": metricas(mantener, tasa), "regla": metricas(regla, tasa),
        "cambios_por_anio": round(float((w.diff().abs() > 0).sum() / (len(w) / 252)), 1),
        "tiempo_invertido": round(float(w.mean()), 3),
        "mitades": [tramo(regla[:mitad], mantener[:mitad]), tramo(regla[mitad:], mantener[mitad:])],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", help="Carpeta donde escribir evidencia_mercado.json")
    args = ap.parse_args()
    caja = yahoo("^IRX", "1960-01-01") / 100  # letras del Tesoro a 13 semanas, tasa anual
    salida = {"calculado": datetime.now(timezone.utc).isoformat(), "media": MEDIA, "banda": BANDA, "indices": {}}
    for clave, d in INDICES.items():
        p = ipsa() if clave == "chile" else yahoo(d["fuente"], d["desde"])
        res = medir(p, d["dividendo"], caja)
        # Robustez: ¿la protección aparece con otras medias y bandas, y en cada mitad?
        variantes = [medir(p, d["dividendo"], caja, m, b) for m in (150, 200, 250) for b in (0, 0.01, 0.02, 0.03)]
        protege = sum(all(t["regla"]["peor_caida"] > t["mantener"]["peor_caida"] for t in v["mitades"]) for v in variantes)
        costo = [v["regla"]["retorno_anual"] - v["mantener"]["retorno_anual"] for v in variantes]
        salida["indices"][clave] = {"nombre": d["nombre"], "detalle": d["detalle"], **res,
                                    "variantes": {"probadas": len(variantes), "protegen_en_ambas_mitades": protege,
                                                  "diferencia_retorno_min": round(min(costo), 4),
                                                  "diferencia_retorno_max": round(max(costo), 4)}}
        m, g = res["mantener"], res["regla"]
        logging.info(f"{d['nombre']}: siempre invertido {m['retorno_anual']:.1%}/año, peor caída {m['peor_caida']:.0%}; "
                     f"con la regla {g['retorno_anual']:.1%}/año, peor caída {g['peor_caida']:.0%} "
                     f"({res['cambios_por_anio']} cambios al año; protege en {protege}/{len(variantes)} variantes)")
    destino = os.path.join(args.web, "evidencia_mercado.json") if args.web else "evidencia_mercado.json"
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    logging.info(f"Guardado en {destino}")


if __name__ == "__main__":
    main()

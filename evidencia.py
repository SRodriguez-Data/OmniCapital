"""Laboratorio de evidencia del asesor.

Mide, con 10 años de precios de todo el universo (S&P 500, Nasdaq-100 e IPSA), cuánto anticipó cada señal del
asesor el retorno de los meses siguientes frente al promedio de su propio mercado. Una recomendación solo puede
apoyarse en una señal con evidencia, y con la fuerza que esa evidencia permite: así el asesor dice lo que sabe y
qué tan seguro está, en vez de opinar.

Cómo se mide: el último día hábil de cada mes se calcula cada señal para cada acción con los precios disponibles
ese día (nada del futuro) y se compara con su retorno a 1, 3 y 6 meses, descontado el promedio de su mercado
(EE.UU. o Chile) en el mismo período. Precios ajustados por dividendos y splits.

Sesgos que no se pueden quitar con datos gratis, y que el informe declara:
- Supervivencia: el universo es la lista de HOY. Las empresas que quebraron o salieron del índice no están, lo que
  favorece a las señales que compran caídas (las que siguieron cayendo y salieron no cuentan).
- Fundamentales: Yahoo solo entrega los actuales, no los de cada fecha pasada; aquí solo se miden señales de
  precio. Valor y calidad se apoyan en la evidencia académica publicada.

Uso: python evidencia.py [--cache archivo.pkl] [--salida archivo.json]
"""
import argparse
import json
import logging
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from scipy.stats import spearmanr

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

HORIZONTES = {"1m": 21, "3m": 63, "6m": 126}
LOTE = 100


def universo() -> list[str]:
    """Los activos que sigue el minero: los que tienen precio guardado en los últimos días."""
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
    ultima = sb.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute().data[0]["date"]
    desde = (pd.Timestamp(ultima) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    tickers, inicio = set(), 0
    while True:
        lote = (sb.table("precios_historicos").select("ticker").gte("date", desde)
                .order("ticker").range(inicio, inicio + 999).execute().data or [])
        tickers |= {r["ticker"] for r in lote}
        if len(lote) < 1000:
            break
        inicio += 1000
    # Índices y monedas son referencias, no acciones que se puedan elegir
    return sorted(t for t in tickers if not t.startswith("^") and "=" not in t)


def descargar(tickers: list[str]) -> pd.DataFrame:
    """Cierres diarios ajustados de 10 años (fechas x tickers)."""
    columnas = []
    for i in range(0, len(tickers), LOTE):
        lote = tickers[i:i + LOTE]
        df = yf.download(lote, period="10y", interval="1d", auto_adjust=True, group_by="ticker",
                         threads=True, progress=False)
        for t in lote:
            if t in df.columns.get_level_values(0):
                columnas.append(df[t]["Close"].rename(t))
        logging.info(f"Descargados {min(i + LOTE, len(tickers))}/{len(tickers)}")
    precios = pd.concat(columnas, axis=1)
    precios.index = pd.to_datetime(precios.index).tz_localize(None)
    return precios.sort_index()


def rsi_wilder(p: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    d = p.diff()
    sube = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    baja = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + sube / baja)


def senales(p: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Cada señal con el signo del asesor: más alto = más atractiva según la regla que la usa."""
    ret = p.pct_change(fill_method=None)
    sma200 = p.rolling(200, min_periods=200).mean()
    ema200 = p.ewm(span=200, adjust=False, min_periods=200).mean()
    rsi = rsi_wilder(p)
    sma20, std20 = p.rolling(20).mean(), p.rolling(20).std()
    # Stop de volatilidad del asesor (lib/quant.ts volatilityStop): máximo de 22 cierres menos 2 desviaciones
    # mensuales (entre 5% y 35%), roto con dos cierres seguidos bajo él
    caida = (2 * ret.rolling(126).std() * np.sqrt(21)).clip(0.05, 0.35)
    stop = p.rolling(22).max() * (1 - caida)
    tendencia = p / sma200 - 1
    momentum = p.shift(21) / p.shift(252) - 1
    # Veredicto técnico del asesor (lib/advisor.ts pilarTecnico): un voto por tendencia y uno por momentum
    votos = ((tendencia > 0.03).astype(int) - (tendencia < -0.03).astype(int)
             + (momentum > 0.05).astype(int) - (momentum < -0.05).astype(int)).where(tendencia.notna() & momentum.notna())
    stop_roto = (p < stop) & (p.shift(1) < stop)
    return {
        "precio": p,
        "momentum_12_1": momentum,
        "tendencia_sma200": tendencia,
        "votos_tecnicos": votos,
        "stop_roto": stop_roto,
        "dist_ema200": p / ema200 - 1,
        "rsi14": rsi,
        "retorno_1m": p / p.shift(21) - 1,
        "volatilidad_3m": ret.rolling(63).std() * np.sqrt(252),
        "distancia_maximo_52s": p / p.rolling(252).max() - 1,
        "bajo_bollinger": p < sma20 - 2 * std20,
        # Yahoo repite el mismo cierre por semanas en varias acciones chilenas: esos tramos no sirven
        "congelado": (ret == 0).astype(float).rolling(20).sum() > 8,
    }


# Señales continuas tal como las usa el asesor; el signo hace que "más alto" sea "más atractiva"
FACTORES = {
    "momentum_12_1": ("Momentum 12-1 meses", lambda s: s["momentum_12_1"]),
    "tendencia_sma200": ("Distancia a la media de 200 días", lambda s: s["tendencia_sma200"]),
    "rsi_bajo": ("RSI bajo (sobreventa)", lambda s: -s["rsi14"]),
    "reversion_1m": ("Caída del último mes (reversión)", lambda s: -s["retorno_1m"]),
    "baja_volatilidad": ("Baja volatilidad", lambda s: -s["volatilidad_3m"]),
    "cerca_maximo_52s": ("Cerca de su máximo de 52 semanas", lambda s: s["distancia_maximo_52s"]),
    "score_top5": ("Puntaje del Top 5 del bot", lambda s: (50 - s["rsi14"]) + s["dist_ema200"] * 100),
}

# Reglas discretas del asesor (lib/advisor.ts) y del bot del Top 5 (quantum_trader_serverless.py)
REGLAS = {
    "tendencia_alcista": ("Más de 3% sobre su media de 200 días", lambda s: s["tendencia_sma200"] > 0.03),
    "tendencia_bajista": ("Más de 3% bajo su media de 200 días", lambda s: s["tendencia_sma200"] < -0.03),
    "momentum_positivo": ("Momentum 12-1 mayor a 5%", lambda s: s["momentum_12_1"] > 0.05),
    "momentum_negativo": ("Momentum 12-1 menor a -5%", lambda s: s["momentum_12_1"] < -0.05),
    "veredicto_alcista": ("Veredicto técnico del asesor: alcista",
                          lambda s: (s["votos_tecnicos"] >= 1) & ~s["stop_roto"]),
    "veredicto_bajista": ("Veredicto técnico del asesor: bajista",
                          lambda s: (s["votos_tecnicos"] <= -1) & ~s["stop_roto"]),
    "stop_roto": ("Dos cierres seguidos bajo el stop de volatilidad", lambda s: s["stop_roto"]),
    "rsi70": ("RSI sobre 70 (sobrecomprada)", lambda s: s["rsi14"] > 70),
    "rsi30_alcista": ("RSI bajo 30 en tendencia alcista", lambda s: (s["rsi14"] < 30) & (s["tendencia_sma200"] > 0.03)),
    "rsi30_bajista": ("RSI bajo 30 en tendencia bajista", lambda s: (s["rsi14"] < 30) & (s["tendencia_sma200"] < -0.03)),
    "estirado": ("Más de 25% sobre su media de 200 días", lambda s: s["tendencia_sma200"] > 0.25),
    "bajo_bollinger": ("Bajo su banda inferior de Bollinger", lambda s: s["bajo_bollinger"]),
    "filtro_top5": ("Filtro del bot: RSI bajo 50 y a menos de 20% bajo la EMA200",
                    lambda s: (s["rsi14"] < 50) & (s["dist_ema200"] > -0.2)),
}


def fechas_mensuales(indice: pd.DatetimeIndex, margen: int) -> list[pd.Timestamp]:
    """Último día hábil de cada mes con un año de historia detrás y `margen` días de futuro conocido."""
    fin_mes = pd.Series(indice, index=indice).groupby(indice.to_period("M")).max()
    validas = indice[252:len(indice) - margen]
    return [f for f in fin_mes if f in validas]


def t_ajustado(serie: pd.Series, h: int) -> float:
    """t de la media de una serie mensual. Con horizontes de 3 o 6 meses las observaciones se traslapan: se
    divide por la raíz del traslape para no sobreestimar la confianza."""
    serie = serie.dropna()
    if len(serie) < 12 or serie.std() == 0:
        return float("nan")
    return float(serie.mean() / serie.std() * np.sqrt(len(serie)) / np.sqrt(max(h / 21, 1)))


def r(x, d=4):
    return None if x is None or not np.isfinite(x) else round(float(x), d)


def calendario(precios: pd.DataFrame) -> pd.DataFrame:
    """Los días en que operó ese mercado (la mayoría de sus acciones tiene cierre). Las dos bolsas tienen
    feriados distintos: mezclarlas deja huecos que vacían las medias móviles. Los huecos sueltos de una acción
    (hasta 5 días) se rellenan con su último cierre."""
    con_datos = precios.notna().sum(axis=1)
    return precios[con_datos >= 0.5 * con_datos.max()].ffill(limit=5)


def evaluar(crudos: pd.DataFrame) -> dict:
    mercados = {"EE.UU.": [t for t in crudos.columns if not t.endswith(".SN")],
                "Chile": [t for t in crudos.columns if t.endswith(".SN")]}
    salida = {"base": {}, "factores": {}, "reglas": {}, "top5": {}, "muestra": {}}

    for mercado, cols in mercados.items():
        precios = calendario(crudos[cols])
        s = senales(precios)
        fwd = {h: precios.shift(-n) / precios - 1 for h, n in HORIZONTES.items()}
        fechas = fechas_mensuales(precios.index, max(HORIZONTES.values()))
        valido = (~s["congelado"][cols]) & precios[cols].notna()
        exceso = {}
        for h, n in HORIZONTES.items():
            futuro_ok = valido & (~s["congelado"][cols].shift(-n).fillna(True).astype(bool))
            f = fwd[h][cols].where(futuro_ok)
            exceso[h] = f.sub(f.mean(axis=1), axis=0)

        # Lo normal: una acción cualquiera supera al promedio de su mercado menos de la mitad de las veces, porque
        # unas pocas que suben mucho tiran el promedio hacia arriba. Cada regla se compara con esta base, no con 50%
        salida["base"][mercado] = {}
        for h in HORIZONTES:
            todas = exceso[h].loc[fechas].stack().dropna()
            salida["base"][mercado][h] = {"acierto": r((todas > 0).mean(), 3), "mediana": r(todas.median()),
                                          "casos": int(len(todas))}

        for clave, (nombre, fn) in FACTORES.items():
            x = fn(s)[cols].where(valido)
            res = {}
            for h, n in HORIZONTES.items():
                ics, q5, q1, acierto = [], [], [], []
                for d in fechas:
                    a, b = x.loc[d], exceso[h].loc[d]
                    ok = a.notna() & b.notna()
                    if ok.sum() < 10:
                        continue
                    a, b = a[ok], b[ok]
                    ics.append(spearmanr(a, b)[0])
                    corte_alto, corte_bajo = a.quantile(0.8), a.quantile(0.2)
                    alto, bajo = b[a >= corte_alto], b[a <= corte_bajo]
                    q5.append(alto.mean()); q1.append(bajo.mean()); acierto.append((alto > 0).mean())
                if not ics:
                    continue
                spread = pd.Series(q5) - pd.Series(q1)
                res[h] = {"ic": r(np.nanmean(ics)), "ic_t": r(t_ajustado(pd.Series(ics), n), 2),
                          "meses_ic_positivo": r(np.mean(np.array(ics) > 0), 3),
                          "quintil_alto": r(np.nanmean(q5)), "quintil_bajo": r(np.nanmean(q1)),
                          "diferencia": r(spread.mean()), "diferencia_t": r(t_ajustado(spread, n), 2),
                          "acierto_quintil_alto": r(np.nanmean(acierto), 3), "meses": len(ics)}
            salida["factores"].setdefault(clave, {"nombre": nombre})[mercado] = res

        for clave, (nombre, fn) in REGLAS.items():
            m = fn(s)[cols].astype(bool) & valido
            res = {}
            for h, n in HORIZONTES.items():
                por_mes, eventos = [], []
                for d in fechas:
                    e = exceso[h].loc[d][m.loc[d]].dropna()
                    if len(e):
                        por_mes.append(e.mean()); eventos.append(e)
                if len(por_mes) < 12:
                    continue
                todos = pd.concat(eventos)
                serie = pd.Series(por_mes)
                res[h] = {"exceso_promedio": r(serie.mean()), "t": r(t_ajustado(serie, n), 2),
                          "acierto": r((todos > 0).mean(), 3), "mediana": r(todos.median()),
                          "casos": int(len(todos)), "meses": len(por_mes)}
            salida["reglas"].setdefault(clave, {"nombre": nombre})[mercado] = res

        # El Top 5 tal como lo arma el bot: filtro, los 5 de mayor puntaje del mes, y su exceso promedio
        puntaje = FACTORES["score_top5"][1](s)[cols].where(REGLAS["filtro_top5"][1](s)[cols].astype(bool) & valido)
        res = {}
        for h, n in HORIZONTES.items():
            por_mes, eventos = {}, []
            for d in fechas:
                elegidos = puntaje.loc[d].dropna().nlargest(5).index
                e = exceso[h].loc[d][elegidos].dropna()
                if len(e):
                    por_mes[d] = e.mean(); eventos.append(e)
            if len(por_mes) >= 12:
                casos, serie = pd.concat(eventos), pd.Series(por_mes)
                # Por año: un promedio alto puede venir de un solo rebote (marzo de 2020) y no repetirse
                por_anio = {str(a): r(v) for a, v in serie.groupby(serie.index.year).mean().items()}
                res[h] = {"exceso_promedio": r(serie.mean()), "t": r(t_ajustado(serie, n), 2),
                          "acierto": r((casos > 0).mean(), 3), "mediana": r(casos.median()),
                          "meses_positivos": r((serie > 0).mean(), 3), "casos": int(len(casos)),
                          "meses": len(serie), "por_anio": por_anio}
        salida["top5"][mercado] = res
        salida["muestra"][mercado] = {
            "desde": precios.index[0].strftime("%Y-%m-%d"), "hasta": precios.index[-1].strftime("%Y-%m-%d"),
            "fechas_evaluadas": len(fechas), "acciones": len(cols),
        }
    salida["sesgos"] = [
        "Supervivencia: el universo es la lista actual de los índices; las empresas que quebraron o salieron no "
        "están, lo que favorece a las señales que compran caídas. Las que entraron después de subir mucho sí "
        "están con toda su historia, lo que favorece a las acciones volátiles y a las que ya subieron.",
        "Solo señales de precio: Yahoo no entrega los fundamentales de cada fecha pasada.",
        "Exceso frente al promedio simple de cada mercado, antes de comisiones e impuestos.",
    ]
    salida["calculado"] = datetime.now(timezone.utc).isoformat()
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="Pickle con los precios ya descargados (para iterar sin volver a bajar)")
    ap.add_argument("--salida", default="evidencia.json")
    args = ap.parse_args()
    if args.cache and os.path.exists(args.cache):
        precios = pd.read_pickle(args.cache)
    else:
        precios = descargar(universo())
        if args.cache:
            precios.to_pickle(args.cache)
    logging.info(f"Precios: {precios.shape[1]} activos, {precios.index[0]:%Y-%m-%d} a {precios.index[-1]:%Y-%m-%d}")
    resultado = evaluar(precios)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=1)
    logging.info(f"Evidencia guardada en {args.salida}")


if __name__ == "__main__":
    main()

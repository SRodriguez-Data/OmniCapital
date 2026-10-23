"""Laboratorio de evidencia del asesor.

Mide, con 10 años de precios de todo el universo (S&P 500, Nasdaq-100 e IPSA), cuánto anticipó cada señal del
asesor el retorno de los meses siguientes frente al promedio de su propio mercado. Una recomendación solo puede
apoyarse en una señal con evidencia, y con la fuerza que esa evidencia permite: así el asesor dice lo que sabe y
qué tan seguro está, en vez de opinar.

Cómo se mide: el último día hábil de cada mes se calcula cada señal para cada acción con los precios disponibles
ese día (nada del futuro) y se compara con su retorno a 1, 3 y 6 meses, descontado el promedio de su mercado
(EE.UU. o Chile) en el mismo período. Precios ajustados por dividendos y splits; los de Chile, de la Bolsa de Santiago
(bolsa_chile.py), porque Yahoo congela semanas y deja días a medio cerrar en las acciones chilenas.

Sesgos que no se pueden quitar con datos gratis, y que el informe declara:
- Supervivencia: en EE.UU. cada fecha usa solo las empresas del S&P 500 de hoy que ya estaban en el índice ese día
  (fecha de ingreso de Wikipedia): así no cuentan las que entraron después de subir mucho. Las que salieron del
  índice siguen sin estar (la mayoría por caer), lo que todavía favorece a las señales que compran caídas. En Chile
  el universo es el IPSA de hoy.
- Fundamentales: solo EE.UU., con los estados financieros de la SEC tal como se conocían en cada fecha
  (fundamentales_sec.py). Para Chile no hay una fuente histórica gratuita: ahí solo se miden señales de precio.

Uso: python evidencia.py [--cache archivo.pkl] [--cache-sec carpeta] [--salida archivo.json] [--web carpeta]
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
from io import StringIO

import requests
from scipy.stats import spearmanr

import bolsa_chile
import fundamentales_sec

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
    # 10 años de sesiones de la Bolsa de Santiago, ajustadas por dividendos como el cierre de Yahoo
    bolsa = bolsa_chile.diarias([t for t in tickers if t.endswith(".SN")], barras=2600, ajuste="dividends")
    columnas = [c for c in columnas if c.name not in bolsa]
    columnas += [df.set_index(pd.to_datetime(df["date"]))["close"].rename(t) for t, df in bolsa.items()]
    logging.info(f"Chile: {len(bolsa)} acciones con precios de la Bolsa de Santiago.")
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


LIMITE_CALIDAD = 0.5


def rango_en_sector(x: pd.DataFrame, sector_de: dict[str, str]) -> pd.DataFrame:
    """Percentil de cada acción frente a las de su mismo sector, cada día (1 = la mejor del sector)."""
    salida = pd.DataFrame(index=x.index, columns=x.columns, dtype=float)
    for sector in {sector_de.get(c) for c in x.columns}:
        cs = [c for c in x.columns if sector_de.get(c) == sector]
        salida[cs] = x[cs].rank(axis=1, pct=True)
    return salida


def calidad_utilidades(F: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Utilidad respaldada por caja: (flujo operacional - pago en acciones - utilidad) / activos. Alto = la
    utilidad viene con caja de verdad (Sloan, 1996); el pago en acciones se descuenta porque infla el flujo de
    caja sin ser caja libre para el accionista."""
    caja = F["flujo_operacional"] - F["pago_en_acciones"].fillna(0)
    calidad = ((caja - F["utilidad"]) / F["activos"]).where(F["activos"] > 0)
    # Una diferencia mayor a la mitad de los activos es casi siempre una cifra mal escalada en la SEC
    return calidad.where(calidad.abs() <= LIMITE_CALIDAD)


def senales_fundamentales(F: dict[str, pd.DataFrame], financieras: set[str],
                          sector_de: dict[str, str] | None = None) -> dict[str, pd.DataFrame]:
    """Las razones que usa el asesor (lib/advisor.ts pilarFundamental) con las cifras vigentes cada día."""
    ni, eq, mc, act = F["utilidad"], F["patrimonio"], F["valor_mercado"], F["activos"]
    bruto = F["margen_bruto"].fillna(F["ventas"] - F["costo_ventas"])
    pe = (mc / ni).where((ni > 0) & (mc > 0))
    roe = (ni / eq).where(eq > 0)
    crec = (ni / F["utilidad_previa"] - 1).where(F["utilidad_previa"] > 0)
    payout = (F["dividendos"] / ni).where(ni > 0)
    es_financiera = pd.DataFrame(False, index=ni.index, columns=ni.columns)
    es_financiera[sorted(financieras & set(ni.columns))] = True
    # En bancos y aseguradoras la deuda es parte del negocio: el asesor no les aplica el tope de deuda
    deuda_pat = (F["deuda"] / eq).where((eq > 0) & ~es_financiera)
    pe_rel = pe.div(pe.median(axis=1), axis=0)

    per_barato, per_caro = pe_rel < 0.8, (pe_rel > 1.6) & ~(crec >= 0.2)
    roe_alto, roe_bajo = roe >= 0.15, roe < 0.07
    deuda_alta = deuda_pat > 2
    creciendo, cayendo = crec >= 0.10, crec <= -0.15
    payout_alto = payout > 1
    b = lambda x: x.astype(int)
    puntos = (b(per_barato) - b(per_caro) + b(roe_alto) - b(roe_bajo) - b(deuda_alta)
              + b(creciendo) - b(cayendo) - b(payout_alto))
    datos = b(pe.notna()) + b(roe.notna()) + b(crec.notna())
    calidad = calidad_utilidades(F).where(~es_financiera)
    return {
        "calidad": calidad,
        "calidad_sector": rango_en_sector(calidad, sector_de or {}),
        "ep": (ni / mc).where(mc > 0), "bp": (eq / mc).where(mc > 0), "roe": roe,
        "rentabilidad_bruta": (bruto / act).where(act > 0),
        "acumulaciones": ((ni - F["flujo_operacional"]) / act).where(act > 0),
        "crec_activos": (act / F["activos_previos"] - 1).where(F["activos_previos"] > 0),
        "deuda_patrimonio": deuda_pat, "crec_utilidad": crec, "payout": payout,
        "per_barato": per_barato, "per_caro": per_caro, "roe_alto": roe_alto, "roe_bajo": roe_bajo,
        "deuda_alta": deuda_alta, "utilidad_creciendo": creciendo, "utilidad_cayendo": cayendo,
        "payout_alto": payout_alto,
        "fundamental_favorable": (puntos >= 2) & (datos >= 2), "fundamental_debil": (puntos <= -2) & (datos >= 2),
    }


FACTORES_FUND = {
    "valor_ep": ("Utilidad sobre precio (valor)", lambda s: s["ep"]),
    "valor_bp": ("Valor libro sobre precio (valor)", lambda s: s["bp"]),
    "rentabilidad_roe": ("ROE (rentabilidad)", lambda s: s["roe"]),
    "rentabilidad_bruta": ("Margen bruto sobre activos (calidad)", lambda s: s["rentabilidad_bruta"]),
    "acumulaciones_bajas": ("Utilidad respaldada por caja (calidad)", lambda s: -s["acumulaciones"]),
    "calidad_ajustada": ("Utilidad respaldada por caja, sin pago en acciones", lambda s: s["calidad"]),
    "calidad_en_sector": ("Utilidad respaldada por caja frente a su sector", lambda s: s["calidad_sector"]),
    "inversion_baja": ("Crecimiento bajo de los activos", lambda s: -s["crec_activos"]),
    "deuda_baja": ("Deuda baja frente al patrimonio", lambda s: -s["deuda_patrimonio"]),
    "crecimiento_utilidad": ("Crecimiento de la utilidad", lambda s: s["crec_utilidad"]),
}
REGLAS_FUND = {
    "per_barato": ("PER bajo 0,8 veces el del mercado", lambda s: s["per_barato"]),
    "per_caro": ("PER sobre 1,6 veces el del mercado sin crecimiento fuerte", lambda s: s["per_caro"]),
    "roe_alto": ("ROE de 15% o más", lambda s: s["roe_alto"]),
    "roe_bajo": ("ROE bajo 7%", lambda s: s["roe_bajo"]),
    "deuda_alta": ("Deuda mayor a 2 veces el patrimonio", lambda s: s["deuda_alta"]),
    "utilidad_creciendo": ("Utilidad creciendo 10% o más", lambda s: s["utilidad_creciendo"]),
    "utilidad_cayendo": ("Utilidad cayendo 15% o más", lambda s: s["utilidad_cayendo"]),
    "payout_alto": ("Reparte en dividendos más que su utilidad", lambda s: s["payout_alto"]),
    "calidad_alta": ("Utilidad respaldada por caja: 20% superior de su sector", lambda s: s["calidad_sector"] >= 0.8),
    "calidad_baja": ("Utilidad respaldada por caja: 20% inferior de su sector", lambda s: s["calidad_sector"] <= 0.2),
    "fundamental_favorable": ("Veredicto fundamental del asesor: favorable", lambda s: s["fundamental_favorable"]),
    "fundamental_debil": ("Veredicto fundamental del asesor: débil", lambda s: s["fundamental_debil"]),
}


def tabla_sp500() -> pd.DataFrame | None:
    """Miembros actuales del S&P 500 con su sector GICS y su fecha de ingreso (Wikipedia)."""
    try:
        r = requests.get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                         headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}, timeout=30)
        df = pd.read_html(StringIO(r.text))[0]
        df["ticker"] = df["Symbol"].str.replace(".", "-")
        df["ingreso"] = pd.to_datetime(df["Date added"].astype(str).str[:10], errors="coerce")
        return df
    except Exception as e:
        logging.warning(f"Sin la lista del S&P 500: {str(e)[:120]}")
        return None


# Los métodos que usa el Top (quantum_trader_serverless.py): cada mes se eligen N acciones y se mide su exceso
METODOS = {
    "calidad_eeuu": {
        "nombre": "EE.UU.: utilidad respaldada por caja, la mejor de cada sector",
        "mercado": "EE.UU.", "n": 20,
        # Percentil dentro del sector (sin bancos ni aseguradoras), sin las que reparten más que su utilidad
        "puntaje": lambda s: s["calidad_sector"].where(~s["payout_alto"]),
    },
    "momentum_chile": {
        "nombre": "Chile: las de mayor alza de los últimos 12 meses (sin el último mes)",
        "mercado": "Chile", "n": 5,
        "puntaje": lambda s: s["momentum_12_1"],
    },
}
CORTE_MITADES = pd.Timestamp("2021-10-01")


def medir_metodo(puntaje: pd.DataFrame, n: int, fechas, exceso: dict[str, pd.DataFrame]) -> dict:
    """Exceso promedio de las N mejores de cada mes, con su t, su tasa de acierto, por año y por mitad de la
    muestra (una regla elegida mirando todos los datos debe funcionar también en cada mitad)."""
    res = {}
    for h, dias in HORIZONTES.items():
        por_mes, casos = {}, []
        for d in fechas:
            el = puntaje.loc[d].dropna().sort_values(ascending=False).index[:n]
            e = exceso[h].loc[d, el].dropna()
            if len(e):
                por_mes[d] = e.mean(); casos.append(e)
        if len(por_mes) < 12:
            continue
        serie, todos = pd.Series(por_mes), pd.concat(casos)
        mitades = {etiqueta: parte for etiqueta, parte in
                   (("antes", serie[serie.index < CORTE_MITADES]), ("despues", serie[serie.index >= CORTE_MITADES]))}
        res[h] = {"exceso_promedio": r(serie.mean()), "t": r(t_ajustado(serie, dias), 2),
                  "acierto": r((todos > 0).mean(), 3), "mediana": r(todos.median()),
                  "meses_positivos": r((serie > 0).mean(), 3), "casos": int(len(todos)), "meses": len(serie),
                  "por_anio": {str(a): r(v) for a, v in serie.groupby(serie.index.year).mean().items()},
                  "mitades": {k: {"desde": v.index[0].strftime("%Y-%m"), "hasta": v.index[-1].strftime("%Y-%m"),
                                  "exceso_promedio": r(v.mean()), "t": r(t_ajustado(v, dias), 2)}
                              for k, v in mitades.items() if len(v) >= 12}}
    return res


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


def evaluar(crudos: pd.DataFrame, sec: "fundamentales_sec.Sec | None" = None) -> dict:
    mercados = {"EE.UU.": [t for t in crudos.columns if not t.endswith(".SN")],
                "Chile": [t for t in crudos.columns if t.endswith(".SN")]}
    salida = {"base": {}, "factores": {}, "reglas": {}, "top5": {}, "metodos": {}, "muestra": {}}

    sp500 = tabla_sp500()
    for mercado, cols in mercados.items():
        miembro = None
        if mercado == "EE.UU." and sp500 is not None:
            # Solo el S&P 500, y cada empresa desde que entró al índice (fecha de ingreso desconocida: desde siempre)
            ingreso = dict(zip(sp500["ticker"], sp500["ingreso"]))
            cols = [c for c in cols if c in ingreso]
        precios = calendario(crudos[cols])
        if mercado == "EE.UU." and sp500 is not None:
            miembro = pd.DataFrame({c: precios.index >= (ingreso[c] if pd.notna(ingreso[c]) else pd.Timestamp.min)
                                    for c in cols}, index=precios.index)
        s = senales(precios)
        if mercado == "EE.UU." and sec is not None:
            anios = list(range(precios.index[0].year - 2, precios.index[-1].year + 1))
            F = fundamentales_sec.panel(sec, precios, anios)
            financieras = set(sp500.loc[sp500["GICS Sector"] == "Financials", "ticker"]) if sp500 is not None else set()
            sector_de = dict(zip(sp500["ticker"], sp500["GICS Sector"])) if sp500 is not None else {}
            s.update(senales_fundamentales(F, financieras, sector_de))
        fwd = {h: precios.shift(-n) / precios - 1 for h, n in HORIZONTES.items()}
        fechas = fechas_mensuales(precios.index, max(HORIZONTES.values()))
        valido = (~s["congelado"][cols]) & precios[cols].notna()
        if miembro is not None:
            valido &= miembro
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

        for clave, (nombre, fn) in {**FACTORES, **FACTORES_FUND}.items():
            try:
                x = fn(s)[cols].where(valido)
            except KeyError:
                continue  # fundamentales: solo EE.UU.
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

        for clave, (nombre, fn) in {**REGLAS, **REGLAS_FUND}.items():
            try:
                m = fn(s)[cols].astype(bool) & valido
            except KeyError:
                continue
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

        for clave, m in METODOS.items():
            if m["mercado"] != mercado:
                continue
            try:
                puntaje = m["puntaje"](s)[cols].where(valido)
            except KeyError:
                continue
            salida["metodos"][clave] = {"nombre": m["nombre"], "mercado": mercado, "n": m["n"],
                                        **medir_metodo(puntaje, m["n"], fechas, exceso)}
        salida["muestra"][mercado] = {
            "desde": precios.index[0].strftime("%Y-%m-%d"), "hasta": precios.index[-1].strftime("%Y-%m-%d"),
            "fechas_evaluadas": len(fechas), "acciones": len(cols),
            "universo": "S&P 500 en la fecha (miembros actuales desde su ingreso)" if miembro is not None else "IPSA actual",
        }
    salida["sesgos"] = [
        "Supervivencia: en EE.UU. cada fecha usa solo las empresas del S&P 500 actual que ya estaban en el índice; "
        "las que salieron (la mayoría por caer) no están, lo que favorece a las señales que compran caídas. En "
        "Chile se usa el IPSA actual con toda su historia.",
        "Fundamentales solo de EE.UU. (SEC EDGAR, cada cifra 90 días después del cierre de su año fiscal); el valor de "
        "mercado se estima con el valor en manos del público, así que las empresas con controlador grande salen algo "
        "más baratas. Para Chile no hay fundamentales históricos gratuitos.",
        "Exceso frente al promedio simple de cada mercado, antes de comisiones e impuestos.",
    ]
    salida["calculado"] = datetime.now(timezone.utc).isoformat()
    return salida


def para_web(res: dict) -> tuple[dict, dict]:
    """Lo que usa la web, en dos archivos: las reglas (solo el servidor, para el asesor) y los métodos del Top (lo
    único que descarga el navegador). Los factores continuos quedan solo en el resultado completo."""
    corto = lambda m: {k: m[k] for k in ("exceso_promedio", "t", "acierto", "casos") if k in m}
    reglas = {
        "calculado": res["calculado"], "muestra": res["muestra"],
        "base": {mk: {"3m": {"acierto": v["3m"]["acierto"]}} for mk, v in res["base"].items()},
        "reglas": {k: {"nombre": v["nombre"], **{mk: {h: corto(x) for h, x in v[mk].items() if h in ("3m", "6m")}
                                                for mk in v if mk != "nombre"}} for k, v in res["reglas"].items()},
    }
    metodos = {
        "calculado": res["calculado"], "muestra": res["muestra"], "sesgos": res["sesgos"],
        "base": reglas["base"],
        "metodos": {k: {"nombre": m["nombre"], "mercado": m["mercado"], "n": m["n"],
                        "3m": {**corto(m["3m"]), "meses_positivos": m["3m"]["meses_positivos"], "mitades": m["3m"]["mitades"]}}
                    for k, m in res["metodos"].items() if "3m" in m},
    }
    return reglas, metodos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="Pickle con los precios ya descargados (para iterar sin volver a bajar)")
    ap.add_argument("--cache-sec", help="Carpeta donde guardar las respuestas de la SEC (para iterar)")
    ap.add_argument("--salida", default="evidencia.json", help="Resultado completo")
    ap.add_argument("--web", help="Carpeta donde escribir evidencia_reglas.json y evidencia_metodos.json para la web")
    args = ap.parse_args()
    if args.cache and os.path.exists(args.cache):
        precios = pd.read_pickle(args.cache)
    else:
        precios = descargar(universo())
        if args.cache:
            precios.to_pickle(args.cache)
    logging.info(f"Precios: {precios.shape[1]} activos, {precios.index[0]:%Y-%m-%d} a {precios.index[-1]:%Y-%m-%d}")
    sec = None
    if os.getenv("SEC_CONTACTO"):
        sec = fundamentales_sec.Sec(cache=args.cache_sec)
    else:
        logging.warning("Sin SEC_CONTACTO: no se miden los fundamentales.")
    resultado = evaluar(precios, sec)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=1)
    logging.info(f"Evidencia guardada en {args.salida}")
    if args.web:
        for nombre, datos in zip(("evidencia_reglas.json", "evidencia_metodos.json"), para_web(resultado)):
            with open(os.path.join(args.web, nombre), "w", encoding="utf-8") as f:
                json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
        logging.info(f"Archivos de la web guardados en {args.web}")


if __name__ == "__main__":
    main()

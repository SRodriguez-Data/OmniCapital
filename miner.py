import yfinance as yf
import pandas as pd
import numpy as np
import sys
import time
import logging
import os
from datetime import datetime, timedelta, timezone
import requests
from io import StringIO
from dotenv import load_dotenv
from supabase import create_client, Client
import bolsa_chile
try:
    from yfinance.data import YfData  # sesión de yfinance (cookie y crumb de Yahoo) para pedir quoteSummary
except ImportError:
    YfData = None

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY")

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
# Sin el detalle de cada consulta HTTP: los registros de GitHub Actions quedan más legibles
logging.getLogger("httpx").setLevel(logging.WARNING)


def obtener_universo_masivo() -> tuple[list[str], list[str]]:
    """Extrae S&P 500, Nasdaq 100, activos personalizados y los de los portafolios de la web.
    Devuelve (universo completo, activos que además necesitan fundamentales guardados)."""
    logging.info("🌐 Recopilando universo de activos globales...")
    tickers_finales = []
    
    # El disfraz para que Wikipedia no nos bloquee
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

    # 1. S&P 500
    try:
        r = requests.get('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', headers=headers)
        # StringIO convierte el texto web en un formato que Pandas ama leer
        df_sp = pd.read_html(StringIO(r.text))[0]
        sp500 = df_sp['Symbol'].str.replace('.', '-').tolist()
        tickers_finales.extend(sp500)
        logging.info(f"✅ S&P 500 cargado ({len(sp500)} activos).")
    except Exception as e: 
        logging.error(f"Error S&P 500: {e}")

    # 2. Nasdaq 100
    try:
        # La tabla de componentes se movió de la página 'Nasdaq-100' a esta lista
        r = requests.get('https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies', headers=headers)
        tablas = pd.read_html(StringIO(r.text))
        for t in tablas:
            if 'Ticker' in t.columns:
                ndx = t['Ticker'].str.replace('.', '-').tolist()
                tickers_finales.extend(ndx)
                logging.info(f"✅ NASDAQ 100 cargado ({len(ndx)} activos).")
                break
        else:
            logging.error("Error Nasdaq 100: Wikipedia no trae la tabla de componentes.")
    except Exception as e: 
        logging.error(f"Error Nasdaq 100: {e}")

    # 3. Tus Activos Fijos (Globales y Chilenos)
    activos_fijos = [
        "CHILE.SN", "BSANTANDER.SN", "ENELCHILE.SN", "CMPC.SN", "SQM-B.SN", 
        "LTM.SN", "COPEC.SN", "CENCOSUD.SN", "EMBONOR-B.SN", "ANDINA-B.SN", 
        "SMU.SN", "ENTEL.SN", "VAPORES.SN", "ITAUCL.SN", "AGUAS-A.SN", 
        "IAM.SN", "CAP.SN", "COLBUN.SN", "ECL.SN", "PARAUCO.SN", "MALLPLAZA.SN",
        "RIPLEY.SN", "FALABELLA.SN", "SONDA.SN", "CONCHATORO.SN", "CCU.SN",
        "ILC.SN", "QUINENCO.SN", "CFINRENTAS.SN", "CFMITNIPSA.SN",
        "TSM", "SONY", "TM", "HMC", "KEP", "BABA", "JD", "MUFG", "INFY", "WIT",
        "NTTYY", "BUD", "SFTBY", "BHP", "BIDU", "PDD", "LI", "NIO", 
        "NVO", "SAP", "SHEL", "UL", "SNY", "BP", "DEO", "BTI", "GSK", "SAN", 
        "BBVA", "ING", "ASML", "CRH", "FLUT", "RELX", "HEINY", "RACE",
        "MELI", "PBR", "VALE", "NU", "ITUB", "AMX", "BBD", "BSBR", "FMX", "BAK", 
        "VOO", "SCHD", "HDV", "QQQ", "VT", "EEM", "VEA", "VUG", "VTV", "VNQ", "IYR", "FTEC",
        "ACWI",
        # Series de referencia para la web (no son acciones): dólar en pesos, índices de comparación y el
        # contexto de mercado del asesor (volatilidad, tasa a 10 años y cobre)
        "CLP=X", "^GSPC", "^SP500TR", "^VIX", "^TNX", "HG=F"
    ]
    tickers_finales.extend(activos_fijos)
    logging.info(f"✅ Activos fijos cargados ({len(activos_fijos)} activos).")
    
    # Lo que tienen los usuarios en la web, para que el asesor lea todo desde la base. Solo se registra
    # cuántos son: los registros de GitHub Actions de un repositorio público los puede ver cualquiera.
    de_portafolios = tickers_de_portafolios()
    tickers_finales.extend(de_portafolios)
    logging.info(f"✅ Activos de los portafolios de la web: {len(de_portafolios)}.")

    lista_limpia = list(set(tickers_finales))
    lista_limpia.sort()
    logging.info(f"🎯 Universo total consolidado: {len(lista_limpia)} activos únicos.")
    return lista_limpia, sorted(set(activos_fijos) | set(de_portafolios))

def tickers_de_portafolios() -> list[str]:
    """Tickers de los portafolios de todos los usuarios (la clave secreta salta RLS)."""
    if not supabase:
        return []
    try:
        filas = supabase.table("mi_portafolio").select("ticker").execute().data or []
        return sorted({f["ticker"].strip().upper() for f in filas if f.get("ticker")})
    except Exception as e:
        logging.warning(f"No se pudieron leer los portafolios: {e}")
        return []

def _get_slope(y):
    if len(y) < 20: return np.nan
    x = np.arange(20)
    return float(np.mean((x - 9.5) * (y - np.mean(y))) / np.var(x))

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calcula la matemática pesada (RSI, MACD, EMAs) ANTES de guardar en base de datos."""
    if df.empty or "close" not in df.columns:
        return df
    out = df.copy()
    close = out["close"]

    # EMAs
    for span in [9, 12, 20, 26, 50, 200]:
        out[f"ema_{span}"] = close.ewm(span=span, adjust=False).mean()

    # RSI
    delta = close.diff()
    gain  = delta.clip(lower=0).ewm(com=13, min_periods=14).mean()
    loss  = (-delta).clip(lower=0).ewm(com=13, min_periods=14).mean()
    out["rsi"] = 100 - (100 / (1 + gain / (loss + 1e-9)))

    # MACD
    out["macd"]        = out["ema_12"] - out["ema_26"]
    out["macd_signal"] = out["macd"].ewm(span=9, adjust=False).mean()
    out["macd_hist"]   = out["macd"] - out["macd_signal"]

    # Bandas de Bollinger
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    out["bb_upper"] = sma20 + 2 * std20
    out["bb_lower"] = sma20 - 2 * std20
    out["bb_pct_b"] = (close - out["bb_lower"]) / (out["bb_upper"] - out["bb_lower"] + 1e-9)

    # Volatilidad anualizada (252 días de trading)
    log_ret = np.log(close / close.shift(1))
    out["vol_20d"] = log_ret.rolling(20).std() * np.sqrt(252)
    out["ret_5d"]  = close.pct_change(5)
    out["ret_10d"] = close.pct_change(10)
    out["roc_10"]  = (close / close.shift(10) - 1) * 100
    out["pvc_ema50"] = close / out["ema_50"] - 1
    out["pvc_ema200"] = close / out["ema_200"] - 1

    # ATR & ADX
    if "high" in out.columns and "low" in out.columns:
        prev_close  = close.shift(1)
        tr = pd.concat([
            out["high"] - out["low"],
            (out["high"] - prev_close).abs(),
            (out["low"]  - prev_close).abs(),
        ], axis=1).max(axis=1)
        tr_smooth = tr.ewm(span=14, adjust=False).mean()
        out["atr_14"] = tr_smooth

        # ADX
        up_move = out["high"] - out["high"].shift(1)
        down_move = out["low"].shift(1) - out["low"]
        plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
        
        plus_di = 100 * (pd.Series(plus_dm, index=out.index).ewm(span=14, adjust=False).mean() / (tr_smooth + 1e-9))
        minus_di = 100 * (pd.Series(minus_dm, index=out.index).ewm(span=14, adjust=False).mean() / (tr_smooth + 1e-9))
        dx = 100 * (abs(plus_di - minus_di) / (plus_di + minus_di + 1e-9))
        out["adx_14"] = dx.ewm(span=14, adjust=False).mean()

    # Linear Regression Slope
    out["slope_20d"] = close.rolling(20).apply(_get_slope, raw=True)

    # OBV
    vol_col = "Volume" if "Volume" in out.columns else "volume" if "volume" in out.columns else None
    if vol_col:
        out["obv"] = (np.sign(close.diff()) * out[vol_col]).fillna(0).cumsum()

    return out

# El minero es incremental: lee de la base los últimos días de cada activo, baja de Yahoo solo el último año
# (de a 100 activos por llamada, no uno por uno) y escribe solo los días que faltan. Un año alcanza para RSI,
# ADX, ATR y Bollinger; las EMA, la señal MACD y el OBV siguen desde la última fila guardada.
PERIODO_RECIENTE = "1y"
PERIODO_COMPLETO = "5y"   # solo activos nuevos, sin datos recientes o con el historial desalineado
# Las acciones chilenas toman sus precios de la Bolsa de Santiago (bolsa_chile.py): sesiones de cada período
BARRAS_BOLSA = {PERIODO_RECIENTE: 300, PERIODO_COMPLETO: 1300}
# Lo que se lee de la base para seguir cada serie y revisarla. Una corrida manual con 370 repasa el último año
# (por ejemplo, para corregir días que quedaron guardados con la bolsa abierta)
DIAS_GUARDADOS = int(os.environ.get("DIAS_REVISION") or 30)
LOTE_DESCARGA = 100
TOLERANCIA_CIERRE = 0.003
HORA_CIERRE_LOCAL = 17    # Santiago y Nueva York cierran a las 16:00 hora local
COLUMNAS_PRECIO = ["open", "high", "low", "close", "volume"]
COLUMNAS_SEMILLA = ["ema_9", "ema_12", "ema_20", "ema_26", "ema_50", "ema_200", "macd_signal", "obv"]
SPAN_EMA = {f"ema_{s}": s for s in (9, 12, 20, 26, 50, 200)}

def historial_congelado(df: pd.DataFrame) -> bool:
    """Yahoo a veces congela el historial de las acciones chilenas: repite el mismo cierre por semanas
    (incluido el último día). Guardar eso arruinaría la base, así que se detecta antes."""
    ultimos = df["close"].tail(6)
    return len(ultimos) == 6 and ultimos.nunique() == 1

def inicio_congelado(df: pd.DataFrame) -> str:
    """Fecha desde la que Yahoo repite el mismo cierre: lo anterior es historia válida."""
    ultimo = df["close"].iloc[-1]
    i = len(df) - 1
    while i > 0 and df["close"].iloc[i - 1] == ultimo:
        i -= 1
    return df["date"].iloc[i]

def ultimo_dia_cerrado(ticker: str) -> str:
    """Último día con la sesión terminada en la bolsa del activo. Con la bolsa abierta Yahoo entrega el precio
    del momento como cierre del día: ese día no se guarda hasta que la bolsa cierre."""
    zona = "America/Santiago" if ticker.endswith(".SN") else "America/New_York"
    ahora = pd.Timestamp.now(tz=zona)
    if ahora.hour < HORA_CIERRE_LOCAL:
        ahora -= pd.Timedelta(days=1)
    return ahora.strftime("%Y-%m-%d")

def limpiar(df: pd.DataFrame) -> pd.DataFrame:
    """Columnas en minúscula, fecha AAAA-MM-DD y solo los días con cierre."""
    df = df.reset_index()
    df.columns = [str(c[0] if isinstance(c, tuple) else c).lower().replace(" ", "_") for c in df.columns]
    df["date"] = df["date"].astype(str).str[:10]
    return df[df["close"].notna()].reset_index(drop=True)

def descargar(tickers: list[str], periodo: str) -> dict[str, pd.DataFrame]:
    """Historial diario de muchos activos por llamada (yfinance los pide en paralelo). Cierre real, sin ajustar
    por dividendos: los dividendos van en su propia tabla y la web los aplica."""
    datos = {}
    for i in range(0, len(tickers), LOTE_DESCARGA):
        lote = tickers[i:i + LOTE_DESCARGA]
        try:
            df = yf.download(lote, period=periodo, interval="1d", group_by="ticker", auto_adjust=False,
                             actions=True, threads=True, progress=False)
        except Exception as e:
            logging.warning(f"Falló la descarga de un lote de {len(lote)} activos: {str(e)[:120]}")
            continue
        for t in lote:
            if isinstance(df.columns, pd.MultiIndex):
                if t not in df.columns.get_level_values(0):
                    continue
                parte = df[t]
            else:
                parte = df
            limpio = limpiar(parte)
            if not limpio.empty:
                datos[t] = limpio
        time.sleep(1)
    return datos

# Acciones chilenas cuyos precios de esta corrida vienen de la Bolsa de Santiago y no de Yahoo
DE_LA_BOLSA: set[str] = set()

def usar_bolsa(descargas: dict[str, pd.DataFrame], tickers: list[str], periodo: str) -> None:
    """Reemplaza los precios de Yahoo de las acciones chilenas por los de la Bolsa de Santiago. Yahoo congela semanas
    y guarda días a medio cerrar; la bolsa trae el cierre y el volumen completos. Las que la bolsa no entrega (o si
    su feed falla) se quedan con Yahoo y sus reparaciones. Los dividendos siguen saliendo de Yahoo: se guardan antes."""
    chilenos = [t for t in tickers if t.endswith(".SN")]
    if not chilenos:
        return
    bolsa = bolsa_chile.diarias(chilenos, barras=BARRAS_BOLSA.get(periodo, 1300))
    for t, df in bolsa.items():
        descargas[t] = df
        DE_LA_BOLSA.add(t)
    faltan = sorted(set(chilenos) - set(bolsa))
    logging.info(f"🇨🇱 {len(bolsa)} acciones chilenas con precios de la Bolsa de Santiago"
                 + (f"; con Yahoo: {', '.join(faltan)}" if faltan else "."))

DIAS_BARRAS_HORA = 725   # Yahoo guarda barras por hora de los últimos 730 días

def reparar_con_horas(descargas: dict[str, pd.DataFrame]) -> int:
    """Yahoo deja semanas sin actualizar en el historial diario de varias acciones chilenas (el mismo cierre con
    volumen 0), pero sus barras por hora de esos mismos días sí traen los precios reales. Cada día con volumen 0
    se rearma con sus barras (apertura, máximo, mínimo, último precio y volumen sumado). Devuelve los días
    reparados; los que tampoco tienen barras quedan como estaban."""
    limite = (pd.Timestamp.now() - pd.Timedelta(days=DIAS_BARRAS_HORA)).strftime("%Y-%m-%d")
    malos = {}
    for t, df in descargas.items():
        if t.endswith(".SN") and t not in DE_LA_BOLSA:
            m = df["volume"].fillna(0).eq(0) & (df["date"] >= limite)
            if m.any():
                malos[t] = df.loc[m, "date"].tolist()
    if not malos:
        return 0
    inicio = min(min(v) for v in malos.values())
    reparados = 0
    tickers = sorted(malos)
    for i in range(0, len(tickers), 25):
        lote = tickers[i:i + 25]
        try:
            horas = yf.download(lote, start=inicio, interval="1h", group_by="ticker", auto_adjust=False,
                                threads=True, progress=False)
        except Exception as e:
            logging.warning(f"Sin barras por hora para reparar {len(lote)} acciones chilenas: {str(e)[:120]}")
            continue
        for t in lote:
            if isinstance(horas.columns, pd.MultiIndex):
                if t not in horas.columns.get_level_values(0):
                    continue
                parte = horas[t]
            else:
                parte = horas
            parte = parte.dropna(subset=["Close"])
            if parte.empty:
                continue
            indice = parte.index.tz_convert("America/Santiago") if parte.index.tz is not None else parte.index
            dias = parte.groupby(indice.strftime("%Y-%m-%d")).agg(
                open=("Open", "first"), high=("High", "max"), low=("Low", "min"), close=("Close", "last"),
                volume=("Volume", "sum"))
            df = descargas[t]
            for d in malos[t]:
                if d in dias.index and dias.at[d, "volume"] > 0:
                    df.loc[df["date"] == d, COLUMNAS_PRECIO] = dias.loc[d, COLUMNAS_PRECIO].to_numpy(dtype=float)
                    reparados += 1
        time.sleep(1)
    return reparados

def leer_guardado(desde: str) -> dict[str, pd.DataFrame]:
    """Los últimos días guardados de cada activo (precios y lo necesario para seguir los indicadores), en
    páginas de 1000 filas en vez de una consulta por activo."""
    columnas = ", ".join(["ticker", "date"] + COLUMNAS_PRECIO + COLUMNAS_SEMILLA)
    filas = []
    while True:
        pagina = supabase.table("precios_historicos").select(columnas).gte("date", desde) \
            .order("ticker").order("date").range(len(filas), len(filas) + 999).execute().data or []
        if not pagina:
            break
        filas += pagina
    if not filas:
        return {}
    df = pd.DataFrame(filas)
    df["date"] = df["date"].str[:10]
    df[COLUMNAS_PRECIO + COLUMNAS_SEMILLA] = df[COLUMNAS_PRECIO + COLUMNAS_SEMILLA].astype(float)
    return {t: g.drop(columns="ticker").reset_index(drop=True) for t, g in df.groupby("ticker")}

def revisar(yahoo: pd.DataFrame, guardado: pd.DataFrame) -> tuple[bool, list[str]]:
    """Compara lo guardado con Yahoo y devuelve (reescribir todo, fechas a escribir): los días nuevos, los que
    faltan y los guardados mal. Un día está mal guardado si su cierre no calza o si tiene mucho menos volumen
    que el día completo (se guardó con la bolsa abierta). Un split cambia todos los cierres anteriores de
    Yahoo en la misma proporción: entonces hay que bajar y reescribir el activo completo."""
    # Los días congelados de Yahoo (mismo cierre que el anterior y volumen 0) no sirven para comparar ni para
    # rellenar: lo guardado esos días salió de la cotización
    congelado = (yahoo["close"].diff() == 0) & (yahoo["volume"].fillna(0) == 0)
    validos = yahoo[~congelado].set_index("date")
    guardados = guardado.set_index("date")
    distintos, proporciones = [], []
    for d in guardados.index.intersection(validos.index):
        g, y = guardados.loc[d], validos.loc[d]
        if not g["close"] > 0:
            distintos.append(d)
            continue
        proporcion = y["close"] / g["close"]
        if abs(proporcion - 1) > TOLERANCIA_CIERRE or (y["volume"] > 0 and not g["volume"] >= 0.8 * y["volume"]):
            distintos.append(d)
        if abs(proporcion - 1) > 0.05:
            proporciones.append(proporcion)
    if len(proporciones) >= 3 and max(proporciones) / min(proporciones) < 1.02:
        return True, []
    primera, ultima = guardado["date"].iloc[0], guardado["date"].iloc[-1]
    huecos = [d for d in validos.index if primera < d < ultima and d not in guardados.index]
    nuevos = yahoo.loc[yahoo["date"] > ultima, "date"].tolist()
    return False, sorted(set(distintos + huecos + nuevos))

def continuar_ema(valores: pd.Series, inicio: float, span: int) -> np.ndarray:
    """EMA (adjust=False) que parte del valor guardado el día anterior en vez del primer precio descargado."""
    serie = pd.concat([pd.Series([inicio]), valores], ignore_index=True)
    return serie.ewm(span=span, adjust=False).mean().to_numpy()[1:]

def seguir_serie(tramo: pd.DataFrame, semilla: pd.Series) -> pd.DataFrame:
    """Recalcula las EMA, el MACD y el OBV del tramo siguiendo la última fila guardada antes de él."""
    out = tramo.copy()
    close = out["close"]
    for col, span in SPAN_EMA.items():
        if pd.notna(semilla[col]):
            out[col] = continuar_ema(close, semilla[col], span)
    out["macd"] = out["ema_12"] - out["ema_26"]
    if pd.notna(semilla["macd_signal"]):
        out["macd_signal"] = continuar_ema(out["macd"], semilla["macd_signal"], 9)
    out["macd_hist"] = out["macd"] - out["macd_signal"]
    out["pvc_ema50"] = close / out["ema_50"] - 1
    out["pvc_ema200"] = close / out["ema_200"] - 1
    if pd.notna(semilla["obv"]) and pd.notna(semilla["close"]):
        pasos = np.sign(close.diff().fillna(close.iloc[0] - semilla["close"])) * out["volume"].fillna(0)
        out["obv"] = semilla["obv"] + pasos.cumsum()
    return out

def historia(yahoo: pd.DataFrame, guardado: pd.DataFrame, nuevas: pd.DataFrame) -> pd.DataFrame:
    """Serie sobre la que se calculan los indicadores: Yahoo antes de lo guardado, lo guardado (que puede venir
    de la cotización si Yahoo congeló la serie) y las filas que se van a escribir."""
    previas = yahoo[yahoo["date"] < guardado["date"].iloc[0]]
    medio = guardado[~guardado["date"].isin(nuevas["date"])]
    serie = pd.concat([previas, medio, nuevas], ignore_index=True)[["date"] + COLUMNAS_PRECIO]
    serie[COLUMNAS_PRECIO] = serie[COLUMNAS_PRECIO].astype(float)
    return serie.sort_values("date").reset_index(drop=True)

def registros(ticker: str, df: pd.DataFrame) -> list[dict]:
    """Filas listas para Supabase: solo columnas de la tabla, sin NaN ni infinitos y con el volumen entero."""
    df = df.drop(columns=["adj_close", "dividends", "stock_splits", "capital_gains"], errors="ignore")
    df = df.replace([np.inf, -np.inf], np.nan)
    filas = df.astype(object).where(df.notna(), None).to_dict(orient="records")
    for f in filas:
        f["ticker"] = ticker
        if f.get("volume") is not None:
            f["volume"] = int(f["volume"])
    return filas

def calcular_filas(ticker: str, yahoo: pd.DataFrame, guardado: pd.DataFrame, nuevas: pd.DataFrame):
    """Filas de `nuevas` con sus indicadores. None si no hay una fila guardada anterior desde la cual seguir."""
    anteriores = guardado[guardado["date"] < nuevas["date"].min()]
    if anteriores.empty:
        return None
    semilla = anteriores.iloc[-1]
    serie = compute_indicators(historia(yahoo, guardado, nuevas))
    tramo = seguir_serie(serie[serie["date"] > semilla["date"]], semilla)
    return registros(ticker, tramo[tramo["date"].isin(nuevas["date"])])

def fila_desde_cotizacion(ticker: str, yahoo: pd.DataFrame, guardado: pd.DataFrame):
    """Con el historial congelado, la cotización de Yahoo (regularMarketPrice y su hora) sigue al día:
    se arma la fila de ese día sobre lo guardado y se siguen los indicadores."""
    info = yf.Ticker(ticker).info
    precio, hora = info.get("regularMarketPrice"), info.get("regularMarketTime")
    if not precio or not hora:
        return None
    zona = info.get("exchangeTimezoneName") or "UTC"
    fecha = pd.Timestamp(hora, unit="s", tz="UTC").tz_convert(zona).strftime("%Y-%m-%d")
    if fecha > ultimo_dia_cerrado(ticker):
        return None
    hoy = pd.DataFrame([{"date": fecha, "open": info.get("regularMarketOpen"), "high": info.get("regularMarketDayHigh"),
                         "low": info.get("regularMarketDayLow"), "close": float(precio),
                         "volume": info.get("regularMarketVolume")}])
    filas = calcular_filas(ticker, yahoo, guardado, hoy)
    return filas[0] if filas else None

def reescribir_historial(ticker: str, filas: list[dict], hasta: str | None = None):
    """Borra y vuelve a escribir el historial del ticker (o solo lo anterior a `hasta`)."""
    borrar = supabase.table("precios_historicos").delete().eq("ticker", ticker)
    if hasta:
        borrar = borrar.lt("date", hasta)
    borrar.execute()
    for i in range(0, len(filas), 500):
        supabase.table("precios_historicos").insert(filas[i:i + 500]).execute()

def cargar_completo(ticker: str) -> bool:
    """Activo nuevo, sin datos recientes o cuyo historial guardado ya no calza: se baja completo y se reescribe."""
    bajado = descargar([ticker], PERIODO_COMPLETO)
    if ticker in bajado:
        guardar_dividendos(bajado)
    usar_bolsa(bajado, [ticker], PERIODO_COMPLETO)
    reparar_con_horas(bajado)
    df = bajado.get(ticker)
    if df is None:
        return False
    df = df[df["date"] <= ultimo_dia_cerrado(ticker)].reset_index(drop=True)
    indicadores = compute_indicators(df[["date"] + COLUMNAS_PRECIO])
    # Una acción poco transada puede repetir el precio varios días en la bolsa: eso no es un historial congelado
    if ticker in DE_LA_BOLSA or not historial_congelado(df):
        reescribir_historial(ticker, registros(ticker, indicadores))
        return True
    # Lo congelado no se guarda: solo la historia anterior y, encima, el día de la cotización
    corte = inicio_congelado(df)
    previos = indicadores[indicadores["date"] < corte].reset_index(drop=True)
    reescribir_historial(ticker, registros(ticker, previos), hasta=corte)
    fila = fila_desde_cotizacion(ticker, df, previos.tail(DIAS_GUARDADOS).reset_index(drop=True)) if not previos.empty else None
    if fila:
        supabase.table("precios_historicos").delete().eq("ticker", ticker).eq("date", fila["date"]).execute()
        supabase.table("precios_historicos").insert([fila]).execute()
    return True

def guardar_dividendos(descargas: dict[str, pd.DataFrame]):
    """Dividendos por acción (fecha ex-dividendo, en la moneda del activo) y la marca de que se revisaron:
    una tabla vacía no distingue 'no paga dividendos' de 'nadie los consultó'."""
    filas, revisados = [], []
    ahora = datetime.now(timezone.utc).isoformat()
    for ticker, df in descargas.items():
        if ticker.startswith("^") or "=" in ticker or "dividends" not in df.columns:
            continue
        pagos = df[df["dividends"].fillna(0) > 0]
        filas += [{"ticker": ticker, "fecha": f, "monto": float(m)} for f, m in zip(pagos["date"], pagos["dividends"])]
        revisados.append({"ticker": ticker, "dividendos_revisados": ahora})
    for i in range(0, len(filas), 1000):
        supabase.table("dividendos").upsert(filas[i:i + 1000], on_conflict="ticker,fecha").execute()
    for i in range(0, len(revisados), 1000):
        supabase.table("series_meta").upsert(revisados[i:i + 1000]).execute()

MODULOS_FUNDAMENTALES = "summaryDetail,defaultKeyStatistics,financialData,assetProfile,fundProfile,topHoldings,price"

def guardar_fundamentales(tickers: list[str]):
    """Valoración, rentabilidad, analistas y composición de ETFs: el mismo quoteSummary de Yahoo que lee la web,
    guardado una vez al día para que no lo descargue cada vez que parte una instancia nueva."""
    if YfData is None:
        logging.warning("Esta versión de yfinance no expone YfData: no se guardan fundamentales.")
        return
    hace = (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()
    al_dia = {f["ticker"] for f in (supabase.table("fundamentales").select("ticker").gte("actualizado", hace).execute().data or [])}
    pendientes = [t for t in tickers if t not in al_dia and not t.startswith("^") and "=" not in t]
    datos_yahoo = YfData()
    guardados = fallos = 0
    for ticker in pendientes:
        try:
            r = datos_yahoo.get_raw_json(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}",
                                         params={"modules": MODULOS_FUNDAMENTALES, "formatted": "false", "corsDomain": "finance.yahoo.com"})
            resultado = ((r or {}).get("quoteSummary") or {}).get("result") or []
            if not resultado:
                fallos += 1
                continue
            datos = resultado[0]
            perfil = datos.get("assetProfile") or {}
            # Del perfil solo sirven sector, industria y país (el resto es texto largo y ejecutivos)
            datos["assetProfile"] = {k: perfil[k] for k in ("sector", "industry", "country") if perfil.get(k)}
            supabase.table("fundamentales").upsert({"ticker": ticker, "actualizado": datetime.now(timezone.utc).isoformat(), "datos": datos}).execute()
            guardados += 1
        except Exception as e:
            fallos += 1
            logging.warning(f"Sin fundamentales de {ticker}: {str(e)[:120]}")
        time.sleep(0.4)
    logging.info(f"📚 Fundamentales: {guardados} actualizados, {len(al_dia)} ya al día, {fallos} sin datos.")

def run_miner():
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase (SUPABASE_URL y SUPABASE_SECRET_KEY).")
        sys.exit(1)

    inicio = time.time()
    TICKERS_A_MINAR, CON_FUNDAMENTALES = obtener_universo_masivo()
    guardado = leer_guardado((datetime.now(timezone.utc) - timedelta(days=DIAS_GUARDADOS)).strftime("%Y-%m-%d"))
    seguidos = [t for t in TICKERS_A_MINAR if t in guardado]
    completos = [t for t in TICKERS_A_MINAR if t not in guardado]
    logging.info(f"⛏️ Minero incremental: {len(seguidos)} activos siguen lo guardado; "
                 f"{len(completos)} nuevos o sin datos recientes se bajan completos.")

    descargas = descargar(seguidos, PERIODO_RECIENTE)
    faltan = [t for t in seguidos if t not in descargas]
    if faltan:
        logging.info(f"Reintentando {len(faltan)} activos que Yahoo no entregó en su lote.")
        descargas.update(descargar(faltan, PERIODO_RECIENTE))
    try:
        guardar_dividendos(descargas)
    except Exception as e:
        logging.warning(f"No se guardaron los dividendos: {str(e)[:160]}")
    usar_bolsa(descargas, seguidos, PERIODO_RECIENTE)
    reparados = reparar_con_horas(descargas)
    if reparados:
        logging.info(f"🔧 {reparados} días chilenos congelados en el historial diario de Yahoo se rearmaron con sus barras por hora.")

    filas = []
    borrar = {}  # fechas guardadas que se reemplazan -> activos
    actualizados = al_dia = congelados = fallos = 0
    for ticker in seguidos:
        try:
            limite = ultimo_dia_cerrado(ticker)
            g = guardado[ticker]
            # Días guardados con la bolsa todavía abierta: su "cierre" era el precio de ese momento
            reemplazar = g.loc[g["date"] > limite, "date"].tolist()
            g = g[g["date"] <= limite].reset_index(drop=True)
            df = descargas.get(ticker)
            df = df[df["date"] <= limite].reset_index(drop=True) if df is not None else None
            if df is None or df.empty:
                fallos += 1
                logging.warning(f"{ticker}: Yahoo no entregó datos.")
            elif g.empty:
                completos.append(ticker)
            elif ticker not in DE_LA_BOLSA and historial_congelado(df):
                fila = fila_desde_cotizacion(ticker, df, g)
                if fila:
                    filas.append(fila)
                    reemplazar.append(fila["date"])
                    congelados += 1
                else:
                    al_dia += 1
            else:
                reescribir, fechas = revisar(df, g)
                if reescribir:
                    fuente = "la Bolsa de Santiago" if ticker in DE_LA_BOLSA else "Yahoo"
                    logging.info(f"{ticker}: lo guardado ya no calza con el cierre de {fuente} (split o corrección); se baja completo.")
                    completos.append(ticker)
                    continue
                nuevas = calcular_filas(ticker, df, g, df[df["date"].isin(fechas)]) if fechas else []
                if nuevas is None:
                    completos.append(ticker)
                    continue
                filas += nuevas
                reemplazar += [d for d in fechas if d in set(g["date"])]
                if nuevas:
                    actualizados += 1
                else:
                    al_dia += 1
            if reemplazar:
                borrar.setdefault(tuple(sorted(set(reemplazar))), []).append(ticker)
        except Exception as e:
            fallos += 1
            logging.error(f"Error en {ticker}: {str(e)[:160]}")

    for fechas, tickers in borrar.items():
        for i in range(0, len(tickers), 100):
            supabase.table("precios_historicos").delete().in_("ticker", tickers[i:i + 100]).in_("date", list(fechas)).execute()
    for i in range(0, len(filas), 1000):
        supabase.table("precios_historicos").insert(filas[i:i + 1000]).execute()

    cargados = 0
    for ticker in completos:
        try:
            if cargar_completo(ticker):
                cargados += 1
            else:
                fallos += 1
                logging.warning(f"{ticker}: Yahoo no entregó su historial completo.")
        except Exception as e:
            fallos += 1
            logging.error(f"Error cargando {ticker} completo: {str(e)[:160]}")

    if congelados:
        logging.warning(f"⚠️ {congelados} activos con historial congelado en Yahoo se completaron desde la cotización.")
    logging.info(f"🚀 Minería terminada en {time.time() - inicio:.0f} s: {len(filas)} filas nuevas o corregidas en "
                 f"{actualizados} activos, {al_dia} ya al día, {cargados} bajados completos, {fallos} fallos.")

    try:
        guardar_fundamentales(CON_FUNDAMENTALES)
    except Exception as e:
        logging.error(f"Error guardando fundamentales: {e}")

    if fallos > len(TICKERS_A_MINAR) * 0.3:
        logging.error("❌ Fallaron demasiados activos: Yahoo podría estar bloqueando las descargas.")
        sys.exit(1)

def recargar_chile():
    """Reescribe el historial completo de cada acción chilena con los precios de la Bolsa de Santiago. Se usa una vez
    al cambiar de fuente: la corrida diaria solo revisa los últimos días."""
    chilenos = [t for t in obtener_universo_masivo()[0] if t.endswith(".SN")]
    logging.info(f"Recargando {len(chilenos)} acciones chilenas desde la Bolsa de Santiago.")
    for t in chilenos:
        try:
            ok = cargar_completo(t)
            logging.info(f"{t}: {'reescrito' if ok else 'sin datos'} ({'Bolsa de Santiago' if t in DE_LA_BOLSA else 'Yahoo'}).")
        except Exception as e:
            logging.error(f"{t}: {str(e)[:160]}")

if __name__ == "__main__":
    if "--recargar-chile" in sys.argv:
        recargar_chile()
    else:
        run_miner()

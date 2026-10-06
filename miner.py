import yfinance as yf
import pandas as pd
import numpy as np
import time
import logging
import os
from datetime import datetime, timedelta, timezone
import urllib.request 
import requests
from io import StringIO
from dotenv import load_dotenv
from supabase import create_client, Client
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
        r = requests.get('https://en.wikipedia.org/wiki/Nasdaq-100', headers=headers)
        tablas = pd.read_html(StringIO(r.text))
        for t in tablas:
            if 'Ticker' in t.columns:
                ndx = t['Ticker'].str.replace('.', '-').tolist()
                tickers_finales.extend(ndx)
                logging.info(f"✅ NASDAQ 100 cargado ({len(ndx)} activos).")
                break
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

DIAS_A_CORREGIR = 7
COLUMNAS_PRECIO = ["open", "high", "low", "close", "volume"]

def historial_congelado(df: pd.DataFrame) -> bool:
    """Yahoo a veces congela el historial de las acciones chilenas: repite el mismo cierre por semanas
    (incluido el último día). Guardar eso arruinaría la base, así que se detecta antes."""
    ultimos = df["close"].tail(6)
    return len(ultimos) == 6 and ultimos.nunique() == 1

def fila_desde_cotizacion(ticker: str):
    """Con el historial congelado, la cotización de Yahoo (regularMarketPrice y su hora) sigue al día:
    se arma la fila de ese día sobre el historial guardado en Supabase y se recalculan los indicadores."""
    info = yf.Ticker(ticker).info
    precio, hora = info.get("regularMarketPrice"), info.get("regularMarketTime")
    if not precio or not hora:
        return None
    zona = info.get("exchangeTimezoneName") or "UTC"
    fecha = pd.Timestamp(hora, unit="s", tz="UTC").tz_convert(zona).strftime("%Y-%m-%d")
    filas = supabase.table("precios_historicos").select("date, open, high, low, close, volume")         .eq("ticker", ticker).order("date", desc=True).limit(400).execute().data
    if not filas:
        return None
    base = pd.DataFrame(filas)
    base["date"] = base["date"].str[:10]
    base = base[base["date"] != fecha].sort_values("date")
    hoy = {"date": fecha, "open": info.get("regularMarketOpen"), "high": info.get("regularMarketDayHigh"),
           "low": info.get("regularMarketDayLow"), "close": float(precio), "volume": info.get("regularMarketVolume")}
    df = pd.concat([base, pd.DataFrame([hoy])], ignore_index=True)
    df[COLUMNAS_PRECIO] = df[COLUMNAS_PRECIO].astype(float)
    fila = compute_indicators(df).iloc[-1].replace({np.nan: None}).to_dict()
    fila["ticker"] = ticker
    if fila.get("volume") is not None:
        fila["volume"] = int(fila["volume"])
    supabase.table("precios_historicos").delete().eq("ticker", ticker).eq("date", fecha).execute()
    return fila

def reescribir_ultimos_dias(ticker: str, df: pd.DataFrame, max_date: str) -> pd.DataFrame:
    """Devuelve las filas a insertar. Si el minero corrió con el mercado abierto, el precio de ese momento
    quedó guardado como cierre: por eso se borran y vuelven a escribir los últimos días con el cierre oficial."""
    desde = (pd.Timestamp(max_date) - pd.Timedelta(days=DIAS_A_CORREGIR)).strftime("%Y-%m-%d")
    recientes = df[df["date"] > desde]
    if not recientes.empty:
        supabase.table("precios_historicos").delete().eq("ticker", ticker).gt("date", desde).execute()
    return recientes

TOLERANCIA_CIERRE = 0.003

def historial_desalineado(ticker: str, df: pd.DataFrame) -> bool:
    """La base guarda el cierre real (sin ajustar por dividendos), que es el que la web ajusta con la tabla de
    dividendos. La carga inicial quedó ajustada y un split cambia todo el historial de Yahoo: si los cierres
    guardados en algunas fechas de muestra no calzan con los recién descargados, hay que reescribir el ticker."""
    if len(df) < 120:
        return False
    muestras = df.iloc[[len(df) // 5, len(df) // 2, len(df) - 60]]
    filas = supabase.table("precios_historicos").select("date, close").eq("ticker", ticker) \
        .in_("date", muestras["date"].tolist()).execute().data or []
    guardado = {f["date"][:10]: f["close"] for f in filas}
    for fecha, cierre in zip(muestras["date"], muestras["close"]):
        g = guardado.get(fecha)
        if g and cierre and abs(float(g) / float(cierre) - 1) > TOLERANCIA_CIERRE:
            return True
    return False

def inicio_congelado(df: pd.DataFrame) -> str:
    """Fecha desde la que Yahoo repite el mismo cierre: lo anterior es historia válida."""
    ultimo = df["close"].iloc[-1]
    i = len(df) - 1
    while i > 0 and df["close"].iloc[i - 1] == ultimo:
        i -= 1
    return df["date"].iloc[i]

def reescribir_historial(ticker: str, df: pd.DataFrame, hasta: str | None = None):
    """Borra y vuelve a escribir el historial del ticker (o solo lo anterior a `hasta`)."""
    borrar = supabase.table("precios_historicos").delete().eq("ticker", ticker)
    if hasta:
        borrar = borrar.lt("date", hasta)
        df = df[df["date"] < hasta]
    borrar.execute()
    records = df.to_dict(orient="records")
    for i in range(0, len(records), 500):
        supabase.table("precios_historicos").insert(records[i:i + 500]).execute()

def guardar_dividendos(ticker: str, df: pd.DataFrame):
    """Dividendos por acción (fecha ex-dividendo, en la moneda del activo) y la marca de que se revisaron:
    una tabla vacía no distingue 'no paga dividendos' de 'nadie los consultó'."""
    if ticker.startswith("^") or "=" in ticker or "dividends" not in df.columns:
        return
    pagos = df[df["dividends"].fillna(0) > 0]
    filas = [{"ticker": ticker, "fecha": f, "monto": float(m)} for f, m in zip(pagos["date"], pagos["dividends"])]
    if filas:
        supabase.table("dividendos").upsert(filas, on_conflict="ticker,fecha").execute()
    supabase.table("series_meta").upsert({"ticker": ticker, "dividendos_revisados": datetime.now(timezone.utc).isoformat()}).execute()

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

def run_miner(modo_incremental=True):
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase en .env")
        return
        
    periodo = "5y"
    logging.info(f"⛏️ Minero Cuantitativo V2 (Supabase): {'INCREMENTAL' if modo_incremental else 'HISTÓRICO'}")
    
    TICKERS_A_MINAR, CON_FUNDAMENTALES = obtener_universo_masivo()
    
    exitos = 0
    fallos = 0
    sin_cambios = 0
    congelados = 0
    reescritos = 0

    for ticker in TICKERS_A_MINAR:
        try:
            # Cierre real (sin ajustar por dividendos): es el que se compara con el precio en vivo.
            # Con auto_adjust=True la carga inicial quedaba ajustada y lo agregado después no.
            df = yf.download(ticker, period=periodo, interval="1d", progress=False, multi_level_index=False, auto_adjust=False, actions=True)
            if df.empty:
                fallos += 1
                continue
                
            df.reset_index(inplace=True)
            df['Ticker'] = ticker
            
            # Limpieza de nombres de columnas
            columnas_limpias = []
            for c in df.columns:
                nombre_base = str(c[0]) if isinstance(c, tuple) else str(c)
                columnas_limpias.append(nombre_base.lower().replace(" ", "_"))
            df.columns = columnas_limpias
            df['date'] = df['date'].astype(str).str[:10]
            try:
                guardar_dividendos(ticker, df)
            except Exception as e:
                logging.warning(f"{ticker}: no se guardaron los dividendos: {str(e)[:120]}")
            # La tabla guarda solo el cierre real; dividendos y splits van aparte
            df = df.drop(columns=["adj_close", "dividends", "stock_splits", "capital_gains"], errors="ignore")
            df = df[df["close"].notna()]

            congelado = modo_incremental and historial_congelado(df)
            if modo_incremental:
                # Lo congelado no sirve para comparar ni para reescribir: solo la historia anterior
                corte = inicio_congelado(df) if congelado else None
                valido = df[df["date"] < corte] if corte else df
                try:
                    if historial_desalineado(ticker, valido):
                        reescribir_historial(ticker, compute_indicators(df).replace({float('nan'): None}), hasta=corte)
                        reescritos += 1
                        logging.info(f"{ticker}: historial guardado distinto al cierre real de Yahoo (carga ajustada o split); reescrito.")
                        if not congelado:
                            exitos += 1
                            time.sleep(0.5)
                            continue
                except Exception as e:
                    logging.warning(f"{ticker}: no se pudo revisar el historial guardado: {str(e)[:120]}")

            if congelado:
                fila = fila_desde_cotizacion(ticker)
                if fila:
                    supabase.table("precios_historicos").insert([fila]).execute()
                    congelados += 1
                    logging.warning(f"{ticker}: historial de Yahoo congelado; se guardó el cierre del {fila['date']} desde la cotización.")
                else:
                    sin_cambios += 1
                time.sleep(0.5)
                continue

            # PRE-CÁLCULO MATEMÁTICO
            df = compute_indicators(df)
            
            # Limpiar NaNs para JSON serialization
            df = df.replace({float('nan'): None})
            
            if modo_incremental:
                try:
                    res = supabase.table("precios_historicos").select("date").eq("ticker", ticker).order("date", desc=True).limit(1).execute()
                    if res.data and len(res.data) > 0:
                        max_date = res.data[0]['date'][:10]
                        df = reescribir_ultimos_dias(ticker, df, max_date)
                except Exception as e:
                    logging.warning(f"No se pudo obtener max_date para {ticker}: {e}")

            if not df.empty:
                records = df.to_dict(orient='records')
                # Enviar a Supabase en bloques si es muy grande, pero 1 ticker max 5 años = 1250 filas (es seguro en un solo insert)
                supabase.table("precios_historicos").insert(records).execute()
                exitos += 1
            else:
                sin_cambios += 1
            
            time.sleep(0.5) 
            
        except Exception as e:
            logging.error(f"Error en {ticker}: {e}")
            fallos += 1

    if congelados:
        logging.warning(f"⚠️ {congelados} activos con historial congelado en Yahoo se completaron desde la cotización.")
    if reescritos:
        logging.info(f"🔁 {reescritos} historiales reescritos con el cierre real.")
    logging.info(f"🚀 Minería Data Warehouse (Supabase) finalizada. Actualizados: {exitos}, Al día (sin cambios): {sin_cambios}, Fallos: {fallos}.")

    try:
        guardar_fundamentales(CON_FUNDAMENTALES)
    except Exception as e:
        logging.error(f"Error guardando fundamentales: {e}")

if __name__ == "__main__":
    run_miner(modo_incremental=True)
import yfinance as yf
import pandas as pd
import numpy as np
import time
import logging
import os
from datetime import datetime
import urllib.request 
import requests
from io import StringIO
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY")

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


def obtener_universo_masivo() -> list[str]:
    """Extrae S&P 500, Nasdaq 100 y activos personalizados."""
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
        "VOO", "SCHD", "HDV", "QQQ", "VT", "EEM", "VEA", "VUG", "VTV", "VNQ", "IYR", "FTEC"
    ]
    tickers_finales.extend(activos_fijos)
    logging.info(f"✅ Activos fijos cargados ({len(activos_fijos)} activos).")
    
    lista_limpia = list(set(tickers_finales))
    lista_limpia.sort()
    logging.info(f"🎯 Universo total consolidado: {len(lista_limpia)} activos únicos.")
    return lista_limpia

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

def run_miner(modo_incremental=True):
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase en .env")
        return
        
    periodo = "5y"
    logging.info(f"⛏️ Minero Cuantitativo V2 (Supabase): {'INCREMENTAL' if modo_incremental else 'HISTÓRICO'}")
    
    TICKERS_A_MINAR = obtener_universo_masivo()
    
    exitos = 0
    fallos = 0
    sin_cambios = 0

    for ticker in TICKERS_A_MINAR:
        try:
            df = yf.download(ticker, period=periodo, interval="1d", progress=False, multi_level_index=False)
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
            
            # PRE-CÁLCULO MATEMÁTICO
            df = compute_indicators(df)
            
            # Limpiar NaNs para JSON serialization
            df = df.replace({float('nan'): None})
            df['date'] = df['date'].astype(str)
            
            if modo_incremental:
                try:
                    res = supabase.table("precios_historicos").select("date").eq("ticker", ticker).order("date", desc=True).limit(1).execute()
                    if res.data and len(res.data) > 0:
                        max_date = res.data[0]['date']
                        df = df[df['date'] > max_date]
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

    logging.info(f"🚀 Minería Data Warehouse (Supabase) finalizada. Actualizados: {exitos}, Al día (sin cambios): {sin_cambios}, Fallos: {fallos}.")

if __name__ == "__main__":
    run_miner(modo_incremental=True)
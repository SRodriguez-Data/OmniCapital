"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  QUANTUM PORTFOLIO BOT v2.0 — Telegram + Gemini/Groq + Monitoreo Intradía  ║
║  100% gratuito · Long Polling · Windows-compatible                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

INSTALACIÓN (una sola vez):
    pip install python-telegram-bot[job-queue] yfinance pandas numpy \
                python-dotenv google-generativeai groq scikit-learn \
                pyportfolioopt scipy

CONFIGURACIÓN:
    Crea un archivo .env en la misma carpeta con:
        TELEGRAM_TOKEN=tu_token_de_botfather
        TELEGRAM_CHAT_ID=tu_chat_id_personal
        LLM_PROVIDER=gemini          # "gemini" o "groq"
        GEMINI_API_KEY=tu_clave
        GROQ_API_KEY=tu_clave
        PORTFOLIO_TICKERS=VOO,HDV,SCHD,JNJ,NVDA,TSLA,FTEC
        
# Universo Masivo de Búsqueda (Optimizado para escaneo lento anti-spam)
RADAR_TICKERS = [
    # 🇨🇱 CHILE - ACCIONES (Bolsa de Santiago)
    "CHILE.SN", "BSANTANDER.SN", "ENELCHILE.SN", "CMPC.SN", "SQM-B.SN", 
    "LTM.SN", "COPEC.SN", "CENCOSUD.SN", "EMBONOR-B.SN", "ANDINA-B.SN", 
    "SMU.SN", "ENTEL.SN", "VAPORES.SN", "ITAUCL.SN", "AGUAS-A.SN", 
    "IAM.SN", "CAP.SN", "COLBUN.SN", "ECL.SN", "PARAUCO.SN", "MALLPLAZA.SN",
    "RIPLEY.SN", "FALABELLA.SN", "SONDA.SN", "CONCHATORO.SN", "CCU.SN",
    "SMCHILE-B.SN", "ILC.SN", "QUINENCO.SN", 

    # 🇺🇸 EE.UU. - TECH / GROWTH
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AMD", "NFLX", 
    "INTC", "QCOM", "AVGO", "CSCO", "ORCL", "CRM", "NOW", "ASML", "PANW",

    # 🇺🇸 EE.UU. - VALUE / DIVIDENDOS PERPETUOS
    "KO", "PEP", "JNJ", "PG", "PFE", "XOM", "CVX", "MCD", "HD", "VZ", "T", 
    "ABBV", "MRK", "BMY", "UNH", "CVS", "WMT", "COST", "TGT", "MO", "PM",

    # 🏦 FINANZAS / CONSUMO GLOBAL
    "JPM", "BAC", "WFC", "C", "GS", "MS", "V", "MA", "AXP", "BLK", "BX",

    # 🌏 ASIA EMERGENTE Y DESARROLLADA (ADRs en USD)
    "TSM", "SONY", "TM", "HMC", "KEP", "BABA", "JD", "MUFG", "INFY", "WIT",
    "NTTYY", "BUD", "SFTBY", "BHP", "BIDU", "PDD", "LI", "NIO", 

    # 🇪🇺 EUROPA - LÍDERES DE INDUSTRIA (ADRs en USD)
    "NVO", "SAP", "SHEL", "UL", "SNY", "BP", "DEO", "BTI", "GSK", "SAN", 
    "BBVA", "ING", "ASML", "CRH", "FLUT", "RELX", "HEINY", "RACE",

    # 🌎 LATAM (Brasil, México, Argentina - ADRs)
    "MELI", "PBR", "VALE", "NU", "ITUB", "AMX", "BBD", "BSBR", "FMX", "BAK", 

    # 📊 ETFS CLAVE
    "VOO", "SCHD", "HDV", "QQQ", "VT", "EEM", "VEA", "VUG", "VTV", "VNQ", "IYR"
]


OBTENER TOKENS GRATUITOS:
    Telegram Bot  → Habla con @BotFather en Telegram → /newbot
    Telegram ID   → Habla con @userinfobot → te dice tu chat_id
    Gemini Free   → https://aistudio.google.com/app/apikey (gratis, 60 req/min)
    Groq Free     → https://console.groq.com (gratis, 6000 tokens/min)

EJECUTAR:
    python quantum_bot.py

MEJORAS vs v1.0:
    ✅ Umbral dinámico basado en volatilidad histórica de cada activo
    ✅ Balanceo de clases en el modelo ML (class_weight="balanced")
    ✅ Rate limiting para yfinance (evita baneo de IP)
    ✅ Tarea de monitoreo intradía cada 30 min (solo horario de mercado)
    ✅ Chat conversacional con LLM (Gemini o Groq)
    ✅ Alertas proactivas por señales técnicas
    ✅ Comando /analizar, /portafolio, /alerta, /radar, /ayuda
"""

# ─────────────────────────────────────────────────────────────────────────────
# IMPORTS
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import re
import sys
import time
import warnings
import sqlite3

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ── .env ─────────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass   # Si no hay dotenv, usamos variables de entorno directamente

# ── yfinance ─────────────────────────────────────────────────────────────────
try:
    import yfinance as yf
    YFINANCE_OK = True
except ImportError:
    YFINANCE_OK = False

# ── scikit-learn ──────────────────────────────────────────────────────────────
try:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.model_selection import TimeSeriesSplit, cross_val_score
    from sklearn.preprocessing import StandardScaler
    SKLEARN_OK = True
except ImportError:
    SKLEARN_OK = False

# ─ matplotlib ─
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    MATPLOTLIB_OK = True
except ImportError:
    MATPLOTLIB_OK = False

# ── PyPortfolioOpt ────────────────────────────────────────────────────────────
try:
    from pypfopt import EfficientFrontier, expected_returns, risk_models
    PYPFOPT_OK = True
except ImportError:
    PYPFOPT_OK = False

# ── LLM providers ─────────────────────────────────────────────────────────────
try:
    import google.generativeai as genai
    GEMINI_OK = True
except ImportError:
    GEMINI_OK = False

try:
    from groq import Groq
    GROQ_OK = True
except ImportError:
    GROQ_OK = False

# ── Telegram ──────────────────────────────────────────────────────────────────
try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.ext import (
        Application,
        CommandHandler,
        MessageHandler,
        CallbackQueryHandler,
        ContextTypes,
        filters,
    )
    from telegram.constants import ParseMode
    TELEGRAM_OK = True
except ImportError:
    TELEGRAM_OK = False
    print("❌  python-telegram-bot no instalado.")
    print("    pip install 'python-telegram-bot[job-queue]'")

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("quantum_bot.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("quantum_bot")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("telegram").setLevel(logging.WARNING)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURACIÓN DESDE .env
# ─────────────────────────────────────────────────────────────────────────────

TELEGRAM_TOKEN  = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
TELEGRAM_ADMIN_ID = os.getenv("TELEGRAM_ADMIN_ID", "")  # <--- ESTA ES LA LÍNEA NUEVA
LLM_PROVIDER    = os.getenv("LLM_PROVIDER", "gemini").lower()   # "gemini" | "groq"
GEMINI_KEY      = os.getenv("GEMINI_API_KEY", "")
GROQ_KEY        = os.getenv("GROQ_API_KEY", "")

_pt = os.getenv("PORTFOLIO_TICKERS", "VOO,HDV,SCHD,JNJ,NVDA,TSLA,FTEC")
#_rt = os.getenv("RADAR_TICKERS",     "AAPL,MSFT,KHC,BRK-B,QQQ,GOOGL,VTI")

PORTFOLIO_TICKERS: list[str] = [t.strip().upper() for t in _pt.split(",") if t.strip()]
# Universo Masivo de Búsqueda Global (150 Activos)
RADAR_TICKERS = [
    # 🇨🇱 CHILE - ACCIONES (Bolsa de Santiago)
    "CHILE.SN", "BSANTANDER.SN", "ENELCHILE.SN", "CMPC.SN", "SQM-B.SN", 
    "LTM.SN", "COPEC.SN", "CENCOSUD.SN", "EMBONOR-B.SN", "ANDINA-B.SN", 
    "SMU.SN", "ENTEL.SN", "VAPORES.SN", "ITAUCL.SN", "AGUAS-A.SN", 
    "IAM.SN", "CAP.SN", "COLBUN.SN", "ECL.SN", "PARAUCO.SN", "MALLPLAZA.SN",
    "RIPLEY.SN", "FALABELLA.SN", "SONDA.SN", "CONCHATORO.SN", "CCU.SN",
    "SMCHILE-B.SN", "ILC.SN", "QUINENCO.SN", 

    # 🇺🇸 EE.UU. - TECH / GROWTH
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AMD", "NFLX", 
    "INTC", "QCOM", "AVGO", "CSCO", "ORCL", "CRM", "NOW", "ASML", "PANW",

    # 🇺🇸 EE.UU. - VALUE / DIVIDENDOS PERPETUOS
    "KO", "PEP", "JNJ", "PG", "PFE", "XOM", "CVX", "MCD", "HD", "VZ", "T", 
    "ABBV", "MRK", "BMY", "UNH", "CVS", "WMT", "COST", "TGT", "MO", "PM",

    # 🏦 FINANZAS / CONSUMO GLOBAL
    "JPM", "BAC", "WFC", "C", "GS", "MS", "V", "MA", "AXP", "BLK", "BX",

    # 🌏 ASIA EMERGENTE Y DESARROLLADA (ADRs en USD)
    "TSM", "SONY", "TM", "HMC", "KEP", "BABA", "JD", "MUFG", "INFY", "WIT",
    "NTTYY", "BUD", "SFTBY", "BHP", "BIDU", "PDD", "LI", "NIO", 

    # 🇪🇺 EUROPA - LÍDERES DE INDUSTRIA (ADRs en USD)
    "NVO", "SAP", "SHEL", "UL", "SNY", "BP", "DEO", "BTI", "GSK", "SAN", 
    "BBVA", "ING", "ASML", "CRH", "FLUT", "RELX", "HEINY", "RACE",

    # 🌎 LATAM (Brasil, México, Argentina - ADRs)
    "MELI", "PBR", "VALE", "NU", "ITUB", "AMX", "BBD", "BSBR", "FMX", "BAK", 

    # 📊 ETFS CLAVE
    "VOO", "SCHD", "HDV", "QQQ", "VT", "EEM", "VEA", "VUG", "VTV", "VNQ", "IYR"
]

def escanear_base_datos_local():
    """Lee el Data Lake local y calcula indicadores técnicos masivamente."""
    log.info("🔌 Conectando al Data Lake local (quantum_database.db)...")
    
    try:
        # 1. Abrimos la base de datos
        conn = sqlite3.connect("quantum_database.db")
        
        # 2. Extraemos todos los datos históricos de un solo golpe
        # Usamos SQL para ordenar todo por empresa y por fecha
        query = "SELECT * FROM precios_historicos ORDER BY ticker, date"
        df_historico = pd.read_sql(query, conn)
        conn.close()
        
        # Asegurarnos de que la columna fecha sea un formato de tiempo real
        df_historico['date'] = pd.to_datetime(df_historico['date'])
        
        log.info(f"✅ ¡Base de datos leída en milisegundos! Total de registros: {len(df_historico)}")
        return df_historico

    except Exception as e:
        log.error(f"❌ Error leyendo la base de datos local: {e}")
        return None

# Constantes financieras
RISK_FREE_RATE  = 0.04
TRADING_DAYS    = 252
MIN_HISTORY     = 80
MONITOR_INTERVAL_MIN = 30       # minutos entre escaneos intradía
MAX_TICKERS_PER_REQUEST = 15    # rate limit yfinance

# --- PERSISTENCIA DE DATOS ---
PORTFOLIO_FILE = "portfolio_quantities.json"

def load_watchlist() -> dict:
    """Carga la watchlist del archivo JSON."""
    if os.path.exists(PORTFOLIO_FILE):
        try:
            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                wl = json.load(f)
                for k, v in wl.items():
                    if isinstance(v, (int, float)):
                        wl[k] = {"qty": float(v), "cost": 0.0}
                return wl
        except Exception as e:
            log.error(f"Error leyendo {PORTFOLIO_FILE}: {e}")
    
    # Fallback init
    return {t: {"qty": 1.0, "cost": 0.0} for t in PORTFOLIO_TICKERS}

def save_watchlist(wl: dict):
    """Guarda la watchlist actual en el disco duro"""
    try:
        with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
            json.dump(wl, f, indent=4)
    except Exception as e:
        log.error(f"Error guardando {PORTFOLIO_FILE}: {e}")

COOLDOWN_FILE = "cooldown_list.json"

def load_cooldown_list() -> dict:
    """Carga la lista de cooldown y elimina registros > 4 días."""
    cooldown = {}
    if os.path.exists(COOLDOWN_FILE):
        try:
            with open(COOLDOWN_FILE, "r", encoding="utf-8") as f:
                raw_data = json.load(f)
            
            # Limpieza automática de > 4 días
            now = dt.datetime.utcnow().date()
            for ticker, date_str in raw_data.items():
                try:
                    record_date = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
                    if (now - record_date).days <= 4:
                        cooldown[ticker] = date_str
                except ValueError:
                    pass
        except Exception as e:
            log.error(f"Error leyendo {COOLDOWN_FILE}: {e}")
    return cooldown

def save_cooldown_list(cooldown: dict):
    """Guarda la lista de cooldown en disco."""
    try:
        with open(COOLDOWN_FILE, "w", encoding="utf-8") as f:
            json.dump(cooldown, f, indent=4)
    except Exception as e:
        log.error(f"Error guardando {COOLDOWN_FILE}: {e}")

def passes_momentum_and_volume(df_ticker: pd.DataFrame) -> bool:
    """
    Comprueba si un activo cumple Momentum (MACD Crossover o Inflexión RSI)
    y Confirmación de Volumen Institucional (RVOL > 1.1).
    df_ticker debe venir ordenado cronológicamente y contener al menos 20 filas.
    """
    if len(df_ticker) < 20:
        return False
        
    try:
        # Extraer últimas 20 filas para volumen promedio
        df_20 = df_ticker.tail(20)
        
        # 1. Filtro RVOL (Volume Institucional)
        vol_sma_20 = df_20['volume'].mean()
        vol_hoy = df_20['volume'].iloc[-1]
        
        if vol_sma_20 <= 0 or vol_hoy <= (vol_sma_20 * 1.1):
            return False # Falla RVOL
            
        # Extraer últimas 3 filas para Momentum
        df_3 = df_ticker.tail(3)
        if len(df_3) < 3:
            return False
            
        # 2A. MACD Crossover en los últimos 3 días
        macd_crossover = False
        for i in range(1, 3):
            macd_prev = df_3['macd'].iloc[i-1]
            sig_prev = df_3['macd_signal'].iloc[i-1]
            macd_curr = df_3['macd'].iloc[i]
            sig_curr = df_3['macd_signal'].iloc[i]
            
            if (macd_prev < sig_prev) and (macd_curr > sig_curr):
                macd_crossover = True
                break
                
        # 2B. Inflexión RSI
        rsi_hoy = df_3['rsi'].iloc[-1]
        rsi_t2 = df_3['rsi'].iloc[-3]
        
        rsi_inflection = (rsi_hoy < 50) and (rsi_hoy > rsi_t2)
        
        return macd_crossover or rsi_inflection
        
    except Exception as e:
        log.error(f"Error calculando momentum: {e}")
        return False

# Estado global del bot (Ahora con memoria persistente)
BOT_STATE: dict = {
    "watchlist":       load_watchlist(),
    "last_scan":       None,
    "alert_history":   [],          # últimas 50 alertas enviadas
    "predictions":     {},          # ticker → resultado predicción
    "rf_rate":         RISK_FREE_RATE,
}


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 1 — CAPA DE DATOS CON RATE LIMITING
# ─────────────────────────────────────────────────────────────────────────────

class DataFetcher:
    """
    Acceso a yfinance con:
    - Caché en memoria (evita descargas duplicadas)
    - Rate limiting (evita baneo de IP)
    - Reintentos automáticos con backoff exponencial
    """
    _cache:      dict[str, tuple[pd.DataFrame, float]] = {}   # key → (df, timestamp)
    _cache_ttl:  dict[str, int] = {
        "1d": 3600,    # datos diarios: caché 1 hora
        "15m": 300,    # datos 15min: caché 5 minutos
        "1h":  900,
    }
    _last_request: float = 0.0
    _min_interval: float = 0.5    # segundos mínimos entre requests

    @classmethod
    def _rate_limit(cls):
        """Pausa si la última request fue hace menos de _min_interval segundos."""
        elapsed = time.time() - cls._last_request
        if elapsed < cls._min_interval:
            time.sleep(cls._min_interval - elapsed)
        cls._last_request = time.time()

    @classmethod
    def _normalize_ticker(cls, ticker: str) -> str:
        """Autocorrige tickers locales para Yahoo Finance."""
        t = ticker.upper().strip()
        if t == "CHILE": return "CHILE.SN"
        if t.endswith(".CL"): return t.replace(".CL", ".SN")
        return t

    @classmethod
    def get_prices(
        cls,
        ticker:   str,
        period:   str = "1y",
        interval: str = "1d",
        retries:  int = 3,
    ) -> pd.DataFrame:
        ticker = cls._normalize_ticker(ticker)
        key = f"{ticker}|{period}|{interval}"
        ttl = cls._cache_ttl.get(interval, 600)

        # Verificar caché
        if key in cls._cache:
            df, ts = cls._cache[key]
            if time.time() - ts < ttl:
                return df

        if not YFINANCE_OK:
            return pd.DataFrame()

        for attempt in range(retries):
            try:
                cls._rate_limit()
                df = yf.download(
                    ticker,
                    period=period,
                    interval=interval,
                    auto_adjust=True,
                    progress=False,
                    multi_level_index=False
                )
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                df = df.dropna(how="all")
                if not df.empty:
                    cls._cache[key] = (df, time.time())
                    return df
            except Exception as exc:
                wait = 2 ** attempt
                log.warning(f"Intento {attempt+1}/{retries} falló para {ticker}: {exc}. Esperando {wait}s…")
                time.sleep(wait)
        log.error(f"No se pudieron descargar datos para {ticker}")
        return pd.DataFrame()

    @classmethod
    def get_close_batch(cls, tickers: list[str], period: str = "1y") -> pd.DataFrame:
        """
        Descarga en lotes para evitar saturar la API.
        Máximo MAX_TICKERS_PER_REQUEST tickers por llamada.
        """
        if not YFINANCE_OK or not tickers:
            return pd.DataFrame()
        tickers = [cls._normalize_ticker(t) for t in tickers]
        all_close = {}
        # Dividir en lotes
        for i in range(0, len(tickers), MAX_TICKERS_PER_REQUEST):
            batch = tickers[i:i + MAX_TICKERS_PER_REQUEST]
            for attempt in range(3):
                try:
                    cls._rate_limit()
                    raw = yf.download(batch, period=period, auto_adjust=True, progress=False)
                    if raw.empty:
                        break
                    close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
                    for t in batch:
                        if t in close.columns:
                            all_close[t] = close[t].dropna()
                    break
                except Exception as exc:
                    log.warning(f"Batch download intento {attempt+1}: {exc}")
                    time.sleep(2 ** attempt)
            time.sleep(0.5)   # pausa entre lotes
        if not all_close:
            return pd.DataFrame()
        return pd.DataFrame(all_close).dropna(how="all").ffill()

    @classmethod
    def get_info(cls, ticker: str) -> dict:
        """Extrae info fundamental del ticker. Caché de 24 horas."""
        ticker = cls._normalize_ticker(ticker)
        key = f"info|{ticker}"
        if key in cls._cache:
            _, ts = cls._cache[key]
            if time.time() - ts < 86400:
                return cls._cache[key][0]   # type: ignore
        if not YFINANCE_OK:
            return {}
        try:
            cls._rate_limit()
            info = yf.Ticker(ticker).info
            # --- Lógica Robusta de Dividend Yield ---
            raw_yield_pct = info.get("dividendYield")  # En YFinance, este campo YA ES un porcentaje (ej. 0.76 para 0.76%, o 4.94 para 4.94%)
            
            if raw_yield_pct is None:
                # El campo trailing suele venir en formato decimal (ej. 0.0076)
                raw_yield_dec = info.get("trailingAnnualDividendYield")
                if raw_yield_dec is not None:
                    raw_yield_pct = raw_yield_dec * 100.0
                    
            if raw_yield_pct is None:
                # Fallback matemático manual (resultado en decimal)
                div_rate = info.get("trailingAnnualDividendRate")
                price_c = info.get("currentPrice") or info.get("previousClose")
                if div_rate and price_c and price_c > 0:
                    raw_yield_pct = (div_rate / price_c) * 100.0
                    
            if raw_yield_pct is None:
                raw_yield_pct = 0.0
                
            # 4. Eliminación de Trampas de Valor (Cap a 0.0%)
            if raw_yield_pct > 40.0:
                log.warning(f"⚠️ Dividendo anómalo detectado para {ticker}: {raw_yield_pct:.1f}%. Asignando 0.0%.")
                raw_yield_pct = 0.0
            # ----------------------------------------

            # 5. Cálculo del Número de Graham y Margen de Seguridad
            eps = info.get("trailingEps")
            bv = info.get("bookValue")
            price_c = info.get("currentPrice") or info.get("previousClose")
            
            graham_number = None
            margin_safety = None
            
            if eps and bv and eps > 0 and bv > 0:
                import math
                graham_number = math.sqrt(22.5 * eps * bv)
                if price_c and price_c > 0:
                    margin_safety = ((graham_number - price_c) / graham_number) * 100.0
                    
            # 6. Dividend Growth (5y) y FCF Payout Ratio
            div_growth_5y = None
            fcf_payout_ratio = None
            
            try:
                # CAGR
                t_obj = yf.Ticker(ticker)
                divs = t_obj.dividends
                if not divs.empty:
                    divs_annual = divs.resample('YE').sum()
                    if len(divs_annual) >= 4:
                        recent = divs_annual.iloc[-6:-1]
                        if not recent.empty and recent.iloc[0] > 0:
                            # Filtrar anomalías
                            if recent.max() / recent.min() < 10:
                                cagr = (recent.iloc[-1] / recent.iloc[0]) ** (1/len(recent)) - 1
                                div_growth_5y = float(cagr * 100.0)

                # FCF Payout
                fcf = info.get("freeCashflow")
                sector = info.get("sector", "").lower()
                traditional_payout = info.get("payoutRatio")
                if traditional_payout is None: traditional_payout = 1.0
                
                if "financial" in sector or "bank" in sector or fcf is None or fcf <= 0:
                    fcf_payout_ratio = traditional_payout
                else:
                    shares = info.get("sharesOutstanding")
                    div_rate = info.get("trailingAnnualDividendRate")
                    if shares and div_rate and fcf > 0:
                        fcf_payout_ratio = float((div_rate * shares) / fcf)
                    else:
                        fcf_payout_ratio = traditional_payout
            except Exception as e:
                log.warning(f"No se pudo calcular métricas avanzadas de dividendo para {ticker}: {e}")
            
            result = {
                "name":         info.get("longName",         ticker),
                "pe_forward":   info.get("forwardPE",        None),
                "pe_trailing":  info.get("trailingPE",       None),
                "eps":          info.get("trailingEps",      None),
                "pb":           info.get("priceToBook",      None),
                "div_yield":    raw_yield_pct,
                "market_cap_b": (info.get("marketCap", 0) or 0) / 1e9,
                "beta":         info.get("beta",             None),
                "sector":       info.get("sector",           "N/A"),
                "52w_high":     info.get("fiftyTwoWeekHigh", None),
                "52w_low":      info.get("fiftyTwoWeekLow",  None),
                "currency":     info.get("currency",         "USD"),
                "payout_ratio": info.get("payoutRatio", 1.0), # Cuánto de su ganancia gasta en dividendos
                "profit_margin": info.get("profitMargins", 0.0), # Si realmente gana dinero
                "debt_to_equity": info.get("debtToEquity", 0.0),
                "graham_number": graham_number,
                "margin_safety": margin_safety,
                "div_growth_5y": div_growth_5y,
                "fcf_payout_ratio": fcf_payout_ratio,
            }
            cls._cache[key] = (result, time.time())  # type: ignore
            return result
        except Exception as exc:
            log.error(f"Error info {ticker}: {exc}")
            return {}

    @classmethod
    def get_risk_free_rate(cls) -> float:
        """Tasa libre de riesgo en tiempo real (^TNX)."""
        try:
            df = cls.get_prices("^TNX", period="5d", interval="1d")
            if not df.empty:
                rate = float(df["Close"].iloc[-1]) / 100.0
                if 0 < rate < 0.15:
                    return rate
        except Exception:
            pass
        return RISK_FREE_RATE

    @classmethod
    def clear_cache(cls):
        cls._cache.clear()
        log.info("Caché de datos limpiada.")


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 2 — ANÁLISIS TÉCNICO (con umbral dinámico)
# ─────────────────────────────────────────────────────────────────────────────

def _get_slope(y):
    if len(y) < 20: return np.nan
    x = np.arange(20)
    return float(np.mean((x - 9.5) * (y - np.mean(y))) / np.var(x))

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calcula RSI, EMA, MACD, Bollinger Bands, ATR, volatilidad."""
    if df.empty or "Close" not in df.columns:
        return df
    out   = df.copy()
    close = out["Close"]

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

    # Bollinger Bands
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    out["bb_upper"] = sma20 + 2 * std20
    out["bb_lower"] = sma20 - 2 * std20
    out["bb_pct_b"] = (close - out["bb_lower"]) / (out["bb_upper"] - out["bb_lower"] + 1e-9)

    # Volatilidad
    log_ret          = np.log(close / close.shift(1))
    out["vol_20d"]   = log_ret.rolling(20).std() * np.sqrt(TRADING_DAYS)
    out["ret_5d"]    = close.pct_change(5)
    out["ret_10d"]   = close.pct_change(10)
    out["roc_10"]    = (close / close.shift(10) - 1) * 100
    out["pvc_ema50"] = close / out["ema_50"] - 1
    out["pvc_ema200"] = close / out["ema_200"] - 1

    # ATR & ADX
    if "High" in out.columns and "Low" in out.columns:
        prev_close  = close.shift(1)
        tr = pd.concat([
            out["High"] - out["Low"],
            (out["High"] - prev_close).abs(),
            (out["Low"]  - prev_close).abs(),
        ], axis=1).max(axis=1)
        tr_smooth = tr.ewm(span=14, adjust=False).mean()
        out["atr_14"] = tr_smooth

        # ADX
        up_move = out["High"] - out["High"].shift(1)
        down_move = out["Low"].shift(1) - out["Low"]
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


def get_dynamic_threshold(df: pd.DataFrame, horizon: int = 10) -> float:
    """
    ✅ MEJORA v2.0: Umbral dinámico basado en volatilidad histórica.

    Problema del v1.0: usar 2% fijo penaliza activos defensivos como SGOV
    donde 2% en 10 días es prácticamente imposible.

    Solución: el umbral = volatilidad_diaria × √(horizon) × factor
    → Para SGOV (vol ~0.5% anual): umbral ≈ 0.05% × 3.16 ≈ 0.16%
    → Para TSLA (vol ~60% anual):  umbral ≈ 2.38% × 3.16 ≈ 7.5%

    factor=0.5 logra un buen balance entre señales "demasiado fáciles"
    (umbral muy bajo) y "casi imposibles" (umbral muy alto).
    """
    if df.empty or "Close" not in df.columns:
        return 0.02

    daily_vol = np.log(df["Close"] / df["Close"].shift(1)).std()
    if np.isnan(daily_vol) or daily_vol <= 0:
        return 0.02

    threshold = daily_vol * np.sqrt(horizon) * 0.5
    # Limitar entre 0.3% y 8%
    return float(np.clip(threshold, 0.003, 0.08))


def detect_signals(ticker: str, df_intraday: pd.DataFrame) -> Optional[dict]:
    """
    Detecta señales de compra/venta en datos intradía.
    Retorna dict con señal o None si no hay señal fuerte.
    """
    if df_intraday.empty or len(df_intraday) < 20:
        return None

    out   = compute_indicators(df_intraday)
    last  = out.iloc[-1]
    prev  = out.iloc[-2] if len(out) > 1 else last

    signals = []
    score   = 0  # positivo = alcista, negativo = bajista

    price     = float(last["Close"])
    rsi       = float(last.get("rsi", 50))
    macd      = float(last.get("macd", 0))
    macd_sig  = float(last.get("macd_signal", 0))
    bb_pct    = float(last.get("bb_pct_b", 0.5))
    pvc_ema50 = float(last.get("pvc_ema50", 0))

    prev_macd     = float(prev.get("macd", 0))
    prev_macd_sig = float(prev.get("macd_signal", 0))

    # RSI extremo
    if rsi < 30:
        score += 2; signals.append(f"RSI={rsi:.1f} (sobreventa)")
    elif rsi > 70:
        score -= 2; signals.append(f"RSI={rsi:.1f} (sobrecompra)")

    # Cruce MACD (alcista si cruza hacia arriba)
    if prev_macd <= prev_macd_sig and macd > macd_sig:
        score += 2; signals.append("Cruce MACD ▲ alcista")
    elif prev_macd >= prev_macd_sig and macd < macd_sig:
        score -= 2; signals.append("Cruce MACD ▼ bajista")

    # Bollinger Bands
    if bb_pct < 0:
        score += 1; signals.append(f"%B={bb_pct:.2f} (bajo banda inferior)")
    elif bb_pct > 1:
        score -= 1; signals.append(f"%B={bb_pct:.2f} (sobre banda superior)")

    # Posición vs EMA50
    if pvc_ema50 > 0.03:
        score += 1; signals.append(f"+{pvc_ema50*100:.1f}% sobre EMA50")
    elif pvc_ema50 < -0.03:
        score -= 1; signals.append(f"{pvc_ema50*100:.1f}% bajo EMA50")

    # Solo reportar si la señal es fuerte (|score| >= 3)
    if abs(score) < 3:
        return None

    direction = "🟢 COMPRA" if score > 0 else "🔴 VENTA"
    strength  = "FUERTE" if abs(score) >= 4 else "MODERADA"

    return {
        "ticker":    ticker,
        "price":     price,
        "direction": direction,
        "strength":  strength,
        "score":     score,
        "signals":   signals,
        "rsi":       rsi,
        "timestamp": dt.datetime.now().strftime("%H:%M"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 3 — MODELO PREDICTIVO MEJORADO
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PredResult:
    ticker:     str
    price:      float
    limit_price: float
    label:      str     # "ALCISTA 📈" | "BAJISTA 📉" | "NEUTRAL ➡️"
    confidence: float
    accuracy:   float
    threshold:  float   # umbral dinámico usado
    horizon:    int
    rsi:        float
    vol_20d:    float
    fund_score: float
    risk:       str
    backtest_msg: str   # <--- NUEVA VARIABLE DE BACKTESTING
    buy_limit:  float = 0.0
    sell_limit: float = 0.0
    timestamp:  str = field(default_factory=lambda: dt.datetime.now().isoformat())


FEATURE_COLS = [
    "rsi", "macd", "macd_signal", "macd_hist", "bb_pct_b",
    "vol_20d", "ret_5d", "roc_10", "pvc_ema50", "pvc_ema200",
    "adx_14", "slope_20d"
]

FUND_COLS = ["pe_forward", "pb", "div_yield", "beta"]


def predict_ticker(ticker: str, horizon: int = 90, rf: float = RISK_FREE_RATE) -> Optional[PredResult]:
    """
    Predice tendencia del ticker con:
    ✅ Umbral dinámico por volatilidad
    ✅ class_weight="balanced" para evitar sesgo alcista
    ✅ TimeSeriesSplit para evitar look-ahead bias
    """
    if not SKLEARN_OK:
        return None

    df_raw = DataFetcher.get_prices(ticker, period="3y", interval="1d")
    if df_raw.empty or len(df_raw) < MIN_HISTORY:
        log.warning(f"{ticker}: datos insuficientes")
        return None

    # Indicadores técnicos
    df = compute_indicators(df_raw)

    # Umbral dinámico ← MEJORA v2.0
    threshold = get_dynamic_threshold(df, horizon)
    log.info(f"{ticker}: umbral dinámico = {threshold*100:.3f}%")

    # Datos fundamentales
    info = DataFetcher.get_info(ticker)
    for col in FUND_COLS:
        df[col] = info.get(col, np.nan)
    df["rf_rate"] = rf

    # Target
    future_ret = df["Close"].pct_change(horizon).shift(-horizon)
    df["target"] = np.nan
    df.loc[future_ret > threshold, "target"] = 1
    df.loc[future_ret < -threshold, "target"] = -1
    df.loc[(future_ret >= -threshold) & (future_ret <= threshold), "target"] = 0

    available = [c for c in FEATURE_COLS + FUND_COLS + ["rf_rate"] if c in df.columns]
    
    # Rellenar con 0 los ratios fundamentales vacíos (vital para ETFs y fondos)
    for col in FUND_COLS:
        if col in df.columns:
            df[col] = df[col].fillna(0)
            
    df_clean  = df[available + ["target"]].dropna()
    if len(df_clean) < 60:
        log.warning(f"{ticker}: muestra limpia insuficiente ({len(df_clean)})")
        return None

    X = df_clean[available].values
    y = df_clean["target"].values

    # ✅ class_weight="balanced" para corregir sesgo alcista en mercados alcistas
    model = GradientBoostingClassifier(
        n_estimators=120,
        learning_rate=0.06,
        max_depth=3,
        min_samples_leaf=12,
        subsample=0.8,
        random_state=42,
        validation_fraction=0.1,
        n_iter_no_change=8,
    )

    scaler = StandardScaler()
    X_sc   = scaler.fit_transform(X)

    tscv      = TimeSeriesSplit(n_splits=4)
    cv_scores = cross_val_score(model, X_sc, y, cv=tscv, scoring="accuracy")
    accuracy  = float(cv_scores.mean())

    model.fit(X_sc, y)

    last_X      = df[available].iloc[-1].values.reshape(1, -1)
    last_X_sc   = scaler.transform(last_X)
    pred_class  = int(model.predict(last_X_sc)[0])
    pred_proba  = float(max(model.predict_proba(last_X_sc)[0]))

    label_map = {1: "ALCISTA 📈", -1: "BAJISTA 📉", 0: "NEUTRAL ➡️"}
    label = label_map.get(pred_class, "NEUTRAL ➡️")

    # Score fundamental
    fund_score = _fund_score(info)
    
    # REGLA DE SOBRESCRITURA (VALUE INVESTING & DIVIDENDS)
    yield_pct = info.get("div_yield") or 0.0
    
    es_perfil_dividendo = ticker.endswith(".SN") or yield_pct > 4.0
    if fund_score >= 7.0 and es_perfil_dividendo:
        label = "ACUMULACIÓN / COMPRA ESCALONADA 🛡️"
        pred_class = 1  # Forzar lógica de soporte de compra

    # Riesgo
    vol_20d = float(df["vol_20d"].dropna().iloc[-1]) if "vol_20d" in df.columns else 0.0
    beta    = info.get("beta")
    risk    = _classify_risk(vol_20d, beta)

    price = float(df["Close"].iloc[-1])
    rsi   = float(df["rsi"].dropna().iloc[-1]) if "rsi" in df.columns else 50.0
    atr   = float(df["atr_14"].dropna().iloc[-1]) if "atr_14" in df.columns else 0.0

    # Lógica de Precio Limit (Esperar un pequeño pullback usando el ATR)
    buy_limit = price - (atr * 0.5)
    sell_limit = price + (atr * 0.5)

    if pred_class == 1:    # Alcista (Compra)
        limit_price = buy_limit
    elif pred_class == -1: # Bajista (Venta)
        limit_price = sell_limit
    else:                  # Neutral
        limit_price = price

# Motor de Backtesting Histórico Rápido
    try:
        rsi_min, rsi_max = rsi - 5, rsi + 5
        # Buscar días en el pasado con RSI muy similar al de hoy
        similar_days = df[(df['rsi'] >= rsi_min) & (df['rsi'] <= rsi_max)]
        if len(similar_days) > 2:
            # Calcular qué pasó 'horizon' días después en esas ocasiones
            past_returns = similar_days['Close'].pct_change(horizon).shift(-horizon).dropna()
            win_rate = (past_returns > 0).mean() * 100
            median_ret = past_returns.median() * 100
            b_msg = f"En {len(past_returns)} ocasiones históricas con este mismo RSI, subió el {win_rate:.0f}% de las veces (Retorno típico: {median_ret:+.2f}% en {horizon} días)."
        else:
            b_msg = "Sin suficientes casos históricos similares para backtest."
    except Exception:
        b_msg = "Datos insuficientes para backtest."

    return PredResult(
        ticker      = ticker,
        price       = round(price, 4),
        limit_price = round(limit_price, 4),
        label       = label,
        confidence  = round(pred_proba, 4),
        accuracy    = round(accuracy, 4),
        threshold   = round(threshold, 5),
        horizon     = horizon,
        rsi         = round(rsi, 1),
        vol_20d     = round(vol_20d, 4),
        fund_score  = round(fund_score, 2),
        risk        = risk,
        backtest_msg= b_msg, # <--- SE ENVÍA EL MENSAJE AQUÍ
        buy_limit   = round(buy_limit, 4),
        sell_limit  = round(sell_limit, 4),
    )
   

def _fund_score(info: dict) -> float:
    s  = 0.0
    pe = info.get("pe_forward")
    pb = info.get("pb")
    dy = info.get("div_yield")
    b  = info.get("beta")
    if pe and 0 < pe < 25:  s += 2.5
    if pb and 0 < pb < 3:   s += 2.0
    if dy and dy > 2.0:     s += 2.0
    if b  and 0 < b  < 1:   s += 1.5   # beta < 1 = menos riesgo sistémico
    if b  and b > 2:         s -= 1.0
    return min(max(s, 0.0), 10.0)


def _classify_risk(vol: float, beta) -> str:
    if vol < 0.12:  base = "🟢 BAJO"
    elif vol < 0.25: base = "🟡 MEDIO"
    elif vol < 0.45: base = "🟠 ALTO"
    else:            base = "🔴 MUY ALTO"
    if beta and beta > 1.5:
        upgrades = {"🟢 BAJO":"🟡 MEDIO","🟡 MEDIO":"🟠 ALTO","🟠 ALTO":"🔴 MUY ALTO","🔴 MUY ALTO":"🔴 MUY ALTO"}
        base = upgrades.get(base, base)
    return base


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 4 — OPTIMIZACIÓN MARKOWITZ
# ─────────────────────────────────────────────────────────────────────────────

def optimize_portfolio(tickers: list[str], rf: float = RISK_FREE_RATE) -> dict:
    """
    Ejecuta optimización Markowitz y retorna dict con los resultados.
    Usa PyPortfolioOpt si está disponible, sino Monte Carlo.
    """
    close = DataFetcher.get_close_batch(tickers, period="2y")
    if close.empty:
        return {"error": "Sin datos"}

    available = [t for t in tickers if t in close.columns]
    close     = close[available]
    returns   = close.pct_change().dropna()

    if PYPFOPT_OK and len(available) >= 3:
        try:
            mu = expected_returns.mean_historical_return(close)
            S  = risk_models.CovarianceShrinkage(close).ledoit_wolf()
            ef = EfficientFrontier(mu, S, weight_bounds=(0.01, 0.60))
            ef.max_sharpe(risk_free_rate=rf)
            weights = ef.clean_weights()
            perf    = ef.portfolio_performance(verbose=False, risk_free_rate=rf)
            return {
                "method":    "Markowitz + Ledoit-Wolf",
                "weights":   {k: round(v, 4) for k, v in weights.items() if v > 0.005},
                "ret":       round(perf[0], 4),
                "vol":       round(perf[1], 4),
                "sharpe":    round(perf[2], 4),
            }
        except Exception as exc:
            log.error(f"PyPortfolioOpt falló: {exc}")

    # Fallback Monte Carlo
    mu  = returns.mean().values * TRADING_DAYS
    cov = returns.cov().values  * TRADING_DAYS
    n   = len(available)
    best_sharpe, best_w = -np.inf, np.ones(n) / n
    np.random.seed(42)
    for _ in range(3000):
        w   = np.random.dirichlet(np.ones(n))
        ret = float(w @ mu)
        vol = float(np.sqrt(w @ cov @ w))
        sh  = (ret - rf) / vol if vol > 0 else -np.inf
        if sh > best_sharpe:
            best_sharpe, best_w = sh, w
    return {
        "method":  "Monte Carlo (5k simulaciones)",
        "weights": {t: round(float(w), 4) for t, w in zip(available, best_w)},
        "ret":     round(float(best_w @ mu), 4),
        "vol":     round(float(np.sqrt(best_w @ cov @ best_w)), 4),
        "sharpe":  round(best_sharpe, 4),
    }


def portfolio_metrics(tickers: list[str], weights: Optional[dict] = None, rf: float = RISK_FREE_RATE) -> dict:
    """Calcula métricas del portafolio actual (Sharpe, VaR, MDD)."""
    close = DataFetcher.get_close_batch(tickers, period="2y")
    if close.empty:
        return {}

    avail = [t for t in tickers if t in close.columns]
    close = close[avail]
    ret   = close.pct_change().dropna()
    n     = len(avail)
    w     = np.array([weights.get(t, 1/n) for t in avail]) if weights else np.ones(n)/n
    w     = w / w.sum()

    mu    = ret.mean().values * TRADING_DAYS
    cov   = ret.cov().values  * TRADING_DAYS
    p_ret = float(w @ mu)
    p_vol = float(np.sqrt(w @ cov @ w))
    sharpe = (p_ret - rf) / p_vol if p_vol > 0 else 0

    port_series = (ret.values @ w)
    cum    = (1 + pd.Series(port_series)).cumprod()
    mdd    = float(((cum - cum.cummax()) / cum.cummax()).min())

    daily_vol = p_vol / np.sqrt(TRADING_DAYS)
    daily_ret = p_ret / TRADING_DAYS
    var_95    = daily_ret - 1.645 * daily_vol
    
    # 95% Confidence Interval (Annual)
    conf_95_low = p_ret - (1.96 * p_vol)
    conf_95_high = p_ret + (1.96 * p_vol)

    corr = ret.corr()
    high_corr = [
        f"{corr.columns[i]}↔{corr.columns[j]}: {corr.iloc[i,j]:.2f}"
        for i in range(n) for j in range(i+1, n)
        if abs(corr.iloc[i,j]) > 0.75
    ]
    
    port_yield = 0.0
    port_beta = 0.0
    for i, t in enumerate(avail):
        info = DataFetcher.get_info(t)
        y = info.get("div_yield") or 0.0
        b = info.get("beta")
        b = float(b) if b is not None else 1.0
        port_yield += y * w[i]
        port_beta += b * w[i]

    return {
        "tickers":    avail,
        "weights":    dict(zip(avail, w)),
        "ret":        round(p_ret, 4),
        "vol":        round(p_vol, 4),
        "sharpe":     round(sharpe, 4),
        "mdd":        round(mdd, 4),
        "var_95d":    round(var_95, 4),
        "high_corr":  high_corr,
        "conf_low":   round(conf_95_low, 4),
        "conf_high":  round(conf_95_high, 4),
        "yield":      round(port_yield, 2),
        "beta":       round(port_beta, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 5 — CLIENTE LLM (Gemini / Groq)
# ─────────────────────────────────────────────────────────────────────────────

class LLMClient:
    """
    Abstracción sobre Gemini y Groq para análisis conversacional.
    Usa el tier gratuito de ambos proveedores.
    """

    def __init__(self):
        self.provider = LLM_PROVIDER
        self._gemini_model = None
        self._groq_client  = None
        self._init_client()

    def _init_client(self):
        if self.provider == "gemini" and GEMINI_OK and GEMINI_KEY:
            try:
                genai.configure(api_key=GEMINI_KEY)
                
                # Le preguntamos a Google qué modelos existen hoy
                modelos = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
                
                # Elegimos el modelo más rápido disponible (flash) o el primero de la lista
                modelo_elegido = next((m for m in modelos if 'flash' in m), modelos[0] if modelos else "gemini-1.5-flash")
                
                self._gemini_model = genai.GenerativeModel(modelo_elegido)
                log.info(f"Gemini conectado exitosamente al modelo: {modelo_elegido} ✅")
            except Exception as exc:
                log.error(f"Error Gemini: {exc}")

        elif self.provider == "groq" and GROQ_OK and GROQ_KEY:
            try:
                self._groq_client = Groq(api_key=GROQ_KEY)
                log.info("Groq (llama3-8b-8192) inicializado ✅")
            except Exception as exc:
                log.error(f"Error Groq: {exc}")

        else:
            log.warning("LLM no configurado. Respuestas serán datos crudos.")

    def is_available(self) -> bool:
        return (self._gemini_model is not None) or (self._groq_client is not None)

    def query(self, prompt: str) -> str:
        """Envía prompt al LLM y retorna la respuesta."""
        if not self.is_available():
            return "⚠️ LLM no configurado. Configura GEMINI_API_KEY o GROQ_API_KEY en el .env"

        try:
            if self._gemini_model:
                resp = self._gemini_model.generate_content(prompt)
                return resp.text.strip()
            elif self._groq_client:
                resp = self._groq_client.chat.completions.create(
                    model="llama3-8b-8192",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=600,
                    temperature=0.3,
                )
                return resp.choices[0].message.content.strip()
        except Exception as exc:
            log.error(f"Error LLM: {exc}")
            return "⚠️ Error de conexión con la IA (posible límite de cuota excedido o timeout). Intenta más tarde."

    def analyze_ticker(
        self,
        ticker:    str,
        user_msg:  str,
        pred:      Optional[PredResult],
        info:      dict,
        portfolio: list[str],
    ) -> str:
        """
        Construye un prompt estructurado con los datos financieros
        y consulta al LLM para obtener un análisis conversacional.
        """
        # Datos técnicos actuales
        df = DataFetcher.get_prices(ticker, period="3y")
        if not df.empty:
            df_ind = compute_indicators(df)
            if not df_ind.empty:
                last   = df_ind.iloc[-1]
                price  = float(last.get("Close", last.get("close", 0)))
                rsi    = float(last.get("rsi", 50))
                distancia_ema200 = float(last.get("pvc_ema200", 0.0))
            else:
                price = rsi = distancia_ema200 = 0
        else:
            price = rsi = distancia_ema200 = 0

        # PASO 1: EXTRACCIÓN DE DATOS
        yield_pct = info.get('div_yield') or 0.0
        
        # PASO 2: EL SÚPER PROMPT MAESTRO
        prompt = f"""Actúa como un Comité de Inversión Institucional consolidando las metodologías de Citadel (Técnico), Bain (Ventaja Competitiva), Harvard (Dividendos) y JPMorgan (Proyecciones).
Tu objetivo es analizar {ticker} ({info.get('name', ticker)}) para el portafolio de Hernán. Responde ESTRICTAMENTE EN ESPAÑOL, usando texto plano (PROHIBIDO usar asteriscos o negritas de markdown), utilizando emojis como viñetas.

DATOS DUROS INYECTADOS:
- Precio Actual: ${price:.2f}
- P/E: {info.get('pe_forward', 'N/D')}
- Deuda/Equity: {info.get('debt_to_equity', 'N/D')}
- Dividend Yield: {yield_pct:.2f}% (FCF Payout: {info.get('fcf_payout_ratio', 'N/D')})
- RSI(14): {rsi:.1f}
- Posición vs EMA200: El precio está a una distancia de {distancia_ema200*100:.1f}% de su media móvil de 200 días.

EVALÚA Y RESPONDE CON ESTA ESTRUCTURA EXACTA:

🏛️ 1. VALORACIÓN Y FUNDAMENTALES (Estilo JPMorgan)
- Comparativa P/E: Menciona el P/E actual y compáralo explícitamente con el P/E promedio histórico de su sector. ¿Está alto, bajo o justo?
- Crecimiento: Analiza la tendencia de crecimiento de ingresos operacionales de los últimos 5 años (usa tu conocimiento de la empresa).
- Salud Financiera: Evalúa su Deuda sobre Capital actual. ¿Es un riesgo estructural?

💰 2. SOSTENIBILIDAD DEL DIVIDENDO (Estilo Harvard Endowment)
- Puntualidad y Consistencia: ¿Es una empresa que paga dividendos históricamente sin cortes abruptos? 
- Calificación de Seguridad: Asigna una nota del 1 al 10 a la seguridad de su dividendo basándote en su FCF Payout y su industria.

🏰 3. VENTAJA COMPETITIVA Y RIESGO (Estilo Bain & Bridgewater)
- Calificación de 'Moat' (Foso): Clasifícalo explícitamente como DÉBIL, MODERADO o FUERTE (evaluando marca, costos de cambio o efecto red).
- Calificación de Riesgo Global: Asigna un número del 1 al 10 (1 = Libre de riesgo, 10 = Quiebra inminente). Justifica con un riesgo clave.

🎯 4. ACCIÓN DEL PRECIO Y OBJETIVOS (Estilo Citadel)
- Acción del Precio: Interpreta el RSI y la EMA200 actuales. ¿Quién tiene el control, compradores o vendedores?
- Price Targets 12 Meses: Da una estimación de precio Alcista (Bull) y Bajista (Bear).
- Ejecución de Trading: Define una Zona de Entrada ideal (Rango de precios) y una sugerencia estricta de Stop-Loss.

Haz que el análisis sea implacable, objetivo y directo. No uses lenguaje de relleno."""

        return self.query(prompt)

    def analyze_portfolio(self, metrics: dict, predictions: list[PredResult]) -> str:
        """Análisis conversacional del portafolio completo."""
        weights = metrics.get("weights", {})
        
        preds_txt = "\n".join([
            f"  {p.ticker}: Peso {weights.get(p.ticker, 0.0)*100:.1f}% | {p.label} (conf {p.confidence*100:.0f}%, riesgo {p.risk})"
            for p in predictions[:15]
        ])

        prompt = f"""Actúa como un Asesor Financiero Cuantitativo Senior (CFA).
Analiza este portafolio y entrega un diagnóstico en español, aplicando un análisis ponderado, holístico y con sentido de proporción. 
Debes respetar estrictamente estas 5 reglas:
1. Filtro de Materialidad (Micro-posiciones): Ignora el ruido de posiciones que pesen < 2%. No generes alertas de riesgo sistémico ni rotación urgente por estas micro-posiciones.
2. Jerarquía de Análisis: Enfócate exclusivamente en las 5 posiciones principales y en riesgos por alta correlación sectorial (ej. ETFs superpuestos).
3. Contexto Estratégico (Value & Dividends): Asume que la fuerte concentración en el mercado chileno (.SN) es intencional para capturar dividendos (Value Investing). Evalúa la resiliencia de esos flujos de caja en lugar de penalizar la falta de diversificación geográfica.
4. Proyecciones Realistas: Mantén un tono conservador frente al "Retorno Esperado", advirtiendo sobre la reversión a la media y no extrapolando retornos pasados atípicos.
5. Precisión de Pesos: LEE LA TABLA DE PESOS CON PRECISIÓN. Bajo ninguna circunstancia asumas que un activo tiene 0.0% de peso si se encuentra en la lista. Reconoce los pesos menores al 2% como posiciones reales, pero aplícales la regla de materialidad.

MÉTRICAS DEL PORTAFOLIO:
- Retorno anual esperado: {metrics.get('ret',0)*100:.2f}%
- Volatilidad anual: {metrics.get('vol',0)*100:.2f}%
- Sharpe Ratio: {metrics.get('sharpe',0):.3f}
- Maximum Drawdown: {metrics.get('mdd',0)*100:.2f}%
- VaR 95% diario: {metrics.get('var_95d',0)*100:.3f}%
- Pares altamente correlacionados: {'; '.join(metrics.get('high_corr',['ninguno'])[:3])}

PREDICCIONES Y PESOS REALES POR ACTIVO:
{preds_txt}

Responde en 4 secciones claras (máximo 350 palabras).
IMPORTANTE: Responde estrictamente en texto plano. PROHIBIDO usar asteriscos (*), negritas, o subrayados (_). Usa emojis para estructurar visualmente.
1. 📊 Diagnóstico Estratégico (Top 5 y Contexto Value/Dividendos)
2. 🔗 Riesgos Estructurales (Correlaciones)
3. 💡 Recomendaciones (Ignorar <2%)
4. ⚠️ Proyecciones y Reversión a la Media"""

        return self.query(prompt)

# Instancia global del LLM
llm = LLMClient()
# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 6 — FORMATEO DE MENSAJES TELEGRAM
# ─────────────────────────────────────────────────────────────────────────────

def fmt_prediction(p: PredResult) -> str:
    conf_bar = "█" * int(p.confidence * 10) + "░" * (10 - int(p.confidence * 10))
    
    # Lógica visual para que siempre muestre zonas de compra y venta
    if "ALCISTA" in p.label:
        limit_str = f"🟢 Limit sugerido (COMPRA): `${p.buy_limit:,.4f}`\n🔴 Toma de Ganancias (Venta): `${p.sell_limit:,.4f}`"
    elif "BAJISTA" in p.label:
        limit_str = f"🔴 Limit sugerido (VENTA): `${p.sell_limit:,.4f}`\n🟢 Toma de Ganancias (Compra): `${p.buy_limit:,.4f}`"
    else:
        limit_str = f"⚪ Acción sugerida: `MANTENER`\n🟢 Zona ideal de Compra: `${p.buy_limit:,.4f}`\n🔴 Zona ideal de Venta: `${p.sell_limit:,.4f}`"

    return (
        f"📊 *{p.ticker}* — Análisis IA\n"
        f"{'─'*30}\n"
        f"💰 Precio Actual: `${p.price:,.4f}`\n"
        f"{limit_str}\n"
        f"📈 Tendencia: *{p.label}*\n"
        f"📶 Confianza: `{conf_bar}` {p.confidence*100:.1f}%\n"
        f"✅ Accuracy CV: `{p.accuracy*100:.1f}%`\n"
        f"📉 Horizonte: `{p.horizon} días`\n"
        f"📏 Umbral dinámico: `±{p.threshold*100:.3f}%`\n"
        f"🌡 RSI(14): `{p.rsi:.1f}` {'🔴 Sobrecompra' if p.rsi>70 else '🟢 Sobreventa' if p.rsi<30 else '🟡 Normal'}\n"
        f"💨 Volatilidad anual: `{p.vol_20d*100:.1f}%`\n"
        f"💎 Score Fundamental: `{p.fund_score:.1f}/10`\n"
        f"⚡ Riesgo: {p.risk}\n"
    )


def fmt_portfolio_metrics(m: dict, total_value: float = 0.0, exact_weights: dict = None) -> str:
    if "error" in m:
        return f"❌ Error: {m['error']}"
    sharpe_icon = "🟢" if m.get("sharpe",0) >= 1 else ("🟡" if m.get("sharpe",0) >= 0.5 else "🔴")
    lines = [
        f"📊 *Métricas de Tu Portafolio Real*",
        f"{'─'*30}",
        f"💵 Valor Estimado: `${total_value:,.0f} CLP`",
        f"📈 Retorno esperado: `{m.get('ret',0)*100:+.2f}%`",
        f"🎯 Rango 95% (1 año): `{m.get('conf_low',0)*100:+.2f}%` a `{m.get('conf_high',0)*100:+.2f}%`",
        f"📉 Volatilidad: `{m.get('vol',0)*100:.2f}%`",
        f"{sharpe_icon} Sharpe Ratio: `{m.get('sharpe',0):.3f}` {'(bueno)' if m.get('sharpe',0)>=1 else '(mejorable)'}",
        f"📊 Max Drawdown: `{m.get('mdd',0)*100:.2f}%`",
        f"⚠️ VaR 95% diario: `{m.get('var_95d',0)*100:.3f}%`",
        f"💰 Dividend Yield Total: `{m.get('yield',0):.2f}%`",
        f"⚖️ Beta del Portafolio: `{m.get('beta',0):.2f}`",
        f"{'─'*30}",
        f"⚖️ *Pesos Reales en Vivo:*",
    ]
    
    weights = exact_weights if exact_weights is not None else m.get("weights", {})
    for t, w in sorted(weights.items(), key=lambda x: -x[1]):
        bar = "█" * int(w * 20)
        lines.append(f"  `{t:<14}` {w*100:5.1f}%  {bar}")

    hc = m.get("high_corr", [])
    if hc:
        lines.append(f"\n🔗 *Alta correlación (diversificar):*")
        for pair in hc[:3]:
            lines.append(f"  ⚠️ `{pair}`")
    return "\n".join(lines)


def fmt_optimization(opt: dict) -> str:
    if "error" in opt:
        return f"❌ {opt['error']}"
    lines = [
        f"🎯 *Portafolio Óptimo ({opt.get('method','Markowitz')})*",
        f"{'─'*30}",
        f"📈 Retorno esperado: `{opt.get('ret',0)*100:.2f}%`",
        f"📉 Volatilidad: `{opt.get('vol',0)*100:.2f}%`",
        f"⚡ Sharpe Ratio: `{opt.get('sharpe',0):.3f}`",
        f"\n💼 *Pesos óptimos:*",
    ]
    weights = opt.get("weights", {})
    for t, w in sorted(weights.items(), key=lambda x: -x[1]):
        bar = "█" * int(w * 20)
        lines.append(f"  `{t:<8}` {w*100:5.1f}%  {bar}")
    return "\n".join(lines)


def fmt_signal_alert(sig: dict) -> str:
    return (
        f"🚨 *SEÑAL DE TRADING*\n"
        f"{'─'*30}\n"
        f"📌 Ticker: *{sig['ticker']}*\n"
        f"💰 Precio: `${sig['price']:.4f}`\n"
        f"🎯 Señal: *{sig['direction']}* ({sig['strength']})\n"
        f"🕐 Hora: `{sig['timestamp']}`\n"
        f"\n📋 *Razones:*\n"
        + "\n".join(f"  • {s}" for s in sig["signals"])
        + f"\n\n_Usa /analizar {sig['ticker']} para análisis completo_"
    )


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 7 — HANDLERS DE TELEGRAM
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Bienvenida con menú de comandos."""
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 Mi Portafolio", callback_data="portfolio")],
        [InlineKeyboardButton("🎯 Optimizar",      callback_data="optimize")],
        [InlineKeyboardButton("📡 Watchlist",      callback_data="watchlist")],
        [InlineKeyboardButton("❓ Ayuda",           callback_data="help")],
    ])
    await update.message.reply_text(
        "⚡ *QUANTUM PORTFOLIO BOT*\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "Bot de análisis cuantitativo de portafolios.\n\n"
        "📌 *Comandos disponibles:*\n"
        "  /analizar `TICKER` — Análisis IA completo\n"
        "  /portafolio — Métricas del portafolio actual\n"
        "  /optimizar — Portafolio óptimo (Markowitz)\n"
        "  /radar — Analizar activos candidatos\n"
        "  /alerta `TICKER` — Escanear señales ahora\n"
        "  /watchlist — Ver/editar lista de seguimiento\n"
        "  /ayuda — Esta ayuda\n\n"
        "💬 O simplemente *escríbeme* y detectaré el ticker automáticamente.",
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=kb,
    )


def generate_technical_chart(ticker: str, df: pd.DataFrame) -> Optional[str]:
    """Genera un gráfico técnico con Precio, SMA200 y RSI. Guarda la imagen y devuelve la ruta."""
    if not MATPLOTLIB_OK or df.empty:
        return None
    try:
        if 'SMA_200' not in df.columns:
            df['SMA_200'] = df['Close'].rolling(window=200).mean()
        if 'rsi' not in df.columns:
            delta = df['Close'].diff()
            gain = delta.clip(lower=0).ewm(com=13, min_periods=14).mean()
            loss = (-delta).clip(lower=0).ewm(com=13, min_periods=14).mean()
            df['rsi'] = 100 - (100 / (1 + gain / (loss + 1e-9)))

        df_plot = df.tail(90)
        if df_plot.empty: return None

        plt.style.use('dark_background')
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7, 5), sharex=True, gridspec_kw={'height_ratios': [3, 1]})

        # --- GRÁFICO SUPERIOR: PRECIO Y SMA 200 ---
        ax1.plot(df_plot.index, df_plot['Close'], color='#00ADB5', linewidth=2, label='Precio')
        
        if 'SMA_200' in df_plot.columns and not df_plot['SMA_200'].isnull().all():
            ax1.plot(df_plot.index, df_plot['SMA_200'], color='#FF9F43', linestyle='--', linewidth=1.2, label='SMA 200')

        last_date = df_plot.index[-1]
        last_price = df_plot['Close'].iloc[-1]
        ax1.scatter(last_date, last_price, color='#FFF', s=30, zorder=5)
        ax1.annotate(f"${last_price:,.2f}", (last_date, last_price), textcoords="offset points", 
                     xytext=(-15,10), ha='center', fontsize=9, fontweight='bold', color='#FFF')

        ax1.set_title(f"Análisis Técnico: {ticker}", fontsize=12, fontweight='bold', pad=10, color='#FFF')
        ax1.legend(loc='upper left', frameon=False, fontsize=8)
        ax1.grid(True, linestyle=':', alpha=0.2, color='#666')
        ax1.spines['top'].set_visible(False)
        ax1.spines['right'].set_visible(False)

        # --- GRÁFICO INFERIOR: RSI ---
        ax2.plot(df_plot.index, df_plot['rsi'], color='#393E46', linewidth=1)
        ax2.plot(df_plot.index, df_plot['rsi'], color='#00F5D4', linewidth=1.5, label='RSI(14)')
        
        ax2.axhline(70, color='#FF6B6B', linestyle=':', alpha=0.6, linewidth=1)
        ax2.axhline(30, color='#FF6B6B', linestyle=':', alpha=0.6, linewidth=1)
        
        ax2.fill_between(df_plot.index, df_plot['rsi'], 70, where=(df_plot['rsi'] >= 70), color='#FF6B6B', alpha=0.3)
        ax2.fill_between(df_plot.index, df_plot['rsi'], 30, where=(df_plot['rsi'] <= 30), color='#FF6B6B', alpha=0.3)
        
        ax2.set_ylim(10, 90)
        ax2.grid(True, linestyle=':', alpha=0.1, color='#666')
        ax2.spines['top'].set_visible(False)
        ax2.spines['right'].set_visible(False)

        fig.autofmt_xdate()
        plt.tight_layout()
        
        chart_path = f"temp_chart_{ticker}.png"
        plt.savefig(chart_path, bbox_inches='tight', dpi=150)
        plt.close(fig)
        return chart_path
    except Exception as e:
        log.error(f"Error en gráfico para {ticker}: {e}")
        return None

def generate_health_radar(ticker: str, info: dict, df: pd.DataFrame) -> Optional[str]:
    """Genera un gráfico de Radar (Spider Chart) evaluando 5 dimensiones del activo."""
    if not MATPLOTLIB_OK:
        return None
        
    try:
        import numpy as np
        
        # 1. VALOR
        pe = info.get("pe_forward") or info.get("pe_trailing") or 999
        margin_safety = info.get("margin_safety")
        val_score = 4
        if pe > 0 and pe < 15 and margin_safety and margin_safety > 20:
            val_score = 10
        elif pe > 0 and pe < 25 and margin_safety and margin_safety > 0:
            val_score = 7
        elif pe > 50 or (margin_safety and margin_safety < -20):
            val_score = 2
            
        # 2. DIVIDENDO
        yield_pct = info.get("div_yield", 0.0)
        payout = info.get("payout_ratio", 1.0)
        div_score = 1
        
        # Excepción Local
        if ticker.endswith(".SN") and yield_pct > 6.0:
            div_score = 10
        else:
            if yield_pct > 6.0 and payout < 0.8:
                div_score = 10
            elif yield_pct > 3.0:
                div_score = 7
            elif yield_pct > 0.0:
                div_score = 4
            
            if payout > 1.0 and div_score > 1:
                div_score -= 2

        # 3. SALUD
        debt = info.get("debt_to_equity", 0.0)
        sector = info.get("sector", "").lower()
        if "financial" in sector or "bank" in sector:
            health_score = 5
        else:
            if debt < 30: health_score = 10
            elif debt < 80: health_score = 8
            elif debt < 150: health_score = 5
            else: health_score = 2
            
        # Extraer indicadores de df
        price = df['Close'].iloc[-1] if not df.empty else 0
        sma = df['SMA_200'].iloc[-1] if 'SMA_200' in df.columns and not df['SMA_200'].empty else price
        rsi = df['rsi'].iloc[-1] if 'rsi' in df.columns and not df['rsi'].empty else 50
        
        # 4. TENDENCIA
        trend_score = 5
        if price > sma * 1.05: trend_score = 10
        elif price > sma: trend_score = 8
        elif price < sma * 0.85: trend_score = 2
        elif price < sma: trend_score = 4
        
        # 5. OPORTUNIDAD
        opp_score = 5
        if rsi < 30: opp_score = 10
        elif rsi < 45: opp_score = 8
        elif rsi > 70: opp_score = 2
        elif rsi > 60: opp_score = 4
        
        scores = [val_score, div_score, health_score, trend_score, opp_score]
        labels = ['VALOR', 'DIVIDENDO', 'SALUD', 'TENDENCIA', 'OPORTUNIDAD']
        
        # Radar Chart Logic
        num_vars = len(labels)
        angles = np.linspace(0, 2 * np.pi, num_vars, endpoint=False).tolist()
        scores += scores[:1]
        angles += angles[:1]
        
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(5, 5), subplot_kw=dict(polar=True))
        
        ax.plot(angles, scores, color='#00ADB5', linewidth=2)
        ax.fill(angles, scores, color='#00ADB5', alpha=0.4)
        
        ax.set_theta_offset(np.pi / 2)
        ax.set_theta_direction(-1)
        
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(labels, color='white', size=10, weight='bold')
        
        ax.set_ylim(0, 10)
        ax.set_yticks([2, 4, 6, 8, 10])
        ax.set_yticklabels(['2', '4', '6', '8', '10'], color='grey', size=8)
        ax.grid(color='#444444', linestyle=':', linewidth=0.5)
        ax.spines['polar'].set_color('#444444')
        
        plt.title(f"Radar Institucional: {ticker}", size=12, color='white', weight='bold', y=1.1)
        
        radar_path = f"temp_radar_{ticker}.png"
        plt.savefig(radar_path, bbox_inches='tight', dpi=150)
        plt.close(fig)
        
        return radar_path
    except Exception as e:
        log.error(f"Error generando radar chart para {ticker}: {e}")
        return None

async def send_analysis_with_chart(ctx, chat_id, ticker: str, text: str, df: pd.DataFrame, info: dict, temp_msg_id: int):
    """Envía el análisis integrando los gráficos en MediaGroup si es posible, respetando límites de Telegram."""
    try:
        await ctx.bot.delete_message(chat_id=chat_id, message_id=temp_msg_id)
    except Exception:
        pass
        
    chart_path = generate_technical_chart(ticker, df)
    radar_path = generate_health_radar(ticker, info, df)
    
    try:
        from telegram import InputMediaPhoto
        media_group = []
        
        if radar_path and os.path.exists(radar_path):
            if len(text) <= 1024:
                media_group.append(InputMediaPhoto(media=open(radar_path, 'rb'), caption=text, parse_mode=ParseMode.MARKDOWN))
            else:
                media_group.append(InputMediaPhoto(media=open(radar_path, 'rb')))
                
        if chart_path and os.path.exists(chart_path):
            if not media_group and len(text) <= 1024:
                media_group.append(InputMediaPhoto(media=open(chart_path, 'rb'), caption=text, parse_mode=ParseMode.MARKDOWN))
            else:
                media_group.append(InputMediaPhoto(media=open(chart_path, 'rb')))
                
        if media_group:
            await ctx.bot.send_media_group(chat_id=chat_id, media=media_group)
            if len(text) > 1024:
                await ctx.bot.send_message(chat_id=chat_id, text=text, parse_mode=ParseMode.MARKDOWN)
                
            if radar_path and os.path.exists(radar_path):
                os.remove(radar_path)
            if chart_path and os.path.exists(chart_path):
                os.remove(chart_path)
        else:
            await ctx.bot.send_message(chat_id=chat_id, text=text, parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        log.error(f"Error enviando análisis visual: {e}")
        await ctx.bot.send_message(chat_id=chat_id, text=text, parse_mode=ParseMode.MARKDOWN)

async def cmd_analizar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Análisis completo de un ticker: IA + Fundamentales + LLM."""
    args = ctx.args
    if not args:
        await update.message.reply_text("Uso: `/analizar TICKER`\nEjemplo: `/analizar AAPL`",
                                        parse_mode=ParseMode.MARKDOWN)
        return

    ticker = args[0].upper()
    msg    = await update.message.reply_text(f"🔍 Analizando *{ticker}*… (puede tardar 15-30s)",
                                              parse_mode=ParseMode.MARKDOWN)

    rf   = BOT_STATE["rf_rate"]
    pred = BOT_STATE["predictions"].get(ticker)

    # Calcular predicción si no está en caché
    if pred is None:
        pred = predict_ticker(ticker, horizon=90, rf=rf)
        if pred:
            BOT_STATE["predictions"][ticker] = pred

    info = DataFetcher.get_info(ticker)

    # Reporte técnico/fundamental
    if pred:
        report = fmt_prediction(pred)
    else:
        report = f"⚠️ No se pudo calcular predicción para *{ticker}*\n(datos insuficientes)\n"

    # Análisis LLM
    llm_response = ""
    if llm.is_available():
        await ctx.bot.edit_message_text(
            f"🧠 Consultando IA sobre *{ticker}*…",
            chat_id=msg.chat_id, message_id=msg.message_id,
            parse_mode=ParseMode.MARKDOWN,
        )
        llm_response = llm.analyze_ticker(
            ticker    = ticker,
            user_msg  = f"Analiza {ticker}",
            pred      = pred,
            info      = info,
            portfolio = BOT_STATE["watchlist"],
        )

    full_report = report
    if llm_response:
        full_report += f"\n{'─'*30}\n🧠 *Análisis IA ({LLM_PROVIDER.title()}):*\n\n{llm_response}"

    df_prices = DataFetcher.get_prices(ticker, period="3y")
    await send_analysis_with_chart(ctx, msg.chat_id, ticker, full_report, df_prices, info, msg.message_id)


async def cmd_portafolio(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Métricas cuantitativas del portafolio actual + análisis LLM."""
    tickers = list(BOT_STATE["watchlist"].keys())
    quantities = BOT_STATE["watchlist"]

    msg = await update.message.reply_text(
        f"📊 Calculando métricas reales para {len(tickers)} activos en base a mercado en vivo…", parse_mode=ParseMode.MARKDOWN
    )

    # Obtener tipo de cambio para normalizar a USD
    try:
        df_clp = DataFetcher.get_prices("CLP=X", period="5d")
        usd_clp = float(df_clp["Close"].dropna().iloc[-1]) if not df_clp.empty else 900.0
    except:
        usd_clp = 900.0

    # Calcular valor total y pesos exactos (normalizados a USD)
    close_prices = DataFetcher.get_close_batch(tickers, period="5d")
    total_value_usd = 0.0
    values_usd = {}
    for t in tickers:
        if t in close_prices.columns and not close_prices[t].empty:
            price = float(close_prices[t].dropna().iloc[-1])
            qty = quantities.get(t, 0.0)
            val = price * qty
            
            # Si es acción chilena, convertir de CLP a USD
            if t.endswith(".SN"):
                val = val / usd_clp
                
            values_usd[t] = val
            total_value_usd += val

    weights = {}
    if total_value_usd > 0:
        weights = {t: values_usd[t] / total_value_usd for t in tickers if t in values_usd}

    rf      = BOT_STATE["rf_rate"]
    metrics = portfolio_metrics(tickers, weights=weights, rf=rf)
    
    total_value_clp = total_value_usd * usd_clp
    report  = fmt_portfolio_metrics(metrics, total_value=total_value_clp, exact_weights=weights)

    # Predicciones de los activos del portafolio
    preds = []
    for t in tickers[:6]:   # Limitar para no tardar demasiado
        p = BOT_STATE["predictions"].get(t) or predict_ticker(t, rf=rf)
        if p:
            BOT_STATE["predictions"][t] = p
            preds.append(p)

    llm_analysis = ""
    if llm.is_available() and metrics and preds:
        await ctx.bot.edit_message_text(
            "🧠 Analizando portafolio con IA…",
            chat_id=msg.chat_id, message_id=msg.message_id, parse_mode=ParseMode.MARKDOWN,
        )
        llm_analysis = llm.analyze_portfolio(metrics, preds)

    full = report
    if llm_analysis:
        full += f"\n\n{'─'*30}\n🧠 *Diagnóstico IA:*\n\n{llm_analysis}"

    await ctx.bot.edit_message_text(
        full,
        chat_id=msg.chat_id, message_id=msg.message_id,
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_vender(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Comando /vender: Motor de gestión de riesgos y salida de posiciones."""
    tickers = list(BOT_STATE["watchlist"].keys())
    quantities = BOT_STATE["watchlist"]

    if not tickers:
        await update.message.reply_text("📉 Tu portafolio está vacío.", parse_mode=ParseMode.MARKDOWN)
        return

    msg = await update.message.reply_text(
        "🛡️ Inicializando Motor de Riesgos y Salida de Posiciones...", parse_mode=ParseMode.MARKDOWN
    )

    # 1. Obtener precios y datos
    close_prices = DataFetcher.get_close_batch(tickers, period="3y")
    total_value_usd = 0.0
    values_usd = {}
    
    try:
        df_clp = DataFetcher.get_prices("CLP=X", period="5d")
        usd_clp = float(df_clp["Close"].dropna().iloc[-1]) if not df_clp.empty else 900.0
    except:
        usd_clp = 900.0

    for t in tickers:
        if t in close_prices.columns and not close_prices[t].empty:
            price = float(close_prices[t].dropna().iloc[-1])
            data = quantities.get(t, {})
            qty = data.get("qty", 0.0) if isinstance(data, dict) else float(data)
            val = price * qty
            if t.endswith(".SN"):
                val = val / usd_clp
            values_usd[t] = val
            total_value_usd += val

    flagged_assets = []
    
    for t in tickers:
        if t not in close_prices.columns or close_prices[t].empty:
            continue
            
        df = close_prices[[t]].rename(columns={t: "Close"})
        df_ind = compute_indicators(df)
        if df_ind.empty:
            continue
            
        last = df_ind.iloc[-1]
        rsi = float(last.get("rsi", 50))
        pvc_ema200 = float(last.get("pvc_ema200", 0.0))
        
        info = DataFetcher.get_info(t)
        debt = info.get("debt_to_equity") or 0.0
        pe = info.get("pe_forward") or 0.0
        
        weight = values_usd.get(t, 0.0) / total_value_usd if total_value_usd > 0 else 0.0
        
        # Inmunidad de Micro-posiciones (< 1%)
        if weight < 0.01:
            continue
            
        ETF_LIST = ['VOO', 'QQQ', 'FTEC', 'SCHD', 'CFMITNIPSA.SN', 'SGOV', 'HDV']
        is_etf = t in ETF_LIST
        
        data = quantities.get(t, {})
        qty = data.get("qty", 0.0) if isinstance(data, dict) else float(data)
        cost = data.get("cost", 0.0) if isinstance(data, dict) else 0.0
        current_price = float(close_prices[t].dropna().iloc[-1])
        
        trigger_reasons = []
        
        # Alerta Técnica (Toma de Ganancias)
        rsi_threshold = 82 if is_etf else 70
        is_tech_overbought = False
        if rsi > rsi_threshold:
            is_tech_overbought = True
            trigger_reasons.append(f"RSI sobrecomprado ({rsi:.1f})")
        if pvc_ema200 > 0.20:
            is_tech_overbought = True
            trigger_reasons.append(f"Precio > 20% sobre SMA200 (+{pvc_ema200*100:.1f}%)")
            
        if is_tech_overbought:
            if cost > 0:
                ganancia_latente = (current_price - cost) * qty
                if ganancia_latente > 0:
                    acciones_a_vender = ganancia_latente / current_price
                    trigger_reasons[-1] += f". [VENTA PARCIAL] Sugerencia matemática: Vender {acciones_a_vender:.2f} acciones (Aprox. ${ganancia_latente:.2f}) para extraer ganancia neta."
            else:
                trigger_reasons[-1] += ". [VENTA PARCIAL] (Precio de compra no configurado, imposible calcular salida exacta)."
            
        # Alertas Fundamentales y Concentración (Solo para acciones individuales)
        if not is_etf:
            if debt > 150.0:
                trigger_reasons.append(f"Deuda Tóxica (D/E: {debt:.1f}%)")
            if pe > 60:
                trigger_reasons.append(f"Burbuja P/E ({pe:.1f}x)")
            if weight > 0.25:
                exceso_usd = (weight - 0.25) * total_value_usd
                acciones_exceso = exceso_usd / current_price
                trigger_reasons.append(f"Exceso de Concentración ({weight*100:.1f}%). [REBALANCEO] Sugerencia: Vender {acciones_exceso:.2f} acciones (Aprox. ${exceso_usd:.2f}) para volver al límite máximo.")
            
        if trigger_reasons:
            flagged_assets.append({
                "ticker": t,
                "reasons": trigger_reasons,
                "weight": weight
            })

    if not flagged_assets:
        await ctx.bot.edit_message_text(
            "🛡️ *Motor de Riesgos:* Tu portafolio está blindado. No se detectaron vulnerabilidades técnicas, fundamentales ni de concentración.",
            chat_id=msg.chat_id, message_id=msg.message_id, parse_mode=ParseMode.MARKDOWN
        )
        return

    flagged_text = "\n".join([
        f"- {f['ticker']} (Peso: {f['weight']*100:.1f}%): " + ", ".join(f['reasons'])
        for f in flagged_assets
    ])
    
    prompt = f"""Eres un Gestor de Riesgos Institucional. Tu único objetivo es proteger el capital y asegurar ganancias. Analiza los activos flaggeados y dictamina una recomendación directa. 
Usa solo tres etiquetas: 
- [VENTA PARCIAL]: Para asegurar utilidades en activos sobrecomprados (RSI alto). 
- [VENTA TOTAL]: Para activos con deterioro fundamental (Deuda alta/tendencia rota). 
- [REBALANCEO]: Para posiciones que pesan demasiado en la cartera. 
Justifica tu decisión usando exclusivamente la métrica de riesgo activada. Prohibido el relleno corporativo.

ACTIVOS EN PELIGRO:
{flagged_text}

IMPORTANTE: Responde estrictamente en texto plano. PROHIBIDO usar asteriscos (*), negritas, o subrayados (_). Usa emojis para estructurar visualmente."""

    if llm.is_available():
        await ctx.bot.edit_message_text(
            f"⚠️ Se detectaron vulnerabilidades en {len(flagged_assets)} activos. Consultando al Gestor de Riesgos de IA...",
            chat_id=msg.chat_id, message_id=msg.message_id, parse_mode=ParseMode.MARKDOWN
        )
        analisis_riesgo = llm.query(prompt)
        report_final = f"🚨 *ALERTAS DE RIESGO DEL PORTAFOLIO*\n{'─'*30}\n{analisis_riesgo}"
    else:
        report_final = f"🚨 *ALERTAS DE RIESGO (Sin IA)*\n{'─'*30}\n{flagged_text}"

    await ctx.bot.edit_message_text(
        report_final,
        chat_id=msg.chat_id, message_id=msg.message_id, parse_mode=ParseMode.MARKDOWN
    )


async def cmd_optimizar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Optimización de portafolio con Markowitz."""
    tickers = BOT_STATE["watchlist"]
    msg     = await update.message.reply_text(
        f"🎯 Optimizando portafolio con Markowitz ({len(tickers)} activos)…",
        parse_mode=ParseMode.MARKDOWN,
    )
    rf  = BOT_STATE["rf_rate"]
    opt = optimize_portfolio(tickers, rf=rf)
    await ctx.bot.edit_message_text(
        fmt_optimization(opt),
        chat_id=msg.chat_id, message_id=msg.message_id,
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_radar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Analiza activos en el radar para diversificación."""
    radar = RADAR_TICKERS[:6]   # Limitar a 6 para velocidad
    msg   = await update.message.reply_text(
        f"🔭 Escaneando {len(radar)} activos candidatos…",
        parse_mode=ParseMode.MARKDOWN,
    )

    rf    = BOT_STATE["rf_rate"]
    lines = ["🔭 *ACTIVOS EN EL RADAR*\n" + "─"*30]

    for ticker in radar:
        pred = predict_ticker(ticker, rf=rf)
        if pred:
            icon = "📈" if "ALCISTA" in pred.label else ("📉" if "BAJISTA" in pred.label else "➡️")
            lines.append(
                f"{icon} *{ticker}*: {pred.label} | "
                f"Conf: `{pred.confidence*100:.0f}%` | "
                f"Fund: `{pred.fund_score:.1f}/10` | "
                f"{pred.risk}"
            )
        else:
            lines.append(f"⚠️ *{ticker}*: sin datos suficientes")

    report = "\n".join(lines)
    report += "\n\n_Usa /analizar TICKER para análisis completo_"

    await ctx.bot.edit_message_text(
        report,
        chat_id=msg.chat_id, message_id=msg.message_id,
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_alerta(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Escanea señales técnicas para un ticker bajo demanda."""
    args   = ctx.args
    ticker = args[0].upper() if args else None

    targets = [ticker] if ticker else list(BOT_STATE["watchlist"].keys())[:5]
    msg     = await update.message.reply_text(
        f"🔍 Escaneando señales en {targets}…", parse_mode=ParseMode.MARKDOWN
    )

    found = []
    for t in targets:
        df    = DataFetcher.get_prices(t, period="3mo", interval="1d")
        sig   = detect_signals(t, df)
        if sig:
            found.append(sig)

    if found:
        for sig in found:
            await update.message.reply_text(
                fmt_signal_alert(sig), parse_mode=ParseMode.MARKDOWN
            )
    else:
        await ctx.bot.edit_message_text(
            "✅ Sin señales fuertes en este momento.",
            chat_id=msg.chat_id, message_id=msg.message_id,
        )


async def cmd_watchlist(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Muestra y permite editar la watchlist."""
    wl = list(BOT_STATE["watchlist"].keys())
    current = "`, `".join(wl)
    await update.message.reply_text(
        f"📡 *Watchlist actual:*\n`{current}`\n\n"
        f"Para agregar: escribe `+TICKER` (ej: `+AAPL`)\n"
        f"Para quitar: escribe `-TICKER` (ej: `-TSLA`)",
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_ayuda(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Menú de ayuda completo."""
    await update.message.reply_text(
        "⚡ *QUANTUM BOT — GUÍA RÁPIDA*\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "📊 */analizar TICKER*\n"
        "  Análisis técnico + fundamental + IA\n"
        "  Ejemplo: `/analizar AAPL`\n\n"
        "💼 */portafolio*\n"
        "  Sharpe, VaR, Drawdown + diagnóstico IA\n\n"
        "🎯 */optimizar*\n"
        "  Pesos óptimos de Markowitz\n\n"
        "🔭 */radar*\n"
        "  Candidatos para diversificar\n\n"
        "🚨 */alerta TICKER*\n"
        "  Señales RSI/MACD ahora mismo\n\n"
        "📡 */watchlist*\n"
        "  Ver/editar lista de seguimiento\n\n"
        "💬 *Chat libre:*\n"
        "  Escríbeme cualquier pregunta sobre un ticker\n"
        "  Ej: '¿Está caro Apple hoy?' o '¿Qué piensas de NVDA?'\n\n"
        "🔄 *Monitoreo automático:*\n"
        "  El bot escanea señales cada 30 min\n"
        "  (solo en horario de mercado NYSE)\n\n"
        f"🤖 LLM activo: *{LLM_PROVIDER.title()}* {'✅' if llm.is_available() else '❌'}",
        parse_mode=ParseMode.MARKDOWN,
    )


async def handle_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    Maneja mensajes de texto libre:
    1. Detecta si hay un ticker mencionado (AAPL, BTC-USD, etc.)
    2. Detecta comandos de watchlist (+TICKER, -TICKER)
    3. Si hay ticker -> análisis + LLM
    4. Si no hay ticker -> respuesta genérica de IA financiera
    """
    text  = update.message.text.strip()
    upper = text.upper()

    # ── Modificar watchlist ───────────────────────────────────────────────────
    if upper.startswith("+") and len(upper) <= 30:
        parts = upper[1:].strip().split()
        if parts:
            t = parts[0]
            qty = 1.0
            cost = 0.0
            if len(parts) >= 2:
                try: qty = float(parts[1])
                except: pass
            if len(parts) >= 3:
                try: cost = float(parts[2])
                except: pass
                
            if t not in BOT_STATE["watchlist"]:
                BOT_STATE["watchlist"][t] = {"qty": qty, "cost": cost}
                save_watchlist(BOT_STATE["watchlist"]) # <--- GUARDA EN DISCO
                await update.message.reply_text(f"✅ *{t}* agregado a la watchlist ({qty} a ${cost}).", parse_mode=ParseMode.MARKDOWN)
            else:
                BOT_STATE["watchlist"][t] = {"qty": qty, "cost": cost}
                save_watchlist(BOT_STATE["watchlist"])
                await update.message.reply_text(f"ℹ️ *{t}* actualizado en la watchlist ({qty} a ${cost}).", parse_mode=ParseMode.MARKDOWN)
        return

    if upper.startswith("-") and len(upper) <= 12:
        t = upper[1:].strip()
        if t in BOT_STATE["watchlist"]:
            del BOT_STATE["watchlist"][t]
            save_watchlist(BOT_STATE["watchlist"]) # <--- GUARDA EN DISCO
            await update.message.reply_text(f"🗑️ *{t}* eliminado de la watchlist y guardado.", parse_mode=ParseMode.MARKDOWN)
        return

    # ── Detectar ticker en el mensaje ─────────────────────────────────────────
    # Patrón: 1-6 letras mayúsculas, posiblemente con guión (BRK-B, BTC-USD)
    ticker_pattern = re.compile(r'\b([A-Z]{1,6}(?:-[A-Z0-9]{1,4})?)\b')
    # Convertir el mensaje a mayúsculas solo para buscar
    potential = ticker_pattern.findall(upper)

    # Filtrar palabras comunes que no son tickers
    stop_words = {
        "DE", "LA", "EL", "EN", "LO", "LE", "SE", "ME", "MI", "TU",
        "QUE", "POR", "CON", "SIN", "HOY", "VER", "HAY", "MUY",
        "SI", "NO", "YA", "SOY", "CEO", "USA", "USD", "EUR", "CLP",
        "ETF", "AI", "IA", "API", "BOT", "RSI", "EMA", "PE", "EPS",
    }
    tickers_found = [t for t in potential if t not in stop_words and len(t) >= 2]

    if tickers_found:
        ticker = tickers_found[0]
        msg    = await update.message.reply_text(
            f"🔍 Detecté que preguntas sobre *{ticker}*. Analizando…",
            parse_mode=ParseMode.MARKDOWN,
        )
        rf   = BOT_STATE["rf_rate"]
        pred = BOT_STATE["predictions"].get(ticker) or predict_ticker(ticker, rf=rf)
        if pred:
            BOT_STATE["predictions"][ticker] = pred

        info = DataFetcher.get_info(ticker)

        if llm.is_available():
            await ctx.bot.edit_message_text(
                f"🧠 Consultando IA sobre *{ticker}*…",
                chat_id=msg.chat_id, message_id=msg.message_id,
                parse_mode=ParseMode.MARKDOWN,
            )
            response = llm.analyze_ticker(ticker, text, pred, info, list(BOT_STATE["watchlist"].keys()))
            output   = (fmt_prediction(pred) + f"\n{'─'*30}\n🧠 *IA:*\n\n{response}") if pred else response
        else:
            output = fmt_prediction(pred) if pred else f"⚠️ Sin datos suficientes para *{ticker}*"

        df_prices = DataFetcher.get_prices(ticker, period="3y")
        await send_analysis_with_chart(ctx, msg.chat_id, ticker, output, df_prices, info, msg.message_id)
        return

    # ── Sin ticker detectado — consulta financiera genérica ───────────────────
    if llm.is_available():
        msg = await update.message.reply_text("💭 Consultando IA…")
        prompt = (
            f"Eres un asesor financiero cuantitativo (nivel CFA). "
            f"Responde en español, de forma concisa (máx 200 palabras): {text}"
        )
        response = llm.query(prompt)
        await ctx.bot.edit_message_text(
            f"🧠 {response}",
            chat_id=msg.chat_id, message_id=msg.message_id,
        )
    else:
        await update.message.reply_text(
            "💡 Usa `/analizar TICKER` para análisis completo.\n"
            "Ejemplo: `/analizar AAPL`",
            parse_mode=ParseMode.MARKDOWN,
        )



async def handle_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Maneja los botones inline del menú."""
    query = update.callback_query
    await query.answer()
    data  = query.data

    if data == "portfolio":
        await cmd_portafolio(query, ctx)
    elif data == "optimize":
        await cmd_optimizar(query, ctx)
    elif data == "watchlist":
        await cmd_watchlist(query, ctx)
    elif data == "help":
        await cmd_ayuda(query, ctx)


# ── Automatización Proactiva (Escáner de las 8:00 AM) ─────────────────────────

import time
import random
import asyncio

async def job_morning_screener(ctx: ContextTypes.DEFAULT_TYPE):
    """Tarea automática de las 8:00 AM: Escaneo masivo ultrarrápido desde SQLite"""
    chat_id_destino = ctx.job.data if (ctx.job and ctx.job.data) else "1620120310"

    log.info("⏰ Iniciando escaneo proactivo de mercado...")
    candidatos = []
    
    # 1. Cargamos TODOS los datos de la base local
    df_db = escanear_base_datos_local()
    if df_db is None or df_db.empty:
        log.error("❌ La base de datos está vacía o no se pudo leer.")
        return

    # 2. Cargar memoria anti-repetición
    cooldown_list = load_cooldown_list()

    # OPTIMIZACIÓN EXTREMA: Extraemos la última fecha de cada empresa de un solo golpe
    df_lasts = df_db.groupby('ticker').last().reset_index()
    
    # Aseguramos que el RSI sea un número legible
    df_lasts['rsi'] = pd.to_numeric(df_lasts['rsi'], errors='coerce').fillna(50.0)
    
    # Pre-Filtro: Sobreventa básica y exclusión por Cooldown
    tickers_validos = []
    for row in df_lasts.itertuples():
        t = str(row.ticker).upper().strip()
        t_norm = t.replace(".CL", ".SN") if t.endswith(".CL") else t
        if float(row.rsi) < 50 and t_norm not in cooldown_list:
            tickers_validos.append(row.ticker)
            
    df_pre_filtrado = df_lasts[df_lasts['ticker'].isin(tickers_validos)]
    log.info(f"💡 De {len(df_lasts)} activos, {len(df_pre_filtrado)} pasaron pre-filtro (RSI < 50 y fuera de cooldown).")

    # Filtro Avanzado: Momentum y Confirmación de Volumen (RVOL)
    df_db_filtrado = df_db[df_db['ticker'].isin(tickers_validos)]
    tickers_finales = []
    
    for ticker, df_ticker in df_db_filtrado.groupby('ticker'):
        if passes_momentum_and_volume(df_ticker):
            tickers_finales.append(ticker)
            
    df_final = df_pre_filtrado[df_pre_filtrado['ticker'].isin(tickers_finales)]
    log.info(f"🚀 Sobrevivieron al filtro estricto de Momentum y RVOL: {len(df_final)}")

    # Iteramos sobre las empresas que pasaron todos los filtros cuantitativos
    for row in df_final.itertuples():
        ticker = str(row.ticker).upper().strip()
        # Auto-corrección para Yahoo Finance (La base local puede tener .CL, pero YF usa .SN para Chile)
        if ticker.endswith(".CL"):
            ticker = ticker.replace(".CL", ".SN")
            
        price = float(row.close)
        rsi = float(row.rsi)
        
        try:
            # Extracción de Tendencia (EMA 200)
            distancia_ema200 = float(row.pvc_ema200) if hasattr(row, 'pvc_ema200') and pd.notna(row.pvc_ema200) else 0.0
                
            # Filtro Base 1: Liquidez Mínima (Volumen Transado Diario > 500k USD o 450M CLP)
            volumen_nominal = float(row.volume) * price if hasattr(row, 'volume') and pd.notna(row.volume) else 0.0
            if ticker.endswith(".SN") and volumen_nominal < 450_000_000:
                continue
            elif not ticker.endswith(".SN") and volumen_nominal < 500_000:
                continue

            # Filtro 100% Técnico (Relajado)
            # 1. Tendencia: Permite caídas de hasta 10% por debajo de la EMA200 (captura correcciones más profundas)
            if distancia_ema200 < -0.10:
                continue
                
            # 2. Oportunidad: Busca consolidaciones o retrocesos normales (RSI < 50), ya no exige pánico extremo
            if rsi > 50:
                continue
                
            # Score puramente técnico de momentum
            score = (50 - rsi) + (distancia_ema200 * 100)

            candidatos.append({
                'ticker': ticker, 'score': score, 'price': price, 
                'rsi': rsi, 'distancia_ema200': distancia_ema200
            })
        except Exception:
            continue

    if not candidatos:
        await ctx.bot.send_message(
            chat_id=chat_id_destino, 
            text="📉 *Reporte Matutino:* El mercado global no presenta oportunidades de alto valor con los filtros estrictos actuales.",
            parse_mode=ParseMode.MARKDOWN
        )
        return

    # Top 5 de las mejores oportunidades ordenadas con prioridad al Score Técnico
    candidatos = sorted(candidatos, key=lambda x: x['score'], reverse=True)[:5]
    
    # Registrar en memoria anti-repetición (Cooldown)
    today_str = dt.datetime.utcnow().strftime("%Y-%m-%d")
    for c in candidatos:
        cooldown_list[c['ticker']] = today_str
    save_cooldown_list(cooldown_list)

    prompt_candidatos = "\n".join([f"- {c['ticker']}: Precio ${c['price']:.2f}, RSI {c['rsi']:.1f}, Distancia EMA200 {c['distancia_ema200']*100:.1f}%, Score {c['score']:.1f}" for c in candidatos])
    
    prompt_macro = f"""Eres el Estratega Jefe del Fondo de Inversión. Tienes en tu escritorio el reporte del equipo Quant con las 5 máximas anomalías del mercado hoy:
{prompt_candidatos}

Tu trabajo es filtrar el ruido y entregar el reporte ejecutivo de pre-apertura aplicando los frameworks de Renaissance (Anomalías), Bain (Foso Competitivo) y Citadel (Setup Técnico).
Responde ESTRICTAMENTE EN ESPAÑOL, en texto plano (PROHIBIDO usar asteriscos, negritas o subrayados de markdown), estructurando con emojis. SÉ MUY BREVE Y EJECUTIVO (MÁXIMO 150 PALABRAS EN TOTAL).

ESTRUCTURA OBLIGATORIA:

🔭 1. VISIÓN DEL RADAR (Estilo Renaissance)
- Diagnóstico general: ¿Qué patrón técnico unifica a estos 5 activos hoy? Habla de la discrepancia matemática entre su RSI castigado y su tendencia mayor (distancia EMA200). 

🏆 2. LA SELECCIÓN DEL FONDO (Estilo Bain & Harvard)
- La Ganadora: Elige UNA sola acción como la mejor oportunidad asimétrica.
- Justificación del Foso (Moat): Explica por qué el modelo de negocio de esta empresa específica tiene ventajas competitivas más fuertes que el resto para sobrevivir esta caída.
- Resiliencia: Si paga dividendos, menciona cómo su flujo de caja protege la entrada. (Nota: Si es chilena .SN, valora su historial de Yield).

🎯 3. SETUP CUANTITATIVO (Estilo Citadel)
- Zona de entrada táctica.
- Amenaza Macro: Un factor macroeconómico real (tasas, geopolítica, commodities) que debamos vigilar para este sector.
- Nivel de Invalidación Técnico (Stop-Loss estricto si se rompe la tesis)."""

    try:
        analisis_ia = llm.query(prompt_macro)
        
        reporte_final = f"☀️ *INFORME DE MERCADO GLOBAL*\n{'─'*40}\n"
        reporte_final += "El Data Warehouse analizó ~600 activos en milisegundos. Top 5 anomalías técnicas encontradas:\n\n"
        for c in candidatos:
            reporte_final += f"📍 *{c['ticker']}* | Cotización: ${c['price']:.2f} | RSI: {c['rsi']:.1f} | Dist EMA200: {c['distancia_ema200']*100:.1f}%\n"
        
        reporte_final += f"\n🧠 *PERSPECTIVA TÉCNICA (PRICE ACTION):*\n{analisis_ia}"
        
        # Telegram limit is 4096. We chunk at 4000 to be safe.
        chunk_size = 4000
        if len(reporte_final) > chunk_size:
            for i in range(0, len(reporte_final), chunk_size):
                chunk = reporte_final[i:i+chunk_size]
                await ctx.bot.send_message(chat_id=chat_id_destino, text=chunk, parse_mode=ParseMode.MARKDOWN)
        else:
            await ctx.bot.send_message(chat_id=chat_id_destino, text=reporte_final, parse_mode=ParseMode.MARKDOWN)
            
        log.info("✅ Reporte proactivo enviado con éxito.")
    except Exception as e:
        log.error(f"Error en la generación del reporte: {e}")


# ── Comando para escaneo manual ───────────────────────────────────────────────

async def cmd_escanear_ahora(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Comando manual para forzar el escaneo masivo global."""
    if not TELEGRAM_CHAT_ID:
        await update.message.reply_text("❌ Falta configurar TELEGRAM_CHAT_ID en .env")
        return

    await update.message.reply_text(
        "🚀 *Iniciando escaneo global ultrarrápido...*\n"
        "Leyendo la base de datos local. El reporte de IA llegará en breves segundos ⚡",
        parse_mode=ParseMode.MARKDOWN
    )
    
    # Lanzamos el trabajo pesado y le pasamos tu ID real
    if ctx.job_queue is not None:
        ctx.job_queue.run_once(job_morning_screener, 1, data=update.effective_chat.id)
    else:
        await update.message.reply_text("⚠️ Error: JobQueue no está disponible.")
# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 8 — TAREA DE MONITOREO INTRADÍA (Background Job)
# ─────────────────────────────────────────────────────────────────────────────

def _is_market_open() -> bool:
    """
    Verifica si el mercado NYSE está abierto.
    Horario: Lunes-Viernes 9:30–16:00 ET (UTC-4 o UTC-5 según DST).
    Simplificación: comprobamos hora UTC y convertimos.
    """
    now_utc    = dt.datetime.utcnow()
    weekday    = now_utc.weekday()   # 0=Lunes, 6=Domingo
    if weekday >= 5:   # Fin de semana
        return False

    # NYSE abre 9:30 AM ET = 13:30 UTC (verano) / 14:30 UTC (invierno)
    # Usamos 13:00-21:00 UTC como ventana conservadora
    hour_utc = now_utc.hour + now_utc.minute / 60
    return 13.0 <= hour_utc <= 21.0


async def monitoring_job(ctx: ContextTypes.DEFAULT_TYPE):
    """
    Tarea periódica: escanea señales técnicas en la watchlist.
    Se ejecuta cada MONITOR_INTERVAL_MIN minutos, solo en horario de mercado.
    """
    if not _is_market_open():
        log.info("Mercado cerrado — monitoreo suspendido.")
        return

    log.info("⏱ Ejecutando escaneo intradía…")
    BOT_STATE["last_scan"] = dt.datetime.now().strftime("%H:%M")

    watchlist = list(BOT_STATE["watchlist"].keys())
    alerts_sent = 0

    for ticker in watchlist:
        try:
            # Datos intradía en velas de 15 minutos
            df = DataFetcher.get_prices(ticker, period="5d", interval="15m")
            if df.empty:
                continue

            sig = detect_signals(ticker, df)
            if not sig:
                continue

            # Anti-spam: no enviar la misma alerta dos veces en 2 horas
            recent_alerts = BOT_STATE["alert_history"][-20:]
            alert_key     = f"{ticker}_{sig['direction']}"
            if any(a.get("key") == alert_key and
                   (dt.datetime.now() - a["time"]).seconds < 7200
                   for a in recent_alerts):
                continue

            # Enviar alerta
            if TELEGRAM_CHAT_ID:
                await ctx.bot.send_message(
                    chat_id    = TELEGRAM_CHAT_ID,
                    text       = fmt_signal_alert(sig),
                    parse_mode = ParseMode.MARKDOWN,
                )
                BOT_STATE["alert_history"].append({
                    "key":  alert_key,
                    "time": dt.datetime.now(),
                    "sig":  sig,
                })
                # Mantener solo las últimas 50 alertas
                BOT_STATE["alert_history"] = BOT_STATE["alert_history"][-50:]
                alerts_sent += 1
                log.info(f"🚨 Alerta enviada: {ticker} {sig['direction']}")

            await asyncio.sleep(0.3)   # Pequeña pausa entre tickers

        except Exception as exc:
            log.error(f"Error monitoreando {ticker}: {exc}")

    log.info(f"✅ Escaneo completado. {alerts_sent} alertas enviadas.")


async def daily_summary_job(ctx: ContextTypes.DEFAULT_TYPE):
    """
    Resumen diario enviado a las 18:05 hora de Santiago (horario NYSE cierre).
    Calcula predicciones frescas para el portafolio.
    """
    if not _is_market_open():
        return

    log.info("📊 Generando resumen diario…")

    rf      = DataFetcher.get_risk_free_rate()
    BOT_STATE["rf_rate"] = rf
    tickers = list(BOT_STATE["watchlist"].keys())[:8]

    lines   = [f"📊 *RESUMEN DIARIO — {dt.date.today().strftime('%d/%m/%Y')}*\n" + "─"*30]
    lines.append(f"📌 Rf (^TNX): `{rf*100:.2f}%`\n")

    for t in tickers:
        pred = predict_ticker(t, rf=rf)
        if pred:
            BOT_STATE["predictions"][t] = pred
            icon = "📈" if "ALCISTA" in pred.label else ("📉" if "BAJISTA" in pred.label else "➡️")
            lines.append(
                f"{icon} *{t}*: {pred.label} | "
                f"RSI `{pred.rsi:.0f}` | "
                f"Conf `{pred.confidence*100:.0f}%`"
            )

    lines.append(f"\n🕐 Próximo escaneo: en {MONITOR_INTERVAL_MIN} min")
    lines.append("_Usa /portafolio para análisis completo_")

    if TELEGRAM_CHAT_ID:
        await ctx.bot.send_message(
            chat_id    = TELEGRAM_CHAT_ID,
            text       = "\n".join(lines),
            parse_mode = ParseMode.MARKDOWN,
        )


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 9 — GENERADOR DE .env INTERACTIVO
# ─────────────────────────────────────────────────────────────────────────────

def setup_env():
    """Guía interactiva para crear el archivo .env si no existe."""
    env_path = Path(".env")
    if env_path.exists():
        print("✅ .env ya existe.")
        return

    print("""
╔══════════════════════════════════════════════════════════════════╗
║  CONFIGURACIÓN INICIAL — Quantum Portfolio Bot                   ║
╚══════════════════════════════════════════════════════════════════╝

Necesitas 2 cosas:
  1. Token del bot de Telegram  → Habla con @BotFather en Telegram
  2. API Key de IA GRATUITA:
       Gemini → https://aistudio.google.com/app/apikey
       Groq   → https://console.groq.com

Para obtener tu CHAT_ID:
  Habla con @userinfobot en Telegram → te muestra tu ID numérico.
""")

    token   = input("🤖 Token de Telegram (@BotFather): ").strip()
    chat_id = input("💬 Tu Chat ID (@userinfobot):       ").strip()

    print("\nElige proveedor de IA gratuita:")
    print("  1. Gemini (recomendado — 60 req/min gratis)")
    print("  2. Groq   (muy rápido — llama3 gratis)")
    choice   = input("Opción (1/2): ").strip()
    provider = "gemini" if choice == "1" else "groq"

    api_key = input(f"🔑 API Key de {provider.title()}: ").strip()

    tickers = input(
        "\n📊 Tickers de tu portafolio (separados por coma)\n"
        "  [Enter para usar demo: VOO,HDV,SCHD,JNJ,NVDA,TSLA,FTEC]: "
    ).strip() or "VOO,HDV,SCHD,JNJ,NVDA,TSLA,FTEC"

    radar = input(
        "🔭 Tickers a evaluar para diversificar (Enter para demo: AAPL,MSFT,KHC,QQQ): "
    ).strip() or "AAPL,MSFT,KHC,QQQ,BRK-B,GOOGL,VTI"

    env_content = f"""# Quantum Portfolio Bot — Configuración
TELEGRAM_TOKEN={token}
TELEGRAM_CHAT_ID={chat_id}

# IA gratuita: "gemini" o "groq"
LLM_PROVIDER={provider}
GEMINI_API_KEY={api_key if provider == "gemini" else ""}
GROQ_API_KEY={api_key if provider == "groq" else ""}

# Tu portafolio
PORTFOLIO_TICKERS={tickers}

# Activos a evaluar para diversificación
RADAR_TICKERS={radar}
"""
    env_path.write_text(env_content, encoding="utf-8")
    print(f"\n✅ .env creado correctamente.")
    print("   Ejecuta de nuevo: python quantum_bot.py\n")
    sys.exit(0)


# ─────────────────────────────────────────────────────────────────────────────
# SECCIÓN 10 — MAIN
# ─────────────────────────────────────────────────────────────────────────────

def validate_config() -> bool:
    """Valida que la configuración mínima esté presente."""
    ok = True
    if not TELEGRAM_TOKEN:
        print("❌ TELEGRAM_TOKEN no configurado en .env")
        ok = False
    if not YFINANCE_OK:
        print("❌ yfinance no instalado: pip install yfinance")
        ok = False
    if not llm.is_available():
        print("⚠️  LLM no configurado — el bot funcionará sin análisis de IA conversacional")
    return ok

async def auto_scan_portfolio(ctx: ContextTypes.DEFAULT_TYPE):
    """Centinela: Escaneo silencioso del portafolio en busca de riesgos extremos."""
    chat_id_destino = TELEGRAM_CHAT_ID
    if not chat_id_destino:
        return
        
    tickers = list(BOT_STATE["watchlist"].keys())
    quantities = BOT_STATE["watchlist"]

    if not tickers:
        return

    # 1. Obtener precios y datos
    close_prices = DataFetcher.get_close_batch(tickers, period="3y")
    total_value_usd = 0.0
    values_usd = {}
    
    try:
        df_clp = DataFetcher.get_prices("CLP=X", period="5d")
        usd_clp = float(df_clp["Close"].dropna().iloc[-1]) if not df_clp.empty else 900.0
    except:
        usd_clp = 900.0

    for t in tickers:
        if t in close_prices.columns and not close_prices[t].empty:
            price = float(close_prices[t].dropna().iloc[-1])
            qty = quantities.get(t, 0.0)
            val = price * qty
            if t.endswith(".SN"):
                val = val / usd_clp
            values_usd[t] = val
            total_value_usd += val

    flagged_assets = []
    
    for t in tickers:
        if t not in close_prices.columns or close_prices[t].empty:
            continue
            
        df = close_prices[[t]].rename(columns={t: "Close"})
        df_ind = compute_indicators(df)
        if df_ind.empty:
            continue
            
        last = df_ind.iloc[-1]
        rsi = float(last.get("rsi", 50))
        pvc_ema200 = float(last.get("pvc_ema200", 0.0))
        
        info = DataFetcher.get_info(t)
        debt = info.get("debt_to_equity") or 0.0
        pe = info.get("pe_forward") or 0.0
        
        weight = values_usd.get(t, 0.0) / total_value_usd if total_value_usd > 0 else 0.0
        
        # Inmunidad de Micro-posiciones (< 1%)
        if weight < 0.01:
            continue
            
        ETF_LIST = ['VOO', 'QQQ', 'FTEC', 'SCHD', 'CFMITNIPSA.SN', 'SGOV', 'HDV']
        is_etf = t in ETF_LIST
        
        data = quantities.get(t, {})
        qty = data.get("qty", 0.0) if isinstance(data, dict) else float(data)
        cost = data.get("cost", 0.0) if isinstance(data, dict) else 0.0
        current_price = float(close_prices[t].dropna().iloc[-1])
        
        trigger_reasons = []
        
        # Alerta Técnica (Toma de Ganancias)
        rsi_threshold = 82 if is_etf else 70
        is_tech_overbought = False
        if rsi > rsi_threshold:
            is_tech_overbought = True
            trigger_reasons.append(f"RSI sobrecomprado ({rsi:.1f})")
        if pvc_ema200 > 0.20:
            is_tech_overbought = True
            trigger_reasons.append(f"Precio > 20% sobre SMA200 (+{pvc_ema200*100:.1f}%)")
            
        if is_tech_overbought:
            if cost > 0:
                ganancia_latente = (current_price - cost) * qty
                if ganancia_latente > 0:
                    acciones_a_vender = ganancia_latente / current_price
                    trigger_reasons[-1] += f". [VENTA PARCIAL] Sugerencia matemática: Vender {acciones_a_vender:.2f} acciones (Aprox. ${ganancia_latente:.2f}) para extraer ganancia neta."
            else:
                trigger_reasons[-1] += ". [VENTA PARCIAL] (Precio de compra no configurado, imposible calcular salida exacta)."
            
        # Alertas Fundamentales y Concentración (Solo para acciones individuales)
        if not is_etf:
            if debt > 150.0:
                trigger_reasons.append(f"Deuda Tóxica (D/E: {debt:.1f}%)")
            if pe > 60:
                trigger_reasons.append(f"Burbuja P/E ({pe:.1f}x)")
            if weight > 0.25:
                exceso_usd = (weight - 0.25) * total_value_usd
                acciones_exceso = exceso_usd / current_price
                trigger_reasons.append(f"Exceso de Concentración ({weight*100:.1f}%). [REBALANCEO] Sugerencia: Vender {acciones_exceso:.2f} acciones (Aprox. ${exceso_usd:.2f}) para volver al límite máximo.")
            
        if trigger_reasons:
            flagged_assets.append({
                "ticker": t,
                "reasons": trigger_reasons,
                "weight": weight
            })

    if not flagged_assets:
        return # No hay peligro, silencioso.

    # 3. Invocar IA para recomendación
    prompt = f"""Eres el Gestor de Riesgos de un Hedge Fund Cuantitativo.
Se ha disparado una alarma automática en el portafolio para los siguientes activos que superaron los umbrales de seguridad:

"""
    for asset in flagged_assets:
        reasons_str = ", ".join(asset["reasons"])
        prompt += f"- {asset['ticker']} (Peso: {asset['weight']*100:.1f}%): {reasons_str}\n"

    prompt += """
Actúa con frialdad matemática.
Estructura tu respuesta en texto plano (sin asteriscos):
1. Veredicto Directo: Para cada activo listado, indica 'VENTA PARCIAL' (rebalanceo) o 'VENTA TOTAL' (salida), seguido de una justificación breve en 1 línea basada en el riesgo detectado.
"""
    try:
        ia_advice = llm.query(prompt)
        reporte_final = f"🚨 *ALERTA DE RIESGO / TOMA DE GANANCIAS* 🚨\n\nEl Centinela de Portafolio detectó anomalías graves:\n\n"
        for asset in flagged_assets:
            reasons_str = ", ".join(asset["reasons"])
            reporte_final += f"⚠️ *{asset['ticker']}* ({asset['weight']*100:.1f}%): {reasons_str}\n"
            
        reporte_final += f"\n💡 *VEREDICTO ALGORÍTMICO:*\n{ia_advice}"
        await ctx.bot.send_message(chat_id=chat_id_destino, text=reporte_final, parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        log.error(f"Error en auto_scan_portfolio: {e}")

async def monthly_statement_job(ctx: ContextTypes.DEFAULT_TYPE):
    """Estado de Cuenta Mensual: Corre solo el día 1 de cada mes."""
    if dt.datetime.utcnow().day != 1:
        return
        
    chat_id_destino = TELEGRAM_CHAT_ID
    if not chat_id_destino:
        return
        
    tickers = list(BOT_STATE["watchlist"].keys())
    quantities = BOT_STATE["watchlist"]

    if not tickers:
        return

    # Obtener precios y pesos
    close_prices = DataFetcher.get_close_batch(tickers, period="5d")
    total_value_usd = 0.0
    values_usd = {}
    
    try:
        df_clp = DataFetcher.get_prices("CLP=X", period="5d")
        usd_clp = float(df_clp["Close"].dropna().iloc[-1]) if not df_clp.empty else 900.0
    except:
        usd_clp = 900.0

    weighted_yield = 0.0

    for t in tickers:
        if t in close_prices.columns and not close_prices[t].empty:
            price = float(close_prices[t].dropna().iloc[-1])
            qty = quantities.get(t, 0.0)
            val = price * qty
            if t.endswith(".SN"):
                val = val / usd_clp
            values_usd[t] = val
            total_value_usd += val
            
            # Obtener Yield
            info = DataFetcher.get_info(t)
            div_yield = info.get("div_yield") or 0.0
            
            # Contribución al yield ponderado
            weighted_yield += div_yield * val

    if total_value_usd > 0:
        weighted_yield = weighted_yield / total_value_usd
    else:
        weighted_yield = 0.0

    # Agrupar < 2% en "Otros"
    labels = []
    sizes = []
    otros_val = 0.0
    for t, val in values_usd.items():
        weight = val / total_value_usd if total_value_usd > 0 else 0
        if weight < 0.02:
            otros_val += val
        else:
            labels.append(t)
            sizes.append(val)
            
    if otros_val > 0:
        labels.append("Otros (<2%)")
        sizes.append(otros_val)
        
    # Generar gráfico de torta
    import matplotlib.pyplot as plt
    import numpy as np
    plt.style.use('dark_background')
    fig, ax = plt.subplots(figsize=(6, 6))
    
    # Colores elegantes
    colors = plt.cm.viridis(np.linspace(0.2, 0.9, len(labels)))
    ax.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90, colors=colors, textprops={'color':"w", 'weight':'bold'})
    ax.axis('equal')
    plt.title("Distribución de Portafolio", color="white", weight="bold")
    
    temp_img = "temp_portfolio_pie.png"
    plt.savefig(temp_img, bbox_inches='tight', dpi=150)
    plt.close()

    caption = f"🏦 ESTADO DE CUENTA MENSUAL 🏦\n\n"
    caption += f"Patrimonio Total: ${total_value_usd:,.2f} USD\n"
    caption += f"Ganancia de Capital: N/A (Datos de compra pendientes)\n"
    caption += f"Dividend Yield Ponderado: {weighted_yield:.2f}%\n\n"
    caption += "El motor ha sido rebalanceado y los escudos de riesgo están activos para el nuevo mes."

    try:
        with open(temp_img, 'rb') as f:
            await ctx.bot.send_photo(chat_id=chat_id_destino, photo=f, caption=caption)
    except Exception as e:
        log.error(f"Error enviando estado de cuenta: {e}")
    finally:
        if os.path.exists(temp_img):
            os.remove(temp_img)



def print_startup_banner(rf: float):
    pkg_status = {
        "yfinance":      "✅" if YFINANCE_OK else "❌",
        "scikit-learn":  "✅" if SKLEARN_OK  else "❌",
        "PyPortfolioOpt":"✅" if PYPFOPT_OK  else "⚠️",
        "Gemini":        "✅" if (GEMINI_OK and GEMINI_KEY) else "—",
        "Groq":          "✅" if (GROQ_OK and GROQ_KEY)    else "—",
    }
    print("""
╔══════════════════════════════════════════════════════════════════════════════╗
║  QUANTUM PORTFOLIO BOT v2.0                                                  ║
║  Telegram + IA Predictiva + Markowitz + Monitoreo Intradía                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
""")
    for pkg, status in pkg_status.items():
        print(f"  {status} {pkg}")
    wl_keys = list(BOT_STATE["watchlist"].keys())
    print(f"\n  📌 Portafolio: {', '.join(wl_keys[:8])}{' ...' if len(wl_keys)>8 else ''} ({len(wl_keys)} activos)")
    print(f"  🔭 Radar: {', '.join(RADAR_TICKERS[:5])}")
    print(f"  💰 Rf (^TNX): {rf*100:.2f}%")
    print(f"  🤖 LLM: {LLM_PROVIDER} {'✅' if llm.is_available() else '❌'}")
    print(f"  ⏱ Monitoreo: cada {MONITOR_INTERVAL_MIN} min (horario NYSE)")
    print(f"\n  Bot iniciado. Ctrl+C para detener.\n")


def main():
    # Crear .env si no existe
    setup_env()

    if not TELEGRAM_OK:
        print("❌ Instala telegram: pip install 'python-telegram-bot[job-queue]'")
        sys.exit(1)

    # Tasa libre de riesgo inicial
    rf = DataFetcher.get_risk_free_rate()
    BOT_STATE["rf_rate"] = rf

    validate_config()
    print_startup_banner(rf)

    # ── Construir la aplicación Telegram ─────────────────────────────────────
    app = (
        Application.builder()
        .token(TELEGRAM_TOKEN)
        .build()
    )

    # ── Registrar handlers ────────────────────────────────────────────────────
    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("analizar",   cmd_analizar))
    app.add_handler(CommandHandler("portafolio", cmd_portafolio))
    app.add_handler(CommandHandler("vender",     cmd_vender))
    app.add_handler(CommandHandler("optimizar",  cmd_optimizar))
    app.add_handler(CommandHandler("radar",      cmd_radar))
    app.add_handler(CommandHandler("alerta",     cmd_alerta))
    app.add_handler(CommandHandler("watchlist",  cmd_watchlist))
    app.add_handler(CommandHandler("ayuda",      cmd_ayuda))
    app.add_handler(CommandHandler("help",       cmd_ayuda))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(CommandHandler("scan", cmd_escanear_ahora))

    # --- ESCUDO ANTI-CAÍDAS GLOBAL ---
    async def global_error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
        log.error(f"🛡️ Escudo activado. Se atrapó un error que habría apagado el bot: {context.error}")
    
    app.add_error_handler(global_error_handler)
    # ---------------------------------

    # ── Jobs periódicos ───────────────────────────────────────────────────────
    jq = app.job_queue
    if jq is not None:
        # Escaneo intradía cada MONITOR_INTERVAL_MIN minutos
        jq.run_repeating(
            monitoring_job,
            interval = MONITOR_INTERVAL_MIN * 60,
            first    = 60,   # Primer escaneo en 60 segundos
            name     = "intraday_monitor",
        )
        # Resumen diario a las 21:15 UTC (≈ 18:15 Santiago, después del cierre NYSE)
        jq.run_daily(
            daily_summary_job,
            time = dt.time(hour=21, minute=15, tzinfo=dt.timezone.utc),
            name = "daily_summary",
        )
        
        # --- NUEVOS ESCÁNERES MASIVOS DE OPORTUNIDADES ---
        # 1. Alarma de Apertura: Lunes a Viernes a las 08:00 AM (Hora local de tu PC)
        jq.run_daily(
            job_morning_screener, 
            time=dt.time(hour=8, minute=0, second=0), 
            days=(1, 2, 3, 4, 5)
        )

        # 2. Alarma de Medio Día: Lunes a Viernes a las 13:00 PM (Hora local de tu PC)
        jq.run_daily(
            job_morning_screener, 
            time=dt.time(hour=13, minute=0, second=0), 
            days=(1, 2, 3, 4, 5)
        )  

        # 3. Centinela de Portafolio (Auto-Scan): 11:00 AM NY (15:00 UTC) y 16:00 PM NY (20:00 UTC)
        import datetime
        jq.run_daily(
            auto_scan_portfolio,
            time=datetime.time(hour=15, minute=0, tzinfo=datetime.timezone.utc),
            days=(1, 2, 3, 4, 5)
        )
        jq.run_daily(
            auto_scan_portfolio,
            time=datetime.time(hour=20, minute=0, tzinfo=datetime.timezone.utc),
            days=(1, 2, 3, 4, 5)
        )

        # 4. Estado de Cuenta Mensual: 09:00 AM NY (13:00 UTC) diario, pero filtrará el día 1 internamente
        jq.run_daily(
            monthly_statement_job,
            time=datetime.time(hour=13, minute=0, tzinfo=datetime.timezone.utc)
        )

        # Importamos el minero
        from miner import run_miner
    
        # Programamos el minero para que corra a las 2:00 AM todos los días
        import datetime
        hora_minero = datetime.time(hour=2, minute=0, tzinfo=datetime.timezone.utc)
        app.job_queue.run_daily(lambda ctx: run_miner(modo_incremental=True), time=hora_minero)
   
        # -------------------------------------------------
        
        log.info("✅ Jobs periódicos registrados.")
    else:
        log.warning("JobQueue no disponible. Instala: pip install 'python-telegram-bot[job-queue]'")

    # ── Iniciar Long Polling ──────────────────────────────────────────────────
    log.info("🚀 Bot iniciado con Long Polling. Esperando mensajes…")
    app.run_polling(
        poll_interval   = 1.0,
        timeout         = 30,
        drop_pending_updates = True,   # Ignorar mensajes mientras estaba offline
    )


if __name__ == "__main__":
    main()
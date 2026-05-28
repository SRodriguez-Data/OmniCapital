import os
import time
import requests
import numpy as np
import pandas as pd
import yfinance as yf
from alpaca_trade_api.rest import REST
from alpaca_trade_api.timeframe import TimeFrame

# ==========================================
# CONFIGURACIÓN Y CREDENCIALES
# ==========================================
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

# ==========================================
# UNIVERSO PREMIUM - QUANTUM TRADER
# ==========================================
PREMIUM_TICKERS = [
    # 1. CORE ETFs
    'VOO', 'QQQ', 'SCHD', 'SGOV', 'HDV', 'FTEC', 'CFMITNIPSA.SN',
    # 2. TECNOLOGÍA & GROWTH
    'AAPL', 'GOOGL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMZN', 
    'TSM', 'AMD', 'ASML', 'AVGO', 'CRM', 'NFLX', 'ADBE', 
    # 3. VALUE & DIVIDENDOS USA
    'KHC', 'JNJ', 'PG', 'KO', 'PEP', 'CVX', 'XOM', 'ABBV', 
    'MRK', 'MCD', 'MMM', 'T', 'VZ', 'PFE', 'WMT', 'HD', 
    'COST', 'JPM', 'BAC', 'BLK', 'GS', 'MS', 'CAT', 'DE',
    # 4. MERCADO CHILENO (.SN)
    'CHILE.SN', 'BSANTANDER.SN', 'ENELAM.SN', 'ENELCHILE.SN', 
    'ITAUCL.SN', 'SQM-B.SN', 'CENCOSUD.SN', 'COPEC.SN', 
    'FALABELLA.SN', 'CCU.SN', 'CMPC.SN', 'VAPORES.SN', 'BCI.SN',
    # 5. SEMICONDUCTORES & HARDWARE
    'INTC', 'TXN', 'QCOM', 'AMAT', 'MU', 'LRCX', 'IBM', 'CSCO',
    # 6. CONSUMO DISCRECIONAL & FINANZAS GLOBALES
    'SBUX', 'NKE', 'V', 'MA', 'AXP', 'DIS', 'UBER', 'ABNB'
]

# ==========================================
# UTILIDADES DE NOTIFICACIÓN (TELEGRAM)
# ==========================================
def send_telegram_message(text: str):
    """Envía un mensaje push directo vía la API REST de Telegram."""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("Faltan credenciales de Telegram.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        print(f"Error enviando Telegram: {e}")

# ==========================================
# MOTOR MATEMÁTICO (INDICADORES)
# ==========================================
def _get_slope(y):
    if len(y) < 20: return np.nan
    x = np.arange(20)
    return float(np.mean((x - 9.5) * (y - np.mean(y))) / np.var(x))

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "close" not in df.columns:
        return df
    out = df.copy()
    close = out["close"]
    
    for span in [12, 20, 26, 50, 200]:
        out[f"ema_{span}"] = close.ewm(span=span, adjust=False).mean()
        
    delta = close.diff()
    gain  = delta.clip(lower=0).ewm(com=13, min_periods=14).mean()
    loss  = (-delta).clip(lower=0).ewm(com=13, min_periods=14).mean()
    out["rsi"] = 100 - (100 / (1 + gain / (loss + 1e-9)))
    
    out["macd"]        = out["ema_12"] - out["ema_26"]
    out["macd_signal"] = out["macd"].ewm(span=9, adjust=False).mean()
    
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    
    log_ret = np.log(close / close.shift(1))
    out["vol_20d"] = log_ret.rolling(20).std() * np.sqrt(252)
    out["pvc_ema200"] = close / out["ema_200"] - 1
    
    return out

# ==========================================
# FILTROS Y EVALUACIÓN
# ==========================================
def passes_momentum_and_volume(df: pd.DataFrame) -> bool:
    if len(df) < 20:
        return False
    # Filtro RVOL
    vol = df['volume']
    sma_vol_20 = vol.rolling(20).mean()
    if sma_vol_20.iloc[-1] == 0: return False
    rvol = vol.iloc[-1] / sma_vol_20.iloc[-1]
    
    if rvol < 1.0:
        return False
        
    # Filtro Momentum
    macd = df['macd'].iloc[-1]
    macd_signal = df['macd_signal'].iloc[-1]
    prev_macd = df['macd'].iloc[-2]
    prev_signal = df['macd_signal'].iloc[-2]
    
    macd_bull_cross = (prev_macd <= prev_signal) and (macd > macd_signal)
    
    rsi = df['rsi'].iloc[-1]
    prev_rsi = df['rsi'].iloc[-2]
    prev_rsi_2 = df['rsi'].iloc[-3]
    rsi_inflection = (prev_rsi < prev_rsi_2) and (rsi > prev_rsi)
    
    return macd_bull_cross or rsi_inflection

def check_fundamentals(ticker: str) -> bool:
    """Retorna True si cumple el margen de seguridad o es Growth."""
    try:
        t = yf.Ticker(ticker)
        info = t.info
        
        # Filtro de Deuda Tóxica (Anti Value-Trap)
        debt = info.get("debtToEquity") or 0.0
        # En yfinance, debtToEquity viene en % (ej. 150 = 150%)
        if debt > 150.0 and ticker not in ['JPM', 'BAC', 'GS', 'MS']: # Excepción bancos
            return False
            
        sector = info.get('sector', 'Unknown')
        industry = info.get('industry', 'Unknown')
        
        is_growth = sector in ['Technology', 'Communication Services'] or 'Software' in industry
        
        if is_growth:
            return True # Excepción para Growth
            
        eps = info.get('trailingEps') or 0.0
        bvps = info.get('bookValue') or 0.0
        price = info.get('currentPrice') or info.get('previousClose') or 0.0
        
        if eps > 0 and bvps > 0 and price > 0:
            graham_number = (22.5 * eps * bvps) ** 0.5
            margin_of_safety = (graham_number - price) / graham_number
            if margin_of_safety > 0.0:
                return True
        return False
    except Exception as e:
        print(f"Error extrayendo fundamentales para {ticker}: {e}")
        return False

# ==========================================
# MOTOR DE EJECUCIÓN (ALPACA)
# ==========================================
def execute_buy_order(ticker: str, amount_usd: float = 50.0) -> bool:
    if not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        print("Faltan credenciales de Alpaca.")
        return False
        
    try:
        api = REST(ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL, api_version='v2')
        # Las acciones chilenas (.SN) no están soportadas en Alpaca
        if ticker.endswith('.SN'):
            print(f"Ticker {ticker} ignorado en Alpaca (mercado chileno).")
            return False
            
        order = api.submit_order(
            symbol=ticker,
            notional=amount_usd,
            side='buy',
            type='market',
            time_in_force='day'
        )
        print(f"✅ Orden enviada a Alpaca para {ticker}: {order.id}")
        return True
    except Exception as e:
        print(f"❌ Error ejecutando orden para {ticker}: {e}")
        return False

# ==========================================
# FLUJO PRINCIPAL SERVERLESS
# ==========================================
def run_serverless_screener():
    print("🚀 Iniciando Quantum Trader Serverless...")
    compras_realizadas = []
    
    for ticker in PREMIUM_TICKERS:
        try:
            # 1. Extracción de datos en vivo (Solo 200 días para matemáticas)
            df = yf.download(ticker, period="1y", interval="1d", progress=False, multi_level_index=False)
            if df.empty:
                continue
                
            df.reset_index(inplace=True)
            df.columns = [str(c).lower().replace(" ", "_") for c in df.columns]
            
            # 2. Computar indicadores
            df_ind = compute_indicators(df)
            if df_ind.empty:
                continue
                
            rsi = df_ind['rsi'].iloc[-1]
            price = df_ind['close'].iloc[-1]
            
            # 3. Filtros Estrictos
            if rsi < 50 and passes_momentum_and_volume(df_ind):
                # Si pasa lo técnico, revisamos lo fundamental
                if check_fundamentals(ticker):
                    print(f"🎯 ¡SEÑAL DETECTADA EN {ticker}! RSI: {rsi:.1f}")
                    # 4. Ejecución
                    success = execute_buy_order(ticker, amount_usd=50.0)
                    if success:
                        msg = f"🤖 *ORDEN EJECUTADA*\nSe han invertido *$50 USD* en *{ticker}* vía Alpaca Paper Trading.\nPrecio aproximado: ${price:.2f}\nRSI: {rsi:.1f}"
                        send_telegram_message(msg)
                        compras_realizadas.append(ticker)
                        
            time.sleep(0.5) # Anti-Rate Limit YFinance
            
        except Exception as e:
            print(f"⚠️ Error procesando {ticker}: {e}")
            
    if not compras_realizadas:
        print("📉 Escaneo finalizado. Ningún activo superó los filtros.")
        send_telegram_message("💤 *Quantum Trader (Serverless)*\nEscaneo matutino finalizado. Ningún activo superó los estrictos filtros de entrada. Se mantiene la liquidez.")
    else:
        print(f"✅ Escaneo finalizado. Compras ejecutadas: {', '.join(compras_realizadas)}")

if __name__ == "__main__":
    run_serverless_screener()

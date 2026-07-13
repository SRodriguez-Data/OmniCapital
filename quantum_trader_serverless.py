import os
import time
import importlib
import requests
import json
import logging
import pandas as pd
import numpy as np
from datetime import datetime
from supabase import create_client, Client
import google.generativeai as genai

REST = None
try:
    REST = importlib.import_module("alpaca_trade_api").REST
except ModuleNotFoundError:
    REST = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

PORTFOLIO_TICKERS_RAW = os.getenv("PORTFOLIO_TICKERS", "")
PORTFOLIO_TICKERS = [t.strip() for t in PORTFOLIO_TICKERS_RAW.split(",") if t.strip()]

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    llm = genai.GenerativeModel('gemini-2.5-flash')
else:
    llm = None

def compute_quant_math(tickers):
    if not tickers or not supabase:
        return {}, []
    try:
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(200 * len(tickers)).execute()
            
        if not res.data:
            return {}, []
            
        df = pd.DataFrame(res.data)
        df_pivot = df.pivot_table(index="date", columns="ticker", values="close")
        df_pivot = df_pivot.sort_index()
        
        returns = df_pivot.pct_change().dropna()
        if returns.empty:
            return {}, []
            
        corr_matrix = returns.corr().round(2)
        corr_json = {t: corr_matrix[t].to_dict() for t in corr_matrix.columns}
            
        num_portfolios = 3000
        risk_free_rate = 0.04
        mean_returns = returns.mean() * 252
        cov_matrix = returns.cov() * 252
        
        results = []
        num_assets = len(returns.columns)
        np.random.seed(42)
        
        for _ in range(num_portfolios):
            weights = np.random.random(num_assets)
            weights /= np.sum(weights)
            
            port_return = np.sum(mean_returns * weights)
            port_std_dev = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
            port_sharpe = (port_return - risk_free_rate) / port_std_dev
            
            # Save percentages for the UI tooltip
            w_dict = {returns.columns[i]: round(weights[i] * 100, 1) for i in range(num_assets)}
            
            results.append({
                "riesgo": round(port_std_dev * 100, 2),
                "retorno": round(port_return * 100, 2),
                "sharpe": round(port_sharpe, 2),
                "pesos": w_dict
            })
            
        import random
        max_sharpe = max(results, key=lambda x: x["sharpe"])
        min_vol = min(results, key=lambda x: x["riesgo"])
        
        sample_results = random.sample(results, min(300, len(results)))
        if max_sharpe not in sample_results: sample_results.append(max_sharpe)
        if min_vol not in sample_results: sample_results.append(min_vol)
        
        return corr_json, sample_results
    except Exception as e:
        logging.error(f"Error calculando Matemáticas Cuantitativas: {e}")
        return {}, []

def calculate_trading_limits(candidates):
    if not candidates or not supabase:
        return candidates
        
    tickers = [c['ticker'] for c in candidates]
    
    try:
        # Fetching enough data to ensure Bollinger Bands can be calculated
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(50 * len(tickers)).execute()
            
        if not res.data:
            return candidates
            
        df = pd.DataFrame(res.data)
        
        for c in candidates:
            ticker_data = df[df['ticker'] == c['ticker']]
            if len(ticker_data) < 5:
                # Fallback if there's very little data
                c['bollinger_upper'] = c['price'] * 1.05
                c['bollinger_lower'] = c['price'] * 0.95
                c['ema200_abs'] = c['price']
                c['signal'] = 'HOLD'
                continue
                
            closes = ticker_data['close'].values[:20] # Last 20 days
            std_20 = np.std(closes)
            sma_20 = np.mean(closes)
            
            c['bollinger_upper'] = sma_20 + (2 * std_20)
            c['bollinger_lower'] = sma_20 - (2 * std_20)
            
            current_price = c['price']
            dist = c.get('distancia_ema200', 0)
            if dist > -0.99:
                c['ema200_abs'] = current_price / (1 + dist)
            else:
                c['ema200_abs'] = sma_20 # Fallback
                
            if current_price <= c['bollinger_lower']:
                c['signal'] = 'BUY'
            elif current_price >= c['bollinger_upper']:
                c['signal'] = 'SELL'
            else:
                c['signal'] = 'HOLD'
                
    except Exception as e:
        logging.error(f"Error calculando trading limits: {e}")
        
    return candidates

def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless (Institucional)...")
    
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase.")
        return

    # 1. Extraer los datos más recientes
    try:
        res_date = supabase.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute()
        if not res_date.data:
            return
        max_date = res_date.data[0]['date']
        
        res_activos = supabase.table("precios_historicos").select("*").eq("date", max_date).execute()
        activos_hoy = res_activos.data
    except Exception as e:
        logging.error(f"Error consultando Supabase: {e}")
        return

    all_us = []
    all_cl = []
    
    # 2. Filtrado y Segmentación Forzada
    # Relaxed filters to ENSURE we always get top candidates for BOTH markets.
    for row in activos_hoy:
        ticker = row['ticker']
        rsi = row.get('rsi', 50)
        close = row.get('close', 0)
        pvc_ema200 = row.get('pvc_ema200', 0)
        
        if rsi is None or pvc_ema200 is None:
            continue
            
        score = (100 - rsi) + (pvc_ema200 * 50) # The lower the RSI, the higher the score
        
        data_dict = {
            'ticker': ticker,
            'price': close,
            'rsi': rsi,
            'distancia_ema200': pvc_ema200,
            'score': score
        }
        
        if ticker.endswith(".SN"):
            all_cl.append(data_dict)
        else:
            all_us.append(data_dict)

    # Force top 10 for each to guarantee data is passed
    top_us = sorted(all_us, key=lambda x: x['score'], reverse=True)[:10]
    top_cl = sorted(all_cl, key=lambda x: x['score'], reverse=True)[:10]
    
    # Calculate Bollinger and Limits
    top_us = calculate_trading_limits(top_us)
    top_cl = calculate_trading_limits(top_cl)

    # 3. Matemáticas de Portafolio Real (El Portafolio del Usuario)
    logging.info("🧮 Calculando Matriz de Correlación y Markowitz SOBRE MI PORTAFOLIO...")
    if PORTFOLIO_TICKERS:
        corr_json, frontier_points = compute_quant_math(PORTFOLIO_TICKERS)
        try:
            if corr_json:
                supabase.table("correlaciones").insert({"matriz_json": corr_json}).execute()
            if frontier_points:
                supabase.table("frontera_eficiente").insert({"puntos_json": frontier_points}).execute()
        except Exception as e:
            logging.error(f"Error guardando matemáticas del portafolio en Supabase: {e}")

    # 4. Generación Analista Institucional (Gemini)
    prompt_us = "\\n".join([f"- {c['ticker']}: Precio ${c['price']:.2f}, Límite Inferior ${c.get('bollinger_lower',0):.2f}, Límite Superior ${c.get('bollinger_upper',0):.2f}" for c in top_us[:5]])
    prompt_cl = "\\n".join([f"- {c['ticker']}: Precio ${c['price']:.2f}, Límite Inferior ${c.get('bollinger_lower',0):.2f}, Límite Superior ${c.get('bollinger_upper',0):.2f}" for c in top_cl[:5]])
    
    prompt_macro = f"""Eres el Estratega Cuantitativo Jefe de un fondo institucional. 
Analiza estos activos y proporciona una justificación seria para las métricas técnicas.

Mercado EE.UU. (Top 5):
{prompt_us}

Mercado Chile (Top 5):
{prompt_cl}

Responde estrictamente en formato JSON válido (SIN MARKDOWN). Estructura exacta:
{{
  "contexto_macro": "Contexto macro global de 2 párrafos.",
  "vision_radar": "Resumen institucional de estos mercados.",
  "seleccion_fondo": "Tu selección #1 global y por qué.",
  "setup_tecnico": "Evaluación del riesgo general.",
  "insights_us": {{
      "TICKER": "Justificación concisa de trading."
  }},
  "insights_cl": {{
      "TICKER": "Justificación concisa de trading."
  }}
}}
"""
    ia_data = {
        "contexto_macro": "Generación de IA fallida o en mantenimiento.",
        "vision_radar": "Revisar datos técnicos crudos.",
        "seleccion_fondo": "N/A",
        "setup_tecnico": "N/A",
        "insights_us": {}, "insights_cl": {}
    }

    if llm:
        try:
            response = llm.generate_content(prompt_macro)
            texto_ia = response.text.replace("```json", "").replace("```", "").strip()
            # strict=False allows unescaped newlines which cause Gemini JSON to break often
            ia_data = json.loads(texto_ia, strict=False)
        except Exception as e:
            logging.error(f"Error parseando JSON de Gemini: {e}")
    else:
        logging.error("No hay API KEY de Gemini.")

    # 5. Guardar en Supabase (Web Dashboard)
    combined_candidates = {
        "us": top_us,
        "cl": top_cl
    }
    
    try:
        supabase.table("analisis_ia").insert({
            "candidatos_json": combined_candidates,
            "vision_radar": ia_data.get("vision_radar", ""),
            "seleccion_fondo": ia_data.get("seleccion_fondo", ""),
            "setup_tecnico": ia_data.get("setup_tecnico", ""),
            "contexto_macro": ia_data.get("contexto_macro", ""),
            "insights_tickers": {**ia_data.get("insights_us", {}), **ia_data.get("insights_cl", {})}
        }).execute()
    except Exception as e:
        logging.error(f"Error guardando IA en Supabase: {e}")
            
    logging.info("✅ Pipeline Institucional Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()

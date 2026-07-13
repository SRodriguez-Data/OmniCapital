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

# ==========================================
# CONFIGURACIÓN Y CREDENCIALES
# ==========================================
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    llm = genai.GenerativeModel('gemini-2.5-flash')
else:
    llm = None

def send_telegram_message(text: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"}
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        logging.error(f"Error enviando Telegram: {e}")

def execute_buy_order(ticker: str, amount_usd: float = 50.0) -> bool:
    if not REST or not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        return False
    try:
        api = REST(ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL, api_version='v2')
        if ticker.endswith('.SN'):
            return False
        api.submit_order(
            symbol=ticker, notional=amount_usd, side='buy', type='market', time_in_force='day'
        )
        return True
    except Exception as e:
        logging.error(f"Error ejecutando orden para {ticker}: {e}")
        return False

def compute_quant_math(tickers):
    """ Calcula Correlaciones y Frontera Eficiente de Markowitz mediante simulación Monte Carlo """
    if not tickers or not supabase:
        return {}, []

    try:
        # Extraer los últimos 100 días de precios
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(100 * len(tickers)).execute()
            
        if not res.data:
            return {}, []
            
        df = pd.DataFrame(res.data)
        # Pivotar
        df_pivot = df.pivot_table(index="date", columns="ticker", values="close")
        df_pivot = df_pivot.sort_index()
        
        # Calcular retornos diarios
        returns = df_pivot.pct_change().dropna()
        if returns.empty:
            return {}, []
            
        # Matriz de Correlación
        corr_matrix = returns.corr().round(2)
        # Formatear matriz para Supabase JSON (lista de dicts o dict de dicts)
        corr_json = {}
        for t in corr_matrix.columns:
            corr_json[t] = corr_matrix[t].to_dict()
            
        # Simulación Frontera Eficiente (Markowitz)
        num_portfolios = 3000
        risk_free_rate = 0.04
        mean_returns = returns.mean() * 252
        cov_matrix = returns.cov() * 252
        
        results = []
        num_assets = len(returns.columns)
        
        # Fijar seed para reproducibilidad
        np.random.seed(42)
        
        for _ in range(num_portfolios):
            weights = np.random.random(num_assets)
            weights /= np.sum(weights)
            
            port_return = np.sum(mean_returns * weights)
            port_std_dev = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
            port_sharpe = (port_return - risk_free_rate) / port_std_dev
            
            # Formatear weights
            w_dict = {returns.columns[i]: round(weights[i], 3) for i in range(num_assets)}
            
            results.append({
                "riesgo": round(port_std_dev * 100, 2),
                "retorno": round(port_return * 100, 2),
                "sharpe": round(port_sharpe, 2),
                "pesos": w_dict
            })
            
        # Filtrar solo el contorno de la frontera eficiente para optimizar JSON (opcional)
        # Pero podemos enviar los 3000 puntos o una muestra representativa de 300
        import random
        # Siempre incluir el portfolio de max sharpe y min volatilidad
        max_sharpe = max(results, key=lambda x: x["sharpe"])
        min_vol = min(results, key=lambda x: x["riesgo"])
        
        sample_results = random.sample(results, min(300, len(results)))
        if max_sharpe not in sample_results: sample_results.append(max_sharpe)
        if min_vol not in sample_results: sample_results.append(min_vol)
        
        return corr_json, sample_results
        
    except Exception as e:
        logging.error(f"Error calculando Matemáticas Cuantitativas: {e}")
        return {}, []


def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless con IA Integrada...")
    
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase.")
        return
        
    if not llm:
        logging.error("❌ Falta GEMINI_API_KEY. No se puede generar el reporte IA.")
        return

    # 1. Extraer los datos más recientes
    try:
        res_date = supabase.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute()
        if not res_date.data:
            return
        max_date = res_date.data[0]['date']
        logging.info(f"📅 Analizando mercado para la fecha: {max_date}")
        
        res_activos = supabase.table("precios_historicos").select("*").eq("date", max_date).execute()
        activos_hoy = res_activos.data
    except Exception as e:
        logging.error(f"Error consultando Supabase: {e}")
        return

    candidatos = []
    
    # 2. Filtrado Cuantitativo
    for row in activos_hoy:
        ticker = row['ticker']
        rsi = row.get('rsi', 50)
        close = row.get('close', 0)
        volumen = row.get('volume', 0)
        pvc_ema200 = row.get('pvc_ema200', 0)
        
        if rsi is None or pvc_ema200 is None:
            continue
            
        volumen_nominal = volumen * close
        if ticker.endswith(".SN") and volumen_nominal < 450_000_000:
            continue
        elif not ticker.endswith(".SN") and volumen_nominal < 500_000:
            continue
            
        if rsi < 50 and pvc_ema200 > -0.15:
            score = (50 - rsi) + (pvc_ema200 * 100)
            candidatos.append({
                'ticker': ticker,
                'price': close,
                'rsi': rsi,
                'distancia_ema200': pvc_ema200,
                'score': score
            })

    if not candidatos:
        logging.info("📉 Ningún activo superó los filtros.")
        return

    # 3. Selección del Top 5 y Matemáticas de Portafolio
    candidatos = sorted(candidatos, key=lambda x: x['score'], reverse=True)[:5]
    top_tickers = [c['ticker'] for c in candidatos]
    
    logging.info("🧮 Calculando Matriz de Correlación y Frontera Eficiente (Markowitz)...")
    corr_json, frontier_points = compute_quant_math(top_tickers)
    
    # Guardar matemáticas en Supabase
    try:
        if corr_json:
            supabase.table("correlaciones").insert({"matriz_json": corr_json}).execute()
        if frontier_points:
            supabase.table("frontera_eficiente").insert({"puntos_json": frontier_points}).execute()
    except Exception as e:
        logging.error(f"Error guardando matemáticas en Supabase: {e}")


    # 4. Generación Súper Analista Híbrido (Gemini)
    logging.info("🧠 Invocando al Súper Analista Híbrido interactivo...")
    prompt_candidatos = "\\n".join([f"- {c['ticker']}: Precio ${c['price']:.2f}, RSI {c['rsi']:.1f}, Distancia EMA200 {c['distancia_ema200']*100:.1f}%, Score {c['score']:.1f}" for c in candidatos])
    
    prompt_macro = f"""Eres el Estratega Jefe del Fondo de Inversión Cuantitativo.
Tienes en tu escritorio el reporte del equipo Quant con las 5 máximas anomalías del mercado hoy:
{prompt_candidatos}

Tu trabajo es entregar el reporte ejecutivo hiper-detallado de pre-apertura.
Responde ESTRICTAMENTE EN ESPAÑOL, en formato JSON válido, sin bloques de código markdown, con la siguiente estructura exacta:
{{
  "contexto_macro": "Un análisis macroeconómico actual de 2 párrafos de cómo está el mercado global hoy.",
  "vision_radar": "Diagnóstico general de anomalías detectadas en base a estos activos.",
  "seleccion_fondo": "Elige UNA acción como la mejor asimetría y explica su foso (Moat).",
  "setup_tecnico": "Riesgo de mercado general y setups técnicos.",
  "insights_tickers": {{
      "TICKER1": "Análisis profundo de 1 párrafo para este ticker en particular.",
      "TICKER2": "Análisis profundo de 1 párrafo para este ticker en particular."
  }}
}}
Incluye en "insights_tickers" las claves exactas de TODOS los 5 tickers analizados en la lista de arriba."""

    try:
        response = llm.generate_content(prompt_macro)
        texto_ia = response.text.replace("```json", "").replace("```", "").strip()
        ia_data = json.loads(texto_ia)
    except Exception as e:
        logging.error(f"Error generando o parseando IA: {e}")
        ia_data = {
            "contexto_macro": "Error al conectar con la IA.",
            "vision_radar": "Error al conectar con la IA.",
            "seleccion_fondo": "Error al conectar con la IA.",
            "setup_tecnico": "Error al conectar con la IA.",
            "insights_tickers": { t: "Análisis no disponible." for t in top_tickers }
        }

    # 5. Guardar en Supabase (Web Dashboard)
    logging.info("💾 Guardando análisis IA en Supabase...")
    try:
        supabase.table("analisis_ia").insert({
            "candidatos_json": candidatos,
            "vision_radar": ia_data.get("vision_radar", ""),
            "seleccion_fondo": ia_data.get("seleccion_fondo", ""),
            "setup_tecnico": ia_data.get("setup_tecnico", ""),
            "contexto_macro": ia_data.get("contexto_macro", ""),
            "insights_tickers": ia_data.get("insights_tickers", {})
        }).execute()
    except Exception as e:
        logging.error(f"Error guardando IA en Supabase: {e}")

    # 6. Ejecución de Paper Trading (Solo top 1 o top 2 para diversificar)
    for c in candidatos[:2]:
        execute_buy_order(c['ticker'])
            
    logging.info("✅ Pipeline Cuantitativo Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()

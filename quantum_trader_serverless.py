import os
import importlib
import json
import logging
import pandas as pd
import numpy as np
from datetime import datetime
from supabase import create_client, Client
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

REST = None
try:
    REST = importlib.import_module("alpaca_trade_api").REST
except ModuleNotFoundError:
    REST = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

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

def get_portfolio_tickers():
    if not supabase: return []
    try:
        res = supabase.table("mi_portafolio").select("ticker").execute()
        if not res.data: return []
        # Return unique tickers
        return list(set([r['ticker'] for r in res.data]))
    except Exception as e:
        logging.error(f"Error extrayendo portafolio: {e}")
        return []

def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless V2 (Generación IA de Portafolio)...")
    
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase.")
        return

    portfolio_tickers = get_portfolio_tickers()
    if not portfolio_tickers:
        logging.warning("El portafolio está vacío. No hay IA que generar.")
        return

    logging.info(f"Portafolio detectado: {portfolio_tickers}")

    # Fetch 200 days to calculate technicals for the AI context
    try:
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", portfolio_tickers)\
            .order("date", desc=True)\
            .limit(200 * len(portfolio_tickers)).execute()
            
        if not res.data:
            logging.error("No hay datos históricos para el portafolio.")
            return
            
        df = pd.DataFrame(res.data)
    except Exception as e:
        logging.error(f"Error consultando precios: {e}")
        return

    # Prepare Context for AI
    ai_context = []
    for ticker in portfolio_tickers:
        ticker_data = df[df['ticker'] == ticker]
        if len(ticker_data) < 20:
            continue
            
        closes = ticker_data['close'].values
        current_price = closes[0]
        
        # Calculate RSI (14 days approx)
        diff = np.diff(closes[::-1])
        gains = diff[diff > 0].sum()
        losses = -diff[diff < 0].sum()
        rs = gains / losses if losses > 0 else 0
        rsi = 100 - (100 / (1 + rs)) if losses > 0 else 100

        # Bollinger (20)
        last20 = closes[:20]
        sma20 = np.mean(last20)
        std20 = np.std(last20)
        upper = sma20 + (2*std20)
        lower = sma20 - (2*std20)

        ai_context.append(
            f"- {ticker}: Precio ${current_price:.2f}, RSI {rsi:.1f}, "
            f"Soporte LBB ${lower:.2f}, Resistencia UBB ${upper:.2f}"
        )

    context_str = "\\n".join(ai_context)
    
    prompt_macro = f"""Eres un Analista Cuantitativo Institucional experto. Analiza estrictamente LOS ACTIVOS QUE POSEO en mi portafolio.
Ignora el resto del mercado. Haz un análisis profundo para indicarme cuáles de MIS posiciones están sobrecompradas (VENDER), sobrevendidas (COMPRAR MÁS) o en valor justo (MANTENER).

Mis Activos actuales y su estado técnico cuantitativo:
{context_str}

Responde estrictamente en formato JSON válido (SIN MARKDOWN, NI BLOQUES DE CÓDIGO). Estructura exacta que debes devolver:
{{
  "diagnostico_global": "Un resumen ejecutivo profundo de 2 a 3 párrafos evaluando la diversificación actual, el riesgo general, el contexto macroeconómico y qué movimientos tácticos sugieres.",
  "recomendaciones": [
    {{
      "ticker": "TICKER",
      "accion": "SELL",
      "razon": "Justificación técnica muy detallada indicando soportes, resistencias y contexto."
    }},
    {{
      "ticker": "TICKER",
      "accion": "HOLD",
      "razon": "Justificación detallada del porqué mantener."
    }}
  ]
}}
(Incluye absolutamente todos los tickers del contexto en el arreglo 'recomendaciones', con accion BUY, HOLD o SELL).
"""

    
    ia_data = {
        "diagnostico_global": "Generación de IA fallida o en mantenimiento.",
        "recomendaciones": []
    }

    if llm:
        try:
            response = llm.generate_content(prompt_macro)
            texto_ia = response.text.replace("```json", "").replace("```", "").strip()
            ia_data = json.loads(texto_ia, strict=False)
        except Exception as e:
            logging.error(f"Error parseando JSON de Gemini: {e}")
    else:
        logging.error("No hay API KEY de Gemini.")

    # Guardar en nueva tabla o reusar analisis_ia
    # Vamos a reusar analisis_ia insertando con una key especial para no crear otra tabla
    try:
        # We will save this in analisis_ia, using vision_radar as the diagnostico
        # Fetch previous data to merge if we want, or just insert new
        candidatos = {"portafolio_recomendaciones": ia_data.get("recomendaciones", [])}
        
        supabase.table("analisis_ia").insert({
            "candidatos_json": candidatos,
            "vision_radar": ia_data.get("diagnostico_global", ""),
            "seleccion_fondo": "N/A",
            "setup_tecnico": "N/A",
            "contexto_macro": "N/A",
            "insights_tickers": {}
        }).execute()
        logging.info("✅ Pipeline de Recomendaciones de Portafolio Finalizado.")
    except Exception as e:
        logging.error(f"Error guardando IA en Supabase: {e}")

def run_top5_opportunities():
    logging.info("🚀 Iniciando Búsqueda de Top 5 Oportunidades Globales...")
    if not supabase or not llm: return

    try:
        # Get all distinct tickers from history
        res_tickers = supabase.table("precios_historicos").select("ticker").execute()
        all_tickers = list(set([r['ticker'] for r in res_tickers.data])) if res_tickers.data else []
        
        if not all_tickers: return

        # Fetch recent 20 days for all tickers
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .order("date", desc=True)\
            .limit(20 * len(all_tickers)).execute()
            
        df = pd.DataFrame(res.data)
    except Exception as e:
        logging.error(f"Error: {e}")
        return

    # Filter pre-candidates based on simple technicals
    candidates = []
    for ticker in all_tickers:
        t_data = df[df['ticker'] == ticker]
        if len(t_data) < 20: continue
        
        closes = t_data['close'].values
        curr = closes[0]
        
        # simple RSI approx
        diff = np.diff(closes[::-1])
        gains = diff[diff > 0].sum()
        losses = -diff[diff < 0].sum()
        rs = gains / losses if losses > 0 else 0
        rsi = 100 - (100 / (1 + rs)) if losses > 0 else 100
        
        # Bollinger
        last20 = closes[:20]
        sma = np.mean(last20)
        std = np.std(last20)
        lower = sma - (2*std)
        
        # Condition: RSI < 45 or Price near Lower Band
        if rsi < 45 or curr <= (lower * 1.05):
            candidates.append(f"- {ticker}: Precio ${curr:.2f}, RSI {rsi:.1f}, LBB ${lower:.2f}")

    if not candidates:
        logging.info("No hay candidatos claros.")
        return

    # Send top candidates (up to 30) to Gemini
    context_str = "\\n".join(candidates[:30])
    prompt = f"""Eres un Gestor de Fondos de Cobertura Cuantitativo. 
He escaneado el mercado y encontré estos activos sobrevendidos o cerca de soportes críticos (Límites Inferiores de Bollinger):
{context_str}

Tu tarea es seleccionar las 5 MEJORES oportunidades de compra (Top 5).
Debes devolver estrictamente un JSON válido con esta estructura:
{{
  "top5": [
    {{
      "ticker": "TICKER",
      "precio_entrada_ideal": "Ej: $500",
      "target_price": "Ej: $600",
      "riesgo": "ALTO/MEDIO/BAJO",
      "justificacion": "Análisis profundo de por qué es una excelente oportunidad ahora."
    }}
  ]
}}
"""

    try:
        response = llm.generate_content(prompt)
        texto_ia = response.text.replace("```json", "").replace("```", "").strip()
        ia_data = json.loads(texto_ia, strict=False)
        
        # Save Top 5
        # We find the latest analisis_ia and UPDATE it with the top 5
        latest = supabase.table("analisis_ia").select("id, candidatos_json").order("fecha", desc=True).limit(1).execute()
        if latest.data:
            row_id = latest.data[0]["id"]
            c_json = latest.data[0].get("candidatos_json", {})
            c_json["top5_oportunidades"] = ia_data.get("top5", [])
            supabase.table("analisis_ia").update({"candidatos_json": c_json}).eq("id", row_id).execute()
            logging.info("✅ Top 5 Oportunidades guardadas con éxito.")
    except Exception as e:
        logging.error(f"Error Top 5: {e}")

if __name__ == "__main__":
    run_serverless_screener()
    run_top5_opportunities()

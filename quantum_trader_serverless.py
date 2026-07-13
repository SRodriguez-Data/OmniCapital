import os
import time
import importlib
import requests
import json
import logging
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

# ==========================================
# UTILIDADES DE NOTIFICACIÓN
# ==========================================
def send_telegram_message(text: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"}
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        logging.error(f"Error enviando Telegram: {e}")

# ==========================================
# MOTOR DE EJECUCIÓN (ALPACA)
# ==========================================
def execute_buy_order(ticker: str, amount_usd: float = 50.0) -> bool:
    if not REST or not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        return False
    try:
        api = REST(ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL, api_version='v2')
        if ticker.endswith('.SN'):
            return False
        order = api.submit_order(
            symbol=ticker, notional=amount_usd, side='buy', type='market', time_in_force='day'
        )
        return True
    except Exception as e:
        logging.error(f"Error ejecutando orden para {ticker}: {e}")
        return False

# ==========================================
# FLUJO PRINCIPAL SERVERLESS CON IA
# ==========================================
def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless con IA Integrada...")
    
    if not supabase:
        logging.error("❌ Faltan credenciales de Supabase.")
        return
        
    if not llm:
        logging.error("❌ Falta GEMINI_API_KEY. No se puede generar el reporte IA.")
        return

    # 1. Extraer los datos más recientes de Supabase (Último día minado)
    try:
        # Obtenemos la fecha máxima
        res_date = supabase.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute()
        if not res_date.data:
            logging.error("La base de datos está vacía.")
            return
            
        max_date = res_date.data[0]['date']
        logging.info(f"📅 Analizando mercado para la fecha: {max_date}")
        
        # Extraemos todos los activos de ese último día
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
        macd = row.get('macd', 0)
        macd_signal = row.get('macd_signal', 0)
        pvc_ema200 = row.get('pvc_ema200', 0)
        
        if rsi is None or pvc_ema200 is None:
            continue
            
        # Filtro de Liquidez
        volumen_nominal = volumen * close
        if ticker.endswith(".SN") and volumen_nominal < 450_000_000:
            continue
        elif not ticker.endswith(".SN") and volumen_nominal < 500_000:
            continue
            
        # Filtro Técnico: RSI de sobreventa y tendencia razonable
        if rsi < 50 and pvc_ema200 > -0.15:
            # Puntuación basada en oportunidad (RSI bajo) y fortaleza estructural (EMA200)
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
        send_telegram_message("💤 *Quantum Trader*\nNo hay oportunidades con los filtros actuales.")
        return

    # 3. Selección del Top 5
    candidatos = sorted(candidatos, key=lambda x: x['score'], reverse=True)[:5]
    prompt_candidatos = "\\n".join([f"- {c['ticker']}: Precio ${c['price']:.2f}, RSI {c['rsi']:.1f}, Distancia EMA200 {c['distancia_ema200']*100:.1f}%, Score {c['score']:.1f}" for c in candidatos])
    
    # 4. Generación Súper Analista Híbrido (Gemini)
    logging.info("🧠 Invocando al Súper Analista Híbrido...")
    prompt_macro = f"""Eres el Estratega Jefe del Fondo de Inversión. Tienes en tu escritorio el reporte del equipo Quant con las 5 máximas anomalías del mercado hoy:
{prompt_candidatos}

Tu trabajo es entregar el reporte ejecutivo de pre-apertura aplicando los frameworks de Renaissance (Anomalías), Bain (Foso Competitivo) y Citadel (Setup Técnico).
Responde ESTRICTAMENTE EN ESPAÑOL, en formato JSON válido, sin bloques de código markdown, con la siguiente estructura exacta:
{{
  "vision_radar": "Diagnóstico general estilo Renaissance. Breve.",
  "seleccion_fondo": "Elige UNA acción como la mejor asimetría y explica su Foso (Moat) estilo Bain.",
  "setup_tecnico": "Zona de entrada, Amenaza Macro y Nivel de Stop-Loss estilo Citadel."
}}"""

    try:
        response = llm.generate_content(prompt_macro)
        texto_ia = response.text.replace("```json", "").replace("```", "").strip()
        ia_data = json.loads(texto_ia)
    except Exception as e:
        logging.error(f"Error generando o parseando IA: {e}")
        ia_data = {
            "vision_radar": "Error al conectar con la IA.",
            "seleccion_fondo": "Error al conectar con la IA.",
            "setup_tecnico": "Error al conectar con la IA."
        }

    # 5. Guardar en Supabase (Web Dashboard)
    logging.info("💾 Guardando análisis IA en Supabase...")
    try:
        supabase.table("analisis_ia").insert({
            "candidatos_json": candidatos,
            "vision_radar": ia_data.get("vision_radar", ""),
            "seleccion_fondo": ia_data.get("seleccion_fondo", ""),
            "setup_tecnico": ia_data.get("setup_tecnico", "")
        }).execute()
    except Exception as e:
        logging.error(f"Error guardando IA en Supabase: {e}")

    # 6. Ejecución de Paper Trading (Solo top 1 o top 2 para diversificar)
    compras = []
    for c in candidatos[:2]:
        if execute_buy_order(c['ticker']):
            compras.append(c['ticker'])
            
    # 7. Notificación Telegram
    msg = f"☀️ *SÚPER ANALISTA HÍBRIDO*\nTop: {', '.join([c['ticker'] for c in candidatos])}\n\n🏆 *Selección:*\n{ia_data.get('seleccion_fondo')[:200]}...\n\nRevisa el Dashboard Web para ver el reporte completo."
    send_telegram_message(msg)
    logging.info("✅ Pipeline Cuantitativo Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()

import os
import sys
import time
import importlib
import requests
import json
import logging
import pandas as pd
import yfinance as yf
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

TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Tickers will be dynamically fetched from mi_portafolio

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

# Si un modelo falla o se agota su cuota gratis, se usa el siguiente. gemini-3.5-flash no tiene cuota gratis con
# esta clave (429) y el SDK reintentaba varios minutos antes de rendirse: por eso el tope de tiempo por modelo
MODELOS_GEMINI = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
TIEMPO_MAXIMO_GEMINI = 180
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def compute_quant_math(tickers):
    if not tickers or not supabase:
        return {}, []
    try:
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(100 * len(tickers)).execute()
            
        if not res.data:
            return {}, []
            
        df = pd.DataFrame(res.data)
        df_pivot = df.pivot_table(index="date", columns="ticker", values="close")
        df_pivot = df_pivot.sort_index()
        
        returns = df_pivot.pct_change().dropna()
        if returns.empty:
            return {}, []
            
        corr_matrix = returns.corr().round(2)
        # Un precio congelado no varía y su correlación sale NaN, que no se puede guardar como JSON
        corr_json = {t: {k: (None if pd.isna(v) else v) for k, v in corr_matrix[t].items()} for t in corr_matrix.columns}
            
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
            
            w_dict = {returns.columns[i]: round(weights[i], 3) for i in range(num_assets)}
            
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


def tickers_con_datos_frescos(tickers, max_date):
    """Yahoo a veces repite el mismo cierre por semanas en acciones chilenas; un RSI calculado sobre eso es falso
    (precio plano y luego una caída da RSI cercano a 0). Se descartan los tickers con pocos cierres distintos
    en sus últimos 20 días."""
    desde = (pd.Timestamp(max_date) - pd.Timedelta(days=40)).strftime("%Y-%m-%d")
    buenos = set()
    for i in range(0, len(tickers), 25):
        lote = tickers[i:i + 25]
        res = supabase.table("precios_historicos").select("date, ticker, close")            .in_("ticker", lote).gte("date", desde).order("date", desc=True).limit(1000).execute()
        if not res.data:
            continue
        df = pd.DataFrame(res.data)
        for t, g in df.groupby("ticker"):
            ultimos = g.sort_values("date", ascending=False).head(20)["close"]
            if len(ultimos) >= 15 and ultimos.nunique() >= 12:
                buenos.add(t)
    return buenos

def get_fundamentals(ticker):
    try:
        info = yf.Ticker(ticker).info
        pe = info.get('trailingPE', info.get('forwardPE', -1))
        # Yahoo cambió 'dividendYield' a porcentaje (3.46 = 3,46%); multiplicarlo por 100 daba 346%.
        # Se calcula como dividendo anual / precio, que no depende de ese formato.
        rate = info.get('dividendRate')
        price = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose')
        if isinstance(rate, (int, float)) and isinstance(price, (int, float)) and price > 0:
            div_pct = rate / price * 100
        else:
            div = info.get('dividendYield')
            div_pct = div if isinstance(div, (int, float)) else 0
        div_str = f"{div_pct:.2f}%"
        deuda = info.get('debtToEquity', 0)
        # En inmobiliarias/REITs el P/E (ganancia contable) no mide su valor: se trata como dato desconocido
        if info.get('sector') == 'Real Estate':
            pe = -1
        
        if not isinstance(pe, (int, float)): pe = -1
        if not isinstance(deuda, (int, float)): deuda = 0
        
        return {"pe": pe, "div_str": div_str, "deuda": deuda}
    except Exception as e:
        logging.error(f"Error fetching YF for {ticker}: {e}")
        return {"pe": -1, "div_str": "0.00%", "deuda": 0}

def calculate_trading_limits(candidates):
    if not candidates or not supabase:
        return candidates
        
    tickers = [c['ticker'] for c in candidates]
    
    try:
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(20 * len(tickers)).execute()
            
        if not res.data:
            return candidates
            
        df = pd.DataFrame(res.data)
        
        for c in candidates:
            if c.get('sin_senal_tecnica'):
                continue
            ticker_data = df[df['ticker'] == c['ticker']]
            if len(ticker_data) < 5:
                continue
                
            closes = ticker_data['close'].values
            std_20 = np.std(closes)
            sma_20 = np.mean(closes)
            
            c['bollinger_upper'] = sma_20 + (2 * std_20)
            c['bollinger_lower'] = sma_20 - (2 * std_20)
            
            # EMA200 is available via distance
            current_price = c['price']
            dist = c['distancia_ema200']
            if dist > -0.99:
                c['ema200_abs'] = current_price / (1 + dist)
            else:
                c['ema200_abs'] = current_price
                
            # Signal Logic
            if current_price < c['bollinger_lower']:
                c['signal'] = 'BUY'
                # Insert Alert
                try:
                    alert_msg = f"{c['ticker']} entró en Zona de Compra Extrema. Precio: ${current_price:.2f} (Soporte: ${c['bollinger_lower']:.2f})."
                    supabase.table("alertas_mercado").insert({
                        "ticker": c['ticker'],
                        "tipo": "BUY_ZONE",
                        "precio_actual": current_price,
                        "mensaje": alert_msg
                    }).execute()
                    logging.info(f"🚨 ALERTA INYECTADA: {alert_msg}")
                except Exception as e:
                    logging.error(f"Error inyectando alerta para {c['ticker']}: {e}")
            elif current_price > c['bollinger_upper']:
                c['signal'] = 'SELL'
            else:
                c['signal'] = 'HOLD'
                
    except Exception as e:
        logging.error(f"Error calculando trading limits: {e}")
        
    return candidates

def linea_prompt(c):
    if c.get('sin_senal_tecnica'):
        return f"- {c['ticker']}: Precio ${c['price']:.2f}, SIN señal técnica (precios congelados en la fuente), P/E {c['pe']:.1f}, Dividend Yield {c['div_str']}"
    return f"- {c['ticker']}: Precio ${c['price']:.2f}, RSI {c['rsi']:.1f}, Distancia EMA200 {c['distancia_ema200']*100:.1f}%, Score {c['score']:.1f}"

def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless (Institucional)...")
    
    # Sin credenciales o sin datos el job debe quedar en rojo en GitHub Actions, no en verde sin hacer nada
    if not supabase or not GEMINI_API_KEY:
        logging.error("❌ Faltan credenciales clave (Supabase o Gemini).")
        sys.exit(1)

    # 1. Extraer los datos más recientes
    try:
        res_date = supabase.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute()
        if not res_date.data:
            logging.error("❌ No hay precios guardados.")
            sys.exit(1)
        max_date = res_date.data[0]['date']

        # La corrida de respaldo no repite el análisis (ni gasta cuota de Gemini) si ya se hizo con estos precios
        if not os.getenv("FORZAR_ANALISIS"):
            ultimo = (supabase.table("analisis_ia").select("candidatos_json->fecha_precios")
                      .order("fecha", desc=True).limit(1).execute().data)
            if ultimo and ultimo[0].get("fecha_precios") == max_date:
                logging.info(f"✅ El análisis con los precios del {max_date[:10]} ya está hecho; no se repite.")
                return

        res_activos = supabase.table("precios_historicos").select("*").eq("date", max_date).execute()
        activos_hoy = res_activos.data
    except Exception as e:
        logging.error(f"Error consultando Supabase: {e}")
        sys.exit(1)

    all_us = []
    all_cl = []
    liquidos = {}
    
    # 2. Filtrado Cuantitativo Separado (EE.UU. vs Chile)
    for row in activos_hoy:
        ticker = row['ticker']
        rsi = row.get('rsi') or 50
        close = row.get('close') or 0
        volumen = row.get('volume') or 0
        pvc_ema200 = row.get('pvc_ema200') or 0
        
        if rsi is None or pvc_ema200 is None:
            continue
        # Índices (^GSPC) y monedas (CLP=X) se guardan como referencia, no son oportunidades de compra
        if ticker.startswith('^') or '=' in ticker:
            continue
            
        volumen_nominal = volumen * close
        if ticker.endswith(".SN") and volumen_nominal < 450_000_000:
            continue
        elif not ticker.endswith(".SN") and volumen_nominal < 500_000:
            continue
            
        liquidos[ticker] = close

        if rsi < 50 and pvc_ema200 > -0.20:
            score = (50 - rsi) + (pvc_ema200 * 100)
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

    # Yahoo congela el historial de varias acciones chilenas: su RSI/EMA/Bollinger no son confiables.
    # No se descartan: se evalúan solo por P/E y dividendo y se marcan "sin señal técnica" (RSI nulo).
    frescos = tickers_con_datos_frescos(list(liquidos), max_date)
    congelados = [t for t in liquidos if t not in frescos]
    if congelados:
        logging.warning(f"{len(congelados)} tickers con precios congelados en Yahoo (RSI nulo): {', '.join(congelados[:30])}")
    all_us = [c for c in all_us if c['ticker'] in frescos]
    all_cl = [c for c in all_cl if c['ticker'] in frescos]

    sin_senal_us, sin_senal_cl = [], []
    for t in congelados:
        fund = get_fundamentals(t)
        try:
            div = float(str(fund['div_str']).replace('%', ''))
        except ValueError:
            div = 0
        if not (0 < fund['pe'] < 40 and div > 0):
            continue
        c = {'ticker': t, 'price': liquidos[t], 'rsi': None, 'distancia_ema200': None, 'score': None,
             'sin_senal_tecnica': True, **fund}
        (sin_senal_cl if t.endswith('.SN') else sin_senal_us).append(c)
    sin_senal_us.sort(key=lambda x: -float(x['div_str'].replace('%', '')))
    sin_senal_cl.sort(key=lambda x: -float(x['div_str'].replace('%', '')))

    top_us_fund = []
    rejected_us = []
    logging.info("⏳ Filtrando fundamentales en YFinance para US...")
    for c in all_us:
        fund = get_fundamentals(c['ticker'])
        c.update(fund)
        if (fund['pe'] == -1 or fund['pe'] < 40) and (fund['deuda'] == 0 or fund['deuda'] < 250):
            top_us_fund.append(c)
        else:
            rejected_us.append(c)

    top_cl_fund = []
    rejected_cl = []
    logging.info("⏳ Filtrando fundamentales en YFinance para CL...")
    for c in all_cl:
        fund = get_fundamentals(c['ticker'])
        c.update(fund)
        if (fund['pe'] == -1 or fund['pe'] < 40) and (fund['deuda'] == 0 or fund['deuda'] < 250):
            top_cl_fund.append(c)
        else:
            rejected_cl.append(c)
            
    # Ordena esa lista final por RSI de menor a mayor.
    top_us_fund.sort(key=lambda x: x['rsi'])
    top_cl_fund.sort(key=lambda x: x['rsi'])
    rejected_us.sort(key=lambda x: x['rsi'])
    rejected_cl.sort(key=lambda x: x['rsi'])
    
    # Hasta 5 por mercado
    # Solo lo que pasa los fundamentales: mejor mostrar menos de 5 que rellenar con lo que no los cumple
    top_us = top_us_fund[:5]
    top_cl = top_cl_fund[:5]
    # Los de RSI nulo solo completan los cupos que quedan libres
    top_us += sin_senal_us[:5 - len(top_us)]
    top_cl += sin_senal_cl[:5 - len(top_cl)]
    
    # Agregar métricas institucionales (Bollinger, Max Sell, Min Buy, Signal)
    top_us = calculate_trading_limits(top_us)
    top_cl = calculate_trading_limits(top_cl)

    # 3. Matemáticas de Portafolio Real
    logging.info("🧮 Calculando Matriz de Correlación y Markowitz SOBRE MI PORTAFOLIO...")
    try:
        res_tickers = supabase.table("mi_portafolio").select("ticker").execute()
        if res_tickers.data:
            portfolio_tickers = list(set([row['ticker'] for row in res_tickers.data]))
            if portfolio_tickers:
                corr_json, frontier_points = compute_quant_math(portfolio_tickers)
                if corr_json:
                    supabase.table("correlaciones").insert({"matriz_json": corr_json}).execute()
                if frontier_points:
                    supabase.table("frontera_eficiente").insert({"puntos_json": frontier_points}).execute()
    except Exception as e:
        logging.error(f"Error guardando matemáticas del portafolio en Supabase: {e}")

    # 4. Generación Analista Institucional (Gemini) - Mercado Global
    prompt_us = "\n".join([linea_prompt(c) for c in top_us])
    prompt_cl = "\n".join([linea_prompt(c) for c in top_cl])
    
    # Nuevo: Extraer info del portafolio del usuario
    portfolio_data = []
    if 'portfolio_tickers' in locals() and portfolio_tickers:
        for t in portfolio_tickers:
            try:
                res_t = supabase.table("precios_historicos").select("*").eq("ticker", t).order("date", desc=True).limit(1).execute()
                if res_t.data:
                    portfolio_data.append(res_t.data[0])
            except Exception as e:
                logging.error(f"Error fetching latest data for {t}: {e}")
                
    prompt_mi_portafolio = "Portafolio Vacío"
    if portfolio_data:
        prompt_mi_portafolio = "\\n".join([f"- {r['ticker']}: Precio ${r.get('close',0):.2f}, RSI {r.get('rsi',0):.1f}, Dist. EMA200 {(r.get('pvc_ema200',0)*100):.1f}%" for r in portfolio_data])

    prompt_macro = f"""Eres el Estratega Cuantitativo Jefe. 
Analiza los siguientes dos mercados y el portafolio del cliente, luego provee un reporte institucional estricto.

Mercado EE.UU. (Top 5 Anomalías):
{prompt_us}

Mercado Chile (Top 5 Anomalías):
{prompt_cl}

MI PORTAFOLIO ACTUAL:
{prompt_mi_portafolio}

Responde ESTRICTAMENTE EN ESPAÑOL, en formato JSON válido, sin bloques de código markdown, con la siguiente estructura exacta:
{{
  "contexto_macro": "Análisis macroeconómico de 2 párrafos (tasas, inflación, etc).",
  "vision_radar": "Resumen de las anomalías detectadas en los mercados globales.",
  "seleccion_fondo": "Tu selección #1 global justificando su ventaja (Moat).",
  "setup_tecnico": "Evaluación técnica del riesgo de mercado actual.",
  "diagnostico_mi_portafolio": "Un diagnóstico crítico y duro sobre MI PORTAFOLIO ACTUAL. Tu análisis debe ser exhaustivo y de grado institucional. El apartado de ANÁLISIS debe contener al menos 2 párrafos robustos detallando el momentum técnico, riesgos macroeconómicos y justificación de la decisión (BUY/HOLD/SELL). No escatimes en detalles. Usa un tono de banquero de inversión.",
  "recomendaciones_mi_portafolio": [
      // REGLA ABSOLUTA: DEBES incluir un objeto por CADA UNO de los siguientes tickers: {", ".join(portfolio_tickers) if 'portfolio_tickers' in locals() else "ninguno"}
      {{"ticker": "TICKER_AQUI", "accion": "🟢 BUY (Aumentar) / 🟡 HOLD (Mantener) / 🔴 SELL (Recortar)", "stop_loss": "Calcula un precio exacto de salida de emergencia, justificándolo.", "analisis": "Tu análisis debe ser exhaustivo y de grado institucional. Explica el momentum técnico y justifica la decisión fuertemente."}}
  ], // NUNCA recomiendes 'BUY' ciegamente. Exige buen precio. Si la acción está sobrecomprada o el riesgo es alto, recomienda SELL o HOLD.
  "insights_us": {{
      "TICKER_US": "Tesis de inversión institucional y predictiva de grado bancario (mínimo 2 párrafos). Explica por qué esta anomalía (RSI y EMA200) representa una oportunidad única (o un riesgo), proyección a corto plazo y setup técnico (riesgo/beneficio)."
  }},
  "insights_cl": {{
      "TICKER_CL": "Tesis de inversión institucional y predictiva de grado bancario (mínimo 2 párrafos). Explica por qué esta anomalía (RSI y EMA200) representa una oportunidad única (o un riesgo), proyección a corto plazo y setup técnico (riesgo/beneficio)."
  }}
}}
Incluye todos los tickers en sus respectivos diccionarios/listas."""

    ia_data = None
    for modelo in MODELOS_GEMINI:
        try:
            response = genai.GenerativeModel(modelo).generate_content(
                prompt_macro,
                generation_config={"response_mime_type": "application/json", "temperature": 0.0},
                request_options={"timeout": TIEMPO_MAXIMO_GEMINI}
            )
            texto_ia = response.text.replace("```json", "").replace("```", "").strip()
            ia_data = json.loads(texto_ia)
            logging.info(f"🧠 Análisis generado con {modelo}.")
            break
        except Exception as e:
            logging.warning(f"{modelo} no respondió: {str(e)[:160]}")
    if ia_data is None:
        logging.error("Error generando IA: ningún modelo de Gemini respondió.")
        ia_data = {
            "contexto_macro": "Error", "vision_radar": "Error", "seleccion_fondo": "Error", "setup_tecnico": "Error",
            "insights_us": {}, "insights_cl": {}
        }

    # 5. Guardar en Supabase (Web Dashboard)
    # Como analisis_ia actual solo tiene candidatos_json, guardaremos un objeto combinado para no romper la DB actual.
    combined_candidates = {
        "us": top_us,
        "cl": top_cl,
        "diagnostico_portafolio": ia_data.get("diagnostico_mi_portafolio", "Sin diagnóstico específico."),
        "recomendaciones_portafolio": ia_data.get("recomendaciones_mi_portafolio", []),
        # Con qué precios se hizo: la corrida de respaldo no repite el análisis si no hay precios nuevos
        "fecha_precios": max_date
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
        sys.exit(1)
            
    logging.info("✅ Pipeline Institucional Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()
